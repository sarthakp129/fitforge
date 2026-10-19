/**
 * aiService — orchestrates Groq calls behind a token-frugal strategy.
 *
 * THE KEY IDEA for a ~1K-8K TPM free tier:
 *   The deterministic planEngine builds the *entire* plan locally for free.
 *   Groq is then asked only for a compact "personalisation overlay" (titles,
 *   notes, principles, exercise swaps with reasoning). That costs ~300 output
 *   tokens instead of ~1500 for a full plan, survives truncation, and can be
 *   merged field-by-field. If the overlay fails or the budget is gone, the
 *   user still gets a complete, science-based plan — source: "engine".
 *
 * Set mode:"full" to let the model author the whole plan when budget allows.
 */
import config from '../config.js';
import { complete, GroqError } from './groqClient.js';
import { cacheKey, cacheGet, cacheSet } from './aiCache.js';
import {
  buildTrainingPlan, buildNutritionPlan, coachFallback,
  exerciseById, EQUIPMENT_FILTERS, EXERCISES,
} from './planEngine.js';
import { getFoodByIdOrName } from './foodService.js';
import { macroTargets, tdee, round, clamp } from './nutrition.js';
import { all, run, today } from '../db.js';
import tokenBudget from './tokenBudget.js';

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const availableExerciseIds = (equipment) => {
  const filter = EQUIPMENT_FILTERS[equipment];
  return EXERCISES.filter((e) => !filter || filter.includes(e.equipment)).map((e) => e.id);
};


/* ------------------------------ context --------------------------------- */

function compactProfile(profile) {
  const t = macroTargets(profile);
  return {
    sex: profile.sex || 'male',
    age: profile.age,
    kg: round(profile.weight_kg || 75, 1),
    cm: round(profile.height_cm || 175),
    bf: profile.body_fat_pct ? round(profile.body_fat_pct, 1) : null,
    goal: profile.goal || 'recomp',
    exp: profile.experience || 'intermediate',
    days: profile.days_per_week || 4,
    min: profile.session_minutes || 60,
    equip: profile.equipment || 'full_gym',
    act: profile.activity_level || 'moderate',
    inj: profile.injuries || '',
    diet: profile.diet_pref || 'omnivore',
    allergies: profile.allergies || '',
    focus: profile.focus_areas || '',
    sleep: profile.sleep_hours || 7,
    kcal: t.calories,
    p: t.protein_g,
    c: t.carbs_g,
    f: t.fat_g,
    tdee: tdee(profile),
  };
}

function trainingContext(userId, profile) {
  const recent = all(
    `SELECT date, name, focus, duration_s FROM workout_logs
     WHERE user_id = ? ORDER BY date DESC LIMIT 10`, userId);
  const prs = all(
    `SELECT exercise_name, MAX(weight_kg) AS top_kg, COUNT(*) AS sets
     FROM sets WHERE user_id = ? AND is_warmup = 0 AND weight_kg > 0
     GROUP BY exercise_name ORDER BY sets DESC LIMIT 8`, userId);
  const metrics = all(
    `SELECT date, weight_kg, body_fat_pct FROM metrics
     WHERE user_id = ? ORDER BY date DESC LIMIT 8`, userId);
  return { recent_sessions: recent, top_lifts: prs, weigh_ins: metrics };
}

/* ------------------------------- prompts -------------------------------- */

const SYSTEM = `You are FitForge, an evidence-based strength & nutrition coach.
Rules: reply ONLY with minified valid JSON matching the requested schema, no prose, no markdown fences.
Be concrete and specific to the athlete's data. No generic filler, no disclaimers, no medical diagnosis.
Units: kg, cm, kcal. Keep every string short.`;

function overlayPrompt(kind, ctx) {
  if (kind === 'training') {
    return `${SYSTEM}

ATHLETE ${JSON.stringify(ctx.profile)}
LOG CONTEXT ${JSON.stringify(ctx.context)}
LOCAL PLAN (already built, do not repeat it) ${JSON.stringify(ctx.planSkeleton)}

Task: personalise this plan. Return minified JSON:
{"overview":"<=45 words, uses their real numbers",
"principles":["<=14 words each, 4 items, specific to injuries/goal/lifts"],
"days":[{"day":1,"title":"<=6 words","notes":"<=22 words, session-specific","swap":{"replace":"exact exercise name","with":"exercise id from library","why":"<=12 words"}}],
"progression":{"rule":"<=25 words","deload":"<=20 words"},
"red_flags":["<=12 words each, max 2"]}

Only include "swap" when a listed exercise is a bad fit (injury, equipment, imbalance). Exercise ids you may use: ${JSON.stringify(ctx.available)}.`;
  }
  return `${SYSTEM}

ATHLETE ${JSON.stringify(ctx.profile)}
LOCAL MEAL PLAN (already built) ${JSON.stringify(ctx.planSkeleton)}

Task: personalise this nutrition plan. Return minified JSON:
{"rationale":"<=50 words using their BMR/TDEE/target numbers",
"meal_notes":[{"meal":"Breakfast","note":"<=20 words"}],
"rules":["<=14 words each, 4 items"],
"training_day_adjustments":["<=18 words each, 2 items"],
"swaps":[{"replace":"food name","with":"food name from list","why":"<=10 words"}],
"adherence_tip":"<=25 words"}

Available foods: ${JSON.stringify(ctx.available)}.`;
}

