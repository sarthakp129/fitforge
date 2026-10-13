/**
 * seed.js — creates the public DEMO account with a fully-populated athlete.
 *
 *   npm run seed          (or: node scripts/seed.js)
 *
 * Demo credentials are intentionally public:  xyz@gmail.com / xyz
 * SECURITY: the server auto-runs this ONLY when NODE_ENV != production or
 * DEMO_ACCOUNT=true (see src/index.js). On a public deployment keep it off;
 * a known password on a live box is a backdoor, not a feature.
 *
 * The seed is idempotent: re-running wipes and rebuilds ONLY the demo user's
 * rows, so the demo always looks fresh without touching real accounts.
 */
import { get, run, db } from '../src/db.js';
import { hashPassword } from '../src/lib/crypto.js';
import { buildTrainingPlan, buildNutritionPlan, FOODS, EXERCISES } from '../src/services/planEngine.js';

export const DEMO_EMAIL = 'xyz@gmail.com';
export const DEMO_PASSWORD = 'xyz';

const DEMO_PROFILE = {
  sex: 'male', birth_date: '1993-04-12', height_cm: 178, weight_kg: 79.5,
  body_fat_pct: 15, target_weight_kg: 77, activity_level: 'moderate',
  goal: 'recomp', experience: 'intermediate', days_per_week: 4,
  session_minutes: 60, equipment: 'full_gym', injuries: '',
  diet_pref: 'omnivore', allergies: '', focus_areas: 'chest, back',
  sleep_hours: 7, notes: 'Demo athlete — all data is sample data.',
};

const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

/** deterministic pseudo-random so every seed looks the same (testable) */
let seedState = 42;
const rnd = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};

const SESSIONS = [
  { focus: 'push', name: 'Push A', ex: [['bench_press', 100], ['incline_db_press', 32], ['overhead_press', 50], ['lateral_raise', 12], ['tricep_pushdown', 30]] },
  { focus: 'pull', name: 'Pull A', ex: [['barbell_row', 80], ['lat_pulldown', 60], ['face_pull', 25], ['hammer_curl', 16]] },
  { focus: 'legs', name: 'Legs', ex: [['back_squat', 140], ['romanian_deadlift', 110], ['leg_press', 180], ['standing_calf_raise', 60]] },
  { focus: 'upper', name: 'Upper', ex: [['bench_press', 95], ['seated_cable_row', 65], ['db_shoulder_press', 26], ['db_curl', 14]] },
];

const FOOD_DAY = [
  ['breakfast', 'Greek yogurt 0%', 250], ['breakfast', 'Oats, dry', 70],
  ['lunch', 'Chicken breast, skinless (cooked)', 180], ['lunch', 'White rice (cooked)', 220],
  ['dinner', 'Salmon (cooked)', 150], ['dinner', 'Potato, boiled', 250], ['dinner', 'Broccoli', 150],
  ['snack', 'Almonds', 25],
];

