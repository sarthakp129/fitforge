/**
 * Render smoke test. Server-renders every top-level view with a seeded store so
 * each component's real branches execute. Catches undefined refs, bad
 * destructuring and JSX mistakes that a production build would happily ship.
 *
 *   npm run test:render
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import Landing from '../src/components/Landing.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import Training from '../src/components/Training.jsx';
import Nutrition from '../src/components/Nutrition.jsx';
import Progress from '../src/components/Progress.jsx';
import Settings from '../src/components/Settings.jsx';
import Onboarding from '../src/components/Onboarding.jsx';
import useStore from '../src/store/useStore.js';

const noop = () => {};
const targets = { App, Landing, Dashboard, Training, Nutrition, Progress, Settings, Onboarding };

useStore.setState({
  booted: true,
  token: 'test-token',
  user: { id: 1, email: 'athlete@fitforge.test', name: 'Test Athlete', created_at: '2026-01-01 10:00:00' },
  profile: {
    sex: 'male', birth_date: '1994-05-11', height_cm: 181, weight_kg: 82.4, body_fat_pct: 17,
    target_weight_kg: 78, activity_level: 'moderate', goal: 'muscle_gain', experience: 'intermediate',
    days_per_week: 4, session_minutes: 65, equipment: 'full_gym', injuries: 'left knee',
    diet_pref: 'omnivore', allergies: '', focus_areas: 'chest', sleep_hours: 7, notes: '',
  },
  derived: {
    bmr: 1850, tdee: 2870, calorie_target: 3215, bmi: 25.2, weekly_rate: 0.29,
    macros: { calories: 3215, protein_g: 181, carbs_g: 380, fat_g: 86, fiber_g: 32, water_l: 3.1 },
  },
  options: {
    goals: [{ id: 'muscle_gain', label: 'Lean muscle gain', rate: 'x' }],
    activity_levels: ['moderate'], experience: ['intermediate'],
    equipment: ['full_gym'], diet_prefs: ['omnivore'],
  },
  aiStatus: {
    configured: true, enabled: true, planningModel: 'openai/gpt-oss-120b', fastModel: 'openai/gpt-oss-20b',
    fallbackChain: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    budget: {
      tokensPerMinute: 6000, tokensUsedThisMinute: 900, tokensRemaining: 5100,
      requestsPerMinute: 20, requestsUsedThisMinute: 2, requestsPerDay: 900,
      requestsUsedToday: 11, blocked: false, blockedForMs: 0, utilisation: 15,
    },
    cache: { entries: 4, hits: 9, tokens_saved: 5200 },
  },
  toasts: [{ id: 1, message: 'Saved.', kind: 'ok' }],
});

let failed = 0;
console.log('\nFitForge component render test');
for (const [name, Component] of Object.entries(targets)) {
  try {
    // every page may use router hooks (useNavigate/useLocation), so all of
    // them render inside a MemoryRouter; App additionally declares <Routes>
    const page = React.createElement(Component, {
      goTo: noop, onNavigate: noop, onStartSession: noop, onDone: noop, clearPendingSession: noop,
    });
    const html = renderToString(
      React.createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, page)
    );
    // App renders its lazy children inside <Suspense>, which stays pending under
    // renderToString; the shell (canvas + nav) is what we can assert here. The
    // fully-mounted tree is covered by test/e2e.app.jsx against a live API.
    const min = name === 'App' ? 40 : 200;
    if (!html || html.length < min) throw new Error(`rendered only ${html.length} characters`);
    if (name === 'App' && !html.includes('app-bg')) throw new Error('App did not mount the background layer');
    if (/undefined|\[object Object\]/.test(html)) {
      const idx = html.search(/undefined|\[object Object\]/);
      throw new Error(`leaked "${html.slice(idx, idx + 24)}" into the markup at ${idx}`);
    }
    console.log(`  ✓ ${name.padEnd(12)} ${String(html.length).padStart(7)} chars`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
    const frame = (err.stack || '').split('\n').slice(1, 4).join('\n      ');
    if (frame) console.log(`      ${frame}`);
  }
}

// the signed-out landing page is a distinct tree
try {
  useStore.setState({ token: null, user: null, booted: true });
  const html = renderToString(React.createElement(Landing));
  if (html.length < 1000) throw new Error('landing page rendered too little markup');
  console.log(`  ✓ ${'Landing(out)'.padEnd(12)} ${String(html.length).padStart(7)} chars`);
} catch (err) {
  failed++;
  console.log(`  ✗ Landing(signed-out): ${err.message}`);
}

console.log(failed ? `\n${failed} failed\n` : '\nall views rendered cleanly\n');
process.exit(failed ? 1 : 0);
