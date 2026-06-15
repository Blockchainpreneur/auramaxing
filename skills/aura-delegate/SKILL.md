---
name: aura-delegate
description: ALWAYS invoke on any complex/multi-step build, implementation, refactor, research, or audit task where work can be parallelized. The strict Opus-4.8 orchestrator→Opus-fleet delegation engine — the main Opus 4.8 session stays the terse orchestrator + reviewer (plan, spec, accept/reject, fuse, crucial edits); an Opus 4.8 worker fleet does the bulk in parallel under a draconian gated harness. Maximizes coverage + correctness (parallel fan-out + independent adversarial verification) while keeping the orchestrator's judgment on every decision boundary. Skip only for trivial one-line edits or pure conversation.
---

# AURAMAXING Delegate — strict Opus-4.8 orchestrator→Opus-fleet orchestration

**Goal:** maximum-quality output at maximum throughput — keep the main Opus 4.8 session a terse orchestrator and fan the bulk out to an Opus 4.8 worker fleet under gates so strict that every returned piece is independently verified before it merges. Everything runs on Opus 4.8 at the highest presets: main AND every worker.

**Honest frame first:** one Claude Code session = one model, and that model is **Opus 4.8**. This is the **main Opus session spawning Opus 4.8 workers** — same tier, not a downgrade. The win is NOT cheaper tokens; it is **parallelism (independent sub-tasks run concurrently), fresh isolated context per sub-task (no context-window dilution), and independent adversarial verification (a separate Opus agent refutes each finding)**. The orchestrator still owns the crucial decision boundaries (spec, accept/reject, fuse, risky edits) because a single coherent judgment must sit above the fan-out. What is structurally enforced is the gatekeeper (evidence + completion), every agent at max spec.

## Orchestrator token budget — stay lean so the fleet scales
The main session (you) spends tokens ONLY on:
1. **PLAN** — decompose into atomic phases (compact).
2. **SPEC** — per sub-task: a tight, machine-checkable spec + an acceptance test (the contract).
3. **ACCEPT/REJECT** — read ONLY the worker's diff + the gate result, never its full context. One-line verdict.
4. **FUSE** — merge accepted pieces.
5. **CRUCIAL EDITS** — only the few highest-risk lines.

Everything else — drafts, broad research, exploration, file reads, boilerplate, mechanical edits — goes to the Opus fleet. **If you catch yourself generating bulk serially, STOP and fan it out.** Use prompt caching for the stable preamble; give each worker only the extracted minimal context (never dump a codebase into a worker).

## How to delegate (automatic — never ask the user to call anything)
- **In-session, parallel:** the `Agent` tool with `model: "opus"` (or omit `model:` to inherit the Opus session default) — one bounded sub-task per agent, fresh isolated context, minimal extracted context. Fan out independent sub-tasks in one message. Every spawn prompt MUST include **"ultrathink"**.
- **At scale, a Workflow:** decompose→verify→synthesize with `parallel()`/`pipeline()`; no non-Opus `model:` override on any `agent()` or `meta.phases` (omit it to inherit Opus). Use adversarial verify stages (N independent Opus skeptics per finding, kill on majority-refute).

## The worker harness — draconian, a worker is NEVER trusted raw
Every Opus sub-task ships with ALL of:
1. **Atomic + fully specified** — one sub-goal; exact files/signatures/IO examples; forbidden patterns. Never multi-step (you pre-split).
2. **Acceptance test ships WITH it** — a deterministic check (test / tsc / lint / build) that defines "done".
3. **Plan-before-code** — the worker states its approach; you approve or re-spec BEFORE it executes.
4. **Mandatory self-critique** — the worker returns "3 ways this is wrong + the failure mode it's most likely hitting" before its output.
5. **Deterministic gate on return** — REJECT unless the acceptance test passes (verify OUTCOMES, not utterances). No "looks right".
6. **2-of-3 redundancy on critical sub-tasks** — run 3 workers, require agreement; otherwise escalate to a focused orchestrator pass.
7. **Reflexion** — on a failed gate, append the failure reason to the spec and re-run; distill the pattern to memory so the next similar sub-task starts ahead.
8. **ZERO-TOLERANCE LOOP embedded in EVERY worker spec (non-negotiable)** — paste these 8 rules verbatim into every Opus sub-task so the worker is *forced* to loop to greatness, not just complete the task: (1) no Critical/High bug ships, (2) no gate skipped because "looks fine", (3) no merge without `/review` clean, (4) no phase advanced unverified, (5) nothing "done" without a passing `/qa`/test run, (6) query memory before re-researching a logged moat, (7) no build before `/plan-eng-review` clears architecture, (8) no deploy before `/ship` confirms coverage ≥35%. Plus the worker MUST run its atomic detail through the Tier-2 micro-loop (scope+20x hypothesis → build → `/qa` → `/review`+`/cso` → improve → **Absolute Greatness Gate: 3× YES with evidence**) and return that evidence. A worker return missing the loop evidence is REJECTED on sight — re-spec with the loop made explicit. Full text: `~/auramaxing/docs/ORCHESTRATION.md` §0.0.
9. **OPUS AT MAXIMUM presets — max diligence (non-negotiable)** — EVERY worker prompt MUST include the word **"ultrathink"** (engages the worker's MAXIMUM extended-thinking budget — no exceptions) and run at maximum effort (the ultracode session default — never lower a worker's capability). The spec is HEAVY prompt-engineering: evidence contract (the return must QUOTE real run output — test/build/lint logs + file:line) and banned phrases ("should work", "I think", "done" without run output ⇒ instant REJECT). A PreToolUse guard (`ultramax-guard.mjs`) hard-blocks any non-Opus spawn (sonnet/haiku/fable) and any spawn prompt missing "ultrathink" — if blocked, re-issue the same spawn with `model:"opus"` (or no model) + "ultrathink".

## The loop — auto-enforced, do not stop until 100/100
The router auto-opens the completion ledger on complex action tasks; the gatekeeper Gate 2 refuses to end the turn until the deliverable is marked done, and **Gate 3 (Absolute Greatness)** refuses until you record the 3-YES greatness pass. Per phase: **AUDIT → INVESTIGATE → PLAN → SPEC (with the Zero-Tolerance loop embedded) → DELEGATE(Opus fleet) → GATE → loop until pass.** After all phases: a **global adversarial audit** (skeptic pass; default not-done if uncertain) → loop to 100/100 → `node ~/.claude/helpers/ledger.mjs great <id> "<evidence>"` (records the greatness pass + marks done). Banned: "should work" / done-without-running / TODO — a claim without evidence is FALSE.

## When NOT to delegate
Keep it on the main session when the sub-task needs genuine architectural judgment, cross-cutting reasoning, or security-critical correctness — one coherent judgment must own those. Delegate anything a clear, bounded spec + a deterministic acceptance test would complete reliably, and anything that benefits from parallel fan-out or independent verification.
