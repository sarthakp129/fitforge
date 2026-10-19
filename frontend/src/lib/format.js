export const todayISO = () => new Date().toISOString().slice(0, 10);
export const shiftDays = (n, from = new Date()) =>
  new Date(from.getTime() + n * 86400000).toISOString().slice(0, 10);

export const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, opts);
};

export const fmtDateTime = (s) => {
  if (!s) return '';
  const d = new Date(String(s).includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const relativeDay = (iso) => {
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === shiftDays(-1)) return 'Yesterday';
  if (iso === shiftDays(1)) return 'Tomorrow';
  return fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
};

export const nf = (n, digits = 0) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${nf(n, digits)}`;

export const compact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return nf(v);
};

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));

export const secondsToClock = (s) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export const durationLabel = (seconds) => {
  const m = Math.round((seconds || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export const weekdayOf = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
};

export const goalLabel = {
  fat_loss: 'Fat loss', recomp: 'Recomposition', maintain: 'Maintenance',
  muscle_gain: 'Muscle gain', strength: 'Strength', endurance: 'Endurance',
};

export const equipmentLabel = {
  full_gym: 'Full gym', barbell_and_dumbbell: 'Barbell + dumbbells',
  dumbbell_only: 'Dumbbells only', home_bodyweight: 'Home / bodyweight',
  machines_cables: 'Machines + cables',
};

export const dietLabel = {
  omnivore: 'Omnivore', vegetarian: 'Vegetarian', vegan: 'Vegan', pescatarian: 'Pescatarian',
};

export const activityLabel = {
  sedentary: 'Sedentary (desk, little movement)',
  light: 'Lightly active (1-2 sessions/wk)',
  moderate: 'Moderately active (3-5 sessions/wk)',
  active: 'Very active (6-7 sessions/wk)',
  athlete: 'Athlete (2×/day or physical job)',
};

export const dateForAge = (age) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - Number(age));
  return d.toISOString().slice(0, 10);
};

export const ageFromDate = (iso) => {
  if (!iso) return 25;
  const b = new Date(iso);
  if (Number.isNaN(b.getTime())) return 25;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return Math.min(95, Math.max(14, a));
};

export const titleCase = (s) =>
  String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const GOAL_SENTENCE = {
  fat_loss: 'Aim for a slow, measurable cut — about 0.5-0.8% of bodyweight per week.',
  muscle_gain: 'Aim for lean gain — about 0.25-0.5% of bodyweight per week.',
  strength: 'A small surplus, spent on getting stronger.',
  recomp: 'Weight stays roughly flat while composition changes.',
  maintain: 'Weight holds; performance climbs.',
  endurance: 'Calories fuel volume, not the scale.',
};

/**
 * The engine's raw overview ends with "Target <goal> at roughly 0 kg/week…",
 * which reads badly for recomp/maintain goals. Rewrite that last sentence per
 * goal while keeping the real numbers the engine computed.
 */
export function humanOverview(plan) {
  const raw = plan?.overview || '';
  const base = raw.replace(/Target[^.]*\./, '').trim();
  const phrase = GOAL_SENTENCE[plan?.meta?.goal] || '';
  return base ? `${base}. ${phrase}`.replace('..', '.') : raw;
}

export const sourceChip = (source) => {
  if (source === 'ai' || source === 'cache') return { label: 'AI Personalized', cls: 'chip-ember' };
  return { label: 'Custom Plan', cls: 'chip-teal' };
};
