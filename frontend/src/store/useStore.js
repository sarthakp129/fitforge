import { create } from 'zustand';
import api, { getToken, setToken, ApiError } from '../lib/api.js';

const emptyProfile = {
  sex: 'male', birth_date: '', height_cm: null, weight_kg: null, body_fat_pct: null,
  target_weight_kg: null, activity_level: 'moderate', goal: 'recomp', experience: 'intermediate',
  days_per_week: 4, session_minutes: 60, equipment: 'full_gym', injuries: '', diet_pref: 'omnivore',
  allergies: '', focus_areas: '', sleep_hours: 7, notes: '',
  timezone: 'UTC', units: 'metric', favorite_exercises: [],
};

let toastId = 0;

export const useStore = create((set, get) => ({
  /* ------------------------------- state -------------------------------- */
  booted: false,
  token: getToken(),
  user: null,
  profile: { ...emptyProfile },
  derived: null,
  options: null,
  authConfig: { google_configured: false, google_client_id: null },
  savedMeals: [],
  aiStatus: null,
  view: 'dashboard',
  toasts: [],

  /* ------------------------------- toasts ------------------------------- */
  toast: (message, kind = 'info', ttl = 4200) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    if (ttl) setTimeout(() => get().dismissToast(id), ttl);
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setView: (view) => set({ view }),

  /** coach drawer visibility (opened from FAB, dashboard, anywhere) */
  coachOpen: false,
  setCoachOpen: (open) => set({ coachOpen: Boolean(open) }),

  /** command palette visibility */
  cmdOpen: false,
  setCmdOpen: (open) => set({ cmdOpen: Boolean(open) }),

  /** theme: permanently light */
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},

  /* -------------------------------- auth -------------------------------- */
  async fetchAuthConfig() {
    try {
      const cfg = await api.auth.config();
      set({ authConfig: cfg });
      return cfg;
    } catch {
      return get().authConfig;
    }
  },

  async boot() {
    if (get().booted) return;
    set({ booted: true });
    get().fetchAuthConfig().catch(() => {});
    try {
      const me = await api.auth.me();
      set({ token: 'session', user: me.user, profile: { ...emptyProfile, ...me.profile }, derived: { macros: me.targets, tdee: me.tdee } });
      await get().refreshAiStatus();
      get().fetchSavedMeals().catch(() => {});
    } catch (err) {
      setToken(null);
      set({ token: null, user: null });
      // Public landing pages intentionally receive 401 here; status is still
      // useful for the anonymous product shell.
      get().refreshAiStatus().catch(() => {});
      if (err.status !== 401) get().toast(err.message, 'err');
    }
  },

  async login(email, password) {
    const res = await api.auth.login({ email, password });
    setToken(res.token);
    set({ token: 'session', user: res.user, profile: { ...emptyProfile, ...res.profile }, view: 'dashboard' });
    await get().refreshProfile();
    await get().refreshAiStatus();
    get().fetchSavedMeals().catch(() => {});
    get().toast(`Welcome back, ${res.user.name.split(' ')[0]}.`, 'ok');
    return res;
  },

  async register(name, email, password) {
    const res = await api.auth.register({ name, email, password });
    setToken(res.token);
    set({ token: 'session', user: res.user, profile: { ...emptyProfile, ...res.profile }, view: 'onboarding' });
    await get().refreshAiStatus();
    get().toast('Account created. Let’s build your profile.', 'ok');
    return res;
  },

  async googleAuth(credential) {
    const res = await api.auth.google(credential);
    setToken(res.token);
    set({
      token: 'session',
      user: res.user,
      profile: { ...emptyProfile, ...res.profile },
      view: res.is_new ? 'onboarding' : 'dashboard',
    });
    await get().refreshProfile();
    await get().refreshAiStatus();
    get().fetchSavedMeals().catch(() => {});
    get().toast(res.is_new ? 'Account created with Google.' : `Welcome back, ${res.user.name.split(' ')[0]}.`, 'ok');
    return res;
  },

  async linkGoogle(credential) {
    const res = await api.auth.linkGoogle(credential);
    set((s) => ({ user: { ...s.user, google_linked: true } }));
    get().toast('Google identity successfully linked.', 'ok');
    return res;
  },

  async unlinkGoogle() {
    const res = await api.auth.unlinkGoogle();
    set((s) => ({ user: { ...s.user, google_linked: false } }));
    get().toast('Google identity unlinked.', 'ok');
    return res;
  },

  async updateName(name) {
    const res = await api.auth.patchMe({ name });
    set((s) => ({ user: { ...s.user, name: res.user.name } }));
    get().toast('Name updated.', 'ok');
    return res;
  },

  async logout() {
    try { await api.auth.logout(); } catch { /* clear local state even if offline */ }
    setToken(null);
    set({ token: null, user: null, profile: { ...emptyProfile }, derived: null, savedMeals: [], view: 'dashboard' });
    get().toast('Signed out.', 'info', 2200);
  },

  async refreshProfile() {
    try {
      const res = await api.profile.get();
      set({
        profile: { ...emptyProfile, ...res.profile },
        derived: res.derived,
        options: res.options,
      });
      return res;
    } catch (err) {
      if (err.status === 401) { setToken(null); set({ token: null, user: null }); }
      throw err;
    }
  },

  async saveProfile(patch, { silent = false } = {}) {
    const res = await api.profile.put(patch);
    set((s) => ({
      profile: { ...s.profile, ...res.profile },
      derived: res.derived ? { ...s.derived, ...res.derived } : s.derived,
    }));
    if (!silent) get().toast('Profile saved.', 'ok', 2400);
    return res;
  },

  async toggleFavoriteExercise(exerciseId) {
    const current = get().profile.favorite_exercises || [];
    const exists = current.includes(exerciseId);
    const updated = exists ? current.filter((id) => id !== exerciseId) : [...current, exerciseId];
    await get().saveProfile({ favorite_exercises: updated }, { silent: true });
    get().toast(exists ? 'Removed from favorites' : 'Added to favorites', 'info', 1800);
  },

  async fetchSavedMeals() {
    try {
      const meals = await api.profile.getSavedMeals();
      set({ savedMeals: meals || [] });
      return meals;
    } catch {
      return [];
    }
  },

  async saveMealPreset(payload) {
    const created = await api.profile.saveMeal(payload);
    set((s) => ({ savedMeals: [created, ...s.savedMeals] }));
    get().toast(`Saved meal "${created.name}"`, 'ok');
    return created;
  },

  async deleteSavedMeal(id) {
    await api.profile.deleteSavedMeal(id);
    set((s) => ({ savedMeals: s.savedMeals.filter((m) => m.id !== id) }));
    get().toast('Saved meal removed', 'info');
  },

  async onboard(payload) {
    const res = await api.profile.onboard(payload);
    set((s) => ({ profile: { ...s.profile, ...res.profile }, derived: { ...s.derived, ...res.derived } }));
    return res;
  },

  /* --------------------------------- ai --------------------------------- */
  async refreshAiStatus() {
    try {
      const status = await api.ai.status();
      set({ aiStatus: status });
      return status;
    } catch (err) {
      set({ aiStatus: { configured: false, enabled: false, error: err.message, budget: null } });
      return null;
    }
  },

  async setBudget(payload) {
    const res = await api.ai.budget(payload);
    set((s) => ({ aiStatus: { ...s.aiStatus, budget: res.budget } }));
    get().toast('Token budget updated.', 'ok', 2200);
    return res;
  },

  /** Uniform error surface: rate limits and network failures become toasts. */
  handleError(err, fallback = 'Something went wrong.') {
    const message = err instanceof ApiError ? err.message : err?.message || fallback;
    const kind = err?.status === 429 ? 'warn' : 'err';
    get().toast(message, kind, err?.status === 429 ? 6500 : 4800);
    if (err?.status === 401) {
      setToken(null);
      set({ token: null, user: null });
    }
    return message;
  },

  isProfileReady() {
    const p = get().profile;
    return Boolean(p.weight_kg && p.height_cm && p.birth_date);
  },
}));

export default useStore;
