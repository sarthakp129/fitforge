import { Router, raw } from 'express';
import { all, get, run, today, parseJson } from '../db.js';
import { auth, aiCooldown } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import config from '../config.js';
import { aiStatus, listModels, GroqError } from '../services/groqClient.js';
import { complete, transcribe, synthesize } from '../services/groqClient.js';
import { generateTrainingPlan, generateNutritionPlan, coachChat, weeklyInsight, persistPlan, exerciseCoachingGuide } from '../services/aiService.js';
import { cacheStats, cachePurge } from '../services/aiCache.js';
import tokenBudget from '../services/tokenBudget.js';
import { ageFrom } from '../services/nutrition.js';

const router = Router();
const requireAdmin = (req) => {
  if (config.env === 'test') return;
  if (!config.adminEmails.includes(String(req.user?.email || '').toLowerCase())) {
    throw new ApiError(403, 'This AI administration action requires an administrator account.');
  }
};
const enforceDailyAiLimit = (req) => {
  const usage = get('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND day = ?', req.user.id, today());
  if ((usage?.n || 0) >= config.aiPerUserRequestsPerDay) throw new ApiError(429, 'Your daily AI request limit has been reached. Try again tomorrow.', { retryIn: 3600 });
};

const getProfile = (userId) => {
  const p = get('SELECT * FROM profiles WHERE user_id = ?', userId) || {};
  return { ...p, age: ageFrom(p.birth_date) };
};

/* -------------------------------- status -------------------------------- */

