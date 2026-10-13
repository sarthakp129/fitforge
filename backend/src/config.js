import { loadEnv, bool, num } from './lib/env.js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

loadEnv(process.env.ENV_FILE || '.env');

const required = [];
const str = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v;
};

/**
 * Model fallback chain. Groq retired llama-3.3-70b-versatile and
 * llama-3.1-8b-instant for free/developer tiers on 2026-08-16, so the defaults
 * below are the currently served models. Everything is overridable via env.
 *
 *   GROQ_MODEL        -> "planning" model (higher quality)
 *   GROQ_MODEL_FAST   -> chat / quick answers (cheaper on tokens)
 *   GROQ_MODEL_CHAIN  -> comma separated fallbacks tried in order
 */
const PLANNING_DEFAULT = 'openai/gpt-oss-120b';
const FAST_DEFAULT = 'openai/gpt-oss-20b';

const chain = str('GROQ_MODEL_CHAIN', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  env: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: num(process.env.PORT, 8080),
  host: str('HOST', '0.0.0.0'),

  dataDir: str('DATA_DIR', './data'),
  dbFile: str('DB_FILE', ''),

  // --- auth -------------------------------------------------------------
  jwtSecret: str('JWT_SECRET', ''),
  jwtTtlSeconds: num(process.env.JWT_TTL_SECONDS, 60 * 60 * 24 * 30),

  // --- cors -------------------------------------------------------------
  corsOrigins: str('CORS_ORIGINS', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // --- groq / ai --------------------------------------------------------
  groq: {
    apiKey: str('GROQ_API_KEY', ''),
    baseUrl: str('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
    planningModel: str('GROQ_MODEL', PLANNING_DEFAULT),
    fastModel: str('GROQ_MODEL_FAST', FAST_DEFAULT),
    // de-duplicated: retrying the same model twice just burns RPM on a free key
    fallbackChain: [...new Set(
      chain.length
        ? chain
        : [PLANNING_DEFAULT, FAST_DEFAULT, 'qwen/qwen3.8-27b']
    )],
    // Free tier is 8K TPM / 30 RPM / 1K RPD on the current models.
    // We stay well under it by default and let response headers tighten us.
    tokensPerMinute: num(process.env.GROQ_TPM, 6000),
    requestsPerMinute: num(process.env.GROQ_RPM, 20),
    requestsPerDay: num(process.env.GROQ_RPD, 900),
    maxTokensPlan: num(process.env.GROQ_MAX_TOKENS_PLAN, 900),
    maxTokensChat: num(process.env.GROQ_MAX_TOKENS_CHAT, 500),
    timeoutMs: num(process.env.GROQ_TIMEOUT_MS, 45000),
    maxRetries: num(process.env.GROQ_MAX_RETRIES, 4),
    // gpt-oss are reasoning models: reasoning tokens eat the TPM budget.
    reasoningEffort: str('GROQ_REASONING_EFFORT', 'low'),
    temperature: num(process.env.GROQ_TEMPERATURE, 0.6),
    cacheTtlSeconds: num(process.env.GROQ_CACHE_TTL_SECONDS, 60 * 60 * 24 * 14),
    enabled: bool(process.env.GROQ_ENABLED, true),
  },

  // Deterministic local engine always available (works with zero API tokens).
  engineFallback: bool(process.env.ENGINE_FALLBACK, true),

  // Per-IP throttle for expensive AI endpoints (seconds).
  aiCooldownSeconds: num(process.env.AI_COOLDOWN_SECONDS, 5),

  // Allow logged-in users to retune the governor / purge cache at runtime.
  // Single-tenant self-hosting: on is convenient. Multi-user deployments
  // should set AI_RUNTIME_TUNING=false (see docs/SECURITY_REVIEW.md).
  aiRuntimeTuning: bool(process.env.AI_RUNTIME_TUNING, true),
};

if (config.groq.apiKey) {
  const k = config.groq.apiKey;
  config.groq.apiKeyFingerprint = `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export function missingSecrets() {
  if (!config.groq.apiKey) required.push('GROQ_API_KEY');
  if (config.isProd && !config.jwtSecret) required.push('JWT_SECRET');
  return [...new Set(required)];
}

/**
 * Values that must never be used as a signing key: they are public (they ship
 * in .env.example and this README), so anyone could forge a session token.
 */
const PLACEHOLDER_SECRETS = new Set([
  '', 'change-me-to-a-long-random-string', 'changeme', 'change_me',
  'secret', 'fitforge', 'jwt_secret', 'dev', 'password',
]);

/**
 * Resolve the session-signing key, in order of preference:
 *   1. a strong JWT_SECRET from the environment (you set it yourself),
 *   2. a key persisted in DATA_DIR/jwt.secret from an earlier boot,
 *   3. a freshly generated 96-char key, written to DATA_DIR/jwt.secret (0600).
 *
 * This means a first-time user who just copies .env.example gets a *random*
 * secret instead of a public placeholder, and it survives container restarts
 * because it lives on the Docker volume. Nothing to configure, nothing weak.
 *
 * @returns {{secret:string, source:'env'|'file'|'generated'|'memory', path?:string, note?:string}}
 */
export function provisionJwtSecret() {
  const fromEnv = String(process.env.JWT_SECRET || '').trim();

  if (fromEnv && !PLACEHOLDER_SECRETS.has(fromEnv.toLowerCase())) {
    const note = fromEnv.length < 32
      ? `JWT_SECRET is only ${fromEnv.length} characters; 32+ is recommended (openssl rand -hex 32).`
      : undefined;
    return { secret: fromEnv, source: 'env', note };
  }

  const path = join(resolve(config.dataDir), 'jwt.secret');
  try {
    if (existsSync(path)) {
      const stored = readFileSync(path, 'utf8').trim();
      if (stored.length >= 32 && !PLACEHOLDER_SECRETS.has(stored.toLowerCase())) {
        return { secret: stored, source: 'file', path };
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    const secret = randomBytes(48).toString('hex');
    writeFileSync(path, secret, { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* platform-dependent */ }
    return { secret, source: 'generated', path };
  } catch (err) {
    // Unwritable data dir: still never fall back to a known key.
    return {
      secret: randomBytes(48).toString('hex'),
      source: 'memory',
      note: `could not persist a signing key (${err.message}); sessions reset on restart.`,
    };
  }
}

/** Non-fatal warnings shown at boot. */
export function auditSecrets() {
  const warn = [];
  if (!config.groq.apiKey) {
    warn.push('GROQ_API_KEY is not set — plans and coach answers will come from the local engine.');
  }
  if (config.isProd && config.corsOrigins.includes('*')) {
    warn.push('CORS_ORIGINS is "*" in production; set it to your own origin if the app is internet-facing.');
  }
  return { fatal: [], warn };
}

export default config;
