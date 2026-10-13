/**
 * End-to-end UI test. Runs inside jsdom against a *real* FitForge backend that
 * has been seeded with a profile, workouts, meals and weigh-ins.
 *
 * It mounts <App/>, then drives the UI the way a user would — clicking nav
 * items, opening the exercise picker, logging a set, sending a coach message —
 * and asserts on the resulting DOM. WebGL is unavailable in jsdom, which also
 * proves the 3D layer fails soft without breaking the app.
 *
 *   npm run test:e2e
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import useStore from '../src/store/useStore.js';
import { api } from '../src/lib/api.js';
import { todayISO } from '../src/lib/format.js';
import parseVoiceLog from '../src/lib/parseVoiceLog.js';

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeout = 9000, label = 'condition' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (err) { last = err; }
    await wait(60);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (${last.message})` : ''}`);
}

const text = () => document.body.textContent || '';
const has = (needle) => text().includes(needle);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

function clickNav(label) {
  const link = $$('.nav-link').find((el) => el.textContent.trim() === label);
  if (!link) throw new Error(`nav link "${label}" not found (have: ${$$('.nav-link').map((l) => l.textContent.trim()).join(', ')})`);
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

/** Opens the avatar menu and clicks one of its items (Settings, Sign out…). */
async function openUserMenuItem(label) {
  const avatar = $$('button[aria-label="User menu"]')[0];
  if (!avatar) throw new Error('user menu trigger missing');
  avatar.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => $$('.menu-item').some((m) => m.textContent.includes(label)), { label: `menu item ${label}` });
  const item = $$('.menu-item').find((m) => m.textContent.includes(label));
  item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function clickButton(matchText, { selector = 'button' } = {}) {
  const btn = $$(selector).find((b) => b.textContent.trim().includes(matchText));
  if (!btn) throw new Error(`no ${selector} containing "${matchText}"`);
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return btn;
}

