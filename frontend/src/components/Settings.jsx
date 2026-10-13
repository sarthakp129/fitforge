import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { nf, fmtDateTime, titleCase, activityLabel, equipmentLabel, goalLabel, dietLabel } from '../lib/format.js';
import { Card, CardHead, Button, Chip, Field, Input, Textarea, Icon, Reveal, Spinner, Segmented } from './ui.jsx';
import { SliderField, WheelPicker, TileGroup, PasswordInput } from './Controls.jsx';
import { dateForAge, ageFromDate } from '../lib/format.js';
import useScrollSpy from '../hooks/useScrollSpy.js';

const SECTIONS = [
  { id: 'sec-profile', label: 'Profile' },
  { id: 'sec-ai', label: 'AI & budget' },
  { id: 'sec-account', label: 'Account' },
];

export default function Settings() {
  const {
    profile, derived, options, saveProfile, handleError, toast, logout,
    aiStatus, refreshAiStatus, setBudget, user,
  } = useStore();

  const [form, setForm] = useState({ ...profile });
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState(null);
  const [budgetForm, setBudgetForm] = useState({ tokensPerMinute: '', requestsPerMinute: '', requestsPerDay: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  useEffect(() => { setForm({ ...profile }); }, [profile]);

  useEffect(() => {
    if (aiStatus?.budget) {
      setBudgetForm({
        tokensPerMinute: String(aiStatus.budget.tokensPerMinute || ''),
        requestsPerMinute: String(aiStatus.budget.requestsPerMinute || ''),
        requestsPerDay: String(aiStatus.budget.requestsPerDay || ''),
      });
    }
  }, [aiStatus?.budget?.tokensPerMinute, aiStatus?.budget?.requestsPerMinute, aiStatus?.budget?.requestsPerDay]);

  useEffect(() => {
    api.ai.usage(7).then(setUsage).catch(() => setUsage(null));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try { await saveProfile(form); }
    catch (err) { handleError(err, 'Could not save the profile.'); }
    finally { setSaving(false); }
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    try {
      const res = await api.ai.test();
      setTest({ ok: true, ...res });
      toast(`Groq reachable — ${res.model} answered in ${res.latencyMs} ms.`, 'ok');
      refreshAiStatus();
    } catch (err) {
      setTest({ ok: false, message: err.message, hint: err.body?.hint, status: err.status });
      handleError(err, 'The Groq test call failed.');
    } finally { setTesting(false); }
  };

  const loadModels = async () => {
    setModelsBusy(true);
    try {
      const res = await api.ai.models(true);
      setModels(res);
      if (res.error) toast(res.error, 'warn', 6000);
    } catch (err) { handleError(err, 'Could not list models.'); }
    finally { setModelsBusy(false); }
  };

  const applyBudget = async () => {
    try {
      await setBudget({
        tokensPerMinute: Number(budgetForm.tokensPerMinute) || undefined,
        requestsPerMinute: Number(budgetForm.requestsPerMinute) || undefined,
        requestsPerDay: Number(budgetForm.requestsPerDay) || undefined,
      });
    } catch (err) { handleError(err); }
  };

  const purge = async () => {
    if (!window.confirm('Clear the AI response cache? Identical requests will cost tokens again.')) return;
    try {
      const res = await api.ai.purgeCache();
      toast(`Cache cleared (${res.deleted} entries).`, 'ok', 2600);
      refreshAiStatus();
    } catch (err) { handleError(err); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      await api.auth.changePassword({ current: pw.current, next: pw.next });
      setPw({ current: '', next: '' });
      toast('Password updated.', 'ok');
    } catch (err) { handleError(err, 'Could not change the password.'); }
  };

  const goals = options?.goals || Object.entries(goalLabel).map(([id, label]) => ({ id, label }));

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <Reveal>
          <div>
            <div className="eyebrow">Settings</div>
            <h1 style={{ fontSize: 'clamp(1.8rem,3.6vw,2.4rem)', marginTop: 6 }}>Profile, AI and data.</h1>
            <p className="small muted" style={{ marginTop: 8, maxWidth: '62ch' }}>
              Signed in as <span className="strong">{user?.email}</span>. Changing your profile invalidates cached plans —
              regenerate them to pick up the new numbers.
            </p>
          </div>
        </Reveal>

        {/* sticky section list (desktop) + content column: no dead side space */}
        <div className="set-grid-layout">
          <nav className="stack g6 sticky-col" aria-label="Settings sections">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className={`nav-link ${active === sec.id ? 'nav-link-active' : ''}`}
                style={{ textAlign: 'left', width: '100%' }}
                onClick={() => document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {sec.label}
              </button>
            ))}
          </nav>
          <div className="stack g24">

        {/* ------------------------------- profile -------------------------- */}
        <Reveal>
          <Card solid className="card-pad-lg" id="sec-profile">
            <form onSubmit={save} className="stack gap-16">
              <CardHead eyebrow="Athlete" title="Profile" subtitle="Feeds the plan generator and the coach." />
              <div className="onb-fields">
                <Field label="Age">
                  <WheelPicker value={ageFromDate(form.birth_date)} min={14} max={95} onChange={(a) => setVal('birth_date')(dateForAge(a))} />
                </Field>
                <SliderField label="Height" unit=" cm" min={120} max={230} step={0.5} value={form.height_cm ?? 175} onChange={setVal('height_cm')} />
                <SliderField label="Weight" unit=" kg" min={35} max={250} step={0.5} value={form.weight_kg ?? 75} onChange={setVal('weight_kg')} />
                <SliderField label="Body fat" unit=" %" min={3} max={60} step={0.5} value={form.body_fat_pct ?? 18} onChange={setVal('body_fat_pct')} hint="optional" />
                <SliderField label="Target weight" unit=" kg" min={35} max={250} step={0.5} value={form.target_weight_kg ?? form.weight_kg ?? 75} onChange={setVal('target_weight_kg')} hint="optional" />
                <SliderField label="Sleep" unit=" h" min={3} max={12} step={0.5} value={form.sleep_hours ?? 7} onChange={setVal('sleep_hours')} />
                <SliderField label="Days / week" min={1} max={7} value={form.days_per_week ?? 4} onChange={setVal('days_per_week')} />
                <SliderField label="Session" unit=" min" min={20} max={180} step={5} value={form.session_minutes ?? 60} onChange={setVal('session_minutes')} />
                <div className="span-all">
                  <span className="label">Sex at birth</span>
                  <div style={{ marginTop: 8 }}>
                    <TileGroup cols={2} value={form.sex || 'male'} onChange={setVal('sex')} options={[
                      { value: 'male', label: 'Male', desc: 'BMR +5' },
                      { value: 'female', label: 'Female', desc: 'BMR −161' },
                    ]} />
                  </div>
                </div>
                <div className="span-all">
                  <span className="label">Goal</span>
                  <div style={{ marginTop: 8 }}>
                    <TileGroup cols={3} value={form.goal || 'recomp'} onChange={setVal('goal')} options={goals.map((g) => ({ value: g.id, label: g.label, desc: g.rate }))} />
                  </div>
                </div>
                <div className="span-all">
                  <span className="label">Experience · activity · equipment · diet</span>
                  <div className="stack g10" style={{ marginTop: 8 }}>
                    <TileGroup cols={3} value={form.experience || 'intermediate'} onChange={setVal('experience')} options={['beginner', 'intermediate', 'advanced'].map((x) => ({ value: x, label: titleCase(x) }))} />
                    <TileGroup cols={2} value={form.activity_level || 'moderate'} onChange={setVal('activity_level')} options={(options?.activity_levels || Object.keys(activityLabel)).map((a) => ({ value: a, label: activityLabel[a] || titleCase(a) }))} />
                    <TileGroup cols={2} value={form.equipment || 'full_gym'} onChange={setVal('equipment')} options={(options?.equipment || Object.keys(equipmentLabel)).map((e) => ({ value: e, label: equipmentLabel[e] || titleCase(e) }))} />
                    <TileGroup cols={4} value={form.diet_pref || 'omnivore'} onChange={setVal('diet_pref')} options={(options?.diet_prefs || Object.keys(dietLabel)).map((d) => ({ value: d, label: dietLabel[d] || titleCase(d) }))} />
                  </div>
                </div>
              </div>
              <Field label="Injuries / limitations"><Input value={form.injuries || ''} onChange={set('injuries')} placeholder="knee, shoulder, back…" /></Field>
              <Field label="Allergies / never eat"><Input value={form.allergies || ''} onChange={set('allergies')} placeholder="dairy, shellfish…" /></Field>
              <Field label="Focus areas"><Input value={form.focus_areas || ''} onChange={set('focus_areas')} placeholder="chest, back, core" /></Field>
              <Field label="Notes for the coach"><Textarea value={form.notes || ''} onChange={set('notes')} placeholder="Schedule, travel, cooking, preferences…" /></Field>

              {derived?.macros && (
                <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                  <Chip tone="teal">BMR {nf(derived.bmr)}</Chip>
                  <Chip tone="teal">TDEE {nf(derived.tdee)}</Chip>
                  <Chip tone="ember">{nf(derived.macros.calories)} kcal</Chip>
                  <Chip>P {derived.macros.protein_g} g</Chip>
                  <Chip>C {derived.macros.carbs_g} g</Chip>
                  <Chip>F {derived.macros.fat_g} g</Chip>
                  <Chip tone="ok">{derived.macros.water_l} L water</Chip>
                </div>
              )}

              <div className="row gap-10">
                <Button type="submit" variant="ember" loading={saving}><Icon name="check" size={15} /> Save profile</Button>
                <Button type="button" variant="ghost" onClick={() => setForm({ ...profile })} disabled={saving}>Reset</Button>
              </div>
            </form>
          </Card>
        </Reveal>

        {/* --------------------------------- ai ----------------------------- */}
        <Reveal>
          <Card solid className="card-pad-lg stack gap-16" id="sec-ai">
            <CardHead
              eyebrow="Intelligence"
              title="Groq connection"
              subtitle="Key status, models, live budget."
              right={<Chip tone={aiStatus?.configured ? 'ok' : 'warn'}>{aiStatus?.configured ? 'key active' : 'no key'}</Chip>}
            />

            <div className="grid grid-2 gap-12">
              <div className="stack gap-6">
                <span className="eyebrow">Planning model</span>
                <span className="mono small">{aiStatus?.planningModel || '—'}</span>
              </div>
              <div className="stack gap-6">
                <span className="eyebrow">Chat model</span>
                <span className="mono small">{aiStatus?.fastModel || '—'}</span>
              </div>
            </div>

            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              {(aiStatus?.fallbackChain || []).map((m, i) => (
                <Chip key={`${m}-${i}`} tone={i === 0 ? 'ember' : 'ghost'}>{i === 0 ? 'primary' : `fallback ${i}`}: <span className="mono">{m}</span></Chip>
              ))}
            </div>

            <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
              <Button variant="soft" onClick={runTest} disabled={testing || !aiStatus?.configured} loading={testing}>
                <Icon name="bolt" size={15} /> Test connection
              </Button>
              <Button variant="ghost" onClick={loadModels} disabled={modelsBusy || !aiStatus?.configured}>
                {modelsBusy ? <Spinner size={14} /> : <Icon name="refresh" size={15} />} List available models
              </Button>
              <Button variant="ghost" onClick={purge}><Icon name="trash" size={15} /> Purge AI cache</Button>
            </div>

            {test && (
              <Card className={test.ok ? '' : ''} style={{ background: test.ok ? 'rgba(22,163,74,0.07)' : 'rgba(244,63,94,0.07)', border: 0 }}>
                {test.ok ? (
                  <div className="stack gap-4">
                    <div className="row gap-8 strong small"><Icon name="check" size={15} style={{ color: 'var(--ok)' }} /> Connected</div>
                    <div className="tiny mono muted">
                      {test.model} · replied “{test.reply}” · {test.usage?.total_tokens} tokens · {test.latencyMs} ms
                    </div>
                  </div>
                ) : (
                  <div className="stack gap-4">
                    <div className="row gap-8 strong small" style={{ color: 'var(--rose)' }}><Icon name="close" size={15} /> Failed{test.status ? ` (HTTP ${test.status})` : ''}</div>
                    <div className="tiny muted">{test.message}</div>
                    {test.hint && <div className="tiny">{test.hint}</div>}
                  </div>
                )}
              </Card>
            )}

            {models?.models?.length > 0 && (
              <div className="stack gap-8">
                <span className="eyebrow">Models on this key ({models.models.length})</span>
                <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                  {models.models.map((m) => (
                    <Chip key={m.id} tone={m.id === aiStatus?.planningModel || m.id === aiStatus?.fastModel ? 'teal' : 'ghost'}>
                      <span className="mono">{m.id}</span>
                      {m.context_window ? <span className="muted"> · {nf(m.context_window / 1000)}k ctx</span> : null}
                    </Chip>
                  ))}
                </div>
                <div className="tiny muted">Set <span className="mono">GROQ_MODEL</span> / <span className="mono">GROQ_MODEL_FAST</span> in your .env to switch defaults.</div>
              </div>
            )}

            <div className="divider" />

            <div className="stack gap-12">
              <CardHead eyebrow="Governor" title="Token budget" subtitle="Kept below your key’s real limits. Groq response headers can only tighten these, never loosen them." />
              <div className="grid grid-3">
                <Field label="Tokens / minute"><Input className="input-num" type="number" min="100" step="100" value={budgetForm.tokensPerMinute} onChange={(e) => setBudgetForm({ ...budgetForm, tokensPerMinute: e.target.value })} /></Field>
                <Field label="Requests / minute"><Input className="input-num" type="number" min="1" step="1" value={budgetForm.requestsPerMinute} onChange={(e) => setBudgetForm({ ...budgetForm, requestsPerMinute: e.target.value })} /></Field>
                <Field label="Requests / day"><Input className="input-num" type="number" min="1" step="10" value={budgetForm.requestsPerDay} onChange={(e) => setBudgetForm({ ...budgetForm, requestsPerDay: e.target.value })} /></Field>
              </div>
              <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
                <Button variant="soft" size="sm" onClick={applyBudget}>Apply</Button>
                <Button variant="ghost" size="sm" onClick={() => setBudget({ tokensPerMinute: 1000, requestsPerMinute: 10, requestsPerDay: 300 })}>Conservative (1K TPM)</Button>
                <Button variant="ghost" size="sm" onClick={() => setBudget({ tokensPerMinute: 6000, requestsPerMinute: 20, requestsPerDay: 900 })}>Free tier (6K TPM)</Button>
                <Button variant="ghost" size="sm" onClick={() => setBudget({ tokensPerMinute: 8000, requestsPerMinute: 28, requestsPerDay: 950 })}>Maximum</Button>
              </div>
            </div>

            {usage && (
              <div className="stack gap-10">
                <span className="eyebrow">Usage, last 7 days</span>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>Day</th><th className="table-num">Calls</th><th className="table-num">Tokens</th><th className="table-num">Cache hits</th><th className="table-num">Avg latency</th></tr></thead>
                    <tbody>
                      {usage.per_day.map((d) => (
                        <tr key={d.day}>
                          <td className="strong">{d.day}</td>
                          <td className="table-num">{d.calls}</td>
                          <td className="table-num">{nf(d.tokens)}</td>
                          <td className="table-num">{d.cache_hits}</td>
                          <td className="table-num muted">{nf(d.avg_latency_ms)} ms</td>
                        </tr>
                      ))}
                      {!usage.per_day.length && <tr><td colSpan={5} className="muted tiny">No AI calls yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {usage.by_endpoint?.length > 0 && (
                  <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                    {usage.by_endpoint.map((e) => (
                      <Chip key={e.endpoint} tone="ghost"><span className="mono">{e.endpoint}</span> · {nf(e.tokens)} tok</Chip>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </Reveal>

        {/* ------------------------------ account --------------------------- */}
        <Reveal>
          <Card solid className="card-pad-lg stack gap-16" id="sec-account">
            <CardHead eyebrow="Account" title="Security & session" subtitle="Passwords are hashed with scrypt. Tokens are stored in this browser only." />
            <form onSubmit={changePassword} className="grid grid-2 gap-12">
              <Field label="Current password"><PasswordInput value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
              <Field label="New password"><PasswordInput value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
              <div className="grid-2-span"><Button type="submit" variant="soft">Update password</Button></div>
            </form>
            <div className="divider" />
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="tiny muted">Account created {user?.created_at ? fmtDateTime(user.created_at) : '—'}</div>
              <Button variant="danger" onClick={logout}><Icon name="close" size={15} /> Sign out</Button>
            </div>
          </Card>
        </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
