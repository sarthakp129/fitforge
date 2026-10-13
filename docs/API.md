# FitForge API reference

Base URL: `http://localhost:8080` (or same-origin `/api` behind the web container).

All responses are JSON. Errors use one envelope:

```json
{ "error": "invalid_request", "message": "Missing field(s): email", "missing": ["email"] }
```

`error` is derived from the HTTP status (`invalid_request` 400, `unauthorized` 401,
`not_found` 404, `conflict` 409, `precondition_failed` 412, `rate_limited` 429,
`internal_error` 500, `service_unavailable` 503) or set explicitly by the AI layer
(`budget_exhausted`, `daily_quota`, `no_api_key`, `disabled`). `429` responses also carry
`retryIn` (seconds) and a `Retry-After` header.

Authenticated routes need `Authorization: Bearer <token>`.

---

## Health & discovery

### `GET /api/health` *(public)*
```json
{
  "ok": true, "service": "fitforge-api", "version": "1.0.0",
  "time": "2026-10-12T08:00:00.000Z",
  "db": "/app/data/fitforge.db",
  "ai": {
    "configured": true, "enabled": true,
    "planning_model": "openai/gpt-oss-120b", "fast_model": "openai/gpt-oss-20b",
    "budget": { "tokensPerMinute": 6000, "tokensUsedThisMinute": 0, "tokensRemaining": 6000 }
  }
}
```

### `GET /api` *(public)* — human-readable route index.

---

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, name, password }` | 409 if the email exists; password ≥ 6 chars. |
| POST | `/api/auth/login` | `{ email, password }` | 401 on mismatch. |
| GET | `/api/auth/me` | — | `{ user, profile, targets, tdee }` |
| POST | `/api/auth/change-password` | `{ current, next }` | |

Response:
```json
{ "token": "eyJhbGciOi…", "user": { "id": 1, "email": "a@b.co", "name": "Alex" }, "profile": { … } }
```

---

## Profile

### `GET /api/profile`
Returns the stored profile, derived numbers, and the option lists the UI renders:
```json
{
  "profile": { "sex": "male", "height_cm": 181, "weight_kg": 82.4, "goal": "muscle_gain", … },
  "derived": {
    "age": 32, "bmr": 1874, "tdee": 2905, "calorie_target": 3254,
    "macros": { "calories": 3254, "protein_g": 181, "carbs_g": 399, "fat_g": 82, "fiber_g": 32, "water_l": 3.1 },
    "bmi": 25.2, "weekly_rate": 0.29, "protein_per_kg": 2.2
  },
  "options": { "goals": [ { "id": "fat_loss", "label": "Fat loss", "rate": "0.5-0.8% bodyweight / week" } ], … }
}
```

### `PUT /api/profile`
Partial update. Every field is validated and clamped:

| Field | Type | Range / allowed |
|---|---|---|
| `sex` | enum | `male`, `female` |
| `birth_date` | date | `YYYY-MM-DD` |
| `height_cm` | number | 120–230 |
| `weight_kg` | number | 35–250 |
| `body_fat_pct` | number | 3–60 |
| `target_weight_kg` | number | 35–250 |
| `activity_level` | enum | `sedentary`, `light`, `moderate`, `active`, `athlete` |
| `goal` | enum | `fat_loss`, `recomp`, `maintain`, `muscle_gain`, `strength`, `endurance` |
| `experience` | enum | `beginner`, `intermediate`, `advanced` |
| `days_per_week` | int | 1–7 |
| `session_minutes` | int | 20–180 |
| `equipment` | enum | `full_gym`, `barbell_and_dumbbell`, `dumbbell_only`, `home_bodyweight`, `machines_cables` |
| `diet_pref` | enum | `omnivore`, `vegetarian`, `vegan`, `pescatarian` |
| `sleep_hours` | number | 3–12 |
| `injuries`, `allergies`, `focus_areas`, `notes` | string | free text (length-capped) |

Out-of-range numbers are clamped; unknown enum values are **ignored**, never stored.

### `POST /api/profile/onboard`
Same shape as `PUT`, but also writes a `metrics` weigh-in when `weight_kg` is present.

---

## Training

### `GET /api/training/exercises` *(public)*
Query: `q`, `muscle`, `category`, `equipment`. Returns up to 200 matches plus facets.
```json
{
  "count": 18,
  "exercises": [ { "id": "back_squat", "name": "Barbell Back Squat", "category": "legs",
                   "muscles": ["quads","glutes","adductors","core"], "equipment": "barbell",
                   "level": "intermediate", "pattern": "squat", "compound": true } ],
  "facets": { "categories": ["push","pull","legs","core","full","conditioning"], "equipment": [ … ], "muscles": [ … ] }
}
```

### `POST /api/training/workouts`
```json
{
  "date": "2026-10-12", "name": "Push A", "focus": "push",
  "duration_s": 3720, "calories": 0, "rpe": 8, "notes": "bar speed good",
  "sets": [
    { "exercise_id": "bench_press", "set_number": 1, "reps": 5, "weight_kg": 90, "is_warmup": true },
    { "exercise_id": "bench_press", "set_number": 2, "reps": 8, "weight_kg": 100, "rpe": 8, "rest_s": 120 }
  ]
}
```
`exercise_name` is resolved from the library when omitted. `PUT /api/training/workouts/:id`
accepts the same shape; passing `sets` replaces them atomically. `DELETE` cascades.

### `GET /api/training/next?date=YYYY-MM-DD`
Picks the session from your active plan for that date (weekday first, otherwise the day after
your last logged focus) and attaches the last performed load for every exercise:
```json
{
  "date": "2026-10-12",
  "plan": { "id": 7, "name": "FitForge Hypertrophy · 4×/week · intermediate", "source": "ai" },
  "session": {
    "day": 1, "day_name": "Monday", "title": "Push — Chest, Shoulders, Triceps", "duration_min": 65,
    "exercises": [ { "exercise_id": "bench_press", "sets": 4, "reps": "6-10", "rest_s": 120, … } ],
    "last_performance": { "bench_press": { "weight_kg": 100, "reps": 8, "date": "2026-10-09" } }
  }
}
```

---

## Nutrition

### `GET /api/nutrition/foods?q=&category=` *(public)*
62 foods with per-100 g macros, a default serving and tags.

### `POST /api/nutrition/log`
Two modes:
```json
{ "date": "2026-10-12", "meal_type": "breakfast", "food_name": "Greek yogurt 0%", "grams": 250 }
```
```json
{ "date": "2026-10-12", "meal_type": "lunch", "food_name": "Homemade biryani",
  "grams": 350, "calories": 620, "protein_g": 34, "carbs_g": 72, "fat_g": 19 }
