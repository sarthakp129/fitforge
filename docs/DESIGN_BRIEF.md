# FitForge — Design Brief (Phase V1)

Approved-by: pending user review. This document is the contract for V2–V9.
Written in plain words on purpose: every line here should be sayable aloud in
an interview.

---

## 1. Audience

1. **Recruiters and hiring managers** — they spend 60 seconds. They must see:
   a real product surface, real data, restrained motion, and evidence of
   engineering judgement (budget governor, tests, docs).
2. **The owner (beginner full-stack/DevOps developer)** — must be able to
   explain every file and every animation.
3. **End users** — people tracking training and nutrition on a phone in a gym
   between sets: one-handed reach, 44 px targets, glanceable numbers, no
   decoration competing with the data.

## 2. Tone of voice

- Plain English, specific numbers, zero hype. "48,210 kg this week" beats
  "Crush your goals!"
- Confident but honest: when data is missing we say what to do next, never
  show a wall of zeros. When the AI is unavailable we say so and still deliver.
- Second person, present tense. No exclamation marks except in celebrations
  (PR toast).

## 3. Sitemap

Public (PublicLayout: sticky glass header, theme toggle, mobile drawer, 4-col footer)

| Route | Purpose (one line) |
|---|---|
| `/` | Believe it: hero + live product preview + proof + pinned story + calculator |
| `/features` | Understand the surface: stacked sticky cards, one per capability |
| `/how-it-works` | Understand the loop: 4 steps with a screen preview each |
| `/ai` | Trust the AI: flow diagram, what the model does vs what the code does |
| `/get-started` | Install it: requirements, 3 Docker steps, where the free key lives |
| `/exercises` | Browse the 102-exercise library with filters + detail drawer |
| `/faq` | Objections answered: accordion + scroll-spy contents |
| `/about` | Who and why: project story, stack with one-line reasons |
| `/privacy`, `/terms` | Marked templates, plain language |
| `/login`, `/signup` | Convert: split layout, inline validation |
| `*` | Friendly 404 with links home |

App (AppLayout: slim top bar, mobile bottom tabs, skip link, `<main>`)

`/dashboard` `/training` `/nutrition` `/coach` `/progress` `/settings` `/onboarding`

## 4. Per-page goal

- **Home** — a visitor can say what FitForge is, see real UI, compute their own
  calories, and reach signup in under 60 seconds.
- **Dashboard** — answer "how am I doing this week?" in one glance; one obvious
  next action.
- **Training** — know today's session in 5 seconds; start logging in one tap.
- **Nutrition** — know what's left to eat today; log food in under 10 seconds.
- **Coach** — feel heard: answers cite your numbers and admit their source.
- **Progress** — see the trend, not the day; celebrate PRs; export anything.
- **Settings** — control: profile, theme, AI key status, budget, data, danger.

## 5. Text wireframes (key screens)

**Home (desktop, top→bottom)**
1. Header: logo · Features · How it works · AI · FAQ · [theme] · Sign in · CTA.
2. Hero: left = H1 + one-line sub + 2 CTAs + 3 proof chips (real: exercise
   count, token budget, AI mode from /api/health); right = glass window frame
   containing a *real-component* dashboard preview, fixed sample data, labelled
   "Sample data", slight parallax (≤24 px).
3. Proof strip: 4 count-up numbers (exercises, foods, tests passing, bundle
   gzip kB) — all real.
4. Bento: 6 cards (plans, meals, logging+rest timer, analytics, coach,
   works-without-AI), staggered reveal.
5. Pinned story: left sticky step list (4 steps, scroll-spy), right panel swaps
   a mini UI mock per step.
6. Live macro calculator: form left, sticky result card right (rings + grams).
7. AI flow diagram: 5 nodes light up in sequence on enter; caption per node.
8. FAQ teaser (3) + final CTA band + footer.

**Dashboard**
Row 1 greeting + state-aware subtitle + quick actions (weigh-in, log food,
start session). Row 2 four stat cards (count-up). Row 3 Today's session (2/3)
+ macro rings (1/3). Row 4 volume bars + weight line + heatmap. Row 5 coach
read-out + token gauge. New users: getting-started checklist card with progress
ring instead of rows 4–5 until done.

