# AURAMAXING design-kit — the elite cinematic drop-in layer

**Never start a front project from a blank file.** Copy this kit in first, retune the tokens to
the brand, then enter the always-on design tournament (see `~/auramaxing/docs/DESIGN-SUPREMACY.md`).

Anchor: **cinematic / award-winning** (Awwwards · Active Theory · Basement · Rauno tier), dark-first.
This kit is the *floor*; the tournament + vision-QA loop raise the ceiling.

## Contents
| File | Role |
|---|---|
| `DESIGN.md` | Brand SSOT — DTCG tokens + the taste dials + rationale. Edit per project. |
| `tokens.json` | The same tokens in DTCG JSON (feed Style Dictionary / native platforms). |
| `globals.css` | Tailwind v4 `@theme` + `:root`/`.dark`, OKLCH cinematic palette, fluid type, motion tokens. **Edit this one file; everything re-themes.** |
| `package.json` | Canonical dependency set (Tailwind v4, shadcn/Base UI, Motion, Fontsource, number-flow, Lenis, GSAP, R3F/drei, paper shaders). |
| `components/cinematic-hero.tsx` | Signature shader-bg + kinetic hero — defines the hero bar. |
| `components/button.tsx` | Six-microstate button — defines the interaction bar. |

## Drop-in (Next.js / Vite + Tailwind v4)
```bash
cp ~/auramaxing/design-kit/globals.css            ./src/app/globals.css   # or src/styles
cp ~/auramaxing/design-kit/DESIGN.md ~/auramaxing/design-kit/tokens.json ./
cp -r ~/auramaxing/design-kit/components/*         ./src/components/ui/
# merge package.json deps, then:
pnpm add tailwindcss @tailwindcss/postcss motion @number-flow/react lenis gsap \
  @fontsource-variable/geist @fontsource-variable/geist-mono \
  three @react-three/fiber @react-three/drei postprocessing @paper-design/shaders-react
```

## The non-negotiables this kit encodes
- OKLCH semantic tokens only — **no raw hex/px** in components (token lint blocks it).
- Dark-first; the same token name flips in `.dark`, never inverted by hand.
- Every interactive element ships all six microstates (default/hover/focus/active/disabled/loading).
- Loading = skeletons, not spinners. Custom `box-shadow` focus rings. `prefers-reduced-motion` respected.
- Motion ≤200ms interactions / <300ms transitions, `ease-out`, transform/opacity only.

## Then: the tournament
Run `/design-tournament` (or invoke the `front-10x` skill) — ≥3 cinematic variants, separate
vision-judge, your taste gate, polish the winner. Gates: hallmark 65 + axe + Lighthouse + vision-QA.