```
If `calories` is omitted the food is looked up (exact, then fuzzy) and macros are computed from
`grams`. Unknown food without macros ⇒ `400`. `meal_type` ∈
`breakfast, lunch, dinner, snack, pre_workout, post_workout`.

### `POST /api/nutrition/log-batch`
`{ date, items: [ … ] }` — the same item shape, up to 100. Skips unresolvable entries and reports
`{ created, ids }`. Used by "Apply meal plan to today".

### `GET /api/nutrition/daily?date=` → `{ date, entries, by_meal, totals }`
### `GET /api/nutrition/range?days=14` → per-day aggregates for charts
### `POST /api/nutrition/copy-day` → `{ from, to }`
### `DELETE /api/nutrition/log/:id`

---

## Progress

### `POST /api/progress/metrics`
`{ date?, weight_kg?, body_fat_pct?, waist_cm?, notes? }` — one row per user per date (upsert).
Requires at least one measurement, else `400`. A `weight_kg` also updates the profile.

### `GET /api/progress/metrics?days=90` → `{ days, series, summary }`

### `GET /api/progress/stats/overview`
```json
{
  "headline": {
    "sessions": 3, "volume_this_week_kg": 48210, "volume_last_week_kg": 44980,
    "volume_delta_pct": 7.2, "sets_last_14d": 96, "total_sessions": 41, "total_minutes": 2680,
    "weight_change_kg": -1.7, "weight_latest": 82.2,
    "avg_kcal_7d": 2980, "avg_protein_7d": 168,
    "calorie_target": 3254, "protein_target": 181, "streak": 3
  },
  "streaks": { "current": 3, "longest": 12, "last_session": "2026-10-12" },
  "weekly_volume": [ { "week": "2026-W41", "week_start": "2026-10-05", "volume_kg": 48210, "sets": 96, "sessions": 3 } ],
  "targets": { … }
}
```

### Other stats
- `GET /api/progress/stats/volume?weeks=12`
- `GET /api/progress/stats/prs` — top load, best reps, lifetime sets and Epley `est_1rm` per lift,
  plus a `lifts` object (`squat`, `bench`, `deadlift`, `overhead`).
- `GET /api/progress/stats/heatmap?weeks=26` — one cell per day: `{ date, sessions, minutes, meals_logged }`.
- `GET /api/progress/stats/muscles?days=28` — volume per muscle group, normalised to `pct` of the top group.

### Export / import
- `GET /api/progress/export` — full JSON backup (profile, metrics, workouts+sets, nutrition, plans).
- `GET /api/progress/export.csv` — two-section CSV download (`workout_log`, `nutrition_log`).
- `POST /api/progress/import` — accepts an export payload and returns `{ ok, counts }`.

---

## AI

### `GET /api/ai/status` *(public)*
```json
{
  "configured": true, "enabled": true, "fingerprint": "gsk_abc…wxyz",
  "planningModel": "openai/gpt-oss-120b", "fastModel": "openai/gpt-oss-20b",
  "fallbackChain": ["openai/gpt-oss-120b","openai/gpt-oss-20b","qwen/qwen3.8-27b"],
  "budget": {
    "tokensPerMinute": 6000, "tokensUsedThisMinute": 412, "tokensRemaining": 5588,
    "requestsPerMinute": 20, "requestsUsedThisMinute": 2,
    "requestsPerDay": 900, "requestsUsedToday": 17,
    "blocked": false, "blockedForMs": 0, "nextFreeInMs": 0,
    "totalServed": 17, "totalThrottledMs": 0, "utilisation": 7
  },
  "today": { "calls": 17, "tokens": 5210, "cache_hits": 4, "ok": 17, "errors": 0 },
  "cache": { "entries": 6, "hits": 11, "tokens_saved": 4180 }
}
```

### `GET /api/ai/models` *(auth)*
Live discovery from Groq, cached 5 minutes (`?refresh=1` to force). Audio/guard/embedding models
are filtered out. Use it to confirm what your tier actually serves.

### `POST /api/ai/test` *(auth)*
A ~10-token round trip. Returns `{ ok, model, reply, usage, latencyMs, budget }`, or a
`hint` explaining a 401/404.

### `PUT /api/ai/budget` *(auth)*
`{ tokensPerMinute?, requestsPerMinute?, requestsPerDay? }` — runtime governor tuning, and it
clears any active block.

### `POST /api/ai/plans/training`
```json
{ "mode": "overlay", "weeks": 4, "force": false }
```
- `mode: "overlay"` (default) — engine builds the plan, model personalises the delta (~300 tokens).
- `mode: "full"` — the model authors the whole plan, merged field-by-field over the engine
  skeleton so nothing can be missing (~4× the tokens).
- `force: true` — bypass the cache.
- `412` if height/weight are missing from the profile.

**Streaming:** append `?stream=1` for SSE. Events:

```
event: progress
data: {"phase":"throttled","waitMs":8400,"budget":{…}}

