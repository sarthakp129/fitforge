import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useStore from '../store/useStore.js';
import api, { streamPost } from '../lib/api.js';
import {
  nf, compact, fmtDate, todayISO, relativeDay, secondsToClock, durationLabel,
  sourceChip, titleCase, humanOverview,
} from '../lib/format.js';
import {
  Card, CardHead, Button, Chip, Icon, Modal, Field, Input, Segmented,
  Empty, Reveal, Skeleton, Spinner,
} from './ui.jsx';
import { SelectMenu } from './Controls.jsx';

/* ============================== rest timer ================================ */

function useRestTimer(onEnd) {
  const [remaining, setRemaining] = useState(0);
  const [total, setTotal] = useState(0);
  const ref = useRef(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((ref.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        try { navigator.vibrate?.(220); } catch { /* not supported */ }
        endRef.current?.();
      }
    }, 250);
    return () => clearInterval(t);
  }, [remaining > 0]);

  const start = (seconds) => {
    const s = Math.max(5, Number(seconds) || 60);
    ref.current = Date.now() + s * 1000;
    setTotal(s);
    setRemaining(s);
  };
  const stop = () => { setRemaining(0); setTotal(0); };
  const nudge = (delta) => { if (remaining > 0) { ref.current += delta * 1000; setRemaining((r) => Math.max(0, r + delta)); } };
  return { remaining, total, start, stop, nudge };
}

function RestTimerCard({ timer }) {
  if (!timer.remaining) return null;
  const ratio = timer.total ? timer.remaining / timer.total : 0;
  const C = 2 * Math.PI * 34;
  return (
    <Card solid className="row gap-16 rest-pill" style={{ alignItems: 'center' }}>
      <div className="ring-wrap" style={{ width: 76, height: 76 }}>
        <svg width="76" height="76" viewBox="0 0 76 76" className="timer-ring">
          <circle cx="38" cy="38" r="34" fill="none" className="ring-track" strokeWidth="6" />
          <circle cx="38" cy="38" r="34" fill="none" stroke={ratio < 0.2 ? 'var(--ember)' : 'var(--teal)'} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)}
            style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
        </svg>
        <div className="ring-center mono strong" style={{ fontSize: '1.02rem' }}>{secondsToClock(timer.remaining)}</div>
      </div>
      <div className="flex-1 stack gap-4">
        <span className="eyebrow">Rest</span>
        <span className="small muted">Next set when the ring closes.</span>
      </div>
      <div className="row gap-6">
        <Button variant="soft" size="sm" onClick={() => timer.nudge(-15)}>-15s</Button>
        <Button variant="soft" size="sm" onClick={() => timer.nudge(15)}>+15s</Button>
        <Button variant="ghost" size="sm" onClick={timer.stop}><Icon name="close" size={14} /></Button>
      </div>
    </Card>
  );
}

/* ============================ session logger ============================== */