/* ------------------------------ validation ------------------------------ */

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const arrStr = (v, max = 8) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, max) : undefined);

function sanitizeTrainingOverlay(raw, enginePlan, profile) {
  if (!raw || typeof raw !== 'object') return null;
  const allowedIds = availableExerciseIds(profile.equipment);
  const names = new Map(enginePlan.schedule.flatMap((d) => d.exercises).map((e) => [e.name.toLowerCase(), e.exercise_id]));
  const days = Array.isArray(raw.days) ? raw.days.slice(0, enginePlan.schedule.length) : [];

  return {
    overview: str(raw.overview, 600),
    principles: arrStr(raw.principles, 6),
    red_flags: arrStr(raw.red_flags, 3),
    progression:
      raw.progression && typeof raw.progression === 'object' && !Array.isArray(raw.progression)
        ? {
            rule: str(raw.progression.rule, 260),
            deload: str(raw.progression.deload, 260),
            model: str(raw.progression.model, 120),
            weekly: str(raw.progression.weekly, 260),
          }
        : undefined,
    days: days.map((d) => {
      const dayNum = Number(d?.day);
      if (!Number.isFinite(dayNum)) return null;
      let swap = null;
      if (d.swap && typeof d.swap === 'object') {
        const targetId = names.get(String(d.swap.replace || '').toLowerCase());
        const withId = String(d.swap.with || '').trim();
        const ok = targetId && allowedIds.includes(withId) && exerciseById(withId);
        if (ok) swap = { replace_id: targetId, replace: exerciseById(targetId)?.name, with: withId, with_name: exerciseById(withId).name, why: str(d.swap.why, 160) };
      }
      return {
        day: dayNum,
        title: str(d.title, 80),
        notes: str(d.notes, 400),
        swap,
      };
    }).filter(Boolean),
  };
}

function sanitizeNutritionOverlay(raw, enginePlan) {
  if (!raw || typeof raw !== 'object') return null;
  const mealNames = enginePlan.meals.map((m) => m.name);
  const notes = Array.isArray(raw.meal_notes)
    ? raw.meal_notes.filter((n) => n && mealNames.includes(n.meal) && typeof n.note === 'string').slice(0, 8)
    : undefined;
  return {
    rationale: str(raw.rationale, 700),
    adherence_tip: str(raw.adherence_tip, 300),
    rules: arrStr(raw.rules, 6),
    training_day_adjustments: arrStr(raw.training_day_adjustments, 4),
    meal_notes: notes,
    swaps: Array.isArray(raw.swaps) ? raw.swaps.slice(0, 6).filter((s) => s?.replace && s?.with) : undefined,
  };
}

function fullNutritionPrompt(profile, targets, cuisine = 'north_indian') {
  const isNorthIndian = cuisine === 'north_indian';
  const cuisineName = isNorthIndian ? 'North Indian' : cuisine === 'south_indian' ? 'South Indian' : 'Balanced Wholesome';
  const diet = profile.diet_pref || 'omnivore';

  return `${SYSTEM}

ATHLETE TARGETS:
Daily Calories: ${targets.calories} kcal
Daily Macros: Protein ${targets.protein_g}g | Carbs ${targets.carbs_g}g | Fat ${targets.fat_g}g
Dietary Preference: ${diet}
Allergies/Avoid: ${profile.allergies || 'none'}
Cuisine Style: ${cuisineName} (Focus on authentic, everyday wholesome staples like dal, roti, sabzi, paneer, sattu, besan chilla, khichdi, raita, chicken tikka, eggs, chana, rajma, etc.)

Task: Generate an authentic, realistic ${cuisineName} daily nutrition plan hitting the exact daily calorie and protein targets.
Return minified JSON with this EXACT structure:
{"rationale":"<=50 words explaining how this meal split hits ${targets.calories} kcal and ${targets.protein_g}g protein for their goal",
"meals":[{"name":"Breakfast","time":"08:00","notes":"<=25 words","foods":[{"name":"Exact dish name (e.g. Besan Chilla with Paneer)","grams":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"category":"protein|carb|dairy|veg|fat"}]}],
"rules":["<=15 words each, 4 actionable rules"],
"adherence_tip":"<=25 words",
"grocery":["8-12 core ingredients to buy"]}
Requirements:
1. Include Breakfast, Lunch, Dinner, and 1-2 Snacks.
2. Sum of all meals MUST closely hit ${targets.calories} kcal and ${targets.protein_g}g protein.
3. Every food must specify realistic portions in grams and true nutritional macros.`;
}

