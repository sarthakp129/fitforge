import React, { useEffect, useState } from 'react';
import useStore from '../store/useStore.js';
import api from '../lib/api.js';
import { nf, fmtDateTime, titleCase, activityLabel, equipmentLabel, goalLabel, dietLabel } from '../lib/format.js';
import { Card, CardHead, Button, Chip, Field, Input, Textarea, Icon, Reveal, Segmented } from './ui.jsx';
import { SliderField, WheelPicker, TileGroup, PasswordInput } from './Controls.jsx';
import { dateForAge, ageFromDate } from '../lib/format.js';
import useScrollSpy from '../hooks/useScrollSpy.js';
import GoogleSignIn from './GoogleSignIn.jsx';

const SECTIONS = [
  { id: 'sec-profile', label: 'Athlete Profile' },
  { id: 'sec-preferences', label: 'Units & Saved Meals' },
  { id: 'sec-account', label: 'Account & Security' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export default function Settings() {
  const {
    profile, derived, options, saveProfile, handleError, toast, logout,
    user, updateName, linkGoogle, unlinkGoogle,
    savedMeals, fetchSavedMeals, deleteSavedMeal, saveMealPreset, toggleFavoriteExercise,
  } = useStore();

  const [form, setForm] = useState({ ...profile });
  const [saving, setSaving] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [newMealName, setNewMealName] = useState('');
  const [newMealKcal, setNewMealKcal] = useState('');
  const [newMealProtein, setNewMealProtein] = useState('');
  const [newMealCarbs, setNewMealCarbs] = useState('');
  const [newMealFat, setNewMealFat] = useState('');
  const [addingMeal, setAddingMeal] = useState(false);
  const active = useScrollSpy(SECTIONS.map((s) => s.id));

  useEffect(() => { setForm({ ...profile }); }, [profile]);
  useEffect(() => { if (user?.name) setNameInput(user.name); }, [user?.name]);

  useEffect(() => {
    fetchSavedMeals().catch(() => {});
  }, [fetchSavedMeals]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try { await saveProfile(form); }
    catch (err) { handleError(err, 'Could not save the profile.'); }
    finally { setSaving(false); }
  };

  const saveAthleteName = async () => {
    if (!nameInput.trim()) return;
    setSavingName(true);
    try {
      await updateName(nameInput.trim());
    } catch (err) {
      handleError(err, 'Could not update your name.');
    } finally {
      setSavingName(false);
    }
  };

  const handleLinkGoogle = async (credential) => {
    try {
      await linkGoogle(credential);
    } catch (err) {
      handleError(err, 'Could not link Google account.');
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!window.confirm('Disconnect your Google account from FitForge?')) return;
    try {
      await unlinkGoogle();
    } catch (err) {
      handleError(err, 'Could not unlink Google account.');
    }
  };

  const autoDetectTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        setVal('timezone')(tz);
        toast(`Timezone detected: ${tz}`, 'ok');
      }
    } catch {
      toast('Could not detect local timezone.', 'warn');
    }
  };

  const handleAddMealPreset = async (e) => {
    e.preventDefault();
    if (!newMealName.trim()) return;
    setAddingMeal(true);
    try {
      await saveMealPreset({
        name: newMealName.trim(),
        calories: Number(newMealKcal) || 0,
        protein_g: Number(newMealProtein) || 0,
        carbs_g: Number(newMealCarbs) || 0,
        fat_g: Number(newMealFat) || 0,
        items: [],
      });
      setNewMealName('');
      setNewMealKcal('');
      setNewMealProtein('');
      setNewMealCarbs('');
      setNewMealFat('');
    } catch (err) {
      handleError(err, 'Could not save meal preset.');
    } finally {
      setAddingMeal(false);
    }
  };



  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 12) {
      toast('New password must be at least 12 characters.', 'warn');
      return;
    }
    try {
      await api.auth.changePassword({ current: pw.current, next: pw.next });
      setPw({ current: '', next: '' });
      toast('Password updated successfully.', 'ok');
    } catch (err) { handleError(err, 'Could not change the password.'); }
  };

  const goals = options?.goals || Object.entries(goalLabel).map(([id, label]) => ({ id, label }));
  const favoriteExercises = Array.isArray(form.favorite_exercises) ? form.favorite_exercises : [];

  return (
    <div className="shell" style={{ paddingTop: 'calc(var(--nav-h) + 26px)' }}>
      <div className="wrap stack gap-24">
        <Reveal>
          <div>
            <div className="eyebrow">Settings</div>
            <h1 style={{ fontSize: 'clamp(1.8rem,3.6vw,2.4rem)', marginTop: 6 }}>Profile, AI and account.</h1>
            <p className="small muted" style={{ marginTop: 8, maxWidth: '62ch' }}>
              Signed in as <span className="strong">{user?.email}</span>. Changing your profile recalculates metabolic targets and invalidates cached plans.
            </p>
          </div>
        </Reveal>

        {/* sticky section list (desktop) + content column */}
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
                  <CardHead eyebrow="Athlete" title="Profile & Biometrics" subtitle="Feeds the personalized plan engine, macro calculator, and coach." />
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

            {/* ------------------------ preferences & meals -------------------- */}
            <Reveal>
              <Card solid className="card-pad-lg stack gap-16" id="sec-preferences">
                <CardHead
                  eyebrow="Preferences"
                  title="Units, Timezone & Saved Meals"
                  subtitle="Configure daily logging conventions, regional units, and reusable meal recipes."
                />

                <div className="grid grid-2 gap-16">
                  <div>
                    <span className="label">Unit System</span>
                    <div style={{ marginTop: 8 }}>
                      <TileGroup
                        cols={2}
                        value={form.units || 'metric'}
                        onChange={(u) => { setVal('units')(u); saveProfile({ units: u }); }}
                        options={[
                          { value: 'metric', label: 'Metric', desc: 'kg · cm · ml' },
                          { value: 'imperial', label: 'Imperial', desc: 'lbs · in · oz' },
                        ]}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="row-between">
                      <span className="label">Timezone</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                        onClick={autoDetectTimezone}
                      >
                        Auto-detect
                      </button>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <select
                        className="input"
                        value={form.timezone || 'UTC'}
                        onChange={(e) => { setVal('timezone')(e.target.value); saveProfile({ timezone: e.target.value }); }}
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="divider" />

                {/* Favorite exercises list */}
                <div className="stack gap-8">
                  <div className="row-between">
                    <span className="label">Favorite Exercises ({favoriteExercises.length})</span>
                    <span className="tiny muted">Starred movements prioritize in plan recommendations</span>
                  </div>
                  {favoriteExercises.length > 0 ? (
                    <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                      {favoriteExercises.map((id) => (
                        <Chip key={id} tone="teal" onClick={() => toggleFavoriteExercise(id)}>
                          <span className="mono">{id}</span>
                          <Icon name="close" size={12} style={{ marginLeft: 4 }} />
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="tiny muted">No favorites starred yet. Click the star icon next to any exercise in Training to save it here.</p>
                  )}
                </div>

                <div className="divider" />

                {/* Saved meals and reusable presets */}
                <div className="stack gap-12">
                  <div className="row-between">
                    <div>
                      <span className="label">Saved Meals & Presets ({savedMeals.length})</span>
                      <div className="tiny muted">Quick-log favorite combos directly from the Nutrition tracker</div>
                    </div>
                  </div>

                  {savedMeals.length > 0 && (
                    <div className="stack gap-8">
                      {savedMeals.map((meal) => (
                        <div
                          key={meal.id}
                          className="row-between"
                          style={{
                            padding: '10px 14px',
                            background: 'var(--surface-2)',
                            borderRadius: 'var(--radius)',
                            alignItems: 'center',
                          }}
                        >
                          <div className="stack gap-2">
                            <span className="strong small">{meal.name}</span>
                            <div className="row gap-8 tiny muted">
                              <span><b>{nf(meal.calories)}</b> kcal</span>
                              <span>P: {meal.protein_g}g</span>
                              <span>C: {meal.carbs_g}g</span>
                              <span>F: {meal.fat_g}g</span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSavedMeal(meal.id)}
                            title="Remove saved meal"
                          >
                            <Icon name="trash" size={14} style={{ color: 'var(--rose)' }} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add meal preset form */}
                  <form onSubmit={handleAddMealPreset} className="stack gap-8" style={{ marginTop: 4 }}>
                    <span className="eyebrow">Create New Meal Preset</span>
                    <div className="grid grid-2 gap-8">
                      <Input
                        placeholder="Meal name (e.g. Oats + Whey + Berries)"
                        value={newMealName}
                        onChange={(e) => setNewMealName(e.target.value)}
                      />
                      <Input
                        type="number"
                        placeholder="Calories (kcal)"
                        value={newMealKcal}
                        onChange={(e) => setNewMealKcal(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-3 gap-8">
                      <Input
                        type="number"
                        placeholder="Protein (g)"
                        value={newMealProtein}
                        onChange={(e) => setNewMealProtein(e.target.value)}
                      />
                      <Input
                        type="number"
                        placeholder="Carbs (g)"
                        value={newMealCarbs}
                        onChange={(e) => setNewMealCarbs(e.target.value)}
                      />
                      <Input
                        type="number"
                        placeholder="Fat (g)"
                        value={newMealFat}
                        onChange={(e) => setNewMealFat(e.target.value)}
                      />
                    </div>
                    <div>
                      <Button type="submit" variant="soft" size="sm" loading={addingMeal} disabled={!newMealName.trim()}>
                        <Icon name="plus" size={14} /> Add meal preset
                      </Button>
                    </div>
                  </form>
                </div>
              </Card>
            </Reveal>



            {/* ------------------------------ account --------------------------- */}
            <Reveal>
              <Card solid className="card-pad-lg stack gap-16" id="sec-account">
                <CardHead
                  eyebrow="Account"
                  title="Identity & Session Security"
                  subtitle="Manage athlete profile name, Google OAuth identity, password credentials, and active device sessions."
                />

                {/* Athlete identity & profile name */}
                <div className="grid grid-2 gap-12">
                  <Field label="Athlete Name">
                    <div className="row gap-8">
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Your display name"
                      />
                      <Button
                        variant="soft"
                        size="md"
                        onClick={saveAthleteName}
                        loading={savingName}
                        disabled={!nameInput.trim() || nameInput.trim() === user?.name}
                      >
                        Save
                      </Button>
                    </div>
                  </Field>

                  <Field label="Email Address">
                    <Input value={user?.email || ''} disabled readOnly />
                  </Field>
                </div>

                <div className="divider" />

                {/* Google Sign-in identity linking */}
                <div className="stack gap-8">
                  <span className="label">Federated Identity (Google OAuth)</span>
                  <div className="row-between" style={{ padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
                    <div className="row gap-10" style={{ alignItems: 'center' }}>
                      <Icon name="shield" size={18} style={{ color: user?.google_linked ? 'var(--ok)' : 'var(--muted)' }} />
                      <div>
                        <div className="strong small">Google Sign-In</div>
                        <div className="tiny muted">
                          {user?.google_linked ? 'Your Google account is securely linked.' : 'Connect your Google account for passwordless sign-in.'}
                        </div>
                      </div>
                    </div>
                    <div>
                      {user?.google_linked ? (
                        <Button variant="ghost" size="sm" onClick={handleUnlinkGoogle}>
                          <Icon name="close" size={14} /> Disconnect Google
                        </Button>
                      ) : (
                        <GoogleSignIn
                          mode="link"
                          text="Link Google"
                          size="sm"
                          block={false}
                          onSuccess={handleLinkGoogle}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="divider" />

                {/* Password change */}
                <div className="stack gap-10">
                  <span className="label">Account Password</span>
                  <p className="tiny muted">Passwords are hashed with asynchronous scrypt. Minimum length is 12 characters.</p>
                  <form onSubmit={changePassword} className="grid grid-2 gap-12">
                    <Field label="Current password">
                      <PasswordInput value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
                    </Field>
                    <Field label="New password (12+ characters)">
                      <PasswordInput value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
                    </Field>
                    <div className="grid-2-span">
                      <Button type="submit" variant="soft">Update password</Button>
                    </div>
                  </form>
                </div>

                <div className="divider" />

                {/* Session controls */}
                <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div className="tiny muted">
                    Account created {user?.created_at ? fmtDateTime(user.created_at) : '—'} · Session version active
                  </div>
                  <div className="row gap-8">
                    <Button variant="danger" onClick={logout}>
                      <Icon name="close" size={15} /> Sign out this device
                    </Button>
                  </div>
                </div>
              </Card>
            </Reveal>

          </div>
        </div>
      </div>
    </div>
  );
}
