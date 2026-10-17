import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { nf, pct, todayISO, shiftDays, relativeDay, sourceChip } from '../lib/format.js';
import {
  Card, CardHead, Button, Chip, Icon, Modal, Field, Input, Segmented,
  Empty, Reveal, Skeleton, Spinner, SingleRing,
} from './ui.jsx';
import { LineChart } from './Charts.jsx';
import { SelectMenu, SliderField } from './Controls.jsx';
import parseVoiceLog from '../lib/parseVoiceLog.js';
import { checkMic, micErrorMessage } from '../lib/mic.js';
import { supportsSpeech, startDictation, speechErrorMessage, sttServiceBroken, preferWhisper, rememberWhisper } from '../lib/speech.js';

const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'pre_workout', label: 'Pre-workout' },
  { id: 'post_workout', label: 'Post-workout' },
  { id: 'snack', label: 'Snacks' },
];

function cuisineBadge(food) {
  if (!food) return null;
  const hay = `${food.name} ${(food.tags || []).join(' ')}`.toLowerCase();
  if (hay.includes('north indian')) return { label: 'North Indian', tone: 'ember', iconName: 'spark' };
  if (hay.includes('south indian')) return { label: 'South Indian', tone: 'teal', iconName: 'leaf' };
  return null;
}

