---
name: aura-delegate
description: ALWAYS invoke on any complex/multi-step build, implementation, refactor, research, or audit task where bulk labor can be offloaded. The strict Fable→Sonnet delegation engine — Fable (this session) stays the terse orchestrator + reviewer (plan, spec, accept/reject, fuse, crucial edits ≈5–10% of tokens); Sonnet workers do the bulk (≈90–95%) under a draconian gated harness. Maximizes output-per-token while keeping Fable's judgment on every decision boundary. Skip only for trivial one-line edits or pure conversation.
---

# AURAMAXING Delegate — strict Fable→Sonnet orchestration

**Goal:** Fable-quality output at a fraction of Fable's tokens, by keeping Fable a terse orchestrator and forcing Sonnet to do the bulk under gates so strict that a lazy and a diligent model converge on the same result.

**Honest frame first:** one Claude Code session = one model. This is the **main session (Fable) spawning Sonnet workers**, not token-level switching. Sonnet does NOT equal Fable on hard reasoning — that is exactly why the crucial 5–10% (spec, accept/reject, fuse, risky edits) stays on Fable. The bounded bulk approaches Fable quality *because Fable owns the spec + the gate*. The 90/10 token split is a **discipline + process**, not a hardware guarantee; what is structurally enforced is the gatekeeper (evidence + completion), not the ratio.

## Fable token budget — spend as little as possible
Fable (you) spend tokens ONLY on:
1. **PLAN** — decompose into atomic phases (compact).
2. **SPEC** — per sub-task: a tight, machine-checkable spec + an acceptance test (the contract).
3. **ACCEPT/REJECT** — read ONLY the worker's diff + the gate result, never its full context. One-line verdict.
4. **FUSE** — merge accepted pieces.
5. **CRUCIAL EDITS** — only the few highest-risk lines.

Everything else — drafts, broad research, exploration, file reads, boilerplate, mechanical edits — goes to Sonnet. **If you catch yourself generating bulk, STOP and delegate it.** Use prompt caching for the stable preamble; give each worker only the extracted minimal context (never dump a codebase into a worker).

## How to delegate (automatic — never ask the user to call anything)
- **In-session, parallel:** the `Agent` tool with `model: "sonnet"` — one bounded sub-task per agent, fresh isolated context, minimal extracted context. Fan out independent sub-tasks in one message.
- **At scale, on the box (cheap, 15 GB):** `ORCH_MODEL=claude-sonnet-4-6 AURA_FLEET_HOST=root@178.104.225.194 bash ~/auramaxing/cloud/orchestra.sh "<goal>" cloud/roles/<preset>.roles` — specialists + judges run Sonnet, the synthesizer keeps the strong default. Drives from the Mac as a thin client.

## The Sonnet harness — draconian, Sonnet is NEVER trusted raw
Every Sonnet sub-task ships with ALL of:
1. **Atomic + fully specified** — one sub-goal; exact files/signatures/IO examples; forbidden patterns. Never multi-step (you pre-split).
2. **Acceptance test ships WITH it** — a deterministic check (test / tsc / lint / build) that defines "done".
3. **Plan-before-code** — the worker states its approach; you approve or re-spec BEFORE it executes.
4. **Mandatory self-critique** — the worker returns "3 ways this is wrong + the failure mode it's most likely hitting" before its output.
5. **Deterministic gate on return** — REJECT unless the acceptance test passes (verify OUTCOMES, not utterances). No "looks right".
6. **2-of-3 redundancy on critical sub-tasks** — run 3 workers, require agreement; otherwise escalate to Fable.
7. **Reflexion** — on a failed gate, append the failure reason to the spec and re-run; distill the pattern to memory so the next similar sub-task starts ahead.

## The loop — auto-enforced, do not stop until 100/100
The router auto-opens the completion ledger on complex action tasks; the gatekeeper Gate 2 refuses to end the turn until you mark the deliverable done. Per phase: **AUDIT → INVESTIGATE → PLAN → SPEC → DELEGATE(Sonnet) → GATE → loop until pass.** After all phases: a **global adversarial audit** (skeptic pass; default not-done if uncertain) → loop to 100/100 → then `node ~/.claude/helpers/ledger.mjs done <id>`. Banned: "should work" / done-without-running / TODO — a claim without evidence is FALSE.

## When NOT to delegate
Keep it on Fable when the sub-task needs genuine architectural judgment, cross-cutting reasoning, or security-critical correctness — those are the 5–10%. Delegate anything a clear, bounded spec + a junior-developer-grade instruction would complete reliably.
