# FitForge — Architecture (as built, Phase 2)

Single coherent architecture: **Codebase A**. SPA + API + SQLite, Dockerized.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (SPA)                                                       │
│  React 18 · Vite · zustand · react-router-dom (real URLs, guards)   │
│  plain CSS design tokens (Light + Dark Glass) · hand-rolled SVG     │
│  charts · CSS scroll-driven animations · zero CDN/external assets   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ same-origin /api  (nginx: SSE-aware proxy,
                               │ security headers, SPA fallback, asset cache)
┌──────────────────────────────▼──────────────────────────────────────┐
│ API container — Node ≥22.5, Express 5, TWO runtime deps              │
│                                                                      │
│  middleware   auth(JWT) · rateLimit · aiCooldown · errors · headers  │
│  routes       auth · profile · training · nutrition · progress · ai  │
│  services     planEngine (0-token science) · nutrition maths         │
│               groqClient (retry/backoff/model-chain) · tokenBudget   │
│               (sliding window TPM/RPM/RPD + header sync + FIFO)      │
│               aiCache (user-scoped keys, 14 d TTL) · aiService       │
│               (overlay prompts → validate → merge → persist)         │
│  db.js        node:sqlite, WAL, FK on, named indexes, tx() helper    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ one file: fitforge.db
                       named volume fitforge-data (/app/data)
```

## Request lifecycle (AI plan generation)

1. `POST /api/ai/plans/training` → auth → cooldown → profile completeness (412).
2. `planEngine` builds the full plan locally (0 tokens).
3. Cache lookup with a **user-scoped, context-aware key** (user + profile +
   log-context signature + weeks + mode). Hit → return, `source: cache`.
4. Miss → `tokenBudget.reserve(estimate)` (FIFO; waits for window room;
   fails fast 429 with `retryAfter` when unaffordable).
5. `groqClient` calls the model chain (`gpt-oss-120b → gpt-oss-20b →
   qwen3.8-27b`), honouring `Retry-After`, exponential backoff + jitter,
   timeouts, and `reasoning_effort=low` to protect the token budget.
6. Response JSON is extracted, **validated against the catalogue** (exercise
   ids must exist and be allowed for the user's equipment; strings length-
   capped) and merged over the engine plan. Invalid → engine plan, labelled.
7. Persist (`ai_plans`, activated), cache, log usage (tokens/endpoint/model/
   latency — never prompt text), stream SSE `progress`/`done` events.

## Data model (single source of truth)

`users · profiles · metrics · workout_logs · sets · nutrition_logs · ai_plans ·
ai_cache · ai_usage · chat_messages`

- `sets.date` is denormalised from its workout so volume/heatmap/muscle
  queries never join (indexed `(user_id, date)`).
- Every user-owned table is queried with `user_id = ?` from the JWT subject;
  ownership is re-checked on every read/write/delete (see SECURITY_REVIEW).
- Writes that span tables (`POST /workouts`, plan activation) run in `tx()`.

## Frontend structure

```
src/
  pages/        NotFound (public pages consolidated in components/ until V5)
  layout/       AppLayout · TopBar · BottomNav · UserMenu · ScrollProgress
  components/   Dashboard Training Nutrition Coach Progress Settings Landing
                Onboarding Controls(Slider/Wheel/Tiles/SelectMenu) Charts ui
                ThemeToggle ErrorBoundary
  hooks/        useTheme useInView useScrollSpy useCountUp useReducedMotion useTilt
  lib/          api(SSE+error envelope) format calc(client mirror of nutrition maths) titles
  store/        zustand: auth, profile, derived targets, aiStatus, toasts, theme
  styles/       tokens.css(light+dark) global.css scroll.css
```

Routing: `/` public gate · `/login //signup` gates · protected
`/dashboard /training /nutrition /coach /progress /settings /onboarding` ·
`RequireAuth` + `OnboardingGuard` · lazy per route · titles per route ·
scroll-top on push, preserved on Back.

## Moving to PostgreSQL (documented, not implemented)

`db.js` is the only module that touches SQL execution. A Postgres adapter
would implement `run/get/all/tx` over `pg` with `$n` placeholders; schema DDL
differs only in AUTOINCREMENT→SERIAL and `datetime('now')`→`now()`. User data
moves via `GET /api/progress/export` → import script. No other module changes.
Justified only when a multi-node deployment appears; until then SQLite on a
volume is simpler and fully tested.

## Deployment

`docker compose`: `api` (node:24-alpine, tini, non-root, healthcheck, volume)
+ `web` (vite build → nginx:alpine, SSE proxy, headers, SPA fallback).
Env via `.env` (git-ignored); production refuses weak/placeholder JWT secrets
by generating+persisting a strong key instead; `AI_RUNTIME_TUNING=false`
locks the governor against runtime changes on multi-user hosts.
