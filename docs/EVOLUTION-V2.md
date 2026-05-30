# AURAMAXING — Evolution to v2 (grounded theses + 10x roadmap)

> Deep architecture audit (2026-05-30) + research-backed theses on (a) converting processes
> to skills and (b) the genuine 10x moves left. Every claim is cited to primary/strong sources.
> This is the strategy doc; execution is staged below by ROI.

## The core finding (uncomfortable but evidenced)
**AURAMAXING's architecture is structurally inverted vs the 2026 consensus.** It puts the most
*advisory* content (doctrine) in the most *expensive always-on* slot (CLAUDE.md, ~6.9k tokens/turn),
and puts its *routing* — the thing that most needs the model's judgment — in a 728-line *regex hook*
that cannot reason. The leverage is to **flip both**. And the real 10x is not more breadth (we're
top-0.1% there) — it's **closing the measurement loop**: we have no way to know if a change made
AURAMAXING better or worse. "Self-improve" is currently theater (the model judging itself in-context,
which research shows is too generous).

---

## PART A — Process → Skill conversion (grounded theses)

**Rule the field converged on:** *Hooks fire on lifecycle events (deterministic, can BLOCK, can't
reason, cost compute/turn). Skills fire when the model judges them relevant (progressive disclosure
= ~30-100 tok metadata, body on-demand, but skippable). CLAUDE.md is always-true (full size every
turn). Subagents isolate context.* — Anthropic docs + community consensus.

### Thesis 1 — Convert the doctrine docs into SKILLS (saves ~4k tokens/turn). HIGH ROI.
Our 4 doctrine docs (~8.6k tokens) + 6.9k CLAUDE.md are procedural content only sometimes relevant.
Skills cost ~30-100 tok metadata until invoked, body loads on relevance (Anthropic: ~98% saving;
their own team keeps CLAUDE.md at ~2.5k tokens). **Convert ORCHESTRATION / DESIGN-SUPREMACY /
CAPABILITIES / AUTOPILOT-FLOW into skills with directive descriptions; leave a thin pointer in CLAUDE.md.**
Evidence: Anthropic Agent Skills post; Prompt Shelf token-budget; Code With Seb 98% saving.

### Thesis 2 — Keep INVARIANTS in CLAUDE.md, push PROCEDURES to skills (the Vercel nuance).
Vercel's eval: passive AGENTS.md index hit 100% vs skills 53% (skill never invoked in 56% of cases)
— BUT that test was *framework reference knowledge* (always-needed, no judgment). Lesson is NOT
"abandon skills"; it's **anything that must apply every relevant turn = passive context; procedures
that are sometimes-relevant = skills.** So: identity + non-negotiable rules (UX/UI-is-mandatory,
anti-slop, security, Iron Loop summary) STAY in a lean CLAUDE.md; the detailed how-to becomes skills.

### Thesis 3 — The 728-line regex router is the #1 anti-pattern. Replace with model-native routing.
It re-implements in brittle regex what skill *descriptions* do natively for ~50 tok each, it can't
reason (routing is the canonical "it depends" = skill not hook), and — critical — the 650-trial study
found a **hook injecting directives + passive skill description collapses activation to 37%** (vs 87.5%
no-hook). Our router could be *suppressing* the skills it wants. Fix: (a) rewrite skill descriptions in
**directive voice** ("ALWAYS invoke when… Do NOT do X directly") → ~20× activation lift (odds ratio
20.6, p<0.0001), up to 100% in bare conditions, FREE; (b) shrink the hook to deterministic context
injection only (memory restore, loading-bar) via `additionalContext`, NOT routing commands.

### Thesis 4 — Keep hooks NARROW and deterministic (what we already got right).
pii-redactor + code-quality-gate as `PreToolUse` blockers = correct, keep. session-start memory
restore = correct. The error is using hooks for *routing/behavior*. "If a hook needs conditional logic
or >a few seconds, it belongs in a skill" (official guidance).

### Thesis 5 — Package as a PLUGIN last (orthogonal to architecture).
A plugin (skills+hooks+MCP+commands, one `plugin.json`) gives versioned one-command distribution —
but packaging a bad architecture just makes it distributable. Fix Theses 1-4 first, then package.
Caveat: plugin listing text is an always-on token tax → keep descriptions tight (they double as the
router signal AND the tax).

**Net A:** flip the inversion — enforce with hooks, route with the model (directive descriptions),
keep invariants passive+tiny, let progressive disclosure carry procedures. Saves ~4k tok/turn AND
likely *raises* skill activation (stops the hook from fighting the model).

---

## PART B — The genuine 10x moves (we have a feedback-loop gap, not a capability gap)

