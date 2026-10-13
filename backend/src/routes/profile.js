import { Router } from 'express';
import { get, run } from '../db.js';
import { auth, touchProfile } from '../middleware/auth.js';
import {
  macroTargets, tdee, bmr, bmi, calorieTarget, weeklyRate, ageFrom, clamp, round, GOALS, ACTIVITY_FACTORS,
} from '../services/nutrition.js';

const router = Router();
router.use(auth);

const FIELDS = {
  sex: (v) => ['male', 'female', 'other'].includes(v) ? v : undefined,
  birth_date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : undefined,
  height_cm: (v) => v === '' || v == null ? null : clamp(Number(v), 120, 230),
  weight_kg: (v) => v === '' || v == null ? null : clamp(Number(v), 35, 250),
  body_fat_pct: (v) => v === '' || v == null ? null : clamp(Number(v), 3, 60),
  target_weight_kg: (v) => v === '' || v == null ? null : clamp(Number(v), 35, 250),
  activity_level: (v) => ACTIVITY_FACTORS[v] ? v : undefined,
  goal: (v) => GOALS[v] ? v : undefined,
  experience: (v) => ['beginner', 'intermediate', 'advanced'].includes(v) ? v : undefined,
  days_per_week: (v) => Math.round(clamp(Number(v) || 4, 1, 7)),
  session_minutes: (v) => Math.round(clamp(Number(v) || 60, 20, 180)),
  equipment: (v) => ['full_gym', 'barbell_and_dumbbell', 'dumbbell_only', 'home_bodyweight', 'machines_cables'].includes(v) ? v : undefined,
  injuries: (v) => String(v || '').slice(0, 300),
  diet_pref: (v) => ['omnivore', 'vegetarian', 'vegan', 'pescatarian'].includes(v) ? v : undefined,
  allergies: (v) => String(v || '').slice(0, 300),
  focus_areas: (v) => String(v || '').slice(0, 300),
  sleep_hours: (v) => clamp(Number(v) || 7, 3, 12),
  notes: (v) => String(v || '').slice(0, 1000),
};

router.get('/', (req, res) => {
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id) || {};
  const p = { ...profile, age: ageFrom(profile.birth_date) };
  res.json({
    profile,
    derived: {
      age: p.age,
      bmr: p.weight_kg ? round(bmr(p)) : null,
      tdee: p.weight_kg ? tdee(p) : null,
      calorie_target: p.weight_kg ? calorieTarget(p) : null,
      macros: p.weight_kg ? macroTargets(p) : null,
      bmi: p.weight_kg && p.height_cm ? bmi(p) : null,
      weekly_rate: p.weight_kg ? weeklyRate(p) : null,
      protein_per_kg: p.weight_kg ? round(macroTargets(p).protein_g / p.weight_kg, 2) : null,
    },
    options: {
      goals: Object.entries(GOALS).map(([id, g]) => ({ id, label: g.label, rate: g.rate })),
      activity_levels: Object.keys(ACTIVITY_FACTORS),
      experience: ['beginner', 'intermediate', 'advanced'],
      equipment: ['full_gym', 'barbell_and_dumbbell', 'dumbbell_only', 'home_bodyweight', 'machines_cables'],
      diet_prefs: ['omnivore', 'vegetarian', 'vegan', 'pescatarian'],
    },
  });
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const updates = {};
  for (const [key, cast] of Object.entries(FIELDS)) {
    if (!(key in body)) continue;
    const value = cast(body[key]);
    if (value !== undefined) updates[key] = value;
  }
  if (!Object.keys(updates).length) return res.json({ ok: true, changed: 0 });

  const keys = Object.keys(updates);
  run(
    `INSERT INTO profiles (user_id, ${keys.join(', ')})
     VALUES (?, ${keys.map(() => '?').join(', ')})
     ON CONFLICT(user_id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`,
    req.user.id, ...keys.map((k) => updates[k])
  );
  touchProfile(req.user.id);

  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id);
  res.json({ ok: true, changed: keys.length, profile, derived: { macros: macroTargets(profile), tdee: tdee(profile) } });
});

/** Quick onboarding: everything the AI needs, in one call. */
router.post('/onboard', (req, res) => {
  const b = req.body || {};
  const merged = { ...b };
  const updates = {};
  for (const [key, cast] of Object.entries(FIELDS)) {
    if (!(key in merged)) continue;
    const value = cast(merged[key]);
    if (value !== undefined) updates[key] = value;
  }
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'invalid_request', message: 'Nothing to save.' });
  run(
    `INSERT INTO profiles (user_id, ${keys.join(', ')})
     VALUES (?, ${keys.map(() => '?').join(', ')})
     ON CONFLICT(user_id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = datetime('now')`,
    req.user.id, ...keys.map((k) => updates[k])
  );
  if (b.weight_kg) {
    const d = new Date().toISOString().slice(0, 10);
    run(
      `INSERT INTO metrics (user_id, date, weight_kg) VALUES (?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`,
      req.user.id, d, clamp(Number(b.weight_kg), 35, 250)
    );
  }
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id);
  res.json({ ok: true, profile, derived: { macros: macroTargets(profile), tdee: tdee(profile) } });
});

export default router;
