# UI Baseline Report — Phase U0

Recorded before any UI work begins. Everything below is real output from real
commands; anything that could not be measured here is listed as *not verified*.

- **Date:** 2026-10-12
- **Node used:** v24.11.0 (project requires >= 22.5)
- **Working dir:** `frontend/` unless stated
- **Environment limits:** no Docker, no headless browser, no Lighthouse in this
  sandbox. Build + unit/render/e2e tests all ran for real.

---

## 1. Commands run and results

| # | Command | Result |
|---|---|---|
| 1 | `npm install` (frontend) | 151 packages, clean |
| 2 | `npm run build` | success, ~5.0 s, no errors, 1 warning (chunk > 500 KB: `three`) |
| 3 | `npm run test:render` | **10/10 views render** ("all views rendered cleanly") |
| 4 | `npm run test:e2e` | **19 passed, 0 failed** (spawns its own backend + seeded DB) |
| 5 | `npm test` (backend, from `backend/`) | **16 + 43 passed, 0 failed** |

Zero failures at baseline. Zero skipped tests.

## 2. Baseline bundle (production build)

| Asset | Raw | Notes |
|---|---|---|
| `assets/three-*.js` | **484.47 kB** (~122 kB gzip) | three.js manual chunk — target for removal in U1 |
| `assets/react-*.js` | 140.88 kB (~45 kB gzip) | react + react-dom manual chunk |
| `assets/index-*.js` | 52.92 kB (~19 kB gzip) | app shell + store + api client |
| `assets/index-*.css` | 17.53 kB (~5 kB gzip) | all styles, single `global.css` |
| route chunks (8) | 6.9–22.0 kB each | lazy-loaded per screen |
| **dist total (all files)** | **812 kB** | |
| **js+css raw** | 780 kB | |
| **js gzipped total** | **215.5 kB** | |

Expected after U1 (three removed): ~330 kB raw dist, ~93 kB gzip js+css. To be
re-measured, not assumed.

## 3. Facts verified in the repo (prompt section 3 cross-check)

| Claim in prompt | Reality | Match |
|---|---|---|
| React 18 + Vite 5 + Zustand + plain CSS | react ^18.3.1, vite ^5.4.11, zustand ^4.5.5, one `global.css` | yes |
| `global.css` 419 lines | 419 | yes |
| `Training.jsx` 694 / `Nutrition.jsx` 560 / `Dashboard.jsx` 326 | 694 / 560 / 326 | yes |
| No router; `view` in the Zustand store switches screens | `view:` at `useStore.js:22`, `setView` used across pages | yes |
| Screens: Landing, Onboarding, Dashboard, Training, Nutrition, Coach, Progress, Settings + Nav, Charts, ui.jsx, ErrorBoundary | all present in `src/components/` | yes |
| Charts exports (LineChart, BarChart, Heatmap, MuscleBars, BudgetGauge, Sparkline) | present in `Charts.jsx` (254 lines) | yes |
| ui.jsx kit (Card, CardHead, Button, Chip, Field, Input, Select, Segmented, Stat, Bar, Rings, Modal, Empty, Skeleton, Toaster, Reveal, Icon) | present (272 lines) | yes |
| 3D layer = `Scene.jsx` + `three/SceneManager.js` | 40 + 413 lines | yes |
| Tokens `--ink --bg --surface --ember --teal --violet --radius* --shadow* --ease --nav-h` | all defined in `:root` | yes |
| `npm run test:render` / `test:e2e` exist | yes | yes |
| "It is not glassmorphic" | **partly wrong**: light theme already uses `backdrop-filter: blur(...)` on `.card`, `.nav`, `.hero-badge` (8 occurrences) | see deltas |
| "test:e2e needs the backend running" | **wrong**: `scripts/e2e-test.mjs` spawns its own backend on a random port with a seeded throwaway DB | see deltas |
| dist ~812 kB, three chunk 484 kB / 122 kB gzip | 812 kB, 484.47 kB / 122.47 kB gzip | yes |

## 4. Deltas the later phases must handle (found during U0)

1. `global.css` already contains frosted-glass surfaces (8 `backdrop-filter`
   rules) — U1 restyles them rather than introducing blur from scratch.
2. `index.html` has light `theme-color` `#fbfbfd` and a `<noscript>` text that
   mentions the 3D scene — both must change in U1 (spec section 5).
3. `vite.config.js` has a `manualChunks.three` entry — deleting the dependency
   without deleting this key breaks the build; remove both together in U1.
4. Dead code to clean in U1/U6: `sceneQuality` in the store (never read),
   `#scene-canvas` CSS block, `Scene intensity` prop plumbing.
5. `jsdom` is a frontend devDependency (used by `test:e2e`); prompt section 3
   does not list it. It stays — tests depend on it. It never ships to the browser.
6. `nginx.conf` SPA fallback is already `try_files $uri $uri/ /index.html`
   (section 6 asks for `$uri /index.html` — same effect; will normalise in U2).
7. `frontend/scripts/` holds the two test runners; `frontend/test/` holds the
   suites. Section 13's target tree does not mention them — keep both.
8. e2e selectors depend on class names (`.nav-link`, `.ex-row`, `.set-input`,
   `.chip-btn`, `.bubble-ai`, `.heat-cell`). U2–U5 markup changes must keep
   these hooks or update the suite in the same commit.
9. `App.jsx` currently renders `<Scene>` outside the router and passes
   `intensity` per view — removal in U1 simplifies `App.jsx` to a pure router shell.

## 5. Not verified in this environment (honest list)

- **Lighthouse scores** — no Chrome/Lighthouse binary available. Will be
  reported as *not measured* in U6, with the exact command for you to run.
- **Screenshots** — no headless browser. In U7 I will list precisely which
  screenshots to capture and at which widths.
- **Docker build / nginx deep-link behaviour** — no Docker daemon here. U2 will
  keep the config correct and I will state that only `vite dev` + `vite preview`
  were exercised locally.
- **Real Groq calls** — no API key in this sandbox; AI paths were exercised in
  engine/fallback mode only (as designed).

## 6. What "green" means for every later phase

```
cd frontend && npm run build          # 0 errors
cd frontend && npm run test:render    # 10/10
cd frontend && npm run test:e2e       # 19/19 (grows as pages change)
cd backend  && npm test               # 16 + 43, untouched
```

---

# V0 baseline (recorded after phase U1, before V-series work)

Same environment and limits as U0 (no Docker, no headless browser, no Lighthouse).

| Check | Result |
|---|---|
| `npm run build` (frontend) | 0 errors, no chunk warnings |
| `npm run test:render` | 10/10 |
| `npm run test:e2e` | 19/19 |
| `backend npm test` | 16 + 43, untouched |
| dist total | **328 kB** raw (was 812 kB pre-U1) |
| js+css gzip | **98.4 kB** (was 215.5 kB) |
| heaviest chunk | react 140.88 kB (three.js gone) |

State at V0: dark-glass single theme (U1), no router yet (`view` in store),
3D removed, `tokens.css` + `global.css` present. Screenshots: **not captured —
no headless browser in this sandbox**; the exact list to take manually is in
`docs/UI_QA.md` (created in V9).