event: progress
data: {"phase":"retrying","attempt":2,"waitMs":4000,"model":"openai/gpt-oss-120b","reason":"Rate limit reached"}

event: done
data: {"id":12,"plan":{…},"source":"ai","budget":{…}}
```
`phase` ∈ `throttled` (waiting for budget), `reserved`, `retrying`, `degraded`.
The `done` event always carries the full plan — even in engine-only mode, where no `progress`
events are emitted at all.

**Plan shape** (identical whether `source` is `ai`, `cache` or `engine`):
```json
{
  "meta": { "name": "…", "kind": "training", "weeks": 4, "days_per_week": 4, "session_minutes": 65,
            "goal": "muscle_gain", "experience": "intermediate", "equipment": "full_gym",
            "weekly_working_sets": 96, "source": "ai", "model": "openai/gpt-oss-20b",
            "tokens": 612, "mode": "overlay", "personalised": true, "generated_at": "…" },
  "overview": "…",
  "principles": ["…"],
  "red_flags": ["…"],
  "schedule": [ {
    "day": 1, "day_name": "Monday", "title": "Push — Chest, Shoulders, Triceps",
    "focus": "push", "duration_min": 65, "working_sets": 24, "notes": "…",
    "blocks": [ { "name": "Warm-up", "type": "warmup", "minutes": 10,
                  "items": [ { "exercise": "Zone 1 cardio", "detail": "4-6 min" } ] } ],
    "exercises": [ {
      "exercise_id": "bench_press", "name": "Barbell Bench Press", "role": "primary",
      "sets": 4, "reps": "6-10", "load": "65-80% 1RM", "tempo": "2-0-1",
      "rest_s": 120, "rpe": "7-8", "muscles": ["chest","triceps","front delt"],
      "equipment": "barbell", "cues": "…", "progression": "…", "swap_reason": "…"
    } ]
  } ],
  "progression": { "model": "Double progression", "rule": "…", "weekly": "…", "deload": "…" },
  "weekly_progression": [ { "week": 1, "label": "Build 1", "volume": "100% …", "instruction": "…" } ]
}
```

### `POST /api/ai/plans/nutrition`
Same streaming behaviour. Plan shape:
```json
{
  "meta": { "name": "…", "kind": "nutrition", "diet_pref": "omnivore", "goal": "muscle_gain", "source": "ai" },
  "targets": { "calories": 3254, "protein_g": 181, "carbs_g": 399, "fat_g": 82, "fiber_g": 32,
               "water_l": 3.1, "bmr": 1874, "tdee": 2905, "deficit_or_surplus": 349,
               "expected_rate": "0.29 kg/week", "protein_pct": 22, "carbs_pct": 49, "fat_pct": 23 },
  "rationale": "…",
  "meals": [ { "name": "Breakfast", "time": "07:00", "target_calories": 716, "calories": 712,
               "protein_g": 40, "carbs_g": 88, "fat_g": 18,
               "foods": [ { "name": "Greek yogurt 0%", "grams": 200, "calories": 118, "protein_g": 20, … } ],
               "notes": "…" } ],
  "plan_totals": { … }, "training_day_adjustments": ["…"], "swap_list": [ … ],
  "supplements": [ { "name": "Creatine monohydrate", "dose": "5 g daily", "note": "…" } ],
  "grocery": ["…"], "rules": ["…"], "adherence_tip": "…"
}
```

### Plans lifecycle
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ai/plans?kind=training` | List (metadata only) |
| GET | `/api/ai/plans/:id` | Full plan |
| GET | `/api/ai/plans/active/:kind` | The active one (`training` or `nutrition`) |
| POST | `/api/ai/plans/:id/activate` | Make it active (deactivates siblings) |
| DELETE | `/api/ai/plans/:id` | Remove |

