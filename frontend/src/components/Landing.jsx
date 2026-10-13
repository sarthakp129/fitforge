import React, { useEffect, useState, useMemo } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import useTilt from '../hooks/useTilt.js';
import { Button, Card, Chip, Icon, Reveal, Bar, SingleRing } from './ui.jsx';
import { PasswordInput } from './Controls.jsx';
import { bmr, tdee, calorieTarget, macroTargets, bmi, weeklyRate } from '../lib/calc.js';
import { nf } from '../lib/format.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FEATURES = [
  {
    icon: 'dumbbell',
    title: 'Plans that fit you',
    body: 'Sets, reps and rest built around your goal, your gear and your injuries. Periodized volume with automatic progression.',
  },
  {
    icon: 'flame',
    title: 'Meals you can weigh',
    body: 'Daily targets and real portions — no guessing, no maths at the table. Exact macro breakdown tuned to your metabolism.',
  },
  {
    icon: 'chart',
    title: 'Progress you can see',
    body: 'Strength, bodyweight, and streaks in one clean picture. Real estimated 1RM curves and 12-week consistency heatmaps.',
  },
];

const STEPS = [
  ['Tell us about you', 'Two minutes of tactile sliders for your baseline.'],
  ['Get your plan', 'Deterministic training and nutrition, ready to follow.'],
  ['Log and improve', 'Every set and meal sharpens the next week.'],
];

const FEATURED_EXERCISES = [
  { id: 'bench_press', name: 'Barbell Bench Press', category: 'push', muscles: ['chest', 'triceps', 'front delt'], equipment: 'barbell', pattern: 'Horizontal Press', compound: true, cue: 'Retract scapulae, drive heels into the floor, flare elbows at 45°.' },
  { id: 'incline_db_press', name: 'Incline Dumbbell Press', category: 'push', muscles: ['upper chest', 'front delt'], equipment: 'dumbbell', pattern: 'Incline Press', compound: true, cue: 'Set bench at 30°, touch dumbbells gently at bottom, press up and slightly in.' },
  { id: 'overhead_press', name: 'Overhead Barbell Press', category: 'push', muscles: ['shoulders', 'triceps', 'core'], equipment: 'barbell', pattern: 'Vertical Press', compound: true, cue: 'Squeeze glutes and brace core. Push head through the window at lockout.' },
  { id: 'dips', name: 'Parallel Bar Dips', category: 'push', muscles: ['lower chest', 'triceps'], equipment: 'bodyweight', pattern: 'Vertical Press', compound: true, cue: 'Lean chest forward for pec bias; control depth to 90° elbow bend.' },
  { id: 'barbell_row', name: 'Barbell Bent-Over Row', category: 'pull', muscles: ['lats', 'rhomboids', 'biceps'], equipment: 'barbell', pattern: 'Horizontal Pull', compound: true, cue: 'Hinge at hips to 45°, pull bar toward navel leading with elbows.' },
  { id: 'pull_up', name: 'Pull-Up', category: 'pull', muscles: ['lats', 'upper back', 'biceps'], equipment: 'bodyweight', pattern: 'Vertical Pull', compound: true, cue: 'Depress shoulders before initiating pull, drive elbows toward ribcage.' },
  { id: 'lat_pulldown', name: 'Cable Lat Pulldown', category: 'pull', muscles: ['lats', 'biceps'], equipment: 'cable', pattern: 'Vertical Pull', compound: true, cue: 'Maintain slight torso arch, pull bar to clavicle, control eccentric.' },
  { id: 'cable_face_pull', name: 'Cable Face Pull', category: 'pull', muscles: ['rear delt', 'rotator cuff'], equipment: 'cable', pattern: 'Isolation', compound: false, cue: 'Pull rope toward eye level with external shoulder rotation, hold 1s.' },
  { id: 'barbell_squat', name: 'Barbell Back Squat', category: 'legs', muscles: ['quads', 'glutes', 'erectors'], equipment: 'barbell', pattern: 'Squat', compound: true, cue: 'Brace into the belt, descend below parallel with knees tracking toes.' },
  { id: 'romanian_deadlift', name: 'Romanian Deadlift (RDL)', category: 'legs', muscles: ['hamstrings', 'glutes'], equipment: 'barbell', pattern: 'Hinge', compound: true, cue: 'Push hips straight back with soft knees, feel deep hamstring stretch.' },
  { id: 'bulgarian_split_squat', name: 'Bulgarian Split Squat', category: 'legs', muscles: ['quads', 'glutes'], equipment: 'dumbbell', pattern: 'Lunge', compound: true, cue: 'Elevate rear foot on bench, descend straight down with upright torso.' },
  { id: 'cable_lateral_raise', name: 'Cable Lateral Raise', category: 'push', muscles: ['lateral delt'], equipment: 'cable', pattern: 'Isolation', compound: false, cue: 'Set pulley at wrist height, lead with elbows slightly in scapular plane.' },
  { id: 'tricep_pushdown', name: 'Cable Tricep Pushdown', category: 'push', muscles: ['triceps'], equipment: 'cable', pattern: 'Isolation', compound: false, cue: 'Pin elbows to sides, full contraction at bottom, slow 2-second negative.' },
  { id: 'incline_db_curl', name: 'Incline Dumbbell Bicep Curl', category: 'pull', muscles: ['biceps'], equipment: 'dumbbell', pattern: 'Isolation', compound: false, cue: 'Full stretch of bicep long head at bottom, curl without swinging elbows.' },
  { id: 'hanging_leg_raise', name: 'Hanging Leg Raise', category: 'core', muscles: ['abs', 'hip flexors'], equipment: 'bodyweight', pattern: 'Core Flexion', compound: false, cue: 'Curl pelvis up toward chest rather than swinging legs; control descent.' },
  { id: 'standing_calf_raise', name: 'Standing Calf Raise', category: 'legs', muscles: ['calves'], equipment: 'machine', pattern: 'Isolation', compound: false, cue: 'Full deep stretch at bottom, explosive rise onto big toe, 2s pause.' },
];