function sanitizeFullNutritionPlan(raw, targets, cuisine = 'north_indian') {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.meals) || !raw.meals.length) return null;

  const validMeals = raw.meals.map((m, i) => {
    const rawFoods = Array.isArray(m.foods) ? m.foods : [];
    const foods = rawFoods.map((f) => {
      const name = str(f?.name, 120);
      if (!name) return null;
      const grams = clamp(Number(f.grams) || 100, 5, 1200);
      return {
        name,
        grams,
        calories: Math.max(5, Math.round(Number(f.calories) || 100)),
        protein_g: Math.max(0, Math.round(Number(f.protein_g || 0) * 10) / 10),
        carbs_g: Math.max(0, Math.round(Number(f.carbs_g || 0) * 10) / 10),
        fat_g: Math.max(0, Math.round(Number(f.fat_g || 0) * 10) / 10),
        category: str(f.category, 30) || 'meal',
        tags: [cuisine, 'ai_crafted'].filter(Boolean),
      };
    }).filter(Boolean);

    if (!foods.length) return null;

    const actual = foods.reduce(
      (acc, f) => ({
        calories: acc.calories + f.calories,
        protein_g: acc.protein_g + f.protein_g,
        carbs_g: acc.carbs_g + f.carbs_g,
        fat_g: acc.fat_g + f.fat_g,
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );

    return {
      name: str(m.name, 40) || (i === 0 ? 'Breakfast' : i === 1 ? 'Lunch' : i === 2 ? 'Snack' : 'Dinner'),
      time: str(m.time, 10) || (i === 0 ? '08:00' : i === 1 ? '13:00' : i === 2 ? '17:00' : '20:00'),
      target_calories: Math.round(actual.calories),
      calories: Math.round(actual.calories),
      protein_g: Math.round(actual.protein_g * 10) / 10,
      carbs_g: Math.round(actual.carbs_g * 10) / 10,
      fat_g: Math.round(actual.fat_g * 10) / 10,
      foods,
      alternatives: Array.isArray(m.alternatives) ? m.alternatives.slice(0, 2) : [],
      notes: str(m.notes, 300) || '',
    };
  }).filter(Boolean);

  if (validMeals.length < 2) return null;

  return {
    targets,
    overview: str(raw.rationale, 600) || `Authentic ${titleCase(cuisine)} daily meal plan customized to your target numbers.`,
    rationale: str(raw.rationale, 600),
    meals: validMeals,
    rules: arrStr(raw.rules, 6) || [
      'Pair whole grains (roti/rice) with lentils/dals for complete protein absorption.',
      'Control cooking ghee and mustard oil to measured spoons.',
      'Incorporate fresh dahi, chaas, or salad with main meals.',
      'Hydrate with at least 3 liters of water across the day.',
    ],
    adherence_tip: str(raw.adherence_tip, 260) || 'Pre-cook lentils and sprouted legumes in advance for fast, high-protein weekday meals.',
    grocery: arrStr(raw.grocery, 16) || [
      'Atta (whole wheat flour)', 'Yellow moong dal', 'Paneer or Tofu',
      'Basmati rice', 'Fresh dahi', 'Sprouted moong beans',
      'Seasonal vegetables (spinach, cauliflower, okra)', 'Roasted chana or sattu'
    ],
  };
}

/* ------------------------------- merging -------------------------------- */

function applyTrainingOverlay(plan, overlay) {
  if (!overlay) return plan;
  const out = structuredClone(plan);
  if (overlay.overview) out.overview = overlay.overview;
  if (overlay.principles?.length) out.principles = overlay.principles;
  if (overlay.red_flags?.length) out.red_flags = overlay.red_flags;
  if (overlay.progression) out.progression = { ...out.progression, ...overlay.progression };
  for (const d of overlay.days || []) {
    const day = out.schedule.find((s) => s.day === d.day);
    if (!day) continue;
    if (d.title) day.title = d.title;
    if (d.notes) day.notes = d.notes;
    if (d.swap) {
      const ex = day.exercises.find((e) => e.exercise_id === d.swap.replace_id);
      if (ex) {
        const lib = exerciseById(d.swap.with);
        ex.name = lib.name;
        ex.exercise_id = lib.id;
        ex.muscles = lib.muscles;
        ex.equipment = lib.equipment;
        ex.swap_reason = d.swap.why;
      }
    }
  }
  out.meta.personalised = true;
  return out;
}

function applyNutritionOverlay(plan, overlay) {
  if (!overlay) return plan;
  const out = structuredClone(plan);
  if (overlay.rationale) out.rationale = overlay.rationale;
  if (overlay.rules?.length) out.rules = overlay.rules;
  if (overlay.training_day_adjustments?.length) out.training_day_adjustments = overlay.training_day_adjustments;
  if (overlay.adherence_tip) out.adherence_tip = overlay.adherence_tip;
  for (const n of overlay.meal_notes || []) {
    const meal = out.meals.find((m) => m.name === n.meal);
    if (meal) meal.notes = n.note;
  }
  if (overlay.swaps?.length) out.swaps = overlay.swaps;
  out.meta.personalised = true;
  return out;
}

/* --------------------------- cache key policy ---------------------------
   A cached plan is only reusable when EVERY input that shaped it matches:
   the user (the overlay is personalised from THEIR log history), the profile,
   the log-context signature, and the generation options. Omitting the user
   previously meant two people with identical profiles could receive the same
   personalised plan — a cross-user data leak.                            */
export const contextSignature = (ctx) => JSON.stringify({
  r: (ctx?.recent_sessions || []).map((r) => `${r.date}:${r.name}:${r.focus}`),
  t: (ctx?.top_lifts || []).map((t) => `${t.exercise_name}:${t.top_kg}`),
  w: (ctx?.weigh_ins || []).map((w) => `${w.date}:${w.weight_kg}`),
});

export function planCacheKey(userId, kind, profile, ctxSig = '', extra = {}) {
  return cacheKey(kind, { u: userId, ctx: ctxSig, p: compactProfile(profile), ...extra });
}

/* ------------------------------ generators ------------------------------ */

function planSkeletonFor(kind, plan) {
  // Send the model a *small* view of the plan: names only. Keeps input tokens low.
  if (kind === 'training') {
    return {
      name: plan.meta.name,
      days: plan.schedule.map((d) => ({
        day: d.day,
        title: d.title,
        min: d.duration_min,
        exercises: d.exercises.map((e) => e.name),
      })),
      progression: plan.progression.model,
    };
  }
  return {
    name: plan.meta.name,
    targets: plan.targets,
    meals: plan.meals.map((m) => ({
      meal: m.name,
      kcal: m.calories,
      foods: m.foods.map((f) => `${f.name} ${f.grams}g`),
    })),
  };
}

async function persistPlan(userId, kind, title, payload, model, source, tokens) {
  const { lastInsertRowid } = run(
    `INSERT INTO ai_plans (user_id, kind, title, payload, model, source, tokens, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    userId, kind, title, JSON.stringify(payload), model || '', source, tokens || 0
  );
  run(`UPDATE ai_plans SET active = 0 WHERE user_id = ? AND kind = ? AND id <> ?`, userId, kind, lastInsertRowid);
  return lastInsertRowid;
}

export async function generateTrainingPlan(userId, profile, { mode = 'overlay', weeks = 4, force = false, onProgress } = {}) {
  const engine = buildTrainingPlan({ ...profile, age: profile.age }, { weeks });
  const logCtx = trainingContext(userId, profile);
  const key = planCacheKey(userId, 'training', profile, contextSignature(logCtx), { weeks, mode });
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return { ...hit.payload, meta: { ...hit.payload.meta, source: 'cache', model: hit.model, cached: true } };
  }

  if (!config.groq.apiKey || !config.groq.enabled) {
    engine.meta.source = 'engine';
    engine.meta.reason = config.groq.apiKey ? 'AI disabled' : 'GROQ_API_KEY not configured';
    return engine;
  }

  const ctx = {
    profile: compactProfile(profile),
    context: logCtx,
    planSkeleton: planSkeletonFor('training', engine),
    available: availableExerciseIds(profile.equipment).slice(0, 120),
  };

  try {
    if (mode === 'full') {
      const res = await complete({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Build a complete ${weeks}-week training plan. Athlete: ${JSON.stringify(ctx.profile)}. Log context: ${JSON.stringify(ctx.context)}. Available exercise ids: ${JSON.stringify(ctx.available)}. Return minified JSON: {"meta":{"name":string,"weeks":number,"days_per_week":number},"overview":string,"principles":[string],"schedule":[{"day":1,"day_name":string,"title":string,"focus":string,"duration_min":number,"exercises":[{"exercise_id":string,"name":string,"sets":number,"reps":string,"load":string,"tempo":string,"rest_s":number,"rpe":string,"cues":string}],"notes":string}],"progression":{"model":string,"rule":string,"deload":string}}` },
        ],
        json: true, endpoint: 'ai.plan.training.full', userId,
        model: config.groq.planningModel,
        maxTokens: config.groq.maxTokensPlan,
        onProgress,
      });
      if (res.json?.schedule?.length) {
        const merged = mergeFullPlan(engine, res.json);
        merged.meta.source = 'ai';
        merged.meta.model = res.model;
        merged.meta.tokens = res.usage.total_tokens;
        cacheSet(key, 'training', merged, { model: res.model, tokens: res.usage.total_tokens });
        return merged;
      }
      onProgress?.({ phase: 'degraded', reason: res.parseError || 'model returned no schedule' });
    }

    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: overlayPrompt('training', ctx) },
      ],
      json: true, endpoint: 'ai.plan.training.overlay', userId,
      model: config.groq.fastModel,
      maxTokens: 1200,
      reasoningEffort: 'minimal',
      onProgress,
    });

    let finalRes = res;
    if (!res.json) {
      // gpt-oss occasionally spends its whole budget on reasoning and returns
      // failed_generation; one retry with headroom usually lands the JSON
      finalRes = await complete({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: overlayPrompt('training', ctx) },
        ],
        json: true, endpoint: 'ai.plan.training.overlay.retry', userId,
        model: config.groq.fastModel, maxTokens: 2000, reasoningEffort: 'minimal', onProgress,
      });
    }
    const overlay = sanitizeTrainingOverlay(finalRes.json, engine, profile);
    const plan = applyTrainingOverlay(engine, overlay);
    plan.meta.source = overlay ? 'ai' : 'engine';
    plan.meta.model = finalRes.model;
    plan.meta.tokens = (res.usage.total_tokens || 0) + (finalRes !== res ? finalRes.usage.total_tokens || 0 : 0);
    plan.meta.mode = mode;
    if (!overlay) plan.meta.reason = finalRes.parseError || 'overlay rejected by validation';
    cacheSet(key, 'training', plan, { model: finalRes.model, tokens: plan.meta.tokens });
    return plan;
  } catch (err) {
    engine.meta.source = 'engine';
    engine.meta.model = '';
    engine.meta.reason = err instanceof GroqError ? `${err.code || err.status}: ${err.message}` : err.message;
    engine.meta.degraded = true;
    if (!config.engineFallback) throw err;
    return engine;
  }
}

