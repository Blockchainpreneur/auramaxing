# AURAMAXING — Design Stack Setup (free-now, copy-paste per project)

> Ready-to-run install commands for the Design Supremacy stack. Run these **inside a target
> project** when starting/upgrading its front-end — they do not touch other projects.
> Doctrine: `~/auramaxing/docs/DESIGN-SUPREMACY.md`. All MIT-ish except GSAP (GreenSock license).

## 1. Base (Tailwind v4 + shadcn, if not present)
```bash
npx shadcn@latest init          # zinc base; choose Base UI backend on new projects
```

## 2. Fonts (Geist — variable, self-hosted, zero FOUT)
```bash
npm i geist                      # Geist Sans + Geist Mono in one package; wire next/font
# Display accent (optional, only for brand/marketing): download from fontshare.com
#   Satoshi / General Sans / Switzer — free commercial — self-host the woff2
```

## 3. Color & tokens (OKLCH SSOT)
```bash
npm i -D culori                  # programmatic palette math / gamut clamp
npm i -D apcach                  # generate colors at a target APCA/WCAG contrast
# Author/export the shadcn theme visually at https://tweakcn.com (OKLCH, contrast-checked)
# Adopt the Radix Colors 12-step semantic model conceptually:  npm i @radix-ui/colors
```
SSOT = one file: `globals.css` `@theme` + `:root`/`.dark` CSS variables. No build step.

## 4. Motion (layered by job)
```bash
npm i motion                     # ex-framer-motion — 90% of UI transitions
npm i @formkit/auto-animate      # one-line list animation — highest polish-per-effort
npm i lenis gsap                 # smooth scroll + scroll-narrative (GSAP: GreenSock license)
npm i @react-spring/web @use-gesture/react   # magnetic/drag/physics
npm i @rive-app/react-canvas     # interactive vector (state machines) — prefer over Lottie
# Route morphs: enable native View Transitions (Next: experimental.viewTransition / React <ViewTransition>)
```

## 5. Breadth / data / taste (copy-paste registries via shadcn CLI)
```bash
# Stateful complex components (tables, kanban, command palette):
npx shadcn@latest add https://www.kibo-ui.com/registry/<component>.json
# Dashboards / charts:
npm i @tremor/react
# 500+ advanced app components: copy from https://originui.com
# Tasteful motion (Linear/Rauno tone): https://motion-primitives.com (shadcn CLI)
# Apple-grade interactions: https://cult-ui.com (shadcn registry)
# Flashy marketing blocks: Magic UI (magicuidesign-mcp, already installed) / Aceternity
```

## 6. QA gates (the agent's eyes — wire into CI)
```bash
npm i -D @axe-core/playwright    # a11y: zero serious/critical = merge blocker
npm i -D @lhci/cli               # Lighthouse CI: perf>=0.9, a11y>=0.9, LCP<=2.5s, CLS<=0.1
npx playwright test              # visual regression via toHaveScreenshot()
npm i -D @argos-ci/playwright    # OSS visual regression w/ review layer + ARIA snapshots
# Stylelint design-token lint: fail build on raw hex/px outside tokens
```

## 7. The loop (per DESIGN-SUPREMACY.md)
BRIEF → TOKENS → MULTI-VARIANT → VISION-JUDGE → IMPLEMENT → QA GATES → POLISH ↺
Agent must SEE its output: `browser-server.mjs` screenshot → vision critique vs the
37-rule Elite UI Checklist + `DESIGN.md` → fix → re-run gates → loop until elite.

## Key-gated (need API keys — pending user): v0 API, Figma Dev Mode MCP, Mobbin MCP, Exa, Magic Patterns, Builder.io/Subframe.
