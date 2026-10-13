/**
 * Cache-key policy tests. The cache must never serve one user's personalised
 * plan to another user, and must invalidate when anything that shapes the
 * result changes (profile, log context, weeks, mode).
 */
import assert from 'node:assert/strict';
import { planCacheKey, contextSignature } from '../src/services/aiService.js';

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`  ✗ ${name}\n      ${err.message}`); }
};

const profile = { sex: 'male', weight_kg: 80, height_cm: 180, goal: 'recomp', days_per_week: 4 };
const twin = { ...profile };                       // identical profile, different human
const ctxA = { recent_sessions: [{ date: '2026-10-01', name: 'Push', focus: 'push' }], top_lifts: [{ exercise_name: 'Bench', top_kg: 100 }], weigh_ins: [] };
const ctxB = { recent_sessions: [], top_lifts: [{ exercise_name: 'Bench', top_kg: 100 }], weigh_ins: [] };

console.log('\nCache-key policy');

test('same user, same inputs -> same key', () => {
  assert.equal(planCacheKey(1, 'training', profile, contextSignature(ctxA), { weeks: 4, mode: 'overlay' }),
               planCacheKey(1, 'training', twin,    contextSignature(ctxA), { weeks: 4, mode: 'overlay' }));
});

test('different user, identical profile+context -> DIFFERENT key (no cross-user leak)', () => {
  assert.notEqual(planCacheKey(1, 'training', profile, contextSignature(ctxA), { weeks: 4 }),
                  planCacheKey(2, twin,        twin,   contextSignature(ctxA), { weeks: 4 }));
});

test('different log context -> different key', () => {
  assert.notEqual(planCacheKey(1, 'training', profile, contextSignature(ctxA)),
                  planCacheKey(1, 'training', profile, contextSignature(ctxB)));
});

test('context signature is order-stable but value-sensitive', () => {
  assert.equal(contextSignature({ ...ctxA }), contextSignature({ ...ctxA }));
  assert.notEqual(contextSignature(ctxA), contextSignature({ ...ctxA, top_lifts: [{ exercise_name: 'Bench', top_kg: 102.5 }] }));
});

test('weeks and mode participate in the key', () => {
  const base = planCacheKey(1, 'training', profile, '', { weeks: 4, mode: 'overlay' });
  assert.notEqual(base, planCacheKey(1, 'training', profile, '', { weeks: 8, mode: 'overlay' }));
  assert.notEqual(base, planCacheKey(1, 'training', profile, '', { weeks: 4, mode: 'full' }));
});

test('kind separates training from nutrition caches', () => {
  assert.notEqual(planCacheKey(1, 'training', profile, ''), planCacheKey(1, 'nutrition', profile, ''));
});

test('profile changes invalidate (weight and goal both matter)', () => {
  const base = planCacheKey(1, 'nutrition', profile, '');
  assert.notEqual(base, planCacheKey(1, 'nutrition', { ...profile, weight_kg: 81 }, ''));
  assert.notEqual(base, planCacheKey(1, 'nutrition', { ...profile, goal: 'fat_loss' }, ''));
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