function mergeFullPlan(engine, ai) {
  const schedule = (ai.schedule || []).map((d, i) => {
    const base = engine.schedule[i] || engine.schedule[0];
    const exercises = Array.isArray(d.exercises) && d.exercises.length
      ? d.exercises.map((e, j) => ({
          exercise_id: e.exercise_id || base.exercises[j]?.exercise_id || 'push_up',
          name: e.name || exerciseById(e.exercise_id)?.name || base.exercises[j]?.name || 'Exercise',
          role: base.exercises[j]?.role || 'primary',
          sets: clamp(Number(e.sets) || base.exercises[j]?.sets || 3, 1, 10),
          reps: str(e.reps, 16) || base.exercises[j]?.reps || '8-12',
          load: str(e.load, 40) || base.exercises[j]?.load || '',
          tempo: str(e.tempo, 16) || base.exercises[j]?.tempo || '',
          rest_s: clamp(Number(e.rest_s) || base.exercises[j]?.rest_s || 90, 0, 600),
          rpe: str(e.rpe, 12) || base.exercises[j]?.rpe || '',
          cues: str(e.cues, 300) || base.exercises[j]?.cues || '',
          muscles: base.exercises[j]?.muscles || [],
          equipment: base.exercises[j]?.equipment || 'barbell',
        }))
      : base.exercises;
    return {
      ...base,
      title: str(d.title, 80) || base.title,
      day_name: str(d.day_name, 20) || base.day_name,
      focus: str(d.focus, 30) || base.focus,
      duration_min: clamp(Number(d.duration_min) || base.duration_min, 15, 180),
      notes: str(d.notes, 400) || base.notes,
      exercises,
      working_sets: exercises.reduce((s, e) => s + e.sets, 0),
    };
  });
  return {
    ...engine,
    meta: { ...engine.meta, ...(ai.meta || {}) },
    overview: str(ai.overview, 800) || engine.overview,
    principles: arrStr(ai.principles, 6) || engine.principles,
    schedule: schedule.length ? schedule : engine.schedule,
    progression: { ...engine.progression, ...(typeof ai.progression === 'object' && ai.progression ? ai.progression : {}) },
  };
}

