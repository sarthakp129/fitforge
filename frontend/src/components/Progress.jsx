import React, { useCallback, useEffect, useState } from 'react';
import useStore from '../store/useStore.js';
import api, { downloadCsv } from '../lib/api.js';
import { nf, compact, signed, fmtDate, todayISO, titleCase } from '../lib/format.js';
import { Card, CardHead, Button, Chip, Icon, Field, Input, Empty, Reveal, Skeleton, Segmented } from './ui.jsx';
import { LineChart, BarChart, Heatmap, MuscleBars, Sparkline } from './Charts.jsx';

export default function Progress() {
  const { handleError, toast, refreshProfile } = useStore();
  const [metrics, setMetrics] = useState(null);
  const [overview, setOverview] = useState(null);
  const [prs, setPrs] = useState(null);
  const [heat, setHeat] = useState(null);
  const [muscles, setMuscles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weighIn, setWeighIn] = useState({ date: todayISO(), weight_kg: '', body_fat_pct: '', waist_cm: '' });
  const [range, setRange] = useState({ volume: 12, muscles: 28, heat: 26 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, o, p, h, mu] = await Promise.all([
        api.progress.metrics(180).catch(() => null),
        api.progress.overview().catch(() => null),
        api.progress.prs().catch(() => null),
        api.progress.heatmap(range.heat).catch(() => null),
        api.progress.muscles(range.muscles).catch(() => null),
      ]);
      setMetrics(m); setOverview(o); setPrs(p); setHeat(h); setMuscles(mu);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [handleError, range.heat, range.muscles]);

  useEffect(() => { load(); }, [load]);

  const addMetric = async (e) => {
    e.preventDefault();
    const payload = { date: weighIn.date };
    if (weighIn.weight_kg !== '') payload.weight_kg = Number(weighIn.weight_kg);
    if (weighIn.body_fat_pct !== '') payload.body_fat_pct = Number(weighIn.body_fat_pct);
    if (weighIn.waist_cm !== '') payload.waist_cm = Number(weighIn.waist_cm);
    if (Object.keys(payload).length === 1) return toast('Enter at least one measurement.', 'warn');
    try {
      await api.progress.addMetric(payload);
      setWeighIn({ date: todayISO(), weight_kg: '', body_fat_pct: '', waist_cm: '' });
      toast('Measurement saved.', 'ok', 2200);
      await load();
      await refreshProfile();
    } catch (err) { handleError(err); }
    return undefined;
  };

  const removeMetric = async (id) => {
    try { await api.progress.removeMetric(id); load(); } catch (err) { handleError(err); }
  };

  const exportJson = async () => {
    try {
      const data = await api.progress.exportJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitforge-backup-${todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup downloaded.', 'ok', 2400);
    } catch (err) { handleError(err); }
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await api.progress.importJson(data);
      toast(`Imported ${res.counts.workouts} workouts, ${res.counts.nutrition} meals, ${res.counts.metrics} weigh-ins.`, 'ok', 5200);
      load();
    } catch (err) {
      handleError(err, 'That file is not a FitForge export.');
    }
  };

  if (loading) {
    return (
      <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
        <div className="wrap stack gap-16"><Skeleton h={34} w={240} /><Skeleton h={280} r={18} /><Skeleton h={220} r={18} /></div>
      </div>
    );
  }

  const weightSeries = (metrics?.series || []).filter((m) => m.weight_kg).map((m) => ({ date: m.date, value: m.weight_kg }));
  const bfSeries = (metrics?.series || []).filter((m) => m.body_fat_pct).map((m) => ({ date: m.date, value: m.body_fat_pct }));
  const volumeSeries = overview?.weekly_volume || [];
  const h = overview?.headline || {};
  const lifts = prs?.lifts || {};
  const big3 = (lifts.squat || 0) + (lifts.bench || 0) + (lifts.deadlift || 0);

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <Reveal>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div className="eyebrow">Progress</div>
              <h1 style={{ fontSize: 'clamp(1.8rem,3.6vw,2.4rem)', marginTop: 6 }}>The receipts.</h1>
              <p className="small muted" style={{ marginTop: 8, maxWidth: '62ch' }}>
                {nf(h.total_sessions || 0)} sessions · {compact(h.total_minutes || 0)} minutes · {big3 ? `${nf(big3)} kg estimated big-three total` : 'log a squat, bench and deadlift to see your total'}.
              </p>
            </div>
            <div className="row gap-8">
              <Button variant="ghost" size="sm" onClick={exportJson}><Icon name="download" size={14} /> Export JSON</Button>
              <Button variant="ghost" size="sm" onClick={() => downloadCsv().catch((e) => handleError(e))}><Icon name="download" size={14} /> CSV</Button>
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                <Icon name="refresh" size={14} /> Import
                <input type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        </Reveal>

        {/* ------------------------------ bodyweight ------------------------ */}
        <div className="grid grid-side">
          <Reveal>
            <Card solid className="stack gap-12">
              <CardHead
                eyebrow="Bodyweight"
                title="Trend, 180 days"
                subtitle={metrics?.summary ? `${nf(metrics.summary.latest, 1)} kg latest · ${signed(metrics.summary.change, 1)} kg across the series · avg ${nf(metrics.summary.avg, 1)}` : 'No weigh-ins yet.'}
                right={<Sparkline values={weightSeries.map((w) => w.value)} width={86} height={26} color="var(--teal)" />}
              />
              <LineChart data={weightSeries} color="var(--teal)" unit=" kg" yDigits={1} height={210} emptyLabel="Log two weigh-ins to see the trend line." />
              {bfSeries.length > 1 && (
                <>
                  <div className="divider" />
                  <div className="eyebrow">Body fat %</div>
                  <LineChart data={bfSeries} color="var(--violet)" unit=" %" yDigits={1} height={130} />
                </>
              )}
            </Card>
          </Reveal>

          <Reveal delay={70}>
            <Card solid className="stack gap-12">
              <CardHead eyebrow="Log" title="Add a measurement" subtitle="Same conditions every time: morning, after the bathroom, before food." />
              <form onSubmit={addMetric} className="stack gap-10">
                <Field label="Date"><Input type="date" max={todayISO()} value={weighIn.date} onChange={(e) => setWeighIn({ ...weighIn, date: e.target.value })} /></Field>
                <div className="grid grid-3">
                  <Field label="Weight kg"><Input className="input-num" type="number" step="0.1" min="30" max="300" value={weighIn.weight_kg} onChange={(e) => setWeighIn({ ...weighIn, weight_kg: e.target.value })} placeholder="82.4" /></Field>
                  <Field label="Body fat %"><Input className="input-num" type="number" step="0.1" min="3" max="60" value={weighIn.body_fat_pct} onChange={(e) => setWeighIn({ ...weighIn, body_fat_pct: e.target.value })} placeholder="16.5" /></Field>
                  <Field label="Waist cm"><Input className="input-num" type="number" step="0.5" min="40" max="200" value={weighIn.waist_cm} onChange={(e) => setWeighIn({ ...weighIn, waist_cm: e.target.value })} placeholder="84" /></Field>
                </div>
                <Button type="submit" variant="ember" block><Icon name="check" size={15} /> Save measurement</Button>
              </form>
              <div className="divider" />
              <div className="stack gap-6" style={{ maxHeight: 190, overflowY: 'auto' }}>
                {(metrics?.series || []).slice().reverse().map((m) => (
                  <div key={m.id} className="row-between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                    <span className="muted tiny">{fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="mono strong">
                      {m.weight_kg ? `${nf(m.weight_kg, 1)} kg` : ''}
                      {m.body_fat_pct ? ` · ${nf(m.body_fat_pct, 1)}%` : ''}
                      {m.waist_cm ? ` · ${nf(m.waist_cm, 0)} cm` : ''}
                    </span>
                    <Button variant="icon" size="sm" onClick={() => removeMetric(m.id)} aria-label="Delete"><Icon name="close" size={13} /></Button>
                  </div>
                ))}
                {!metrics?.series?.length && <div className="tiny muted">Nothing logged yet.</div>}
              </div>
            </Card>
          </Reveal>
        </div>

        {/* ------------------------------- volume --------------------------- */}
        <div className="grid grid-2">
          <Reveal>
            <Card solid className="stack gap-12">
              <CardHead
                eyebrow="Training load"
                title="Weekly volume"
                subtitle={`Tonnage per week (reps × load), warm-ups excluded. ${h.volume_delta_pct != null ? `${signed(h.volume_delta_pct)}% vs last week.` : ''}`}
                right={
                  <Segmented size="sm" value={String(range.volume)} onChange={(v) => setRange((r) => ({ ...r, volume: Number(v) }))} options={[
                    { value: '8', label: '8w' }, { value: '12', label: '12w' }, { value: '26', label: '26w' },
                  ]}
                />
                }
              />
              <BarChart
                data={volumeSeries.slice(-range.volume).map((v) => ({ label: v.week.slice(5), value: v.volume_kg || 0 }))}
                color="var(--ember)" height={190}
              />
              <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                <Chip tone="ember">{compact(h.volume_this_week_kg || 0)} kg this week</Chip>
                <Chip>{nf(h.sets_last_14d || 0)} hard sets / 14d</Chip>
                <Chip tone="ok">{h.streak || 0}-day streak</Chip>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={70}>
            <Card solid className="stack gap-12">
              <CardHead
                eyebrow="Balance"
                title="Muscle-group volume"
                subtitle={`Last ${range.muscles} days. Gaps here are where your next block should go.`}
                right={
                  <Segmented size="sm" value={String(range.muscles)} onChange={(v) => setRange((r) => ({ ...r, muscles: Number(v) }))} options={[
                    { value: '14', label: '14d' }, { value: '28', label: '28d' }, { value: '90', label: '90d' },
                  ]}
                />
                }
              />
              <MuscleBars muscles={muscles?.muscles || []} max={9} />
            </Card>
          </Reveal>
        </div>

        {/* -------------------------------- PRs ----------------------------- */}
        <Reveal>
          <Card solid className="stack gap-12">
            <CardHead eyebrow="Strength" title="Personal records" subtitle="Heaviest load and estimated 1RM (Epley) per lift." />
            {!prs?.prs?.length && <Empty icon="◇" title="No weighted sets logged yet">Log a session with real load and your PRs appear here.</Empty>}
            {prs?.prs?.length > 0 && (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Lift</th><th className="table-num">Top set</th><th className="table-num">Best reps</th><th className="table-num">Est. 1RM</th><th className="table-num">Lifetime sets</th></tr></thead>
                  <tbody>
                    {prs.prs.map((p) => (
                      <tr key={p.exercise_id}>
                        <td className="strong">{p.exercise_name}</td>
                        <td className="table-num">{nf(p.top_kg, 1)} kg</td>
                        <td className="table-num">{p.best_reps}</td>
                        <td className="table-num" style={{ color: 'var(--ember)', fontWeight: 700 }}>{p.est_1rm ? `${nf(p.est_1rm, 1)} kg` : '—'}</td>
                        <td className="table-num muted">{p.lifetime_sets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              {Object.entries(lifts).filter(([, v]) => v).map(([k, v]) => (
                <Chip key={k} tone="teal">{titleCase(k)} <span className="mono">{nf(v, 1)} kg</span></Chip>
              ))}
            </div>
          </Card>
        </Reveal>

        {/* ------------------------------ heatmap --------------------------- */}
        <Reveal>
          <Card solid className="stack gap-12">
            <CardHead
              eyebrow="Consistency"
              title="Training & logging calendar"
              subtitle="Darker means more sessions. Logging food counts as a light day."
              right={
                <Segmented size="sm" value={String(range.heat)} onChange={(v) => setRange((r) => ({ ...r, heat: Number(v) }))} options={[
                  { value: '12', label: '12w' }, { value: '26', label: '26w' }, { value: '52', label: '52w' },
                ]}
              />
              }
            />
            <Heatmap cells={heat?.cells || []} weeks={range.heat} />
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
