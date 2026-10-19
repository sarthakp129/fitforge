/**
 * End-to-end smoke test. Boots the real server on a throwaway database and
 * exercises every route group. Runs with GROQ disabled by default so it is
 * deterministic and costs zero tokens.
 *
 *   npm test                 -> engine paths only
 *   GROQ_API_KEY=gsk_... npm test  -> also hits the live model
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
// random ephemeral-ish port so a stale process can never hijack a run
const PORT = Number(process.env.TEST_PORT || 4200 + Math.floor(Math.random() * 800));
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = Boolean(process.env.GROQ_API_KEY && process.env.TEST_LIVE === '1');

const dataDir = mkdtempSync(join(tmpdir(), 'fitforge-test-'));
let token = null;
let passed = 0;
const failures = [];

const child = spawn(process.execPath, ['--no-warnings', join(here, '../src/index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    NODE_ENV: 'test',
    GROQ_API_KEY: LIVE ? process.env.GROQ_API_KEY : '',   // tests must not read a dev .env
    ENV_FILE: '.env.does-not-exist',
    GROQ_ENABLED: LIVE ? 'true' : 'false',
    GROQ_TPM: process.env.GROQ_TPM || '6000',
    AI_COOLDOWN_SECONDS: '0',
    AI_RUNTIME_TUNING: 'true',
    ADMIN_EMAILS: 'athlete@fitforge.test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitUp(tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

async function call(method, path, body, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && !opts.noAuth ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined || method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, body: json, headers: res.headers };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    const cause = err.cause ? ` (cause: ${err.cause.code || ''} ${err.cause.message || ''})` : '';
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').slice(0, 6).join('\n      ')}${cause}`);
  }
}

const localDate = (ms = Date.now()) => {
  const d = new Date(ms);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
const today = localDate();
const daysAgo = (n) => localDate(Date.now() - n * 86400000);

async function main() {
  console.log('\nFitForge API smoke test');
  console.log(`  node ${process.version} · db ${dataDir} · live-ai ${LIVE}\n`);
  const health = await waitUp();

  await test('GET /api/health reports ai state', () => {
    assert.equal(health.ok, true);
    assert.equal(typeof health.ai.budget.tokensPerMinute, 'number');
  });

  await test('GET /api lists the route surface', async () => {
    const r = await call('GET', '/api');
    assert.equal(r.status, 200);
    assert.ok(r.body.routes.length > 10);
  });

  await test('POST /api/auth/register creates account + empty profile', async () => {
    const r = await call('POST', '/api/auth/register', {
      email: 'athlete@fitforge.test', name: 'Test Athlete', password: 'strongpass123',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.token);
    assert.ok(r.body.profile);
    token = r.body.token;
  });

  await test('duplicate email is rejected with 409', async () => {
    const r = await call('POST', '/api/auth/register', {
      email: 'athlete@fitforge.test', name: 'x', password: 'strongpass123',
    }, { noAuth: true });
    assert.equal(r.status, 409);
  });

  await test('weak password is rejected with 400', async () => {
    const r = await call('POST', '/api/auth/register', { email: 'b@c.de', password: '123' }, { noAuth: true });
    assert.equal(r.status, 400);
  });

  await test('POST /api/auth/login returns a working token', async () => {
    const r = await call('POST', '/api/auth/login', { email: 'athlete@fitforge.test', password: 'strongpass123' }, { noAuth: true });
    assert.equal(r.status, 200);
    token = r.body.token;
    const me = await call('GET', '/api/auth/me');
    assert.equal(me.body.user.email, 'athlete@fitforge.test');
  });

  await test('wrong password gives 401', async () => {
    const r = await call('POST', '/api/auth/login', { email: 'athlete@fitforge.test', password: 'nope' }, { noAuth: true });
    assert.equal(r.status, 401);
  });

  await test('protected route rejects anonymous caller', async () => {
    const r = await call('GET', '/api/profile', null, { noAuth: true });
    assert.equal(r.status, 401);
  });

  await test('GET /api/auth/config reports auth capabilities', async () => {
    const r = await call('GET', '/api/auth/config', null, { noAuth: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.google_configured, 'boolean');
    assert.equal(r.body.password_min_length, 12);
  });

  await test('POST /api/auth/google registers a new user with Google identity', async () => {
    const r = await call('POST', '/api/auth/google', {
      credential: 'test-google-token:sub-google-1:newathlete@fitforge.test:Google Athlete:valid',
    }, { noAuth: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.email, 'newathlete@fitforge.test');
    assert.equal(r.body.user.google_linked, true);
    assert.equal(r.body.is_new, true);
  });

  await test('POST /api/auth/google logs in returning Google user', async () => {
    const r = await call('POST', '/api/auth/google', {
      credential: 'test-google-token:sub-google-1:newathlete@fitforge.test:Google Athlete:valid',
    }, { noAuth: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'newathlete@fitforge.test');
    assert.equal(r.body.is_new, false);
  });

  await test('POST /api/auth/google automatically links verified Google identity to existing account', async () => {
    const r = await call('POST', '/api/auth/google', {
      credential: 'test-google-token:sub-athlete-linked:athlete@fitforge.test:Test Athlete:valid',
    }, { noAuth: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, 'athlete@fitforge.test');
    assert.equal(r.body.user.google_linked, true);
  });

  await test('POST /api/auth/google/unlink disconnects Google identity', async () => {
    const r = await call('POST', '/api/auth/google/unlink', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    const me = await call('GET', '/api/auth/me');
    assert.equal(me.body.user.google_linked, false);
  });

  await test('POST /api/auth/google/link links Google identity to authenticated account', async () => {
    const r = await call('POST', '/api/auth/google/link', {
      credential: 'test-google-token:sub-athlete-linked:athlete@fitforge.test:Test Athlete:valid',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    const me = await call('GET', '/api/auth/me');
    assert.equal(me.body.user.google_linked, true);
  });

  await test('PUT /api/profile persists timezone, units, and favorite exercises', async () => {
    const r = await call('PUT', '/api/profile', {
      timezone: 'Asia/Kolkata',
      units: 'metric',
      favorite_exercises: ['bench_press', 'barbell_squat'],
    });
    assert.equal(r.status, 200);
    const p = await call('GET', '/api/profile');
    assert.equal(p.body.profile.timezone, 'Asia/Kolkata');
    assert.equal(p.body.profile.units, 'metric');
    assert.deepEqual(p.body.profile.favorite_exercises, ['bench_press', 'barbell_squat']);
  });

  await test('saved meals lifecycle: create, list, and delete', async () => {
    const created = await call('POST', '/api/profile/saved-meals', {
      name: 'Oats & Whey',
      calories: 450,
      protein_g: 40,
      carbs_g: 50,
      fat_g: 8,
      items: [{ food_name: 'Rolled Oats', grams: 80 }, { food_name: 'Whey Isolate', grams: 35 }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Oats & Whey');

    const list = await call('GET', '/api/profile/saved-meals');
    assert.equal(list.status, 200);
    assert.ok(list.body.some((m) => m.name === 'Oats & Whey'));

    const del = await call('DELETE', `/api/profile/saved-meals/${created.body.id}`);
    assert.equal(del.status, 200);
  });

  await test('POST /api/profile/onboard validates and persists', async () => {
    const r = await call('POST', '/api/profile/onboard', {
      sex: 'male', birth_date: '1994-05-11', height_cm: 181, weight_kg: 82.4,
      body_fat_pct: 17, activity_level: 'moderate', goal: 'muscle_gain',
      experience: 'intermediate', days_per_week: 4, session_minutes: 65,
      equipment: 'full_gym', injuries: 'mild left knee tendinopathy',
      diet_pref: 'omnivore', sleep_hours: 7, focus_areas: 'chest, back',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.profile.days_per_week, 4);
    assert.ok(r.body.derived.macros.calories > 2000);
    assert.ok(r.body.derived.macros.protein_g > 100);
  });

  await test('out-of-range profile values are clamped, not stored raw', async () => {
    const r = await call('PUT', '/api/profile', { weight_kg: 9999, days_per_week: 99, goal: 'not_a_goal' });
    assert.equal(r.status, 200);
    assert.ok(r.body.profile.weight_kg <= 250);
    assert.ok(r.body.profile.days_per_week <= 7);
    assert.equal(r.body.profile.goal, 'muscle_gain', 'invalid enum must be ignored');
    await call('PUT', '/api/profile', { weight_kg: 82.4, days_per_week: 4 });
  });

  await test('GET /api/profile returns derived BMR/TDEE/macros', async () => {
    const r = await call('GET', '/api/profile');
    assert.equal(r.status, 200);
    assert.ok(r.body.derived.bmr > 1500 && r.body.derived.bmr < 2300, `bmr=${r.body.derived.bmr}`);
    assert.ok(r.body.derived.tdee > r.body.derived.bmr);
    assert.ok(r.body.derived.macros.calories >= r.body.derived.tdee, 'muscle_gain must be a surplus');
    assert.equal(r.body.derived.age, new Date().getFullYear() - 1994 - (new Date() < new Date(`${new Date().getFullYear()}-05-11`) ? 1 : 0));
    assert.ok(r.body.options.goals.length >= 5);
  });

  await test('GET /api/training/exercises filters by query and facets', async () => {
    const all = await call('GET', '/api/training/exercises');
    assert.ok(all.body.count > 60);
    assert.ok(all.body.facets.muscles.length > 10);
    const q = await call('GET', '/api/training/exercises?q=squat');
    assert.ok(q.body.count >= 5, `only ${q.body.count} matches for "squat"`);
    assert.ok(q.body.exercises.every((e) =>
      /squat/i.test(e.name) || /squat/i.test(e.pattern) || e.muscles.some((m) => /squat/i.test(m))));
    const eq = await call('GET', '/api/training/exercises?equipment=bodyweight&category=push');
    assert.ok(eq.body.exercises.every((e) => e.equipment === 'bodyweight' && e.category === 'push'));
  });

  let planId = null;
  await test('POST /api/ai/plans/training builds a complete 4-day plan', async () => {
    const r = await call('POST', '/api/ai/plans/training', { weeks: 4 });
    assert.ok(r.status === 201, `status=${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    planId = r.body.id;
    const p = r.body.plan;
    assert.ok(['engine', 'ai', 'cache'].includes(p.meta.source), p.meta.source);
    assert.equal(p.schedule.length, 4);
    assert.equal(p.weekly_progression.length, 4);
    for (const day of p.schedule) {
      assert.ok(day.exercises.length >= 4, `${day.title} has ${day.exercises.length} exercises`);
      assert.ok(day.duration_min >= 20);
      assert.ok(day.blocks.length >= 2);
      for (const ex of day.exercises) {
        assert.ok(ex.name && ex.sets >= 1 && ex.reps && ex.rest_s >= 0, JSON.stringify(ex));
      }
    }
    assert.ok(p.meta.weekly_working_sets > 40);
    assert.ok(p.progression.rule.length > 10);
    assert.ok(p.principles.length >= 4);
  });

  await test('knee injury removes knee-hostile exercises from the plan', async () => {
    const r = await call('GET', `/api/ai/plans/${planId}`);
    const names = r.body.plan.schedule.flatMap((d) => d.exercises.map((e) => e.exercise_id));
    for (const banned of ['leg_extension', 'bulgarian_split_squat', 'walking_lunge']) {
      assert.ok(!names.includes(banned), `${banned} should have been excluded`);
    }
  });

  await test('home_bodyweight equipment produces a bodyweight-only plan', async () => {
    await call('PUT', '/api/profile', { equipment: 'home_bodyweight' });
    const r = await call('POST', '/api/ai/plans/training', { weeks: 2, force: true });
    const equip = r.body.plan.schedule.flatMap((d) => d.exercises.map((e) => e.equipment));
    assert.ok(equip.every((e) => ['bodyweight', 'band'].includes(e)), `unexpected equipment: ${[...new Set(equip)].join(',')}`);
    await call('PUT', '/api/profile', { equipment: 'full_gym' });
  });

  await test('plan generation is cached / deterministic on repeat', async () => {
    const a = await call('POST', '/api/ai/plans/training', { weeks: 4 });
    const b = await call('POST', '/api/ai/plans/training', { weeks: 4 });
    if (LIVE) {
      // Only a successful AI generation populates the cache. If the free tier
      // degraded the first call to the engine, there is nothing to cache —
      // say so loudly instead of failing the suite for an environmental burst.
      if (a.body.plan.meta.source === 'ai') {
        assert.equal(b.body.plan.meta.source, 'cache', `expected cache hit, got ${b.body.plan.meta.source}`);
        assert.equal(b.body.plan.meta.cached, true);
      } else {
        console.log(`      cache assertion skipped: first generation degraded (${a.body.plan.meta.source}: ${a.body.plan.meta.reason || 'no reason'})`);
        assert.ok(['engine', 'cache'].includes(b.body.plan.meta.source));
      }
    } else {
      assert.equal(a.body.plan.meta.source, 'engine');
      // same inputs must yield the same plan (minus the timestamp)
      const strip = (p) => JSON.stringify({ ...p, meta: { ...p.meta, generated_at: null } });
      assert.equal(strip(b.body.plan), strip(a.body.plan), 'engine plans must be deterministic');
    }
  });

  await test('POST /api/ai/plans/training?stream=1 emits SSE and a done event', async () => {
    const res = await fetch(`${BASE}/api/ai/plans/training?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ stream: true, weeks: 4, force: true }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events = [];
    let done = null;
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        if (!frame.trim()) continue;
        let name = 'message';
        let payload = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) payload += line.slice(5).trim();
        }
        events.push(name);
        if (name === 'done') done = JSON.parse(payload);
      }
    }
    assert.ok(events.includes('done'), `expected a done event, got: ${events.join(',') || 'nothing'}`);
    assert.ok(done.plan?.schedule?.length === 4, 'done event must carry the full plan');
    assert.ok(done.id > 0);
    assert.ok(['engine', 'ai', 'cache'].includes(done.source));
  });

  await test('POST /api/ai/plans/nutrition produces meals matching targets', async () => {
    const r = await call('POST', '/api/ai/plans/nutrition', {});
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const p = r.body.plan;
    assert.ok(p.meals.length >= 4);
    assert.ok(p.targets.calories > 2000 && p.targets.protein_g > 100);
    for (const m of p.meals) {
      assert.ok(m.foods.length >= 1, `${m.name} has no foods`);
      assert.ok(m.calories > 0);
      for (const f of m.foods) {
        assert.ok(f.grams > 0 && f.calories >= 0, JSON.stringify(f));
      }
    }
    // plan totals must be within 15% of the calorie target
    const drift = Math.abs(p.plan_totals.calories - p.targets.calories) / p.targets.calories;
    assert.ok(drift < 0.15, `plan totals ${p.plan_totals.calories} vs target ${p.targets.calories} (drift ${(drift * 100).toFixed(1)}%)`);
    assert.ok(p.grocery.length >= 5);
    assert.ok(p.supplements.length >= 2);
  });

  await test('vegan preference removes all animal products', async () => {
    await call('PUT', '/api/profile', { diet_pref: 'vegan' });
    const r = await call('POST', '/api/ai/plans/nutrition', { force: true });
    const foods = r.body.plan.meals.flatMap((m) => m.foods.map((f) => f.name.toLowerCase()));
    for (const bad of ['chicken', 'beef', 'salmon', 'egg', 'yogurt', 'whey', 'cottage', 'milk', 'paneer', 'turkey', 'cod', 'prawn']) {
      assert.ok(!foods.some((f) => f.includes(bad)), `vegan plan contains ${bad}`);
    }
    await call('PUT', '/api/profile', { diet_pref: 'omnivore' });
  });

  await test('POST /api/training/workouts logs a session with sets', async () => {
    const r = await call('POST', '/api/training/workouts', {
      date: daysAgo(3), name: 'Push A', focus: 'push', duration_s: 3720, rpe: 8,
      sets: [
        { exercise_id: 'bench_press', set_number: 1, reps: 5, weight_kg: 90, is_warmup: 1 },
        { exercise_id: 'bench_press', set_number: 2, reps: 8, weight_kg: 100, rpe: 8 },
        { exercise_id: 'bench_press', set_number: 3, reps: 7, weight_kg: 100, rpe: 9 },
        { exercise_id: 'overhead_press', set_number: 1, reps: 10, weight_kg: 50, rpe: 8 },
        { exercise_id: 'lateral_raise', set_number: 1, reps: 15, weight_kg: 12, rpe: 9 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.workout.sets.length, 5);
    assert.equal(r.body.workout.sets[0].is_warmup, 1);
  });

  await test('more history makes streak + volume stats meaningful', async () => {
    await call('POST', '/api/training/workouts', {
      date: daysAgo(2), name: 'Pull A', focus: 'pull', duration_s: 3300,
      sets: [
        { exercise_id: 'pull_up', set_number: 1, reps: 8, weight_kg: 0 },
        { exercise_id: 'barbell_row', set_number: 1, reps: 8, weight_kg: 80, rpe: 8 },
        { exercise_id: 'barbell_row', set_number: 2, reps: 7, weight_kg: 80, rpe: 9 },
        { exercise_id: 'hammer_curl', set_number: 1, reps: 12, weight_kg: 16 },
      ],
    });
    await call('POST', '/api/training/workouts', {
      date: daysAgo(1), name: 'Legs', focus: 'legs', duration_s: 4100,
      sets: [
        { exercise_id: 'back_squat', set_number: 1, reps: 5, weight_kg: 140, rpe: 8 },
        { exercise_id: 'back_squat', set_number: 2, reps: 5, weight_kg: 140, rpe: 8 },
        { exercise_id: 'romanian_deadlift', set_number: 1, reps: 10, weight_kg: 110, rpe: 8 },
        { exercise_id: 'standing_calf_raise', set_number: 1, reps: 15, weight_kg: 60 },
      ],
    });
    await call('POST', '/api/training/workouts', { date: today, name: 'Push B', focus: 'push', duration_s: 2400, sets: [
      { exercise_id: 'incline_db_press', set_number: 1, reps: 10, weight_kg: 32, rpe: 8 },
    ] });
    const r = await call('GET', '/api/progress/stats/overview');
    assert.equal(r.status, 200);
    assert.equal(r.body.headline.total_sessions, 4);
    assert.ok(r.body.headline.volume_this_week_kg > 0);
    assert.ok(r.body.streaks.current >= 1, `streak=${r.body.streaks.current}`);
    assert.ok(r.body.weekly_volume.length >= 1);
  });

  await test('GET /api/progress/stats/prs computes estimated 1RM', async () => {
    const r = await call('GET', '/api/progress/stats/prs');
    assert.equal(r.status, 200);
    const squat = r.body.prs.find((p) => p.exercise_id === 'back_squat');
    assert.ok(squat, 'squat PR missing');
    assert.equal(squat.top_kg, 140);
    assert.ok(squat.est_1rm > 140 && squat.est_1rm < 180, `est_1rm=${squat.est_1rm}`);
    assert.equal(r.body.lifts.squat, squat.est_1rm);
  });

  await test('GET /api/training/next suggests from the active plan with last load', async () => {
    const r = await call('GET', '/api/training/next');
    assert.equal(r.status, 200);
    assert.ok(r.body.session, 'no session suggested');
    assert.ok(r.body.session.exercises.length > 0);
    assert.equal(typeof r.body.session.last_performance, 'object');
  });

  await test('GET /api/progress/stats/heatmap returns one cell per day', async () => {
    const r = await call('GET', '/api/progress/stats/heatmap?weeks=8');
    assert.equal(r.body.cells.length, 56);
    assert.ok(r.body.cells.some((c) => c.sessions > 0));
    assert.equal(r.body.cells[r.body.cells.length - 1].date, today);
  });

  await test('GET /api/progress/stats/muscles aggregates volume', async () => {
    const r = await call('GET', '/api/progress/stats/muscles?days=28');
    assert.equal(r.status, 200);
    assert.ok(r.body.muscles.length > 0);
    assert.ok(r.body.muscles.every((m) => m.pct >= 0 && m.pct <= 100));
    assert.equal(r.body.muscles[0].pct, 100, 'top muscle is the 100% reference');
    assert.ok(r.body.muscles.some((m) => /chest|quads|lats/i.test(m.muscle)));
  });

  await test('POST /api/progress/metrics upserts one row per day', async () => {
    await call('POST', '/api/progress/metrics', { date: daysAgo(14), weight_kg: 84.1 });
    await call('POST', '/api/progress/metrics', { date: daysAgo(7), weight_kg: 83.2 });
    await call('POST', '/api/progress/metrics', { date: today, weight_kg: 82.4, body_fat_pct: 16.4 });
    await call('POST', '/api/progress/metrics', { date: today, weight_kg: 82.2 });
    const r = await call('GET', '/api/progress/metrics?days=90');
    assert.equal(r.body.series.filter((m) => m.date === today).length, 1, 'same-day metric must upsert');
    assert.equal(r.body.series.find((m) => m.date === today).weight_kg, 82.2);
    assert.ok(r.body.summary.change < 0, 'expected weight loss across the series');
    const prof = await call('GET', '/api/profile');
    assert.equal(prof.body.profile.weight_kg, 82.2, 'weigh-in should sync the profile');
  });

  await test('metrics without a value is a 400', async () => {
    const r = await call('POST', '/api/progress/metrics', { date: today, notes: 'nothing' });
    assert.equal(r.status, 400);
  });

  await test('POST /api/nutrition/log resolves macros from the food db', async () => {
    const r = await call('POST', '/api/nutrition/log', {
      date: today, meal_type: 'breakfast', food_name: 'Greek yogurt 0%', grams: 250,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.entry.protein_g, 25);
    assert.ok(r.body.entry.calories > 130 && r.body.entry.calories < 170);
  });

  await test('POST /api/nutrition/log accepts arbitrary foods with manual macros', async () => {
    const r = await call('POST', '/api/nutrition/log', {
      date: today, meal_type: 'lunch', food_name: 'Homemade biryani',
      grams: 350, calories: 620, protein_g: 34, carbs_g: 72, fat_g: 19,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.entry.calories, 620);
  });

  await test('unknown food without macros is a 400', async () => {
    const r = await call('POST', '/api/nutrition/log', { date: today, food_name: 'Mystery goo' });
    assert.equal(r.status, 400);
  });

  await test('batch logging + daily totals group by meal', async () => {
    const batch = await call('POST', '/api/nutrition/log-batch', {
      date: today,
      items: [
        { meal_type: 'dinner', food_name: 'Chicken breast, skinless (cooked)', grams: 180 },
        { meal_type: 'dinner', food_name: 'White rice (cooked)', grams: 220 },
        { meal_type: 'dinner', food_name: 'Broccoli', grams: 150 },
        { meal_type: 'snack', food_name: 'Almonds', grams: 25 },
        { meal_type: 'snack', food_name: 'Unlisted thing' },
      ],
    });
    assert.equal(batch.body.created, 4, 'unknown food without macros must be skipped');
    const daily = await call('GET', `/api/nutrition/daily?date=${today}`);
    assert.ok(daily.body.entries.length >= 6);
    assert.ok(daily.body.totals.protein_g > 100);
    assert.ok(daily.body.by_meal.breakfast.length === 1);
    assert.ok(daily.body.by_meal.dinner.length === 3);
  });

  await test('POST /api/nutrition/copy-day clones a day', async () => {
    const r = await call('POST', '/api/nutrition/copy-day', { from: today, to: daysAgo(1) });
    assert.equal(r.status, 200);
    assert.ok(r.body.copied >= 6);
    const d = await call('GET', `/api/nutrition/daily?date=${daysAgo(1)}`);
    assert.equal(d.body.entries.length, r.body.copied);
  });

  await test('GET /api/nutrition/range aggregates per day', async () => {
    const r = await call('GET', '/api/nutrition/range?days=14');
    assert.equal(r.status, 200);
    assert.ok(r.body.series.length >= 2);
    assert.ok(r.body.series.every((d) => d.calories > 0));
  });

  await test('POST /api/ai/coach answers without an API key (engine fallback)', async () => {
    let r = await call('POST', '/api/ai/coach', { message: 'How much protein do I need?' });
    if (LIVE && r.body.source !== 'ai') {
      // free-tier bursts happen; one polite retry before judging
      await new Promise((res) => setTimeout(res, 5000));
      r = await call('POST', '/api/ai/coach', { message: 'How much protein do I need?' });
    }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.message.length > 60);
    if (LIVE) {
      const environmental = /429|rate|quota|failed_generation|timeout/i.test(r.body.error || '');
      assert.ok(
        r.body.source === 'ai' || r.body.source === 'engine:throttled' || (r.body.source === 'engine:error' && environmental),
        `coach source ${r.body.source}: ${r.body.error || 'unexplained engine error'}`
      );
      if (r.body.source !== 'ai') console.log(`      coach degraded this run: ${r.body.source} (${r.body.error || 'budget'})`);
    } else {
      assert.ok(/^engine/.test(r.body.source), r.body.source);
    }
    const h = await call('GET', '/api/ai/chat');
    // a throttled first attempt retries once, so assert balanced Q/A pairs
    // instead of an exact message count
    assert.ok(h.body.messages.length >= 2 && h.body.messages.length % 2 === 0,
      `expected user/assistant pairs, got ${h.body.messages.length}`);
    assert.equal(h.body.messages[0].role, 'user');
    assert.equal(h.body.messages[h.body.messages.length - 1].role, 'assistant');
  });

  await test('coach rejects empty and oversized messages', async () => {
    assert.equal((await call('POST', '/api/ai/coach', { message: '' })).status, 400);
    assert.equal((await call('POST', '/api/ai/coach', { message: 'x'.repeat(2000) })).status, 400);
  });

  await test('GET /api/ai/status exposes budget and cache state', async () => {
    const r = await call('GET', '/api/ai/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, LIVE);
    assert.ok(r.body.budget.tokensPerMinute > 0);
    if (!LIVE) assert.equal(r.body.cache.entries, 0, 'engine-only mode must not touch the AI cache');
    // in LIVE mode cache population is asserted by the determinism test below
    assert.equal(typeof r.body.today.calls, 'number');
    assert.ok(Array.isArray(r.body.fallbackChain) && r.body.fallbackChain.length >= 2);
  });

  await test('PUT /api/ai/budget retunes the governor at runtime', async () => {
    const r = await call('PUT', '/api/ai/budget', { tokensPerMinute: 1000, requestsPerMinute: 10 });
    assert.equal(r.body.budget.tokensPerMinute, 1000);
    assert.equal(r.body.budget.requestsPerMinute, 10);
    await call('PUT', '/api/ai/budget', { tokensPerMinute: 6000, requestsPerMinute: 20 });
  });

  await test('GET /api/ai/insight returns a headline and advice', async () => {
    const r = await call('GET', '/api/ai/insight');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.insight.headline.length > 10);
    assert.ok(r.body.insight.advice.length > 10);
    assert.ok(r.body.stats.headline.sessions >= 0);
    assert.ok(typeof r.body.stats.headline.volume_this_week_kg === 'number');
  });

  await test('GET /api/ai/usage records telemetry', async () => {
    const r = await call('GET', '/api/ai/usage?days=7');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.per_day));
    assert.ok(Array.isArray(r.body.recent));
  });

  await test('plan lifecycle: list, activate, fetch, delete', async () => {
    const list = await call('GET', '/api/ai/plans');
    assert.ok(list.body.plans.length >= 3);
    const training = list.body.plans.filter((p) => p.kind === 'training');
    const target = training[training.length - 1];
    const act = await call('POST', `/api/ai/plans/${target.id}/activate`);
    assert.equal(act.body.ok, true);
    const active = await call('GET', '/api/ai/plans/active/training');
    assert.equal(active.body.id, target.id);
    assert.equal(active.body.plan.schedule.length, 4);
    const one = await call('GET', `/api/ai/plans/${target.id}`);
    assert.ok(one.body.plan.meta);
    const del = await call('DELETE', `/api/ai/plans/${target.id}`);
    assert.equal(del.body.ok, true);
    assert.equal((await call('GET', `/api/ai/plans/${target.id}`)).status, 404);
  });

  await test('GET /api/progress/export round-trips through /import', async () => {
    const exp = await call('GET', '/api/progress/export');
    assert.ok(exp.body.workouts.length >= 4);
    assert.ok(exp.body.nutrition.length >= 6);
    assert.ok(exp.body.metrics.length >= 3);
    assert.ok(exp.body.workouts[0].sets.length >= 1);

    const fresh = await call('POST', '/api/auth/register', {
      email: 'second@fitforge.test', name: 'Second', password: 'strongpass123',
    }, { noAuth: true });
    const original = token;
    token = fresh.body.token;
    const imp = await call('POST', '/api/progress/import', exp.body);
    assert.equal(imp.body.counts.workouts, exp.body.workouts.length);
    assert.equal(imp.body.counts.sets, exp.body.workouts.reduce((s, w) => s + w.sets.length, 0));
    const stats = await call('GET', '/api/progress/stats/overview');
    assert.equal(stats.body.headline.total_sessions, exp.body.workouts.length);
    token = original;
  });

  await test('demo account seeds idempotently and logs in with rich data', async () => {
    const { spawnSync } = await import('node:child_process');
    const run1 = spawnSync(process.execPath, ['--no-warnings', join(here, '../scripts/seed.js')], {
      env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
    });
    assert.equal(run1.status, 0, (run1.stderr || '').slice(0, 300));
    const run2 = spawnSync(process.execPath, ['--no-warnings', join(here, '../scripts/seed.js')], {
      env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
    });
    assert.equal(run2.status, 0, 'seed must be idempotent');

    const lg = await call('POST', '/api/auth/login', { email: 'xyz@gmail.com', password: 'xyz' }, { noAuth: true });
    assert.equal(lg.status, 200, JSON.stringify(lg.body).slice(0, 200));
    const dt = lg.body.token;
    const h = { headers: { authorization: `Bearer ${dt}` } };
    const ov = await (await fetch(`${BASE}/api/progress/stats/overview`, h)).json();
    assert.ok(ov.headline.total_sessions >= 20, `sessions=${ov.headline.total_sessions}`);
    assert.ok(ov.headline.streak >= 0);
    const pr = await (await fetch(`${BASE}/api/progress/stats/prs`, h)).json();
    assert.ok(pr.prs.length >= 5 && pr.lifts.squat > 140, 'demo PRs missing');
    const nd = await (await fetch(`${BASE}/api/nutrition/daily?date=${daysAgo(1)}`, h)).json();
    assert.ok(nd.entries.length >= 8, 'demo food logs missing');
    const wrong = await call('POST', '/api/auth/login', { email: 'xyz@gmail.com', password: 'wrong' }, { noAuth: true });
    assert.equal(wrong.status, 401, 'demo password must still be verified');
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.demo, true);
  });

  await test('GET /api/progress/export.csv downloads a two-section CSV', async () => {
    const res = await fetch(`${BASE}/api/progress/export.csv`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const text = await res.text();
    assert.ok(text.includes('section,workout_log'));
    assert.ok(text.includes('section,nutrition_log'));
    assert.ok(text.includes('Bench Press'), 'expected a normalised exercise name in the CSV');
  });

  await test('the account-enumeration endpoint is gone', async () => {
    const r = await call('GET', '/api/auth/demo-accounts', null, { noAuth: true });
    assert.equal(r.status, 404);
  });

  await test('AI status requires authentication (budget is not public)', async () => {
    const anon = await call('GET', '/api/ai/status', null, { noAuth: true });
    assert.equal(anon.status, 401);
    const authed = await call('GET', '/api/ai/status');
    assert.equal(authed.status, 200);
    assert.ok(!JSON.stringify(authed.body).includes('gsk_'), 'status must never echo a raw key');
  });

  await test('garbage dates are rejected with 400 on every write route', async () => {
    assert.equal((await call('POST', '/api/training/workouts', { date: 'nope', name: 'x', sets: [] })).status, 400);
    assert.equal((await call('POST', '/api/nutrition/log', { date: '2026-13-45', food_name: 'Chicken breast, skinless (cooked)', grams: 100 })).status, 400);
    assert.equal((await call('POST', '/api/progress/metrics', { date: 'yesterday', weight_kg: 80 })).status, 400);
    assert.equal((await call('POST', '/api/nutrition/copy-day', { from: 'x', to: today })).status, 400);
    assert.equal((await call('POST', '/api/nutrition/copy-day', { from: today, to: 'not-a-date' })).status, 400);
  });

  await test('malformed query dates fall back safely instead of erroring', async () => {
    const r = await call('GET', '/api/nutrition/daily?date=garbage');
    assert.equal(r.status, 200);
    assert.equal(r.body.date, today);
    const w = await call('GET', '/api/training/workouts?from=banana&to=banana');
    assert.equal(w.status, 200);
  });

  await test('security headers are set by the API itself', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(res.headers.get('referrer-policy').includes('strict-origin'));
  });

  await test('404 and validation errors use the standard envelope', async () => {
    const r = await call('GET', '/api/nope', null, { noAuth: true });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not_found');
    const bad = await call('POST', '/api/nutrition/copy-day', {});
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_request');
  });

  if (LIVE) {
    await test('live: POST /api/ai/test reaches Groq', async () => {
      const r = await call('POST', '/api/ai/test', {});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.model);
      assert.ok(r.body.usage.total_tokens > 0);
    });
    await test('live: GET /api/ai/models lists callable models', async () => {
      const r = await call('GET', '/api/ai/models');
      assert.equal(r.status, 200);
      assert.ok(r.body.models.length > 0, JSON.stringify(r.body).slice(0, 300));
    });
    await test('live: training plan overlay personalises the engine plan', async () => {
      const r = await call('POST', '/api/ai/plans/training', { mode: 'overlay', force: true });
      assert.equal(r.status, 201);
      assert.ok(['ai', 'engine'].includes(r.body.plan.meta.source));
      assert.equal(r.body.plan.schedule.length, 4);
      console.log(`      source=${r.body.plan.meta.source} model=${r.body.plan.meta.model} tokens=${r.body.plan.meta.tokens || 0}`);
    });
    await test('live: spoken meal audio transcribes through /api/ai/transcribe', async () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const audio = readFileSync(join(here, 'fixtures', 'voice-meal.mp3'));
      const res = await fetch(`${BASE}/api/ai/transcribe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/mpeg' },
        body: audio,
      });
      assert.equal(res.status, 200, `transcribe -> ${res.status}`);
      const j = await res.json();
      assert.match(j.text, /chicken/i, `transcript: ${j.text}`);
      assert.match(j.text, /150/, `transcript missing grams: ${j.text}`);
      console.log(`      whisper heard: "${j.text}"`);
    });

    await test('live: /api/ai/speak returns playable audio bytes', async () => {
      const res = await fetch(`${BASE}/api/ai/speak`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Good session. Log some protein within an hour.' }),
      });
      if (res.status === 503) {
        const j = await res.json();
        assert.equal(j.error, 'voice_terms_required', JSON.stringify(j));
        console.log('      orpheus TTS pending: org must accept model terms in the Groq console (documented prerequisite)');
        return;
      }
      assert.equal(res.status, 200, `speak -> ${res.status}`);
      assert.match(res.headers.get('content-type'), /audio/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.ok(bytes.length > 2000, `audio too small: ${bytes.length} bytes`);
      console.log(`      orpheus returned ${bytes.length} bytes of ${res.headers.get('content-type')}`);
    });

    await test('live: coach chat returns a model answer', async () => {
      const r = await call('POST', '/api/ai/coach', { message: 'My bench is stuck at 100kg for 3 weeks.' });
      assert.equal(r.status, 200);
      assert.ok(r.body.message.length > 40);
      console.log(`      source=${r.body.source} tokens=${r.body.tokens}`);
    });
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const f of failures) console.log(`FAILED: ${f.name}\n${f.err.stack?.split('\n').slice(0, 4).join('\n')}\n`);
    console.log('--- server log tail ---\n' + serverLog.split('\n').slice(-25).join('\n'));
  }
  child.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nfatal:', err);
  console.error('--- server log ---\n' + serverLog);
  child.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
