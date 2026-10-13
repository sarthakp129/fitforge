import { Router } from 'express';
import { all, get, run, today } from '../db.js';
import { auth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { clamp, round, estimatedOneRM, macroTargets } from '../services/nutrition.js';
import { validDate } from '../lib/validate.js';
import { EXERCISES } from '../services/planEngine.js';

const router = Router();
router.use(auth);

/* -------------------------------- metrics ------------------------------- */

router.get('/metrics', (req, res) => {
  const days = clamp(Number(req.query.days) || 90, 1, 3650);
  const rows = all(
    `SELECT * FROM metrics WHERE user_id = ? AND date >= date('now', ?) ORDER BY date`,
    req.user.id, `-${days} day`
  );
  const weights = rows.filter((r) => r.weight_kg).map((r) => r.weight_kg);
  const first = weights[0];
  const last = weights[weights.length - 1];
  res.json({
    days,
    series: rows,
    summary: weights.length
      ? {
          latest: last,
          latest_date: rows[rows.length - 1].date,
          change: round(last - first, 2),
          min: Math.min(...weights),
          max: Math.max(...weights),
          avg: round(weights.reduce((a, b) => a + b, 0) / weights.length, 2),
        }
      : null,
  });
});

router.post('/metrics', (req, res) => {
  const b = req.body || {};
  if (b.date !== undefined && !validDate(b.date)) throw new ApiError(400, 'date must be a real date in YYYY-MM-DD form.');
  const date = validDate(b.date) ? b.date : today();
  const weight = b.weight_kg == null || b.weight_kg === '' ? null : clamp(Number(b.weight_kg), 30, 300);
  const bf = b.body_fat_pct == null || b.body_fat_pct === '' ? null : clamp(Number(b.body_fat_pct), 3, 60);
  const waist = b.waist_cm == null || b.waist_cm === '' ? null : clamp(Number(b.waist_cm), 40, 200);
  if (weight === null && bf === null && waist === null) {
    throw new ApiError(400, 'Provide at least one of weight_kg, body_fat_pct or waist_cm.');
  }
  run(
    `INSERT INTO metrics (user_id, date, weight_kg, body_fat_pct, waist_cm, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       weight_kg = COALESCE(excluded.weight_kg, weight_kg),
       body_fat_pct = COALESCE(excluded.body_fat_pct, body_fat_pct),
       waist_cm = COALESCE(excluded.waist_cm, waist_cm),
       notes = COALESCE(NULLIF(excluded.notes,''), notes)`,
    req.user.id, date, weight, bf, waist, String(b.notes || '').slice(0, 300)
  );
  if (weight) run('UPDATE profiles SET weight_kg = ? WHERE user_id = ?', weight, req.user.id);
  res.status(201).json({ metric: get('SELECT * FROM metrics WHERE user_id = ? AND date = ?', req.user.id, date) });
});

router.delete('/metrics/:id', (req, res) => {
  const { changes } = run('DELETE FROM metrics WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!changes) throw new ApiError(404, 'Metric not found.');
  res.json({ ok: true });
});

/* --------------------------------- stats -------------------------------- */

function weeklyVolume(userId, weeks) {
  return all(
    `SELECT strftime('%Y-W%W', date) AS week,
            MIN(date) AS week_start,
            ROUND(SUM(reps * weight_kg)) AS volume_kg,
            COUNT(*) AS sets,
            COUNT(DISTINCT log_id) AS sessions
     FROM sets
     WHERE user_id = ? AND is_warmup = 0 AND date >= date('now', ?)
     GROUP BY week ORDER BY week`,
    userId, `-${weeks * 7} day`
  );
}

function dayStreak(userId) {
  const dates = all(
    `SELECT DISTINCT date FROM workout_logs WHERE user_id = ? AND date <= date('now','localtime') ORDER BY date DESC`,
    userId
  ).map((r) => r.date);
  if (!dates.length) return { current: 0, longest: 0, last_session: null };

  const sorted = [...dates].sort();
  let longest = 1;
  let run_ = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`);
    const cur = new Date(`${sorted[i]}T00:00:00Z`);
    const diffDays = Math.round((cur - prev) / 86400000);
    run_ = diffDays === 1 ? run_ + 1 : 1;
    longest = Math.max(longest, run_);
  }

  const todayStr = today();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let current = 0;
  if (dates[0] === todayStr || dates[0] === yesterday) {
    current = 1;
    for (let i = 0; i < dates.length - 1; i++) {
      const a = new Date(`${dates[i]}T00:00:00Z`);
      const b = new Date(`${dates[i + 1]}T00:00:00Z`);
      if (Math.round((a - b) / 86400000) === 1) current++;
      else break;
    }
  }
  return { current, longest, last_session: dates[0] };
}

router.get('/stats/overview', (req, res) => {
  const uid = req.user.id;
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', uid);
  const volume = weeklyVolume(uid, 12);
  const thisWeek = volume[volume.length - 1];
  const lastWeek = volume[volume.length - 2];

  const totals = get(
    `SELECT COUNT(*) AS sessions, ROUND(COALESCE(SUM(duration_s),0)/60.0) AS minutes
     FROM workout_logs WHERE user_id = ?`, uid
  );
  const last14 = get(
    `SELECT ROUND(SUM(reps * weight_kg)) AS volume_kg, COUNT(*) AS sets, COUNT(DISTINCT log_id) AS sessions
     FROM sets WHERE user_id = ? AND is_warmup = 0 AND date >= date('now','-14 day')`, uid
  );
  const weightRows = all(
    `SELECT date, weight_kg FROM metrics WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY date DESC LIMIT 30`, uid
  );
  const weight_change_kg = weightRows.length > 1
    ? round(weightRows[0].weight_kg - weightRows[weightRows.length - 1].weight_kg, 2)
    : 0;

  const kcal = get(
    `SELECT ROUND(AVG(calories)) AS avg_kcal, ROUND(AVG(protein_g)) AS avg_protein, COUNT(DISTINCT date) AS days
     FROM (SELECT date, SUM(calories) AS calories, SUM(protein_g) AS protein_g
           FROM nutrition_logs WHERE user_id = ? AND date >= date('now','-7 day') GROUP BY date)`, uid
  );

  const headline = {
    sessions: thisWeek?.sessions || 0,
    volume_this_week_kg: thisWeek?.volume_kg || 0,
    volume_last_week_kg: lastWeek?.volume_kg || 0,
    volume_delta_pct: lastWeek?.volume_kg
      ? round(((thisWeek.volume_kg - lastWeek.volume_kg) / lastWeek.volume_kg) * 100, 1)
      : null,
    sets_last_14d: last14?.sets || 0,
    total_sessions: totals?.sessions || 0,
    total_minutes: totals?.minutes || 0,
    weight_change_kg,
    weight_latest: weightRows[0]?.weight_kg ?? profile?.weight_kg ?? null,
    avg_kcal_7d: kcal?.avg_kcal || 0,
    avg_protein_7d: kcal?.avg_protein || 0,
    calorie_target: profile ? macroTargets(profile).calories : null,
    protein_target: profile ? macroTargets(profile).protein_g : null,
    streak: dayStreak(uid).current,
  };

  res.json({
    headline,
    streaks: dayStreak(uid),
    weekly_volume: volume,
    targets: profile ? macroTargets(profile) : null,
  });
});

router.get('/stats/volume', (req, res) => {
  const weeks = clamp(Number(req.query.weeks) || 12, 1, 104);
  res.json({ weeks, series: weeklyVolume(req.user.id, weeks) });
});

router.get('/stats/prs', (req, res) => {
  const rows = all(
    `SELECT exercise_id, exercise_name,
            MAX(weight_kg) AS top_kg,
            COUNT(*) AS lifetime_sets,
            MAX(reps) AS best_reps
     FROM sets WHERE user_id = ? AND is_warmup = 0 AND weight_kg > 0
     GROUP BY exercise_id ORDER BY top_kg DESC LIMIT 40`,
    req.user.id
  );
  // best estimated 1RM per lift
  const allSets = all(
    `SELECT exercise_id, exercise_name, weight_kg, reps FROM sets
     WHERE user_id = ? AND is_warmup = 0 AND weight_kg > 0 AND reps > 0`, req.user.id
  );
  const bestOrm = new Map();
  for (const s of allSets) {
    const orm = estimatedOneRM(s.weight_kg, s.reps);
    if (orm > (bestOrm.get(s.exercise_id)?.orm || 0)) bestOrm.set(s.exercise_id, { orm, name: s.exercise_name });
  }
  res.json({
    prs: rows.map((r) => ({ ...r, est_1rm: bestOrm.get(r.exercise_id)?.orm || null })),
    lifts: {
      squat: bestOrm.get('back_squat')?.orm || null,
      bench: bestOrm.get('bench_press')?.orm || bestOrm.get('db_bench_press')?.orm || null,
      deadlift: bestOrm.get('deadlift')?.orm || bestOrm.get('trap_bar_deadlift')?.orm || bestOrm.get('romanian_deadlift')?.orm || null,
      overhead: bestOrm.get('overhead_press')?.orm || bestOrm.get('db_shoulder_press')?.orm || null,
    },
  });
});

/** Activity heatmap: last N weeks, one cell per day. */
router.get('/stats/heatmap', (req, res) => {
  const weeks = clamp(Number(req.query.weeks) || 26, 1, 104);
  const rows = all(
    `SELECT date, COUNT(*) AS sessions, COALESCE(SUM(duration_s),0) AS seconds FROM workout_logs
     WHERE user_id = ? AND date >= date('now', ?) GROUP BY date`,
    req.user.id, `-${weeks * 7} day`
  );
  const nutrition = all(
    `SELECT date, COUNT(*) AS entries FROM nutrition_logs
     WHERE user_id = ? AND date >= date('now', ?) GROUP BY date`,
    req.user.id, `-${weeks * 7} day`
  );
  const map = new Map(rows.map((r) => [r.date, r]));
  const nmap = new Map(nutrition.map((r) => [r.date, r]));
  const cells = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    cells.push({
      date: d,
      sessions: map.get(d)?.sessions || 0,
      minutes: Math.round((map.get(d)?.seconds || 0) / 60),
      meals_logged: nmap.get(d)?.entries || 0,
    });
  }
  res.json({ weeks, cells });
});

/** Volume distribution per muscle group — shows imbalances at a glance. */
router.get('/stats/muscles', (req, res) => {
  const days = clamp(Number(req.query.days) || 28, 1, 365);
  const rows = all(
    `SELECT exercise_id, exercise_name, SUM(reps * weight_kg) AS volume_kg, COUNT(*) AS sets
     FROM sets WHERE user_id = ? AND is_warmup = 0 AND date >= date('now', ?)
     GROUP BY exercise_id`, req.user.id, `-${days} day`
  );
  const byMuscle = {};
  for (const r of rows) {
    const ex = EXERCISES.find((e) => e.id === r.exercise_id);
    const muscles = ex?.muscles?.length ? ex.muscles : ['other'];
    for (const m of muscles) {
      byMuscle[m] ||= { muscle: m, volume_kg: 0, sets: 0 };
      byMuscle[m].volume_kg += Number(r.volume_kg) || 0;
      byMuscle[m].sets += r.sets;
    }
  }
  const out = Object.values(byMuscle).sort((a, b) => b.volume_kg - a.volume_kg);
  const max = out[0]?.volume_kg || 1;
  res.json({ days, muscles: out.map((m) => ({ ...m, pct: round((m.volume_kg / max) * 100) })) });
});

/* ----------------------------- export / import --------------------------- */

router.get('/export', (req, res) => {
  const uid = req.user.id;
  const payload = {
    exported_at: new Date().toISOString(),
    version: 1,
    user: get('SELECT email, name, created_at FROM users WHERE id = ?', uid),
    profile: get('SELECT * FROM profiles WHERE user_id = ?', uid),
    metrics: all('SELECT * FROM metrics WHERE user_id = ? ORDER BY date', uid),
    workouts: all('SELECT * FROM workout_logs WHERE user_id = ? ORDER BY date', uid).map((w) => ({
      ...w,
      sets: all('SELECT * FROM sets WHERE log_id = ? ORDER BY set_number', w.id),
    })),
    nutrition: all('SELECT * FROM nutrition_logs WHERE user_id = ? ORDER BY date', uid),
    plans: all(`SELECT id, kind, title, payload, source, model, created_at FROM ai_plans WHERE user_id = ? ORDER BY id`, uid)
      .map((p) => ({ ...p, payload: JSON.parse(p.payload) })),
  };
  res.json(payload);
});

router.get('/export.csv', (req, res) => {
  const uid = req.user.id;
  const sets = all(
    `SELECT w.date, w.name AS workout, w.focus, s.exercise_name, s.set_number, s.reps, s.weight_kg, s.rpe, s.is_warmup
     FROM sets s JOIN workout_logs w ON w.id = s.log_id
     WHERE s.user_id = ? ORDER BY w.date, w.id, s.exercise_name, s.set_number`, uid
  );
  const food = all('SELECT date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g FROM nutrition_logs WHERE user_id = ? ORDER BY date', uid);
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [
    'section,workout_log',
    ['date', 'workout', 'focus', 'exercise', 'set', 'reps', 'weight_kg', 'rpe', 'warmup'].join(','),
    ...sets.map((s) => [s.date, s.workout, s.focus, s.exercise_name, s.set_number, s.reps, s.weight_kg, s.rpe ?? '', s.is_warmup].map(esc).join(',')),
    '',
    'section,nutrition_log',
    ['date', 'meal', 'food', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g'].join(','),
    ...food.map((f) => [f.date, f.meal_type, f.food_name, f.grams, f.calories, f.protein_g, f.carbs_g, f.fat_g].map(esc).join(',')),
  ];
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="fitforge-export-${today()}.csv"`);
  res.send(lines.join('\n'));
});

