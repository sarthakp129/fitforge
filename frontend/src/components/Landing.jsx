import React, { useEffect, useState, useMemo } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import useTilt from '../hooks/useTilt.js';
import { Button, Card, Chip, Icon, Reveal, Bar, SingleRing, Modal, Empty } from './ui.jsx';
import { PasswordInput } from './Controls.jsx';
import { bmr, tdee, calorieTarget, macroTargets, bmi, weeklyRate } from '../lib/calc.js';
import { nf, titleCase } from '../lib/format.js';

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

const TESTIMONIALS = [
  {
    name: 'Marcus Vance',
    role: 'Competitive Lifter · 32',
    avatar: 'MV',
    highlight: '-14 kg Fat Loss & 140 kg Bench',
    quote: 'The automated progressive overload and Mifflin-St Jeor engine took every shred of guesswork away. 16 weeks in, every workout feels razor sharp, calculated, and intentional.',
    stats: '16 weeks · 64 logged sessions',
  },
  {
    name: 'Elena Rostova',
    role: 'Recomposition Athlete · 27',
    avatar: 'ER',
    highlight: '18% Body Fat Milestone',
    quote: 'Finally a fitness platform with zero predatory paywalls, zero ads, and true local data privacy. Having my nutrition targets automatically calibrate to my workout intensity made all the difference.',
    stats: '12 weeks · 48 logged sessions',
  },
  {
    name: 'David Sterling',
    role: 'Strength & Conditioning · 38',
    avatar: 'DS',
    highlight: '+42 kg Total on The Big 3',
    quote: 'The 2ms local engine runs faster than any cloud app. When I logged a mild shoulder impingement, the generator instantly adapted my horizontal presses without breaking volume.',
    stats: '24 weeks · 96 logged sessions',
  },
];

