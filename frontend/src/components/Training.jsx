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

function playChime() {
  try {
    if (typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    /* audio context blocked or unavailable */
  }
}

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
        playChime();
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

function buildLastPerformanceMap(workouts = []) {
  const map = {};
  for (const w of workouts) {
    for (const s of (w.sets || [])) {
      if (!s.exercise_id || s.is_warmup) continue;
      if (!map[s.exercise_id] || new Date(w.date) > new Date(map[s.exercise_id].date)) {
        map[s.exercise_id] = {
          weight_kg: s.weight_kg,
          reps: s.reps,
          rpe: s.rpe,
          date: w.date,
        };
      }
    }
  }
  return map;
}

function RestTimerCard({ timer }) {
  if (!timer.remaining) return null;
  const ratio = timer.total ? timer.remaining / timer.total : 0;
  const C = 2 * Math.PI * 34;
  return (
    <Card solid className="row gap-16 rest-pill" style={{ alignItems: 'center' }}>
      <div className="ring-wrap" style={{ width: 76, height: 76 }}>
        <svg width="76" height="76" viewBox="0 0 76 76" className="timer-ring" role="timer" aria-label={`Rest timer: ${secondsToClock(timer.remaining)} remaining`}>
          <circle cx="38" cy="38" r="34" fill="none" className="ring-track" strokeWidth="6" />
          <circle cx="38" cy="38" r="34" fill="none" stroke={ratio < 0.2 ? 'var(--ember)' : 'var(--teal)'} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)}
            style={{ transition: 'stroke-dashoffset 0.25s linear' }} />
        </svg>
        <div className="ring-center mono strong" aria-live="polite" style={{ fontSize: '1.02rem' }}>{secondsToClock(timer.remaining)}</div>
      </div>
      <div className="flex-1 stack gap-4">
        <span className="eyebrow">Rest</span>
        <span className="small muted">Next set when the ring closes.</span>
      </div>
      <div className="row gap-6">
        <Button variant="soft" size="sm" onClick={() => timer.nudge(-15)} aria-label="Subtract 15 seconds from rest timer">-15s</Button>
        <Button variant="soft" size="sm" onClick={() => timer.nudge(15)} aria-label="Add 15 seconds to rest timer">+15s</Button>
        <Button variant="ghost" size="sm" onClick={timer.stop} aria-label="Close rest timer"><Icon name="close" size={14} /></Button>
      </div>
    </Card>
  );
}

/* ======================== exercise substitute modal ======================= */