function SessionLogger({ session, onClose, onSaved }) {
  const { handleError, toast } = useStore();
  const timer = useRestTimer(() => toast('Rest done — next set.', 'ok', 2600));
  const startedAt = useRef(Date.now());
  const [name, setName] = useState(session?.title || 'Workout');
  const [notes, setNotes] = useState('');
  const [rpe, setRpe] = useState('');
  const [rows, setRows] = useState(() =>
    (session?.exercises || []).map((ex) => ({
      exercise_id: ex.exercise_id,
      exercise_name: ex.name,
      rest_s: ex.rest_s || 90,
      target_reps: ex.reps || '8-12',
      last: session.last_performance?.[ex.exercise_id] || null,
      sets: Array.from({ length: ex.sets || 3 }, (_, i) => ({
        set_number: i + 1,
        reps: session.last_performance?.[ex.exercise_id]?.reps ?? repMid(ex.reps) ?? 8,
        weight_kg: session.last_performance?.[ex.exercise_id]?.weight_kg ?? 0,
        rpe: '',
        done: false,
      })),
    }))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [burst, setBurst] = useState(null);

  const totals = useMemo(() => {
    let sets = 0; let volume = 0; let reps = 0;
    for (const r of rows) for (const s of r.sets) if (s.done) { sets++; volume += (Number(s.weight_kg) || 0) * (Number(s.reps) || 0); reps += Number(s.reps) || 0; }
    return { sets, volume, reps };
  }, [rows]);

  const updateSet = (ri, si, patch) =>
    setRows((rs) => rs.map((r, i) => i !== ri ? r : {
      ...r,
      sets: r.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })),
    }));

  const completeSet = (ri, si) => {
    const row = rows[ri];
    const s = row.sets[si];
    // peak-end rule: celebrate the moment of progress, instantly
    const prev = row.last;
    const w = Number(s.weight_kg) || 0;
    const r = Number(s.reps) || 0;
    if (prev && w > 0 && e1rm(w, r) > e1rm(Number(prev.weight_kg), Number(prev.reps)) + 0.25) {
      const id = `${ri}-${si}-${Date.now()}`;
      setBurst({ id, ri, si });
      setTimeout(() => setBurst(null), 900);
      toast(`New PR — ${row.exercise_name}: ${w} kg × ${r}.`, 'ok', 4200);
    }
    updateSet(ri, si, { done: true });
    timer.start(row.rest_s);
  };

  const addSet = (ri) =>
    setRows((rs) => rs.map((r, i) => {
      if (i !== ri) return r;
      const lastSet = r.sets[r.sets.length - 1] || { reps: 8, weight_kg: 0 };
      return { ...r, sets: [...r.sets, { set_number: r.sets.length + 1, reps: lastSet.reps, weight_kg: lastSet.weight_kg, rpe: '', done: false }] };
    }));

  const removeRow = (ri) => setRows((rs) => rs.filter((_, i) => i !== ri));

  const addExercise = (ex) => {
    setRows((rs) => [...rs, {
      exercise_id: ex.id, exercise_name: ex.name, rest_s: 90, target_reps: '8-12', last: null,
      sets: [{ set_number: 1, reps: 10, weight_kg: 0, rpe: '', done: false }],
    }]);
    setPickerOpen(false);
  };

  const save = async () => {
    const sets = rows.flatMap((r) => r.sets.filter((s) => s.done).map((s) => ({
      exercise_id: r.exercise_id,
      exercise_name: r.exercise_name,
      set_number: s.set_number,
      reps: Number(s.reps) || 0,
      weight_kg: Number(s.weight_kg) || 0,
      rpe: s.rpe === '' ? null : Number(s.rpe),
      rest_s: r.rest_s,
      is_warmup: Number(s.weight_kg) === 0 && Number(s.reps) > 0 ? 0 : 0,
    })));
    if (!sets.length) return toast('Mark at least one set as done before saving.', 'warn');
    try {
      await api.training.log({
        date: todayISO(),
        name,
        focus: session?.focus || 'full_body',
        duration_s: Math.round((Date.now() - startedAt.current) / 1000),
        rpe: rpe === '' ? null : Number(rpe),
        notes,
        sets,
      });
      toast(`Session saved — ${sets.length} sets, ${compact(totals.volume)} kg.`, 'ok');
      onSaved?.();
      onClose?.();
    } catch (err) {
      handleError(err, 'Could not save the session.');
    }
  };

  return (
    <div className="stack gap-16">
      <Card solid className="stack gap-12">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="stack gap-4 flex-1" style={{ minWidth: 200 }}>
            <span className="eyebrow">Live session</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="strong" style={{ fontSize: '1.05rem' }} />
          </div>
          <div className="row gap-16">
            {[['Sets', totals.sets], ['Volume', `${compact(totals.volume)} kg`], ['Reps', totals.reps], ['Time', secondsToClock((Date.now() - startedAt.current) / 1000)]].map(([l, v]) => (
              <div key={l} className="stack gap-2" style={{ textAlign: 'right' }}>
                <span className="eyebrow">{l}</span>
                <span className="mono strong">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {rows.map((row, ri) => (
        <Card key={`${row.exercise_id}-${ri}`} className="stack gap-12">
          <div className="row-between gap-12" style={{ flexWrap: 'wrap' }}>
            <div className="flex-1" style={{ minWidth: 180 }}>
              <div className="ex-name">{row.exercise_name}</div>
              <div className="ex-meta">
                <span>target <b>{row.target_reps}</b></span>
                {row.last && <span style={{ color: 'var(--teal)' }}>last <b>{nf(row.last.weight_kg, 1)} kg × {row.last.reps}</b> · {fmtDate(row.last.date)}</span>}
              </div>
            </div>
            <div className="row gap-6">
              <Field label="" className="gap-4">
                <Input className="input-sm input-num" type="number" min="0" max="600" step="5" value={row.rest_s}
                  onChange={(e) => setRows((rs) => rs.map((r, i) => i === ri ? { ...r, rest_s: Number(e.target.value) } : r))}
                  style={{ width: 74 }} aria-label="Rest seconds" />
              </Field>
              <Button variant="ghost" size="sm" onClick={() => addSet(ri)}><Icon name="plus" size={14} /> Set</Button>
              <Button variant="icon" size="sm" onClick={() => removeRow(ri)} aria-label="Remove exercise"><Icon name="trash" size={15} /></Button>
            </div>
          </div>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th style={{ width: 40 }}>#</th><th>Weight (kg)</th><th>Reps</th><th>RPE</th><th style={{ width: 92 }} /></tr>
              </thead>
              <tbody>
                {row.sets.map((s, si) => (
                  <tr key={si}>
                    <td className="set-num">{si + 1}</td>
                    <td><Input className={`set-input ${s.done ? 'set-done' : ''}`} type="number" min="0" step="0.5" value={s.weight_kg}
                      onChange={(e) => updateSet(ri, si, { weight_kg: e.target.value })} disabled={s.done} aria-label={`weight set ${si + 1}`} /></td>
                    <td><Input className={`set-input ${s.done ? 'set-done' : ''}`} type="number" min="0" max="100" value={s.reps}
                      onChange={(e) => updateSet(ri, si, { reps: e.target.value })} disabled={s.done} aria-label={`reps set ${si + 1}`} /></td>
                    <td><Input className="set-input" type="number" min="1" max="10" step="0.5" placeholder="—" value={s.rpe}
                      onChange={(e) => updateSet(ri, si, { rpe: e.target.value })} disabled={s.done} aria-label={`rpe set ${si + 1}`} /></td>
                    <td style={{ position: 'relative' }}>
                      {burst && burst.ri === ri && burst.si === si && (
                        <span className="pr-burst" aria-hidden="true">
                          {BURST.map((d, i) => <i key={i} style={{ '--bx': d[0], '--by': d[1] }} />)}
                        </span>
                      )}
                      {s.done
                        ? <Chip tone="ok"><Icon name="check" size={12} /> done</Chip>
                        : <Button variant="soft" size="sm" onClick={() => completeSet(ri, si)}>Complete</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => setPickerOpen(true)}><Icon name="plus" size={15} /> Add exercise</Button>
        <Input placeholder="Session notes — how it felt, bar speed, niggles…" value={notes} onChange={(e) => setNotes(e.target.value)} className="flex-1" style={{ minWidth: 200 }} />
        <SelectMenu width={140} value={rpe} onChange={setRpe} options={[
          { value: '', label: 'Session RPE' },
          ...[6, 7, 8, 9, 10].map((r) => ({ value: String(r), label: `${r} / 10` })),
        ]} />
      </div>

      <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="ember" size="lg" onClick={save}><Icon name="check" size={16} /> Save session</Button>
      </div>

      <RestTimerCard timer={timer} />
      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  );
}

// 12 fixed burst directions (pure CSS vars drive the animation)
const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 30 + (i % 3) * 12;
  return [`${Math.round(Math.cos(a) * r)}px`, `${Math.round(Math.sin(a) * r)}px`];
});
const e1rm = (w, r) => (w > 0 && r > 0 ? w * (1 + r / 30) : 0);

function repMid(range) {
  const m = String(range || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/* =========================== exercise picker ============================ */

function ExercisePicker({ open, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [equipment, setEquipment] = useState('');
  const [data, setData] = useState(null);
  const { handleError } = useStore();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.training.exercises({ q: q || undefined, category: category || undefined, equipment: equipment || undefined })
        .then(setData)
        .catch((e) => handleError(e, 'Could not load the exercise library.'));
    }, 180);
    return () => clearTimeout(t);
  }, [open, q, category, equipment]);

  return (
    <Modal open={open} onClose={onClose} title="Exercise library" subtitle={data ? `${data.count} matches` : 'Searching…'} wide>
      <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <Input placeholder="Search squats, press, curl…" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" style={{ minWidth: 180 }} />
        <SelectMenu width={150} value={category} onChange={setCategory} options={[
          { value: '', label: 'All categories' },
          ...(data?.facets?.categories || []).map((c) => ({ value: c, label: titleCase(c) })),
        ]} />
        <SelectMenu width={160} value={equipment} onChange={setEquipment} options={[
          { value: '', label: 'Any equipment' },
          ...(data?.facets?.equipment || []).map((c) => ({ value: c, label: titleCase(c) })),
        ]} />
      </div>
      <div className="stack gap-8" style={{ maxHeight: '48vh', overflowY: 'auto' }}>
        {!data && <Skeleton h={54} />}
        {(data?.exercises || []).map((ex) => (
          <button key={ex.id} className="ex-row" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => onPick(ex)}>
            <div>
              <div className="ex-name">{ex.name}</div>
              <div className="ex-meta">
                <span>{ex.muscles.join(' · ')}</span>
                <span>{titleCase(ex.equipment)}</span>
                <span>{titleCase(ex.level)}</span>
              </div>
            </div>
            <Chip tone={ex.compound ? 'ember' : 'ghost'}>{ex.compound ? 'compound' : ex.pattern}</Chip>
          </button>
        ))}
        {data && !data.exercises.length && <Empty>No exercises match those filters.</Empty>}
      </div>
    </Modal>
  );
}

/* ============================= generation UI ============================= */

function GenerationStatus({ state }) {
  if (!state) return null;
  const { phase, waitMs, attempt, reason } = state;
  const label = {
    throttled: `Waiting for token budget — ${Math.ceil((waitMs || 0) / 1000)}s`,
    reserved: 'Budget reserved, calling the model…',
    retrying: `Rate limited, retry ${attempt || 1} in ${Math.ceil((waitMs || 0) / 1000)}s`,
    degraded: `Falling back to the local engine (${reason || 'no JSON'})`,
  }[phase] || phase;
  const tone = phase === 'retrying' ? 'warn' : phase === 'degraded' ? 'ghost' : 'teal';
  return (
    <div className="row gap-10" style={{ marginTop: 10 }}>
      <Spinner size={13} />
      <Chip tone={tone}>{label}</Chip>
    </div>
  );
}

/* ================================ main view ============================== */

export default function Training() {
  const location = useLocation();
  const pendingSession = location.state?.session || null;
  const { handleError, toast, profile, refreshAiStatus } = useStore();
  const [tab, setTab] = useState(pendingSession ? 'log' : 'plan');
  const [plan, setPlan] = useState(null);
  const [planMeta, setPlanMeta] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genState, setGenState] = useState(null);
  const [mode, setMode] = useState('overlay');
  const [weeks, setWeeks] = useState(4);
  const [activeDay, setActiveDay] = useState(0);
  const [session, setSession] = useState(pendingSession);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [active, list] = await Promise.all([
        api.ai.activePlan('training').catch(() => ({ plan: null })),
        api.training.workouts({ limit: 20 }).catch(() => ({ workouts: [] })),
      ]);
      setPlan(active.plan || null);
      setPlanMeta(active.plan ? { id: active.id, source: active.source, model: active.model, created_at: active.created_at } : null);
      setHistory(list.workouts || []);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => { load(); }, [load]);
  // a session handed over from the Dashboard opens straight into the logger
  useEffect(() => { if (pendingSession) { setSession(pendingSession); setTab('log'); } }, [pendingSession]);

  const generate = async (force = false) => {
    setGenerating(true);
    setGenState(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const done = await streamPost(
        '/api/ai/plans/training',
        { mode, weeks, force },
        ({ event, data }) => {
          if (event === 'progress') setGenState(data);
          if (event === 'error') setGenState({ phase: 'degraded', reason: data.message });
        },
        { signal: controller.signal }
      );
      // 'done' carries the plan, so paint immediately instead of waiting on a refetch
      if (done?.plan) {
        setPlan(done.plan);
        setPlanMeta({ id: done.id, source: done.plan.meta?.source, model: done.plan.meta?.model });
      }
      await load();
      await refreshAiStatus();
      toast('Training plan ready.', 'ok');
    } catch (err) {
      if (err.name !== 'AbortError') handleError(err, 'Plan generation failed — the local engine will be used instead.');
      await load();
    } finally {
      setGenerating(false);
      setGenState(null);
      abortRef.current = null;
    }
  };

  const startDay = (day) => {
    setSession({ ...day, last_performance: day.last_performance || {} });
    setTab('log');
  };

  const removeWorkout = async (id) => {
    if (!window.confirm('Delete this logged workout and all its sets?')) return;
    try {
      await api.training.remove(id);
      toast('Workout deleted.', 'info', 2200);
      load();
    } catch (err) { handleError(err); }
  };

  const day = plan?.schedule?.[activeDay];

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <Reveal>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div className="eyebrow">Training</div>
              <h1 style={{ fontSize: 'clamp(1.8rem,3.6vw,2.4rem)', marginTop: 6 }}>{plan?.meta?.name || 'Your training plan'}</h1>
              {plan && <p className="small muted" style={{ marginTop: 6 }}>{humanOverview(plan)}</p>}
            </div>
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              <Segmented size="sm" value={tab} onChange={setTab} options={[
                { value: 'plan', label: 'Plan' },
                { value: 'log', label: 'Log session' },
                { value: 'history', label: 'History' },
              ]} />
            </div>
          </div>
        </Reveal>

        {/* ------------------------------- plan ---------------------------- */}
        {tab === 'plan' && (
          <>
            <Reveal>
              <Card solid className="stack gap-12">
                <CardHead
                  eyebrow="Generator"
                  title="Forge a new plan"
                  subtitle="Built from your profile in a few seconds."
                  right={
                    <div className="row gap-8">
                      <SelectMenu width={110} value={String(weeks)} onChange={(v) => setWeeks(Number(v))} options={[2, 4, 6, 8, 12].map((w) => ({ value: String(w), label: `${w} weeks` }))} />
                    </div>
                  }
                />
                <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
                  <Button variant="ember" onClick={() => generate(false)} disabled={generating} loading={generating}>
                    <Icon name="spark" size={16} /> {plan ? 'Regenerate plan' : 'Generate plan'}
                  </Button>
                  {plan && (
                    <Button variant="ghost" onClick={() => generate(true)} disabled={generating}>
                      <Icon name="refresh" size={15} /> Force fresh (skip cache)
                    </Button>
                  )}
                  {generating && abortRef.current && (
                    <Button variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                  )}
                </div>
                <GenerationStatus state={genState} />
                {!plan && !loading && (
                  <div className="tiny muted">
                    Nothing generated yet. With no API key this still produces a complete, evidence-based plan from the local engine.
                  </div>
                )}
              </Card>
            </Reveal>

            {loading && <Skeleton h={220} r={18} />}

            {plan && (
              <>
                <Reveal>
                  <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                    {plan.schedule.map((d, i) => (
                      <Chip key={d.day} active={i === activeDay} onClick={() => setActiveDay(i)}>
                        <span className="mono">{d.day_name.slice(0, 3)}</span> {d.title}
                      </Chip>
                    ))}
                  </div>
                </Reveal>

                {day && (
                  <Reveal>
                    <Card solid className="stack gap-16">
                      <CardHead
                        eyebrow={`${day.day_name} · ${day.duration_min} min · ${day.working_sets} working sets`}
                        title={day.title}
                        subtitle={day.notes}
                        right={<Button variant="ember" size="sm" onClick={() => startDay(day)}><Icon name="play" size={14} /> Start</Button>}
                      />

                      {day.blocks?.filter((b) => b.items?.length).map((block) => (
                        <div key={block.name} className="stack gap-8">
                          <div className="row gap-8">
                            <span className="eyebrow">{block.name}</span>
                            {block.minutes && <Chip tone="ghost">{block.minutes} min</Chip>}
                          </div>
                          <div className="stack gap-6">
                            {block.items.map((it, i) => (
                              // detail sits directly under its label: no eye travel
                              <div key={i} className="row gap-10 small" style={{ alignItems: 'flex-start' }}>
                                <span className="dot dot-teal" style={{ marginTop: 7 }} />
                                <span className="stack gap-2 flex-1">
                                  <span className="strong">{it.exercise}</span>
                                  <span className="muted tiny" style={{ lineHeight: 1.5 }}>{it.detail}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="stack gap-10">
                        <span className="eyebrow">Main work</span>
                        {day.exercises.map((ex, i) => (
                          <div key={`${ex.exercise_id}-${i}`} className="ex-row">
                            <div className="flex-1">
                              <div className="ex-name">{ex.name}</div>
                              <div className="ex-meta">
                                <span><b>{ex.sets}</b> × <b>{ex.reps}</b></span>
                                <span>{ex.load}</span>
                                <span>rest <b>{ex.rest_s}s</b></span>
                                <span>tempo {ex.tempo}</span>
                                {ex.rpe && <span>RPE {ex.rpe}</span>}
                                <span>{ex.muscles?.join(' · ')}</span>
                              </div>
                              <div className="ex-cue">{ex.cues}</div>
                              {ex.swap_reason && (
                                <div className="chip chip-ember" style={{ marginTop: 8 }}>
                                  <Icon name="spark" size={12} /> AI swap: {ex.swap_reason}
                                </div>
                              )}
                            </div>
                            <Chip tone={ex.role === 'primary' ? 'ember' : ex.role === 'conditioning' ? 'teal' : 'ghost'}>{ex.role}</Chip>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </Reveal>
                )}

                {plan.progression && (
                  <Reveal>
                    <div className="grid grid-2">
                      <Card solid className="stack gap-10">
                        <CardHead eyebrow="Progression" title={plan.progression.model || 'How to progress'} />
                        <p className="small muted" style={{ lineHeight: 1.65 }}>{plan.progression.rule}</p>
                        <p className="small muted" style={{ lineHeight: 1.65 }}>{plan.progression.weekly}</p>
                        <div className="chip chip-teal"><Icon name="clock" size={12} /> {plan.progression.deload}</div>
                      </Card>
                      <Card solid className="stack gap-10">
                        <CardHead eyebrow="Block" title={`${plan.meta.weeks} weeks`} subtitle={plan.principles?.[0]} />
                        <div className="stack gap-6">
                          {(plan.weekly_progression || []).map((w) => (
                            <div key={w.week} className="row-between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--line-2)' }}>
                              <span className="strong">Week {w.week} · {w.label}</span>
                              <span className="muted tiny" style={{ textAlign: 'right', maxWidth: '58ch' }}>{w.instruction}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </div>
                  </Reveal>
                )}

                {plan.principles?.length > 0 && (
                  <Reveal>
                    <Card solid>
                      <CardHead eyebrow="Non-negotiables" title="Principles" />
                      <div className="grid grid-2 gap-12">
                        {plan.principles.map((p, i) => (
                          <div key={i} className="row gap-10 small">
                            <span className="mono" style={{ color: 'var(--ember)', fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
                            <span className="flex-1 muted" style={{ lineHeight: 1.6 }}>{p}</span>
                          </div>
                        ))}
                      </div>
                      {plan.red_flags?.length > 0 && (
                        <div className="stack gap-6" style={{ marginTop: 16 }}>
                          {plan.red_flags.map((r, i) => (
                            <div key={i} className="chip chip-warn"><Icon name="bolt" size={12} /> {r}</div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </Reveal>
                )}
              </>
            )}
          </>
        )}

        {/* -------------------------------- log ---------------------------- */}
        {tab === 'log' && (
          session ? (
            <SessionLogger
              session={session}
              onClose={() => { setSession(null); setTab('plan'); }}
              onSaved={() => { setSession(null); load(); }}
            />
          ) : (
            <Card solid>
              <Empty
                icon="◇"
                title="No session loaded"
                action={
                  <div className="row gap-8" style={{ marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {plan?.schedule?.map((d, i) => (
                      <Button key={d.day} variant="soft" size="sm" onClick={() => startDay(d)}>{d.title}</Button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => setSession({ title: 'Freestyle session', focus: 'full_body', exercises: [] })}>
                      <Icon name="plus" size={14} /> Empty session
                    </Button>
                  </div>
                }
              >
                Pick a day from your plan, or start an empty session and add exercises yourself.
              </Empty>
            </Card>
          )
        )}

        {/* ------------------------------ history -------------------------- */}
        {tab === 'history' && (
          <div className="stack gap-12">
            {!history.length && <Card solid><Empty icon="◇" title="No sessions logged yet">Finish a session in the Log tab and it lands here with every set.</Empty></Card>}
            {history.map((w) => {
              const volume = w.sets.filter((s) => !s.is_warmup).reduce((sum, s) => sum + (s.reps * s.weight_kg), 0);
              return (
                <Card key={w.id} className="stack gap-12">
                  <CardHead
                    eyebrow={`${relativeDay(w.date)} · ${fmtDate(w.date, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                    title={w.name}
                    subtitle={`${titleCase(w.focus)} · ${durationLabel(w.duration_s)} · ${w.sets.length} sets · ${compact(volume)} kg${w.rpe ? ` · RPE ${w.rpe}` : ''}`}
                    right={
                      <div className="row gap-6">
                        <Button variant="soft" size="sm" onClick={() => startDay({
                          title: w.name, focus: w.focus,
                          exercises: Object.values(w.sets.reduce((acc, s) => {
                            acc[s.exercise_id] ||= { exercise_id: s.exercise_id, name: s.exercise_name, sets: 0, reps: `${s.reps}`, rest_s: s.rest_s || 90 };
                            acc[s.exercise_id].sets += 1;
                            return acc;
                          }, {})),
                          last_performance: w.sets.reduce((acc, s) => {
                            acc[s.exercise_id] = { weight_kg: s.weight_kg, reps: s.reps, date: w.date };
                            return acc;
                          }, {}),
                        })}>
                          <Icon name="refresh" size={14} /> Repeat
                        </Button>
                        <Button variant="icon" size="sm" onClick={() => removeWorkout(w.id)} aria-label="Delete workout"><Icon name="trash" size={15} /></Button>
                      </div>
                    }
                  />
                  <div className="table-scroll">
                    <table className="table">
                      <thead><tr><th>Exercise</th><th className="table-num">Set</th><th className="table-num">kg</th><th className="table-num">Reps</th><th className="table-num">RPE</th></tr></thead>
                      <tbody>
                        {w.sets.map((s) => (
                          <tr key={s.id}>
                            <td className="strong">{s.exercise_name}</td>
                            <td className="table-num">{s.set_number}</td>
                            <td className="table-num">{nf(s.weight_kg, 1)}</td>
                            <td className="table-num">{s.reps}</td>
                            <td className="table-num">{s.rpe ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {w.notes && <div className="small muted">“{w.notes}”</div>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
