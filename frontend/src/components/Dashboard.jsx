import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import {
  nf, compact, signed, pct, todayISO, relativeDay, fmtDate, durationLabel,
  goalLabel, sourceChip, titleCase,
} from '../lib/format.js';
import {
  Card, CardHead, Button, Chip, Icon, SingleRing, Stat, Bar, Reveal, Empty, Skeleton, Modal, Input,
} from './ui.jsx';
import { Heatmap, Sparkline } from './Charts.jsx';

// macro colours come from tokens so both themes stay consistent


export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, derived, user, handleError, refreshAiStatus, toast, setCoachOpen, setCmdOpen } = useStore();
  const [stats, setStats] = useState(null);
  const [daily, setDaily] = useState(null);
  const [next, setNext] = useState(null);
  const [insight, setInsight] = useState(null);
  const [heat, setHeat] = useState(null);
  const [weight, setWeight] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weighModalOpen, setWeighModalOpen] = useState(false);
  const [weighVal, setWeighVal] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);

  const macros = derived?.macros;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, n, h, m, ins] = await Promise.all([
        api.progress.overview().catch(() => null),
        api.nutrition.daily(todayISO()).catch(() => null),
        api.training.next(todayISO()).catch(() => null),
        api.progress.heatmap(12).catch(() => null),
        api.progress.metrics(60).catch(() => null),
        api.ai.insight().catch(() => null),
      ]);
      setStats(s); setDaily(d); setNext(n); setHeat(h);
      setWeight((m?.series || []).filter((x) => x.weight_kg).map((x) => ({ date: x.date, value: x.weight_kg })));
      setInsight(ins?.insight || null);
    } catch (err) {
      handleError(err, 'Could not load your dashboard.');
    } finally {
      setLoading(false);
      refreshAiStatus();
    }
  }, [handleError, refreshAiStatus]);

  useEffect(() => { load(); }, [load]);

  const headline = stats?.headline || {};
  const totals = daily?.totals || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const target = macros || { calories: 2200, protein_g: 150, carbs_g: 220, fat_g: 70 };
  const session = next?.session;
  const firstName = (user?.name || 'Athlete').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const openWeighIn = () => {
    setWeighVal(profile.weight_kg ? String(profile.weight_kg) : '');
    setWeighModalOpen(true);
  };

  const submitWeight = async (e) => {
    e?.preventDefault?.();
    const kg = Number(weighVal);
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) return toast('Enter a weight between 30 and 300 kg.', 'warn');
    setSavingWeight(true);
    try {
      await api.progress.addMetric({ date: todayISO(), weight_kg: kg });
      toast('Weigh-in logged.', 'ok', 2200);
      setWeighModalOpen(false);
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setSavingWeight(false);
    }
  };

  if (loading) {
    return (
      <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
        <div className="wrap stack gap-16">
          <Skeleton h={34} w={320} />
          <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} r={18} />)}</div>
          <Skeleton h={260} r={18} />
        </div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        {/* ------------------------------ header ---------------------------- */}
        <Reveal>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="eyebrow">{relativeDay(todayISO())} · {fmtDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              <h1 style={{ fontSize: 'clamp(1.9rem,4vw,2.7rem)', marginTop: 6 }}>{greeting}, {firstName}.</h1>
              <p className="small muted" style={{ marginTop: 8, maxWidth: '62ch' }}>
                {weekSentence(headline, stats)}
              </p>
            </div>
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              <Chip tone={goalTone(profile.goal)}>{goalLabel[profile.goal] || titleCase(profile.goal || 'recomp')}</Chip>
              <Chip>{profile.days_per_week || 4}× / week</Chip>
              <Chip>{titleCase(profile.experience || 'intermediate')}</Chip>
              <span
                className="chip chip-ghost row gap-6"
                title={`Sessions this week: ${headline.sessions || 0} of ${profile.days_per_week || 4} planned`}
                style={{ padding: '4px 10px 4px 6px', alignItems: 'center' }}
              >
                <SingleRing
                  value={headline.sessions || 0}
                  max={profile.days_per_week || 4}
                  size={26}
                  thickness={3.5}
                  color="var(--teal)"
                />
                <span className="mono tiny strong">{headline.sessions || 0}/{profile.days_per_week || 4}</span>
                <span className="tiny muted">sessions</span>
              </span>
              <Button variant="ghost" size="sm" onClick={openWeighIn}><Icon name="plus" size={14} /> Weigh-in</Button>
            </div>
          </div>
        </Reveal>

        {/* --------------------------- quick actions ------------------------ */}
        <Reveal delay={30}>
          <div className="quick-actions">
            <Button variant="ember" size="sm" onClick={() => navigate('/training')}>
              <Icon name="play" size={14} /> Start workout
            </Button>
            <Button variant="soft" size="sm" onClick={() => navigate('/nutrition')}>
              <Icon name="flame" size={14} /> Log meal
            </Button>
            <Button variant="ghost" size="sm" onClick={openWeighIn}>
              <Icon name="plus" size={14} /> Log weigh-in
            </Button>
            <Button variant="soft" size="sm" onClick={() => setCoachOpen(true)}>
              <Icon name="spark" size={14} /> Ask coach
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCmdOpen(true)} title="Press ⌘K or Ctrl+K anywhere" aria-label="Search (shortcut: Command K or Control K)">
              <Icon name="search" size={14} /> Search <span className="kbd" aria-hidden="true" style={{ fontSize: '0.72rem', marginLeft: 4 }}>⌘K</span>
            </Button>
          </div>
        </Reveal>

        {/* ------------------------------ tiles ----------------------------- */}
        <div className="grid grid-4">
          <Reveal delay={0}>
            <Stat
              label="Volume this week"
              value={compact(headline.volume_this_week_kg || 0)}
              unit="kg"
              tone="ember"
              icon={<Icon name="dumbbell" size={16} style={{ color: 'var(--ember)' }} />}
              sub={
                headline.volume_delta_pct != null
                  ? `${signed(headline.volume_delta_pct)}% vs last week (${compact(headline.volume_last_week_kg || 0)} kg)`
                  : `${headline.sessions || 0} session(s) logged`
              }
            />
          </Reveal>
          <Reveal delay={60}>
            <Stat
              label="Streak"
              value={stats?.streaks?.current || 0}
              unit={stats?.streaks?.current === 1 ? 'day' : 'days'}
              tone="ok"
              icon={
                <span className="flame" style={{ '--heat': Math.min(18, (stats?.streaks?.current || 0) * 2) }}>
                  <Icon name="flame" size={16} style={{ color: 'var(--ember)' }} />
                </span>
              }
              sub={`Longest ${stats?.streaks?.longest || 0} days · last session ${stats?.streaks?.last_session ? fmtDate(stats.streaks.last_session) : '—'}`}
            />
          </Reveal>
          <Reveal delay={120}>
            <Stat
              label="Bodyweight"
              value={headline.weight_latest ? nf(headline.weight_latest, 1) : '—'}
              unit="kg"
              tone="teal"
              icon={<Sparkline values={weight.map((w) => w.value)} color="var(--teal)" width={72} height={22} />}
              sub={
                weight.length > 1
                  ? `${signed(headline.weight_change_kg || 0, 1)} kg over ${weight.length} weigh-ins`
                  : 'Log a weigh-in to start the trend'
              }
            />
          </Reveal>
          <Reveal delay={180}>
            <Stat
              label="Energy today"
              value={nf(totals.calories)}
              unit={`/ ${nf(target.calories)} kcal`}
              icon={<Icon name="target" size={16} style={{ color: 'var(--violet)' }} />}
              sub={overUnder(totals, target)}
            />
          </Reveal>
        </div>

        {/* ------------------------- rings + session ------------------------ */}
        <div className="grid grid-side">
          <Reveal>
            <Card className="stack gap-16" solid>
              <CardHead
                eyebrow="Today"
                title={session ? session.title : 'No session scheduled'}
                subtitle={session ? `${relativeDay(todayISO())} · ${session.duration_min} min · ${session.exercises.length} exercises · ${session.working_sets} working sets` : 'Generate a plan to get a scheduled session.'}
                right={session && <Chip tone="ember">{next?.plan?.name || 'Plan'}</Chip>}
              />
              {session ? (
                <>
                  <div className="stack gap-10">
                    {session.exercises.slice(0, 5).map((ex) => {
                      const last = session.last_performance?.[ex.exercise_id];
                      return (
                        <div key={ex.exercise_id} className="ex-row">
                          <div>
                            <div className="ex-name">{ex.name}</div>
                            <div className="ex-meta">
                              <span><b>{ex.sets}</b> × <b>{ex.reps}</b></span>
                              <span>rest {ex.rest_s}s</span>
                              {ex.rpe && <span>RPE {ex.rpe}</span>}
                              {last && <span style={{ color: 'var(--teal)' }}>last {nf(last.weight_kg, 1)} kg × {last.reps}</span>}
                              {ex.swap_reason && <span style={{ color: 'var(--ember)' }}>swap: {ex.swap_reason}</span>}
                            </div>
                          </div>
                          <Chip>{ex.load || '—'}</Chip>
                        </div>
                      );
                    })}
                    {session.exercises.length > 5 && (
                      <div className="tiny muted">+ {session.exercises.length - 5} more exercise(s)</div>
                    )}
                  </div>
                  <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
                    <Button variant="ember" onClick={() => navigate('/training', { state: { session } })}>
                      <Icon name="play" size={15} /> Start session
                    </Button>
                    <Button variant="ghost" onClick={() => navigate('/training')}>Open training plan</Button>
                  </div>
                </>
              ) : (
                <Empty
                  icon="dumbbell"
                  title="No active plan yet"
                  action={<Button variant="ember" size="sm" onClick={() => navigate('/training')} style={{ marginTop: 10 }}>Generate my plan</Button>}
                >
                  One click builds a complete split from your profile — the AI personalises it if your key is configured.
                </Empty>
              )}
            </Card>
          </Reveal>

          <Reveal delay={80}>
            <Card className="stack gap-16" solid>
              <CardHead eyebrow="Nutrition" title="Today’s macros" right={<Chip>{pct(totals.calories, target.calories)}%</Chip>} />
              <div className="row" style={{ justifyContent: 'center' }}>
                <SingleRing
                  value={totals.calories}
                  max={target.calories}
                  size={172}
                  thickness={13}
                  color="var(--macro-calories)"
                  center={
                    <>
                      <div className="ring-value">{nf(totals.calories)}</div>
                      <div className="ring-label">of {nf(target.calories)} kcal</div>
                    </>
                  }
                />
              </div>
              <div className="stack gap-10">
                {[
                  ['Protein', totals.protein_g, target.protein_g, 'teal', 'g'],
                  ['Carbs', totals.carbs_g, target.carbs_g, 'violet', 'g'],
                  ['Fat', totals.fat_g, target.fat_g, 'amber', 'g'],
                ].map(([label, v, m, tone, u]) => (
                  <div key={label} className="row-between gap-12">
                    <span className="tiny strong" style={{ width: 58 }}>{label}</span>
                    <div className="flex-1"><Bar value={v} max={m} tone={tone} height={7} /></div>
                    <span className="tiny mono muted" style={{ width: 86, textAlign: 'right' }}>{nf(v, 0)} / {nf(m, 0)}{u}</span>
                  </div>
                ))}
              </div>
              <Button variant="soft" block onClick={() => navigate('/nutrition')}>
                Log food <Icon name="arrowRight" size={15} />
              </Button>
            </Card>
          </Reveal>
        </div>

        {/* --------------------------- insight + heat ----------------------- */}
        <div className="grid grid-side">
          <Reveal>
            <Card solid className="stack gap-16">
              <CardHead
                eyebrow="Consistency"
                title="Last 12 weeks"
                subtitle="Sessions and food logging, one square per day."
                right={<Chip tone="ghost"><Icon name="grid" size={13} /> heatmap</Chip>}
              />
              {heat?.cells?.length ? <Heatmap cells={heat.cells} weeks={12} /> : <Empty>No training days logged yet.</Empty>}
              <div className="grid grid-3 gap-12" style={{ paddingTop: 6 }}>
                {[
                  ['Sessions total', nf(headline.total_sessions || 0), `${nf(headline.total_minutes || 0)} min under the bar`],
                  ['Sets / 14 days', nf(headline.sets_last_14d || 0), 'hard sets, warm-ups excluded'],
                  ['Avg energy / 7d', headline.avg_kcal_7d ? `${nf(headline.avg_kcal_7d)} kcal` : '—', headline.avg_protein_7d ? `${nf(headline.avg_protein_7d)} g protein` : 'not logged yet'],
                ].map(([l, v, s]) => (
                  <div key={l} className="stack gap-4">
                    <span className="eyebrow">{l}</span>
                    <span className="mono strong" style={{ fontSize: '1.2rem' }}>{v}</span>
                    <span className="tiny muted">{s}</span>
                  </div>
                ))}
              </div>
            </Card>
          </Reveal>

          <Reveal delay={80}>
            <div className="stack gap-16">
              <Card solid className="stack gap-12">
                <CardHead
                  eyebrow="Coach read-out"
                  title="This week"
                  right={insight?.source && insight.source !== 'ai' ? <Chip tone="ghost">offline</Chip> : undefined}
                />
                <p className="small" style={{ lineHeight: 1.65 }}>{insight?.advice || 'Log a few sessions and the coach will read the week back to you.'}</p>
                {insight?.watch && <div className="chip chip-warn"><Icon name="bolt" size={13} /> {insight.watch}</div>}
                <Button variant="soft" size="sm" onClick={() => setCoachOpen(true)}>
                  Ask the coach <Icon name="arrowRight" size={14} />
                </Button>
              </Card>
            </div>
          </Reveal>
        </div>
      </div>

      {weighModalOpen && (
        <Modal
          open={weighModalOpen}
          onClose={() => setWeighModalOpen(false)}
          title="Log Bodyweight"
          subtitle="Record today's weigh-in to track your progress"
          footer={
            <>
              <Button variant="ghost" onClick={() => setWeighModalOpen(false)} disabled={savingWeight}>
                Cancel
              </Button>
              <Button variant="ember" onClick={submitWeight} loading={savingWeight} disabled={savingWeight || !weighVal}>
                Save weigh-in
              </Button>
            </>
          }
        >
          <form onSubmit={submitWeight} className="stack gap-12">
            <div className="field">
              <label className="label" htmlFor="dash-weigh-kg">Today's bodyweight (kg)</label>
              <Input
                id="dash-weigh-kg"
                type="number"
                step="0.1"
                min="30"
                max="300"
                value={weighVal}
                onChange={(e) => setWeighVal(e.target.value)}
                placeholder="e.g. 78.5"
                autoFocus
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** "340 kcal · 14 g protein left" when under, "120 kcal over" when over. */
function overUnder(totals, target) {
  const k = target.calories - totals.calories;
  const p = target.protein_g - totals.protein_g;
  const fmt = (v, unit) => `${nf(Math.abs(v))} ${unit} ${v >= 0 ? 'left' : 'over'}`;
  return `${fmt(k, 'kcal')} · ${fmt(p, 'g protein')}`;
}

/** Composes the header line from whatever data actually exists. */
function weekSentence(headline, stats) {
  const sessions = headline.total_sessions || 0;
  const parts = [];
  if (headline.sessions > 0) parts.push(`${headline.sessions} session(s) this week`);
  if (headline.volume_this_week_kg > 0) parts.push(`${compact(headline.volume_this_week_kg)} kg moved`);
  if (headline.streak > 0) parts.push(`${headline.streak}-day streak`);
  if (headline.weight_latest && Math.abs(headline.weight_change_kg || 0) > 0) {
    parts.push(`${signed(headline.weight_change_kg, 1)} kg bodyweight`);
  }
  if (!sessions) return 'New here? Generate a plan and log your first session — every number below wakes up.';
  if (!parts.length) return 'Rest day. Log a weigh-in or plan tomorrow’s meals.';
  return `${parts.join(' · ')}.`;
}

function goalTone(goal) {
  return { fat_loss: 'ember', muscle_gain: 'teal', strength: 'warn', recomp: 'teal' }[goal] || 'ghost';
}
