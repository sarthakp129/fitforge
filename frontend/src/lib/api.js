/**
 * Tiny API client: token handling, error normalisation, and an SSE reader for
 * streaming plan generation (so the UI can show real throttle/retry states).
 */

const TOKEN_KEY = 'fitforge.token';
const BASE = import.meta.env.VITE_API_BASE || '';
let memoryToken = null;

export const getToken = () => {
  try { return memoryToken || localStorage.getItem(TOKEN_KEY); } catch { return memoryToken; }
};
export const setToken = (t) => {
  // First-party sessions are HttpOnly cookies. Remove legacy persisted JWTs;
  // an in-memory compatibility token is intentionally not retained.
  memoryToken = t || null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

/**
 * Build a query string, dropping undefined/null/empty values.
 * `new URLSearchParams({ q: undefined })` would serialise to "q=undefined",
 * which the API treats as a real filter and returns zero results.
 */
export const qs = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
    this.code = body?.error;
    this.retryIn = body?.retryIn;
  }
}

async function request(path, { method = 'GET', body, auth = true, signal, raw = false } = {}) {
  const headers = { accept: 'application/json' };
  const token = getToken();
  if (auth && token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the FitForge API. Is the backend running?', 0, { error: 'network' });
  }

  if (raw) return res;

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after')) || data?.retryIn;
    throw new ApiError(
      data?.message || (res.status === 401 ? 'Session expired — please sign in again.' : `Request failed (${res.status})`),
      res.status,
      { ...data, retryIn: retryAfter }
    );
  }
  return data;
}

/* --------------------------- streaming (SSE) ---------------------------- */

/**
 * POSTs to an SSE-enabled endpoint and yields parsed events.
 * onEvent({event, data}) for 'progress' | 'done' | 'error'.
 */
