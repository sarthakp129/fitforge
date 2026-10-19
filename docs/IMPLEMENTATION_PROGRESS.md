# FitForge implementation progress

## Phase checklist

- [x] Phase 0 — baseline audit and safe checkpoint
- [x] Phase 1 — security and data integrity
- [x] Phase 2 — authentication and account management
- [x] Phase 3 — food and exercise discovery
- [x] Phase 4 — faster logging
- [x] Phase 5 — personalization and controlled AI
- [x] Phase 6 — UI/UX refinement
- [x] Phase 7 — production readiness
- [x] Phase 8 — end-to-end verification

## Baseline (2026-10-19)

- Branch: `main`, initially clean (`main...origin/main`).
- Stack confirmed: React/Vite/Zustand frontend; Express 5 with Node `node:sqlite` backend; Docker/nginx production layout.
- Built-in catalogues: 95 foods and 102 exercises.
- Existing verification commands: `npm test` in `backend`; `npm run build`, `npm run test:render`, and `npm run test:e2e` in `frontend`.
- Git-tracked sensitive-file check found only `.env.example`; runtime `.env`, SQLite databases, WAL/SHM files, and `backend/data/` are ignored. No credential values were inspected or copied.
- Confirmed findings to address: query-string auth fallback, synchronous scrypt, six-character password policy, unbounded/non-transactional import, published API port, permissive production CORS default, unsafe AI runtime tuning default, and server-local date policy.

## Decisions

- Preserve the existing stack and existing scrypt account hashes. Harden the current JWT system with server-side session versioning rather than introduce an account migration dependency.
- Treat the browser as untrusted; all imports and ownership-sensitive writes will be validated and scoped on the server.
- Keep external providers optional, with local data and deterministic features as the reliable fallback.

## Verification

- `backend/npm test`: passed (59 API smoke tests, 17 token-governor tests, 7 cache-key tests, 8 Google ID token tests).
- `frontend/npm run build`: passed (production bundle built in 2.04s).
- `frontend/npm run test:render`: passed cleanly across all views (Landing, Dashboard, Training, Nutrition, Progress, Settings, Onboarding).
- `frontend/npm run test:e2e`: passed (24 live API/UI journeys passing 100%).

## Phase 1 completed

- Added authenticated HttpOnly same-site session cookies for the first-party UI while retaining short-lived bearer-token compatibility for non-browser API clients. Legacy browser localStorage persistence is removed.
- Added persistent `session_version`; password changes and logout revoke prior sessions. Password hashing and verification on request paths are asynchronous and new passwords require 12 characters.
- Removed URL and `x-token` authentication fallbacks; login rate limiting is now deliberately tighter.
- Hardened `/api/progress/import`: strict schemas, real dates, field limits, array/row caps, atomic transactions, and a documented idempotency policy for metrics/workouts/nutrition.
- Restricted proxy trust to explicit `TRUST_PROXY_HOPS`, made production CORS opt-in, removed direct API publication from Docker Compose, and added CSP/security headers.
- Disabled AI runtime tuning by default; budget/cache administration requires both an explicit toggle and an allowlisted administrator. AI telemetry is user-scoped and configurable per-user/daily speech limits are enforced.
- Corrected local demo seeding to retain synchronous crypto only outside the HTTP request path.

## Phase 2 completed

- Integrated Google Identity Services (GIS) with server-side Google ID token cryptographic verification (`google-auth-library`).
- Added `/api/auth/google` supporting secure passwordless sign-in and account registration.
- Enforced strict account linking security: prevents silent identity takeover by returning 409 when a matching email already has local password credentials, requiring manual linking in Settings.
- Added `/api/auth/google/link` and `/api/auth/google/unlink` for secure account management, preventing unlinking if no local password exists.
- Expanded profile schema with `timezone` (IANA string), `units` (metric/imperial), and `favorite_exercises` (persisted JSON array).
- Added `saved_meals` table and CRUD endpoints (`GET/POST/DELETE /api/profile/saved-meals`) for reusable meal presets.
- Created reusable neumorphic `<GoogleSignIn>` component on the frontend with graceful fallback when Google OAuth credentials are not configured.
- Upgraded `Settings.jsx` with athlete name editing, Google account connection status, regional units, timezone auto-detection, favorite exercise chips, and saved meal preset manager.
- Added unit tests in `backend/test/googleAuth.test.js` covering expired tokens, invalid signatures, audience mismatch, unverified emails, and valid claims.
- Extended smoke test suite with Google sign-in flows, linking/unlinking, profile preferences, and saved meal lifecycles.