export async function generateNutritionPlan(userId, profile, { mode = 'full', cuisine = 'north_indian', force = false, onProgress } = {}) {
  const targets = macroTargets(profile);
  const engine = buildNutritionPlan(profile);
  const key = planCacheKey(userId, 'nutrition', profile, '', { mode, cuisine });
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return { ...hit.payload, meta: { ...hit.payload.meta, source: 'cache', model: hit.model, cached: true } };
  }

  if (!config.groq.apiKey || !config.groq.enabled) {
    engine.meta.source = 'engine';
    engine.meta.reason = config.groq.apiKey ? 'AI disabled' : 'GROQ_API_KEY not configured';
    engine.meta.cuisine = cuisine;
    return engine;
  }

  // 1. Full AI Generation Mode (preferred for North Indian and explicit full mode)
  if (mode === 'full' || cuisine === 'north_indian') {
    try {
      onProgress?.({ phase: 'generating', model: config.groq.planningModel });
      const fullRes = await complete({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: fullNutritionPrompt(profile, targets, cuisine) },
        ],
        json: true,
        endpoint: 'ai.plan.nutrition.full',
        userId,
        model: config.groq.planningModel,
        maxTokens: 1600,
        onProgress,
      });

      const fullPlan = sanitizeFullNutritionPlan(fullRes.json, targets, cuisine);
      if (fullPlan) {
        fullPlan.meta = {
          name: `${titleCase(cuisine)} Nutrition Plan`,
          source: 'ai',
          model: fullRes.model,
          tokens: fullRes.usage?.total_tokens || 0,
          cuisine,
          mode: 'full',
          personalised: true,
        };
        cacheSet(key, 'nutrition', fullPlan, { model: fullRes.model, tokens: fullRes.usage?.total_tokens || 0 });
        return fullPlan;
      }
      onProgress?.({ phase: 'degraded', reason: fullRes.parseError || 'model returned incomplete meal structure' });
    } catch (err) {
      console.warn('[aiService] full nutrition generation failed, falling back to overlay:', err.message);
      onProgress?.({ phase: 'degraded', reason: err.message });
    }
  }

  // 2. Fallback: Overlay on local engine plan
  const ctx = {
    profile: compactProfile(profile),
    planSkeleton: planSkeletonFor('nutrition', engine),
    available: engine.swap_list.map((s) => s.food).slice(0, 40),
  };

  try {
    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: overlayPrompt('nutrition', ctx) },
      ],
      json: true, endpoint: 'ai.plan.nutrition.overlay', userId,
      model: config.groq.fastModel,
      maxTokens: 1200,
      reasoningEffort: 'minimal',
      onProgress,
    });
    const overlay = sanitizeNutritionOverlay(res.json, engine);
    const plan = applyNutritionOverlay(engine, overlay);
    plan.meta.source = overlay ? 'ai' : 'engine';
    plan.meta.model = res.model;
    plan.meta.tokens = res.usage?.total_tokens || 0;
    plan.meta.cuisine = cuisine;
    if (!overlay) plan.meta.reason = res.parseError || 'overlay rejected by validation';
    cacheSet(key, 'nutrition', plan, { model: res.model, tokens: res.usage?.total_tokens || 0 });
    return plan;
  } catch (err) {
    engine.meta.source = 'engine';
    engine.meta.reason = err.message;
    engine.meta.degraded = true;
    engine.meta.cuisine = cuisine;
    if (!config.engineFallback) throw err;
    return engine;
  }
}

/* -------------------------------- coach --------------------------------- */

