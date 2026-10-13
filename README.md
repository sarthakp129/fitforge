# FitForge

**Train. Eat. Evolve.** A self-hosted, full-stack fitness platform with a dark glass
interface and an AI coach that is engineered to live inside a **free-tier Groq key**.

Training plans, meal plans, workout logging, nutrition tracking, progress analytics and a
coach you can ask anything — all running on your own machine, with your own data, in Docker.

---

## Why the AI layer is built the way it is

Free Groq keys are tightly capped (roughly **8K tokens/min, 30 req/min, 1K req/day**, and some
keys report as little as 1K TPM). A naive "send the prompt, get the plan" integration burns
that budget in a couple of clicks and then starts returning `429`s. FitForge treats the limit
as a design constraint:

| Technique | What it buys you |
|---|---|
| **Local engine first** | A complete, science-based plan (split, sets, reps, tempo, rest, progression, deload, meals in grams) is generated deterministically on your server for **zero tokens**. |
| **Overlay prompting** | Groq is asked only for the *personalisation delta* — overview, principles, per-day notes, justified exercise swaps. ~300 output tokens instead of ~1500. |
| **Sliding-window governor** | Every call reserves an estimated cost, waits for room, then reconciles with the real `usage` Groq reports. Concurrent requests queue FIFO and can never overspend. |
| **Header-driven adaptation** | `x-ratelimit-*` and `Retry-After` clamp the budget live. A tier change on Groq's side never breaks a session. |
| **Model fallback chain** | Retired or unavailable models fall through automatically (see below). |
| **Content-addressed cache** | Identical requests are served from SQLite for 14 days. Regenerating the same plan is free. |
| **Graceful decay** | No key, empty budget, timeout, or invalid JSON → you still get a full plan, flagged `source: "engine"`. The UI always tells you which one answered. |

> **Model note (important).** Groq decommissioned `llama-3.3-70b-versatile` and
> `llama-3.1-8b-instant` on the free/developer tiers on **2026-08-16**. FitForge defaults to
> the current models — `openai/gpt-oss-120b` (planning) and `openai/gpt-oss-20b` (chat) — with
> `qwen/qwen3.8-27b` in the fallback chain. Run `GET /api/ai/models` to see exactly what *your*
> key can call, or click **List available models** in Settings.

---

## Quick start (Docker)

```bash
cp .env.example .env
# put your key in .env:  GROQ_API_KEY=gsk_...
# and a real secret:     JWT_SECRET=$(openssl rand -hex 32)

docker compose up --build
```

| URL | What |
|---|---|
| **http://localhost:8081** | The app (nginx serves the SPA and proxies `/api`) |
| http://localhost:8080/api/health | Backend health + live token budget |
| http://localhost:8080/api | Route index |

Create an account on the landing page, complete the four-step onboarding, and your first
training + nutrition plans are generated immediately.

> `frontend/dist` is not committed — the `web` image builds it during `docker compose up --build`.
> If you run the API alone (no Docker), build it once with `cd frontend && npm run build` and the
> backend will serve it from `http://localhost:8080` as well.

> **The api container refuses to boot in production with the placeholder `JWT_SECRET`.** That is
> deliberate: a known signing key means anyone can forge a session token. Put a real one in `.env`:
> ```bash
> echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
> ```

> Everything works **without** a Groq key. You'll get plans from the local engine
> (`source: engine`) and rules-based coach answers. Add the key to switch on personalisation.

### Get a free Groq key
1. Sign in at <https://console.groq.com>
2. Open **API Keys** → **Create API Key**
3. Paste it into `.env` as `GROQ_API_KEY`
4. `docker compose restart api`
5. In the app: **Settings → Test connection** (a ~10-token round trip that proves the key,
   the model and the budget are all healthy)

---

## Demo account (pre-loaded athlete)

| Email | Password |
|---|---|
| `xyz@gmail.com` | `xyz` |

Seeded with 6 weeks of progressive training (23 sessions, 294 sets), 10 days
of food logs, 12 weigh-ins, active training + nutrition plans and a coach
conversation — every screen shows real-shaped data instantly. The landing page
offers a one-click **"Explore the demo account"** button when the seed exists.

- Auto-seeded when `NODE_ENV != production`, or in production only with
  `DEMO_ACCOUNT=true`. **Keep it off on anything public** — a published
  password is a backdoor, not a feature.
- Re-run any time with `npm run seed` (backend dir); it wipes and rebuilds
  *only* the demo user's rows, never real accounts.

## Local development (no Docker)

Requires **Node ≥ 22.5** (for the built-in `node:sqlite` module; tested on Node 24).

