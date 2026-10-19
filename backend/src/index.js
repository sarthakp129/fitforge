import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import config, { missingSecrets, auditSecrets, provisionJwtSecret } from './config.js';
import { seedDemo, DEMO_EMAIL } from '../scripts/seed.js';
import { dbInfo, get } from './db.js';
import { notFound, errorHandler, ApiError } from './middleware/errors.js';
import { rateLimit } from './middleware/auth.js';
import tokenBudget from './services/tokenBudget.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import trainingRoutes from './routes/training.js';
import nutritionRoutes from './routes/nutrition.js';
import progressRoutes from './routes/progress.js';
import aiRoutes from './routes/ai.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

// Only enable proxy-derived client addressing when a deployment explicitly
// declares its trusted hop count. Direct/local deployments must not trust
// client-supplied forwarding headers.
app.set('trust proxy', Number.isInteger(Number(process.env.TRUST_PROXY_HOPS)) ? Number(process.env.TRUST_PROXY_HOPS) : false);
app.disable('x-powered-by');

app.use(cors({
  origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
  credentials: true,
  exposedHeaders: ['retry-after', 'content-disposition'],
}));
// Baseline security headers for deployments that do NOT sit behind nginx
// (nginx.conf sets the same set for the web tier).
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://api.groq.com https://accounts.google.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

if (!config.isProd) {
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - t}ms)`);
      }
    });
    next();
  });
}

/* -------------------------------- health -------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    demo: Boolean(get('SELECT id FROM users WHERE email = ?', DEMO_EMAIL)),
    service: 'fitforge-api',
    version: '1.0.0',
    time: new Date().toISOString(),
    db: dbInfo.path,
    ai: {
      configured: Boolean(config.groq.apiKey),
      enabled: config.groq.enabled,
      planning_model: config.groq.planningModel,
      fast_model: config.groq.fastModel,
      budget: tokenBudget.snapshot(),
    },
  });
});

app.get('/api', (req, res) => {
  res.json({
    name: 'FitForge API',
    docs: '/api/health',
    routes: [
      'POST   /api/auth/register | /api/auth/login',
      'GET    /api/auth/me',
      'GET/PUT/api/profile',
      'POST   /api/profile/onboard',
      'GET    /api/training/exercises | /api/training/next',
      'GET/POST/PUT/DELETE /api/training/workouts',
      'GET    /api/nutrition/foods | /api/nutrition/daily | /api/nutrition/range',
      'POST   /api/nutrition/log | /api/nutrition/log-batch | /api/nutrition/copy-day',
      'GET/POST/DELETE /api/progress/metrics',
      'GET    /api/progress/stats/overview | /volume | /prs | /heatmap | /muscles',
      'GET    /api/progress/export | /api/progress/export.csv | POST /api/progress/import',
      'GET    /api/ai/status | /api/ai/models | /api/ai/usage | /api/ai/insight',
      'POST   /api/ai/test',
      'POST   /api/ai/plans/training | /api/ai/plans/nutrition   (?stream=1 for SSE)',
      'GET    /api/ai/plans | /api/ai/plans/:id | /api/ai/plans/active/:kind',
      'POST   /api/ai/coach | GET /api/ai/chat',
    ],
  });
});

/* --------------------------------- api ---------------------------------- */

app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 60 }), authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/ai', aiRoutes);

/* --------------------------- optional SPA host -------------------------- */

const dist = resolve(join(here, '../../frontend/dist'));
if (existsSync(join(dist, 'index.html'))) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  console.log(`[fitforge] serving frontend build from ${dist}`);
}

app.use('/api', notFound);

app.use((req, res, next) => {
  if (existsSync(join(dist, 'index.html'))) {
    return res.sendFile(join(dist, 'index.html'), (err) => { if (err) next(err); });
  }
  res.status(404).json({ error: 'not_found', message: `${req.method} ${req.path}` });
});

app.use(errorHandler);

/* --------------------------------- boot --------------------------------- */

// Session-signing key: use yours if you set a strong one, otherwise a random
// key is generated once and persisted next to the database. A known placeholder
// is never used, so a fresh install is secure with zero configuration.
const jwtProvision = provisionJwtSecret();
config.jwtSecret = jwtProvision.secret;
config.jwtSecretSource = jwtProvision.source;

const audit = auditSecrets();
for (const w of audit.warn) console.warn(`[fitforge] ⚠ ${w}`);
if (jwtProvision.note) console.warn(`[fitforge] ⚠ ${jwtProvision.note}`);

// Demo account: convenience for local/dev/demo installs ONLY. A published
// password must never auto-exist on a production box.
if (config.env !== 'production' || process.env.DEMO_ACCOUNT === 'true') {
  try {
    if (!get('SELECT id FROM users WHERE email = ?', DEMO_EMAIL)) {
      seedDemo({ verbose: false });
      console.log('[fitforge] demo account ready: xyz@gmail.com / xyz');
    }
  } catch (err) {
    console.warn('[fitforge] demo seed skipped:', err.message);
  }
}

const server = app.listen(config.port, config.host, () => {
  const secrets = missingSecrets();
  console.log('');
  console.log('  ███████ ██ ████████  ██████  ██████   ██████  ███████');
  console.log('  ██      ██    ██    ██      ██       ██       ██');
  console.log('  █████   ██    ██    ██      ██   ███ ██   ███ █████');
  console.log('  ██      ██    ██    ██      ██    ██ ██    ██ ██');
  console.log('  ██      ██    ██     ██████  ██████   ██████  ███████  API');
  console.log('');
  console.log(`  env        ${config.env}`);
  console.log(`  listening  http://${config.host}:${config.port}`);
  console.log(`  database   ${dbInfo.path}`);
  console.log(`  jwt        ${jwtProvision.source === 'env' ? 'from JWT_SECRET env' :
    jwtProvision.source === 'file' ? `persisted key (${jwtProvision.path})` :
    jwtProvision.source === 'generated' ? `generated & saved to ${jwtProvision.path}` :
    'in-memory only (sessions reset on restart)'}`);
  console.log(`  groq key   ${config.groq.apiKeyFingerprint || 'NOT SET (engine-only mode)'}`);
  console.log(`  models     plan=${config.groq.planningModel}  chat=${config.groq.fastModel}`);
  console.log(`  budget     ${tokenBudget.tpm} TPM · ${tokenBudget.rpm} RPM · ${tokenBudget.rpd} RPD`);
  if (secrets.length) console.log(`  ⚠ missing   ${secrets.join(', ')}`);
  console.log('');
});

const shutdown = (signal) => {
  console.log(`\n[fitforge] ${signal} received, closing…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[fitforge] unhandled rejection:', e));

export default app;
