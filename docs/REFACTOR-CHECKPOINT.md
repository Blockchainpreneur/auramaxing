# AURAMAXING v2 Refactor — Execution Checkpoint (resume after /clear)

> Self-contained. Everything needed to execute the v2 refactor + refinement loop with zero
> re-research. Rationale + citations: `EVOLUTION-V2.md`. Run the Iron Loop on each step;
> do not stop until each step's VERIFY passes. Reversible — git-commit after each step.

## State as of 2026-05-30 (verified)
- Router: `~/auramaxing/helpers/rational-router-apex.mjs` (728 lines, parses OK, regex classifier).
- Global CLAUDE.md: `~/.claude/CLAUDE.md` (~6.9k tokens, always-on — TOO BIG).
- Doctrine docs (~8.6k tok): ORCHESTRATION, DESIGN-SUPREMACY, CAPABILITIES, AUTOPILOT-FLOW, EVOLUTION-V2, DESIGN-STACK-SETUP, REFACTOR-CHECKPOINT (this).
- MCP own (8, all connect): context7, magicui, shadcn, serena, codegraph, designlang, deepwiki, chrome-devtools.
- Skills: 101 (UX/UI must-stack 7/7: frontend-design, emil-design-eng, impeccable, design-taste-frontend, high-end-visual-design, hallmark, ui-ux-pro-max; +43 marketing).
- 17 hooks, all files exist. uv/uvx symlinked to ~/.local/bin. NLM via `python3 -m notebooklm`.
- 2 plugins removed (amazon-location, aws-serverless). github/supabase/figma MCP removed earlier.

## The 2 problems being fixed (from EVOLUTION-V2)
1. **Architecture inverted** — advisory doctrine in always-on CLAUDE.md; routing in a regex hook that can't reason. FLIP both.
2. **No feedback loop** — can't measure if a change helps. Self-improve = model judging itself (too generous). ADD eval harness.

---

## EXECUTION STEPS (ROI order — do in sequence, commit after each)

### STEP 1 — Directive skill descriptions + shrink router to context-injection (highest ROI, free, reversible)
**Why:** directive descriptions → ~20× activation (OR 20.6, p<0.0001); a hook injecting routing directives can collapse skill activation to 37% (650-trial study). The model should route, not regex.
**Do:**
- Audit which routing the regex actually does that the model can't do natively. Most of `RULES`/`TOOL_RECS` can become directive descriptions on the skills themselves + a lean ENRICH.
- Rewrite the design/feature/bugfix skill descriptions (and any custom AURAMAXING skills) in directive voice: "ALWAYS invoke when <trigger>. Do NOT do X directly." (not passive "Use when…").
- Shrink the router hook: KEEP the loading-bar DISPLAY + memory/context injection (via `additionalContext`) + the ORCHESTRATE one-liner; REMOVE the heavy per-task TOOLS regex tables (the model + skill descriptions now carry that). Keep it <150 lines.
- Do NOT let the hook inject prescriptive routing that competes with skill selection.
**VERIFY:** `node --check` passes; dry-run 3 prompts still show DISPLAY + a lean directive; skills still listed. Commit.

### STEP 2 — Slim CLAUDE.md → doctrine as skills (saves ~4k tok/turn)
**Why:** CLAUDE.md is always-on; procedures belong behind progressive disclosure. Keep INVARIANTS only.
**Do:**
- KEEP in CLAUDE.md (lean, target ~2-2.5k tok): identity, Visual Protocol, the non-negotiable INVARIANTS (UX/UI-is-mandatory one-liner + anti-slop list, security rules, Iron Loop summary, permissions). Replace long sections with one-line pointers.
- CONVERT the deep procedures (full Iron Loop detail, full Design Supremacy pipeline, capability registry, autopilot-flow table) into SKILLS with directive descriptions (e.g. `aura-orchestration`, `aura-design-supremacy`). The existing docs become the skill bodies.
**VERIFY:** CLAUDE.md token count ~halved (`wc -c ~/.claude/CLAUDE.md` → /4); the new skills appear in skill list; a design prompt still triggers the design skill. Commit.

### STEP 3 — EVAL HARNESS + GATEKEEPER (THE 10x move — makes everything measurable)
**Why:** close the feedback loop. Without it, "self-improve" is theater and STEP-4 GEPA is impossible.
**Do:**
- `~/.auramaxing/evals/` — golden set of 30-50 real tasks (prompt → expected behavior/output), drawn from real past sessions.
- Judge = a SEPARATE Opus call with an explicit rubric (NEVER the executing agent). Use DeepEval (OSS, pytest-style) or Braintrust eval-action (blocks merge < threshold).
- **Gatekeeper `Stop` hook:** if the session touched code, run the test command; block + re-prompt on failure. "Done" = verifiably done.
**VERIFY:** eval suite runs and emits a score; intentionally break a skill → score drops → caught. Gatekeeper blocks a failing-test turn. Commit.

