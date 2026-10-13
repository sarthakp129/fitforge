import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import useTilt from '../hooks/useTilt.js';
import { Button, Card, Chip, Icon, Reveal } from './ui.jsx';
import { PasswordInput } from './Controls.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Three promises, one line each. Users scan icons and headlines, not prose. */
const FEATURES = [
  { icon: 'dumbbell', title: 'Plans that fit you', body: 'Sets, reps and rest built around your goal, your gear and your injuries.' },
  { icon: 'flame', title: 'Meals you can weigh', body: 'Daily targets and real portions — no guessing, no maths at the table.' },
  { icon: 'chart', title: 'Progress you can see', body: 'Strength, weight and streaks in one clean picture.' },
];

const STEPS = [
  ['Tell us about you', 'Two minutes of sliders.'],
  ['Get your plan', 'Training and meals, ready to follow.'],
  ['Log and improve', 'Every set and meal sharpens the next week.'],
];

export default function Landing() {
  const { login, register, handleError } = useStore();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');
  const [demo, setDemo] = useState(false);
  const [counts, setCounts] = useState({ exercises: null, foods: null });
  const tilt = useTilt({ max: 5 });

  useEffect(() => {
    Promise.all([
      api.training.exercises().catch(() => null),
      api.nutrition.foods().catch(() => null),
      api.health().catch(() => null),
    ]).then(([ex, fo, h]) => {
      setCounts({ exercises: ex?.count ?? 102, foods: fo?.count ?? 62 });
      setDemo(Boolean(h?.demo));
    });
  }, []);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const validate = () => {
    const e = {};
    if (mode === 'register' && form.name.trim().length < 2) e.name = 'What should we call you?';
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'That doesn’t look like an email address.';
    if (mode === 'register' && form.password.length < 6) e.password = 'At least 6 characters.';
    if (mode === 'login' && !form.password) e.password = 'Enter your password.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email.trim(), form.password);
      else await register(form.name.trim(), form.email.trim(), form.password);
    } catch (err) {
      setApiError(err.message || 'Something went wrong.');
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async () => {
    setBusy(true); setApiError('');
    try { await login('xyz@gmail.com', 'xyz'); }
    catch (err) { setApiError(err.message || 'Demo login failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="shell">
      <div className="public-header">
        <div className="wrap row-between">
          <div className="brand">
            <span className="brand-mark"><Icon name="dumbbell" size={16} style={{ color: 'var(--ember)' }} /></span>
            FitForge
          </div>
          <div className="row gap-8">
            <Button variant="ghost" size="sm" onClick={() => document.getElementById('access')?.scrollIntoView({ behavior: 'smooth' })}>
              Sign in
            </Button>
          </div>
        </div>
      </div>

      {/* hero: copy left, product right — no void between them */}
      <header className="hero" style={{ paddingBottom: 28 }}>
        <div className="wrap hero-grid">
          <div>
            <h1>Forge the body<br />you actually <span>want</span>.</h1>
            <p className="hero-sub">
              Your training, your meals and your progress in one private place —
              built around your body, your schedule and your gear.
            </p>
            <div className="hero-cta">
              <Button variant="ember" size="lg" onClick={() => { setMode('register'); document.getElementById('access')?.scrollIntoView({ behavior: 'smooth' }); }}>
                Create free account <Icon name="arrowRight" size={17} />
              </Button>
              {demo && (
                <Button variant="soft" size="lg" onClick={demoLogin} disabled={busy}>
                  <Icon name="play" size={15} /> Try the demo
                </Button>
              )}
            </div>
            <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 22 }}>
              <Chip tone="ember"><Icon name="dumbbell" size={12} /> {counts.exercises} exercises, coached</Chip>
              <Chip tone="teal"><Icon name="flame" size={12} /> {counts.foods} everyday foods</Chip>
              <Chip><Icon name="check" size={12} /> Private — runs on your server</Chip>
            </div>
          </div>

          <div style={{ perspective: 1000 }}>
            <div
              ref={tilt.ref}
              onMouseMove={tilt.onMouseMove}
              onMouseLeave={tilt.onMouseLeave}
              className="card preview-card"
              style={{ transition: 'transform 200ms var(--ease)' }}
            >
              <div className="row-between" style={{ marginBottom: 12 }}>
                <span className="eyebrow">Today</span>
                <Chip tone="ok">3 of 4 sessions</Chip>
              </div>
              <div className="row-between" style={{ alignItems: 'baseline' }}>
                <div>
                  <div className="num-hero" style={{ color: 'var(--ember)' }}>48.2k<span className="small muted"> kg</span></div>
                  <div className="tiny muted">lifted this week</div>
                </div>
                <div className="stack gap-4" style={{ alignItems: 'flex-end' }}>
                  <span className="tiny muted">streak</span>
                  <span className="mono strong" style={{ fontSize: '1.4rem', color: 'var(--ok)' }}>6 days</span>
                </div>
              </div>
              <div className="stack g8" style={{ marginTop: 14 }}>
                {[['Protein', 88, 'teal'], ['Carbs', 64, 'violet'], ['Fat', 71, 'amber']].map(([l, w, t]) => (
                  <div key={l} className="row g8">
                    <span className="tiny strong" style={{ width: 52 }}>{l}</span>
                    <div className="bar flex-1" style={{ height: 8 }}><div className={`bar-fill bar-${t}`} style={{ width: `${w}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="stack g6" style={{ marginTop: 14 }}>
                {['Bench press · 4 × 6-10 · 100 kg', 'Barbell row · 4 × 8 · 82 kg'].map((r) => (
                  <div key={r} className="ex-row" style={{ padding: '10px 12px' }}>
                    <span className="small strong">{r}</span>
                    <Chip tone="ghost">today</Chip>
                  </div>
                ))}
              </div>
              <div className="tiny muted" style={{ marginTop: 10 }}>Sample data — yours fills in as you log.</div>
            </div>
          </div>
        </div>
      </header>

      {/* three promises */}
      <section className="section" style={{ padding: '36px 0' }} id="features">
        <div className="wrap">
          <div className="grid grid-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70}>
                <Card hover className="stack g10" style={{ height: '100%' }}>
                  <span className="brand-mark" style={{ background: 'var(--ember-soft)' }}>
                    <Icon name={f.icon} size={17} style={{ color: 'var(--ember)' }} />
                  </span>
                  <h3>{f.title}</h3>
                  <p className="small muted" style={{ lineHeight: 1.6 }}>{f.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
          <div className="row gap-24" style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 34 }}>
            {STEPS.map(([t, d], i) => (
              <Reveal key={t} delay={i * 70}>
                <div className="row gap-10">
                  <span className="flow-dot mono">{i + 1}</span>
                  <span className="stack gap-2">
                    <span className="strong small">{t}</span>
                    <span className="tiny muted">{d}</span>
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* one centered card, no split void */}
      <section className="section" style={{ padding: '28px 0 56px' }} id="access">
        <div className="wrap-narrow" style={{ maxWidth: 560, marginInline: 'auto' }}>
          <Reveal>
            <Card className="card-pad-lg">
              <div className="row gap-6" style={{ marginBottom: 16, justifyContent: 'center' }}>
                <Chip active={mode === 'login'} onClick={() => { setMode('login'); setErrors({}); setApiError(''); }}>Sign in</Chip>
                <Chip active={mode === 'register'} onClick={() => { setMode('register'); setErrors({}); setApiError(''); }}>Create account</Chip>
              </div>
              <h2 className="center" style={{ fontSize: '1.5rem' }}>{mode === 'login' ? 'Welcome back.' : 'Two minutes to your first plan.'}</h2>
              <form onSubmit={submit} className="stack gap-12" style={{ marginTop: 18 }} noValidate>
                {mode === 'register' && (
                  <div className="field">
                    <span className="label">Name</span>
                    <input className="input" value={form.name} onChange={set('name')} placeholder="Alex" autoComplete="name" aria-label="Name" />
                  </div>
                )}
                <div className="field">
                  <span className="label">Email</span>
                  <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" aria-label="Email" inputMode="email" />
                </div>
                <div className="field">
                  <span className="label">Password</span>
                  <PasswordInput value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} ariaInvalid={Boolean(errors.password)} />
                  {errors.password && <span className="field-error">{errors.password}</span>}
                </div>
                {apiError && <div className="chip chip-warn" role="alert" style={{ justifyContent: 'center' }}><Icon name="bolt" size={12} /> {apiError}</div>}
                <Button type="submit" variant="ember" size="lg" loading={busy} block>
                  {mode === 'login' ? 'Sign in' : 'Create account'} <Icon name="arrowRight" size={17} />
                </Button>
                {demo && mode === 'login' && (
                  <Button type="button" variant="soft" size="lg" onClick={demoLogin} disabled={busy} block>
                    <Icon name="play" size={15} /> Try the demo account
                  </Button>
                )}
              </form>
              <p className="tiny muted center" style={{ marginTop: 14 }}>Free and private — everything stays on your server.</p>
            </Card>
          </Reveal>
        </div>
      </section>

      <footer style={{ padding: '0 0 44px' }}>
        <div className="wrap row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row gap-10">
            <span className="brand-mark"><Icon name="dumbbell" size={15} style={{ color: 'var(--ember)' }} /></span>
            <span className="strong">FitForge</span>
            <span className="tiny muted">Train. Eat. Evolve.</span>
          </div>
          <span className="tiny muted">Made for people who show up.</span>
        </div>
      </footer>
    </div>
  );
}
