/**
 * groqClient — the only place FitForge talks to Groq.
 *
 * Responsibilities
 *  - token estimation + reservation through the sliding-window budget
 *  - retry with exponential backoff and Retry-After honouring (429/5xx/network)
 *  - automatic model fallback when a model is unavailable on the key's tier
 *    (llama-3.3-70b-versatile & llama-3.1-8b-instant were retired on
 *     Groq's free/developer tiers on 2026-08-16)
 *  - strict-JSON extraction so the UI always gets a usable object
 *  - usage telemetry persisted for the budget dashboard
 */
import config from '../config.js';
import tokenBudget from './tokenBudget.js';
import { run, today } from '../db.js';

export class GroqError extends Error {
  constructor(message, { status, code, retryAfter, body } = {}) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export const estimateTokens = (text = '') => Math.max(1, Math.ceil(String(text).length / 4));

const jitter = (ms) => ms * (0.6 + Math.random() * 0.8);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 0), 120_000)));

/** Pull the first complete JSON object/array out of a model response. */
export function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json|javascript)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return JSON.parse(s); } catch { /* fall through to scan */ }
  }
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = s.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = s.slice(start, i + 1);
          try { return JSON.parse(slice); } catch { break; }
        }
      }
    }
  }
  return null;
}

function logUsage({ userId, endpoint, model, usage, status, cached, latencyMs }) {
  try {
    run(
      `INSERT INTO ai_usage (user_id, day, endpoint, model, prompt_tokens, completion_tokens, total_tokens, status, cached, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId ?? null, today(), endpoint, model,
      usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, usage?.total_tokens ?? 0,
      status, cached ? 1 : 0, Math.round(latencyMs || 0)
    );
  } catch (err) {
    console.warn('[groq] usage log failed:', err.message);
  }
}

function wantsReasoningParam(model = '') {
  return /gpt-oss/i.test(model) && config.groq.reasoningEffort;
}

async function callOnce({ messages, model, maxTokens, temperature, json, signal, endpoint, reasoningEffort }) {
  const body = {
    model,
    messages,
    temperature: json ? Math.min(temperature ?? config.groq.temperature, 0.7) : (temperature ?? config.groq.temperature),
    max_completion_tokens: maxTokens,
    stream: false,
  };
  if (json) body.response_format = { type: 'json_object' };
  if (wantsReasoningParam(model)) body.reasoning_effort = reasoningEffort || config.groq.reasoningEffort;

  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.groq.apiKey}`,
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  tokenBudget.syncFromHeaders(res.headers);

  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

  if (!res.ok) {
    const errPayload = data?.error || {};
    const err = new GroqError(errPayload.message || `Groq responded ${res.status}`, {
      status: res.status,
      code: errPayload.code || errPayload.type || `http_${res.status}`,
      retryAfter: Number(res.headers.get('retry-after')) || 0,
      body: data,
    });
    throw err;
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? '';
  const usage = data?.usage || {};
  return { content, usage, model: data?.model || model, finish: choice?.finish_reason || '' };
}

/**
 * @param {object} p
 * @param {Array<{role:string,content:string}>} p.messages
 * @param {string} [p.endpoint]    telemetry label
 * @param {number} [p.userId]
 * @param {boolean}[p.json]        request JSON-object output
 * @param {number} [p.maxTokens]
 * @param {string} [p.model]
 * @param {(info:object)=>void} [p.onProgress]  { phase, waitMs, attempt, model }
 */
export async function complete(p) {
  const {
    messages, endpoint = 'generic', userId = null, json = false,
    maxTokens, model, onProgress,
  } = p;

  if (!config.groq.enabled) throw new GroqError('AI is disabled on this server (GROQ_ENABLED=false).', { code: 'disabled', status: 503 });
  if (!config.groq.apiKey) throw new GroqError('GROQ_API_KEY is not configured on the server.', { code: 'no_api_key', status: 503 });

  const promptText = messages.map((m) => m.content).join('\n');
  const estimate = estimateTokens(promptText) + (maxTokens || 500);
  const started = Date.now();

  const { waited } = await tokenBudget.reserve(estimate, {
    onWait: (waitMs, snap) => onProgress?.({ phase: 'throttled', waitMs, budget: snap }),
  });
  if (waited > 500) onProgress?.({ phase: 'reserved', waitMs: waited });

  const chain = [model, ...config.groq.fallbackChain]
    .filter(Boolean)
    .filter((m, i, arr) => arr.indexOf(m) === i);

  let lastErr = null;

  for (const candidate of chain) {
    for (let attempt = 1; attempt <= config.groq.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), config.groq.timeoutMs);
      try {
        const out = await callOnce({
          messages, model: candidate,
          maxTokens: maxTokens || (json ? config.groq.maxTokensPlan : config.groq.maxTokensChat),
          temperature: p.temperature, json, signal: ac.signal, endpoint,
          reasoningEffort: p.reasoningEffort,
        });
        clearTimeout(timer);

        const usage = {
          prompt_tokens: out.usage.prompt_tokens ?? estimateTokens(promptText),
          completion_tokens: out.usage.completion_tokens ?? estimateTokens(out.content),
          total_tokens: out.usage.total_tokens ?? estimate,
        };
        tokenBudget.commit(usage.total_tokens, estimate);
        tokenBudget.totalServed += 1;
        logUsage({ userId, endpoint, model: out.model, usage, status: 'ok', cached: false, latencyMs: Date.now() - started });

        const result = {
          text: out.content,
          json: json ? extractJson(out.content) : null,
          usage, model: out.model, finishReason: out.finish,
          latencyMs: Date.now() - started, waitedMs: waited,
          attempts: attempt, cached: false,
        };
        if (json && !result.json) {
          // Model ignored the schema: salvage what we can, but flag it.
          result.parseError = 'model returned non-JSON content';
        }
        return result;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;

        const status = err.status || (err.name === 'AbortError' ? 408 : 0);
        const modelDead = /model|not_found|deprecat|unsupported/i.test(`${err.code} ${err.message}`)
          && (status === 404 || status === 400);

        // reasoning_effort isn't accepted by every model -> retry once without it
        if (status === 400 && /reasoning_effort/i.test(err.message || '')) {
          config.groq.reasoningEffort = '';
          continue;
        }
        if (modelDead) break; // next candidate model

        const retryable = status === 429 || status >= 500 || status === 408 || status === 0;
        if (!retryable) {
          logUsage({ userId, endpoint, model: candidate, usage: null, status: 'error', cached: false, latencyMs: Date.now() - started });
          throw err;
        }

        const backoff = err.retryAfter
          ? err.retryAfter * 1000
          : jitter(2 ** (attempt - 1) * (status === 429 ? 4000 : 900));
        if (status === 429) tokenBudget.blockFor(Math.max(backoff, 1500));

        onProgress?.({ phase: 'retrying', attempt, waitMs: Math.round(backoff), model: candidate, reason: err.message });
        await sleep(backoff);
      }
    }
  }

  logUsage({ userId, endpoint, model: chain[0], usage: null, status: 'error', cached: false, latencyMs: Date.now() - started });
  if (lastErr instanceof GroqError) throw lastErr;
  throw new GroqError(lastErr?.message || 'Groq request failed', { code: 'upstream', status: 502 });
}

/* ------------------------------- audio ----------------------------------
   Voice pipeline pieces. Whisper is quota'd in audio-seconds (ASH), not TPM,
   so it only books a small request slot; Orpheus TTS IS token-metered
   (1.2K TPM / 3.6K TPD on the free tier), so its text cost is reserved
   against the governor like any chat call.                              */

const WHISPER_MODEL = 'whisper-large-v3-turbo';
const TTS_MODEL = 'canopylabs/orpheus-v1-english';
// Orpheus accepts exactly these voices (verified against the provider error):
// [autumn diana hannah austin daniel troy]. First success is cached.
const TTS_VOICES = ['daniel', 'diana', 'austin', 'hannah', 'autumn', 'troy'];
let ttsVoice = null;

/**
 * Speech-to-text. Audio bytes are forwarded to Groq and never stored.
 * @param {Buffer|Uint8Array} audio
 * @param {string} contentType e.g. audio/webm, audio/mp4
 * @param {{userId?:number, endpoint?:string}} meta
 */
export async function transcribe(audio, contentType = 'audio/webm', meta = {}) {
  if (!config.groq.apiKey) throw new GroqError('GROQ_API_KEY is not configured on the server.', { code: 'no_api_key', status: 503 });
  if (!audio?.byteLength) throw new GroqError('Empty audio payload.', { code: 'empty_audio', status: 400 });
  if (audio.byteLength > 25 * 1024 * 1024) throw new GroqError('Audio exceeds the 25 MB provider cap.', { code: 'audio_too_large', status: 413 });

  await tokenBudget.reserve(10, {}); // occupy a request slot only
  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType }), 'voice.webm');
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');

  const started = Date.now();
  const res = await fetch(`${config.groq.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.groq.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(config.groq.timeoutMs),
  });
  tokenBudget.syncFromHeaders(res.headers);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    logUsage({ userId: meta.userId, endpoint: 'ai.transcribe', model: WHISPER_MODEL, usage: null, status: 'error', cached: false, latencyMs: Date.now() - started });
    const errPayload = data?.error || {};
    throw new GroqError(errPayload.message || `Transcription failed (${res.status})`, {
      status: res.status === 404 ? 503 : res.status,
      code: res.status === 404 ? 'voice_unavailable' : (errPayload.code || `http_${res.status}`),
      retryAfter: Number(res.headers.get('retry-after')) || 0,
    });
  }
  logUsage({ userId: meta.userId, endpoint: 'ai.transcribe', model: WHISPER_MODEL, usage: { total_tokens: 0 }, status: 'ok', cached: false, latencyMs: Date.now() - started });
  return { text: String(data?.text || '').trim(), model: WHISPER_MODEL };
}

/**
 * Text-to-speech for coach replies. Returns raw audio bytes; the caller sets
 * the content type. Falls back through voice names, then the caller degrades
 * to text-only when the model is absent from the key.
 * @param {string} text capped by the caller
 */
export async function synthesize(text, meta = {}) {
  if (!config.groq.apiKey) throw new GroqError('GROQ_API_KEY is not configured on the server.', { code: 'no_api_key', status: 503 });
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) throw new GroqError('Nothing to say.', { code: 'empty_text', status: 400 });

  await tokenBudget.reserve(estimateTokens(clean), {}); // TTS is token-metered
  const voices = ttsVoice ? [ttsVoice, ...TTS_VOICES.filter((v) => v !== ttsVoice)] : TTS_VOICES;
  const started = Date.now();
  let lastErr = null;
  for (const voice of voices) {
    const res = await fetch(`${config.groq.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.groq.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, input: clean, voice, response_format: 'wav' }),
      signal: AbortSignal.timeout(config.groq.timeoutMs),
    });
    tokenBudget.syncFromHeaders(res.headers);
    if (res.ok) {
      ttsVoice = voice;
      const bytes = Buffer.from(await res.arrayBuffer());
      logUsage({ userId: meta.userId, endpoint: 'ai.speak', model: TTS_MODEL, usage: { total_tokens: estimateTokens(clean) }, status: 'ok', cached: false, latencyMs: Date.now() - started });
      return { bytes, contentType: res.headers.get('content-type') || 'audio/wav', voice };
    }
    const data = await res.json().catch(() => null);
    const code = data?.error?.code || '';
    if (code === 'model_terms_required') {
      throw new GroqError(
        'Voice replies need a one-time terms acceptance: Groq console → Models → Orpheus → Accept. Until then the coach stays text-only.',
        { status: 503, code: 'voice_terms_required' }
      );
    }
    lastErr = new GroqError(data?.error?.message || `Speech failed (${res.status})`, { status: res.status, code });
    if (res.status !== 400 && res.status !== 404) break; // bad voice vs real failure
  }
  logUsage({ userId: meta.userId, endpoint: 'ai.speak', model: TTS_MODEL, usage: null, status: 'error', cached: false, latencyMs: Date.now() - started });
  if (lastErr?.status === 404) throw new GroqError('No speech model on this key.', { code: 'voice_unavailable', status: 503 });
  throw lastErr || new GroqError('Speech synthesis failed.', { status: 502 });
}

/** Live model discovery so the UI can show what this key can actually call. */
export async function listModels() {
  const res = await fetch(`${config.groq.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.groq.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GroqError(`Groq /models returned ${res.status}`, { status: res.status, body: text.slice(0, 400) });
  }
  const data = await res.json();
  return (data?.data || [])
    .map((m) => ({ id: m.id, owned_by: m.owned_by, active: m.active !== false, context_window: m.context_window }))
    .filter((m) => !/whisper|distil|guard|orpheus|tts|embedding/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function aiStatus() {
  return {
    configured: Boolean(config.groq.apiKey),
    enabled: config.groq.enabled,
    // deliberately NO key fingerprint: even a masked prefix helps an attacker
    // verify guesses. The fingerprint is printed to the server boot log only.
    planningModel: config.groq.planningModel,
    fastModel: config.groq.fastModel,
    fallbackChain: config.groq.fallbackChain,
    budget: tokenBudget.snapshot(),
  };
}
