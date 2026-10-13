import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { nf, titleCase, goalLabel, equipmentLabel, dietLabel, activityLabel, dateForAge, ageFromDate } from '../lib/format.js';
import { SliderField, WheelPicker, TileGroup } from './Controls.jsx';
import { bmr, tdee, macroTargets, bmi } from '../lib/calc.js';
import {
  Button, Card, CardHead, Chip, Field, Input, Textarea, Icon, SingleRing, Bar,
} from './ui.jsx';

const STEPS = [
  { id: 'body', label: 'Body', icon: 'user' },
  { id: 'training', label: 'Training', icon: 'dumbbell' },
  { id: 'nutrition', label: 'Nutrition', icon: 'flame' },
  { id: 'review', label: 'Review', icon: 'spark' },
];



/**
 * Four-step profile wizard. Deliberately dense and full-width: sliders and
 * wheels replace typing, tiles replace dropdowns, and a sticky live summary
 * on the right shows the maths updating as you drag — so the form feels like
 * a conversation, not paperwork. Each step saves when you leave it.
 */
const DEFAULTS = { height_cm: 175, weight_kg: 75, sleep_hours: 7, days_per_week: 4, session_minutes: 60 };

/**
 * Merge stored profile over the defaults, DROPPING null/empty values first.
 * Spreading the raw profile used to put height_cm: null back on top of the
 * default 175, so the sliders showed numbers the form did not hold — Skip
 * saved nulls and the onboarding guard looped forever.
 */
const initForm = (p) => {
  const present = Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '')
  );
  return {
    ...DEFAULTS,
    ...present,
    birth_date: p.birth_date || dateForAge(25),
    target_weight_kg: p.target_weight_kg ?? p.weight_kg ?? DEFAULTS.weight_kg,
  };
};