### 10x-1 — EVAL HARNESS + GEPA OPTIMIZER (the single biggest move; #1 and #2 are one project)
We can't currently answer "did AURAMAXING get better or worse this month?" Fix:
- **Eval harness:** `~/.auramaxing/evals/` golden set of 30-50 real tasks (prompt → expected
  behavior). Judge = a SEPARATE Opus call with a rubric (never the executing agent — self-rating is
  too generous, per Anthropic). Gate via DeepEval (OSS, pytest-style, 50+ metrics) or Braintrust
  eval-action (blocks merge below threshold). Source: DeepEval docs, Braintrust.
- **GEPA (DSPy):** reflective prompt optimizer — reads traces/errors (not scalar reward), evolves the
  *text* of skills/router along a Pareto frontier; beats RL by ~20% with 35× fewer rollouts
  (arXiv 2507.19457, ICLR Oral; `pip install gepa` / `dspy.GEPA`). Turns our 101 hand-written skills
  from frozen markdown into artifacts that measurably improve against the eval set.
- **Why 10x not 10%:** converts a static library into a compounding, measured system. Every failure
  becomes signal that rewrites the skill. Note: Nous Hermes self-evolution = DSPy+GEPA under the hood
  → the credible frontier converged on this technique. Take the technique, skip the wrapper.

### 10x-2 — DETERMINISTIC GATEKEEPER (Stop/PostToolUse hook that BLOCKS). One afternoon.
Promote our judge to a Gatekeeper: a `Stop` hook that refuses to end the turn if code was touched and
tests don't pass; `PostToolUse` verify after risky Bash. Makes "done" = verifiably done, not
"model said done." This is our Iron Loop's "test" step ENFORCED by the harness. Source: Codex CLI TDD
workflow, agentic-QA literature.

### 10x-3 — FAILING-FEATURE-LIST on the handoff bundle (reliability tier-up). One afternoon.
Anthropic's long-running-harness pattern: an initializer writes a JSON list of 200+ granular features
all marked `failing`; later agents may only flip `passes`, never edit descriptions; each session does
ONE feature → test → commit → update. Our 40%-auto-handoff hands off *prose*; bolt on a
machine-checkable failing-feature contract → kills premature-completion + scope-drift across handoffs.
Source: Anthropic "Effective harnesses for long-running agents."

### 10x-4 — WORKTREE FLEET `/fleet` skill (execution width). Wiring, not invention.
Beyond Agent Teams (in-process, correlated failures): a `/fleet` skill that decomposes a task into N
independent subtasks, spins N git worktrees (port/DB isolation), runs an agent per worktree in
background, converges via PRs. We have all primitives (background Bash + Agent Teams + worktree
support). Build for **5 agents** (solo review capacity is the real ceiling, not 500). Source: Cognition
"orchestrates Devins", Factory droids, MindStudio worktree guide.

### 10x-5 — E2B SANDBOX routing for agent-generated code (safe aggressive autonomy). Adopt once fleets run.
We run with bypassPermissions + agents executing arbitrary code locally; pii-redactor only catches
secrets-to-disk, not destructive execution. Route agent-generated/ risky code through E2B Firecracker
microVMs → makes "let the agent just try things" safe to do aggressively (verification that ENABLES
more autonomy). Source: Modal sandbox roundup, E2B.

### 10x-6 — REASONINGBANK (strategy memory) layered on existing learnings.
Our NLM+LightRAG store facts/decisions; ReasoningBank stores generalizable *strategies* distilled from
successes AND failures, self-judged (+20% effectiveness, -16% steps; arXiv 2509.25140). Implement the
*pattern* lightly on top of `~/.auramaxing/learnings/` — distill a strategy (not a narration) after
each task, retrieve before similar ones. (We already gesture at this; make it real + measured by 10x-1.)

---

## Execution roadmap (ROI order — the priority)
1. **Directive skill descriptions + shrink router to context-injection only** (Thesis 3) — highest ROI, lowest effort, may immediately raise skill activation. *Do first.*
2. **Slim CLAUDE.md → skills for doctrine** (Theses 1-2) — ~4k tok/turn saved.
3. **Eval harness + Gatekeeper hook** (10x-1 + 10x-2) — THE move; makes everything else measurable.
4. **Failing-feature handoff** (10x-3) — long-task reliability.
5. **`/fleet` skill + E2B routing** (10x-4, 10x-5) — execution width + safe autonomy.
6. **Package as plugin** (Thesis 5) — last, once components are right.

**Through-line:** we don't have a capability gap — we have a feedback-loop + architecture-inversion gap.
Close those two and AURAMAXING stops being "config that feels advanced" and becomes one that *provably
compounds*.