**Training plan**
Slim generator toolbar once a plan exists. Sticky day tabs (scroll-spy; snap
rail on mobile). Per day: collapsible warm-up/finisher (detail *under* each
label), exercise cards: [index · name · muscle chips] left, [sets × reps big]
right, icon chip row (load, rest, tempo, RPE), expandable cues, role badge.

**Training session**
Sticky header: name, elapsed, volume, Finish. Exercise cards with set grid
(set · prev · kg · reps · tick), 44 px. Floating rest-timer pill above mobile
tab bar. PR burst + toast on a new best. Undo toast on delete.

## 6. Home scroll storyboard (what moves when)

| Scroll position | Effect | Mechanism |
|---|---|---|
| 0 | hero text visible immediately (no entrance anim above the fold) | — |
| 0→0.3 vp | preview frame rises 24 px then drifts −12 px | `animation-timeline: view()`, fallback static |
| proof strip enters | numbers count up once | `useCountUp` + `useInView` |
| bento enters | cards fade-rise staggered 60 ms | `--i` custom property + view() / IO fallback |
| story section | left column pins; right panel swaps per active step | `position: sticky` + `useScrollSpy` |
| calculator | result card pins beside form (desktop) | sticky |
| AI diagram | nodes light sequentially | staggered view() delays |
| > 800 px | back-to-top appears | IO on sentinel |

Everything is transform/opacity only; everything off under reduced motion.

## 7. Token table (both themes)

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#fbfbfd` | `#0A0E14` |
| `--glass` | `rgba(255,255,255,0.82)` | `rgba(255,255,255,0.06)` |
| `--glass-hover` | `rgba(255,255,255,0.95)` | `rgba(255,255,255,0.09)` |
| `--glass-strong` | `rgba(255,255,255,0.94)` | `rgba(18,24,34,0.85)` |
| `--solid` | `#ffffff` | `#121822` |
| `--line` / `--line-2` | `rgba(11,18,32,.10)` / `.06` | `rgba(255,255,255,.10)` / `.06` |
| `--text` / `--muted` / `--faint` | `#0b1220` / `#4f5e70` / `#64748b` | `#F3F6F9` / `#9AA7B5` / `#6B7785` |
| `--ember` (+hover) | `#ff5b2e` (`#e8481f`) | `#FF5B2E` (`#FF7A52`) |
| `--teal` | `#0ea5a4` | `#2DD4BF` |
| `--violet` / `--amber` / `--rose` / `--ok` | `#6366f1` `#f59e0b` `#f43f5e` `#16a34a` | `#818CF8` `#FBBF24` `#FB7185` `#4ADE80` |
| primary button | ink fill, white text | ember fill, `#0A0E14` text |
| glow opacities | 8 / 7 / 6 % | 14 / 12 / 10 % |
| `color-scheme` | light | dark |

Radius 18/12/999 · spacing 8-px scale · interactive motion 150–250 ms ease-out ·
focus ring 2 px ember + 2 px offset · tabular numerals on every stat.

## 8. Component inventory (after V4)

`ui/` Card, CardHead, Button, Chip, Field, Input, Select, Textarea, Segmented,
StatCard (count-up), Bar, Rings, Modal, Drawer, EmptyState (art), ErrorState,
Skeleton, Toaster (+undo), Reveal, Icon, ThemeToggle, Accordion, Rail,
StickyTabs, PageHeader, ScrollProgress, CommandPalette.
`charts/` LineChart (draw-on), BarChart (grow), Heatmap (fade), MuscleBars,
BudgetGauge (fill-from-0), Sparkline. All colours via CSS variables only.
`hooks/` useInView, useScrollSpy, useCountUp, useTheme, useReducedMotion
(each < 30 lines, commented).
`layout/` PublicLayout, AppLayout, TopBar, BottomNav, UserMenu.

## 9. Guardrails

No animation of layout properties on scroll; no scroll listeners for animation;
no images; no network fonts; text never sits on a busy visual (hero art goes
*beside* copy); at most two accent colours per screen; dense data always on
`--solid`, never on blur.
