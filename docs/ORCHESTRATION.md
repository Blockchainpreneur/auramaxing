# AURAMAXING — Orchestration & Perpetual-Perfection Doctrine

> The brain. How AURAMAXING thinks, loops, parallelizes and verifies so its output is
> categorically 10x any other global Claude Code setup. Loaded on demand by the router;
> the always-on summary lives in `~/.claude/CLAUDE.md` → "Perpetual Perfection Loop".

Version 1.0 · 2026-05-29 · Model floor: Opus 4.8 · `effortLevel: ultracode`

---

## 0. The Iron Loop (NON-NEGOTIABLE on every executional task)

Every task — one-line fix or greenfield — runs this closed loop. Depth scales with the
task; the discipline does not. **Do not stop on the first "good enough." Loop until the
exit bar is met.**

```
        ┌──────────────────────────────────────────────────────────┐
        ▼                                                          │
  1. RESEARCH ──▶ 2. PLAN ──▶ 3. EXECUTE ──▶ 4. AUDIT ──▶ 5. TEST ──▶ 6. SELF-IMPROVE
   investigate     lock the     build the      adversarial   prove it    distill the
   don't assume    approach     complete thing  review        runs        learning
        │                                                          │
        └────────────── if AUDIT or TEST finds anything ──────────┘
                         (restart at the step that owns the gap)
```

1. **RESEARCH** — Read every relevant file fully. Map the dependency chain. Enumerate edge
   cases. Never guess an API/signature — verify via context7, WebSearch/WebFetch, `/browse`,
   `firecrawl`, or a research subagent. Retrieve prior learnings (`~/.auramaxing/learnings/`,
   NLM, LightRAG) before re-deriving anything.
2. **PLAN** — State the end-to-end approach before writing a line. For non-trivial work route
   through `/office-hours` → `/plan-eng-review` (+ `/plan-ceo-review`, `/plan-design-review`
   as warranted), or GitHub spec-kit (`/speckit.specify → plan → tasks`). Strong specs
   multiply across a fleet; vague specs propagate errors in N directions.
3. **EXECUTE** — Build the COMPLETE thing (states, errors, edge cases, tests). Parallelize
   independent streams (see §2). Match surrounding code style.
4. **AUDIT** — `/review` + `/cso` + cross-model `/codex` (a *different* model family catches
   blind spots same-model self-review cannot). UI work also gets the Design Supremacy audit.
5. **TEST** — Prove it. Real runs, real browser (`npx playwright test` / CDP), type-check,
   lint. For UI: vision-QA loop + axe-core + Lighthouse CI. "I think it's done" is banned.
6. **SELF-IMPROVE** — Distill a win/loss learning (the ReasoningBank pattern), write it so
   the next similar task retrieves it. Then re-enter the loop if any gate failed.

### Exit bar ("done" = wow, not "works")
Stop only when: all audit gates pass clean, all tests green, and a senior engineer using it
for the first time would say *"this is great."* Functional ≠ done. Working ≠ done. Anything
less ⇒ restart at the step that owns the gap. Be **autonomous** — the user already said go.

---

## 1. Orchestration ladder — pick the smallest tool that fits

| Scope signal | Tool | Notes |
|---|---|---|
| 1–3 files, no logic change, mechanical | **Solo, direct edit** | No ceremony. |
| Single investigation/build track | **One subagent** (Agent tool) | Isolated context, returns the conclusion. |
| 2–5 independent streams | **Parallel subagents / Agent Teams** | One message, multiple Agent calls. Cap **3–5** worktree agents (review is the bottleneck, not generation). |
| Decompose + verify + synthesize at scale | **Workflow** | Pipeline by default; barrier only when a stage needs all prior results. Adversarial verify each finding. |
| Long/large multi-session effort | **Goals + checkpoints** | See §4. |

**Default under ultracode:** lean toward orchestrating with workflows and *adversarially
verifying* findings — unless the work is trivial or already verified. Solo only on
conversational turns or trivial mechanical edits. Token cost is not the constraint;
exhaustive correctness is the objective.

### Quality patterns (compose freely)
- **Adversarial verify** — N independent skeptics per finding, prompted to *refute*; kill if
  majority refute. Stops plausible-but-wrong findings.
- **Perspective-diverse verify** — give each verifier a distinct lens (correctness / security
  / perf / repro) instead of N identical ones.
