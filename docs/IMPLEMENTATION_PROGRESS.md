# FitForge implementation progress

## Phase checklist

- [x] Phase 0 — baseline audit and safe checkpoint
- [x] Phase 1 — security and data integrity
- [ ] Phase 2 — authentication and account management
- [ ] Phase 3 — food and exercise discovery
- [ ] Phase 4 — faster logging
- [ ] Phase 5 — personalization and controlled AI
- [ ] Phase 6 — UI/UX refinement
- [ ] Phase 7 — production readiness
- [ ] Phase 8 — end-to-end verification

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

- `backend/npm test`: passed (49 API smoke tests, 16 token-governor tests, 7 cache-key tests).
- `frontend/npm run build`: passed.
- `frontend/npm run test:render`: passed. React emitted expected server-render `useLayoutEffect` warnings from router/component rendering.
- `frontend/npm run test:e2e`: passed (24 live API/UI journeys). The harness now explicitly blocks inherited local environment credentials.
- Docker startup follow-up: the first container run built both images but API startup failed because `backend/Dockerfile` omitted the `scripts/` directory imported by `src/index.js`. Added the runtime copy; `docker compose up --build -d` now reports API healthy and `http://localhost:8081/api/health` returns `ok: true`.
- `frontend/npm ci` reported two dependency audit findings (one moderate and one high); remediation has not been applied blindly and remains for Phase 7 dependency-path review.

## Phase 1 completed

- Added authenticated HttpOnly same-site session cookies for the first-party UI while retaining short-lived bearer-token compatibility for non-browser API clients. Legacy browser localStorage persistence is removed.
- Added persistent `session_version`; password changes and logout revoke prior sessions. Password hashing and verification on request paths are asynchronous and new passwords require 12 characters.
- Removed URL and `x-token` authentication fallbacks; login rate limiting is now deliberately tighter.
- Hardened `/api/progress/import`: strict schemas, real dates, field limits, array/row caps, atomic transactions, and a documented idempotency policy for metrics/workouts/nutrition.
- Restricted proxy trust to explicit `TRUST_PROXY_HOPS`, made production CORS opt-in, removed direct API publication from Docker Compose, and added CSP/security headers.
- Disabled AI runtime tuning by default; budget/cache administration requires both an explicit toggle and an allowlisted administrator. AI telemetry is user-scoped and configurable per-user/daily speech limits are enforced.
- Corrected local demo seeding to retain synchronous crypto only outside the HTTP request path.

## Files changed in Phase 1

- `backend/src/{config,db,index}.js`
- `backend/src/lib/crypto.js`, `backend/src/middleware/auth.js`
- `backend/src/routes/{auth,progress,ai}.js`
- `backend/scripts/seed.js`, `backend/test/smoke.test.js`
- `frontend/src/{lib/api,store/useStore}.js`, `frontend/nginx.conf`, `docker-compose.yml`

## Next phase

Phase 2: Google identity integration and broader profile/account preferences. This needs Google OAuth client configuration to be live-tested; email/password operation remains available without it.

