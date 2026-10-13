import { Router } from 'express';
import { get, run, tx } from '../db.js';
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.js';
import { auth, rateLimit } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { macroTargets, tdee } from '../services/nutrition.js';

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at });

router.post('/register', rateLimit({ windowMs: 60_000, max: 8 }), (req, res) => {
  const { email, name, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(mail)) throw new ApiError(400, 'A valid email is required.');
  if (String(password || '').length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');
  if (get('SELECT id FROM users WHERE email = ?', mail)) throw new ApiError(409, 'That email is already registered.');

  const id = tx(() => {
    const { lastInsertRowid } = run(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      mail, String(name || 'Athlete').slice(0, 60), hashPassword(password)
    );
    run(`INSERT INTO profiles (user_id) VALUES (?)`, Number(lastInsertRowid));
    return Number(lastInsertRowid);
  });

  const user = get('SELECT * FROM users WHERE id = ?', id);
  res.status(201).json({
    token: signToken({ sub: user.id, email: user.email }),
    user: publicUser(user),
    profile: get('SELECT * FROM profiles WHERE user_id = ?', id),
  });
});

router.post('/login', rateLimit({ windowMs: 60_000, max: 12 }), (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', mail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, 'Incorrect email or password.');
  }
  res.json({
    token: signToken({ sub: user.id, email: user.email }),
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

router.post('/change-password', auth, (req, res) => {
  const { current, next } = req.body || {};
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(current, user.password_hash)) throw new ApiError(401, 'Current password is incorrect.');
  if (String(next || '').length < 6) throw new ApiError(400, 'New password must be at least 6 characters.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
  res.json({ ok: true });
});

export default router;
