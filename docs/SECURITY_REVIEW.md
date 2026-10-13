# FitForge — Security review (Phase 2)

Scope: Codebase A as of the Phase-2 commit. Method: route-by-route audit of
authentication, authorization, validation, data exposure, plus dependency and
deployment review. Every finding lists status **FIXED** / **ACCEPTED** (with
rationale) / **OPEN**.

## Findings

### F-01 Public endpoint listed user records — FIXED (critical)
`GET /api/auth/demo-accounts` returned ids, emails and names of up to 20
users, unauthenticated. Removed entirely; regression test asserts 404.

### F-02 Cross-user plan leakage through the AI cache — FIXED (high)
Cache keys were `hash(kind + profile + options)` with **no user id**, while
the AI overlay is personalised from the requester's log history. Two users
with identical profiles could receive the same cached, other-person
personalisation. Keys now include `userId` plus a signature of the log
context (recent sessions, top lifts, weigh-ins) and all options. Seven
policy tests in `test/cacheKeys.test.js` pin this, including
"different user, identical everything else ⇒ different key".

### F-03 Key material exposed via `/api/ai/status` — FIXED (medium)
The response included a masked fingerprint (`gsk_abc…wxyz`). Even masked
prefixes help an attacker verify guesses. The field is gone from all API
responses; the fingerprint is printed to the server boot log only. Test
asserts the status payload never contains `gsk_`.

### F-04 Unvalidated date strings reached SQL date functions — FIXED (medium)
Body-supplied `date` values were sliced, not validated (`"abc"` stored
fine). All write routes now reject non-calendar `YYYY-MM-DD` with 400
(`lib/validate.js`); malformed *query* dates fall back to a safe default
instead of erroring. Five regression tests.

### F-05 Missing security headers when the API is reached directly — FIXED (low)
Headers existed only in nginx. Express now sets `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on every response,
so bare-API deployments are covered. Test asserts them on `/api/health`.

### F-06 Any logged-in user could retune the global token governor — ACCEPTED, gated (medium)
`PUT /api/ai/budget` and `POST /api/ai/cache/purge` are instance-wide, not
per-user. FitForge is designed as single-tenant self-hosting (family/team
server), where every account is trusted. For multi-user deployments the new
`AI_RUNTIME_TUNING=false` env flag disables both (403). Documented here and
in `.env.example`.

### F-07 Weak/placeholder JWT secret in production — FIXED earlier (high)
A copied `.env.example` would have shipped a public signing key. Boot now
provisions a 96-char random key, persists it `0600` next to the database,
reuses it across restarts, and only uses `JWT_SECRET` from env when it is
strong and non-placeholder. Verified by boot tests (generate → reuse → env).

### F-08 Account enumeration — ACCEPTED (low)
`POST /api/auth/register` answers 409 for existing emails (unavoidable for
correct UX without an email channel); login is generic ("Incorrect email or
password") with equal work for unknown emails vs wrong passwords, and both
routes are rate-limited (8/12 per minute per IP). Documented residual risk.

## Verified-safe areas (evidence: tests + code review)

- **Ownership:** every read/write/delete on `workout_logs, sets,
  nutrition_logs, metrics, ai_plans, chat_messages` filters by JWT subject;
  e2e + API suites include cross-user attempts (import/export round-trips on
  a second account never see the first account's rows).
- **Passwords:** scrypt (N=16384 default) with per-user 16-byte salt,
  constant-time compare. **Sessions:** HS256 JWT, 30-day expiry, no refresh
  rotation (ACCEPTED: self-hosted; logout is client-side token drop —
  documented limitation).
- **Injection:** all SQL parameterised (`?`); no string concatenation of user
  input into queries; identifiers for ORDER/GROUP are static.
- **Body limits:** 2 MB JSON cap; arrays capped (sets ≤200, batch ≤100,
  history ≤60); strings length-capped at the route layer.
- **CSRF:** not applicable — bearer tokens in `Authorization`, no cookies.
- **XSS:** React escapes by default; no `dangerouslySetInnerHTML` except the
  last-resort crash page in `main.jsx`, which inserts only `e.message` from
  local errors (ACCEPTED, monitored).
- **Secrets:** `.env` git-ignored and absent from exports/logs; exports
  select explicit columns (no password hashes); test runner no longer
  inherits developer `.env` keys (`ENV_FILE` override).
- **AI trust boundary:** model output is never executed or persisted raw —
  exercise ids are validated against the catalogue and equipment filter,
  strings are length-capped, arithmetic is always deterministic server code.

### F-09 Voice pipeline privacy — FIXED by design (info)
Audio from the microphone is streamed to Groq (`/audio/transcriptions`) and the
response text is returned to the browser; **nothing is written to disk or the
database**, and usage telemetry stores counts/latency only — never transcripts
or audio. Transcripts enter the coach exactly like typed text (same length
caps, same validation). Voice replies are capped at 25/day server-side
(Orpheus free tier is 3.6K text-tokens/day) and the cap returns a 429 with a
plain-English message instead of a raw provider error.

## Open items (honest list)

1. **No server-side logout invalidation** (stateless JWT). Mitigation: short
   enough TTL + self-hosted trust model. A token-version column is the
   cheap fix if multi-user hosting ever appears.
2. **No automated dependency scanning in CI** (CI itself is Prompt-3 work).
3. **Rate limits are per-process**; two API replicas would double them.
   Documented single-node constraint.
4. **Login timing side-channel** (scrypt runs only for existing users) —
   theoretical at these rate limits; accepted.