export async function coachChat(userId, profile, message, { history = [], onProgress } = {}) {
  const budget = tokenBudget.snapshot();
  const messages = [
    {
      role: 'system',
      content: `You are FitForge, a blunt, practical strength & nutrition coach.
Answer in <=110 words. Use the athlete's real numbers. Give one concrete action they can do today.
No medical diagnosis; refer out for pain, injury or eating-disorder signals. No markdown headers.`,
    },
    {
      role: 'user',
      content: `ATHLETE ${JSON.stringify(compactProfile(profile))}
RECENT ${JSON.stringify(history.slice(-4).map((h) => ({ r: h.role, c: (h.content || '').slice(0, 160) })))}
CONTEXT ${JSON.stringify(trainingContext(userId, profile))}
QUESTION ${String(message).slice(0, 600)}`,
    },
  ];

  if (!config.groq.apiKey || !config.groq.enabled || budget.tokensRemaining < 150) {
    return {
      text: coachFallback(profile, message),
      source: budget.tokensRemaining < 150 && config.groq.apiKey ? 'engine:throttled' : 'engine',
      model: null, usage: { total_tokens: 0 },
      budget: tokenBudget.snapshot(),
    };
  }

  try {
    const res = await complete({
      messages, endpoint: 'ai.coach', userId,
      model: config.groq.fastModel,
      maxTokens: config.groq.maxTokensChat,
      onProgress,
    });
    return {
      text: (res.text || '').trim() || coachFallback(profile, message),
      source: 'ai',
      model: res.model,
      usage: res.usage,
      latencyMs: res.latencyMs,
      budget: tokenBudget.snapshot(),
    };
  } catch (err) {
    return {
      text: coachFallback(profile, message),
      source: 'engine:error',
      error: err.message,
      model: null, usage: { total_tokens: 0 },
      budget: tokenBudget.snapshot(),
    };
  }
}

/* ------------------------------- insights -------------------------------- */

/** Cheap, cached weekly read-out. Uses the fast model with a tiny output cap. */
export async function weeklyInsight(userId, profile, stats) {
  const key = cacheKey('insight', { u: userId, week: today(), stats: stats.headline });
  const hit = cacheGet(key);
  if (hit) return { ...hit.payload, cached: true };

  const local = {
    headline: `${stats.headline.volume_this_week_kg || 0} kg lifted this week across ${stats.headline.sessions || 0} sessions; ` +
      `${stats.headline.streak || 0}-day streak; weight ${stats.headline.weight_change_kg ?? 0} kg over 14 days.`,
    advice: stats.headline.sessions >= profile.days_per_week
      ? 'Volume is on target. Push the top set of your first lift by 2.5% next week.'
      : `You are ${Math.max(0, (profile.days_per_week || 4) - (stats.headline.sessions || 0))} session(s) short this week. Book the next one before you leave the gym today.`,
    source: 'engine',
  };

  if (!config.groq.apiKey || !config.groq.enabled) {
    cacheSet(key, 'insight', local, { model: 'engine', tokens: 0 });
    return local;
  }

  try {
    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `ATHLETE ${JSON.stringify(compactProfile(profile))}
WEEK ${JSON.stringify(stats.headline)}
TOP LIFTS ${JSON.stringify(stats.top_lifts || [])}
Return minified JSON: {"headline":"<=25 words, includes a real number","advice":"<=35 words, one action","watch":"<=15 words"}` },
      ],
      json: true, endpoint: 'ai.insight', userId,
      model: config.groq.fastModel, maxTokens: 220,
    });
    const out = {
      headline: str(res.json?.headline, 300) || local.headline,
      advice: str(res.json?.advice, 400) || local.advice,
      watch: str(res.json?.watch, 200),
      source: 'ai', model: res.model,
    };
    cacheSet(key, 'insight', out, { model: res.model, tokens: res.usage.total_tokens });
    return out;
  } catch {
    cacheSet(key, 'insight', local, { model: 'engine', tokens: 0 });
    return local;
  }
}

/* ------------------------- food macro estimation ------------------------ */