export function seedDemo({ verbose = true } = {}) {
  seedState = 42;
  let existing = get('SELECT id FROM users WHERE email = ?', DEMO_EMAIL);
  let userId;

  if (existing) {
    userId = existing.id;
    // wipe only the demo user's activity so re-seeding stays fresh
    run('DELETE FROM sets WHERE user_id = ?', userId);
    run('DELETE FROM workout_logs WHERE user_id = ?', userId);
    run('DELETE FROM nutrition_logs WHERE user_id = ?', userId);
    run('DELETE FROM metrics WHERE user_id = ?', userId);
    run('DELETE FROM ai_plans WHERE user_id = ?', userId);
    run('DELETE FROM chat_messages WHERE user_id = ?', userId);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(DEMO_PASSWORD), userId);
  } else {
    const r = run(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      DEMO_EMAIL, 'Demo Athlete', hashPassword(DEMO_PASSWORD)
    );
    userId = r.lastInsertRowid;
    run('INSERT INTO profiles (user_id) VALUES (?)', userId);
  }

  run(
    `UPDATE profiles SET sex=?, birth_date=?, height_cm=?, weight_kg=?, body_fat_pct=?, target_weight_kg=?,
       activity_level=?, goal=?, experience=?, days_per_week=?, session_minutes=?, equipment=?,
       injuries=?, diet_pref=?, allergies=?, focus_areas=?, sleep_hours=?, notes=?, updated_at=datetime('now')
     WHERE user_id=?`,
    DEMO_PROFILE.sex, DEMO_PROFILE.birth_date, DEMO_PROFILE.height_cm, DEMO_PROFILE.weight_kg,
    DEMO_PROFILE.body_fat_pct, DEMO_PROFILE.target_weight_kg, DEMO_PROFILE.activity_level,
    DEMO_PROFILE.goal, DEMO_PROFILE.experience, DEMO_PROFILE.days_per_week, DEMO_PROFILE.session_minutes,
    DEMO_PROFILE.equipment, DEMO_PROFILE.injuries, DEMO_PROFILE.diet_pref, DEMO_PROFILE.allergies,
    DEMO_PROFILE.focus_areas, DEMO_PROFILE.sleep_hours, DEMO_PROFILE.notes, userId
  );

  /* weigh-ins: 12 weeks of slow recomp */
  let metrics = 0;
  for (let w = 11; w >= 0; w--) {
    run(
      `INSERT INTO metrics (user_id, date, weight_kg, body_fat_pct) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct`,
      userId, day(w * 7), Math.round((81.6 - (11 - w) * 0.19) * 10) / 10, Math.round((16.4 - (11 - w) * 0.12) * 10) / 10
    );
    metrics++;
  }

  /* six weeks of sessions with honest progressive overload */
  let workouts = 0; let sets = 0;
  for (let w = 5; w >= 0; w--) {
    for (let d = 0; d < 4; d++) {
      if (w === 0 && d > 2) continue; // this week is still in progress
      const offset = w * 7 + (6 - d * 2);
      const s = SESSIONS[d % SESSIONS.length];
      const log = run(
        `INSERT INTO workout_logs (user_id, date, name, focus, duration_s, rpe, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        userId, day(offset), s.name, s.focus, 3300 + Math.round(rnd() * 900),
        7 + Math.round(rnd() * 2), w === 0 ? 'Bar speed good on the top sets.' : ''
      );
      workouts++;
      const progress = (5 - w) * 1.25; // kg added across the block
      s.ex.forEach(([exId, base]) => {
        const exName = EXERCISES.find((e) => e.id === exId)?.name || exId;
        for (let setN = 1; setN <= 3; setN++) {
          const weight = Math.round((base + progress + (setN === 3 ? -2.5 : 0)) * 2) / 2;
          run(
            `INSERT INTO sets (log_id, user_id, date, exercise_id, exercise_name, set_number, reps, weight_kg, rpe, rest_s, is_warmup)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            log.lastInsertRowid, userId, day(offset), exId, exName,
            setN, 8 - (setN === 3 ? 1 : 0), weight, 7 + (setN === 3 ? 1 : 0), 120
          );
          sets++;
        }
      });
    }
  }

  /* ten days of food logging */
  let meals = 0;
  for (let d = 9; d >= 0; d--) {
    for (const [meal, food, grams] of FOOD_DAY) {
      const f = FOODS.find((x) => x.name === food);
      const g = Math.round((grams * (0.9 + rnd() * 0.25)) / 5) * 5;
      const r1 = (n) => Math.round(n * 10) / 10;
      run(
        `INSERT INTO nutrition_logs (user_id, date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')`,
        userId, day(d), meal, food, g,
        Math.round((f.kcal / 100) * g), r1((f.protein_g / 100) * g),
        r1((f.carbs_g / 100) * g), r1((f.fat_g / 100) * g)
      );
      meals++;
    }
  }

  /* active plans from the deterministic engine */
  const tPlan = buildTrainingPlan({ ...DEMO_PROFILE, age: 33 }, { weeks: 4 });
  const nPlan = buildNutritionPlan({ ...DEMO_PROFILE, age: 33 });
  const tp = run(
    `INSERT INTO ai_plans (user_id, kind, title, payload, model, source, tokens, active) VALUES (?, 'training', ?, ?, '', 'engine', 0, 1)`,
    userId, tPlan.meta.name, JSON.stringify(tPlan)
  );
  run(`INSERT INTO ai_plans (user_id, kind, title, payload, model, source, tokens, active) VALUES (?, 'nutrition', ?, ?, '', 'engine', 0, 1)`,
    userId, nPlan.meta.name, JSON.stringify(nPlan));
  void tp;

  run('INSERT INTO chat_messages (user_id, session_id, role, content) VALUES (?, ?, ?, ?)',
    userId, 'default', 'user', 'My bench has been stuck for three weeks — what do I change?');
  run('INSERT INTO chat_messages (user_id, session_id, role, content, tokens) VALUES (?, ?, ?, ?, 0)',
    userId, 'default', 'assistant',
    'Three weeks flat at 100 kg means the top set is already a grind. Run 5×5 at 87.5 kg for two weeks, keep protein at 143 g, then retest. Add one pause-rep set per week and keep RPE at 8.');

  const summary = { userId, workouts, sets, meals, metrics, plans: 2 };
  if (verbose) {
    console.log('');
    console.log('  FitForge demo account seeded');
    console.log(`  login    ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
    console.log(`  data     ${workouts} workouts · ${sets} sets · ${meals} food logs · ${metrics} weigh-ins · 2 active plans`);
    console.log('');
  }
  return summary;
}

/* run directly: node scripts/seed.js */
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemo({ verbose: true });
  db.close?.();
  process.exit(0);
}
