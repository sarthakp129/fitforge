/**
 * parseVoiceLog — turns a Whisper transcript into nutrition-log items.
 *
 * Deliberately deterministic (no AI): we match food aliases/names in the
 * sentence, take a "<number> grams|g" nearby when present, otherwise fall
 * back to the food's default serving, and pick a meal from keyword cues.
 * Everything it cannot map is reported back so the UI can show what was
 * heard instead of silently dropping it.
 *
 * @param {string} transcript raw Whisper text
 * @param {Array} foods the food database rows ({name, serving_g, category})
 * @returns {{items: Array<{food_name:string, grams:number, meal_type:string}>, meal_type:string, unmatched:string}}
 */

const ALIASES = {
  chicken: 'Chicken breast, skinless (cooked)',
  'chicken breast': 'Chicken breast, skinless (cooked)',
  'chicken thigh': 'Chicken thigh (cooked)',
  rice: 'White rice (cooked)',
  'brown rice': 'Brown rice (cooked)',
  basmati: 'Basmati rice (cooked)',
  yogurt: 'Greek yogurt 0%',
  curd: 'Greek yogurt 0%',
  dahi: 'Greek yogurt 0%',
  oats: 'Oats, dry',
  porridge: 'Oats, dry',
  eggs: 'Eggs, whole',
  egg: 'Eggs, whole',
  salmon: 'Salmon (cooked)',
  tuna: 'Tuna, canned in water',
  paneer: 'Paneer',
  milk: 'Whole milk',
  banana: 'Banana',
  apple: 'Apple',
  mango: 'Mango',
  almonds: 'Almonds',
  walnuts: 'Walnuts',
  'peanut butter': 'Peanut butter',
  dal: 'Lentils (cooked)',
  lentils: 'Lentils (cooked)',
  chickpeas: 'Chickpeas (cooked)',
  chana: 'Chickpeas (cooked)',
  rajma: 'Black beans (cooked)',
  bread: 'Wholegrain bread',
  roti: 'Wholegrain bread',
  chapati: 'Wholegrain bread',
  pasta: 'Pasta (cooked)',
  potato: 'Potato, boiled',
  'sweet potato': 'Sweet potato (cooked)',
  broccoli: 'Broccoli',
  spinach: 'Spinach',
  palak: 'Spinach',
  tomato: 'Tomato',
  avocado: 'Avocado',
  whey: 'Whey protein powder',
};

const MEAL_WORDS = [
  ['breakfast', 'breakfast'],
  ['brekkie', 'breakfast'],
  ['lunch', 'lunch'],
  ['dinner', 'dinner'],
  ['supper', 'dinner'],
  ['pre workout', 'pre_workout'],
  ['before training', 'pre_workout'],
  ['post workout', 'post_workout'],
  ['after training', 'post_workout'],
  ['snack', 'snack'],
];

const GRAMS_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:grams?|gms?|g\b)/;
// "<n> grams [of|for …]" appearing BEFORE the food name, e.g. "150 grams of chicken"
const GRAMS_BEFORE_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:grams?|gms?|g\b)(?:\s+(?:of|for)\s+[^0-9]*)?$/;

export function parseVoiceLog(transcript, foods = []) {
  const text = String(transcript || '').toLowerCase();
  const meal = MEAL_WORDS.find(([w]) => text.includes(w))?.[1] || 'snack';

  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  const resolve = (key) => {
    if (ALIASES[key] && byName.has(ALIASES[key].toLowerCase())) return byName.get(ALIASES[key].toLowerCase());
    // fall back to any database food whose first name segment contains the key
    return foods.find((f) => f.name.split(',')[0].toLowerCase().includes(key)) || null;
  };

  const seen = new Set();
  const items = [];
  const keys = Object.keys(ALIASES).sort((a, b) => b.length - a.length); // longest alias first
  for (const key of keys) {
    const at = text.indexOf(key);
    if (at === -1 || seen.has(key)) continue;
    const food = resolve(key);
    if (!food) continue;
    seen.add(key);
    // people say "150 grams of chicken" (number BEFORE) or "chicken, 150 grams"
    // (number AFTER) — check the preceding 40 chars first, then the following
    const before = text.slice(Math.max(0, at - 40), at).match(GRAMS_BEFORE_RE);
    const after = text.slice(at, at + key.length + 40).match(GRAMS_RE);
    const m = before || after;
    const grams = m ? Math.round(Number(m[1].replace(',', '.'))) : food.serving_g;
    if (items.some((i) => i.food_name === food.name)) continue;
    items.push({ food_name: food.name, grams: Math.min(2000, Math.max(5, grams)), meal_type: meal, at });
  }

  // present foods in the order they were spoken, not in alias-length order
  items.sort((a, b) => a.at - b.at);
  items.forEach((i) => delete i.at);

  return { items, meal_type: meal, unmatched: String(transcript || '').trim() };
}

export default parseVoiceLog;