const FAQS = [
  {
    q: 'Does FitForge work 100% offline without sending my data to third parties?',
    a: 'Yes, completely. FitForge uses a standalone SQLite database stored locally on your own machine or server. The core training and nutrition split generator runs deterministically in pure JavaScript with zero tokens and zero external network calls. Your weigh-ins, logs, and body metrics never leave your possession.',
  },
  {
    q: 'How does the AI Coach work if I don’t configure an API key?',
    a: 'FitForge is built with a dual-engine architecture. Without any API key, the local rules engine generates periodized multi-week workout splits, progressive overload calculations, and exact macronutrient grams. When an optional free Groq LPU API key is provided, the AI coach activates to provide contextual natural language training answers with built-in token budget protection.',
  },
  {
    q: 'Can I tailor workouts around joint injuries or limited home gym equipment?',
    a: 'Yes. FitForge includes biomechanical injury filters (such as knee, lower back, or shoulder protections) that automatically prune hostile exercises from your plan and replace them with safe movement patterns. You can also toggle between Full Gym, Dumbbells Only, and Home Bodyweight setups.',
  },
  {
    q: 'How can I backup or export my athlete history?',
    a: 'You have full data sovereignty. FitForge provides one-click export for both full JSON state snapshots and clean CSV spreadsheets of your workouts, 1RM estimates, and daily macronutrient intake. You can import your backup anytime.',
  },
  {
    q: 'Can I use FitForge on my smartphone or tablet?',
    a: 'Yes. FitForge is crafted with a mobile-first responsive layout, tactile touch targets (≥ 44px), iOS safe-area clearance, and persistent bottom navigation tabs so you can smoothly log sets and track meals right from the gym floor.',
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
  const tilt = useTilt({ max: 5 });

  // Interactive modal & copy states
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [copiedMacros, setCopiedMacros] = useState(false);
  const [copiedCue, setCopiedCue] = useState(false);
  const [openFaq, setOpenFaq] = useState({ 0: true });

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
        const cueMap = new Map(FEATURED_EXERCISES.map((f) => [f.id, f.cue]));
        const enriched = ex.exercises.map((item) => ({
          ...item,
          cue: item.cue || cueMap.get(item.id) || 'Maintain controlled eccentric cadence, brace core, and focus on smooth mind-muscle engagement through full range of motion.',
        }));
        setExerciseList(enriched);
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
    return list.slice(0, 16);
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

  const copyMacros = () => {
    const text = `FitForge Macro Prescriptions:\nTarget Calories: ${nf(calcResults.targetKcal)} kcal/day\nProtein: ${calcResults.macros.protein_g}g | Carbs: ${calcResults.macros.carbs_g}g | Fat: ${calcResults.macros.fat_g}g\nHydration: ${calcResults.macros.water_l}L/day | Fiber: ${calcResults.macros.fiber_g}g/day`;
    try {
      navigator.clipboard?.writeText(text);
      setCopiedMacros(true);
      setTimeout(() => setCopiedMacros(false), 2400);
    } catch {}
  };

  const copyCue = (cue) => {
    const text = cue || 'Maintain controlled eccentric cadence, brace core, and focus on smooth mind-muscle engagement through full range of motion.';
    try {
      navigator.clipboard?.writeText(text);
      setCopiedCue(true);
      setTimeout(() => setCopiedCue(false), 2400);
    } catch {}
  };

  const toggleFaq = (idx) => {
    setOpenFaq((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="shell">
      {/* ------------------------ Sticky Public Navigation ------------------------ */}
      <header className="public-header" aria-label="Public navigation">
        <div className="wrap row-between">
          <div
            className="brand"
            role="button"
            tabIndex={0}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            style={{ cursor: 'pointer' }}
            aria-label="FitForge home"
          >
            <span className="brand-mark"><Icon name="dumbbell" size={16} style={{ color: 'var(--ember)' }} /></span>
            <span>FitForge</span>
          </div>

          <nav className="public-nav-links" aria-label="Section links">
            <button type="button" className="public-nav-link" onClick={() => scrollTo('features')}>Features</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('calculator')}>Calculator</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('exercises')}>102 Exercises</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('architecture')}>Architecture</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('reviews')}>Athlete Stories</button>
            <button type="button" className="public-nav-link" onClick={() => scrollTo('faq')}>FAQ</button>
          </nav>

          <div className="row gap-8">
            {demo && (
              <Button variant="ghost" size="sm" onClick={demoLogin} disabled={busy} loading={busy} title="One-click demo account">
                <Icon name="play" size={13} /> Demo
              </Button>
            )}
            <Button variant="ember" size="sm" onClick={() => { setMode('login'); scrollTo('access'); }}>
              Sign in
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
      {/* ------------------------------ Hero Section ----------------------------- */}
      <section className="hero" aria-label="Hero" style={{ paddingBottom: 40, position: 'relative' }}>
        <div className="hero-glow-layer" aria-hidden="true" />
        <div className="wrap hero-grid">
          <div>
            <div className="hero-badge" style={{ marginBottom: 16 }}>
              <span className="dot dot-ember" />
              <span>Tactile Strength & Nutrition Engineering</span>
            </div>
            <h1>Forge the body<br />you actually <span>want</span>.</h1>
            <p className="hero-sub">
              Your training, your meals and your progress in one private place —
              built around your body, your schedule and your gear with zero cloud traps.
            </p>
            <div className="hero-cta">
              <Button variant="ember" size="lg" onClick={() => { setMode('register'); scrollTo('access'); }}>
                Create free account <Icon name="arrowRight" size={17} />
              </Button>
              {demo && (
                <Button variant="soft" size="lg" onClick={demoLogin} disabled={busy} loading={busy}>
                  <Icon name="play" size={15} /> Try the demo
                </Button>
              )}
              <Button variant="ghost" size="lg" onClick={() => scrollTo('calculator')}>
                <Icon name="target" size={16} /> Live calculator
              </Button>
            </div>
            <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 24 }}>
              <Chip tone="ember"><Icon name="dumbbell" size={12} /> {counts.exercises} coached exercises</Chip>
              <Chip tone="teal"><Icon name="flame" size={12} /> {counts.foods} everyday foods</Chip>
              <Chip><Icon name="check" size={12} /> Private — runs on your server</Chip>
              <Chip tone="ghost"><Icon name="bolt" size={12} /> 2ms Zero-token local engine</Chip>
            </div>
          </div>

          <div style={{ perspective: 1000 }}>
            <div
              ref={tilt.ref}
              onMouseMove={tilt.onMouseMove}
              onMouseLeave={tilt.onMouseLeave}
              className="card preview-card"
              style={{ willChange: 'transform' }}
            >
              <div className="row-between" style={{ marginBottom: 12 }}>
                <span className="eyebrow">Today’s Live Snapshot</span>
                <Chip tone="ok"><Icon name="check" size={11} /> 3 of 4 sessions</Chip>
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
                    <span className="tiny strong" style={{ width: 56 }}>{l}</span>
                    <div className="bar flex-1" style={{ height: 8 }}>
                      <div className={`bar-fill bar-${t}`} style={{ width: `${w}%` }} />
                    </div>
                    <span className="tiny mono muted" style={{ width: 34, textAlign: 'right' }}>{w}%</span>
                  </div>
                ))}
              </div>
              <div className="stack g6" style={{ marginTop: 14 }}>
                {['Barbell Bench Press · 4 × 8 · 100 kg', 'Barbell Row · 4 × 8 · 82 kg'].map((r) => (
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
      </section>

      {/* ------------------------ Live Interactive Calculator ------------------------ */}
      <section className="section" id="calculator" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="section-head center" style={{ maxWidth: 700, marginInline: 'auto' }}>
              <span className="eyebrow" style={{ color: 'var(--ember)' }}>Interactive Metabolism Engine</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Calculate your exact nutrition targets.</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Adjust your physical numbers below. The client-side Mifflin-St Jeor engine recalculates BMR,
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
                <div className="stack gap-16" style={{ background: 'var(--surface-2)', padding: 24, borderRadius: 'var(--radius)' }}>
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
                    <span className="row gap-4" style={{ alignItems: 'center' }}>
                      <Icon name="droplet" size={13} style={{ color: 'var(--teal)' }} />
                      <span>Hydration: <b>{calcResults.macros.water_l}L</b> / day</span>
                    </span>
                    <span className="row gap-4" style={{ alignItems: 'center' }}>
                      <Icon name="leaf" size={13} style={{ color: 'var(--amber)' }} />
                      <span>Fiber: <b>{calcResults.macros.fiber_g}g</b> / day</span>
                    </span>
                  </div>

                  <div className="row gap-8" style={{ marginTop: 8 }}>
                    <Button
                      variant="ember"
                      size="md"
                      block
                      onClick={() => { setMode('register'); scrollTo('access'); }}
                    >
                      Adopt targets into your plan <Icon name="arrowRight" size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={copyMacros}
                      title="Copy macro breakdown to clipboard"
                    >
                      <Icon name={copiedMacros ? 'check' : 'copy'} size={15} />
                    </Button>
                  </div>
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
                  Every movement features precise muscle targeting, biomechanical pattern tags, and form cues. Click any exercise card to inspect full execution details.
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

            <div style={{ marginBottom: 20, position: 'relative', maxWidth: 540 }}>
              <input
                className="input"
                placeholder="Search exercise by name, muscle (e.g. lats, quads), or equipment..."
                value={catQuery}
                onChange={(e) => setCatQuery(e.target.value)}
                aria-label="Filter exercises"
                style={{ paddingRight: catQuery ? 38 : 14 }}
              />
              {catQuery && (
                <button
                  type="button"
                  onClick={() => setCatQuery('')}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--muted)',
                  }}
                  aria-label="Clear exercise search"
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          </Reveal>

          <div className="catalog-grid">
            {filteredExercises.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '36px 16px' }}>
                <Empty icon="search" title="No matching exercises found">
                  Try a different search term or select "All Movements" to reset your filter.
                </Empty>
              </div>
            ) : (
              filteredExercises.map((ex, i) => (
                <Reveal key={ex.id} delay={Math.min(i * 25, 200)}>
                  <div
                    className="catalog-card"
                    onClick={() => setSelectedExercise(ex)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedExercise(ex)}
                    style={{ cursor: 'pointer' }}
                    title="Click to inspect biomechanics and form cues"
                  >
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
                      <div className="tiny muted row gap-4" style={{ lineHeight: 1.45, marginTop: 4, alignItems: 'flex-start' }}>
                        <Icon name="bolt" size={12} style={{ color: 'var(--ember)', flex: 'none', marginTop: 2 }} />
                        <span>{ex.cue}</span>
                      </div>
                    )}

                    <div className="row-between tiny muted" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                      <span style={{ fontSize: '0.76rem', color: 'var(--ember-text)' }}>Inspect biomechanics</span>
                      <Icon name="arrowRight" size={12} style={{ color: 'var(--ember-text)' }} />
                    </div>
                  </div>
                </Reveal>
              ))
            )}
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
                  Handcrafted neumorphic design system built on a single soothing material surface.
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

      {/* -------------------- Athlete Stories & Real Transformations -------------- */}
      <section className="section" id="reviews" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="section-head center" style={{ maxWidth: 680, marginInline: 'auto' }}>
              <span className="eyebrow" style={{ color: 'var(--ok)' }}>Social Proof & Verification</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Built for athletes who track truth.</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Real strength progressions and body recomposition results achieved on FitForge's private local runtime.
              </p>
            </div>
          </Reveal>

          <div className="testimonial-grid" style={{ marginTop: 28 }}>
            {TESTIMONIALS.map((t, idx) => (
              <Reveal key={t.name} delay={idx * 80}>
                <div className="testimonial-card">
                  <div>
                    <div className="testimonial-stars" aria-label="5 out of 5 stars">
                      {[0, 1, 2, 3, 4].map((s) => (
                        <Icon key={s} name="star" size={16} />
                      ))}
                    </div>
                    <div className="chip chip-ok" style={{ marginBottom: 14, fontSize: '0.8rem' }}>
                      {t.highlight}
                    </div>
                    <p className="testimonial-quote">“{t.quote}”</p>
                  </div>
                  <div className="testimonial-author">
                    <div className="testimonial-avatar">{t.avatar}</div>
                    <div className="stack gap-2 flex-1">
                      <span className="strong small">{t.name}</span>
                      <span className="tiny muted">{t.role}</span>
                      <span className="tiny mono" style={{ color: 'var(--ember-text)' }}>{t.stats}</span>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------- Interactive FAQ Accordion -------------------------- */}
      <section className="section" id="faq" style={{ padding: '48px 0' }}>
        <div className="wrap">
          <Reveal>
            <div className="section-head center" style={{ maxWidth: 680, marginInline: 'auto' }}>
              <span className="eyebrow" style={{ color: 'var(--ember)' }}>Everything You Need To Know</span>
              <h2 className="section-title" style={{ marginTop: 6 }}>Frequently Asked Questions</h2>
              <p className="section-sub" style={{ marginInline: 'auto' }}>
                Clear answers about offline architecture, data ownership, AI budgeting, and privacy.
              </p>
            </div>
          </Reveal>

          <div className="faq-list" style={{ marginTop: 28 }}>
            {FAQS.map((item, i) => {
              const isOpen = Boolean(openFaq[i]);
              return (
                <Reveal key={item.q} delay={i * 50}>
                  <div className="faq-item">
                    <button
                      type="button"
                      className="faq-trigger"
                      id={`faq-trigger-${i}`}
                      aria-controls={`faq-panel-${i}`}
                      onClick={() => toggleFaq(i)}
                      aria-expanded={isOpen}
                    >
                      <span>{item.q}</span>
                      <Icon
                        name="chev"
                        size={18}
                        className={`faq-chevron ${isOpen ? 'faq-open' : ''}`}
                      />
                    </button>
                    {isOpen && (
                      <div
                        id={`faq-panel-${i}`}
                        role="region"
                        aria-labelledby={`faq-trigger-${i}`}
                        className="faq-content"
                      >
                        {item.a}
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
                    <label className="label" htmlFor="auth-name">Name</label>
                    <input
                      id="auth-name"
                      className="input"
                      value={form.name}
                      onChange={set('name')}
                      placeholder="Alex"
                      autoComplete="name"
                      aria-label="Name"
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? 'auth-name-error' : undefined}
                    />
                    {errors.name && <span id="auth-name-error" className="field-error">{errors.name}</span>}
                  </div>
                )}
                <div className="field">
                  <label className="label" htmlFor="auth-email">Email</label>
                  <input
                    id="auth-email"
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-label="Email"
                    inputMode="email"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'auth-email-error' : undefined}
                  />
                  {errors.email && <span id="auth-email-error" className="field-error">{errors.email}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="auth-password">Password</label>
                  <PasswordInput
                    id="auth-password"
                    value={form.password}
                    onChange={set('password')}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    ariaInvalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'auth-password-error' : undefined}
                  />
                  {errors.password && <span id="auth-password-error" className="field-error">{errors.password}</span>}
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

      {/* ------------------------ Biomechanical Exercise Modal ------------------- */}
      {selectedExercise && (
        <Modal
          open={Boolean(selectedExercise)}
          onClose={() => { setSelectedExercise(null); setCopiedCue(false); }}
          wide
          title={selectedExercise.name}
          subtitle={`${titleCase(selectedExercise.category || '')} · ${selectedExercise.pattern || 'Movement Pattern'}`}
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyCue(selectedExercise.cue)}
              >
                <Icon name={copiedCue ? 'check' : 'copy'} size={14} />
                {copiedCue ? 'Copied cue' : 'Copy form cue'}
              </Button>
              <Button
                variant="ember"
                size="sm"
                onClick={() => { setSelectedExercise(null); setCopiedCue(false); }}
              >
                Done
              </Button>
            </>
          }
        >
          <div className="ex-modal-detail">
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              <Chip tone="ember"><Icon name="dumbbell" size={12} /> {selectedExercise.equipment}</Chip>
              {selectedExercise.compound ? (
                <Chip tone="ok">Compound Movement</Chip>
              ) : (
                <Chip tone="teal">Isolation Movement</Chip>
              )}
              <Chip tone="ghost">{selectedExercise.pattern}</Chip>
            </div>

            <div className="stack gap-8">
              <span className="eyebrow">Target Muscle Activation</span>
              <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                {(selectedExercise.muscles || []).map((m, idx) => (
                  <span
                    key={m}
                    className="chip"
                    style={{
                      background: idx === 0 ? 'var(--ember-soft)' : 'var(--surface-2)',
                      color: idx === 0 ? 'var(--ember-text)' : 'var(--text-2)',
                      fontWeight: 650,
                    }}
                  >
                    {idx === 0 ? `Primary: ${titleCase(m)}` : titleCase(m)}
                  </span>
                ))}
              </div>
            </div>

            <div className="cue-step-card">
              <div className="row gap-8" style={{ marginBottom: 6 }}>
                <span className="flow-dot mono"><Icon name="bolt" size={13} style={{ color: 'var(--ember-text)' }} /></span>
                <span className="strong">Coached Form Cue</span>
              </div>
              <p className="small" style={{ lineHeight: 1.6, color: 'var(--text)' }}>
                {selectedExercise.cue}
              </p>
            </div>

            <div className="stack gap-10">
              <span className="eyebrow">Biomechanical Execution Guide</span>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="cue-step-card">
                  <span className="strong tiny" style={{ color: 'var(--teal-text)' }}>1. Setup & Stance</span>
                  <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    Plant stable base, retract and depress scapulae where applicable, and brace intra-abdominal pressure.
                  </p>
                </div>
                <div className="cue-step-card">
                  <span className="strong tiny" style={{ color: 'var(--ember-text)' }}>2. Eccentric Control</span>
                  <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    Lower the load over 2-3 seconds with full control to maximize active tension and stretch reflexes.
                  </p>
                </div>
                <div className="cue-step-card">
                  <span className="strong tiny" style={{ color: 'var(--violet-text)' }}>3. Concentric Drive</span>
                  <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    Drive explosively through the prime movers without relying on secondary joint recoil or momentum.
                  </p>
                </div>
                <div className="cue-step-card">
                  <span className="strong tiny" style={{ color: 'var(--ok-text)' }}>4. Safety & Lockout</span>
                  <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    Maintain neutral cervical and lumbar alignment; pause briefly at terminal contraction.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
      </main>

      {/* ------------------------ Editorial 4-Column Footer ----------------------- */}
      <footer style={{ padding: '40px 0 48px', borderTop: '2px solid var(--surface-2)' }}>
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
              <button type="button" className="footer-link" onClick={() => scrollTo('features')}>Three Core Promises</button>
              <button type="button" className="footer-link" onClick={() => scrollTo('calculator')}>Live Macro Calculator</button>
              <button type="button" className="footer-link" onClick={() => scrollTo('exercises')}>102 Exercise Catalog</button>
              <button type="button" className="footer-link" onClick={() => scrollTo('architecture')}>Dual Engine Specs</button>
              <button type="button" className="footer-link" onClick={() => scrollTo('reviews')}>Athlete Stories</button>
              <button type="button" className="footer-link" onClick={() => scrollTo('faq')}>FAQ</button>
            </div>

            <div className="stack gap-8">
              <span className="eyebrow">Tech Stack</span>
              <span className="tiny muted">Node.js 22.x LTS</span>
              <span className="tiny muted">Express 5.1 REST API</span>
              <span className="tiny muted">React 18 + Vite</span>
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