### STEP 4 — GEPA optimizer over top skills (compounding quality)
**Why:** evolves the TEXT of skills/router against the eval set; beats RL ~20% w/ 35× fewer rollouts.
**Do:** `pip install gepa` / `dspy.GEPA`. Optimize the 3 highest-traffic skills (router rules, /investigate, a design skill) against STEP-3 evals. Commit optimized SKILL.md only if eval score improves.
**VERIFY:** post-GEPA eval score ≥ pre. Commit (or discard if no gain).

### STEP 5 — Failing-feature handoff + /fleet + E2B (reliability + width)
- **5a Failing-feature list:** add a JSON feature contract (all `failing`, later agents only flip `passes`) to the 40% handoff bundle (`context-threshold-monitor.mjs`). Kills premature-completion.
- **5b `/fleet` skill:** decompose → N git worktrees (port/DB isolation) → agent per worktree in background → converge via PRs. Build for 5 agents.
- **5c E2B sandbox:** route agent-generated/risky code through E2B microVMs (needs API key — ASK user).
**VERIFY each:** handoff JSON round-trips; /fleet spawns+converges a 2-task demo; E2B runs a sandboxed script. Commit.

### STEP 6 — Package as PLUGIN (last)
Bundle skills+hooks+MCP+commands under `.claude-plugin/plugin.json` for versioned one-command install. Only after 1-5 are clean. Keep descriptions tight (listing text = always-on token tax).

---

## THE REFINEMENT LOOP (run until absolute perfection)
After each step: `Iron Loop` (research→plan→execute→AUDIT→TEST→self-improve). Specifically:
1. Make the change. 2. `node --check` + dry-run + `agnix` on own configs (`npx agnix@latest ~/.claude/CLAUDE.md`). 3. Run the STEP-3 eval suite → score. 4. If score ↓ or any gate fails → revert/fix, restart the step. 5. Cross-model `/codex` on non-trivial diffs. 6. Commit only when green. 7. Distill a learning. **Do not advance to the next step until the current step's VERIFY is green AND eval score did not regress.**

## Exit bar
AURAMAXING v2 is done when: CLAUDE.md ≤2.5k tok, router ≤150 lines (no per-task regex tables), doctrine lives in directive-described skills, eval harness + Gatekeeper gate every change, and a measured eval score exists that v2 ≥ v1. "Feels better" is not the bar — the eval score is.

## PROGRESS (2026-05-30)
- ✅ **STEP 1 DONE** — 3 doctrine skills created with DIRECTIVE descriptions, live + verified in skill list:
  `aura-orchestration`, `aura-design-supremacy`, `aura-capabilities` (in `~/.claude/skills/`, bodies point to the docs).
- ✅ **STEP 2 SUBSTANTIALLY DONE** — CLAUDE.md slimmed **6899 → 4017 tokens (−42%, ~2.9k tok/turn saved)**.
  Collapsed Perpetual-Perfection + Design-Supremacy + UI/UX + gstack verbose sections into thin pointers to the
  3 skills, keeping INVARIANTS (Iron Loop one-liner, UX/UI-mandatory, anti-slop, gstack decision tree, permissions,
  Visual Protocol, memory/handoff). All critical invariants verified present.
- ⏳ Optional: shave CLAUDE.md further toward ≤2.5k (remaining is mostly legit always-on: Aura autopilot, browser,
  permissions). Diminishing returns — don't cut real invariants.
- ✅ Perfect-handoff mechanism upgraded (context-threshold-monitor + session-start): captures checkpoint-doc +
  next-action + edited files; restore surfaces FIRST NEXT ACTION + RESUME PLAN. Committed (0368cea).

## NEXT: STEP 3 — EVAL HARNESS + GATEKEEPER (the 10x move; see section above)
This is THE move. Build `~/.auramaxing/evals/` golden set + separate-Opus judge + a `Stop` gatekeeper hook.
Then STEP 4 (GEPA), STEP 5 (failing-feature handoff / fleet / E2B), STEP 6 (plugin).

## First action next session
Start **STEP 3** (eval harness + Gatekeeper). It needs no API keys (DeepEval is OSS) and makes every further
change measurable. If STEPs 1-2 need a final polish first, do that, else go straight to STEP 3.
