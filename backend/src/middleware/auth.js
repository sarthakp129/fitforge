import { get, run } from '../db.js';
import { verifyToken } from '../lib/crypto.js';

/** Require a valid bearer token or first-party HttpOnly session cookie. */
export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const cookieToken = String(req.headers.cookie || '').split(';').map((v) => v.trim())
    .find((v) => v.startsWith('fitforge_session='))?.slice('fitforge_session='.length);
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : (cookieToken || '');
  const claims = verifyToken(token);
  if (!claims || !claims.sub) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or expired token.' });
  }
  const user = get('SELECT id, email, name, created_at, session_version FROM users WHERE id = ?', Number(claims.sub));
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Account no longer exists.' });
  if (Number(claims.sv || 0) !== Number(user.session_version || 1)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Session has been revoked.' });
  }
  req.user = user;
  next();
}

/** Simple in-memory sliding window limiter, per key. */
export function rateLimit({ windowMs = 60_000, max = 60, key = (req) => req.ip } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const id = key(req);
    const now = Date.now();
    const bucket = (hits.get(id) || []).filter((t) => now - t < windowMs);
    if (bucket.length >= max) {
      const retryIn = Math.ceil((windowMs - (now - bucket[0])) / 1000);
      res.set('Retry-After', String(retryIn));
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many requests. Try again in ${retryIn}s.`,
        retryIn,
      });
    }
    bucket.push(now);
    hits.set(id, bucket);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs * 2) hits.delete(k);
    }
    next();
  };
}

/** Guards the expensive AI routes with a short per-user cooldown. */
export function aiCooldown(seconds) {
  const last = new Map();
  return (req, res, next) => {
    const id = String(req.user?.id || req.ip);
    const prev = last.get(id) || 0;
    const now = Date.now();
    if (now - prev < seconds * 1000) {
      const wait = Math.ceil((seconds * 1000 - (now - prev)) / 1000);
      return res.status(429).json({
        error: 'cooldown',
        message: `AI cooldown active. Try again in ${wait}s.`,
        retryIn: wait,
      });
    }
    last.set(id, now);
    next();
  };
}

export function requireBody(fields) {
  return (req, res, next) => {
    const missing = fields.filter((f) => {
      const v = req.body?.[f];
      return v === undefined || v === null || v === '';
    });
    if (missing.length) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `Missing field(s): ${missing.join(', ')}`,
        missing,
      });
    }
    next();
  };
}

export const touchProfile = (userId) =>
  run(`UPDATE profiles SET updated_at = datetime('now') WHERE user_id = ?`, userId);
