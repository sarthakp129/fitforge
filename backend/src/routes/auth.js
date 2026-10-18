import { Router } from 'express';
import { get, run, tx } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.js';
import { auth, rateLimit } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { macroTargets, tdee } from '../services/nutrition.js';

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN_LENGTH = 12;

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at });

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

router.get('/me', auth, (req, res) => {
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', req.user.id);
  res.json({
    user: publicUser(req.user),
    profile,
    targets: profile ? macroTargets(profile) : null,
    tdee: profile ? tdee(profile) : null,
  });
});

router.post('/change-password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!await verifyPassword(current, user.password_hash)) throw new ApiError(401, 'Current password is incorrect.');
  if (String(next || '').length < PASSWORD_MIN_LENGTH) throw new ApiError(400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  const hash = await hashPassword(next);
  run('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?', hash, user.id);
  const refreshed = get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ ok: true, token: issueSession(res, refreshed) });
});

router.post('/logout', auth, (req, res) => {
  // Revoking the version invalidates every bearer/cookie session for the user.
  run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', req.user.id);
  res.clearCookie('fitforge_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.status(204).end();
});

export default router;