router.get('/status', auth, (req, res) => {
  const status = aiStatus();
  const usage = get(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens,
            COALESCE(SUM(CASE WHEN cached=1 THEN 1 ELSE 0 END),0) AS cache_hits,
            COALESCE(SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END),0) AS ok,
            COALESCE(SUM(CASE WHEN status!='ok' THEN 1 ELSE 0 END),0) AS errors
     FROM ai_usage WHERE day = ?`, today()
  );
  res.json({ ...status, today: usage, cache: cacheStats() });
});

let modelCache = { at: 0, data: null, error: null };
router.get('/models', auth, async (req, res) => {
  if (!config.groq.apiKey) throw new ApiError(503, 'GROQ_API_KEY is not configured.');
  if (Date.now() - modelCache.at > 300_000 || req.query.refresh) {
    try {
      modelCache = { at: Date.now(), data: await listModels(), error: null };
    } catch (err) {
      modelCache = { ...modelCache, at: Date.now(), error: err.message };
    }
  }
  res.json({ models: modelCache.data || [], error: modelCache.error, cached_at: modelCache.at || null });
});

/** Runtime tuning of the governor (handy when your key's tier changes). */
router.put('/budget', auth, (req, res) => {
  if (!config.aiRuntimeTuning) throw new ApiError(403, 'Runtime budget tuning is disabled on this server (AI_RUNTIME_TUNING=false).');
  requireAdmin(req);
  const { tokensPerMinute, requestsPerMinute, requestsPerDay } = req.body || {};
  if (tokensPerMinute != null) tokenBudget.tpm = Math.max(100, Number(tokensPerMinute) || tokenBudget.tpm);
  if (requestsPerMinute != null) tokenBudget.rpm = Math.max(1, Number(requestsPerMinute) || tokenBudget.rpm);
  if (requestsPerDay != null) tokenBudget.rpd = Math.max(1, Number(requestsPerDay) || tokenBudget.rpd);
  tokenBudget.blockedUntil = 0;
  res.json({ ok: true, budget: tokenBudget.snapshot() });
});

/** Cheapest possible round-trip: proves the key works and shows real limits. */
router.post('/test', auth, aiCooldown(3), async (req, res) => {
  try {
    const out = await complete({
      messages: [
        { role: 'system', content: 'Reply with the single word: ready' },
        { role: 'user', content: 'ping' },
      ],
      endpoint: 'ai.test', userId: req.user.id,
      model: req.body?.model || config.groq.fastModel,
      maxTokens: 8, temperature: 0,
    });
    res.json({
      ok: true,
      model: out.model,
      reply: out.text.trim().slice(0, 40),
      usage: out.usage,
      latencyMs: out.latencyMs,
      budget: tokenBudget.snapshot(),
    });
  } catch (err) {
    res.status(err.status || 502).json({
      ok: false,
      error: err.code || 'error',
      message: err.message,
      hint: err.status === 401
        ? 'GROQ_API_KEY was rejected. Check the key in your .env and restart the API.'
        : err.status === 404
          ? 'Model not available on this key. See GET /api/ai/models for the live list.'
          : 'See GET /api/ai/status for budget state.',
      budget: tokenBudget.snapshot(),
    });
  }
});

/* --------------------------------- plans -------------------------------- */

function sse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // flush headers immediately so the client sees the stream open
  res.write('\n');

  // NOTE: listen on the *response*, not the request. req 'close' fires as soon
  // as the request body has been consumed on a keep-alive connection, which
  // would end the stream before a single event was written.
  let closed = false;
  res.on('close', () => { closed = true; });

  return (event, data) => {
    if (closed || res.writableEnded) return false;
    return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

router.post('/plans/training', auth, aiCooldown(config.aiCooldownSeconds), async (req, res) => {
  enforceDailyAiLimit(req);
  const profile = getProfile(req.user.id);
  if (!profile.weight_kg || !profile.height_cm) {
    throw new ApiError(412, 'Complete your profile (height and weight) before generating a plan.', {
      missing: [!profile.height_cm && 'height_cm', !profile.weight_kg && 'weight_kg'].filter(Boolean),
    });
  }
  const mode = req.body?.mode === 'full' ? 'full' : 'overlay';
  const weeks = Math.min(Math.max(Number(req.body?.weeks) || 4, 1), 16);
  const force = Boolean(req.body?.force);
  const streaming = req.query.stream === '1' || req.body?.stream === true;

  const send = streaming ? sse(req, res) : null;
  const onProgress = send ? (p) => send('progress', p) : undefined;

  try {
    const plan = await generateTrainingPlan(req.user.id, profile, { mode, weeks, force, onProgress });
    const id = await persistPlan(req.user.id, 'training', plan.meta?.name || 'Training Plan', plan, plan.meta?.model || '', plan.meta?.source || 'engine', plan.meta?.tokens || 0);
    if (streaming) {
      // A streaming client waits for a terminal event. Engine mode produces no
      // progress events at all, so 'done' must carry the plan itself.
      send('done', { id, plan, source: plan.meta?.source, budget: tokenBudget.snapshot() });
      return res.end();
    }
    res.status(201).json({ id, plan, budget: tokenBudget.snapshot() });
  } catch (err) {
    if (err instanceof GroqError) {
      send?.('error', { message: err.message, code: err.code });
      if (streaming) return res.end();
      return res.status(err.status || 502).json({
        error: err.code || 'ai_error', message: err.message, budget: tokenBudget.snapshot(),
      });
    }
    throw err;
  }
});

router.post('/plans/nutrition', auth, aiCooldown(config.aiCooldownSeconds), async (req, res) => {
  enforceDailyAiLimit(req);
  const profile = getProfile(req.user.id);
  if (!profile.weight_kg) throw new ApiError(412, 'Add your bodyweight before generating a nutrition plan.');
  const streaming = req.query.stream === '1';
  const send = streaming ? sse(req, res) : null;
  const cuisine = String(req.body?.cuisine || req.query?.cuisine || 'north_indian').trim();
  const mode = String(req.body?.mode || req.query?.mode || 'full').trim();
  try {
    const plan = await generateNutritionPlan(req.user.id, profile, {
      cuisine,
      mode,
      force: Boolean(req.body?.force),
      onProgress: send ? (p) => send('progress', p) : undefined,
    });
    const id = await persistPlan(req.user.id, 'nutrition', plan.meta?.name || 'Nutrition Plan', plan, plan.meta?.model || '', plan.meta?.source || 'engine', plan.meta?.tokens || 0);
    if (streaming) {
      send('done', { id, plan, source: plan.meta?.source, budget: tokenBudget.snapshot() });
      return res.end();
    }
    res.status(201).json({ id, plan, budget: tokenBudget.snapshot() });
  } catch (err) {
    if (err instanceof GroqError) {
      send?.('error', { message: err.message, code: err.code });
      if (streaming) return res.end();
      return res.status(err.status || 502).json({ error: err.code || 'ai_error', message: err.message });
    }
    throw err;
  }
});

router.post('/exercise/guide', auth, async (req, res, next) => {
  try {
    const { exercise_id, weight_kg, reps } = req.body || {};
    if (!exercise_id) throw new ApiError(400, 'exercise_id is required.');
    const profile = getProfile(req.user.id);
    const guide = await exerciseCoachingGuide(exercise_id, profile, {
      weight_kg, reps, userId: req.user.id,
    });
    res.json({ guide });
  } catch (err) {
    next(err);
  }
});

router.get('/plans', auth, (req, res) => {
  const kind = req.query.kind;
  const rows = all(
    `SELECT id, kind, title, model, source, tokens, active, created_at
     FROM ai_plans WHERE user_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id DESC LIMIT 50`,
    ...(kind ? [req.user.id, String(kind)] : [req.user.id])
  );
  res.json({ plans: rows });
});

router.get('/plans/:id', auth, (req, res) => {
  const row = get('SELECT * FROM ai_plans WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!row) throw new ApiError(404, 'Plan not found.');
  res.json({ id: row.id, kind: row.kind, title: row.title, source: row.source, model: row.model, created_at: row.created_at, plan: parseJson(row.payload, {}) });
});

router.get('/plans/active/:kind', auth, (req, res) => {
  const row = get(
    `SELECT * FROM ai_plans WHERE user_id = ? AND kind = ? AND active = 1 ORDER BY id DESC LIMIT 1`,
    req.user.id, String(req.params.kind)
  );
  if (!row) return res.json({ plan: null });
  res.json({ id: row.id, kind: row.kind, source: row.source, model: row.model, created_at: row.created_at, plan: parseJson(row.payload, {}) });
});

router.post('/plans/:id/activate', auth, (req, res) => {
  const row = get('SELECT * FROM ai_plans WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!row) throw new ApiError(404, 'Plan not found.');
  run('UPDATE ai_plans SET active = 0 WHERE user_id = ? AND kind = ?', req.user.id, row.kind);
  run('UPDATE ai_plans SET active = 1 WHERE id = ?', row.id);
  res.json({ ok: true, id: row.id, kind: row.kind });
});

router.delete('/plans/:id', auth, (req, res) => {
  const { changes } = run('DELETE FROM ai_plans WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!changes) throw new ApiError(404, 'Plan not found.');
  res.json({ ok: true });
});

/* --------------------------------- voice ---------------------------------
   Mic audio is forwarded to Groq and never written to disk or the database.
   Daily speech cap is enforced from usage telemetry (Orpheus free tier is
   3.6K text-tokens/day ≈ a couple of dozen coach replies).              */

router.post(
  '/transcribe',
  auth,
  aiCooldown(2),
  raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
  async (req, res) => {
    const buf = req.body;
    if (!buf || !buf.length) throw new ApiError(400, 'Send raw audio bytes with an audio/* content type.');
    try {
      const out = await transcribe(buf, req.headers['content-type'] || 'audio/webm', { userId: req.user.id });
      res.json(out);
    } catch (err) {
      if (err instanceof GroqError) {
        return res.status(err.status || 502).json({ error: err.code || 'transcribe_failed', message: err.message, retryIn: err.retryAfter });
      }
      throw err;
    }
  }
);

router.post('/speak', auth, aiCooldown(1), async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 500);
  if (!text.trim()) throw new ApiError(400, 'text is required (max 500 chars).');
  const used = get(
    `SELECT COUNT(*) AS n FROM ai_usage WHERE endpoint = 'ai.speak' AND day = ? AND status = 'ok'`, today()
  );
  if (used.n >= config.aiDailySpeechLimit) {
    return res.status(429).json({ error: 'rate_limited', message: `Daily voice-reply allowance reached (${config.aiDailySpeechLimit}). Text replies still work.`, retryIn: 3600 });
  }
  try {
    const out = await synthesize(text, { userId: req.user.id });
    res.set('content-type', out.contentType);
    res.set('cache-control', 'no-store');
    res.send(out.bytes);
  } catch (err) {
    if (err instanceof GroqError) {
      return res.status(err.status || 502).json({ error: err.code || 'speak_failed', message: err.message });
    }
    throw err;
  }
});

/* --------------------------------- coach -------------------------------- */

router.post('/coach', auth, aiCooldown(config.aiCooldownSeconds), async (req, res) => {
  enforceDailyAiLimit(req);
  const message = String(req.body?.message || '').trim();
  if (!message) throw new ApiError(400, 'A message is required.');
  if (message.length > 1200) throw new ApiError(400, 'Keep the question under 1200 characters.');

  const profile = getProfile(req.user.id);
  const sessionId = String(req.body?.session_id || 'default');
  const history = all(
    `SELECT role, content FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT 8`,
    req.user.id, sessionId
  ).reverse();

  run('INSERT INTO chat_messages (user_id, session_id, role, content) VALUES (?,?,?,?)',
    req.user.id, sessionId, 'user', message);

  const reply = await coachChat(req.user.id, profile, message, { history });

  const { lastInsertRowid } = run(
    'INSERT INTO chat_messages (user_id, session_id, role, content, tokens) VALUES (?,?,?,?,?)',
    req.user.id, sessionId, 'assistant', reply.text, reply.usage?.total_tokens || 0
  );

  res.json({
    id: Number(lastInsertRowid),
    message: reply.text,
    source: reply.source,
    model: reply.model,
    tokens: reply.usage?.total_tokens || 0,
    budget: reply.budget || tokenBudget.snapshot(),
    ...(reply.error ? { error: reply.error } : {}),
  });
});

router.get('/chat', auth, (req, res) => {
  const sessionId = String(req.query.session_id || 'default');
  const rows = all(
    `SELECT id, session_id, role, content, tokens, created_at FROM chat_messages
     WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT 60`, req.user.id, sessionId
  ).reverse();
  res.json({ messages: rows });
});

router.get('/coach/suggest', auth, (req, res) => {
  res.json({
    prompts: [
      'My bench has been stuck for 3 weeks — what do I change?',
      'Build me a high-protein day under 2000 kcal.',
      'My knees ache after squats. How do I keep training legs?',
      'Am I recovering enough? Here is my sleep and volume.',
      'What should I eat 90 minutes before a heavy session?',
      'Rewrite my week — I only have 3 days and 40 minutes.',
    ],
  });
});

router.delete('/chat', auth, (req, res) => {
  const { changes } = run('DELETE FROM chat_messages WHERE user_id = ?', req.user.id);
  res.json({ ok: true, deleted: changes });
});

/* ------------------------------- insights ------------------------------- */

router.get('/insight', auth, async (req, res) => {
  const profile = getProfile(req.user.id);
  const volume = get(
    `SELECT ROUND(COALESCE(SUM(reps*weight_kg),0)) AS volume_this_week_kg, COUNT(DISTINCT log_id) AS sessions
     FROM sets WHERE user_id = ? AND is_warmup = 0 AND date >= date('now','-7 day')`, req.user.id
  );
  const weights = all(
    `SELECT weight_kg FROM metrics WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY date DESC LIMIT 20`, req.user.id
  ).map((r) => r.weight_kg);
  const top = all(
    `SELECT exercise_name, MAX(weight_kg) AS top_kg FROM sets
     WHERE user_id = ? AND is_warmup = 0 AND weight_kg > 0
     GROUP BY exercise_name ORDER BY top_kg DESC LIMIT 5`, req.user.id
  );
  const stats = {
    headline: {
      ...volume,
      streak: get(`SELECT COUNT(DISTINCT date) AS n FROM workout_logs WHERE user_id = ? AND date >= date('now','-7 day')`, req.user.id)?.n || 0,
      weight_change_kg: weights.length > 1 ? Math.round((weights[0] - weights[weights.length - 1]) * 100) / 100 : 0,
    },
    top_lifts: top,
  };
  try {
    res.json({ insight: await weeklyInsight(req.user.id, profile, stats), stats });
  } catch (err) {
    res.status(502).json({ error: 'insight_failed', message: err.message });
  }
});

/* --------------------------------- usage -------------------------------- */

router.get('/usage', auth, (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 60);
  const perDay = all(
    `SELECT day, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens,
            COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens),0) AS completion_tokens,
            COALESCE(SUM(CASE WHEN cached=1 THEN 1 ELSE 0 END),0) AS cache_hits,
            ROUND(AVG(latency_ms)) AS avg_latency_ms
     FROM ai_usage WHERE user_id = ? AND day >= date('now', ?) GROUP BY day ORDER BY day`, req.user.id, `-${days} day`
  );
  const byEndpoint = all(
    `SELECT endpoint, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens,
            COALESCE(SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END),0) AS ok
     FROM ai_usage WHERE user_id = ? AND day >= date('now', ?) GROUP BY endpoint ORDER BY tokens DESC`, req.user.id, `-${days} day`
  );
  const byModel = all(
    `SELECT model, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens
     FROM ai_usage WHERE user_id = ? AND day >= date('now', ?) GROUP BY model ORDER BY tokens DESC`, req.user.id, `-${days} day`
  );
  const recent = all(
    `SELECT ts, endpoint, model, total_tokens, status, cached, latency_ms FROM ai_usage WHERE user_id = ? ORDER BY id DESC LIMIT 25`, req.user.id
  );
  res.json({ days, per_day: perDay, by_endpoint: byEndpoint, by_model: byModel, recent });
});

router.post('/cache/purge', auth, (req, res) => {
  if (!config.aiRuntimeTuning) throw new ApiError(403, 'Runtime cache purge is disabled on this server (AI_RUNTIME_TUNING=false).');
  requireAdmin(req);
  const result = cachePurge(req.body?.kind);
  res.json({ ok: true, deleted: result.changes });
});

export default router;