function SubstituteModal({ open, exercise, onClose, onSelect }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const { handleError } = useStore();

  useEffect(() => {
    if (!open || !exercise) {
      setData(null);
      return;
    }
    setLoading(true);
    api.training.substitutes(exercise.exercise_id || exercise.id)
      .then(setData)
      .catch((e) => handleError(e, 'Could not find substitutes.'))
      .finally(() => setLoading(false));
  }, [open, exercise, handleError]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Biomechanical substitutes"
      subtitle={exercise ? `Alternatives for ${exercise.exercise_name || exercise.name}` : ''}
      wide
    >
      <div className="stack gap-12">
        {loading && <Skeleton h={100} />}
        {data && (
          <div className="chip chip-teal small" style={{ alignSelf: 'flex-start' }}>
            Matching movement: <b>{titleCase(data.pattern || 'movement')}</b> · Focus: <b>{data.primary_muscle || 'muscle'}</b>
          </div>
        )}
        <div className="stack gap-8" style={{ maxHeight: '48vh', overflowY: 'auto' }}>
          {(data?.substitutes || []).map((sub) => (
            <div key={sub.id} className="ex-row row-between" style={{ alignItems: 'center' }}>
              <div className="flex-1">
                <div className="ex-name">{sub.name}</div>
                <div className="ex-meta">
                  <span>{sub.muscles?.join(' · ')}</span>
                  <span>{titleCase(sub.equipment)}</span>
                  {sub.compound ? <Chip tone="ember" className="tiny">Compound</Chip> : null}
                  {sub.is_custom ? <Chip tone="amber" className="tiny">Custom</Chip> : null}
                </div>
              </div>
              <Button variant="ember" size="sm" onClick={() => onSelect(sub)}>
                <Icon name="check" size={13} /> Select
              </Button>
            </div>
          ))}
          {data && !data.substitutes?.length && (
            <Empty>No direct biomechanical alternatives found in the library.</Empty>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ======================= ai exercise coaching modal ======================= */

function ExerciseGuideModal({ open, exercise, onClose, onAddWarmupSets }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('cues');
  const { handleError, toast } = useStore();

  useEffect(() => {
    if (!open || !exercise) {
      setData(null);
      return;
    }
    setLoading(true);
    const exId = exercise.exercise_id || exercise.id || exercise.name;
    const workingWeight = exercise.last?.weight_kg || exercise.weight_kg || (exercise.sets?.[0]?.weight_kg) || 60;
    const reps = exercise.target_reps || exercise.reps || (exercise.sets?.[0]?.reps) || 8;
    api.ai.exerciseGuide(exId, { workingWeight, reps })
      .then((res) => {
        setData(res);
      })
      .catch((e) => handleError(e, 'Could not fetch exercise coaching guide.'))
      .finally(() => setLoading(false));
  }, [open, exercise, handleError]);

  const exName = exercise?.exercise_name || exercise?.name || 'Exercise';
  const guide = data?.guide;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${exName} · AI Coaching Guide`}
      subtitle={data?.source ? `Powered by ${data.source === 'groq-lpu' ? 'Groq LPU Biomechanics' : 'Deterministic Engine'}` : 'Biomechanical cues & warm-up progression'}
      wide
    >
      <div className="stack gap-14">
        {loading && (
          <div className="stack gap-12">
            <Skeleton h={38} r={10} />
            <Skeleton h={160} r={14} />
          </div>
        )}

        {guide && (
          <>
            <Segmented
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: 'cues', label: 'Form & Cues' },
                { value: 'warmup', label: 'Warm-up Sets' },
                { value: 'mistakes', label: 'Faults & Fixes' },
                { value: 'substitutes', label: 'Substitutes' },
              ]}
            />

            {activeTab === 'cues' && (
              <div className="stack gap-14">
                <div className="stack gap-8">
                  <div className="eyebrow" style={{ color: 'var(--teal)' }}>Setup & Positioning</div>
                  <div className="stack gap-6">
                    {(guide.setup_cues || []).map((cue, idx) => (
                      <div key={idx} className="row gap-10 small" style={{ alignItems: 'flex-start' }}>
                        <span className="mono strong tiny" style={{ background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 6, minWidth: 24, textAlign: 'center' }}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 muted" style={{ lineHeight: 1.6 }}>{cue}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="stack gap-8">
                  <div className="eyebrow" style={{ color: 'var(--ember)' }}>Execution & Bar Path</div>
                  <div className="stack gap-6">
                    {(guide.execution_cues || []).map((cue, idx) => (
                      <div key={idx} className="row gap-10 small" style={{ alignItems: 'flex-start' }}>
                        <Icon name="spark" size={13} style={{ color: 'var(--ember)', marginTop: 3 }} />
                        <span className="flex-1 muted" style={{ lineHeight: 1.6 }}>{cue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'warmup' && (
              <div className="stack gap-12">
                <div className="row-between" style={{ alignItems: 'center' }}>
                  <span className="eyebrow">Calculated Pyramid Warm-up</span>
                  <span className="tiny muted">Prepares joints & neuromuscular pathways without metabolic fatigue</span>
                </div>

                <div className="stack gap-8">
                  {(guide.warmup_protocol || guide.warmup_sets || []).map((w, idx) => (
                    <div key={idx} className="row-between" style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
                      <div className="row gap-12" style={{ alignItems: 'center' }}>
                        <span className="mono strong" style={{ fontSize: '0.95rem', color: 'var(--teal)' }}>Set {w.set || idx + 1}</span>
                        <span className="mono strong">{w.weight_kg ? `${w.weight_kg} kg` : w.weight || 'Moderate load'} × {w.reps || 5} reps</span>
                      </div>
                      <span className="tiny muted" style={{ maxWidth: '45ch', textAlign: 'right' }}>{w.purpose || w.note || 'Warm-up primer'}</span>
                    </div>
                  ))}
                </div>

                {guide.safety_cue && (
                  <div className="chip chip-warn small" style={{ marginTop: 4 }}>
                    <Icon name="bolt" size={13} style={{ marginRight: 4 }} />
                    {guide.safety_cue}
                  </div>
                )}

                {onAddWarmupSets && (guide.warmup_protocol || guide.warmup_sets)?.length > 0 && (
                  <Button
                    variant="ember"
                    size="sm"
                    onClick={() => {
                      const sets = (guide.warmup_protocol || guide.warmup_sets || []).map((w, idx) => {
                        const parsedWeight = w.weight_kg || parseFloat(String(w.weight || '').replace(/[^0-9.]/g, '')) || 20;
                        const parsedReps = parseInt(String(w.reps || '').replace(/[^0-9]/g, ''), 10) || 5;
                        return { set_number: idx + 1, weight_kg: parsedWeight, reps: parsedReps, is_warmup: true };
                      });
                      onAddWarmupSets(sets);
                      toast(`Added ${sets.length} warm-up sets for ${exName}.`, 'ok');
                      onClose();
                    }}
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  >
                    <Icon name="plus" size={13} /> Add warm-up sets to session
                  </Button>
                )}
              </div>
            )}

            {activeTab === 'mistakes' && (
              <div className="stack gap-8">
                <span className="eyebrow" style={{ color: 'var(--ember)' }}>Common Faults & Correction</span>
                <div className="stack gap-8">
                  {(guide.common_mistakes || []).map((m, idx) => (
                    <div key={idx} className="row gap-10 small" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
                      <Icon name="bolt" size={14} style={{ color: 'var(--amber)', marginTop: 2 }} />
                      <span className="flex-1 muted" style={{ lineHeight: 1.55 }}>{m}</span>
                    </div>
                  ))}
                </div>
                {guide.safety_cue && (
                  <div className="chip chip-warn small" style={{ marginTop: 6 }}>
                    <Icon name="bolt" size={12} style={{ marginRight: 4 }} />
                    {guide.safety_cue}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'substitutes' && (
              <div className="stack gap-8">
                <span className="eyebrow">Biomechanical Equivalents</span>
                <div className="stack gap-8">
                  {(guide.smart_substitutes || guide.substitutions || []).map((sub, idx) => {
                    const subName = typeof sub === 'string' ? sub : sub.name;
                    const subReason = typeof sub === 'string' ? 'Direct biomechanical alternative targeting identical motor recruitment and prime movers.' : (sub.reason || sub.notes);
                    return (
                      <div key={idx} className="stack gap-4" style={{ padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
                        <div className="strong small" style={{ color: 'var(--teal)' }}>{subName}</div>
                        <div className="tiny muted" style={{ lineHeight: 1.55 }}>{subReason}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ============================ session logger ============================== */

function SessionLogger({ session, history = [], onClose, onSaved }) {
  const { handleError, toast } = useStore();
  const timer = useRestTimer(() => toast('Rest done — next set.', 'ok', 2600));
  const startedAt = useRef(Date.now());
  const historyMap = useMemo(() => buildLastPerformanceMap(history), [history]);
  const [name, setName] = useState(session?.title || 'Workout');
  const [notes, setNotes] = useState('');
  const [rpe, setRpe] = useState('');
  const [subRowIdx, setSubRowIdx] = useState(null);
  const [guideRowIdx, setGuideRowIdx] = useState(null);
  const [rows, setRows] = useState(() =>
    (session?.exercises || []).map((ex) => {
      const last = session?.last_performance?.[ex.exercise_id] || historyMap[ex.exercise_id] || null;
      return {
        exercise_id: ex.exercise_id,
        exercise_name: ex.name,
        rest_s: ex.rest_s || 90,
        target_reps: ex.reps || '8-12',
        last,
        sets: Array.from({ length: ex.sets || 3 }, (_, i) => ({
          set_number: i + 1,
          reps: last?.reps ?? repMid(ex.reps) ?? 8,
          weight_kg: last?.weight_kg ?? 0,
          rpe: '',
          done: false,
        })),
      };
    })
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
    const last = historyMap[ex.id] || null;
    setRows((rs) => [...rs, {
      exercise_id: ex.id,
      exercise_name: ex.name,
      rest_s: 90,
      target_reps: '8-12',
      last,
      sets: [{
        set_number: 1,
        reps: last?.reps ?? 10,
        weight_kg: last?.weight_kg ?? 0,
        rpe: '',
        done: false,
      }],
    }]);
    setPickerOpen(false);
  };

  const swapRowExercise = (newEx) => {
    if (subRowIdx === null) return;
    const last = historyMap[newEx.id] || null;
    setRows((rs) => rs.map((r, i) => i !== subRowIdx ? r : {
      ...r,
      exercise_id: newEx.id,
      exercise_name: newEx.name,
      last,
      sets: r.sets.map((s) => ({
        ...s,
        weight_kg: last?.weight_kg ?? s.weight_kg,
        reps: last?.reps ?? s.reps,
      })),
    }));
    toast(`Swapped to ${newEx.name}.`, 'ok');
    setSubRowIdx(null);
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
      is_warmup: Number(s.weight_kg) === 0 && Number(s.reps) > 0 ? 1 : 0,
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
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Workout name" className="strong" style={{ fontSize: '1.05rem' }} />
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
              <Button variant="soft" size="sm" onClick={() => setGuideRowIdx(ri)} aria-label="AI coaching cues and warmup" title="AI coaching cues, warmup pyramid, and biomechanics"><Icon name="spark" size={13} /> AI Guide</Button>
              <Button variant="ghost" size="sm" onClick={() => setSubRowIdx(ri)} aria-label="Swap exercise" title="Find biomechanical substitutes"><Icon name="refresh" size={13} /> Swap</Button>
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
                <tr>
                  <th style={{ width: 40 }} scope="col">#</th>
                  <th scope="col">Weight (kg)</th>
                  <th scope="col">Reps</th>
                  <th scope="col">RPE</th>
                  <th style={{ width: 92 }} scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {row.sets.map((s, si) => (
                  <tr key={si}>
                    <td className="set-num">{si + 1}</td>
                    <td><Input className={`set-input ${s.done ? 'set-done' : ''}`} type="number" min="0" step="0.5" value={s.weight_kg}
                      onChange={(e) => updateSet(ri, si, { weight_kg: e.target.value })} disabled={s.done} aria-label={`${row.exercise_name} set ${si + 1} weight (kg)`} /></td>
                    <td><Input className={`set-input ${s.done ? 'set-done' : ''}`} type="number" min="0" max="100" value={s.reps}
                      onChange={(e) => updateSet(ri, si, { reps: e.target.value })} disabled={s.done} aria-label={`${row.exercise_name} set ${si + 1} reps`} /></td>
                    <td><Input className="set-input" type="number" min="1" max="10" step="0.5" placeholder="—" value={s.rpe}
                      onChange={(e) => updateSet(ri, si, { rpe: e.target.value })} disabled={s.done} aria-label={`${row.exercise_name} set ${si + 1} rpe`} /></td>
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
      <SubstituteModal
        open={subRowIdx !== null}
        exercise={subRowIdx !== null ? rows[subRowIdx] : null}
        onClose={() => setSubRowIdx(null)}
        onSelect={swapRowExercise}
      />
      <ExerciseGuideModal
        open={guideRowIdx !== null}
        exercise={guideRowIdx !== null ? rows[guideRowIdx] : null}
        onClose={() => setGuideRowIdx(null)}
        onAddWarmupSets={(warmups) => {
          if (guideRowIdx === null) return;
          setRows((rs) => rs.map((r, i) => {
            if (i !== guideRowIdx) return r;
            const newSets = warmups.map((w, idx) => ({
              set_number: idx + 1,
              weight_kg: w.weight_kg,
              reps: w.reps,
              rpe: '',
              is_warmup: true,
              done: false,
            }));
            return { ...r, sets: [...newSets, ...r.sets] };
          }));
        }}
      />
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
  const [modalTab, setModalTab] = useState('library');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [equipment, setEquipment] = useState('');
  const [data, setData] = useState(null);
  const [customForm, setCustomForm] = useState({
    name: '',
    primary_muscle: 'chest',
    pattern: 'horizontal_push',
    equipment: 'barbell',
    secondary_muscles: '',
    compound: true,
  });
  const [savingCustom, setSavingCustom] = useState(false);
  const { handleError, toast } = useStore();

  useEffect(() => {
    if (!open) {
      setModalTab('library');
      return;
    }
    const t = setTimeout(() => {
      api.training.exercises({ q: q || undefined, category: category || undefined, equipment: equipment || undefined })
        .then(setData)
        .catch((e) => handleError(e, 'Could not load the exercise library.'));
    }, 180);
    return () => clearTimeout(t);
  }, [open, q, category, equipment, handleError]);

  const saveCustom = async () => {
    if (!customForm.name.trim()) return toast('Please enter an exercise name.', 'warn');
    setSavingCustom(true);
    try {
      const payload = {
        name: customForm.name.trim(),
        primary_muscle: customForm.primary_muscle,
        pattern: customForm.pattern,
        equipment: customForm.equipment,
        secondary_muscles: customForm.secondary_muscles
          ? customForm.secondary_muscles.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
          : [],
        compound: Boolean(customForm.compound),
      };
      const created = await api.training.createCustomExercise(payload);
      toast(`Created custom exercise “${payload.name}”.`, 'ok');
      setCustomForm({
        name: '',
        primary_muscle: 'chest',
        pattern: 'horizontal_push',
        equipment: 'barbell',
        secondary_muscles: '',
        compound: true,
      });
      setModalTab('library');
      onPick(created.exercise);
    } catch (err) {
      handleError(err, 'Failed to create custom exercise.');
    } finally {
      setSavingCustom(false);
    }
    return undefined;
  };

  return (
    <Modal open={open} onClose={onClose} title="Exercise library" subtitle={modalTab === 'custom' ? 'Add your own custom movement' : (data ? `${data.count} matches` : 'Searching…')} wide>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Segmented
          value={modalTab}
          onChange={setModalTab}
          options={[
            { value: 'library', label: 'Exercise Library' },
            { value: 'custom', label: '+ Create Custom Exercise' },
          ]}
        />
      </div>

      {modalTab === 'custom' ? (
        <form onSubmit={(e) => { e.preventDefault(); saveCustom(); }} className="stack gap-12">
          <Field label="Exercise name" hint="required">
            <Input
              value={customForm.name}
              onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
              placeholder="e.g. Belt Squat, Neutral Grip DB Press"
              required
            />
          </Field>
          <div className="grid grid-3">
            <Field label="Movement pattern">
              <SelectMenu
                value={customForm.pattern}
                onChange={(val) => setCustomForm({ ...customForm, pattern: val })}
                options={[
                  { value: 'squat', label: 'Squat' },
                  { value: 'hinge', label: 'Hinge' },
                  { value: 'horizontal_push', label: 'Horizontal Push' },
                  { value: 'horizontal_pull', label: 'Horizontal Pull' },
                  { value: 'vertical_push', label: 'Vertical Push' },
                  { value: 'vertical_pull', label: 'Vertical Pull' },
                  { value: 'isolation', label: 'Isolation' },
                  { value: 'core', label: 'Core' },
                  { value: 'carry', label: 'Carry' },
                ]}
              />
            </Field>
            <Field label="Primary muscle">
              <SelectMenu
                value={customForm.primary_muscle}
                onChange={(val) => setCustomForm({ ...customForm, primary_muscle: val })}
                options={[
                  { value: 'chest', label: 'Chest' },
                  { value: 'back', label: 'Back' },
                  { value: 'quadriceps', label: 'Quadriceps' },
                  { value: 'hamstrings', label: 'Hamstrings' },
                  { value: 'glutes', label: 'Glutes' },
                  { value: 'shoulders', label: 'Shoulders' },
                  { value: 'biceps', label: 'Biceps' },
                  { value: 'triceps', label: 'Triceps' },
                  { value: 'core', label: 'Core' },
                  { value: 'calves', label: 'Calves' },
                  { value: 'full_body', label: 'Full Body' },
                ]}
              />
            </Field>
            <Field label="Equipment">
              <SelectMenu
                value={customForm.equipment}
                onChange={(val) => setCustomForm({ ...customForm, equipment: val })}
                options={[
                  { value: 'barbell', label: 'Barbell' },
                  { value: 'dumbbell', label: 'Dumbbell' },
                  { value: 'cable', label: 'Cable' },
                  { value: 'machine', label: 'Machine' },
                  { value: 'bodyweight', label: 'Bodyweight' },
                  { value: 'band', label: 'Band' },
                  { value: 'smith', label: 'Smith Machine' },
                ]}
              />
            </Field>
          </div>
          <div className="grid grid-2">
            <Field label="Secondary muscles" hint="optional, comma separated">
              <Input
                value={customForm.secondary_muscles}
                onChange={(e) => setCustomForm({ ...customForm, secondary_muscles: e.target.value })}
                placeholder="e.g. triceps, shoulders"
              />
            </Field>
            <Field label="Movement type">
              <SelectMenu
                value={customForm.compound ? 'compound' : 'isolation'}
                onChange={(val) => setCustomForm({ ...customForm, compound: val === 'compound' })}
                options={[
                  { value: 'compound', label: 'Compound movement' },
                  { value: 'isolation', label: 'Isolation movement' },
                ]}
              />
            </Field>
          </div>
          <div className="row gap-10" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <Button type="button" variant="ghost" onClick={() => setModalTab('library')}>Cancel</Button>
            <Button type="submit" variant="ember" loading={savingCustom} disabled={savingCustom}>
              <Icon name="check" size={15} /> Save & Add Exercise
            </Button>
          </div>
        </form>
      ) : (
        <>
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
                  <div className="ex-name">
                    {ex.name}
                    {ex.is_custom && <Chip tone="amber" className="tiny" style={{ marginLeft: 6, fontSize: '0.65rem' }}>Custom</Chip>}
                  </div>
                  <div className="ex-meta">
                    <span>{ex.muscles?.join(' · ')}</span>
                    <span>{titleCase(ex.equipment)}</span>
                    <span>{titleCase(ex.level || 'all')}</span>
                  </div>
                </div>
                <Chip tone={ex.compound ? 'ember' : 'ghost'}>{ex.compound ? 'compound' : ex.pattern}</Chip>
              </button>
            ))}
            {data && !data.exercises.length && <Empty>No exercises match those filters. Click “+ Create Custom Exercise” to add it.</Empty>}
          </div>
        </>
      )}
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
  const [planSwapTarget, setPlanSwapTarget] = useState(null);
  const [planGuideExercise, setPlanGuideExercise] = useState(null);
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

  const swapPlanExercise = (newEx) => {
    if (!planSwapTarget || !plan) return;
    const { exerciseIndex } = planSwapTarget;
    setPlan((p) => {
      if (!p?.schedule?.[activeDay]?.exercises) return p;
      const updatedExercises = [...p.schedule[activeDay].exercises];
      const cur = updatedExercises[exerciseIndex];
      updatedExercises[exerciseIndex] = {
        ...cur,
        exercise_id: newEx.id,
        name: newEx.name,
        muscles: newEx.muscles || cur.muscles,
        swap_reason: `Athlete swap: ${newEx.name}`,
      };
      const updatedSchedule = [...p.schedule];
      updatedSchedule[activeDay] = { ...updatedSchedule[activeDay], exercises: updatedExercises };
      return { ...p, schedule: updatedSchedule };
    });
    toast(`Swapped to ${newEx.name} in plan.`, 'ok');
    setPlanSwapTarget(null);
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
                    Nothing generated yet. Generate your customized, evidence-based training split with a single tap.
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
                            <div className="row gap-6">
                              <Button
                                variant="soft"
                                size="sm"
                                onClick={() => setPlanGuideExercise(ex)}
                                title="AI coaching cues, biomechanics and warmup pyramid"
                              >
                                <Icon name="spark" size={13} /> AI Guide
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPlanSwapTarget({ exerciseIndex: i, exercise: ex })}
                                title="Swap this exercise with a biomechanical substitute"
                              >
                                <Icon name="refresh" size={13} /> Swap
                              </Button>
                              <Chip tone={ex.role === 'primary' ? 'ember' : ex.role === 'conditioning' ? 'teal' : 'ghost'}>{ex.role}</Chip>
                            </div>
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
              history={history}
              onClose={() => { setSession(null); setTab('plan'); }}
              onSaved={() => { setSession(null); load(); }}
            />
          ) : (
            <Card solid>
              <Empty
                icon="dumbbell"
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
            {!history.length && <Card solid><Empty icon="dumbbell" title="No sessions logged yet">Finish a session in the Log tab and it lands here with every set.</Empty></Card>}
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
      <SubstituteModal
        open={Boolean(planSwapTarget)}
        exercise={planSwapTarget?.exercise}
        onClose={() => setPlanSwapTarget(null)}
        onSelect={swapPlanExercise}
      />
      <ExerciseGuideModal
        open={Boolean(planGuideExercise)}
        exercise={planGuideExercise}
        onClose={() => setPlanGuideExercise(null)}
      />
    </div>
  );
}
