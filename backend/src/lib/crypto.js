/**
 * Password hashing + JWT, both on node:crypto. Zero dependencies.
 */
import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import config from '../config.js';

const KEYLEN = 32;
const scryptAsync = promisify(scrypt);

/** Async so an expensive password operation never blocks every API request. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(String(password), salt, KEYLEN)).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/** Only for the local/demo data seeder, which runs before the HTTP server. */
export function hashPasswordForSeed(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(String(password), salt, KEYLEN).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scryptAsync(String(password), salt, KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64url').replace(/=+$/, '');

function secret() {
  const s = config.jwtSecret || process.env.JWT_SECRET;
  if (s) return s;
  // Deterministic per-install fallback derived from the data dir so sessions
  // survive restarts even when JWT_SECRET was never set (dev convenience).
  return `fitforge-dev-secret::${config.dataDir}`;
}

export function signToken(payload, ttlSeconds = config.jwtTtlSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({ ...payload, iat: now, exp: now + Math.floor(ttlSeconds) })
  );
  const sig = b64url(
    createHmac('sha256', secret()).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(
    createHmac('sha256', secret()).update(`${header}.${body}`).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
