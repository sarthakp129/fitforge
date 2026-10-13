/**
 * Exercise science helpers. Deterministic, offline, unit-safe (kg / cm).
 */

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

export const GOALS = {
  fat_loss: { kcalMultiplier: 0.8, label: 'Fat loss', rate: '0.5-0.8% bodyweight / week' },
  recomp: { kcalMultiplier: 0.95, label: 'Body recomposition', rate: 'weight stable, strength up' },
  maintain: { kcalMultiplier: 1.0, label: 'Maintenance', rate: 'hold weight' },
  muscle_gain: { kcalMultiplier: 1.12, label: 'Lean muscle gain', rate: '0.25-0.5% bodyweight / week' },
  strength: { kcalMultiplier: 1.05, label: 'Strength', rate: 'small surplus' },
  endurance: { kcalMultiplier: 1.1, label: 'Endurance', rate: 'fuel high volume' },
};

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
export const round = (n, p = 0) => {
  const f = 10 ** p;
  return Math.round((Number(n) || 0) * f) / f;
};

export function ageFrom(birthDate) {
  if (!birthDate) return 30;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return 30;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return clamp(age, 14, 95);
}

/** Mifflin-St Jeor BMR (kcal/day). */
export function bmr({ sex = 'other', weight_kg, height_cm, birth_date }) {
  const w = clamp(weight_kg, 35, 250);
  const h = clamp(height_cm, 120, 230);
  const a = ageFrom(birth_date);
  const base = 10 * w + 6.25 * h - 5 * a;
  if (sex === 'male') return round(base + 5);
  if (sex === 'female') return round(base - 161);
  return round(base - 78); // average of the two equations
}

export function tdee(profile) {
  const factor = ACTIVITY_FACTORS[profile.activity_level] || 1.55;
  return round(bmr(profile) * factor);
}

export function calorieTarget(profile) {
  const base = tdee(profile);
  const g = GOALS[profile.goal] || GOALS.recomp;
  return round(base * g.kcalMultiplier, -1);
}

/** Protein / carbs / fat in grams. */
export function macroTargets(profile) {
  const kcal = calorieTarget(profile);
  const w = clamp(profile.weight_kg, 35, 250);
  const goal = profile.goal || 'recomp';

  const proteinPerKg =
    goal === 'fat_loss' ? 2.2 : goal === 'muscle_gain' || goal === 'strength' ? 1.9 : goal === 'endurance' ? 1.5 : 1.8;
  const fatPerKg = goal === 'fat_loss' ? 0.85 : 0.95;

  const protein_g = round(proteinPerKg * w);
  const fat_g = round(fatPerKg * w);
  const remaining = kcal - protein_g * 4 - fat_g * 9;
  const carbs_g = round(Math.max(60, remaining / 4));

  return {
    calories: kcal,
    protein_g,
    carbs_g,
    fat_g,
    fiber_g: round(clamp(w * 0.35, 25, 45)),
    water_l: round(clamp(w * 0.035, 2, 5), 1),
  };
}

/** Epley 1RM estimate from a logged set. */
export function estimatedOneRM(weight_kg, reps) {
  if (!weight_kg || !reps) return 0;
  if (reps === 1) return round(weight_kg, 1);
  return round(weight_kg * (1 + reps / 30), 1);
}

/** Wilks-style relative strength score (0-100ish) for the dashboard. */
export function strengthScore(profile, lifts = {}) {
  const bw = clamp(profile.weight_kg, 35, 250);
  const total =
    (lifts.squat || 0) + (lifts.bench || 0) + (lifts.deadlift || 0);
  if (!total) return 0;
  return round(total / bw, 2);
}

export function bmi(profile) {
  const h = clamp(profile.height_cm, 120, 230) / 100;
  return round(clamp(profile.weight_kg, 35, 250) / (h * h), 1);
}

export function weeklyRate(profile) {
  const w = clamp(profile.weight_kg, 35, 250);
  const goal = profile.goal || 'recomp';
  if (goal === 'fat_loss') return round(-w * 0.007, 2);
  if (goal === 'muscle_gain') return round(w * 0.0035, 2);
  if (goal === 'strength') return round(w * 0.0015, 2);
  return 0;
}
