/**
 * Client-side mirror of backend/src/services/nutrition.js.
 *
 * WHY THIS FILE EXISTS: the onboarding summary must update while the user
 * drags a slider. Waiting for a server round-trip per drag made the panel
 * feel dead (and broken). These pure functions give instant feedback; the
 * server recomputes authoritatively on save, so a drift here would only ever
 * affect a preview number.
 *
 * KEEP IN SYNC with backend/src/services/nutrition.js — same formulas, same
 * constants. If you change one, change both (there is a test that compares
 * outputs, see backend/test/smoke.test.js "derived" assertions).
 */

export const ACTIVITY_FACTORS = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, athlete: 1.9,
};

export const GOALS = {
  fat_loss: { kcalMultiplier: 0.8, proteinPerKg: 2.2, fatPerKg: 0.85 },
  recomp: { kcalMultiplier: 0.95, proteinPerKg: 1.8, fatPerKg: 0.95 },
  maintain: { kcalMultiplier: 1.0, proteinPerKg: 1.8, fatPerKg: 0.95 },
  muscle_gain: { kcalMultiplier: 1.12, proteinPerKg: 1.9, fatPerKg: 0.95 },
  strength: { kcalMultiplier: 1.05, proteinPerKg: 1.9, fatPerKg: 0.95 },
  endurance: { kcalMultiplier: 1.1, proteinPerKg: 1.5, fatPerKg: 0.95 },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
const round = (n, p = 0) => {
  const f = 10 ** p;
  return Math.round((Number(n) || 0) * f) / f;
};

/** Mifflin-St Jeor BMR (kcal/day). */
export function bmr({ sex = 'male', weight_kg, height_cm, age = 30 }) {
  const base = 10 * clamp(weight_kg, 35, 250) + 6.25 * clamp(height_cm, 120, 230) - 5 * clamp(age, 14, 95);
  if (sex === 'female') return round(base - 161);
  return round(base + 5);
}

export function tdee(profile) {
  return round(bmr(profile) * (ACTIVITY_FACTORS[profile.activity_level] || 1.55));
}

export function calorieTarget(profile) {
  const g = GOALS[profile.goal] || GOALS.recomp;
  return round(tdee(profile) * g.kcalMultiplier, -1);
}

export function macroTargets(profile) {
  const kcal = calorieTarget(profile);
  const w = clamp(profile.weight_kg, 35, 250);
  const g = GOALS[profile.goal] || GOALS.recomp;
  const protein_g = round(g.proteinPerKg * w);
  const fat_g = round(g.fatPerKg * w);
  const carbs_g = round(Math.max(60, (kcal - protein_g * 4 - fat_g * 9) / 4));
  return {
    calories: kcal, protein_g, carbs_g, fat_g,
    fiber_g: round(clamp(w * 0.35, 25, 45)),
    water_l: round(clamp(w * 0.035, 2, 5), 1),
  };
}

export function bmi({ weight_kg, height_cm }) {
  const h = clamp(height_cm, 120, 230) / 100;
  return round(clamp(weight_kg, 35, 250) / (h * h), 1);
}

export function weeklyRate(profile) {
  const w = clamp(profile.weight_kg, 35, 250);
  if (profile.goal === 'fat_loss') return round(-w * 0.007, 2);
  if (profile.goal === 'muscle_gain') return round(w * 0.0035, 2);
  if (profile.goal === 'strength') return round(w * 0.0015, 2);
  return 0;
}
