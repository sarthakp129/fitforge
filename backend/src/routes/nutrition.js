import { Router } from 'express';
import { all, get, run, today, tx } from '../db.js';
import { auth, optionalAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { clamp, round } from '../services/nutrition.js';
import { FOODS } from '../services/planEngine.js';
import {
  searchFoods,
  getFoodByIdOrName,
  createCustomFood,
  deleteCustomFood,
  getUserCustomFoods,
} from '../services/foodService.js';
import { validDate, queryDate } from '../lib/validate.js';
import { estimateFoodMacros } from '../services/aiService.js';

const router = Router();

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout'];

/* ----------------------------- food database ---------------------------- */

router.get('/foods', optionalAuth, async (req, res, next) => {
  try {
    const result = await searchFoods({
      query: req.query.q,
      category: req.query.category,
      barcode: req.query.barcode,
      userId: req.user?.id || null,
      limit: Math.min(200, Math.max(1, Number(req.query.limit) || 200)),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.use(auth);

/* ------------------------------ estimation ------------------------------ */

router.post('/estimate', async (req, res, next) => {
  try {
    const { food_name, grams } = req.body || {};
    if (!food_name || !String(food_name).trim()) throw new ApiError(400, 'food_name is required.');
    const estimate = await estimateFoodMacros(food_name, grams, { userId: req.user.id });
    res.json({ estimate });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- logging ------------------------------ */

function macrosFromFood(food, grams) {
  const g = clamp(Number(grams) || 0, 1, 5000);
  return {
    grams: g,
    calories: round((food.kcal / 100) * g, 1),
    protein_g: round((food.protein_g / 100) * g, 1),
    carbs_g: round((food.carbs_g / 100) * g, 1),
    fat_g: round((food.fat_g / 100) * g, 1),
  };
}

router.post('/log', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.date !== undefined && !validDate(b.date)) throw new ApiError(400, 'date must be a real date in YYYY-MM-DD form.');
    const date = validDate(b.date) ? b.date : today();
    const meal = MEALS.includes(b.meal_type) ? b.meal_type : 'snack';
    const name = String(b.food_name || '').trim().slice(0, 120);
    if (!name) throw new ApiError(400, 'food_name is required.');

    const known = getFoodByIdOrName(name, req.user.id);

    let values;
    let source = String(b.source || '').slice(0, 20);
    if (b.calories != null && Number(b.calories) > 0) {
      values = {
        grams: clamp(Number(b.grams) || known?.serving_g || 100, 1, 5000),
        calories: round(Number(b.calories), 1),
        protein_g: round(Number(b.protein_g) || 0, 1),
        carbs_g: round(Number(b.carbs_g) || 0, 1),
        fat_g: round(Number(b.fat_g) || 0, 1),
      };
      if (!source) source = known ? 'database' : 'manual';
    } else if (known) {
      values = macrosFromFood(known, b.grams ?? known.serving_g);
      if (!source) source = 'database';
    } else if (b.grams != null || b.auto_estimate) {
      // Auto-estimate arbitrary foods via AI when user enters food name and grams
      const est = await estimateFoodMacros(name, b.grams || 100, { userId: req.user.id });
      values = {
        grams: est.grams,
        calories: est.calories,
        protein_g: est.protein_g,
        carbs_g: est.carbs_g,
        fat_g: est.fat_g,
      };
      source = est.source || 'ai_estimate';
    } else {
      throw new ApiError(400, 'Provide calories/macros, grams for AI estimation, or choose a food from the database.');
    }

    const { lastInsertRowid } = run(
      `INSERT INTO nutrition_logs (user_id, date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, date, meal, name, values.grams, values.calories,
      values.protein_g, values.carbs_g, values.fat_g, source
    );
    res.status(201).json({ entry: get('SELECT * FROM nutrition_logs WHERE id = ?', Number(lastInsertRowid)) });
  } catch (err) {
    next(err);
  }
});

/** Log many entries at once (used by "apply this meal plan to today"). */
router.post('/log-batch', (req, res) => {
  const b = req.body || {};
  if (b.date !== undefined && !validDate(b.date)) throw new ApiError(400, 'date must be a real date in YYYY-MM-DD form.');
  const date = validDate(b.date) ? b.date : today();
  const items = Array.isArray(b.items) ? b.items.slice(0, 100) : [];
  const created = tx(() => {
    const ids = [];
    for (const item of items) {
      const name = String(item.food_name || '').trim().slice(0, 120);
      if (!name) continue;
      const known = getFoodByIdOrName(name, req.user.id);
      const values = item.calories > 0
        ? {
            grams: clamp(Number(item.grams) || 100, 1, 5000),
            calories: round(Number(item.calories) || 0, 1),
            protein_g: round(Number(item.protein_g) || 0, 1),
            carbs_g: round(Number(item.carbs_g) || 0, 1),
            fat_g: round(Number(item.fat_g) || 0, 1),
          }
        : known
          ? macrosFromFood(known, item.grams ?? known.serving_g)
          : null;
      if (!values) continue;
      const { lastInsertRowid } = run(
        `INSERT INTO nutrition_logs (user_id, date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user.id, date, MEALS.includes(item.meal_type) ? item.meal_type : 'snack',
        name, values.grams, values.calories, values.protein_g, values.carbs_g, values.fat_g,
        String(item.source || 'plan').slice(0, 20)
      );
      ids.push(Number(lastInsertRowid));
    }
    return ids;
  });
  res.status(201).json({ created: created.length, ids: created });
});

router.delete('/log/:id', (req, res) => {
  const { changes } = run('DELETE FROM nutrition_logs WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!changes) throw new ApiError(404, 'Entry not found.');
  res.json({ ok: true });
});

/* ----------------------------- custom foods ----------------------------- */

router.get('/custom-foods', (req, res) => {
  res.json({ foods: getUserCustomFoods(req.user.id) });
});

router.post('/custom-foods', (req, res) => {
  try {
    const food = createCustomFood(req.user.id, req.body || {});
    res.status(201).json({ ok: true, food });
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

router.delete('/custom-foods/:id', (req, res) => {
  const deleted = deleteCustomFood(req.user.id, req.params.id);
  if (!deleted) throw new ApiError(404, 'Custom food not found.');
  res.json({ ok: true, deleted: true });
});

router.get('/daily', (req, res) => {
  const date = queryDate(req.query.date, today());
  const entries = all(
    'SELECT * FROM nutrition_logs WHERE user_id = ? AND date = ? ORDER BY id', req.user.id, date);
  const totals = entries.reduce(
    (a, e) => ({
      calories: a.calories + e.calories,
      protein_g: a.protein_g + e.protein_g,
      carbs_g: a.carbs_g + e.carbs_g,
      fat_g: a.fat_g + e.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
  const byMeal = {};
  for (const m of MEALS) byMeal[m] = [];
  for (const e of entries) (byMeal[e.meal_type] ||= []).push(e);

  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id);
  res.json({ date, entries, by_meal: byMeal, totals: roundAll(totals), profile });
});

const roundAll = (t) => ({
  calories: round(t.calories),
  protein_g: round(t.protein_g, 1),
  carbs_g: round(t.carbs_g, 1),
  fat_g: round(t.fat_g, 1),
});

router.get('/range', (req, res) => {
  const days = clamp(Number(req.query.days) || 14, 1, 365);
  const rows = all(
    `SELECT date,
            SUM(calories) AS calories, SUM(protein_g) AS protein_g,
            SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g, COUNT(*) AS entries
     FROM nutrition_logs WHERE user_id = ? AND date >= date('now', ?)
     GROUP BY date ORDER BY date`,
    req.user.id, `-${days} day`
  );
  res.json({ days, series: rows.map((r) => ({ ...r, calories: round(r.calories) })) });
});

router.post('/copy-day', (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) throw new ApiError(400, 'Both "from" and "to" dates are required.');
  if (!validDate(from) || !validDate(to)) throw new ApiError(400, 'from/to must be real dates in YYYY-MM-DD form.');
  const src = all('SELECT * FROM nutrition_logs WHERE user_id = ? AND date = ?', req.user.id, String(from).slice(0, 10));
  if (!src.length) throw new ApiError(404, 'Nothing logged on the source date.');
  const n = tx(() => {
    let count = 0;
    for (const e of src) {
      run(
        `INSERT INTO nutrition_logs (user_id, date, meal_type, food_name, grams, calories, protein_g, carbs_g, fat_g, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'copied')`,
        req.user.id, to, e.meal_type, e.food_name, e.grams,
        e.calories, e.protein_g, e.carbs_g, e.fat_g
      );
      count++;
    }
    return count;
  });
  res.json({ ok: true, copied: n });
});

export default router;