export default function Nutrition() {
  const { derived, handleError, toast, refreshAiStatus } = useStore();
  const [tab, setTab] = useState('today');
  const [date, setDate] = useState(todayISO());
  const [daily, setDaily] = useState(null);
  const [range, setRange] = useState([]);
  const [plan, setPlan] = useState(null);
  const [planMeta, setPlanMeta] = useState(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [mealAlts, setMealAlts] = useState({});
  const [cuisineFilter, setCuisineFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genState, setGenState] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMeal, setAddMeal] = useState('breakfast');
  const [q, setQ] = useState('');
  const [foods, setFoods] = useState([]);
  const [picked, setPicked] = useState(null);
  const [grams, setGrams] = useState(100);
  const [manual, setManual] = useState({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
  const [voiceItems, setVoiceItems] = useState(null);
  const [voiceText, setVoiceText] = useState('');
  const [micState, setMicState] = useState({ recording: false, working: false });
  const recorderRef = useRef(null);
  const canMic = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const speechOK = supportsSpeech();

  const currentDay = useMemo(() => {
    if (plan?.days?.length && plan.days[selectedDayIdx]) {
      return plan.days[selectedDayIdx];
    }
    return {
      day: 1,
      day_name: 'Today',
      theme: 'Balanced Daily Plan',
      cuisine: 'Indian',
      meals: plan?.meals || [],
      totals: plan?.plan_totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    };
  }, [plan, selectedDayIdx]);

  const activeMeals = currentDay.meals || plan?.meals || [];

  const toggleMealAlt = (mIdx) => {
    setMealAlts((prev) => {
      const cur = prev[mIdx] || 0;
      return { ...prev, [mIdx]: cur === 0 ? 1 : cur === 1 ? 2 : 0 };
    });
  };

  const targets = derived?.macros;
  const t = targets || { calories: 2200, protein_g: 150, carbs_g: 220, fat_g: 70 };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, r, active] = await Promise.all([
        api.nutrition.daily(date).catch(() => null),
        api.nutrition.range(14).catch(() => ({ series: [] })),
        api.ai.activePlan('nutrition').catch(() => ({ plan: null })),
      ]);
      setDaily(d); setRange(r.series || []);
      setPlan(active.plan || null);
      setPlanMeta(active.plan ? { id: active.id, source: active.source } : null);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [date, handleError]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!addOpen) return undefined;
    const t2 = setTimeout(() => {
      api.nutrition.foods({ q: q || undefined }).then((r) => setFoods(r.foods || [])).catch(() => setFoods([]));
    }, 160);
    return () => clearTimeout(t2);
  }, [addOpen, q]);

  const totals = daily?.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

  const openAdd = (meal) => {
    setAddMeal(meal); setPicked(null); setGrams(100); setQ('');
    setManual({ food_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
    setAddOpen(true);
  };

  const preview = useMemo(() => {
    if (!picked) return null;
    const g = Number(grams) || 0;
    return {
      calories: Math.round((picked.kcal / 100) * g),
      protein_g: Math.round(((picked.protein_g / 100) * g) * 10) / 10,
      carbs_g: Math.round(((picked.carbs_g / 100) * g) * 10) / 10,
      fat_g: Math.round(((picked.fat_g / 100) * g) * 10) / 10,
    };
  }, [picked, grams]);

  const displayedFoods = useMemo(() => {
    if (cuisineFilter === 'all') return foods;
    if (cuisineFilter === 'north') return foods.filter((f) => `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes('north indian'));
    if (cuisineFilter === 'south') return foods.filter((f) => `${f.name} ${(f.tags || []).join(' ')}`.toLowerCase().includes('south indian'));
    if (cuisineFilter === 'protein') return foods.filter((f) => f.protein_g >= 12 || (f.tags || []).includes('high protein'));
    if (cuisineFilter === 'staple') return foods.filter((f) => (f.tags || []).includes('staple'));
    return foods;
  }, [foods, cuisineFilter]);

  const addEntry = async () => {
    const payload = picked
      ? { date, meal_type: addMeal, food_name: picked.name, grams: Number(grams) || picked.serving_g }
      : {
          date, meal_type: addMeal, food_name: manual.food_name.trim(),
          calories: Number(manual.calories) || 0, protein_g: Number(manual.protein_g) || 0,
          carbs_g: Number(manual.carbs_g) || 0, fat_g: Number(manual.fat_g) || 0,
        };
    if (!payload.food_name) return toast('Pick a food or type a name.', 'warn');
    if (!picked && !(payload.calories > 0)) return toast('Add at least the calories for a custom food.', 'warn');
    try {
      await api.nutrition.log(payload);
      setAddOpen(false);
      toast(`Logged ${payload.food_name}.`, 'ok', 2200);
      load();
    } catch (err) { handleError(err); }
    return undefined;
  };

  const removeEntry = async (id) => {
    try { await api.nutrition.remove(id); load(); } catch (err) { handleError(err); }
  };

  /** Stream generation with progress chips; falls back to errors as toasts. */
  const generate = async (force = false) => {
    setGenerating(true); setGenState(null);
    try {
      const { streamPost } = await import('../lib/api.js');
      const done = await streamPost('/api/ai/plans/nutrition', { force }, ({ event, data }) => {
        if (event === 'progress') setGenState(data);
        if (event === 'error') setGenState({ phase: 'degraded', reason: data.message });
      });
      if (done?.plan) {
        setPlan(done.plan);
        setPlanMeta({ id: done.id, source: done.plan.meta?.source });
      }
      await load();
      await refreshAiStatus();
      setTab('plan');
      toast('Nutrition plan ready.', 'ok');
    } catch (err) {
      handleError(err, 'Generation failed.');
      await load();
    } finally {
      setGenerating(false); setGenState(null);
    }
  };

  const applyPlanToToday = async () => {
    if (!activeMeals?.length) return toast('Generate a plan first.', 'warn');
    const items = activeMeals.flatMap((m, mIdx) => {
      const altIdx = mealAlts[mIdx] || 0;
      const foods = altIdx > 0 && m.alternatives?.[altIdx - 1] ? m.alternatives[altIdx - 1] : m.foods;
      return foods.map((f) => ({
        meal_type: mealFromName(m.name), food_name: f.name, grams: f.grams,
        calories: f.calories, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
      }));
    });
    try {
      const res = await api.nutrition.logBatch({ date, items });
      toast(`Logged ${res.created} items from ${currentDay.day_name || 'your plan'}.`, 'ok');
      load();
    } catch (err) { handleError(err); }
    return undefined;
  };

  const copyYesterday = async () => {
    try {
      const res = await api.nutrition.copyDay(shiftDays(-1, new Date(`${date}T12:00:00`)), date);
      toast(`Copied ${res.copied} entries.`, 'ok', 2400);
      load();
    } catch (err) { handleError(err, 'Nothing to copy from the previous day.'); }
  };

  /** Transcript -> deterministic parse -> confirm list. Shared by mic paths. */
  const processTranscript = async (text) => {
    setVoiceText(text);
    if (!text) { toast('Heard nothing usable — try again closer to the mic.', 'warn'); return; }
    const foodsRes = await api.nutrition.foods({}).catch(() => ({ foods: [] }));
    const parsed = parseVoiceLog(text, foodsRes.foods || []);
    if (!parsed.items.length) {
      toast(`Heard: “${text}”. Try naming foods, e.g. “150 grams of chicken and 200 grams of rice”.`, 'warn', 6000);
      return;
    }
    setVoiceItems(parsed.items);
  };

  /** Whisper recorder path: works in any browser, needs a microphone. */
  const startWhisperLog = async () => {
    const pre = await checkMic();
    if (!pre.ok) { toast(pre.reason, 'warn', 6000); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMicState({ recording: false, working: true });
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const out = await api.ai.transcribe(blob);
          await processTranscript(out.text || '');
        } catch (err) {
          handleError(err, 'Voice log failed.');
        } finally {
          setMicState({ recording: false, working: false });
        }
      };
      rec.start();
      recorderRef.current = rec;
      setMicState({ recording: true, working: false });
    } catch (err) {
      toast(micErrorMessage(err), 'warn', 5200);
    }
  };

  /** Mic tap: browser dictation first; on builds without the speech service
   *  (common on Linux Chromium) fall through to Whisper once and remember. */
  const toggleVoiceLog = async () => {
    if (micState.recording) { recorderRef.current?.stop(); return; }
    if (speechOK && !preferWhisper()) {
      setMicState({ recording: true, working: false });
      startDictation({
        onFinal: async (text) => {
          setMicState({ recording: false, working: true });
          try { await processTranscript(text); }
          finally { setMicState({ recording: false, working: false }); }
        },
        onError: (e) => {
          setMicState({ recording: false, working: false });
          if (sttServiceBroken(e)) {
            rememberWhisper();
            toast('Browser dictation unavailable in this build — recording for on-server transcription. Speak now.', 'warn', 6000);
            startWhisperLog();
          } else {
            toast(speechErrorMessage(e), 'warn', 5200);
          }
        },
      });
      return;
    }
    await startWhisperLog();
  };

  const commitVoiceItems = async () => {
    if (!voiceItems?.length) return;
    try {
      const res = await api.nutrition.logBatch({ date, items: voiceItems });
      toast(`Logged ${res.created} item(s) from voice.`, 'ok');
      setVoiceItems(null);
      load();
    } catch (err) { handleError(err); }
  };

  if (loading) {
    return (
      <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
        <div className="wrap stack gap-16"><Skeleton h={34} w={280} /><Skeleton h={300} r={18} /></div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <Reveal>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div className="eyebrow">Nutrition</div>
              <h1 style={{ fontSize: 'clamp(1.8rem,3.6vw,2.4rem)', marginTop: 6 }}>{nf(t.calories)} kcal · {t.protein_g} g protein</h1>
              <p className="small muted" style={{ marginTop: 6 }}>Targets from your BMR, activity and goal.</p>
            </div>
            <Segmented value={tab} onChange={setTab} options={[
              { value: 'today', label: 'Today' },
              { value: 'plan', label: 'Meal plan' },
              { value: 'trend', label: 'Trend' },
            ]} />
          </div>
        </Reveal>

        {/* ------------------------------ today ---------------------------- */}
        {tab === 'today' && (
          <>
            <Reveal>
              <Card solid>
                <div className="row gap-24" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SingleRing
                    value={totals.calories}
                    max={t.calories}
                    size={182}
                    thickness={13}
                    color="var(--macro-calories)"
                    center={<>
                      <div className="ring-value">{nf(totals.calories)}</div>
                      <div className="ring-label">of {nf(t.calories)} kcal</div>
                    </>}
                  />
                  <div className="grid grid-2 gap-16 flex-1" style={{ minWidth: 260 }}>
                    {[
                      ['Protein', totals.protein_g, t.protein_g, 'teal'],
                      ['Carbs', totals.carbs_g, t.carbs_g, 'violet'],
                      ['Fat', totals.fat_g, t.fat_g, 'amber'],
                      ['Foods logged', daily?.entries?.length || 0, Math.max(6, daily?.entries?.length || 0), 'ember'],
                    ].map(([label, v, m, tone]) => (
                      <div key={label} className="stack gap-6">
                        <div className="row-between">
                          <span className="eyebrow">{label}</span>
                          <span className="mono tiny strong">{nf(v, 0)}{label !== 'Foods logged' && ` / ${nf(m)} g`}</span>
                        </div>
                        <div className="bar"><div className={`bar-fill bar-${tone}`} style={{ width: `${Math.min(100, pct(v, m))}%` }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="stack gap-8" style={{ minWidth: 190 }}>
                    <div className="row gap-6">
                      <Button variant="ghost" size="sm" aria-label="Previous day" onClick={() => setDate(shiftDays(-1, new Date(`${date}T12:00:00`)))}><Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} /></Button>
                      <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} className="input-sm flex-1" aria-label="Date" />
                      <Button variant="ghost" size="sm" aria-label="Next day" disabled={date >= todayISO()} onClick={() => setDate(shiftDays(1, new Date(`${date}T12:00:00`)))}><Icon name="arrowRight" size={14} /></Button>
                    </div>
                    <div className="tiny muted center">{relativeDay(date)}</div>
                    {canMic || speechOK ? (
                      <Button
                        variant={micState.recording ? 'danger' : 'soft'}
                        size="sm"
                        className={`mic-btn ${micState.recording ? 'rec-on' : ''}`}
                        onClick={toggleVoiceLog}
                        disabled={micState.working}
                        aria-label={micState.recording ? 'Stop recording meal' : 'Log a meal by voice'}
                        title={speechOK && !preferWhisper()
                          ? 'Say e.g. “150 grams of chicken and 200 grams of rice for lunch” (browser dictation)'
                          : 'Record and transcribe with Whisper — say e.g. “150 grams of chicken and 200 grams of rice for lunch”'}
                      >
                        {micState.working ? <Spinner size={13} /> : micState.recording ? <span className="eq" aria-hidden="true"><i /><i /><i /></span> : <Icon name="mic" size={14} />} Voice log
                      </Button>
                    ) : null}
                    <Button variant="ember" size="sm" onClick={() => openAdd(guessMeal())}><Icon name="plus" size={14} /> Add food</Button>
                    <Button variant="soft" size="sm" onClick={applyPlanToToday}><Icon name="spark" size={14} /> Apply meal plan</Button>
                    <Button variant="ghost" size="sm" onClick={copyYesterday}><Icon name="refresh" size={14} /> Copy previous day</Button>
                  </div>
                </div>
              </Card>
            </Reveal>

            <div className="grid grid-2">
              {MEALS.map((m) => {
                const entries = daily?.by_meal?.[m.id] || [];
                const kcal = entries.reduce((s2, e) => s2 + e.calories, 0);
                const protein = entries.reduce((s2, e) => s2 + e.protein_g, 0);
                return (
                  <Reveal key={m.id}>
                    <Card className="stack gap-10" style={{ height: '100%' }}>
                      <div className="row-between">
                        <div className="row gap-8">
                          <span className="strong">{m.label}</span>
                          {entries.length > 0 && <Chip tone="ghost" className="mono">{nf(kcal)} kcal · {nf(protein)} g P</Chip>}
                        </div>
                        <Button variant="soft" size="sm" aria-label={`Add food to ${m.label}`} onClick={() => openAdd(m.id)}><Icon name="plus" size={13} /></Button>
                      </div>
                      {!entries.length && <div className="tiny muted">Nothing logged.</div>}
                      <div className="stack gap-6">
                        {entries.map((e) => (
                          <div key={e.id} className="row-between gap-10 small" style={{ padding: '7px 0', borderBottom: '1px solid var(--line-2)' }}>
                            <div className="flex-1">
                              <div className="strong" style={{ fontSize: '0.9rem' }}>{e.food_name}</div>
                              <div className="tiny muted mono">{nf(e.grams)} g · P {nf(e.protein_g, 1)} · C {nf(e.carbs_g, 1)} · F {nf(e.fat_g, 1)}</div>
                            </div>
                            <div className="row gap-8">
                              <span className="mono tiny strong">{nf(e.calories)}</span>
                              <Button variant="icon" size="sm" aria-label={`Remove ${e.food_name}`} onClick={() => removeEntry(e.id)}><Icon name="close" size={13} /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </Reveal>
                );
              })}
            </div>
          </>
        )}

        {/* ------------------------------- plan ---------------------------- */}
        {tab === 'plan' && (
          <>
            <Reveal>
              <Card solid className="stack gap-12">
                <CardHead
                  eyebrow="Generator"
                  title={plan?.meta?.name || 'Meal plan'}
                  subtitle={plan ? `${plan.meals?.length} meals · ${nf(plan.plan_totals?.calories)} kcal planned` : 'Meals in grams, matched to your targets and diet.'}
                  right={planMeta ? <Chip tone={sourceChip(planMeta.source).cls}>{sourceChip(planMeta.source).label}</Chip> : undefined}
                />
                <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
                  <Button variant="ember" onClick={() => generate(false)} disabled={generating} loading={generating}>
                    <Icon name="spark" size={16} /> {plan ? 'Regenerate' : 'Generate meal plan'}
                  </Button>
                  {plan && <Button variant="ghost" onClick={() => generate(true)} disabled={generating}><Icon name="refresh" size={15} /> Fresh</Button>}
                </div>
                {genState && (
                  <div className="row gap-10">
                    <Spinner size={13} />
                    <Chip tone={genState.phase === 'retrying' ? 'warn' : 'teal'}>
                      {genState.phase === 'throttled' ? `Waiting for budget — ${Math.ceil((genState.waitMs || 0) / 1000)}s`
                        : genState.phase === 'retrying' ? `Retrying in ${Math.ceil((genState.waitMs || 0) / 1000)}s`
                        : 'Working…'}
                    </Chip>
                  </div>
                )}
              </Card>
            </Reveal>

            {plan && (
              <>
                <Reveal>
                  <div className="grid grid-4">
                    {[
                      ['Calories', nf(plan.targets.calories), 'kcal', 'ember'],
                      ['Protein', nf(plan.targets.protein_g), `g · ${plan.targets.protein_pct}%`, 'teal'],
                      ['Carbs', nf(plan.targets.carbs_g), `g · ${plan.targets.carbs_pct}%`, 'violet'],
                      ['Fat', nf(plan.targets.fat_g), `g · ${plan.targets.fat_pct}%`, 'amber'],
                    ].map(([l, v, u, tone]) => (
                      <Card key={l} className="stack gap-4" hover>
                        <span className="eyebrow">{l}</span>
                        <span className="mono" style={{ fontSize: '1.5rem', fontWeight: 720, color: `var(--${tone})` }}>{v}</span>
                        <span className="tiny muted">{u}</span>
                      </Card>
                    ))}
                  </div>
                </Reveal>

                <Reveal>
                  <Card solid>
                    <CardHead eyebrow="Maths" title="How your target was built" />
                    <p className="small muted" style={{ lineHeight: 1.7 }}>
                      {String(plan.rationale || '')
                        .replace('Mifflin-St Jeor', 'a standard equation')
                        .replace(/BMR/g, 'base calories')
                        .replace(/TDEE/g, 'daily burn')}
                    </p>
                    <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 14 }}>
                      <Chip>Rest burn {nf(plan.targets.bmr)}</Chip>
                      <Chip>Daily burn {nf(plan.targets.tdee)}</Chip>
                      <Chip tone={plan.targets.deficit_or_surplus < 0 ? 'ember' : 'teal'}>
                        {plan.targets.deficit_or_surplus > 0 ? '+' : ''}{nf(plan.targets.deficit_or_surplus)} kcal
                      </Chip>
                      <Chip>{plan.targets.expected_rate}</Chip>
                      <Chip tone="ok">{plan.targets.water_l} L water</Chip>
                    </div>
                  </Card>
                </Reveal>

                {plan.days?.length > 1 && (
                  <Reveal>
                    <Card solid className="stack gap-12">
                      <div className="row-between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                        <div>
                          <div className="eyebrow">7-Day Meal Rotation · Varied Daily Meals</div>
                          <div className="strong" style={{ fontSize: '1.15rem', marginTop: 2 }}>{currentDay.day_name} · {currentDay.theme}</div>
                        </div>
                        <div className="row gap-8">
                          <Chip tone={currentDay.cuisine === 'North Indian' ? 'ember' : currentDay.cuisine === 'South Indian' ? 'teal' : 'violet'}>
                            {currentDay.cuisine}
                          </Chip>
                          <Button variant="ghost" size="sm" onClick={applyPlanToToday}>
                            <Icon name="check" size={13} /> Log {currentDay.day_name} to Today
                          </Button>
                        </div>
                      </div>
                      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                        {plan.days.map((d, i) => (
                          <button
                            key={d.day_name}
                            type="button"
                            onClick={() => { setSelectedDayIdx(i); setMealAlts({}); }}
                            aria-label={`View ${d.day_name} meal plan`}
                            aria-pressed={selectedDayIdx === i}
                            className={`btn btn-sm ${selectedDayIdx === i ? 'btn-ember' : 'btn-ghost'}`}
                            style={{ minWidth: 54, fontWeight: selectedDayIdx === i ? 700 : 500 }}
                          >
                            {d.day_name.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                      <div className="tiny muted mono">
                        Target for {currentDay.day_name}: {nf(currentDay.totals?.calories)} kcal · P {nf(currentDay.totals?.protein_g)} g · C {nf(currentDay.totals?.carbs_g)} g · F {nf(currentDay.totals?.fat_g)} g
                      </div>
                    </Card>
                  </Reveal>
                )}

                <div className="grid grid-2">
                  {activeMeals.map((m, mIdx) => {
                    const altIdx = mealAlts[mIdx] || 0;
                    const displayFoods = altIdx > 0 && m.alternatives?.[altIdx - 1] ? m.alternatives[altIdx - 1] : m.foods;
                    const mActual = displayFoods.reduce(
                      (a, f) => ({
                        calories: a.calories + f.calories,
                        protein_g: a.protein_g + f.protein_g,
                        carbs_g: a.carbs_g + f.carbs_g,
                        fat_g: a.fat_g + f.fat_g,
                      }),
                      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
                    );
                    return (
                      <Reveal key={`${m.name}-${mIdx}-${altIdx}`}>
                        <Card className="stack gap-12" style={{ height: '100%' }}>
                          <div className="row-between">
                            <div>
                              <div className="row gap-6" style={{ alignItems: 'center' }}>
                                <span className="strong">{m.name}</span>
                                {altIdx > 0 && <span className="chip chip-ember tiny" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>Option {altIdx + 1}</span>}
                              </div>
                              <div className="tiny muted mono">{m.time} · {nf(mActual.calories)} kcal · P {nf(mActual.protein_g)} · C {nf(mActual.carbs_g)} · F {nf(mActual.fat_g)}</div>
                            </div>
                            <div className="row gap-6" style={{ alignItems: 'center' }}>
                              {m.alternatives?.length > 0 && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                  title="Rotate this meal to an alternative authentic recipe"
                                  aria-label={`Rotate ${m.name} to alternative authentic recipe`}
                                  onClick={() => toggleMealAlt(mIdx)}
                                >
                                  <Icon name="refresh" size={11} /> Rotate
                                </button>
                              )}
                              <Chip tone="ghost">{pct(mActual.calories, plan.targets.calories)}%</Chip>
                            </div>
                          </div>
                          <div className="stack gap-6">
                            {displayFoods.map((f, i) => {
                              const badge = cuisineBadge(f);
                              return (
                                <div key={i} className="row-between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                                  <span className="flex-1">
                                    {f.name}
                                    {badge && (
                                      <span className="chip chip-ghost tiny" style={{ marginLeft: 6, fontSize: '0.68rem', padding: '1px 6px' }}>
                                        {badge.iconName && <Icon name={badge.iconName} size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                                        {badge.label}
                                      </span>
                                    )}
                                  </span>
                                  <span className="mono tiny muted">{nf(f.grams)} g</span>
                                  <span className="mono tiny strong" style={{ width: 56, textAlign: 'right' }}>{nf(f.calories)}</span>
                                </div>
                              );
                            })}
                          </div>
                          {m.notes && <div className="tiny muted" style={{ lineHeight: 1.55 }}>{m.notes}</div>}
                        </Card>
                      </Reveal>
                    );
                  })}
                </div>

                <div className="grid grid-2">
                  <Reveal>
                    <Card solid className="stack gap-10">
                      <CardHead eyebrow="Rules" title="Stick to it" />
                      <div className="stack gap-8">
                        {(plan.rules || []).map((r, i) => (
                          <div key={i} className="row gap-10 small"><Icon name="check" size={14} style={{ color: 'var(--ok)' }} /><span className="flex-1 muted">{r}</span></div>
                        ))}
                      </div>
                      {plan.adherence_tip && <div className="chip chip-ember"><Icon name="spark" size={12} /> {plan.adherence_tip}</div>}
                    </Card>
                  </Reveal>
                  <Reveal delay={70}>
                    <Card solid className="stack gap-12">
                      <CardHead eyebrow="Shopping" title="Grocery list" right={<Chip tone="ghost">{plan.grocery?.length || 0} items</Chip>} />
                      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                        {(plan.grocery || []).map((g) => <Chip key={g}>{g}</Chip>)}
                      </div>
                    </Card>
                  </Reveal>
                </div>
              </>
            )}
          </>
        )}

        {/* ------------------------------- trend --------------------------- */}
        {tab === 'trend' && (
          <div className="grid grid-2">
            <Reveal>
              <Card solid className="stack gap-12">
                <CardHead eyebrow="Adherence" title="Energy, 14 days" subtitle={`Target ${nf(t.calories)} kcal/day`} />
                <LineChart
                  data={range.map((r) => ({ date: r.date, value: r.calories }))}
                  color="var(--macro-calories)" unit=" kcal" targetLine={t.calories} height={200}
                  emptyLabel="Log food on at least two days to see the trend."
                />
              </Card>
            </Reveal>
            <Reveal delay={70}>
              <Card solid className="stack gap-12">
                <CardHead eyebrow="Adherence" title="Protein, 14 days" subtitle={`Target ${t.protein_g} g/day`} />
                <LineChart
                  data={range.map((r) => ({ date: r.date, value: r.protein_g }))}
                  color="var(--macro-protein)" unit=" g" targetLine={t.protein_g} height={200}
                  emptyLabel="Not enough protein data yet."
                />
              </Card>
            </Reveal>
          </div>
        )}
      </div>

      {/* ---------------------------- add-food modal ------------------------- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add food"
        subtitle={`${MEALS.find((m) => m.id === addMeal)?.label || 'Snack'} · ${relativeDay(date)}`}
        wide
      >
        <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <SelectMenu width={168} value={addMeal} onChange={setAddMeal} options={MEALS.map((m) => ({ value: m.id, label: m.label }))} />
          <Input placeholder="Search the food database…" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" style={{ minWidth: 180 }} aria-label="Search foods" />
        </div>

        <div className="row gap-6" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { id: 'all', label: 'All Foods' },
            { id: 'north', label: 'North Indian', icon: 'spark' },
            { id: 'south', label: 'South Indian', icon: 'leaf' },
            { id: 'protein', label: 'High Protein', icon: 'bolt' },
            { id: 'staple', label: 'Staples', icon: 'target' },
          ].map((c) => (
            <Chip
              key={c.id}
              onClick={() => setCuisineFilter(c.id)}
              tone={cuisineFilter === c.id ? 'ember' : 'ghost'}
              style={{ cursor: 'pointer', fontWeight: cuisineFilter === c.id ? 700 : 500 }}
            >
              {c.icon && <Icon name={c.icon} size={12} style={{ marginRight: 2 }} />}
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="grid grid-side">
          <div className="stack gap-6" style={{ maxHeight: '42vh', overflowY: 'auto' }}>
            {displayedFoods.map((f) => {
              const b = cuisineBadge(f);
              return (
                <button
                  key={f.name}
                  className="ex-row"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: picked?.name === f.name ? 'var(--ember-soft)' : undefined }}
                  onClick={() => { setPicked(f); setGrams(f.serving_g); setManual((m) => ({ ...m, food_name: f.name })); }}
                >
                  <div>
                    <div className="ex-name" style={{ fontSize: '0.9rem' }}>
                      {f.name}
                      {b && (
                        <span className="chip chip-ghost tiny" style={{ marginLeft: 6, fontSize: '0.68rem', padding: '1px 6px' }}>
                          {b.iconName && <Icon name={b.iconName} size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                          {b.label}
                        </span>
                      )}
                    </div>
                    <div className="ex-meta"><span>per 100 g: <b>{f.kcal}</b> kcal · P <b>{f.protein_g}</b> · C <b>{f.carbs_g}</b> · F <b>{f.fat_g}</b></span></div>
                  </div>
                  <Chip tone="ghost">{f.serving_g} g</Chip>
                </button>
              );
            })}
            {!displayedFoods.length && <Empty>No foods match “{q || cuisineFilter}”. Enter it manually on the right.</Empty>}
          </div>

          <div className="stack gap-12">
            {picked ? (
              <>
                <SliderField label={picked.name} unit=" g" min={5} max={600} step={5} value={Number(grams) || 100} onChange={setGrams} hint="cooked weight of what you ate" />
                <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                  {[50, 100, 150, 200, 250].map((g) => (
                    <Chip key={g} onClick={() => setGrams(g)} active={Number(grams) === g}>{g} g</Chip>
                  ))}
                </div>
                <div className="tiny muted">Macros = per-100 g values × this portion.</div>
                {preview && (
                  <Card className="grid grid-4" style={{ background: 'var(--surface-2)', border: 0 }}>
                    {[['kcal', preview.calories], ['P', preview.protein_g], ['C', preview.carbs_g], ['F', preview.fat_g]].map(([l, v]) => (
                      <div key={l} className="stack gap-2">
                        <span className="eyebrow">{l}</span>
                        <span className="mono strong" style={{ fontSize: '1.1rem' }}>{nf(v, l === 'kcal' ? 0 : 1)}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </>
            ) : (
              <>
                <div className="chip chip-teal" style={{ alignSelf: 'flex-start' }}>
                  <Icon name="bolt" size={12} /> Totals for THIS portion — not per 100 g
                </div>
                <Field label="Food name"><Input value={manual.food_name} onChange={(e) => setManual({ ...manual, food_name: e.target.value })} placeholder="e.g. Homemade biryani" /></Field>
                <div className="grid grid-2">
                  <Field label="Calories" hint="as eaten"><Input className="input-num" type="number" min="0" value={manual.calories} onChange={(e) => setManual({ ...manual, calories: e.target.value })} /></Field>
                  <Field label="Protein (g)"><Input className="input-num" type="number" min="0" step="0.5" value={manual.protein_g} onChange={(e) => setManual({ ...manual, protein_g: e.target.value })} /></Field>
                  <Field label="Carbs (g)"><Input className="input-num" type="number" min="0" step="0.5" value={manual.carbs_g} onChange={(e) => setManual({ ...manual, carbs_g: e.target.value })} /></Field>
                  <Field label="Fat (g)"><Input className="input-num" type="number" min="0" step="0.5" value={manual.fat_g} onChange={(e) => setManual({ ...manual, fat_g: e.target.value })} /></Field>
                </div>
              </>
            )}
            <Button variant="ember" block onClick={addEntry}><Icon name="check" size={15} /> Log it</Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------- voice confirm modal ----------------------- */}
      <Modal
        open={Boolean(voiceItems)}
        onClose={() => setVoiceItems(null)}
        title="Confirm your spoken meal"
        subtitle={voiceText ? `Heard: “${voiceText}”` : undefined}
      >
        <div className="stack gap-12">
          {(voiceItems || []).map((it, i) => (
            <Card key={`${it.food_name}-${i}`} className="stack gap-8">
              <div className="row-between gap-8">
                <span className="strong small flex-1">{it.food_name}</span>
                <Button variant="icon" size="sm" aria-label={`Remove ${it.food_name}`}
                  onClick={() => setVoiceItems((v) => v.filter((_, j) => j !== i))}>
                  <Icon name="close" size={13} />
                </Button>
              </div>
              <SliderField label="Portion" unit=" g" min={5} max={600} step={5} value={it.grams}
                onChange={(g) => setVoiceItems((v) => v.map((x, j) => (j === i ? { ...x, grams: g } : x)))} />
              <SelectMenu width={150} value={it.meal_type} options={MEALS.map((m) => ({ value: m.id, label: m.label }))}
                onChange={(m) => setVoiceItems((v) => v.map((x, j) => (j === i ? { ...x, meal_type: m } : x)))} />
            </Card>
          ))}
          <div className="row gap-10" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setVoiceItems(null)}>Discard</Button>
            <Button variant="ember" onClick={commitVoiceItems}><Icon name="check" size={15} /> Log {voiceItems?.length || 0} item(s)</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function guessMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

function mealFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(?:breakfast|brekkie)\b/.test(n)) return 'breakfast';
  if (/\blunch\b/.test(n)) return 'lunch';
  if (/\b(?:dinner|supper)\b/.test(n)) return 'dinner';
  if (/\bpre[\s_-]?workout\b|\bbefore\s+(?:training|workout)\b/.test(n)) return 'pre_workout';
  if (/\bpost[\s_-]?workout\b|\bafter\s+(?:training|workout)\b/.test(n)) return 'post_workout';
  return 'snack';
}