function heuristicFoodEstimate(foodName, grams = 100) {
  const g = Math.max(1, Math.min(5000, Number(grams) || 100));
  const n = String(foodName || '').toLowerCase();

  let kcalPer100 = 160;
  let pPer100 = 6;
  let cPer100 = 20;
  let fPer100 = 6;
  let cat = 'meal';

  if (/paneer|tofu/i.test(n)) {
    kcalPer100 = 260; pPer100 = 18; cPer100 = 5; fPer100 = 20; cat = 'protein';
  } else if (/chicken|meat|mutton|fish|egg|prawn/i.test(n)) {
    kcalPer100 = 180; pPer100 = 22; cPer100 = 4; fPer100 = 8; cat = 'protein';
  } else if (/dal|lentil|rajma|chole|chana|sattu|besan/i.test(n)) {
    kcalPer100 = 130; pPer100 = 8; cPer100 = 20; fPer100 = 2.5; cat = 'protein';
  } else if (/roti|paratha|naan|bread|chapati|phulka|thepla/i.test(n)) {
    kcalPer100 = /paratha|naan/i.test(n) ? 270 : 250;
    pPer100 = 8; cPer100 = 48; fPer100 = /paratha|naan/i.test(n) ? 8 : 2; cat = 'carb';
  } else if (/rice|biryani|pulao|khichdi|poha|idli|dosa/i.test(n)) {
    kcalPer100 = /biryani/i.test(n) ? 170 : 135;
    pPer100 = /biryani/i.test(n) ? 8 : 3.5; cPer100 = 26; fPer100 = /biryani/i.test(n) ? 5 : 1.5; cat = 'carb';
  } else if (/curd|dahi|yogurt|raita|lassi|chaas/i.test(n)) {
    kcalPer100 = /chaas/i.test(n) ? 35 : 65;
    pPer100 = 3.5; cPer100 = 5; fPer100 = /chaas/i.test(n) ? 1 : 3.5; cat = 'dairy';
  } else if (/sabzi|bhindi|gobhi|baingan|palak|salad|veg/i.test(n)) {
    kcalPer100 = 65; pPer100 = 2; cPer100 = 8; fPer100 = 3; cat = 'veg';
  } else if (/makhana|nuts|peanut|almond|cashew/i.test(n)) {
    kcalPer100 = /makhana/i.test(n) ? 350 : 580;
    pPer100 = /makhana/i.test(n) ? 9 : 20; cPer100 = /makhana/i.test(n) ? 65 : 20; fPer100 = /makhana/i.test(n) ? 4 : 50; cat = 'snack';
  }

  const ratio = g / 100;
  return {
    food_name: foodName,
    grams: g,
    calories: Math.round(kcalPer100 * ratio),
    protein_g: Math.round(pPer100 * ratio * 10) / 10,
    carbs_g: Math.round(cPer100 * ratio * 10) / 10,
    fat_g: Math.round(fPer100 * ratio * 10) / 10,
    category: cat,
    confidence: 'heuristic',
    summary: `${g}g estimated using nutritional density heuristics.`,
    source: 'engine_heuristic',
  };
}

export async function estimateFoodMacros(foodName, grams = 100, context = {}) {
  const cleanName = String(foodName || '').trim().slice(0, 120);
  const cleanGrams = Math.max(1, Math.min(5000, Number(grams) || 100));
  if (!cleanName) throw new Error('food_name is required for macro estimation.');

  const cacheKeyStr = cacheKey('food_est', { f: cleanName.toLowerCase(), g: cleanGrams });
  const cached = cacheGet(cacheKeyStr);
  if (cached?.payload) return { ...cached.payload, cached: true };

  // 1. Check local database
  const known = getFoodByIdOrName(cleanName, context.userId || null);
  if (known) {
    const ratio = cleanGrams / 100;
    const est = {
      food_name: known.name,
      grams: cleanGrams,
      calories: Math.round((known.kcal / 100) * cleanGrams),
      protein_g: Math.round(((known.protein_g / 100) * cleanGrams) * 10) / 10,
      carbs_g: Math.round(((known.carbs_g / 100) * cleanGrams) * 10) / 10,
      fat_g: Math.round(((known.fat_g / 100) * cleanGrams) * 10) / 10,
      category: known.category || 'meal',
      source: 'database',
      confidence: 'verified',
      summary: `${cleanGrams}g of ${known.name} provides ${Math.round((known.kcal / 100) * cleanGrams)} kcal with ${Math.round(((known.protein_g / 100) * cleanGrams) * 10) / 10}g protein.`,
    };
    return est;
  }

  // 2. Offline fallback if no API key
  if (!config.groq.apiKey || !config.groq.enabled) {
    return heuristicFoodEstimate(cleanName, cleanGrams);
  }

  // 3. Groq LPU calculation
  const prompt = `${SYSTEM}
Task: Estimate realistic cooked/consumed nutritional values for this dish and quantity.
Food: "${cleanName}"
Quantity: ${cleanGrams} grams
Context: Standard home cooking / Indian / international preparation. Be realistic about standard cooking fats/oils.

Return minified JSON:
{"food_name":"${cleanName}","grams":${cleanGrams},"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"category":"protein|carb|fat|dairy|veg|snack|meal","confidence":"high|moderate","summary":"<=20 words explaining portion context"}`;

  try {
    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      json: true,
      endpoint: 'ai.nutrition.estimate',
      model: config.groq.fastModel,
      maxTokens: 350,
      reasoningEffort: 'minimal',
    });

    const parsed = res.json;
    if (parsed && Number(parsed.calories) >= 0) {
      const result = {
        food_name: str(parsed.food_name, 120) || cleanName,
        grams: cleanGrams,
        calories: Math.max(0, Math.round(Number(parsed.calories))),
        protein_g: Math.max(0, Math.round(Number(parsed.protein_g || 0) * 10) / 10),
        carbs_g: Math.max(0, Math.round(Number(parsed.carbs_g || 0) * 10) / 10),
        fat_g: Math.max(0, Math.round(Number(parsed.fat_g || 0) * 10) / 10),
        category: str(parsed.category, 30) || 'meal',
        confidence: str(parsed.confidence, 20) || 'high',
        summary: str(parsed.summary, 160) || `${cleanGrams}g of ${cleanName}`,
        source: 'ai_estimate',
        model: res.model,
      };
      cacheSet(cacheKeyStr, 'food_est', result, { model: res.model, tokens: res.usage?.total_tokens || 0 });
      return result;
    }
  } catch (err) {
    console.warn('[aiService] estimateFoodMacros error, using heuristic fallback:', err.message);
  }

  return heuristicFoodEstimate(cleanName, cleanGrams);
}

/* ----------------------- exercise coaching guide ------------------------ */