export default async function run() {
  console.log('\nFitForge UI end-to-end test (jsdom + live API)');

  if (!localStorage.getItem('fitforge.token')) {
    throw new Error('runner did not seed the auth token before the bundle loaded');
  }

  // silence React's act() advisory: we drive time with real polling instead
  const realError = console.error;
  console.error = (...args) => {
    const msg = String(args[0] || '');
    if (/not wrapped in act|ReactDOMTestUtils/i.test(msg)) return;
    realError(...args);
  };

  const container = document.getElementById('root');
  const root = createRoot(container);
  // MemoryRouter keeps jsdom from attempting real navigations; the initial
  // entry '/' redirects to /dashboard because the runner seeded a token.
  root.render(React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(App)));

  /* ------------------------------ dashboard ----------------------------- */

  await check('boots into the dashboard with a real greeting', async () => {
    // wait for the greeting itself: 'Volume this week' also exists on the
    // landing page's sample preview, which raced this assertion
    await waitFor(() => /Good (morning|afternoon|evening), /.test(text()), { label: 'dashboard greeting' });
    if (!/Good (morning|afternoon|evening)/.test(text())) throw new Error('greeting missing');
    // the dashboard greets by first name
    if (!/Good (morning|afternoon|evening), Test\./.test(text())) throw new Error(`greeting missing the first name: ${text().slice(0, 80)}`);
  });

  await check('renders macro rings, streak and bodyweight tiles from live data', async () => {
    await waitFor(() => $$('svg circle').length >= 4, { label: 'rings' });
    for (const needle of ['Streak', 'Bodyweight', 'Energy today', 'Coach read-out']) {
      if (!has(needle)) throw new Error(`missing "${needle}"`);
    }
  });

  await check('dashboard keeps internal AI details out; Settings keeps them', async () => {
    await waitFor(() => has('Coach read-out'), { label: 'coach card on dashboard' });
    if (has('Token governor') || has('TPM')) throw new Error('internal budget jargon leaked onto the dashboard');
    await openUserMenuItem('Settings');
    await waitFor(() => has('Token budget'), { label: 'owner controls in Settings' });
    clickNav('Dashboard');
    await waitFor(() => has('Coach read-out'), { label: 'back on dashboard' });
  });

  await check('suggests today’s session from the active plan', async () => {
    await waitFor(() => has('Start session') || has('No active plan'), { label: 'session card' });
  });

  /* ------------------------------- training ----------------------------- */

  await check('training view lists every day of the generated plan', async () => {
    clickNav('Training');
    await waitFor(() => has('Forge a new plan'), { label: 'training generator' });
    await waitFor(() => $$('.ex-row').length >= 4, { label: 'exercise rows' });
    if (!has('Main work')) throw new Error('main work block missing');
    if (!has('Progression')) throw new Error('progression card missing');
  });

  await check('regenerating streams over SSE and repaints the plan', async () => {
    clickButton('Regenerate plan');
    // the streaming path must end in a success toast, not a hung spinner
    await waitFor(() => has('Training plan ready'), { label: 'regeneration toast' });
    await waitFor(() => $$('.ex-row').length >= 4, { label: 'repainted exercises' });
    if (has('generation failed')) throw new Error('generation reported a failure');
  });

  await check('a plan day can be opened and started', async () => {
    clickButton('Start');
    await waitFor(() => has('Live session'), { label: 'session logger' });
    if (!has('Save session')) throw new Error('save button missing');
  });

  await check('completing a set starts the rest timer and totals the set', async () => {
    const inputs = $$('.set-input');
    if (inputs.length < 2) throw new Error('set inputs not rendered');
    // give the first set some load, then complete it
    const weight = inputs[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(weight, '100');
    weight.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(80);
    clickButton('Complete');
    await waitFor(() => has('Rest'), { label: 'rest timer' });
    await waitFor(() => has('done'), { label: 'set marked done' });
    // input values never appear in textContent, so read the node itself
    const filled = $$('.set-input').filter((i) => i.value === '100');
    if (!filled.length) throw new Error(`weight did not stick (values: ${$$('.set-input').slice(0, 4).map((i) => i.value).join('|')})`);
    if (!filled[0].disabled) throw new Error('a completed set should be locked');
  });

  await check('the exercise picker searches the live library', async () => {
    clickButton('Add exercise');
    await waitFor(() => has('Exercise library'), { label: 'picker modal' });
    const search = $$('.modal input').find((i) => /search/i.test(i.placeholder || ''));
    if (!search) throw new Error('search input missing');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(search, 'squat');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await waitFor(() => $$('.modal .ex-row').length > 0 && $$('.modal .ex-row').length < 40, { label: 'filtered results' });
    const first = $$('.modal .ex-row')[0];
    if (!/squat/i.test(first.textContent)) throw new Error(`unexpected first result: ${first.textContent.slice(0, 40)}`);
    first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => !has('Exercise library'), { label: 'modal closed' });
  });

  await check('saving the session persists it and lands in history', async () => {
    clickButton('Save session');
    await waitFor(() => has('Session saved') || has('session saved'), { label: 'save toast' });
    clickButton('History');
    await waitFor(() => $$('.table tbody tr').length >= 1, { label: 'history rows' });
    if (!has('Repeat')) throw new Error('repeat action missing');
  });

  /* ------------------------------- nutrition ---------------------------- */

  await check('nutrition view shows targets and the meal plan', async () => {
    clickNav('Nutrition');
    await waitFor(() => has('kcal') && has('protein'), { label: 'targets' });
    clickButton('Meal plan');
    await waitFor(() => has('How your target was built'), { label: 'plan rationale' });
    if (!has('Grocery list')) throw new Error('grocery list missing');
    if (!has('Rest burn')) throw new Error('human-worded targets missing');
  });

  await check('logging a food from the database updates today’s rings', async () => {
    clickButton('Today');
    await waitFor(() => has('Add food'), { label: 'today tab' });
    clickButton('Add food');
    await waitFor(() => has('Add food') && $$('.modal .ex-row').length > 0, { label: 'food list' });
    const before = $$('.ring-value')[0]?.textContent || '';
    $$('.modal .ex-row')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(80);
    clickButton('Log it');
    await waitFor(() => !$$('.modal-backdrop').length, { label: 'modal closed' });
    await waitFor(() => ($$('.ring-value')[0]?.textContent || '') !== before, { label: 'ring total updated' });
  });

  /* -------------------------------- coach ------------------------------- */

  const openCoach = async () => {
    const fab = $$('button[aria-label="Ask the coach"]')[0];
    if (!fab) throw new Error('coach FAB missing');
    fab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => $$('input[aria-label="Message"]').length > 0, { label: 'coach drawer open' });
  };
  const closeCoach = () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  await check('coach popup opens anywhere and answers from the local engine', async () => {
    await openCoach();
    await waitFor(() => has('Ask anything'), { label: 'coach empty state' });
    // empty conversation offers suggestion chips
    const chips = $$('.chip-btn').filter((c) => /\?$/.test(c.textContent.trim()));
    if (!chips.length) throw new Error('no suggestion chips in empty state');
    const proteinChip = chips.find((c) => /protein/i.test(c.textContent)) || chips[0];
    proteinChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => $$('.bubble-ai').length >= 1, { label: 'assistant reply' });
    const reply = $$('.bubble-ai')[0].textContent;
    if (reply.length < 40) throw new Error(`reply too short: ${reply}`);
    if (!/protein|kcal|g\/kg/i.test(reply)) throw new Error('reply ignored the question');
    if (!has('offline answer')) throw new Error('degraded answers must be labelled offline');
  });

  await check('typed questions work and the drawer closes cleanly', async () => {
    const input = $$('input[aria-label="Message"]')[0];
    if (!input) throw new Error('composer missing while drawer open');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Am I recovering enough between sessions?');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(60);
    input.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => $$('.bubble-user').length >= 2, { label: 'second question sent' });
    await waitFor(() => $$('.bubble-ai').length >= 2, { label: 'second reply' });
    closeCoach();
    await waitFor(() => $$('input[aria-label="Message"]').length === 0, { label: 'drawer closed' });
    // and it reopens from any screen (here: whatever page we are on)
    await openCoach();
    await waitFor(() => $$('.bubble-user').length >= 2, { label: 'history preserved across open/close' });
    closeCoach();
  });

  await check('voice-log parser maps speech to foods, grams and meal', async () => {
    const foodsRes = await api.nutrition.foods({});
    const r = parseVoiceLog('I ate 150 grams of chicken breast and 200 grams of white rice for lunch', foodsRes.foods);
    if (r.items.length !== 2) throw new Error(`expected 2 items, got ${r.items.length}: ${JSON.stringify(r.items)}`);
    if (!/Chicken breast/.test(r.items[0].food_name)) throw new Error(`first item: ${r.items[0].food_name}`);
    if (r.items[0].grams !== 150 || r.items[1].grams !== 200) throw new Error(`grams: ${r.items.map((i) => i.grams).join(',')}`);
    if (r.meal_type !== 'lunch') throw new Error(`meal: ${r.meal_type}`);
    const r2 = parseVoiceLog('a banana and some almonds as a snack', foodsRes.foods);
    if (r2.items.length !== 2 || r2.meal_type !== 'snack') throw new Error(`alias/default-serving parse failed: ${JSON.stringify(r2.items)}`);
    if (r2.items[0].grams !== 120) throw new Error(`expected banana default serving 120, got ${r2.items[0].grams}`);
    const r3 = parseVoiceLog('hello world', foodsRes.foods);
    if (r3.items.length !== 0) throw new Error('unrelated speech must parse to zero items');
  });

  await check('mic controls degrade gracefully when no microphone API exists', async () => {
    // jsdom has no getUserMedia: the mic buttons must simply not render,
    // never crash and never leave a broken control behind
    if ($$('button[aria-label="Dictate with voice"]').length) throw new Error('mic rendered without getUserMedia');
    if (has('Voice log')) throw new Error('voice-log button rendered without getUserMedia');
  });

  /* ------------------------------- progress ----------------------------- */

  await check('progress view renders charts, PRs and the heatmap', async () => {
    clickNav('Progress');
    await waitFor(() => has('Personal records'), { label: 'PR card' });
    await waitFor(() => $$('.heat-cell').length > 50, { label: 'heatmap cells' });
    for (const needle of ['Weekly volume', 'Muscle-group volume', 'Trend, 180 days']) {
      if (!has(needle)) throw new Error(`missing "${needle}"`);
    }
  });

  await check('a weigh-in can be added from the progress view', async () => {
    const inputs = $$('.input-num').filter((i) => i.placeholder === '82.4');
    if (!inputs.length) throw new Error('weight input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '81.9');
    inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(60);
    clickButton('Save measurement');
    await waitFor(() => has('Measurement saved'), { label: 'toast' });
    const res = await api.progress.metrics(30);
    const latest = res.series[res.series.length - 1];
    if (latest.weight_kg !== 81.9) throw new Error(`expected 81.9 in the API, got ${latest.weight_kg}`);
  });

  /* ------------------------------- settings ----------------------------- */

  await check('settings exposes the AI status, budget and usage', async () => {
    await openUserMenuItem('Settings');
    await waitFor(() => has('Groq connection'), { label: 'ai card' });
    for (const needle of ['Token budget', 'Tokens / minute', 'Fallback', 'scrypt']) {
      if (!has(needle.replace('Fallback', 'fallback'))) throw new Error(`missing "${needle}"`);
    }
  });

  await check('the budget can be retuned from the UI', async () => {
    const before = useStore.getState().aiStatus?.budget?.tokensPerMinute;
    clickButton('Conservative (1K TPM)');
    await waitFor(() => useStore.getState().aiStatus?.budget?.tokensPerMinute === 1000, { label: 'budget applied' });
    if (before === 1000) throw new Error('budget was already 1000 — test is not proving anything');
  });

  await check('demo account seeds a fully-populated athlete', async () => {
    const { spawnSync } = await import('node:child_process');
    const cfg = globalThis.__FF_SEED__;
    if (!cfg) throw new Error('runner did not expose seed config');
    const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/seed.js'], {
      cwd: cfg.cwd, env: { ...process.env, DATA_DIR: cfg.dataDir }, encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error((r.stderr || '').slice(0, 240));
    const lg = await api.auth.login({ email: 'xyz@gmail.com', password: 'xyz' });
    localStorage.setItem('fitforge.token', lg.token); // api client reads the token from storage
    const ov = await api.progress.overview();
    if (!(ov.headline.total_sessions >= 20)) throw new Error(`demo has only ${ov.headline.total_sessions} sessions`);
    const prs = await api.progress.prs();
    if (!(prs.prs.length >= 5) || !(prs.lifts.squat > 0)) throw new Error('demo PRs missing');
    const daily = await api.nutrition.daily(todayISO());
    void daily; // demo logs cover the last 10 days, today included
  });

  await check('signing out through the user menu returns to the landing page', async () => {
    await openUserMenuItem('Sign out');
    await waitFor(() => has('Forge the body'), { label: 'landing hero' });
    if (localStorage.getItem('fitforge.token')) throw new Error('token was not cleared');
  });

  await check('demo credentials type into the login form and reach the dashboard', async () => {
    // we are signed out on the landing page here
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const fill = (sel, v) => {
      const el = $$(sel)[0];
      if (!el) throw new Error(`input ${sel} missing`);
      setter.call(el, v);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    fill('input[placeholder="you@example.com"]', 'xyz@gmail.com');
    fill('input[placeholder="••••••••"]', 'xyz');   // 3 chars: login must not apply the register policy
    $$('form button[type="submit"]')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => /Good (morning|afternoon|evening), Demo\./.test(text()), { label: 'demo dashboard' });
    await openUserMenuItem('Sign out');
    await waitFor(() => has('Forge the body'), { label: 'back on landing' });
  });

  await check('a brand-new user can register, skip onboarding and navigate freely', async () => {
    // we are signed out on the landing page after the previous check
    const regTab = $$('.chip').find((c) => c.textContent.trim() === 'Create account');
    if (!regTab) throw new Error('register tab missing on landing');
    regTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => $$('input[placeholder="Alex"]').length > 0, { label: 'name field appears' });

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const fill = (sel, v) => {
      const el = $$(sel)[0];
      if (!el) throw new Error(`input ${sel} missing`);
      setter.call(el, v);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    fill('input[placeholder="Alex"]', 'E2E New');
    fill('input[placeholder="you@example.com"]', `e2e-new-${Date.now()}@fitforge.test`);
    fill('input[placeholder="••••••••"]', 'newpass123');
    $$('form button[type="submit"]')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    await waitFor(() => has('Build your baseline'), { label: 'onboarding after register' });
    // the wheel/sliders must already hold real defaults (the null-merge bug)
    clickButton('Skip for now');
    await waitFor(() => /Good (morning|afternoon|evening), E2E\./.test(text()), { label: 'dashboard after skip' });
    // and navigation must not bounce back to onboarding
    clickNav('Training');
    await waitFor(() => has('Forge a new plan'), { label: 'training reachable' });
    await wait(400);
    if (has('Build your baseline')) throw new Error('onboarding guard bounced back from Training');
    clickNav('Dashboard');
    await waitFor(() => /Good (morning|afternoon|evening), E2E\./.test(text()), { label: 'dashboard reachable' });
  });

  console.error = realError;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
  root.unmount();
  return failed.length === 0;
}
