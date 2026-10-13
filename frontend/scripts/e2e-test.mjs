/**
 * Runner for the jsdom end-to-end UI test.
 *
 *  1. boots the real backend on a throwaway database (AI disabled -> free)
 *  2. seeds a realistic athlete: profile, plans, workouts, meals, weigh-ins
 *  3. builds a jsdom environment and mounts the real <App/> against it
 *  4. drives the UI and reports
 *
 *   npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const backendRoot = join(root, '../backend');
const PORT = 4200 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'fitforge-e2e-'));

const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['--no-warnings', 'src/index.js'], {
  cwd: backendRoot,
  env: {
    ...process.env,
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir,
    NODE_ENV: 'test', GROQ_ENABLED: 'false', AI_COOLDOWN_SECONDS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

const cleanup = async (code) => {
  child.kill('SIGTERM');
  await wait(120);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
};

async function waitForApi(tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* booting */ }
    await wait(100);
  }
  throw new Error(`backend did not start on ${BASE}\n${serverLog.slice(-1200)}`);
}

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 240)}`);
  return json;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function seed() {
  const email = `e2e-${Date.now()}@fitforge.test`;
  const reg = await call('POST', '/api/auth/register', { email, name: 'Test Athlete', password: 'e2epassword' });
  const token = reg.token;

  await call('POST', '/api/profile/onboard', {
    sex: 'male', birth_date: '1994-05-11', height_cm: 181, weight_kg: 82.4, body_fat_pct: 17,
    target_weight_kg: 78, activity_level: 'moderate', goal: 'muscle_gain', experience: 'intermediate',
    days_per_week: 4, session_minutes: 65, equipment: 'full_gym', injuries: '',
    diet_pref: 'omnivore', focus_areas: 'chest, back', sleep_hours: 7,
  }, token);

  const sessions = [
    { date: daysAgo(9), name: 'Push A', focus: 'push', duration_s: 3900, sets: [
      { exercise_id: 'bench_press', set_number: 1, reps: 8, weight_kg: 95, rpe: 8 },
      { exercise_id: 'bench_press', set_number: 2, reps: 7, weight_kg: 95, rpe: 9 },
      { exercise_id: 'overhead_press', set_number: 1, reps: 10, weight_kg: 52, rpe: 8 },
      { exercise_id: 'lateral_raise', set_number: 1, reps: 15, weight_kg: 12, rpe: 9 },
    ] },
    { date: daysAgo(7), name: 'Pull A', focus: 'pull', duration_s: 3500, sets: [
      { exercise_id: 'barbell_row', set_number: 1, reps: 8, weight_kg: 82, rpe: 8 },
      { exercise_id: 'lat_pulldown', set_number: 1, reps: 12, weight_kg: 60, rpe: 8 },
      { exercise_id: 'hammer_curl', set_number: 1, reps: 12, weight_kg: 16, rpe: 8 },
    ] },
    { date: daysAgo(5), name: 'Legs', focus: 'legs', duration_s: 4200, sets: [
      { exercise_id: 'back_squat', set_number: 1, reps: 5, weight_kg: 142, rpe: 8 },
      { exercise_id: 'back_squat', set_number: 2, reps: 5, weight_kg: 142, rpe: 9 },
      { exercise_id: 'romanian_deadlift', set_number: 1, reps: 10, weight_kg: 112, rpe: 8 },
      { exercise_id: 'standing_calf_raise', set_number: 1, reps: 15, weight_kg: 62, rpe: 8 },
    ] },
    { date: daysAgo(2), name: 'Upper', focus: 'upper', duration_s: 3600, sets: [
      { exercise_id: 'incline_db_press', set_number: 1, reps: 10, weight_kg: 34, rpe: 8 },
      { exercise_id: 'seated_cable_row', set_number: 1, reps: 12, weight_kg: 65, rpe: 8 },
      { exercise_id: 'plank', set_number: 1, reps: 1, weight_kg: 0, rpe: 7 },
    ] },
  ];
  for (const s of sessions) await call('POST', '/api/training/workouts', s, token);

  for (const [date, items] of [
    [daysAgo(1), [['breakfast', 'Greek yogurt 0%', 200], ['lunch', 'Chicken breast, skinless (cooked)', 180], ['dinner', 'White rice (cooked)', 250]]],
    [daysAgo(0), [['breakfast', 'Oats, dry', 70], ['lunch', 'Salmon (cooked)', 150]]],
  ]) {
    for (const [meal, food, grams] of items) {
      await call('POST', '/api/nutrition/log', { date, meal_type: meal, food_name: food, grams }, token);
    }
  }

  for (const [n, w, bf] of [[28, 84.6, 18.2], [14, 83.5, 17.6], [7, 82.9, 17.1], [3, 82.4, 16.8]]) {
    await call('POST', '/api/progress/metrics', { date: daysAgo(n), weight_kg: w, body_fat_pct: bf }, token);
  }

  const tp = await call('POST', '/api/ai/plans/training', { weeks: 4 }, token);
  const np = await call('POST', '/api/ai/plans/nutrition', {}, token);
  log(`  seeded: 4 workouts · 5 meals · 4 weigh-ins · training plan (${tp.plan.schedule.length} days) · nutrition plan (${np.plan.meals.length} meals)`);
  return token;
}

async function setupJsdom() {
  const dom = new JSDOM('<!doctype html><html><head><title>FitForge</title></head><body><div id="root"></div></body></html>', {
    url: `${BASE}/`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    // swallow jsdom's "Not implemented" noise (scrollTo, canvas, WebGL…)
    virtualConsole: new VirtualConsole(),
  });

  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.Element.prototype.scrollTo = function scrollTo() {};
  window.HTMLElement.prototype.scrollIntoView = window.Element.prototype.scrollIntoView;
  window.navigator.vibrate = () => true;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

  // Node 21+ defines a read-only globalThis.navigator, so every global has to be
  // installed with defineProperty rather than plain assignment.
  const define = (key, value) => {
    if (value === undefined) return;
    try {
      Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    } catch { /* leave the host global in place */ }
  };
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement',
    'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLCanvasElement',
    'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'localStorage', 'IntersectionObserver', 'SVGElement', 'CustomEvent',
    'FormData', 'Blob', 'DOMParser', 'CSS']) {
    define(key, window[key]);
  }
  define('self', window);
  return window;
}

async function main() {
  log('\nFitForge end-to-end');
  await waitForApi();
  log(`  api      ${BASE}`);

  const token = await seed();

  const window = await setupJsdom();
  globalThis.__FITFORGE_TOKEN__ = token;
  globalThis.__FF_SEED__ = { cwd: backendRoot, dataDir };
  // The zustand store reads the token at module-evaluation time, so it has to be
  // in place before the bundle is required.
  window.localStorage.setItem('fitforge.token', token);

  const outfile = join(dataDir, 'e2e-bundle.cjs');
  await build({
    entryPoints: [join(root, 'test/e2e.app.jsx')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE: BASE, MODE: 'test' }) },
    logLevel: 'error',
    absWorkingDir: root,
  });

  const require = createRequire(pathToFileURL(join(root, 'package.json')));
  const mod = require(outfile);
  const ok = await mod.default();
  await cleanup(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nfatal:', err.message);
  if (serverLog) console.error('--- backend log ---\n' + serverLog.slice(-1500));
  await cleanup(1);
});