export async function streamPost(path, body, onEvent, { signal } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}?stream=1`, {
    method: 'POST', headers, body: JSON.stringify({ ...(body || {}), stream: true }), signal, credentials: 'same-origin',
  });

  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    throw new ApiError(data?.message || `Generation failed (${res.status})`, res.status, data || {});
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      if (!frame.trim()) continue;
      let event = 'message';
      let dataStr = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      let data = null;
      try { data = dataStr ? JSON.parse(dataStr) : null; } catch { data = { raw: dataStr }; }
      onEvent({ event, data });
      if (event === 'done' || event === 'error') return data;
    }
  }
  return null;
}

/* ------------------------------- endpoints ------------------------------ */

export const api = {
  health: () => request('/api/health', { auth: false }),
  index: () => request('/api', { auth: false }),

  auth: {
    config: () => request('/api/auth/config', { auth: false }),
    register: (payload) => request('/api/auth/register', { method: 'POST', body: payload, auth: false }),
    login: (payload) => request('/api/auth/login', { method: 'POST', body: payload, auth: false }),
    google: (payload) => {
      const body = typeof payload === 'string' ? { credential: payload } : payload;
      return request('/api/auth/google', { method: 'POST', body, auth: false });
    },
    linkGoogle: (payload) => {
      const body = typeof payload === 'string' ? { credential: payload } : payload;
      return request('/api/auth/google/link', { method: 'POST', body });
    },
    unlinkGoogle: () => request('/api/auth/google/unlink', { method: 'POST', body: {} }),
    me: () => request('/api/auth/me'),
    patchMe: (payload) => request('/api/auth/me', { method: 'PATCH', body: payload }),
    changePassword: (payload) => request('/api/auth/change-password', { method: 'POST', body: payload }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
  },

  profile: {
    get: () => request('/api/profile'),
    put: (payload) => request('/api/profile', { method: 'PUT', body: payload }),
    onboard: (payload) => request('/api/profile/onboard', { method: 'POST', body: payload }),
    getSavedMeals: () => request('/api/profile/saved-meals'),
    saveMeal: (payload) => request('/api/profile/saved-meals', { method: 'POST', body: payload }),
    deleteSavedMeal: (id) => request(`/api/profile/saved-meals/${id}`, { method: 'DELETE' }),
  },

  training: {
    exercises: (params = {}) => request(`/api/training/exercises${qs(params)}`),
    exercise: (id) => request(`/api/training/exercises/${id}`),
    substitutes: (id, params = {}) => request(`/api/training/exercises/${id}/substitutes${qs(params)}`),
    customExercises: () => request('/api/training/custom-exercises'),
    createCustomExercise: (payload) => request('/api/training/custom-exercises', { method: 'POST', body: payload }),
    deleteCustomExercise: (id) => request(`/api/training/custom-exercises/${id}`, { method: 'DELETE' }),
    workouts: (params = {}) => request(`/api/training/workouts${qs(params)}`),
    workout: (id) => request(`/api/training/workouts/${id}`),
    log: (payload) => request('/api/training/workouts', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/training/workouts/${id}`, { method: 'PUT', body: payload }),
    remove: (id) => request(`/api/training/workouts/${id}`, { method: 'DELETE' }),
    addSet: (id, payload) => request(`/api/training/workouts/${id}/sets`, { method: 'POST', body: payload }),
    removeSet: (id) => request(`/api/sets/${id}`, { method: 'DELETE' }).catch(() => request(`/api/training/sets/${id}`, { method: 'DELETE' })),
    next: (date) => request(`/api/training/next${date ? `?date=${date}` : ''}`),
  },

  nutrition: {
    foods: (params = {}) => request(`/api/nutrition/foods${qs(params)}`),
    customFoods: () => request('/api/nutrition/custom-foods'),
    createCustomFood: (payload) => request('/api/nutrition/custom-foods', { method: 'POST', body: payload }),
    deleteCustomFood: (id) => request(`/api/nutrition/custom-foods/${id}`, { method: 'DELETE' }),
    log: (payload) => request('/api/nutrition/log', { method: 'POST', body: payload }),
    logBatch: (payload) => request('/api/nutrition/log-batch', { method: 'POST', body: payload }),
    daily: (date) => request(`/api/nutrition/daily?date=${date}`),
    range: (days = 14) => request(`/api/nutrition/range?days=${days}`),
    remove: (id) => request(`/api/nutrition/log/${id}`, { method: 'DELETE' }),
    copyDay: (from, to) => request('/api/nutrition/copy-day', { method: 'POST', body: { from, to } }),
  },

  progress: {
    metrics: (days = 90) => request(`/api/progress/metrics?days=${days}`),
    addMetric: (payload) => request('/api/progress/metrics', { method: 'POST', body: payload }),
    removeMetric: (id) => request(`/api/progress/metrics/${id}`, { method: 'DELETE' }),
    overview: () => request('/api/progress/stats/overview'),
    volume: (weeks = 12) => request(`/api/progress/stats/volume?weeks=${weeks}`),
    prs: () => request('/api/progress/stats/prs'),
    heatmap: (weeks = 26) => request(`/api/progress/stats/heatmap?weeks=${weeks}`),
    muscles: (days = 28) => request(`/api/progress/stats/muscles?days=${days}`),
    exportJson: () => request('/api/progress/export'),
    importJson: (payload) => request('/api/progress/import', { method: 'POST', body: payload }),
    exportCsvUrl: () => `${BASE}/api/progress/export.csv`,
  },

  ai: {
    status: () => request('/api/ai/status'),
    models: (refresh = false) => request(`/api/ai/models${refresh ? '?refresh=1' : ''}`),
    test: (model) => request('/api/ai/test', { method: 'POST', body: model ? { model } : {} }),
    budget: (payload) => request('/api/ai/budget', { method: 'PUT', body: payload }),
    planTraining: (payload) => request('/api/ai/plans/training', { method: 'POST', body: payload }),
    planNutrition: (payload) => request('/api/ai/plans/nutrition', { method: 'POST', body: payload }),
    streamTraining: (payload, onEvent, opts) => streamPost('/api/ai/plans/training', payload, onEvent, opts),
    streamNutrition: (payload, onEvent, opts) => streamPost('/api/ai/plans/nutrition', payload, onEvent, opts),
    plans: (kind) => request(`/api/ai/plans${kind ? `?kind=${kind}` : ''}`),
    plan: (id) => request(`/api/ai/plans/${id}`),
    activePlan: (kind) => request(`/api/ai/plans/active/${kind}`),
    activate: (id) => request(`/api/ai/plans/${id}/activate`, { method: 'POST' }),
    removePlan: (id) => request(`/api/ai/plans/${id}`, { method: 'DELETE' }),
    coach: (message, sessionId = 'default') => request('/api/ai/coach', { method: 'POST', body: { message, session_id: sessionId } }),
    chat: (sessionId = 'default') => request(`/api/ai/chat?session_id=${sessionId}`),
    clearChat: () => request('/api/ai/chat', { method: 'DELETE' }),
    suggestions: () => request('/api/ai/coach/suggest'),
    insight: () => request('/api/ai/insight'),
    usage: (days = 7) => request(`/api/ai/usage?days=${days}`),
    purgeCache: (kind) => request('/api/ai/cache/purge', { method: 'POST', body: kind ? { kind } : {} }),
    /** Raw audio bytes -> Whisper transcript. Audio is never stored server-side. */
    transcribe: async (blob) => {
      const token = getToken();
      const res = await fetch(`${BASE}/api/ai/transcribe`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: blob,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(data?.message || `Transcription failed (${res.status})`, res.status, data || {});
      return data;
    },
    /** Coach text -> speech audio blob (Orpheus). 429 when the daily voice cap is hit. */
    speak: async (text) => {
      const token = getToken();
      const res = await fetch(`${BASE}/api/ai/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(data?.message || `Speech failed (${res.status})`, res.status, data || {});
      }
      return res.blob();
    },
  },
};

/** Download helper for the CSV export (needs the auth header). */
export async function downloadCsv() {
  const res = await request('/api/progress/export.csv', { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fitforge-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default api;
