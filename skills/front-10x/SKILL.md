---
name: front-10x
description: ENTRY POINT for elite cinematic front-end. Invoke FIRST on any high-value UI — landing, hero, marketing site, product showcase, app shell, dashboard, key flow/page. Runs component-discovery + the ALWAYS-ON design tournament + the cinematic (Awwwards-tier) playbook, then composes the full design skill stack. Use when the goal is competitive, award-grade apps and pages, not a generic SaaS look. Pairs with /design-tournament and the runnable kit at ~/auramaxing/design-kit/.
---

# front-10x — the cinematic 10x front orchestrator

The entry point that makes AURAMAXING front output **competitive with award-winning apps and
pages**, not generic AI. Anchor: **cinematic / Awwwards-tier** (Active Theory · Basement · Unseen ·
Rauno), dark-first. Full doctrine: `~/auramaxing/docs/DESIGN-SUPREMACY.md` (§1.5 cinematic playbook,
§10 kit, §11 discovery). This skill orchestrates; it does not replace the stack — it composes it.

## The 10x levers (apply ALL — this is where the multiplier comes from)
1. **Never start blank.** Copy `~/auramaxing/design-kit/` (DESIGN.md + globals.css OKLCH + tokens +
   signature components). Then `designlang` (MCP) on a best-in-class reference → retune `DESIGN.md`.
2. **Component-discovery (§11) before hand-rolling.** Search + compare candidates live —
   `mcp__shadcn__`, `mcp__magicuidesign-mcp__`, react-bits, animate-ui, Aceternity, Cult UI,
   motion-primitives, + `WebSearch` "<component> awwwards / codrops". Score on themability / motion /
   a11y / license / bundle. Pick the BEST, re-theme to tokens. Hand-roll only if nothing beats it.
3. **ALWAYS-ON tournament.** Every surface gets ≥3 cinematic variants judged by a SEPARATE critic →
   your taste gate. Run via `/design-tournament` (see that skill). This is the single biggest jump.
4. **Cinematic craft (§1.5).** Signature shader/WebGL or kinetic-type hero; Lenis + GSAP
   ScrollTrigger scroll narrative; magnetic micro-interactions; grain/mesh atmosphere; 3D (R3F +
   drei + postprocessing) when it earns its place — lazy-loaded, DPR-capped, reduced-motion fallback.
5. **Vision-QA closed loop.** Screenshot (Playwright CDP) → critique vs Elite Checklist + DESIGN.md →
   fix pixels → re-run. Loop until vision score high AND all gates green. The agent SEES its output.

## The enforced sequence (tournament-first)
`front-10x → component-discovery → designlang EXTRACT-REF → DESIGN.md → /design-tournament (≥3
cinematic variants, separate judge, taste gate) → build winner with stack → emil-design-eng
(motion + scroll-storytelling) → impeccable (polish) → hallmark 65-gate + axe + Lighthouse →
vision-QA loop ↺`.

## Compose ALL of these installed skills (mandatory)
`frontend-design` (anti-slop baseline) · `design-taste-frontend` (direction + dials) ·
`high-end-visual-design` ("looks expensive") · `emil-design-eng` (motion law) ·
`impeccable` (final polish) · `hallmark` (65-gate, HARD gate) · `ui-ux-pro-max` (system gen).
Style registers per brief: `stitch-design-taste` (cinematic) · `gpt-taste` (GSAP) ·
`industrial-brutalist-ui` · `minimalist-ui` (product floor).

## Stack (kit-installed)
Tailwind v4 `@theme` OKLCH + shadcn (Base UI) + Fontsource (Geist + one display face) + Motion +
AutoAnimate. **Cinematic:** R3F + drei + postprocessing / OGL / `@paper-design/shaders-react` +
Lenis + GSAP ScrollTrigger (+SplitText/MorphSVG, free) + Theatre.js + Rive/Lottie. **Micro:**
`pqoqubbw/icons` + `@number-flow/react`.

## Gates — none optional (loop to 100/100, per the Phased Excellence Loop)
hallmark 65-gate · axe-core zero serious/critical · Lighthouse perf ≥0.9 & a11y ≥0.9 ·
LCP ≤2.5s / CLS ≤0.1 / TBT <200ms · visual-regression clean · token-lint (no raw hex/px) ·
**reads Awwwards-tier** (the subjective bar the vision-judge enforces). "Looks fine" is NOT the bar.

## Anti-slop (auto-reject)
Raw Inter/Roboto/system as the distinctive face · purple→blue gradient on white · timid even
palettes · blanket shadow/radius · spinners instead of skeletons · missing microstates · bare
empty states · pasted blocks with foreign hardcoded colors (re-theme to tokens always).