```bash
# terminal 1 — API on :8080
cd backend
npm install
cp ../.env.example .env      # or set GROQ_API_KEY in your shell
npm run dev

# terminal 2 — Vite on :5173, proxies /api to :8080
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

---

## Tests

```bash
cd backend
npm test            # 16 governor unit tests + 43 API integration tests

cd frontend
npm run test:render # server-renders every view with a seeded store
npm run test:e2e    # jsdom + REAL backend: mounts <App/>, clicks through the UI
```

The e2e suite boots the actual API on a throwaway database, seeds a realistic athlete
(4 workouts, 5 meals, 4 weigh-ins, both plans), then drives the real React tree: it completes a
set and watches the rest timer start, searches the exercise library, saves a session and finds it
in history, logs food and watches the rings move, asks the coach a question and asserts the reply
mentions protein, adds a weigh-in and re-reads it from the API, retunes the token budget from the
UI, and signs out. **88 tests, all passing.**

To also exercise live Groq calls (costs a few hundred tokens):

```bash
cd backend
GROQ_API_KEY=gsk_... TEST_LIVE=1 npm run test:api
```

---

## Configuration

Every value lives in `.env` (see [`.env.example`](.env.example) for the annotated list).

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | — | Your free key. Empty ⇒ engine-only mode. |
| `GROQ_ENABLED` | `true` | Master switch for AI calls. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Planning / full-rewrite model. |
| `GROQ_MODEL_FAST` | `openai/gpt-oss-20b` | Chat + overlays (cheaper). |
| `GROQ_MODEL_CHAIN` | built-in | Comma-separated fallbacks. |
| `GROQ_TPM` / `GROQ_RPM` / `GROQ_RPD` | `6000` / `20` / `900` | Governor ceilings. Lower these if your key is on a smaller allowance. |
| `GROQ_REASONING_EFFORT` | `low` | `gpt-oss` are reasoning models; reasoning tokens count against TPM. |
| `GROQ_MAX_TOKENS_PLAN` / `_CHAT` | `900` / `500` | Output caps. |
| `GROQ_CACHE_TTL_SECONDS` | `1209600` | Plan cache lifetime (14 days). |
| `ENGINE_FALLBACK` | `true` | Return a local plan instead of an error when AI fails. |
| `AI_COOLDOWN_SECONDS` | `5` | Per-user spacing between AI calls. |
| `JWT_SECRET` | dev fallback | **Set this in production.** `openssl rand -hex 32`. |
| `WEB_PORT` / `API_PORT` | `8081` / `8080` | Host ports. |
| `CORS_ORIGINS` | `*` | Only needed if the SPA is on another origin. |

The budget can also be retuned **at runtime** from Settings (or `PUT /api/ai/budget`) without a
restart — handy when you discover what your key actually allows.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  browser                                                             │
│  React 18 · Vite · zustand · dark-glass design tokens                │
│  hand-rolled SVG charts · no CDN, no external fonts, works offline   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  /api  (nginx reverse proxy, SSE-aware)
┌───────────────────────────────▼──────────────────────────────────────┐
│  api container — Node 24, Express 5, 2 runtime deps                  │
│                                                                      │
│  routes/     auth · profile · training · nutrition · progress · ai   │
│  services/   tokenBudget  sliding-window governor (TPM/RPM/RPD)      │
│              groqClient   retry · backoff · Retry-After · fallback   │
│              aiCache      content-addressed, 14-day TTL              │
│              planEngine   deterministic plans (0 tokens)             │
│              aiService    overlay prompts · validation · merging     │
│              nutrition    Mifflin-St Jeor · TDEE · macros · Epley    │
│  db.js       node:sqlite, WAL, foreign keys — no native build step   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    named volume `fitforge-data` → /app/data/fitforge.db
```

**Data model:** `users`, `profiles`, `metrics`, `workout_logs`, `sets`, `nutrition_logs`,
`ai_plans`, `ai_cache`, `ai_usage`, `chat_messages`. `sets.date` is denormalised so volume,
heatmap and muscle-balance queries never need a join.

### The design system: soft neumorphism, one theme
Every surface is carved from one uniform soft blue-grey material. Depth
carries meaning: **raised = touch**, **inset =
receive** (inputs, tracks, wells, pressed states), **flat = read**. One light
source (top-left) drives every shadow pair, so the whole UI reads as a single
carved object; buttons press *in* on click for tactile feedback. Borders are
almost never used — grooves and shadows do the structure. Accent colour
(ember) is reserved for decisions: primary actions, progress, PRs. Text tokens
stay ≥ 4.5:1; `prefers-reduced-motion` flattens everything. A subtle ember
cursor-light trails the pointer on fine-pointer devices.
Dark mode was built and then removed on the owner's decision: one material,
executed perfectly, beats two maintained halfway.

---

## API

Full route list: `GET /api`. Highlights:

