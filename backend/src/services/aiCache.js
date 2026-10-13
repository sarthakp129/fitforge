import { createHash } from 'node:crypto';
import { get, run } from '../db.js';
import config from '../config.js';

/** Content-addressed cache. Saves the most precious resource: TPM. */
export function cacheKey(kind, payload) {
  const normalised = JSON.stringify(payload, Object.keys(payload ?? {}).sort());
  return `${kind}:${createHash('sha256').update(normalised).digest('hex').slice(0, 40)}`;
}

export function cacheGet(key) {
  const row = get('SELECT * FROM ai_cache WHERE key = ?', key);
  if (!row) return null;
  const ageSec = (Date.now() - Date.parse(row.created_at.replace(' ', 'T') + 'Z')) / 1000;
  if (Number.isFinite(ageSec) && ageSec > config.groq.cacheTtlSeconds) {
    run('DELETE FROM ai_cache WHERE key = ?', key);
    return null;
  }
  run('UPDATE ai_cache SET hits = hits + 1 WHERE key = ?', key);
  try {
    return { payload: JSON.parse(row.payload), model: row.model, tokens: row.tokens, hits: row.hits + 1 };
  } catch {
    return null;
  }
}

export function cacheSet(key, kind, payload, { model = '', tokens = 0 } = {}) {
  try {
    run(
      `INSERT INTO ai_cache (key, kind, model, payload, tokens)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         payload = excluded.payload, model = excluded.model,
         tokens = excluded.tokens, created_at = datetime('now')`,
      key, kind, model, JSON.stringify(payload), Number(tokens) || 0
    );
  } catch (err) {
    console.warn('[cache] write failed:', err.message);
  }
}

export function cachePurge(kind) {
  return kind ? run('DELETE FROM ai_cache WHERE kind = ?', kind) : run('DELETE FROM ai_cache');
}

export function cacheStats() {
  return get(
    `SELECT COUNT(*) AS entries, COALESCE(SUM(hits),0) AS hits, COALESCE(SUM(tokens),0) AS tokens_saved
     FROM ai_cache`
  );
}
