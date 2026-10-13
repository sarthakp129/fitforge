# ADR-001 — Codebase selection and architecture direction

**Status:** accepted (Phase 1) · **Date:** 2026-10-13 · **Author:** engineering audit

## Context

The mission brief describes two FitForge implementations:

- **Codebase A** — React 18 + Vite + Zustand frontend; Express 5 + `node:sqlite`
  backend; custom scrypt/JWT auth; deterministic planning engine; Groq client
  with a sliding-window token governor, cache and fallbacks; Docker + nginx;
  test suites (unit, API integration, SSR render, jsdom e2e).
- **Codebase B** — reportedly Next.js App Router + React 19 + TypeScript +
  Prisma + Auth.js, with GSAP/Lenis/Three.js/R3F/Recharts and a more ambitious
  landing page; described as partially unfinished and untested.

## Evidence gathered (Phase 1 discovery)

| Check | Result |
|---|---|
| Archives (`*.zip`, `*.tar.gz`, `*.7z`, `*.rar`) anywhere in the workspace | **none found** |
| Next.js / Prisma / Auth.js artefacts (`next.config.*`, `prisma/`, `auth.ts`) | **none found** |
| `uploads/` directory | screenshots only (PNG) |
| Active repository | `/home/user/fitforge` = **Codebase A**, now under git (branch `main`) |
| Codebase B | **NOT PRESENT — never inspected.** All statements about B below are the user's description, marked unverified. |

Per mission rules ("if one or both archives are unavailable, continue improving
the accessible codebase… never invent inspection results"), this ADR decides on
the evidence available: Codebase A only.

## Feature matrix

| Capability | Codebase A (verified by tests) | Codebase B (unverified, per description) |
|---|---|---|
| Auth (register/login, hashed passwords, sessions) | ✅ scrypt + HS256 JWT, rate-limited, auto-provisioned signing key | claimed Auth.js credentials |
| Workout logging (sets/reps/weight/RPE/rest) | ✅ + repeat, delete, history | claimed |
| Exercise catalogue (102, filters, facets) | ✅ public search endpoint | claimed |
| Deterministic planning engine (splits, progression, injury/equipment filters) | ✅ 0-token, unit-tested via API suite | not claimed |
| Nutrition (food DB, logging, targets, meal plans) | ✅ 62 foods, gram maths, plan builder | claimed |
| AI personalisation + coach | ✅ overlay prompts, validated merge, labelled sources | claimed |
| Token governor (TPM/RPM/RPD, header sync, FIFO queue) | ✅ 23 dedicated unit tests | not claimed |
| Analytics (volume, PR/1RM, heatmap, muscle balance) | ✅ hand-rolled SVG charts | claimed Recharts |
| Export/import (JSON + CSV) | ✅ user-scoped | not claimed |
| Tests | ✅ 100 (16+7+48 backend, 10 render, 19 e2e) | **missing** per description |
| TypeScript / strict types | ❌ JavaScript | claimed |
| ORM + migrations | ❌ raw SQL, schema-at-boot | claimed Prisma |
| Visual direction | dark glass + light themes, scroll toolkit | claimed richer landing |
| Docker, nginx, CI-ready | ✅ compose + healthchecks | unfinished per description |

## Decision

**Keep Codebase A as the single architecture.** Rationale:

1. **Evidence over preference.** A is present, runs, and is verified by 100
   passing tests including cross-user isolation and AI-fallback paths. B could
   not be inspected at all; migrating toward an uninspected codebase would be
   guesswork, exactly what the mission forbids.
2. **Migration cost vs benefit.** Porting A's engine + governor + tests to
   Next.js/Prisma/TS is a multi-week rewrite whose main payoff (type safety,
   server components) does not outweigh the risk of losing verified behaviour
   (the mission: "do not migrate to Next.js if doing so would destroy valuable,
   reliable functionality without sufficient benefit").
3. **Deployment fit.** A SQLite file on a named Docker volume is the correct
   store for a self-hosted single-node product; serverless hosts (the usual
   Next.js deployment) cannot persist it.
4. **Explainability.** The owner must defend every line in interviews; A's
   patterns (raw SQL with named indexes, a 200-line governor, CSS scroll
   timelines) are each explainable in two minutes.

**Adopt from B's *direction*, not its code:** richer editorial landing,
stronger typographic hierarchy, and (if the owner supplies assets) an optional
contained 3D hero. All implemented in A's stack with zero new runtime deps.

## Consequences / follow-ups

- TypeScript: deferred. If desired later, adopt incrementally (`allowJs` +
  `.ts` services first), never as a big-bang rewrite.
- Prisma/Postgres: deferred. Documented migration path lives in
  `docs/ARCHITECTURE.md` §"Moving to PostgreSQL" for the day a multi-node
  deployment is needed.
- If the owner later provides Codebase B's archive, re-open this ADR: inspect,
  port *specific* valuable pieces (design tokens, landing sections), never
  merge wholesale.
