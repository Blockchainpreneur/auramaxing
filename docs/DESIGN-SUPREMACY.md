# AURAMAXING — Design Supremacy Protocol (2030-grade UX/UI)

> The design brain. PRIORITY on every front-end task so output beats Linear / Vercel /
> Stripe / Rauno-tier and reads nothing like generic AI. The always-on summary lives in
> `~/.claude/CLAUDE.md` → "Design Supremacy Protocol"; full depth here.

Version 1.0 · 2026-05-29 · Stack: Tailwind v4 + shadcn/ui + Motion · Synthesized from live research.

---

## 0. Philosophy
**Intentionality, not intensity.** Taste = restraint + spring physics + shared-element
continuity + a coherent single direction. The goal is not "more effects" — it's craft an
elite design engineer would ship. Every surface must pass the Elite UI Checklist (§6) and
the automated gates (§7). Never converge on the same trendy default across projects.

**Default anchor: cinematic / award-winning (Awwwards · Active Theory · Basement · Rauno tier).**
The bar is not "clean SaaS page" — it is a site that could win an Awwwards Site of the Day:
intentional motion narrative, scroll-driven scenes, a signature hero, depth and atmosphere,
kinetic typography, and craft in every transition. Product-grade minimal (Linear/Vercel/Stripe)
is the FLOOR for dense app UI; cinematic is the TARGET for anything public-facing. The 10x comes
from: (a) starting from extracted élite references, never blank; (b) an ALWAYS-ON variant
tournament judged by a separate critic; (c) a closed vision-QA loop where the agent sees and
fixes its own pixels; (d) leveraging the best component/WebGL libraries instead of hand-rolling.
See §1.5 for the cinematic playbook, §10 for the runnable starter kit, §11 for component-discovery.

## 0.5 UX/UI IS A FIRST-CLASS PRIORITY — MANDATORY SKILL INVOCATION
**Any interface built with AURAMAXING — any page, component, layout, dashboard, landing,
form — MUST invoke the full design skill stack. This is non-negotiable, not opt-in.**

**Entry point: invoke `front-10x` FIRST** (the cinematic 10x orchestrator skill) — it runs
component-discovery (§11), the always-on tournament, and the cinematic playbook (§1.5), then
composes the skills below. The dedicated **`/design-tournament`** command runs the N-variant +
separate-judge tournament on demand. **TOURNAMENT MODE IS ALWAYS ON** (not value-gated): every
surface — down to key components — gets ≥3 judged cinematic variants. Start every project from the
runnable kit in §10; never begin a front task from a blank file.

When a task touches UX/UI, the agent MUST load and apply ALL of these (free, `npx skills add`):

All INSTALLED (`~/.claude/skills/`) — invoke by these exact names:

| Skill (installed name) | Role — applied on EVERY UI task |
|---|---|
| **frontend-design** | Official Anthropic anti-slop baseline (bans Inter/Roboto/Arial-as-default, forces committed aesthetic) |
| **emil-design-eng** | Emil Kowalski's motion law (≤300ms, ease-out, transform/opacity only, springs, reduced-motion) |
| **impeccable** | Final quality pass: alignment, spacing tokens, states, hierarchy, contrast, 44px targets, 60fps |
| **design-taste-frontend** (+ -v1) | Leonxlnx taste-skill: anti-templated direction, dials, audit-first redesigns |
| **high-end-visual-design** | "Looks expensive" — exact fonts/spacing/shadows/cards that read as agency-grade |
| **hallmark** | 65-gate slop test as a HARD ship-gate (one fail blocks) + URL/screenshot design extraction |
| **ui-ux-pro-max** | Industry-matched design-system generation (67 styles, 96 palettes) |
| Style registers (pick per brief) | minimalist-ui · gpt-taste (GSAP motion) · industrial-brutalist-ui · stitch-design-taste · redesign-existing-projects |
| Image direction (when needed) | imagegen-frontend-web · imagegen-frontend-mobile · image-to-code · brandkit |

Plus the stack libs (§2): Fontsource · OKLCH/Radix Colors/tweakcn · Motion+AutoAnimate ·
**pqoqubbw/icons** (animated icons) · **@number-flow/react** (animated numbers) · react-bits/animate-ui.
Plus the brand SSOT: a committed **DESIGN.md** (DTCG tokens) + **designlang** to extract from references.