- **Judge panel** — generate N attempts from different angles, score with parallel judges,
  synthesize from the winner grafting the best of runners-up.
- **Loop-until-dry** — keep spawning finders until K consecutive rounds surface nothing new.
- **Multi-modal sweep** — parallel agents each searching a different way (by-symbol,
  by-content, by-entity, by-time).
- **Completeness critic** — a final agent asking "what's missing — modality not run, claim
  unverified, file unread?" Its output becomes the next round.
- **No silent caps** — if coverage is bounded (top-N, sampling), `log()` what was dropped.

---

## 2. Parallelization rules
- All independent operations in ONE message (reads, writes, bash, agent spawns).
- Worktree isolation when agents mutate files concurrently; **cap 3–5** (rate limits, disk,
  and review overhead cancel gains beyond that). Never run more agents than you can review.
- Act before explaining. Reference established context; never re-explain it.

---

## 3. Verification doctrine — prove, don't claim
- Every claim of "done" carries evidence: command output, test result, screenshot, diff.
- **Cross-model** is mandatory for non-trivial code: `/codex` review/challenge.
- **UI** is never "done" without the agent *seeing* its own output (vision-QA loop).
- If tests fail, say so with the output. If a step was skipped, say that. No hedging when
  verified; no false confidence when not.

---

## 4. Goals & auto-activation (large / multi-session work)
When a task is large, multi-phase, or spans sessions, **auto-activate structured goal
tracking** — do not hold it in your head:
- Open a goal/task list (`TaskCreate`/`TaskList`, or gstack `/checkpoint`) at the start;
  mark `in_progress`/`completed` as you go; clean stale items.
- For long-running autonomy use the long-running-harness pattern: a machine-readable
  progress file (JSON, not Markdown, so it resists drift) listing every sub-goal as
  pending/passing; each cycle reads state → does ONE sub-goal → tests → commits → updates.
- `/checkpoint` before context refresh; the 40% auto-handoff preserves state — resume
  directly, never re-ask the user.
- Use `/loop` for recurring/poll tasks; `/schedule` only when a concrete future date/ETA
  exists in the work.

---

## 5. Memory & compounding intelligence (ReasoningBank pattern)
- **Retrieve before acting:** check learnings + NLM + LightRAG for prior solutions to similar
  tasks. "Didn't we fix this before?" should always be answered from memory.
- **Distill after acting:** write a compact learning from *both* successes and failures
  (strategy, not narration) so future tasks improve. Keep `CLAUDE.md`/`AGENTS.md`
  **human-curated** — auto-generated memory files add ~0 and cost tokens + reliability.
- Self-heal: on failure, try ≤3 alternative strategies, then log the winner.

---

## 6. Standard one-phase pipelines (chain across turns; read each result before next)
- **Understand** — parallel readers over subsystems → structured map.
- **Design** — judge panel of N approaches → scored synthesis → Design Supremacy pipeline.
- **Review** — dimensions → find → adversarially verify each finding.
- **Research** — multi-modal sweep → deep-read → synthesize → completeness critic.
- **Migrate** — discover sites → transform each (worktree isolation) → verify.

---

## 7. Strategic stance on the swarm layer (claude-flow / Ruflo)
claude-flow's headline benchmark is fabricated and its core execution paths are stubbed;
its V3 overlaps native Claude Code Agent Teams ~92%. **Do not treat it as the engine.**
Backbone = native subagents + Agent Teams + Skills + a few MCP servers + gstack patterns.
Keep only the *idea* worth keeping (vector memory + ReasoningBank distillation), implemented
lightly. The 10x is discipline — specs, plan/verify, cross-model review, worktree isolation —
not framework surface area.

---

## 8. The 10x adoption shortlist (infra)
1. **Serena** (semantic-code MCP) — `find_symbol`/`find_references`/atomic edits, 40+ langs.
2. **GitHub spec-kit** — spec-driven `/speckit.*`, Claude-Code-native.
3. **Exa** (neural search) — semantic web recall nothing else in the stack has.
4. **E2B / Vercel Sandbox** — run generated code in isolation before trusting it.
5. **Sequential-thinking + a real temporal memory** (fix NLM / or Graphiti) — reasoning + recall.
Lazy-load all MCP (Tool Search is on); CLI-first per the TOOLS doctrine.
