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
import { macroTargets, tdee, round, clamp } from './nutrition.js';
import { all, run, today } from '../db.js';
import tokenBudget from './tokenBudget.js';

const availableExerciseIds = (equipment) => {
  const filter = EQUIPMENT_FILTERS[equipment];
  return EXERCISES.filter((e) => !filter || filter.includes(e.equipment)).map((e) => e.id);
};


/* ------------------------------ context --------------------------------- */

function compactProfile(profile) {
  const t = macroTargets(profile);
  return {
    sex: profile.sex || 'other',
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

export async function generateNutritionPlan(userId, profile, { mode = 'overlay', force = false, onProgress } = {}) {
  const engine = buildNutritionPlan(profile);
  const key = planCacheKey(userId, 'nutrition', profile, '', { mode });
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
    planSkeleton: planSkeletonFor('nutrition', engine),
    available: engine.swap_list.map((s) => s.food).slice(0, 40),
  };

  try {
    const res = await complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: overlayPrompt('nutrition', ctx) },
      ],
      json: true, endpoint: 'ai.plan.nutrition', userId,
      model: config.groq.fastModel,
      maxTokens: 1200,
      reasoningEffort: 'minimal',
      onProgress,
    });
    const overlay = sanitizeNutritionOverlay(res.json, engine);
    const plan = applyNutritionOverlay(engine, overlay);
    plan.meta.source = overlay ? 'ai' : 'engine';
    plan.meta.model = res.model;
    plan.meta.tokens = res.usage.total_tokens;
    if (!overlay) plan.meta.reason = res.parseError || 'overlay rejected by validation';
    cacheSet(key, 'nutrition', plan, { model: res.model, tokens: res.usage.total_tokens });
    return plan;
  } catch (err) {
    engine.meta.source = 'engine';
    engine.meta.reason = err.message;
    engine.meta.degraded = true;
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

export { compactProfile, persistPlan, cacheKey };
