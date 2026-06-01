---
name: design-tournament
description: Run the N-variant design tournament — generate ≥3 cinematic variants in parallel from the SAME tokens with DIFFERENT taste dials, screenshot each, score with a SEPARATE vision-judge (not the builder), surface the top 2 to the user's taste gate, then polish the winner. Use when asked to "design tournament", "give me options", "variants", "make it competitive", or for any high-value UI (hero, landing, dashboard, key page). Tournament is ALWAYS ON by default in AURAMAXING.
---

# /design-tournament — N variants, separate judge, your taste gate

The single biggest quality jump in front-end output: stop shipping the first generation. Generate
diverse cinematic explorations, judge them with an independent critic, let the human pick taste.
Doctrine: `~/auramaxing/docs/DESIGN-SUPREMACY.md` §1 (tournament) + §1.5 (cinematic).

## Preconditions
- A committed `DESIGN.md` + `globals.css` tokens (from `~/auramaxing/design-kit/`, retuned via
  `designlang` on a reference). All variants share these tokens — they are variations, not chaos.

## Steps
1. **EXTRACT-REF** — `designlang` (MCP) on a best-in-class site for the domain → seed élite tokens.
   Never start a variant blank (that is where the generic AI look originates).
2. **GENERATE ≥3 VARIANTS IN PARALLEL** (subagents / Agent Teams), SAME tokens, DIFFERENT
   `design-taste-frontend` dials so they are real explorations:

   | Variant | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY | ATMOSPHERE | register |
   |---|---|---|---|---|---|
   | A — restrained cinematic | 4 | 6 | 4 | 5 | `minimalist-ui` |
   | B — bold / kinetic | 8 | 8 | 7 | 8 | `gpt-taste` (GSAP) |
   | C — atmospheric / 3D | 6 | 9 | 5 | 9 | `stitch-design-taste` |

   (Scale N up for hero/landing; add a 4th "wildcard" variant under ultracode.)
3. **SCREENSHOT each** at desktop + mobile — Playwright CDP (`browser-server.mjs`) or
   chrome-devtools MCP. Capture key scroll positions for cinematic/scroll-driven UI.
4. **SEPARATE VISION-JUDGE** — a DISTINCT Opus pass (NOT the builder; self-rating runs too
   generous). Score each variant 0–5 per screenshot against the hallmark 65-gates + the §6 Elite
   Checklist + "reads Awwwards-tier". Output a ranked table with one-line rationale per variant.
5. **HUMAN TASTE GATE** — surface the top 2 to the user (screenshots + scores). They choose.
   Judges narrow; humans decide taste. Use AskUserQuestion with image-style descriptions.
6. **POLISH THE WINNER** — run the `front-10x` sequence (emil motion → impeccable → gates →
   vision-QA loop). Graft the best ideas from the runner-up. Loop to 100/100.

## Cost & default
≈ N× generation tokens — acceptable and expected under `effortLevel: ultracode`. Tournament is the
AURAMAXING default for ALL surfaces; single-pass only for a trivial isolated tweak. Mirrors the
eval-harness "separate judge" pattern, applied to pixels.
