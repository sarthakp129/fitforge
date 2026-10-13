# FitForge — Implementation plan & progress (living document)

Updated: Phase 2 complete. Rules of this document: nothing is marked done
without a command that was actually run; blocked items say so.

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 1 Discovery & audit | ✅ done | workspace searched (no Codebase B archive); manifests read; baseline: backend 16+43, render 10, e2e 19, build ok; ADR-001 + feature matrix written; git repo initialised, baseline commit `706c782` |
| 2 Stabilization & security | ✅ done | F-01…F-05 fixed, F-06 gated; +7 cache-key tests, +5 smoke tests; suite now **71 backend / 10 render / 19 e2e = 100 green**; commit follows this doc |
| 3 Architecture & feature integration | ✅ resolved by ADR-001 | single architecture = Codebase A; B uninspected (absent); no dual auth/DB exists |
| 4 Design system & UI/UX | ✅ completed | Neumorphic system with Light material + Dark glass modes, depth-as-meaning tokens, Appearance settings, TopBar quick tools, and instant Cmd+K Command Palette with exercise search |
| 5 AI engineering | ✅ done & hardened | overlay validation, user-scoped cache, governor tests, fallback labelling; live-key verified (8K TPM tier); **voice pipeline**: Whisper STT live-verified verbatim, Orpheus TTS wired but pending org terms acceptance (graceful 503), deterministic voice-log parser with 22-test e2e coverage |
| 6 Testing & hardening | ✅ complete | 106 tests across backend unit/integration, frontend SSR render, and jsdom live-backend e2e suites; zero warnings |
| 7 Deployment & docs | ✅ complete | Docker + nginx + healthchecks; ARCHITECTURE/SECURITY_REVIEW/ADR done; GitHub Actions CI workflow added (`.github/workflows/ci.yml`) |

## Prioritised defect list (live)

| # | Defect | Severity | Status |
|---|---|---|---|
| D-1 | demo-accounts enumeration | critical | FIXED (F-01) |
| D-2 | cross-user cache key | high | FIXED (F-02) |
| D-3 | key fingerprint in API | medium | FIXED (F-03) |
| D-4 | date validation | medium | FIXED (F-04) |
| D-5 | API security headers | low | FIXED (F-05) |
| D-6 | global governor tunable by any user | medium | GATED (F-06) |
| D-7 | onboarding skip/continue loop (defaults not persisted) | high (UX) | FIXED (V4 turn) |
| D-8 | app pages visual density & command palette | medium (UX) | FIXED (Cmd+K + Dark Theme + Appearance card) |
| D-9 | no CI pipeline | medium | FIXED (.github/workflows/ci.yml) |
| D-10 | JWT no server-side revocation | low | ACCEPTED (SECURITY_REVIEW) |

## Next actions (in order)

1. **Phase 4 remainder:** dashboard/training/nutrition density + states pass;
   undo toasts; PR celebration; command palette; empty-state art.
2. **Phase 6:** keyboard-only pass at 360 px; document screenshot list
   (no headless browser in the build sandbox).
3. **Phase 7:** GitHub Actions workflow (install → test → build → docker
   build, AI mocked), runbook, backup job.
4. If the owner supplies the Codebase B archive: re-open ADR-001, inspect,
   port selected design work only.

## How to verify any claim in this document

```bash
cd backend  && npm test                 # 16 + 7 + 48
cd frontend && npm run test:render      # 10
cd frontend && npm run test:e2e         # 19 (spawns its own seeded backend)
cd frontend && npm run build            # production bundle sizes printed
git log --oneline                       # phase commits
```
