---
name: aura-design-supremacy
description: ALWAYS invoke for ANY front-end / UX / UI work — any page, component, layout, dashboard, landing, form, app shell, or styling task built with AURAMAXING. UX/UI is a mandatory first-class priority. This loads the elite design pipeline, the 37-rule Elite UI Checklist, anti-AI-slop rules, and the mandatory skill stack. Do NOT build or edit any interface without applying this. Invoke alongside the design skill stack listed below.
---

# AURAMAXING Design Supremacy — UX/UI is mandatory

Full doctrine + 37-rule Elite UI Checklist: read `~/auramaxing/docs/DESIGN-SUPREMACY.md`. Operative summary:

## MANDATORY: on ANY UI task, invoke ALL of these installed skills
`frontend-design` (anti-slop baseline) · `emil-design-eng` (motion law) · `impeccable` (polish pass) · `design-taste-frontend` (taste/direction) · `high-end-visual-design` ("looks expensive") · `hallmark` (65-gate slop test, HARD gate) · `ui-ux-pro-max` (design-system gen). Style registers per brief: `minimalist-ui` / `gpt-taste` / `industrial-brutalist-ui` / `stitch-design-taste` / `redesign-existing-projects`.

## TOURNAMENT MODE — the 10x lever for HIGH-VALUE UI (landing, hero, dashboard, key page)
Don't ship the first thing generated. For any UI that matters, run the tournament:
1. **EXTRACT a reference first** — `designlang` (MCP) on a best-in-class site for the domain
   (stripe.com / linear.app / vercel.com) → start from élite tokens, never from scratch.
2. **GENERATE 3 variants IN PARALLEL** (subagents/Agent Teams), each with DIFFERENT
   `design-taste-frontend` dials and/or style register:
   - A: minimal — DESIGN_VARIANCE 3, MOTION_INTENSITY 3, VISUAL_DENSITY 3 (or `minimalist-ui`)
   - B: bold/dense — VARIANCE 8, MOTION 6, DENSITY 8 (or `gpt-taste` / `industrial-brutalist-ui`)
   - C: cinematic-balanced — VARIANCE 6, MOTION 8, DENSITY 5
   (All constrained by the SAME DESIGN.md tokens so they're variations, not chaos.)
3. **SCREENSHOT each** (Playwright/chrome-devtools MCP, multiple viewports).
4. **VISION-JUDGE with a SEPARATE judge** — a distinct Opus pass (NOT the builder — self-rating
   is too generous) scores each variant 0–5 on the hallmark 65-gates + Elite Checklist, per screenshot.
5. **HUMAN taste gate** — surface the top 2 to the user; they pick. Judges narrow, humans decide taste.
6. **POLISH the winner** through the sequence below; graft the best ideas from the runner-up.
Tournament is opt-in by value: full 3-variant for landing/hero/main dashboard; single-pass
(sequence below) for a button/minor component. Cost ≈ 3× tokens — fine under ultracode.

## The enforced sequence (single-pass, and the polish stage of tournament)
`design-consultation/DESIGN.md → design-taste-frontend (direction) → high-end-visual-design + build with stack → emil-design-eng (motion) → impeccable (polish) → hallmark 65-gate + axe-core + Lighthouse → vision-QA loop`. If a skill isn't installed, install it (`npx skills add <repo>`) before building.

## Stack
Tailwind v4 (`@theme` OKLCH) + shadcn/ui (Base UI backend) + **Fontsource** fonts (Geist/Inter + Monaspace) + Radix Colors + tweakcn + Motion + AutoAnimate + Lenis/GSAP + View Transitions + anime.js v4. Micro: **pqoqubbw/icons** (animated icons) + **@number-flow/react** (animated numbers). Blocks: react-bits / animate-ui / magicui / shadcn. Breadth: Kibo UI / Tremor / Origin UI(AGPL-check). Extract a reference site → tokens with **designlang** (MCP). Brand SSOT = a committed **DESIGN.md** (DTCG tokens).

## Anti-slop (auto-reject)
Raw Inter/Roboto/system as the distinctive font; purple→blue gradient on white; timid evenly-distributed palettes; blanket shadow/radius; spinners instead of skeletons; missing focus/hover/active/disabled/loading states; bare empty states.

## Motion law (emil-design-eng)
≤200ms interactions / <300ms UI / ~500ms drawers; `ease-out` entrances; animate ONLY transform/opacity (60fps); proportional scale (dialogs from ~0.8, press to ~0.96); respect `prefers-reduced-motion`; one orchestrated staggered page-load.

## Gates (CI, must pass)
axe-core zero serious/critical · Lighthouse perf ≥0.9 & a11y ≥0.9 · LCP ≤2.5s / CLS ≤0.1 / TBT <200ms · visual-regression baseline clean · design-token lint (no raw hex/px). The agent MUST SEE its output (Playwright screenshot → vision critique → fix loop) before declaring any UI done. "Looks fine" is NOT the bar — it must pass hallmark + the Elite Checklist.