**The sequence on any UX/UI task (enforced, tournament-first):**
`front-10x (orchestrate) → component-discovery (§11) → designlang EXTRACT-REF → DESIGN.md tokens
→ ALWAYS-ON TOURNAMENT (≥3 cinematic variants via design-taste-frontend dials, §1/§1.5) →
SEPARATE vision-judge → human taste gate → build winner with stack → emil-design-eng (motion +
scroll-storytelling) → impeccable (polish) → hallmark 65-gate + axe + Lighthouse → vision-QA loop ↺`.
All skills are installed in `~/.claude/skills/`. "Looks fine" is not the bar — it must pass hallmark +
the Elite Checklist (§6) AND read as Awwwards-tier. UX/UI quality decides whether the whole project
reads as elite or as generic AI output. Treat it as load-bearing.

---

## 1. The mandatory design pipeline (2030-approximation, runnable today)
Run this closed loop for any UI of consequence. Human owns only the taste gate (Stage 3).

```
BRIEF → EXTRACT-REF → TOKENS → 3-VARIANT TOURNAMENT → VISION-JUDGE → HUMAN GATE → POLISH LOOP ↺
```

### ⭐ TOURNAMENT MODE (the 10x lever — high-value UI: landing, hero, dashboard, key page)
The biggest quality jump is moving from one self-rated pass to **N diverse variants judged by a
SEPARATE critic**. Opt-in by value (full tournament for important UI; single-pass for minor parts):
1. **EXTRACT-REF** — `designlang` MCP on a best-in-class site (stripe/linear/vercel) → seed élite
   tokens. Never start blank — that's where the "generic AI look" originates.
2. **3 VARIANTS in parallel** (subagents), SAME DESIGN.md tokens, DIFFERENT `design-taste-frontend`
   dials so they are real explorations, not noise:
   | Variant | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY | or register |
   |---|---|---|---|---|
   | A minimal | 3 | 3 | 3 | `minimalist-ui` |
   | B bold/dense | 8 | 6 | 8 | `gpt-taste` / `industrial-brutalist-ui` |
   | C cinematic | 6 | 8 | 5 | `stitch-design-taste` |
3. **SCREENSHOT** each at desktop+mobile (Playwright bundled Chromium / chrome-devtools MCP).
4. **SEPARATE-JUDGE** — a distinct Opus pass (NOT the builder; self-rating runs ~too generous)
   scores each 0–5 vs the hallmark 65-gates + §6 Elite Checklist, per screenshot. Pick the top.
5. **HUMAN TASTE GATE** — surface top-2 to the user; they choose. Judges narrow, humans decide taste.
6. **POLISH** the winner via the steps below; graft the best ideas from the runner-up.
Cost ≈3× tokens — acceptable under ultracode. Mirrors the eval-harness "separate judge" pattern, on pixels.

0. **Brief → constraints** — `/office-hours` or `/design-consultation`; emit/refresh
   `DESIGN.md` (DTCG tokens + rationale) as the brand source of truth read on every step.
1. **Tokens** — OKLCH semantic variables as the single source of truth (see §3/§4). One
   file (`globals.css` `@theme` + `:root`/`.dark`) the agent edits; everything re-themes.
2. **Multi-variant** — generate N variants from different angles (constrained by tokens +
   `DESIGN.md`). Tools when keys exist: v0 Model API (`v0-1.5-lg`), Magic Patterns API,
   Builder.io / Subframe for design-system fidelity; else generate in-repo with the stack.
   (Figma intentionally NOT used — extract design from reference SITES → DESIGN.md instead.)
3. **Vision-judge** — render headlessly (CDP browser-server), screenshot at multiple
   viewports, score each variant 0–5 on a rubric (hierarchy, spacing, token adherence,
   anti-slop). Surface top 2–3 to the human taste gate. Judges narrow; humans decide taste.
4. **Implement** — land the winner; reuse design-system components; commit atomically via
   `/design-html` + `/review`.
5. **QA gates (all must pass)** — visual regression (Argos / Playwright `toHaveScreenshot`),
   a11y (`@axe-core/playwright`, zero serious/critical), perf/CWV (Lighthouse CI: LCP ≤2.5s,
   CLS ≤0.1, TBT <200ms as INP proxy, perf ≥0.9).
6. **Polish loop** — re-screenshot → vision critique with element-level comments → fix CSS/
   layout → re-run gates. Loop until vision score ≥ threshold AND all gates green. This is
   `/design-review` → `/qa` made closed-loop.

