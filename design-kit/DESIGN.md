# DESIGN.md — brand source of truth (TEMPLATE — retune per project)

> The single design contract every step reads. Generated/refreshed via `/design-consultation`
> or by extracting a reference site with `designlang` (MCP). Anchor: **cinematic / award-winning**.

## Direction (the taste dials)
| Dial | Range | This project | Meaning |
|---|---|---|---|
| `DESIGN_VARIANCE` | 0–10 | **6** | How far from convention (0 = system default, 10 = experimental). |
| `MOTION_INTENSITY` | 0–10 | **8** | Cinematic motion budget (scroll scenes, hero animation). |
| `VISUAL_DENSITY` | 0–10 | **5** | Information density (3 = airy editorial, 8 = dense product). |
| `ATMOSPHERE` | 0–10 | **7** | Grain/mesh/depth/glow (cinematic backgrounds). |
| Register | — | `stitch-design-taste` | Style register (minimalist-ui / gpt-taste / industrial-brutalist-ui / stitch-design-taste). |

Mode: **dark-first**. Reference anchors: _<add 2–3 Awwwards/Active-Theory/Basement URLs here;
extract their tokens with designlang before building>_.

## Typography
- **Display:** one Fontshare/Fontsource display face (Satoshi / General Sans / Switzer) — brand voice, heroes only.
- **Body/UI:** Geist Variable (self-hosted via Fontsource). **Mono:** Geist Mono / Monaspace.
- Fluid scale via `clamp()` (Utopia), ≤6 sizes, base 16px. Negative tracking on display (−1…−3%).
- Headings 500–600; weight never changes on hover; `tabular-nums` on changing numbers.

## Color (OKLCH — see `globals.css` / `tokens.json` for values)
- One dominant + one sharp signature accent (acid-chartreuse default). No purple→blue-on-white.
- Radix-style semantic steps; same token flips in `.dark`. Verify contrast WCAG2 AA **and** APCA.
- All color in CSS variables — never a raw hex in a component.

## Motion (emil-design-eng law)
- Interactions ≤200ms, transitions <300ms, drawers ~500ms. `ease-out` entrances; transform/opacity only.
- Springs for organic motion; proportional scale (dialogs from ~0.8, press to ~0.96). Respect reduced-motion.
- Cinematic layer: Lenis smooth scroll + GSAP ScrollTrigger for narrative; lazy-load 3D below the fold.

## States & a11y (every interactive element)
default · hover · focus (custom `box-shadow` ring) · active · disabled · loading (skeleton).
Empty states prompt the next action. Errors inline near the trigger. Touch targets ≥44px / inputs ≥16px.

## Gates (must pass — CI, not eyeball)
hallmark 65-gate · axe-core zero serious/critical · Lighthouse perf ≥0.9 & a11y ≥0.9 ·
LCP ≤2.5s / CLS ≤0.1 / TBT <200ms · visual-regression baseline clean · token-lint (no raw hex/px).