router.post('/import', (req, res) => {
  const data = req.body || {};
  if (!data || typeof data !== 'object') throw new ApiError(400, 'Expected an exported FitForge JSON payload.');
  const uid = req.user.id;
  let counts = { metrics: 0, workouts: 0, sets: 0, nutrition: 0 };

  for (const m of data.metrics || []) {
    run(
      `INSERT INTO metrics (user_id, date, weight_kg, body_fat_pct, waist_cm, notes) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = COALESCE(excluded.weight_kg, weight_kg)`,
      uid, m.date, m.weight_kg ?? null, m.body_fat_pct ?? null, m.waist_cm ?? null, m.notes || ''
    );
    counts.metrics++;
  }
  for (const w of data.workouts || []) {
    const { lastInsertRowid } = run(
      `INSERT INTO workout_logs (user_id, date, name, focus, duration_s, calories, rpe, notes) VALUES (?,?,?,?,?,?,?,?)`,
      uid, w.date, w.name || 'Workout', w.focus || 'full_body', w.duration_s || 0, w.calories || 0, w.rpe ?? null, w.notes || ''
    );
    counts.workouts++;
    for (const s of w.sets || []) {
      run(
        `INSERT INTO sets (log_id, user_id, date, exercise_id, exercise_name, set_number, reps, weight_kg, rpe, tempo, rest_s, is_warmup)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        Number(lastInsertRowid), uid, s.date || w.date, s.exercise_id || 'unknown', s.exercise_name || 'Exercise',
        s.set_number || 1, s.reps || 0, s.weight_kg || 0, s.rpe ?? null, s.tempo || '', s.rest_s || 90, s.is_warmup ? 1 : 0
      );
      counts.sets++;
    }
  }
  for (const n of data.nutrition || []) {
    run(
      `INSERT INTO nutrition_logs (user_id, date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g, source)
       VALUES (?,?,?,?,?,?,?,?,?,'imported')`,
      uid, n.date, n.meal_type || 'snack', n.food_name, n.grams || 0, n.calories || 0,
      n.protein_g || 0, n.carbs_g || 0, n.fat_g || 0
    );
    counts.nutrition++;
  }
  res.json({ ok: true, counts });
});

export default router;