const FAQS = [
  {
    q: 'Do I need a Groq API key to use FitForge?',
    a: 'No! FitForge includes a full deterministic fitness engine that generates comprehensive splits, calculates Mifflin-St Jeor nutrition targets, and manages progressive overload completely offline with zero tokens. Adding a free Groq API key is strictly optional for conversational AI coach features.',
  },
  {
    q: 'Is my personal fitness and bodyweight data private?',
    a: '100% private. All your logs, weigh-ins, workout history, and personal notes are stored locally in your own SQLite database on your server. FitForge has zero tracking scripts, zero third-party telemetry, and zero cloud analytics.',
  },
  {
    q: 'Can I host FitForge on my home server or Raspberry Pi?',
    a: 'Absolutely. FitForge is designed with an ultralight Node.js and SQLite footprint, consuming less than 80MB of RAM. You can run it with Docker (docker run -p 8080:8080 ...) or directly via npm start on port 8080.',
  },
  {
    q: 'How does the progressive overload algorithm work?',
    a: 'FitForge implements a double-progression model paired with RPE tracking. When you hit the upper rep target across all working sets with good form, the system automatically prescribes an incremental load increase for your next session.',
  },
  {
    q: 'Can I backup or export my training data anytime?',
    a: 'Yes. In the Progress view, you can export your entire database as a clean JSON backup or download a spreadsheet-ready CSV with all your workouts, sets, and bodyweight history whenever you want.',
  },
];

