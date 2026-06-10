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
2. **PLAN (ultrathink)** — Run RESEARCH + PLAN under EXTENDED THINKING (ultrathink): reason
   deeply, compare 2-3 candidate approaches and pick the best WITH explicit reasons, map every
   edge case. **CLARITY GATE (hard): do not write a single line of code until the strategy is
   airtight and you can explain WHY it is correct.** State the end-to-end approach before writing a line. For non-trivial work route
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

## 0.5 The Phased Excellence Loop (MANDATORY shape of every actionable task)

The Iron Loop above is the *atom*. The **Phased Excellence Loop** is how that atom is
applied to a whole task: **every task is decomposed into phases, and every phase is itself
a full Iron-Loop run, gated by a 100/100 score before the next phase begins.** This is
non-negotiable and forceful — operate extended; never shortcut, never stop early, never hand
unfinished work back to the user.

```
ROUTE (gstack — IMPLICIT in every task) → decompose into PHASES (TaskCreate, all in ONE task)
   │   auto-INJECT supporting sub-tasks per phase: tool/repo/skill SEARCH · research · EXAMPLES
   │
   ▼   for each PHASE, the SAME opening sequence — no phase skips a step:
   ├─ a. AUDIT       inspect the current real state of what this phase touches
   ├─ b. INVESTIGATE read every relevant file; verify APIs (context7/codegraph/serena/deepwiki/web);
   │                 gather real reference EXAMPLES / proven implementations; never guess
   ├─ c. PLAN        state the full approach for the phase before any code
   ├─ d. SELECT THE BEST  actively SEARCH + COMPARE candidate tools/repos/skills (ToolSearch +
   │                 CAPABILITIES.md + WebSearch for best-in-class); install FREE on a gap;
   │                 pick the BEST fit, not merely an available one
   ├─ e. EXECUTE     build the COMPLETE thing — states, errors, edge cases, tests; no placeholders
   │
   ▼   PER-PHASE GATE
   ├─ TEST + VERIFY + REVIEW (/qa + /review + /cso + cross-model /codex) → SCORE 0–100
   └─ if < 100 ──▶ fix & LOOP back into this phase. Do NOT advance until 100/100.
   │
   ▼   (next phase repeats a→e + gate)
   │
   ▼   FINAL GATE (after ALL phases)
   ├─ run the SAME full TEST + VERIFY + REVIEW across the ENTIRE deliverable → SCORE 0–100
   └─ if < 100 ──▶ fix & LOOP. NEVER stop until 100/100 at the highest standard.
```

**Rules that bind it:**
- **Same opening every phase.** AUDIT → INVESTIGATE → PLAN → SELECT → EXECUTE. A phase that
  skips its audit/investigation is invalid.
- **Per-phase 100/100 gate.** A phase is not "done" at "works" — it is done at 100/100 on the
  TEST+VERIFY+REVIEW pass. Below 100 ⇒ loop inside the phase.
- **gstack is implicit in every task.** Always route through it — it is never an opt-in.
- **Pick the BEST, by active search — every phase.** Tool/repo/skill selection is not chosen once
  up front, and not limited to what's already installed. Each phase **searches and compares**
  candidates (ToolSearch + `~/auramaxing/docs/CAPABILITIES.md` + WebSearch for best-in-class) and
  installs FREE skills/MCP on a capability gap, then picks the **best** fit — not merely an
  available one.
- **Auto-inject supporting sub-tasks.** Each phase spawns and completes, before EXECUTE:
  (i) a tool/repo/skill **search**, (ii) an **investigation/research** pass, (iii) a **reference
  examples** gather (proven implementations to model the work on). Track them with TaskCreate.
- **Final 100/100 gate.** After the last phase, the whole deliverable gets the full pass again
  and loops until 100/100. The per-phase gates do not exempt the global gate.
- **Never stop until absolute greatness on the highest standard.** No "good enough", no partial
  delivery, no asking the user to verify what you can verify yourself. Autonomous — the user
  already said go.
- **Scoring is honest.** 100/100 means: all audit gates clean, all tests green, every edge case
  covered, and a senior engineer's first reaction is "this is great." Inflated scores defeat the
  loop — score what is real, then close the gap.

The router injects this loop as the `PHASED EXCELLENCE LOOP` directive on every actionable
prompt (full form ≥50% complexity, condensed form ≥30%); the prompt-engine injects it as the
`[PHASED EXCELLENCE LOOP]` gate. This doctrine is the detail those directives point to.