---

## 1.5 Cinematic / award-winning playbook (the default anchor)
For public-facing UI (landing, hero, marketing, product showcase) target Awwwards-SOTD craft.
The moves that separate award-tier from a "nice SaaS page":

- **Signature hero.** A WebGL/shader background (`@paper-design/shaders-react` gradient meshes,
  or R3F + `postprocessing` bloom/grain), or a kinetic-typography hero. Never a flat centered H1.
- **Scroll as narrative.** `Lenis` smooth scroll + `GSAP ScrollTrigger` (now 100% free, incl.
  SplitText/MorphSVG) for pinned sections, scroll-driven scenes, parallax depth, reveal
  choreography. `Theatre.js` to author the timeline. Always respect `prefers-reduced-motion`.
- **3D / WebGL when it earns its place.** React Three Fiber + drei + `maath`; `OGL` for a light
  footprint; `Spline` (key-gated) for authored scenes; `Rive` for interactive vector.
- **Micro-craft.** Magnetic buttons + cursor-following (`@use-gesture`/React Spring), WebGL image
  hover transitions, marquees, `@number-flow/react` counters, View Transitions for route morphs,
  `pqoqubbw/icons` animated icons.
- **Atmosphere.** Grain/noise overlays, gradient mesh, layered transparency, one coherent light
  source for multi-layer shadows. Dark-first is the cinematic default.
- **Performance is non-negotiable even when cinematic.** Lazy-load 3D below the fold, cap DPR,
  pause off-screen RAF loops, ship a static `reduced-motion` fallback. §6/§7 gates still apply —
  award craft AND LCP ≤2.5s / 60fps.

Reference corpus (study, encode as rules): Awwwards SOTD, Active Theory, Basement Studio, Unseen
Studio, Resn, Locomotive, **Olivier Larose** (blog.olivierlarose.com — copy-paste React cinematic
components), **codrops** (tutorials/demos), Rauno (interaction spine).

---

## 2. Canonical stack (the kit)
**Core:** Tailwind v4 (CSS-first `@theme`) + shadcn/ui (zinc base; **Base UI** backend on new
projects) + Radix/Base primitives + lucide-react.
**Type:** self-host EVERY font via **Fontsource** (`@fontsource-variable/*` — kills the Google
Fonts CDN: privacy + perf + zero FOUT). Geist Sans + Geist Mono as default; Inter (variable) as
the ultra-neutral alternative; **Monaspace** (texture-healing) or Commit Mono for code; **one**
Fontshare display face (Satoshi / General Sans / Switzer — free commercial) only for brand/density.
**Color:** OKLCH everywhere; Radix Colors 12-step semantic model; `tweakcn` to author/export
shadcn themes; `culori` + `apcach` for programmatic palette math + target-contrast.
**Motion:** Motion (ex-framer-motion) for 90% of UI; AutoAnimate (`@formkit/auto-animate`)
on every list (highest polish-per-effort); Lenis + GSAP ScrollTrigger for landing narrative;
**anime.js v4** (~10KB MIT) as the lightweight JS alternative; native View Transitions (first-class
in React 19.2) for route morphs; React Spring + `@use-gesture` for magnetic/drag; Rive for
interactive vector, Lottie for branded loops.
**Cinematic/3D (the award-tier layer, §1.5):** React Three Fiber + drei + `maath` +
`postprocessing` (bloom/DOF/film-grain) for 3D heroes; **OGL** for a light WebGL footprint;
**@paper-design/shaders-react** for shader gradient backgrounds; **Lenis** + **GSAP
ScrollTrigger** (free, +SplitText/MorphSVG) for scroll storytelling; **Theatre.js** to author
motion timelines; **Spline** (key-gated) for authored 3D scenes. Olivier Larose components +
codrops demos = copy-paste cinematic patterns.
**Micro-interactions:** **pqoqubbw/icons** (animated Lucide, copy-paste, uses your Motion+lucide deps)
+ **@number-flow/react** (animated counters/prices/metrics — default for dashboard stats).
**Breadth/data:** Kibo UI (stateful complex components), Tremor (charts/dashboards), Origin
UI (⚠️ now folded into Cal.com/COSS, new system is AGPL-3.0 — pin the legacy MIT snapshot or
re-verify license). **Taste registers:** motion-primitives (Linear/Rauno tone), Cult UI
(Apple-grade interactions). **Animated blocks:** **react-bits** (the 2026 leader; ⚠️ Commons Clause
— free for products, no reselling) · **animate-ui** (best newcomer) · Magic UI (MCP) · Aceternity.
> GSAP is now **100% free incl. all Club plugins** (Webflow-sponsored since 2025) — SplitText/MorphSVG free.