Newly generated plans are activated automatically.

### `POST /api/ai/coach`
`{ message, session_id? }` (≤ 1200 chars). Returns:
```json
{ "id": 41, "message": "…", "source": "ai", "model": "openai/gpt-oss-20b",
  "tokens": 388, "budget": { … } }
```
`source` is `ai`, `engine` (no key), `engine:throttled` (budget empty) or `engine:error`.
The last 8 messages of the session are sent as context.

`GET /api/ai/chat?session_id=default` · `DELETE /api/ai/chat` ·
`GET /api/ai/coach/suggest` → canned prompts for the UI.

### `GET /api/ai/insight`
A cached weekly read-out: `{ insight: { headline, advice, watch, source }, stats: { … } }`.
Costs ≤ 220 tokens and is cached per user per day.

### `GET /api/ai/usage?days=7`
`per_day`, `by_endpoint`, `by_model` and the 25 most recent calls — your token spend audit trail.

### `POST /api/ai/cache/purge`
`{ kind? }` — clears cached AI responses.

---

## Rate limits

| Scope | Limit |
|---|---|
| `/api/auth/*` | 60 req/min per IP |
| register | 8 req/min per IP |
| login | 12 req/min per IP |
| AI plan generation | `AI_COOLDOWN_SECONDS` (default 5) per user |
| Groq upstream | `GROQ_TPM` / `GROQ_RPM` / `GROQ_RPD`, enforced by the sliding-window governor and clamped further by Groq's own response headers |
