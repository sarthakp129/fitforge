/**
 * Unit tests for the token governor. These are pure and fast — they assert the
 * *decision* (how long to wait) rather than actually sleeping, so the whole
 * suite runs in milliseconds while still proving we can never overspend a
 * 1K TPM free-tier key.
 */
import assert from 'node:assert/strict';
import { TokenBudget } from '../src/services/tokenBudget.js';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  ✗ ${name}\n      ${err.message}`); }
}

const headers = (obj) => ({ get: (k) => obj[k.toLowerCase()] ?? obj[k] });

console.log('\nTokenBudget governor');

await test('allows a request that fits in the window', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  assert.equal(b.waitMs(400), 0);
  assert.equal(b.snapshot().tokensRemaining, 1000);
});

await test('blocks when the next request would exceed TPM', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.tokenWindow.push({ ts: Date.now(), tokens: 800 });
  b.requestWindow.push(Date.now());
  assert.equal(b.waitMs(100), 0, 'small request still fits');
  const wait = b.waitMs(500);
  assert.ok(wait > 55_000 && wait <= 60_100, `expected ~60s wait, got ${wait}`);
});

await test('a request larger than the whole window waits one full window', () => {
  const b = new TokenBudget({ tokensPerMinute: 100, requestsPerMinute: 30, requestsPerDay: 900 });
  const wait = b.waitMs(5000);
  assert.ok(wait >= 59_000 && wait <= 60_100, `expected ~60s, got ${wait}`);
});

await test('frees budget exactly when the oldest entry ages out', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  const now = Date.now();
  b.tokenWindow.push({ ts: now - 59_000, tokens: 900 }); // expires in 1s
  b.requestWindow.push(now - 59_000);
  const wait = b.waitMs(900);
  assert.ok(wait > 0 && wait < 2500, `expected ~1s, got ${wait}`);
});

await test('respects the RPM ceiling independently of tokens', () => {
  const b = new TokenBudget({ tokensPerMinute: 1_000_000, requestsPerMinute: 3, requestsPerDay: 900 });
  const now = Date.now();
  b.requestWindow.push(now, now, now);
  assert.ok(b.waitMs(1) > 0, 'should be request-limited');
  assert.equal(b.tokensUsed(), 0);
});

await test('reserve() books the estimate and commit() reconciles it', async () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  await b.reserve(300);
  assert.equal(b.tokensUsed(), 300);
  b.commit(450, 300);           // the model used more than we guessed
  assert.equal(b.tokensUsed(), 450);
  b.commit(200, 450);           // ...or less
  assert.equal(b.tokensUsed(), 200);
  assert.equal(b.requestsUsed(), 1);
  assert.equal(b.totalServed, 0, 'totalServed is bumped by the client, not the budget');
});

await test('concurrent reservations reconcile specifically to their own slots', async () => {
  const b = new TokenBudget({ tokensPerMinute: 2000, requestsPerMinute: 30, requestsPerDay: 900 });
  const r1 = await b.reserve(500);
  const r2 = await b.reserve(300);
  assert.equal(b.tokensUsed(), 800);
  // r1 finishes out of order with 600 tokens (delta +100)
  b.commit(600, 500, r1.reservation);
  assert.equal(r1.reservation.tokens, 600);
  assert.equal(r2.reservation.tokens, 300);
  assert.equal(b.tokensUsed(), 900);
  // r2 finishes with 200 tokens (delta -100)
  b.commit(200, 300, r2.reservation);
  assert.equal(r1.reservation.tokens, 600);
  assert.equal(r2.reservation.tokens, 200);
  assert.equal(b.tokensUsed(), 800);
});

await test('daily quota exhaustion rejects immediately instead of hanging', async () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 2 });
  await b.reserve(10);
  await b.reserve(10);
  const started = Date.now();
  await assert.rejects(() => b.reserve(10), (err) => {
    assert.equal(err.code, 'daily_quota');
    assert.equal(err.status, 429);
    assert.match(err.message, /Daily Groq request quota/);
    assert.ok(err.retryAfter > 0 && err.retryAfter <= 86400);
    return true;
  });
  assert.ok(Date.now() - started < 500, 'must fail fast, not wait for midnight');
});

await test('an unaffordable wait fails fast with budget_exhausted + retryAfter', async () => {
  const b = new TokenBudget({ tokensPerMinute: 100, requestsPerMinute: 30, requestsPerDay: 900 });
  b.tokenWindow.push({ ts: Date.now(), tokens: 100 });
  const started = Date.now();
  await assert.rejects(() => b.reserve(80, { maxWaitMs: 300 }), (err) => {
    assert.equal(err.code, 'budget_exhausted');
    assert.equal(err.status, 429);
    assert.ok(err.retryAfter >= 55 && err.retryAfter <= 61);
    return true;
  });
  assert.ok(Date.now() - started < 2000, 'must not sit in the wait loop');
});

await test('syncFromHeaders never lets us claim more than the provider allows', () => {
  const b = new TokenBudget({ tokensPerMinute: 8000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.syncFromHeaders(headers({ 'x-ratelimit-limit-tokens': '1000' }));
  assert.equal(b.tpm, 1000);
  // and a later, larger reported limit must not inflate us back up
  b.syncFromHeaders(headers({ 'x-ratelimit-limit-tokens': '50000' }));
  assert.equal(b.tpm, 1000);
});

await test('remaining-tokens=0 blocks us for the reported reset window', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.syncFromHeaders(headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '12.5s' }));
  const snap = b.snapshot();
  assert.equal(snap.blocked, true);
  assert.ok(snap.blockedForMs > 11_000 && snap.blockedForMs <= 12_600);
  assert.ok(b.waitMs(1) > 11_000);
});

await test('Retry-After from a 429 is honoured', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.syncFromHeaders(headers({ 'retry-after': '3' }));
  assert.ok(b.waitMs(1) >= 2900);
});

await test('reserve() actually waits and then succeeds', async () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.tokenWindow.push({ ts: Date.now() - 59_400, tokens: 900 }); // expires in ~600ms
  b.requestWindow.push(Date.now() - 59_400);
  const started = Date.now();
  let notified = 0;
  const { waited } = await b.reserve(500, { onWait: () => { notified++; } });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 400, `should have paused ~600ms, waited ${elapsed}ms`);
  assert.ok(elapsed < 4000, `should not over-wait, took ${elapsed}ms`);
  assert.ok(notified >= 1, 'onWait must fire so the UI can show the throttle');
  assert.ok(waited >= 400);
});

await test('concurrent reservations queue FIFO and never overspend the window', async () => {
  const b = new TokenBudget({ tokensPerMinute: 300, requestsPerMinute: 50, requestsPerDay: 900 });
  // window is full but frees up in ~300ms
  b.tokenWindow.push({ ts: Date.now() - 59_700, tokens: 300 });
  b.requestWindow.push(Date.now() - 59_700);

  const started = Date.now();
  const results = await Promise.all([
    b.reserve(150, { maxWaitMs: 10_000 }),
    b.reserve(150, { maxWaitMs: 10_000 }),
  ]);
  const elapsed = Date.now() - started;
  assert.equal(results.length, 2);
  // The first caller is throttled by the seeded window; the second is queued
  // behind it and by then the seeded tokens have aged out, so it goes free.
  assert.ok(results[0].waited > 0, 'the first caller must be throttled');
  assert.ok(elapsed >= 200 && elapsed < 4000, `expected a ~300ms pause, took ${elapsed}ms`);
  assert.equal(b.requestsUsed(), 2);
  assert.equal(b.tokensUsed(), 300);
  assert.ok(b.tokensUsed() <= 300, `window overspent: ${b.tokensUsed()} > 300`);
});

await test('the queue survives a rejection and keeps serving later callers', async () => {
  const b = new TokenBudget({ tokensPerMinute: 100, requestsPerMinute: 50, requestsPerDay: 900 });
  // window full, but it frees up in ~400ms: the impatient caller fails fast
  // while the patient one queued behind it still gets served.
  b.tokenWindow.push({ ts: Date.now() - 59_600, tokens: 100 });
  b.requestWindow.push(Date.now() - 59_600);
  const rejected = b.reserve(90, { maxWaitMs: 200 }).catch((e) => e.code);
  // queued behind the doomed reservation, but this one is tiny and affordable
  // once the window slides; it must not be poisoned by the earlier rejection.
  const ok = await b.reserve(10, { maxWaitMs: 20_000 }).then(() => 'ok', (e) => e.code);
  assert.equal(await rejected, 'budget_exhausted');
  assert.equal(ok, 'ok');
});

await test('snapshot() reports honest utilisation for the UI', () => {
  const b = new TokenBudget({ tokensPerMinute: 1000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.tokenWindow.push({ ts: Date.now(), tokens: 250 });
  const s = b.snapshot(100);
  assert.equal(s.tokensUsedThisMinute, 250);
  assert.equal(s.tokensReserved, 100);
  assert.equal(s.tokensRemaining, 650);
  assert.equal(s.utilisation, 25);
  assert.equal(s.requestsPerDay, 900);
});

await test('blockFor() pauses everything until it expires', () => {
  const b = new TokenBudget({ tokensPerMinute: 10_000, requestsPerMinute: 30, requestsPerDay: 900 });
  b.blockFor(5000);
  assert.ok(b.waitMs(1) >= 4500);
  assert.equal(b.snapshot().blocked, true);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`FAILED: ${f.name}\n${f.err.stack?.split('\n').slice(0, 4).join('\n')}\n`);
  process.exit(1);
}