---

## 3. Typography doctrine
- One variable sans does almost everything (Geist or Inter across all weights) + one mono.
  Add a second (display) face only for brand voice.
- Fluid scale via Utopia (`clamp()`); ≤ 4–6 sizes; base 16px (≥16px on touch inputs).
- `font-optical-sizing: auto` on `opsz`-axis fonts; negative tracking on display (−1%…−3%),
  ~0 on body; never letterspace lowercase body.
- Measure 45–75ch (`~65ch`); line-height inverse to size (body ~1.5, display ~1.05–1.2).
- `font-variant-numeric: tabular-nums` on tables/timers/changing numbers.
- Weight never changes on hover (layout shift); no weight < 400.

---

## 4. Color & token doctrine
- **OKLCH is the format to generate and reason in** (perceptually uniform, P3-ready).
- Adopt the Radix 12-step semantic model (1–2 bg, 3–5 component, 6–8 border/focus,
  9–10 solid accent, 11–12 text); same token name flips in `.dark` — never invert.
- Verify contrast with BOTH WCAG2 AA (compliance) and APCA (real readability, esp. dark mode;
  WCAG2 overstates contrast on near-black). Never pure `#000` — use a near-black step.
- **SSOT = Tailwind v4 `@theme` + `:root`/`.dark` CSS variables** in one file (no build step).
  Scale up to DTCG JSON → Style Dictionary only when feeding Figma/native platforms.

---

## 5. Motion doctrine
- Interaction animations ≤ 200ms; UI transitions < 300ms; drawers/sheets ~500ms.
- Default easing `ease-out` for entrances; animate ONLY `transform`/`opacity` (60fps).
- Animate proportionally: dialogs scale from ~0.8 (not 0→1), press to ~0.96 (not →0.8).
- Springs for organic motion; interruptible; origin-aware (grow from source).
- Respect `prefers-reduced-motion`; theme switches do NOT animate; pause off-screen loops.
- High-frequency/low-novelty actions get minimal/no motion. One orchestrated staggered
  page-load beats scattered micro-interactions.

---