export default function Landing() {
  const { login, register, handleError } = useStore();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');
  const [demo, setDemo] = useState(false);
  const [counts, setCounts] = useState({ exercises: 102, foods: 62 });
  const [exerciseList, setExerciseList] = useState(FEATURED_EXERCISES);
  const [faqOpen, setFaqOpen] = useState(0);
  const tilt = useTilt({ max: 5 });

  // Calculator state
  const [calcSex, setCalcSex] = useState('male');
  const [calcGoal, setCalcGoal] = useState('fat_loss');
  const [calcActivity, setCalcActivity] = useState('moderate');
  const [calcAge, setCalcAge] = useState(28);
  const [calcWeight, setCalcWeight] = useState(78);
  const [calcHeight, setCalcHeight] = useState(178);

  // Exercise catalog search/filter state
  const [catCategory, setCatCategory] = useState('all');
  const [catQuery, setCatQuery] = useState('');

  useEffect(() => {
    Promise.all([
      api.training.exercises().catch(() => null),
      api.nutrition.foods().catch(() => null),
      api.health().catch(() => null),
    ]).then(([ex, fo, h]) => {
      setCounts({ exercises: ex?.count ?? 102, foods: fo?.count ?? 62 });
      setDemo(Boolean(h?.demo));
      if (ex?.exercises?.length) {
        setExerciseList(ex.exercises);
      }
    });
  }, []);

  // Compute live targets for public calculator
  const calcProfile = useMemo(() => ({
    sex: calcSex,
    age: calcAge,
    weight_kg: calcWeight,
    height_cm: calcHeight,
    goal: calcGoal,
    activity_level: calcActivity,
  }), [calcSex, calcAge, calcWeight, calcHeight, calcGoal, calcActivity]);

  const calcResults = useMemo(() => {
    const bmrVal = bmr(calcProfile);
    const tdeeVal = tdee(calcProfile);
    const targetKcal = calorieTarget(calcProfile);
    const macros = macroTargets(calcProfile);
    const bmiVal = bmi(calcProfile);
    const rate = weeklyRate(calcProfile);
    return { bmrVal, tdeeVal, targetKcal, macros, bmiVal, rate };
  }, [calcProfile]);

  // Filter exercises
  const filteredExercises = useMemo(() => {
    let list = exerciseList;
    if (catCategory !== 'all') {
      list = list.filter((e) => e.category === catCategory);
    }
    if (catQuery.trim()) {
      const q = catQuery.toLowerCase().trim();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        (e.muscles || []).some((m) => m.toLowerCase().includes(q)) ||
        (e.equipment || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 12);
  }, [exerciseList, catCategory, catQuery]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

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
    setBusy(true);
    setApiError('');
    try {
      await login('xyz@gmail.com', 'xyz');
    } catch (err) {
      setApiError(err.message || 'Demo login failed.');
    } finally {
      setBusy(false);
    }
  };

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="shell">
      {/* ------------------------ Sticky Public Navigation ------------------------ */}
      <header className="public-header" aria-label="Public navigation">
        <div className="wrap row-between">
          <div className="brand" role="button" tabIndex={0} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ cursor: 'pointer' }}>
            <span className="brand-mark"><Icon name="dumbbell" size={16} style={{ color: 'var(--ember)' }} /></span>
            <span>FitForge</span>
          </div>

          <nav className="public-nav-links" aria-label="Section links">
            <button type="button" className="public-nav-link" onClick={() => scrollTo('features')}>Features</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('calculator')}>Calculator</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('exercises')}>102 Exercises</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('architecture')}>Architecture</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('faq')}>FAQ</button>
          </nav>

          <div className="row gap-8">
            {demo && (
              <Button variant="ghost" size="sm" onClick={demoLogin} disabled={busy} title="One-click demo account">
                <Icon name="play" size={13} /> Demo
              </Button>
            )}
            <Button variant="ember" size="sm" onClick={() => { setMode('login'); scrollTo('access'); }}>
              Sign in
            </Button>
          </div>
        </div>
      </header>

      {/* ------------------------------ Hero Section ----------------------------- */}
      <header className="hero" style={{ paddingBottom: 36 }}>
        <div className="wrap hero-grid">
          <div>
            <h1>Forge the body<br />you actually <span>want</span>.</h1>
            <p className="hero-sub">
              Your training, your meals and your progress in one private place —
              built around your body, your schedule and your gear.
            </p>
            <div className="hero-cta">
              <Button variant="ember" size="lg" onClick={() => { setMode('register'); scrollTo('access'); }}>
                Create free account <Icon name="arrowRight" size={17} />
              </Button>
              {demo && (
                <Button variant="soft" size="lg" onClick={demoLogin} disabled={busy}>
                  <Icon name="play" size={15} /> Try the demo
                </Button>
              )}
              <Button variant="ghost" size="lg" onClick={() => scrollTo('calculator')}>
                <Icon name="target" size={16} /> Live calculator
              </Button>
            </div>
            <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 22 }}>
              <Chip tone="ember"><Icon name="dumbbell" size={12} /> {counts.exercises} exercises, coached</Chip>
              <Chip tone="teal"><Icon name="flame" size={12} /> {counts.foods} everyday foods</Chip>
              <Chip><Icon name="check" size={12} /> Private — runs on your server</Chip>
              <Chip tone="ghost"><Icon name="bolt" size={12} /> Zero-token local engine</Chip>
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
                    <div className="bar flex-1" style={{ height: 8 }}>
                      <div className={`bar-fill bar-${t}`} style={{ width: `${w}%` }} />
                    </div>
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
              <div className="tiny muted" style={{ marginTop: 10 }}>Interactive preview — yours fills in as you log.</div>
            </div>
          </div>
        </div>
      </header>

      {/* ------------------------ Live Interactive Calculator ------------------------ */}
      <section className="section" id="calculator" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="section-head center" style={{ maxWidth: 680, marginInline: 'auto' }}>
              <span className="eyebrow" style={{ color: 'var(--ember)' }}>Interactive Metabolism Engine</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Calculate your exact nutrition targets.</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Slide your physical numbers below. The client-side Mifflin-St Jeor engine recalculates BMR,
                maintenance TDEE, and macro gram allocations in real time.
              </p>
            </div>
          </Reveal>

          <Reveal delay={60}>
            <Card solid className="card-pad-lg" style={{ marginTop: 24 }}>
              <div className="grid grid-side" style={{ alignItems: 'start', gap: 32 }}>
                {/* Left: Input controls */}
                <div className="stack gap-16">
                  <div>
                    <span className="eyebrow">Goal & Metabolism</span>
                    <div className="row gap-6" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                      {[
                        ['fat_loss', 'Fat Loss', 'ember'],
                        ['recomp', 'Recomposition', 'teal'],
                        ['muscle_gain', 'Muscle Gain', 'ok'],
                        ['strength', 'Strength', 'warn'],
                        ['endurance', 'Endurance', 'ghost'],
                      ].map(([id, label, tone]) => (
                        <Chip
                          key={id}
                          tone={calcGoal === id ? tone : ''}
                          active={calcGoal === id}
                          onClick={() => setCalcGoal(id)}
                        >
                          {label}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="eyebrow">Biological Sex</span>
                    <div className="row gap-6" style={{ marginTop: 8 }}>
                      {['male', 'female'].map((s) => (
                        <Chip
                          key={s}
                          active={calcSex === s}
                          onClick={() => setCalcSex(s)}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {s}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div className="slider-row">
                    <div className="row-between">
                      <span className="label">Bodyweight</span>
                      <span className="mono strong">{calcWeight} kg</span>
                    </div>
                    <input
                      type="range"
                      className="slider"
                      min={40}
                      max={140}
                      value={calcWeight}
                      onChange={(e) => setCalcWeight(Number(e.target.value))}
                      aria-label="Bodyweight"
                    />
                  </div>

                  <div className="slider-row">
                    <div className="row-between">
                      <span className="label">Height</span>
                      <span className="mono strong">{calcHeight} cm</span>
                    </div>
                    <input
                      type="range"
                      className="slider"
                      min={140}
                      max={210}
                      value={calcHeight}
                      onChange={(e) => setCalcHeight(Number(e.target.value))}
                      aria-label="Height"
                    />
                  </div>

                  <div className="slider-row">
                    <div className="row-between">
                      <span className="label">Age</span>
                      <span className="mono strong">{calcAge} yrs</span>
                    </div>
                    <input
                      type="range"
                      className="slider"
                      min={18}
                      max={75}
                      value={calcAge}
                      onChange={(e) => setCalcAge(Number(e.target.value))}
                      aria-label="Age"
                    />
                  </div>

                  <div>
                    <span className="label">Activity Level</span>
                    <div className="row gap-6" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                      {[
                        ['sedentary', 'Sedentary (1.2×)'],
                        ['light', 'Light (1.38×)'],
                        ['moderate', 'Moderate (1.55×)'],
                        ['active', 'Active (1.73×)'],
                        ['athlete', 'Athlete (1.9×)'],
                      ].map(([id, label]) => (
                        <Chip
                          key={id}
                          active={calcActivity === id}
                          onClick={() => setCalcActivity(id)}
                        >
                          {label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: Calculated outputs */}
                <div className="stack gap-16" style={{ background: 'var(--surface-2)', padding: 22, borderRadius: 'var(--radius)' }}>
                  <div className="row-between">
                    <span className="eyebrow">Prescribed Daily Target</span>
                    <Chip tone="ember">BMI {calcResults.bmiVal}</Chip>
                  </div>

                  <div>
                    <div className="num-hero" style={{ color: 'var(--ember)' }}>
                      {nf(calcResults.targetKcal)}
                      <span className="small muted" style={{ fontWeight: 500 }}> kcal / day</span>
                    </div>
                    <div className="row gap-12 tiny muted" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <span>BMR: <b>{nf(calcResults.bmrVal)}</b> kcal</span>
                      <span>·</span>
                      <span>Maintenance TDEE: <b>{nf(calcResults.tdeeVal)}</b> kcal</span>
                      {calcResults.rate !== 0 && (
                        <>
                          <span>·</span>
                          <span style={{ color: calcResults.rate < 0 ? 'var(--ok-text)' : 'var(--teal-text)' }}>
                            {calcResults.rate > 0 ? `+${calcResults.rate}` : calcResults.rate} kg / week
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <hr className="divider" style={{ margin: '6px 0' }} />

                  <span className="eyebrow">Macro Distribution</span>
                  <div className="stack gap-12">
                    {[
                      ['Protein', calcResults.macros.protein_g, 'teal', calcResults.macros.protein_g * 4],
                      ['Carbs', calcResults.macros.carbs_g, 'violet', calcResults.macros.carbs_g * 4],
                      ['Fat', calcResults.macros.fat_g, 'amber', calcResults.macros.fat_g * 9],
                    ].map(([label, grams, tone, cal]) => {
                      const share = Math.round((cal / calcResults.targetKcal) * 100);
                      return (
                        <div key={label} className="stack gap-4">
                          <div className="row-between small">
                            <span className="strong">{label}</span>
                            <span className="mono strong">
                              {grams}g <span className="tiny muted font-normal">({share}%)</span>
                            </span>
                          </div>
                          <div className="bar" style={{ height: 8 }}>
                            <div className={`bar-fill bar-${tone}`} style={{ width: `${Math.min(100, share)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="row-between tiny muted" style={{ marginTop: 4 }}>
                    <span>💧 Hydration: <b>{calcResults.macros.water_l}L</b> / day</span>
                    <span>🌾 Fiber: <b>{calcResults.macros.fiber_g}g</b> / day</span>
                  </div>

                  <Button
                    variant="ember"
                    size="md"
                    block
                    style={{ marginTop: 8 }}
                    onClick={() => { setMode('register'); scrollTo('access'); }}
                  >
                    Adopt these targets into your plan <Icon name="arrowRight" size={15} />
                  </Button>
                </div>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* ------------------------ Three Promises & Steps ------------------------ */}
      <section className="section" style={{ padding: '40px 0' }} id="features">
        <div className="wrap">
          <div className="grid grid-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 70}>
                <Card hover className="stack gap-10" style={{ height: '100%' }}>
                  <span className="brand-mark" style={{ background: 'var(--ember-soft)' }}>
                    <Icon name={f.icon} size={17} style={{ color: 'var(--ember)' }} />
                  </span>
                  <h3>{f.title}</h3>
                  <p className="small muted" style={{ lineHeight: 1.6 }}>{f.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>

          <div className="row gap-24" style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 38 }}>
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

      {/* ------------------- Interactive Exercise Library Browser ------------------- */}
      <section className="section" id="exercises" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
              <div>
                <span className="eyebrow" style={{ color: 'var(--teal)' }}>Biomechanical Movement Database</span>
                <h2 className="section-title" style={{ marginTop: 6 }}>102 curated, coached exercises.</h2>
                <p className="section-sub">
                  Every exercise includes muscle targeting, movement pattern classification, equipment filters, and form cues.
                </p>
              </div>

              {/* Category selector pills */}
              <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                {[
                  ['all', 'All Movements'],
                  ['push', 'Push / Chest'],
                  ['pull', 'Pull / Back'],
                  ['legs', 'Legs'],
                  ['core', 'Core'],
                ].map(([c, label]) => (
                  <Chip
                    key={c}
                    active={catCategory === c}
                    onClick={() => setCatCategory(c)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <input
                className="input"
                placeholder="Search exercise by name, muscle (e.g. lats, quads), or equipment..."
                value={catQuery}
                onChange={(e) => setCatQuery(e.target.value)}
                aria-label="Filter exercises"
                style={{ maxWidth: 540 }}
              />
            </div>
          </Reveal>

          <div className="catalog-grid">
            {filteredExercises.map((ex, i) => (
              <Reveal key={ex.id} delay={Math.min(i * 30, 240)}>
                <div className="catalog-card">
                  <div className="row-between">
                    <span className="strong" style={{ fontSize: '0.98rem' }}>{ex.name}</span>
                    <Chip tone="ghost" style={{ fontSize: '0.74rem' }}>{ex.equipment}</Chip>
                  </div>

                  <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                    {(ex.muscles || []).map((m) => (
                      <span key={m} className="tiny muted" style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6 }}>
                        {m}
                      </span>
                    ))}
                    {ex.compound && (
                      <span className="tiny strong" style={{ color: 'var(--ember)', padding: '2px 6px' }}>
                        Compound
                      </span>
                    )}
                  </div>

                  {ex.cue && (
                    <div className="tiny muted" style={{ lineHeight: 1.45, marginTop: 4 }}>
                      💡 {ex.cue}
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={100}>
            <div className="row-between" style={{ marginTop: 24, padding: '14px 20px', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
              <span className="small muted">
                Showing {filteredExercises.length} of {counts.exercises} coached movements.
              </span>
              <Button variant="ghost" size="sm" onClick={() => scrollTo('access')}>
                Open full library in app <Icon name="arrowRight" size={14} />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* -------------------- Architecture Bento (Under The Hood) ------------------- */}
      <section className="section" id="architecture" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="section-head center" style={{ maxWidth: 680, marginInline: 'auto' }}>
              <span className="eyebrow" style={{ color: 'var(--ember)' }}>Engineering & Privacy</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Architected for independence.</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Zero proprietary cloud traps. Zero lock-in. A deterministic local engine and private SQLite database that keeps running even when the internet doesn't.
              </p>
            </div>
          </Reveal>

          <div className="bento-grid" style={{ marginTop: 28 }}>
            <Reveal delay={0} className="bento-span-7">
              <div className="bento-card" style={{ height: '100%' }}>
                <span className="brand-mark" style={{ background: 'var(--ember-soft)', marginBottom: 14 }}>
                  <Icon name="bolt" size={18} style={{ color: 'var(--ember)' }} />
                </span>
                <h3>Dual-Engine Architecture (Deterministic + Groq LPU)</h3>
                <p className="small muted" style={{ lineHeight: 1.6, marginTop: 8 }}>
                  A pure deterministic JavaScript rule-engine generates comprehensive training splits, periodized volume,
                  and exact Mifflin-St Jeor macros in 2 milliseconds with <b>zero tokens consumed</b>. When a Groq API key is supplied,
                  our LPU governor activates to deliver intelligent coaching and adaptive substitutions without ever stalling.
                </p>
                <div className="row gap-8" style={{ marginTop: 16 }}>
                  <Chip tone="ok">100% Offline Capable</Chip>
                  <Chip tone="ghost">2ms Cold Start</Chip>
                </div>
              </div>
            </Reveal>

            <Reveal delay={60} className="bento-span-5">
              <div className="bento-card" style={{ height: '100%' }}>
                <span className="brand-mark" style={{ background: 'var(--teal-soft)', marginBottom: 14 }}>
                  <Icon name="chart" size={18} style={{ color: 'var(--teal)' }} />
                </span>
                <h3>Sliding-Window Token Governor</h3>
                <p className="small muted" style={{ lineHeight: 1.6, marginTop: 8 }}>
                  Hardware-inspired rate limiter tracks TPM (Tokens Per Minute), RPM, and RPD in a FIFO sliding window.
                  Automated cache signatures prevent duplicate prompts and eliminate 429 quota spikes.
                </p>
                <div className="row gap-8" style={{ marginTop: 16 }}>
                  <Chip tone="teal">6,000 TPM Protected</Chip>
                </div>
              </div>
            </Reveal>

            <Reveal delay={120} className="bento-span-5">
              <div className="bento-card" style={{ height: '100%' }}>
                <span className="brand-mark" style={{ background: 'var(--amber-soft)', marginBottom: 14 }}>
                  <Icon name="target" size={18} style={{ color: 'var(--amber)' }} />
                </span>
                <h3>Single-File SQLite Storage</h3>
                <p className="small muted" style={{ lineHeight: 1.6, marginTop: 8 }}>
                  Your entire athlete profile, workout logs, PR records, and weigh-in history live in a self-contained
                  SQLite database file on your server. Zero telemetry, zero external database servers, and instant JSON/CSV backup.
                </p>
                <div className="row gap-8" style={{ marginTop: 16 }}>
                  <Chip tone="warn">Zero Telemetry</Chip>
                  <Chip tone="ghost">One-Click CSV</Chip>
                </div>
              </div>
            </Reveal>

            <Reveal delay={180} className="bento-span-7">
              <div className="bento-card" style={{ height: '100%' }}>
                <span className="brand-mark" style={{ background: 'var(--violet-soft)', marginBottom: 14 }}>
                  <Icon name="spark" size={18} style={{ color: 'var(--violet)' }} />
                </span>
                <h3>Soft Tactile Material (Single Light Source)</h3>
                <p className="small muted" style={{ lineHeight: 1.6, marginTop: 8 }}>
                  Handcrafted neumorphic design system built on a single soothing `#e7ebf3` surface.
                  Top-left physical shadow pairs carve inputs as wells and push actionables forward as raised tactile controls.
                  Press feedback provides real physical satisfaction on every touch.
                </p>
                <div className="row gap-8" style={{ marginTop: 16 }}>
                  <Chip tone="ok">Tactile Depressions</Chip>
                  <Chip tone="ghost">Zero UI Framework Bloat</Chip>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------ Interactive FAQ Accordion ----------------------- */}
      <section className="section" id="faq" style={{ padding: '48px 0' }}>
        <div className="wrap-narrow" style={{ maxWidth: 760, marginInline: 'auto' }}>
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow" style={{ color: 'var(--teal)' }}>Common Questions</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Frequently Asked Questions</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Everything you need to know about self-hosting, privacy, and algorithmic design.
              </p>
            </div>
          </Reveal>

          <div className="stack gap-12" style={{ marginTop: 24 }}>
            {FAQS.map((faq, i) => {
              const isOpen = faqOpen === i;
              return (
                <Reveal key={faq.q} delay={i * 40}>
                  <div className="faq-card">
                    <button
                      type="button"
                      className="faq-trigger"
                      onClick={() => setFaqOpen(isOpen ? -1 : i)}
                      aria-expanded={isOpen}
                    >
                      <span>{faq.q}</span>
                      <Icon
                        name="chev"
                        size={16}
                        style={{
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform var(--t-fast) var(--ease)',
                          color: 'var(--muted)',
                        }}
                      />
                    </button>
                    {isOpen && (
                      <div className="faq-body">
                        {faq.a}
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------------------- Access (Sign In / Register) ----------------- */}
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

      {/* ------------------------ Editorial 4-Column Footer ----------------------- */}
      <footer style={{ padding: '36px 0 44px', borderTop: '2px solid var(--surface-2)' }}>
        <div className="wrap">
          <div className="grid grid-4" style={{ gap: 32, marginBottom: 36 }}>
            <div className="stack gap-10">
              <div className="row gap-10">
                <span className="brand-mark"><Icon name="dumbbell" size={15} style={{ color: 'var(--ember)' }} /></span>
                <span className="strong" style={{ fontSize: '1.1rem' }}>FitForge</span>
              </div>
              <p className="tiny muted" style={{ lineHeight: 1.6 }}>
                Tactile, private strength and nutrition engineering.
                Built for athletes who track real numbers and want honest data ownership.
              </p>
              <div className="row gap-6 tiny" style={{ color: 'var(--ok-text)', marginTop: 4 }}>
                <span className="dot dot-ok dot-live" /> Local Engine: Ready
              </div>
            </div>

            <div className="stack gap-8">
              <span className="eyebrow">Platform</span>
              <button type="button" className="tiny muted" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => scrollTo('features')}>Three Core Promises</button>
              <button type="button" className="tiny muted" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => scrollTo('calculator')}>Live Macro Calculator</button>
              <button type="button" className="tiny muted" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => scrollTo('exercises')}>102 Exercise Catalog</button>
              <button type="button" className="tiny muted" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => scrollTo('architecture')}>Dual Engine Specs</button>
              <button type="button" className="tiny muted" style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => scrollTo('faq')}>FAQ & Self-Hosting</button>
            </div>

            <div className="stack gap-8">
              <span className="eyebrow">Tech Stack</span>
              <span className="tiny muted">Node.js 22.x LTS</span>
              <span className="tiny muted">Express 5.1 REST API</span>
              <span className="tiny muted">React 19 + Vite</span>
              <span className="tiny muted">SQLite 3 (WAL mode)</span>
              <span className="tiny muted">Groq LPU Governor</span>
            </div>

            <div className="stack gap-8">
              <span className="eyebrow">Self-Hosting</span>
              <span className="tiny muted">Run locally with Node or Docker:</span>
              <code className="kbd" style={{ padding: '6px 10px', fontSize: '0.78rem', display: 'block', wordBreak: 'break-all' }}>
                npm start
              </code>
              <span className="tiny muted">Port: <b>8080</b> (HTTP/JSON)</span>
            </div>
          </div>

          <div className="row-between tiny muted" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 20, flexWrap: 'wrap', gap: 12 }}>
            <div className="row gap-8">
              <span>© {new Date().getFullYear()} FitForge. All rights reserved.</span>
              <span>·</span>
              <span>Private & Local First</span>
            </div>
            <span>Train. Eat. Evolve.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
