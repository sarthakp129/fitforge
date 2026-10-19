import { Router } from 'express';
import { get, run, tx } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.js';
import { auth, rateLimit } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { macroTargets, tdee } from '../services/nutrition.js';
import { verifyGoogleToken, isGoogleConfigured } from '../services/googleAuth.js';
import config from '../config.js';

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN_LENGTH = 12;

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  google_linked: Boolean(u.google_id),
  created_at: u.created_at,
});

function issueSession(res, user) {
  const token = signToken({ sub: user.id, email: user.email, sv: user.session_version || 1 });
  res.cookie('fitforge_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  });
  // token is retained in the response during the transition for API clients.
  // The first-party UI uses the HttpOnly cookie and does not persist it.
  return token;
}

/** Exposes public auth capabilities (e.g. Google Sign-In availability) */
router.get('/config', (req, res) => {
  res.json({
    google_configured: isGoogleConfigured(),
    google_client_id: config.googleClientId || null,
    password_min_length: PASSWORD_MIN_LENGTH,
  });
});

router.post('/register', rateLimit({ windowMs: 60_000, max: 8 }), async (req, res) => {
  const { email, name, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(mail)) throw new ApiError(400, 'A valid email is required.');
  if (String(password || '').length < PASSWORD_MIN_LENGTH) throw new ApiError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (get('SELECT id FROM users WHERE email = ?', mail)) throw new ApiError(409, 'That email is already registered.');
  const passwordHash = await hashPassword(password);

  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      mail, String(name || 'Athlete').slice(0, 60), passwordHash
    );
    run(`INSERT INTO profiles (user_id) VALUES (?)`, Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });

  const user = get('SELECT * FROM users WHERE id = ?', id);
  res.status(201).json({
    token: issueSession(res, user),
    user: publicUser(user),
    profile: get('SELECT * FROM profiles WHERE user_id = ?', id),
  });
});

router.post('/login', rateLimit({ windowMs: 15 * 60_000, max: 8 }), async (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', mail);
  if (!user || !await verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'Incorrect email or password.');
  }
  res.json({
    token: issueSession(res, user),
    user: publicUser(user),
    profile: get('SELECT * FROM profiles WHERE user_id = ?', user.id),
  });
});

/**
 * Google Sign-In endpoint.
 * Validates Google ID token cryptographically.
 * - If Google ID is linked, signs user in.
 * - If user does not exist, registers new user securely.
 * - If email exists with local password and NOT linked, rejects with 409 to prevent silent takeover.
 */
router.post('/google', rateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
  const { credential } = req.body || {};
  const googleUser = await verifyGoogleToken(credential);

  // 1. Check if user already exists by Google Subject ID
  let user = get('SELECT * FROM users WHERE google_id = ?', googleUser.sub);
  if (user) {
    return res.json({
      token: issueSession(res, user),
      user: publicUser(user),
      profile: get('SELECT * FROM profiles WHERE user_id = ?', user.id),
      is_new: false,
    });
  }

  // 2. Check if user exists by email without Google linkage
  const existingByEmail = get('SELECT * FROM users WHERE email = ?', googleUser.email);
  if (existingByEmail) {
    // Prevent unsafe automatic identity linking
    throw new ApiError(
      409,
      'An account with this email already exists with password authentication. Sign in with your password first, then link Google in Settings.',
      { requires_link: true }
    );
  }

  // 3. New user registration via Google
  const id = tx(() => {
    // Generate an unusable password placeholder for Google-only users
    const placeholderHash = `oauth:google$${googleUser.sub}`;
    const { lastInsertRowid } = run(
      'INSERT INTO users (email, name, password_hash, google_id) VALUES (?, ?, ?, ?)',
      googleUser.email,
      String(googleUser.name || 'Athlete').slice(0, 60),
      placeholderHash,
      googleUser.sub
    );
    run('INSERT INTO profiles (user_id) VALUES (?)', Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });

  user = get('SELECT * FROM users WHERE id = ?', id);
  res.status(201).json({
    token: issueSession(res, user),
    user: publicUser(user),
    profile: get('SELECT * FROM profiles WHERE user_id = ?', id),
    is_new: true,
  });
});

/** Link Google identity to the currently authenticated account */
router.post('/google/link', auth, async (req, res) => {
  const { credential } = req.body || {};
  const googleUser = await verifyGoogleToken(credential);

  const existingLink = get('SELECT id FROM users WHERE google_id = ?', googleUser.sub);
  if (existingLink && existingLink.id !== req.user.id) {
    throw new ApiError(409, 'This Google identity is already linked to another FitForge account.');
  }

  run('UPDATE users SET google_id = ? WHERE id = ?', googleUser.sub, req.user.id);
  const refreshed = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({
    ok: true,
    message: 'Google identity linked successfully.',
    user: publicUser(refreshed),
  });
});

/** Unlink Google identity from the currently authenticated account */
router.post('/google/unlink', auth, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!user.google_id) {
    throw new ApiError(400, 'No Google identity is linked to this account.');
  }

  // Ensure user has a valid password before disconnecting OAuth
  if (user.password_hash.startsWith('oauth:google')) {
    throw new ApiError(400, 'Please set an account password in Settings before unlinking Google so you can still log in.');
  }

  run('UPDATE users SET google_id = NULL WHERE id = ?', user.id);
  const refreshed = get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({
    ok: true,
    message: 'Google identity unlinked successfully.',
    user: publicUser(refreshed),
  });
});

router.get('/me', auth, (req, res) => {
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id);
  res.json({
    user: publicUser(req.user),
    profile,
    targets: profile ? macroTargets(profile) : null,
    tdee: profile ? tdee(profile) : null,
  });
});

router.patch('/me', auth, (req, res) => {
  const { name } = req.body || {};
  if (typeof name === 'string' && name.trim()) {
    run('UPDATE users SET name = ? WHERE id = ?', name.trim().slice(0, 60), req.user.id);
  }
  const refreshed = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ ok: true, user: publicUser(refreshed) });
});

router.post('/change-password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);

  // If user registered with Google and has placeholder hash, allow setting password without current
  const isOauthOnly = user.password_hash.startsWith('oauth:google');
  if (!isOauthOnly) {
    if (!await verifyPassword(current, user.password_hash)) {
      throw new ApiError(401, 'Current password is incorrect.');
    }
  }

  if (String(next || '').length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const hash = await hashPassword(next);
  run('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?', hash, user.id);
  const refreshed = get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ ok: true, token: issueSession(res, refreshed), user: publicUser(refreshed) });
});

router.post('/logout', auth, (req, res) => {
  // Revoking the version invalidates every bearer/cookie session for the user.
  run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', req.user.id);
  res.clearCookie('fitforge_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.status(204).end();
});

export default router;