---

## 0.6 Anti-laziness rigor — evidence over assertion (the enforcement teeth)
Exhortation ("operate extended") is not enough — text alone lets "done" mean "I stopped." These
hard rules make the loop bite:

1. **Evidence over assertion.** A claim with no evidence is FALSE. "Done / fixed / works / passes"
   require proof IN THE SAME TURN: the command you ran + its real output, the test that went
   red→green, the root cause at file:line, the screenshot. BANNED: "should work", "I think",
   "probably", "this should fix it", "looks correct". If you didn't run it, you don't know it.
2. **Root cause, not symptom.** Every fix names the root cause with file:line BEFORE the edit and
   addresses it — not the surface symptom. A vague, temporary, or "good enough for now" patch is a
   non-fix: it gets rejected and the phase loops. Add a regression test (red before / green after).
3. **Investigation minimums (no guessing).** Read every file on the path fully; verify any API /
   signature / behavior via context7/codegraph/serena/deepwiki/WebSearch before relying on it. A
   guessed signature or an unread file is a defect, not a shortcut.
4. **Adversarial verification (separate skeptic).** Self-rating runs too generous. After building/
   fixing, run a SEPARATE refute pass (a distinct subagent or a clean-eyes re-read) whose job is to
   BREAK the result — edge cases, error paths, races, the "obviously fine" claim. Default to
   NOT-done when uncertain. For substantial work: N skeptics, majority-refute kills the claim. The
   eval-harness "separate judge" pattern, applied to every deliverable.
5. **Honest 100/100.** Scored against evidence, never vibes. 100 = all gates green WITH pasted
   proof, root cause closed, regression passing, edge cases covered, and a senior engineer's first
   reaction is "this is great." Inflated scores defeat the loop — score what is real, then close
   the gap and re-run.
6. **The Stop gate is real.** `evidence-gatekeeper.mjs` (Stop hook) BLOCKS the turn from ending
   when source code changed but no verification ran. You cannot stop on an unverified change.
   (Fail-open by design; `AURA_GATEKEEPER_OFF=1` only when verification is genuinely impossible.)

---

## 0.7 The Fable→Sonnet Orchestration Engine (ALWAYS ON, automatic)

Default model is **Fable 5** (`claude-fable-5`): the orchestrator + reviewer. **Sonnet 4.6** does the bulk under strict gates. Fully automatic — no manual tool/skill/model calls; the autopilot wires the loop from every prompt.

**The loop, per prompt:**
1. **Intercept** — `rational-router-apex.mjs` (UserPromptSubmit) runs on EVERY prompt.
2. **Build the loop** — on any action task (complexity ≥30) it auto-opens a session-scoped completion ledger (`~/.auramaxing/ledger.json`).
3. **Enforce** — `evidence-gatekeeper.mjs` (Stop hook) refuses to end the turn until **Gate 1** (every source change has a *passing* verification — verify OUTCOMES not utterances; a failing test does NOT count) and **Gate 2** (the ledger deliverable is marked done via `ledger.mjs done <id>`, only after the full verified + globally-audited loop). Loop to 100/100 with evidence.
4. **Delegate** — the **`aura-delegate`** skill: Fable stays terse (plan · spec · accept/reject · fuse · crucial edits); Sonnet workers (`Agent model:sonnet`, or box `orchestra.sh ORCH_MODEL=claude-sonnet-4-6`) do the bulk under a draconian gated harness (atomic spec + acceptance test, plan-before-code, mandatory self-critique, deterministic gate on return, 2-of-3 redundancy on critical, Reflexion on failure). Sonnet output is never trusted raw — it passes a deterministic gate or gets re-specced.

**Honest economics (no inflated claims):** realistic token split is **~25–40% Fable / 60–75% Sonnet**; the 5–10% Fable ideal is not reachable on complex/novel work (the orchestrator's plan + diff-review + accept/reject + fuse is irreducible). By cost Fable stays **~55–60%** (it is ~3.3× pricier/token). Real win: **Fable-level orchestration quality at ~30–50% lower cost than Fable-solo** — NOT a measured 10×, NOT 90/10. One session = one model (Fable spawns Sonnet workers, not token-level switching). Sonnet ≠ Fable on hard reasoning — that is why the crucial 5–10% stays on Fable. Grounded in orchestrator-worker + Reflexion + harness-engineering research (external-gate verification, durable cross-context state).

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