```
POST   /api/auth/register | /api/auth/login         → { token, user, profile }
GET    /api/auth/me
GET    /api/profile                                  → profile + BMR/TDEE/macros + option lists
PUT    /api/profile                                  → validated & clamped
POST   /api/profile/onboard                          → one-shot onboarding

GET    /api/training/exercises?q=&muscle=&category=&equipment=
GET    /api/training/next?date=                      → today's session + last load per exercise
POST   /api/training/workouts                        → log a session with sets
GET    /api/training/workouts?from=&to=&limit=

GET    /api/nutrition/foods?q=&category=
POST   /api/nutrition/log | /api/nutrition/log-batch
GET    /api/nutrition/daily?date= | /api/nutrition/range?days=
POST   /api/nutrition/copy-day

GET    /api/progress/stats/overview                  → headline numbers + streaks
GET    /api/progress/stats/volume|prs|heatmap|muscles
POST   /api/progress/metrics
GET    /api/progress/export | /api/progress/export.csv
POST   /api/progress/import

GET    /api/ai/status                                → budget, cache, today's usage
GET    /api/ai/models                                → live model discovery for your key
POST   /api/ai/test                                  → ~10-token connectivity check
POST   /api/ai/plans/training   {?stream=1}          → SSE progress events + done
POST   /api/ai/plans/nutrition  {?stream=1}
GET    /api/ai/plans | /api/ai/plans/active/:kind
POST   /api/ai/coach | GET /api/ai/chat
GET    /api/ai/insight | /api/ai/usage?days=
PUT    /api/ai/budget                                → runtime governor tuning
```

Errors use one envelope: `{ error, message, ...details }` with a status-derived `error` code
(`invalid_request`, `unauthorized`, `precondition_failed`, `rate_limited`, `budget_exhausted`,
`daily_quota`, …). `429` responses carry `retryIn`.

### Example

```bash
TOKEN=$(curl -s localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"secret"}' | jq -r .token)

curl -s localhost:8080/api/ai/plans/training \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"mode":"overlay","weeks":4}' | jq '.plan.meta, .plan.schedule[0].title'
```

---

## The exercise science, briefly

- **BMR** — Mifflin-St Jeor. **TDEE** — BMR × activity factor (1.2–1.9).
- **Goal adjustment** — cut ×0.80, recomp ×0.95, maintain ×1.00, strength ×1.05,
  muscle gain ×1.12, endurance ×1.10.
- **Protein** — 2.2 g/kg (cut), 1.9 g/kg (gain/strength), 1.8 g/kg (recomp), 1.5 g/kg (endurance).
  **Fat** — 0.85–0.95 g/kg. **Carbs** — whatever calories remain, floored at 60 g.
- **Splits** — 1–2 days: full body; 3: PPL; 4: upper/lower/push/pull; 5: PPL+UL; 6: PPL×2;
  7: PPL+UL+recovery.
- **Rep ranges** — strength 3–6 @ 80–88%, hypertrophy 6–10 @ 65–80%, fat loss 8–12 @ 60–75%,
  endurance 12–20 @ 55–70%. Rest periods scale with the scheme.
- **Progression** — linear (beginner), double progression (default), wave loading (strength),
  with a scheduled deload week.
- **Injury filtering** — a knee complaint removes leg extensions, split squats and lunges;
  a back complaint removes deadlifts and front squats; a shoulder complaint removes pressing.
- **Equipment filtering** — a `home_bodyweight` plan can never contain a barbell; shortfalls are
  topped up from a bodyweight/band pool instead of silently relaxing the constraint.
- **1RM** — Epley (`w × (1 + reps/30)`).

*FitForge is a training tool, not medical advice. The coach is instructed to refer out for pain,
injury and disordered-eating signals.*

---

## Project layout

```
fitforge/
├── docker-compose.yml          # api + web, named volume for SQLite
├── .env.example                # every setting, annotated
├── backend/
│   ├── Dockerfile              # node:24-alpine, multi-stage, tini, non-root, healthcheck
│   ├── src/
│   │   ├── index.js            # Express app + boot banner
│   │   ├── config.js           # env parsing, model defaults
│   │   ├── db.js               # node:sqlite schema + helpers
│   │   ├── lib/{env,crypto}.js # zero-dep .env loader, scrypt + JWT
│   │   ├── middleware/         # auth, rate limit, AI cooldown, errors
│   │   ├── routes/             # auth, profile, training, nutrition, progress, ai
│   │   ├── services/           # tokenBudget, groqClient, aiCache, aiService,
│   │   │                       # planEngine, nutrition
│   │   └── data/               # 102 exercises, 62 foods
│   └── test/                   # governor unit tests + API smoke tests
├── frontend/
│   ├── Dockerfile              # vite build → nginx:alpine
│   ├── nginx.conf              # SPA + /api proxy with SSE support
│   ├── src/
│   │   ├── App.jsx             # shell, view routing, API-down banner
│   │   ├── components/         # Landing, Onboarding, Dashboard, Training,
│   │   │                       # Nutrition, Coach, Progress, Settings, Nav,
│   │   │                       # Charts, ui, ErrorBoundary
│   │   ├── lib/{api,format}.js
│   │   ├── store/useStore.js
│   │   └── styles/             # tokens.css (dark glass tokens) +
│   │                           # global.css (base + components), no external assets
│   ├── test/                   # render test + jsdom e2e suite
│   └── scripts/                # test runners
└── docs/                       # API reference
```