function deterministicExerciseGuide(ex, targetWeight = 0, profile = {}) {
  const name = ex?.name || 'Exercise';
  const substitutes = (ex?.substitutes || []).slice(0, 3);
  return {
    exercise_id: ex?.id || 'exercise',
    exercise_name: name,
    setup_cues: [
      'Set a stable base of support with neutral spine and feet rooted into the floor.',
      'Inhale deeply into your abdomen to create 360-degree intra-abdominal pressure.',
      'Establish a firm grip with wrists aligned and shoulder blades set.',
    ],
    execution_cues: [
      ex?.cue || 'Control the eccentric descent for 2-3 seconds; avoid bouncing at turnaround.',
      'Accelerate smoothly through the concentric stroke without jerky momentum.',
      'Maintain continuous tension on the target musculature through full range of motion.',
    ],
    common_mistakes: [
      'Sacrificing range of motion to handle heavier load — reduce weight and hit full depth.',
      'Letting joints drift out of alignment during the hardest turnaround phase.',
    ],
    warmup_protocol: targetWeight > 35 ? [
      { set: 1, weight: `${Math.round(targetWeight * 0.45)} kg`, reps: '10', note: 'Movement groove & joint warm-up' },
      { set: 2, weight: `${Math.round(targetWeight * 0.70)} kg`, reps: '5', note: 'CNS potentiation' },
      { set: 3, weight: `${Math.round(targetWeight * 0.88)} kg`, reps: '2', note: 'Primer set, zero metabolic fatigue' },
    ] : [
      { set: 1, weight: 'Bodyweight / light', reps: '10-12', note: 'Joint mobilization' },
      { set: 2, weight: 'Moderate load', reps: '6', note: 'Neural primer' },
    ],
    smart_substitutes: substitutes.length ? substitutes : ['Machine equivalent', 'Dumbbell variation', 'Cable press/pull'],
    safety_cue: 'Sharp joint discomfort is an immediate stop signal. Regress the variation or adjust the path.',
    source: 'engine',
  };
}

export async function exerciseCoachingGuide(exerciseId, profile = {}, context = {}) {
  const ex = exerciseById(exerciseId);
  const exName = ex?.name || exerciseId;
  const targetWeight = Number(context.weight_kg) || 0;
  const targetReps = context.reps || '8-10';

  const cacheKeyStr = cacheKey('ex_guide', {
    ex: exerciseId,
    exp: profile.experience || 'intermediate',
    inj: profile.injuries || '',
    w: targetWeight > 0 ? Math.round(targetWeight) : 0,
  });
  const cached = cacheGet(cacheKeyStr);
  if (cached?.payload) return { ...cached.payload, cached: true };

  if (!config.groq.apiKey || !config.groq.enabled) {
    return deterministicExerciseGuide(ex, targetWeight, profile);
  }

  const prompt = `${SYSTEM}
Athlete Experience: ${profile.experience || 'intermediate'}
Equipment Available: ${profile.equipment || 'full_gym'}
Injuries/Notes: ${profile.injuries || 'none'}
Exercise: ${exName} (Category: ${ex?.category || 'compound'}, Target muscles: ${(ex?.muscles || []).join(', ')})
Current Working Load Target: ${targetWeight > 0 ? `${targetWeight} kg x ${targetReps}` : 'bodyweight or moderate weight'}

Task: Provide an elite, personalized biomechanics & coaching breakdown for this lift.
Return minified JSON:
{"setup_cues":["<=12 words each, 3 actionable setup steps"],
"execution_cues":["<=14 words each, 3 execution cues (eccentric, breathing, mind-muscle)"],
"common_mistakes":["<=14 words each, 2 common faults with instant fix"],
"warmup_protocol":[{"set":1,"weight":"e.g. 50% or 40 kg","reps":"8-10","note":"Warmup"},{"set":2,"weight":"e.g. 75% or 65 kg","reps":"4","note":"Potentiation"},{"set":3,"weight":"e.g. 90% or 80 kg","reps":"1-2","note":"Primer"}],
"smart_substitutes":["2-3 alternative exercises if equipment is taken or joint pain arises"],
"safety_cue":"<=20 words on joint safety and pain signals"}`;

  try {
    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      json: true,
      endpoint: 'ai.exercise.guide',
      model: config.groq.fastModel,
      maxTokens: 500,
      reasoningEffort: 'minimal',
    });

    if (res.json) {
      const guide = {
        exercise_id: exerciseId,
        exercise_name: exName,
        setup_cues: arrStr(res.json.setup_cues, 4) || [],
        execution_cues: arrStr(res.json.execution_cues, 4) || [],
        common_mistakes: arrStr(res.json.common_mistakes, 3) || [],
        warmup_protocol: Array.isArray(res.json.warmup_protocol) ? res.json.warmup_protocol.slice(0, 4) : [],
        smart_substitutes: arrStr(res.json.smart_substitutes, 3) || [],
        safety_cue: str(res.json.safety_cue, 180),
        source: 'ai',
        model: res.model,
      };
      cacheSet(cacheKeyStr, 'ex_guide', guide, { model: res.model, tokens: res.usage?.total_tokens || 0 });
      return guide;
    }
  } catch (err) {
    console.warn('[aiService] exerciseCoachingGuide failed, falling back:', err.message);
  }

  return deterministicExerciseGuide(ex, targetWeight, profile);
}

export { compactProfile, persistPlan, cacheKey };