## 6. The Elite UI Checklist (the enforcement gate — design-review must pass all)
**Anti-slop / identity**
1. Font is NOT raw Inter/Roboto/Arial/system as the *distinctive* choice; distinctive display + refined body.
2. No purple→blue gradient on white/near-white (the #1 slop tell).
3. One dominant color + sharp accent; reject timid evenly-distributed palettes; all color in CSS vars.
4. Backgrounds have atmosphere (gradient mesh / noise / grain / layered transparency) where the aesthetic calls for it.
5. Shadow & radius are intentional, not blanket-applied.
6. One coherent direction (minimal OR maximal) executed precisely.

**States & completeness**
7. Every interactive element has all six microstates: default/hover/focus/active/disabled/loading.
8. Custom visible focus rings via `box-shadow` (not `outline`) on every focusable element.
9. Loading = layout-matching skeletons, not spinners.
10. Empty states prompt the next action; never bare "No data."
11. Errors specific + inline near trigger; success inline (e.g. copy checkmark), not a toast for everything.
12. Buttons disable after submit; toggles apply immediately.

**Motion** (13–18): see §5 — ≤200ms interactions, `ease-out`, transform/opacity only,
proportional scale, reduced-motion respected, orchestrated page-load.

**Typography & spacing** (19–23): consistent ≤4–6 size scale, headings 500–600, no weight
change on hover, tabular-nums, `clamp()` heroes, generous whitespace on a 4px grid.

**Hierarchy, color, depth** (24–27): explicit hierarchy via softer color (not just smaller);
fewer borders (separate via shadow/contrast/spacing); multi-layer shadows from one light
source; semantic color only.

**Accessibility & input** (28–32): icon-only controls have `aria-label`; inputs in `<form>`
(Enter submits), correct `type`, ≥16px touch; lists ↑/↓ navigable, dropdowns open on
`mousedown`; `@media (hover:hover)` gates hover; optimistic updates with rollback.

**Measured gates (CI, not eyeball)** (33–37): axe-core zero serious/critical; Lighthouse
perf ≥0.9 & a11y ≥0.9; LCP ≤2.5s / CLS ≤0.1 / TBT <200ms; visual-regression baseline clean;
design-token lint passes (no raw hex/px outside the token system).

---

## 7. Vision-QA-in-the-loop (the agent sees + self-corrects)
- **See:** Playwright (CDP `browser-server.mjs`) screenshot → feed to vision model →
  critique vs the Elite Checklist + `DESIGN.md` → apply fixes → repeat.
- **Visual regression:** Argos (`@argos-ci/playwright`, OSS, ARIA-aware) or Playwright
  `toHaveScreenshot()`; Chromatic if Storybook-first; Lost Pixel if fully self-hosted.
- **A11y:** `@axe-core/playwright` as a merge blocker (zero serious/critical).
- **Perf/CWV:** Lighthouse CI (`@lhci/cli`, `treosh/lighthouse-ci-action`) + `budget.json`.
- **Self-healing tests:** Playwright Test Agents (planner→generator→healer) keep suites green.

---

## 8. Reference corpora (encode as rules; consult for taste)
- **Rauno — Web Interface Guidelines** (interfaces.rauno.me / vercel-labs/web-interface-guidelines) — the spine.
- **Anthropic frontend-design skill + cookbook** — the canonical anti-slop rules.
- **Emil Kowalski — animations.dev / emilkowal.ski** — motion timing/easing.
- **Refactoring UI**, **Josh Comeau (shadows, gradients)**, **Stripe/Linear/Vercel craft writeups**.
- **Inspiration→code:** Mobbin (official MCP/REST), Dribbble v2 API, shadcn/Magic UI MCP.
  Godly/Land-book/Awwwards/SiteInspire = curation only (no sanctioned API; use `site:` search).

---

## 9. Key-gated adopt list (need API keys / paid — flag to user, don't assume)
v0 (Model + Platform API), Mobbin MCP/REST (Pro+), Magic Patterns API,
Builder.io / Subframe, Exa. Free-now: Geist, Fontshare, Radix Colors, tweakcn, culori/apcach,
Utopia, AutoAnimate, Argos (free tier), axe-core, Lighthouse CI, View Transitions, Motion.

---

## 10. The runnable starter kit (start every front project here)
`~/auramaxing/design-kit/` is the drop-in elite design layer — never start a front project blank.
- `DESIGN.md` — DTCG token SSOT template, cinematic-anchored, with the taste dials + rationale.
- `tokens.json` — the same tokens in DTCG JSON (feed Style Dictionary / native platforms).
- `globals.css` — Tailwind v4 `@theme` + `:root`/`.dark`, OKLCH cinematic palette, fluid type
  scale, motion + easing tokens, dark-first. Edit this one file; everything re-themes.
- `package.json` — the canonical dependency set (Tailwind v4, shadcn/Base UI, Motion, Fontsource,
  number-flow, Lenis, GSAP, R3F/drei, paper shaders).
- `components/` — signature reference implementations that define the bar: a cinematic hero and a
  six-microstate button. Copy + adapt; never regress below their craft.
Workflow: copy the kit into the project → run `designlang` on a reference to retune `DESIGN.md` →
enter the tournament. The kit is the floor; the tournament raises the ceiling.

## 11. Component-discovery protocol (search the best, never hand-roll the generic)
Before building any non-trivial block, RUN A DISCOVERY PASS (part of `front-10x` and the
SELECT-THE-BEST step of the Phased Excellence Loop):
1. **Search + compare** candidates live: `mcp__shadcn__`, `mcp__magicuidesign-mcp__`, react-bits,
   animate-ui, Aceternity, Cult UI, Kibo UI, motion-primitives, + `WebSearch` for
   "<component> awwwards / codrops <pattern>".
2. **Score** on: token-themability, motion quality, a11y, license (flag Commons-Clause react-bits /
   AGPL Origin UI), bundle cost. Pick the BEST fit, not the first hit.
3. **Adapt to DESIGN.md tokens** — never paste foreign hardcoded colors/spacing (that is how the
   generic look leaks back in). Re-theme to the project's OKLCH variables.
4. **Install free, flag key-gated/paid** to the user before adopting.
Hand-roll only when discovery finds nothing better than what you'd build.