---

## Voice (Groq Whisper + Orpheus)

- **Dictate to the coach** — mic button in the coach popup: Chromium's built-in
  dictation types it live (free, no quota); on browsers without it, your speech
  goes to `whisper-large-v3-turbo` instead. Either way the transcript lands in
  the composer editable, and you hit send.
- **Voice meal logging** — "Voice log" on the Nutrition page: say
  *"150 grams of chicken and 200 grams of rice for lunch"* → transcript (browser
  dictation, Whisper fallback) → deterministic parser (aliases + grams
  before/after the food name + meal keywords) → a confirmation list with gram
  sliders → batch log. No AI in the parsing, so it never invents food.
- **Spoken coach replies** — speaker toggle in the coach popup header streams the reply
  through `canopylabs/orpheus-v1-english`. **One-time prerequisite:** the org admin must
  accept the Orpheus model terms in the Groq console (Models → Orpheus → Accept); until
  then the toggle degrades to text with a friendly notice. Capped at 25 voice replies/day.
- **Privacy:** audio bytes are forwarded to Groq and never written to disk or the DB.
  Usage is logged as counts/latency only, never transcripts or audio.
- **Where the mic works:** browsers expose mic APIs only in secure contexts —
  `localhost` qualifies, plain-HTTP LAN IPs (phone testing) do not. On those
  devices, or on machines without a microphone, the mic buttons hide themselves
  gracefully and typing remains.

## Operations

```bash
docker compose logs -f api          # watch requests + AI telemetry
docker compose exec api node -e "..." 
docker volume inspect fitforge-data # where your SQLite file lives
docker compose down                 # stop (data survives)
```

**Backups** — everything is one file:

```bash
docker compose exec api sh -c 'cp /app/data/fitforge.db /tmp/backup.db'
docker compose cp api:/tmp/backup.db ./fitforge-backup.db
```

Or use **Progress → Export JSON** (full restore via **Import**) and **Export CSV** (spreadsheets).

**Watch token spend** — `GET /api/ai/usage?days=30` breaks usage down by day, endpoint and model,
with cache hits. The same data is in Settings.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot reach the FitForge API` banner | The api container isn't healthy: `docker compose logs api`. |
| Plans say `local engine` | Expected without a key. With a key, check **Settings → Test connection**; a 401 means a bad key, a 404 means the model isn't on your tier (`GET /api/ai/models`). |
| `Token budget saturated` / `Daily Groq request quota exhausted` | The governor is doing its job. Wait for the window, lower `GROQ_TPM` to match reality, or rely on the engine — plans stay complete either way. |
| Coach replies feel generic | That's the offline coach. Check the budget meter in the nav; below ~150 tokens it answers locally by design. |
| `ExperimentalWarning: SQLite` | Expected on Node 20–23; suppressed in the app's own logs. `node:sqlite` is stable in Node 24. |
| Port already in use | Change `WEB_PORT` / `API_PORT` in `.env`. |
| Blank screen after deploy | The SPA build is missing: `docker compose build --no-cache web`. |
| api container exits instantly with `refusing to start in production` | `JWT_SECRET` is empty or still the placeholder. Set `JWT_SECRET=$(openssl rand -hex 32)` in `.env` and `docker compose up -d`. |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | You are on Node < 22.5 for a local (non-Docker) run. Use Node 22.5+ (24 recommended), or just use Docker. |

---

## Notes & limits

- **Single-node by design.** The token governor and rate limiters are in-process, which is exact
  for one API replica. Scale past one replica and move them to Redis before you trust the numbers.
- **Passwords** are scrypt-hashed with a per-user salt; **sessions** are HS256 JWTs. There is no
  email verification or password reset — add SMTP if you expose this to the internet.
- **No payment, no tracking, no third-party calls** except Groq. The frontend loads zero external
  resources, so it renders identically offline.
- The food database is a 62-item starter set with per-100 g macros. Unknown foods can always be
  logged with manual macros; swap in a full dataset (USDA, Open Food Facts) by replacing
  `backend/src/data/foods.json`.