export default function Onboarding({ onDone }) {
  const { profile, derived, saveProfile, onboard, toast, handleError, refreshProfile } = useStore();
  const [step, setStep] = useState(0);
  // Sliders always display a number, so the form must HOLD those numbers too.
  // Previously the display showed 175 cm while the form stored null, so
  // "Continue" saved an incomplete profile and the guard looped back here.
  const [form, setForm] = useState(() => initForm(profile));
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState({ training: null, nutrition: null });

  useEffect(() => {
    // merge server values in, but never overwrite with null/empty
    setForm((f) => ({
      ...f,
      ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null && v !== undefined && v !== '')),
      birth_date: f.birth_date || profile.birth_date || dateForAge(25),
    }));
  }, [profile]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target?.value !== undefined ? v.target.value : v }));

  // Live maths: recomputed on every drag from lib/calc.js (a client mirror of
  // the backend formulas), so the summary reacts instantly instead of waiting
  // for a save round-trip. The server recomputes authoritatively on Continue.
  const liveProfile = { ...form, age: ageFromDate(form.birth_date) };
  const hasBody = Boolean(form.weight_kg && form.height_cm);
  const macros = hasBody ? macroTargets(liveProfile) : null;
  const liveBmr = hasBody ? bmr(liveProfile) : null;
  const liveTdee = hasBody ? tdee(liveProfile) : null;
  const liveBmi = hasBody ? bmi(liveProfile) : null;

  const next = async () => {
    setBusy(true);
    try {
      await saveProfile(form, { silent: true });
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } catch (err) {
      handleError(err, 'Could not save that step.');
    } finally {
      setBusy(false);
    }
  };

  // "Skip" saves the sensible defaults shown on the sliders, so the profile is
  // complete and the onboarding guard never bounces you back here in a loop.
  const skip = async () => {
    setBusy(true);
    try {
      await saveProfile(form, { silent: true });
      toast('Defaults saved — refine any time in Settings.', 'info', 2600);
      onDone?.();
    } catch (err) {
      handleError(err, 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await onboard(form);
      await refreshProfile();
      const [t, n] = await Promise.all([
        api.ai.planTraining({ weeks: 4 }).catch((e) => ({ error: e.message })),
        api.ai.planNutrition({}).catch((e) => ({ error: e.message })),
      ]);
      setPlans({ training: t.plan || null, nutrition: n.plan || null });
      toast('Profile saved. Your first plans are ready.', 'ok');
      onDone?.();
    } catch (err) {
      handleError(err, 'Could not finish onboarding.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow">Setup · step {step + 1} of {STEPS.length}</div>
            <h2 style={{ marginTop: 6 }}>Build your baseline.</h2>
            <p className="small muted" style={{ marginTop: 6, maxWidth: '60ch' }}>
              Drag, don’t type. Everything here feeds the plan generator — and the summary on the
              right updates live so you can see the maths.
            </p>
          </div>
          <div className="stack gap-8" style={{ minWidth: 220, flex: 1, maxWidth: 360 }}>
            <div className="stepbar" aria-hidden="true"><div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
            <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
              {STEPS.map((s, i) => (
                <Chip
                  key={s.id}
                  active={i === step}
                  tone={i < step ? 'ok' : undefined}
                  onClick={() => i < step && setStep(i)}
                  style={{ cursor: i < step ? 'pointer' : 'default' }}
                >
                  {i < step && <Icon name="check" size={12} />} {s.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div className="onb-grid">
          {/* --------------------------- step content -------------------------- */}
          <div className="stack g16">
            {step === 0 && (
              <Card solid className="card-pad-lg stack gap-20">
                <CardHead title="Your body" subtitle="Used to set your calories, protein and training loads." />
                <div className="onb-fields">
                  <Field label="Age" hint="Scroll or tap the wheel.">
                    <WheelPicker
                      value={ageFromDate(form.birth_date)}
                      min={14}
                      max={95}
                      onChange={(age) => set('birth_date')(dateForAge(age))}
                    />
                  </Field>
                  <SliderField label="Height" unit=" cm" min={120} max={230} step={0.5} value={form.height_cm ?? 175} onChange={set('height_cm')} />
                  <SliderField label="Weight" unit=" kg" min={35} max={250} step={0.5} value={form.weight_kg ?? 75} onChange={set('weight_kg')} />
                  <SliderField label="Body fat" unit=" %" min={3} max={60} step={0.5} value={form.body_fat_pct ?? 18} onChange={set('body_fat_pct')} hint="optional" />
                  <SliderField label="Target weight" unit=" kg" min={35} max={250} step={0.5} value={form.target_weight_kg ?? form.weight_kg ?? 75} onChange={set('target_weight_kg')} hint="optional" />
                  <SliderField label="Sleep" unit=" h" min={3} max={12} step={0.5} value={form.sleep_hours ?? 7} onChange={set('sleep_hours')} />
                  <div className="span-all">
                    <span className="label">Sex at birth</span>
                    <div style={{ marginTop: 8 }}>
                      <TileGroup
                        cols={2}
                        value={form.sex || 'male'}
                        onChange={set('sex')}
                        options={[
                          { value: 'male', label: 'Male', desc: 'BMR +5' },
                          { value: 'female', label: 'Female', desc: 'BMR −161' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="span-all">
                    <span className="label">Activity level</span>
                    <div style={{ marginTop: 8 }}>
                      <TileGroup
                        cols={2}
                        value={form.activity_level || 'moderate'}
                        onChange={set('activity_level')}
                        options={Object.entries(activityLabel).map(([value, label]) => ({ value, label }))}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {step === 1 && (
              <Card solid className="card-pad-lg stack gap-20">
                <CardHead title="Your training" subtitle="Sets the split, rep ranges, rest periods and progression model." />
                <div className="stack gap-8">
                  <span className="label">Primary goal</span>
                  <TileGroup
                    cols={3}
                    value={form.goal || 'recomp'}
                    onChange={set('goal')}
                    options={[
                      { value: 'fat_loss', label: 'Fat loss', desc: '−0.5-0.8% bw / week' },
                      { value: 'recomp', label: 'Recomposition', desc: 'weight flat, stronger' },
                      { value: 'muscle_gain', label: 'Muscle gain', desc: '+0.25-0.5% bw / week' },
                      { value: 'strength', label: 'Strength', desc: 'small surplus' },
                      { value: 'endurance', label: 'Endurance', desc: 'fuel high volume' },
                      { value: 'maintain', label: 'Maintain', desc: 'hold & perform' },
                    ]}
                  />
                </div>
                <div className="onb-fields">
                  <SliderField label="Days per week" min={1} max={7} value={form.days_per_week ?? 4} onChange={set('days_per_week')} />
                  <SliderField label="Session length" unit=" min" min={20} max={180} step={5} value={form.session_minutes ?? 60} onChange={set('session_minutes')} />
                  <div className="span-all">
                    <span className="label">Experience</span>
                    <div style={{ marginTop: 8 }}>
                      <TileGroup
                        cols={3}
                        value={form.experience || 'intermediate'}
                        onChange={set('experience')}
                        options={[
                          { value: 'beginner', label: 'Beginner', desc: '< 1 year consistent' },
                          { value: 'intermediate', label: 'Intermediate', desc: '1-3 years' },
                          { value: 'advanced', label: 'Advanced', desc: '3+ years' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="span-all">
                    <span className="label">Equipment you actually have</span>
                    <div style={{ marginTop: 8 }}>
                      <TileGroup
                        cols={2}
                        value={form.equipment || 'full_gym'}
                        onChange={set('equipment')}
                        options={Object.entries(equipmentLabel).map(([value, label]) => ({ value, label }))}
                      />
                    </div>
                  </div>
                  <Field label="Injuries, niggles or limitations" hint="Knee, shoulder, back, wrist… the generator excludes exercises that load them.">
                    <Input value={form.injuries || ''} onChange={set('injuries')} placeholder="e.g. mild left knee tendinopathy" />
                  </Field>
                  <Field label="Focus areas (optional)">
                    <Input value={form.focus_areas || ''} onChange={set('focus_areas')} placeholder="e.g. chest, back, core" />
                  </Field>
                </div>
              </Card>
            )}

            {step === 2 && (
              <Card solid className="card-pad-lg stack gap-20">
                <CardHead title="Your nutrition" subtitle="Drives calorie target, macro split and which foods the meal builder may use." />
                <div className="stack gap-8">
                  <span className="label">Diet preference</span>
                  <TileGroup
                    cols={4}
                    value={form.diet_pref || 'omnivore'}
                    onChange={set('diet_pref')}
                    options={Object.entries(dietLabel).map(([value, label]) => ({ value, label }))}
                  />
                </div>
                <Field label="Allergies or foods you never eat" hint="Comma separated. Matched against the food database.">
                  <Input value={form.allergies || ''} onChange={set('allergies')} placeholder="e.g. dairy, shellfish, peanuts" />
                </Field>
                <Field label="Anything else the coach should know">
                  <Textarea value={form.notes || ''} onChange={set('notes')} placeholder="Shift work, travel, cooking skill, foods you love or hate…" />
                </Field>
              </Card>
            )}

            {step === 3 && (
              <Card solid className="card-pad-lg stack gap-16">
                <CardHead
                  title="Review"
                  subtitle={plans.training || plans.nutrition ? 'Plans generated. Regenerate any time from Training and Nutrition.' : 'This is what the generator will work from.'}
                />
                <div className="grid grid-2 gap-12">
                  {Object.entries({
                    Age: `${ageFromDate(form.birth_date)} yrs`,
                    Goal: goalLabel[form.goal] || form.goal,
                    Experience: titleCase(form.experience),
                    Days: `${form.days_per_week || 4} / week`,
                    Session: `${form.session_minutes || 60} min`,
                    Equipment: equipmentLabel[form.equipment] || form.equipment,
                    Diet: dietLabel[form.diet_pref] || form.diet_pref,
                    Weight: form.weight_kg ? `${form.weight_kg} kg` : '—',
                  }).map(([k, v]) => (
                    <div key={k} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                      <span className="tiny muted">{k}</span>
                      <span className="small strong">{v}</span>
                    </div>
                  ))}
                </div>
                {(plans.training || plans.nutrition) && (
                  <div className="grid grid-2 gap-12">
                    {plans.training && (
                      <Card className="stack gap-6">
                        <div className="row gap-8"><Icon name="dumbbell" size={15} style={{ color: 'var(--ember)' }} /><span className="strong small">Training plan</span></div>
                        <div className="tiny muted">{plans.training.meta?.name}</div>
                        <div className="tiny mono muted">{plans.training.schedule?.length} days · {plans.training.meta?.weekly_working_sets} sets/wk · {plans.training.meta?.source}</div>
                      </Card>
                    )}
                    {plans.nutrition && (
                      <Card className="stack gap-6">
                        <div className="row gap-8"><Icon name="flame" size={15} style={{ color: 'var(--teal)' }} /><span className="strong small">Nutrition plan</span></div>
                        <div className="tiny muted">{plans.nutrition.meta?.name}</div>
                        <div className="tiny mono muted">{plans.nutrition.meals?.length} meals · {nf(plans.nutrition.targets?.calories)} kcal · {plans.nutrition.meta?.source}</div>
                      </Card>
                    )}
                  </div>
                )}
              </Card>
            )}

            <div className="row-between">
              <Button variant="ghost" onClick={() => (step === 0 ? skip() : setStep((s) => s - 1))} disabled={busy}>
                {step === 0 ? 'Skip for now' : 'Back'}
              </Button>
              <div className="row gap-10">
                {step === STEPS.length - 1 ? (
                  <>
                    <Button variant="ghost" onClick={finish} disabled={busy} loading={busy}>
                      <Icon name="refresh" size={15} /> Regenerate plans
                    </Button>
                    <Button variant="ember" onClick={finish} disabled={busy} loading={busy}>
                      Finish <Icon name="check" size={16} />
                    </Button>
                  </>
                ) : (
                  <Button variant="ember" onClick={next} disabled={busy} loading={busy}>
                    Continue <Icon name="arrowRight" size={16} />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* --------------------------- live summary -------------------------- */}
          <aside className="stack g12 sticky-col">
            <Card solid className="stack g12">
              <CardHead eyebrow="Your targets" title="Daily, from your numbers" />
              {macros ? (
                <>
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <SingleRing
                      value={macros.calories}
                      max={Math.round(macros.calories * 1.15)}
                      size={148}
                      thickness={11}
                      color="var(--macro-calories)"
                      center={<>
                        <div className="ring-value" style={{ fontSize: '1.2rem' }}>{nf(macros.calories)}</div>
                        <div className="ring-label">kcal / day</div>
                      </>}
                    />
                  </div>
                  <div className="stack g8">
                    <div className="row-between tiny"><span className="muted">Protein</span><span className="mono strong">{macros.protein_g} g</span></div>
                    <Bar value={macros.protein_g * 4} max={macros.calories} tone="teal" height={6} />
                    <div className="row-between tiny"><span className="muted">Carbs</span><span className="mono strong">{macros.carbs_g} g</span></div>
                    <Bar value={macros.carbs_g * 4} max={macros.calories} tone="violet" height={6} />
                    <div className="row-between tiny"><span className="muted">Fat</span><span className="mono strong">{macros.fat_g} g</span></div>
                    <Bar value={macros.fat_g * 9} max={macros.calories} tone="amber" height={6} />
                  </div>
                  <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                    <Chip tone="teal">Rest burn {nf(liveBmr)}</Chip>
                    <Chip tone="teal">Daily burn {nf(liveTdee)}</Chip>
                    {liveBmi && <Chip>BMI {liveBmi}</Chip>}
                    <Chip tone="ok">{macros.water_l} L water</Chip>
                  </div>
                </>
              ) : (
                <p className="tiny muted">Set height and weight to see calories and macros appear here.</p>
              )}
            </Card>
            <Card className="stack g8">
              <div className="row gap-8 strong small"><Icon name="bolt" size={14} style={{ color: 'var(--ember)' }} /> What happens next</div>
              {[
                ['spark', 'Two plans generated', 'training split + meals in grams, from these numbers'],
                ['dumbbell', 'First session ready', 'loads pre-filled from the library, rest timer included'],
                ['chart', 'Weekly read-out', 'volume, streaks and bodyweight trend from day one'],
              ].map(([ic, t, d]) => (
                <div key={t} className="row gap-10" style={{ alignItems: 'flex-start' }}>
                  <span className="brand-mark" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--teal-soft)' }}>
                    <Icon name={ic} size={13} style={{ color: 'var(--teal)' }} />
                  </span>
                  <span className="stack gap-2">
                    <span className="small strong">{t}</span>
                    <span className="tiny muted">{d}</span>
                  </span>
                </div>
              ))}
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
