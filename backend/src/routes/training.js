import { Router } from 'express';
import { all, get, run, tx, today, parseJson } from '../db.js';
import { auth, optionalAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import {
  searchExercises,
  getExerciseById,
  getExerciseSubstitutes,
  createCustomExercise,
  deleteCustomExercise,
  getUserCustomExercises,
} from '../services/exerciseService.js';
import { clamp } from '../services/nutrition.js';
import { validDate, queryDate } from '../lib/validate.js';

const router = Router();

/* --------------------------- exercise library --------------------------- */

router.get('/exercises', optionalAuth, (req, res) => {
  const result = searchExercises({
    query: req.query.q,
    muscle: req.query.muscle,
    category: req.query.category,
    equipment: req.query.equipment,
    userId: req.user?.id || null,
    limit: Math.min(200, Math.max(1, Number(req.query.limit) || 200)),
  });
  res.json(result);
});

router.get('/exercises/:id', optionalAuth, (req, res) => {
  const ex = getExerciseById(req.params.id, req.user?.id);
  if (!ex) throw new ApiError(404, 'Unknown exercise id.');
  res.json({ exercise: ex });
});

router.get('/exercises/:id/substitutes', optionalAuth, (req, res) => {
  const substitutes = getExerciseSubstitutes(req.params.id, req.user?.id, {
    equipment: req.query.equipment || null,
    maxResults: Math.min(10, Math.max(1, Number(req.query.limit) || 6)),
  });
  res.json({ substitutes });
});

/* ---------------------------- workout logs ------------------------------ */

router.use(auth);

const hydrate = (logs) => {
  if (!logs.length) return [];
  const ids = logs.map((l) => l.id);
  const sets = all(
    `SELECT * FROM sets WHERE log_id IN (${ids.map(() => '?').join(',')}) ORDER BY set_number, id`,
    ...ids
  );
  const byLog = new Map();
  for (const s of sets) {
    if (!byLog.has(s.log_id)) byLog.set(s.log_id, []);
    byLog.get(s.log_id).push(s);
  }
  return logs.map((l) => ({ ...l, sets: byLog.get(l.id) || [] }));
};

router.get('/workouts', (req, res) => {
  const limit = clamp(Number(req.query.limit) || 30, 1, 200);
  const from = req.query.from;
  const to = req.query.to;
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (validDate(from)) { where.push('date >= ?'); params.push(from); }
  if (validDate(to)) { where.push('date <= ?'); params.push(to); }
  const logs = all(
    `SELECT * FROM workout_logs WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC LIMIT ?`,
    ...params, limit
  );
  res.json({ count: logs.length, workouts: hydrate(logs) });
});

router.get('/workouts/:id', (req, res) => {
  const log = get('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!log) throw new ApiError(404, 'Workout not found.');
  res.json({ workout: hydrate([log])[0] });
});

function normaliseSets(input, userId, date) {
  const sets = Array.isArray(input) ? input : [];
  return sets.slice(0, 200).map((s, i) => {
    const ex = getExerciseById(s.exercise_id, userId) || null;
    return {
      user_id: userId,
      date,
      exercise_id: String(s.exercise_id || ex?.id || `custom_${i}`),
      exercise_name: String(s.exercise_name || ex?.name || 'Exercise'),
      set_number: Math.round(clamp(Number(s.set_number) || i + 1, 1, 99)),
      reps: Math.round(clamp(Number(s.reps) || 0, 0, 200)),
      weight_kg: clamp(Number(s.weight_kg) || 0, 0, 600),
      rpe: s.rpe == null || s.rpe === '' ? null : clamp(Number(s.rpe), 1, 10),
      tempo: String(s.tempo || '').slice(0, 12),
      rest_s: Math.round(clamp(Number(s.rest_s) || 90, 0, 900)),
      is_warmup: s.is_warmup ? 1 : 0,
    };
  });
}

router.post('/workouts', (req, res) => {
  const b = req.body || {};
  if (b.date !== undefined && !validDate(b.date)) throw new ApiError(400, 'date must be a real date in YYYY-MM-DD form.');
  const date = validDate(b.date) ? b.date : today();
  const sets = normaliseSets(b.sets, req.user.id, date);

  const id = tx(() => {
    const { lastInsertRowid } = run(
      `INSERT INTO workout_logs (user_id, date, name, focus, duration_s, calories, rpe, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, date,
      String(b.name || 'Workout').slice(0, 80),
      String(b.focus || 'full_body').slice(0, 30),
      Math.round(clamp(Number(b.duration_s) || 0, 0, 43200)),
      Math.round(clamp(Number(b.calories) || 0, 0, 5000)),
      b.rpe == null || b.rpe === '' ? null : clamp(Number(b.rpe), 1, 10),
      String(b.notes || '').slice(0, 1000)
    );
    const logId = Number(lastInsertRowid);
    for (const s of sets) {
      run(
        `INSERT INTO sets (log_id, user_id, date, exercise_id, exercise_name, set_number, reps, weight_kg, rpe, tempo, rest_s, is_warmup)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        logId, s.user_id, s.date, s.exercise_id, s.exercise_name, s.set_number, s.reps,
        s.weight_kg, s.rpe, s.tempo, s.rest_s, s.is_warmup
      );
    }
    return logId;
  });

  const log = get('SELECT * FROM workout_logs WHERE id = ?', id);
  res.status(201).json({ workout: hydrate([log])[0] });
});

router.put('/workouts/:id', (req, res) => {
  const existing = get('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!existing) throw new ApiError(404, 'Workout not found.');
  const b = req.body || {};
  run(
    `UPDATE workout_logs SET
       date = COALESCE(?, date), name = COALESCE(?, name), focus = COALESCE(?, focus),
       duration_s = COALESCE(?, duration_s), calories = COALESCE(?, calories),
       rpe = ?, notes = COALESCE(?, notes)
     WHERE id = ?`,
    b.date !== undefined && b.date !== '' ? (validDate(b.date) ? b.date : (() => { throw new ApiError(400, 'date must be YYYY-MM-DD.'); })()) : null,
    b.name !== undefined ? String(b.name).slice(0, 80) : null,
    b.focus !== undefined ? String(b.focus).slice(0, 30) : null,
    b.duration_s !== undefined ? Math.round(clamp(Number(b.duration_s), 0, 43200)) : null,
    b.calories !== undefined ? Math.round(clamp(Number(b.calories), 0, 5000)) : null,
    b.rpe === undefined ? existing.rpe : (b.rpe === '' || b.rpe == null ? null : clamp(Number(b.rpe), 1, 10)),
    b.notes !== undefined ? String(b.notes).slice(0, 1000) : null,
    existing.id
  );
  if (b.date) run('UPDATE sets SET date = ? WHERE log_id = ?', String(b.date).slice(0, 10), existing.id);
  if (Array.isArray(b.sets)) {
    tx(() => {
      run('DELETE FROM sets WHERE log_id = ?', existing.id);
      const newDate = b.date ? String(b.date).slice(0, 10) : existing.date;
      for (const s of normaliseSets(b.sets, req.user.id, newDate)) {
        run(
          `INSERT INTO sets (log_id, user_id, date, exercise_id, exercise_name, set_number, reps, weight_kg, rpe, tempo, rest_s, is_warmup)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          existing.id, s.user_id, s.date, s.exercise_id, s.exercise_name, s.set_number, s.reps,
          s.weight_kg, s.rpe, s.tempo, s.rest_s, s.is_warmup
        );
      }
    });
  }
  const log = get('SELECT * FROM workout_logs WHERE id = ?', existing.id);
  res.json({ workout: hydrate([log])[0] });
});

router.delete('/workouts/:id', (req, res) => {
  const { changes } = run('DELETE FROM workout_logs WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!changes) throw new ApiError(404, 'Workout not found.');
  res.json({ ok: true, deleted: changes });
});

router.post('/workouts/:id/sets', (req, res) => {
  const log = get('SELECT * FROM workout_logs WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!log) throw new ApiError(404, 'Workout not found.');
  const [s] = normaliseSets([req.body || {}], req.user.id, log.date);
  const { lastInsertRowid } = run(
    `INSERT INTO sets (log_id, user_id, date, exercise_id, exercise_name, set_number, reps, weight_kg, rpe, tempo, rest_s, is_warmup)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    log.id, s.user_id, s.date, s.exercise_id, s.exercise_name, s.set_number, s.reps,
    s.weight_kg, s.rpe, s.tempo, s.rest_s, s.is_warmup
  );
  res.status(201).json({ set: get('SELECT * FROM sets WHERE id = ?', Number(lastInsertRowid)) });
});

router.delete('/sets/:id', (req, res) => {
  const { changes } = run(
    `DELETE FROM sets WHERE id = ? AND user_id = ?`, Number(req.params.id), req.user.id);
  if (!changes) throw new ApiError(404, 'Set not found.');
  res.json({ ok: true });
});

/** Suggested session from the active AI/engine plan for the requested date. */
router.get('/next', (req, res) => {
  const date = queryDate(req.query.date, today());
  const planRow = get(
    `SELECT * FROM ai_plans WHERE user_id = ? AND kind = 'training' AND active = 1 ORDER BY id DESC LIMIT 1`,
    req.user.id
  );
  const plan = planRow ? parseJson(planRow.payload, null) : null;
  if (!plan?.schedule?.length) {
    return res.json({ date, plan: null, session: null, message: 'No active training plan yet.' });
  }
  const weekdayIndex = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const done = all(
    `SELECT date, focus FROM workout_logs WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 20`,
    req.user.id, date
  );
  const lastFocus = done.find((d) => d.date < date)?.focus;
  const order = plan.schedule.map((d) => d.focus);
  let idx = weekdayIndex % plan.schedule.length;
  if (lastFocus) {
    const last = order.indexOf(lastFocus);
    if (last >= 0) idx = (last + 1) % order.length;
  }
  const session = plan.schedule[idx];

  // last performed load for every exercise in the session -> instant targets
  const history = {};
  for (const ex of session.exercises) {
    const row = get(
      `SELECT weight_kg, reps, date FROM sets
       WHERE user_id = ? AND exercise_id = ? AND is_warmup = 0 AND weight_kg > 0
       ORDER BY date DESC, id DESC LIMIT 1`,
      req.user.id, ex.exercise_id
    );
    history[ex.exercise_id] = row || null;
  }

  res.json({
    date,
    plan: { id: planRow.id, name: plan.meta?.name, source: plan.meta?.source, created_at: planRow.created_at },
    session: { ...session, last_performance: history },
  });
});

/* --------------------------- custom exercises --------------------------- */

router.get('/custom-exercises', (req, res) => {
  res.json({ exercises: getUserCustomExercises(req.user.id) });
});

router.post('/custom-exercises', (req, res) => {
  try {
    const exercise = createCustomExercise(req.user.id, req.body || {});
    res.status(201).json({ ok: true, exercise });
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

router.delete('/custom-exercises/:id', (req, res) => {
  const deleted = deleteCustomExercise(req.user.id, req.params.id);
  if (!deleted) throw new ApiError(404, 'Custom exercise not found.');
  res.json({ ok: true, deleted: true });
});

export default router;