## Phase 3 completed (Food & Exercise Discovery)

- Added SQLite persistence tables: `custom_foods`, `custom_exercises`, and `external_food_cache` (with index on `query_norm`).
- Built `backend/src/services/foodService.js`: unified search combining built-in foods (95 items), user custom foods, and Open Food Facts with 30-day SQLite caching, 2500ms timeout, and silent offline fallback.
- Built `backend/src/services/exerciseService.js`: unified search combining built-in exercises (102 items) + user custom exercises, and a biomechanical substitution engine (`getExerciseSubstitutes`).
- Added `optionalAuth` middleware allowing anonymous public catalogue browsing while seamlessly enriching results with private custom items for authenticated athletes.
- Integrated `/api/nutrition/custom-foods`, `/api/training/custom-exercises`, and `/api/training/exercises/:id/substitutes`.
- Added custom exercise and food creation directly inside UI modal pickers with instant selection.

## Phase 4 completed (Effortless Logging)

- Added Natural Language Meal Composer directly on the Nutrition Today tab, supporting typing and speech (e.g. *"2 rotis, 1 bowl dal, 150g chicken breast"*).
- Enhanced `parseVoiceLog.js` with count/unit multiplier parsing (*"2 eggs"*, *"1 banana"*, *"2 rotis"*) with portion and meal confirmation modal.
- Added Calorie Ring display showing both consumed and remaining calories (`left` / `over`).
- Transformed "Foods logged" into a clean count pill instead of a progress bar.
- Collapsible pre/post workout meals when empty with one-click expander.
- One-tap "Copy previous day" meals button.
- Added in-workout and plan exercise substitution trigger (`api.training.substitutes`).
- Added active set rest timer countdown with Web Audio API chime completion cue.
- Auto-filled previous working weights and reps from history and active plan targets.

## Phase 5 & 6 completed (Personalization, AI Blackbox, & UI Polish)

- Stripped all developer/token budget controls and AI provider naming from the frontend UI.
- All AI operations handled silently on backend via Groq API with deterministic local engine fallbacks and 30-day caching.
- Neumorphic UI design system preserved across all components with responsive grids.
- Quick Actions bar on Dashboard (Start workout, Log meal, Log weigh-in, Ask coach).
- Clean measurement history tracking without fake prefilled entries.

## Phase 7 completed (Production Readiness & Durability)

- Created zero-downtime SQLite backup utility `backend/scripts/backup.js` using `VACUUM INTO` and automatic snapshot integrity verification.
- Added `npm run backup` script to `backend/package.json`.
- Audited dependencies across backend and frontend (0 backend vulnerabilities; frontend dev server advisories non-impacting for production nginx container).
- Verified production build `npm --prefix frontend run build` (clean 2s build).

## Phase 8 completed (End-to-End Verification)

- Backend test suite: 59 API smoke tests, 17 token budget tests, 7 cache key tests, 8 Google ID token tests — **all passing**.
- Frontend test suite: SSR render tests across all views and 24 live JSDOM E2E journeys — **all passing**.
- All changes committed and pushed to `main` branch.

## Phase 9 completed (1-Click Demo & Vercel Deployment Resolution)

- Added permanent, prominent **"Demo"** button in navigation header, hero section, and access card:
  - Bypasses manual credential entry and automatically logs in with 1 click.
  - Implemented dedicated `POST /api/auth/demo` endpoint with automatic on-demand user seeding.
  - Implemented client-side offline mock fallback in `loginDemo()` store action so the app renders even on static-only preview deployments.
- Resolved Vercel deployment and rendering issues:
  - Replaced invalid `"services"` schema in root [vercel.json](file:///home/ric/Videos/fitforge/vercel.json) with official Vercel v2 schema.
  - Added SPA fallback rewrites (`/(.*) -> /index.html`) in root [vercel.json](file:///home/ric/Videos/fitforge/vercel.json) and [frontend/vercel.json](file:///home/ric/Videos/fitforge/frontend/vercel.json) to eliminate 404 errors on deep linking and page refresh.
  - Created root [package.json](file:///home/ric/Videos/fitforge/package.json) with Node `>=22.5.0` engine specification and monorepo build scripts.
  - Added serverless entrypoint [api/index.js](file:///home/ric/Videos/fitforge/api/index.js) delegating to the Express application.
  - Dynamic CORS handling permitting `*.vercel.app` preview deployments and localhost.
  - Set `credentials: 'include'` in API client for cross-domain cookie and session persistence.
- Verified in live browser subagent: 1-click Demo button triggers instant login and transitions directly to Dashboard.
- All commits pushed to `origin/main`.


