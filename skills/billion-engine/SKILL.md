---
name: billion-engine
description: ALWAYS invoke when BILLION mode is active (the word "billion"/"billón" in the prompt → the router emits the BILLION directive). The Billion-Dollar Perpetual Engine operating protocol — 5 nested loops (Horizon→Mission→Goal→Execution→Reason-Act), the forced-quota engine (50 ideas in blocks), the 5 adversarial tournaments (A-E), autonomous-executability ranking, human-independence, and the anti-stop structured turn close. Inherits ULTRAMAX in full (Opus-4.8-only fleet at max presets). Doctrine: ~/auramaxing/docs/BILLION-ENGINE.md.
---

# Billion Engine — operating protocol

**Read the doctrine first** (`~/auramaxing/docs/BILLION-ENGINE.md`) — this skill is the
in-session execution protocol. BILLION inherits ULTRAMAX completely: Opus 4.8 exclusive,
every spawn inherits/sets opus + carries "ultrathink", guard enforces. Token cost is
not a constraint; exhaustive correctness and elite output are.

## 0 · State first (always)

Resolve `<project>` from cwd/context. State root: `~/.auramaxing/billion/<project>/`.
- `STATE.json` — current L0 thesis, stage (ladder rung 0-5), active mission, queue.
- `GOALS.md` — the prioritized objective queue (L1→L2 input), each with a measurable
  exit criterion + autonomous-executability score.
- `PROGRESS.log` — append-only; one line per completed gate with evidence.
- `SUGGESTIONS.md` — the ONLY place anything human-facing goes. Never a dependency.

On invocation: read state if it exists; create it from the current prompt if not
(bootstrap = run L0 once). Persist IMMEDIATELY after every transition — "lo escribo
después" is banned.

## 1 · The five loops (how to run them in-session)

- **L0 HORIZON** (run at bootstrap, stage changes, retros, market shifts): re-evaluate
  the $1B thesis — which structural moats (network effects · data flywheel · switching
  costs · speed · brand · supply-side scale) must exist to justify the multiple. Fire
  the FORCED-QUOTA engine on the stage's strategic question. Output: updated thesis +
  3-5 elite candidates injected into GOALS.md.
- **L1 MISSION**: translate thesis → this stage's concrete mission (per the 8-stage
  chain + ladder in the doctrine). Maintain world-state in STATE.json.
- **L2 GOAL**: pop ONE objective from GOALS.md. Decompose into atomic tasks
  (TaskCreate — the visible goal-loop). Exit only on its measurable criterion.
- **L3 EXECUTION**: per atomic task, the Absolute Perfection Loop (ORCHESTRATION §0.0)
  + the artifact's tournament. Delegate bulk to Opus 4.8 multi-agents (ultrathink in every
  spawn prompt — the guard enforces it).
- **L4 REASON-ACT**: the heartbeat — reason→act→observe; no claimed step without its
  observation. The parent gate verifies every "done" (nesting rule: ledger + gatekeeper
  Gates 1-3 are the mechanical floor).

## 2 · Forced-quota engine (L0/L1 — before ANY strategic decision)

1. Formulate a SPECIFIC vector (see doctrine for the rotating list — never "¿cómo
   crecemos?").
2. Generate **all 50** in marked blocks — `[1-5 OBVIAS]`, `[6-15 CÓMODAS]`,
   `[16-30 TRANSICIÓN — high review]`, `[31-50 PUNTOS CIEGOS]`. Hard rule: never stop
   early; if stuck use forced relations / problem inversion / rolestorming. Fan out
   Opus 4.8 agents to parallelize blocks when useful (each spawn: "ultrathink" + one
   block + the vector + no-filter instruction).
3. Hand the 50 to a tournament (adversarial judges score → kill → fuse).
4. **Select EXACTLY the 3 maximum-leverage ideas** (leverage = impact ×
   autonomous-executability ÷ effort — the maximum-leverage point, never just the
   easiest 3). Autonomy filter (hard): any candidate requiring human labor is
   REJECTED or transformed into its autonomous variant; human-facing → SUGGESTIONS.md.
5. **Execute ALL 3 → repeat (perpetual cadence):** inject the 3 into GOALS.md, run
   each to completion through L2/L3 (parent gate per objective), and ONLY when all
   3 gates close, RE-RUN the 50-ideas exercise on the new world-state. The cycle
   never breaks: 50 → top-3 → execute 3 → 50 → … Archive the ~47 losers per round.

## 3 · Tournaments (L2/L3 — no important output ships without one)

Pick by artifact: **A** copy/landing/spec/ad → 8 versions × 5 conflicting judges
(skeptical CFO · distracted founder at midnight · competitor · ideal customer ·
conversion copywriter), each scores AND explains, kill losers, fuse, show scoreboard.
**B** before building anything significant → interview with brutal pushback (≤15
questions, one at a time, hunt the blind spot, "eso es media respuesta" when vague),
then full spec + 3 failure modes, only then V1. **C** periodically on traction →
funded-rival-with-one-day persona over P&L/pricing/churn/tickets; rank every attack by
self-executability; build defenses against exactly those. **D** any negotiation →
become the counterparty, rounds, break character after each ("esto acabas de regalar").
**E** dense documents → read EVERYTHING (tables/footnotes/exhibits); 3 lists + 3 asks
with exact phrasing + lawyer flag.

Implement each tournament as parallel Opus 4.8 spawns (one judge/persona per agent,
"ultrathink" in every prompt) or a Workflow with adversarial verify — never one model
agreeing with itself.

## 4 · Human-independence (hard rule — the plan survives the human)

The plan contains ONLY engine-executable tasks. Never assign a task to a human. Humans
receive suggestions in SUGGESTIONS.md — the loop NEVER blocks on them. Approval-gated
actions (real money, production deploys, investor comms, on-chain, contracts) are
optional accelerators: queue the suggestion, immediately continue on the autonomous
route. If the human never responds — or disappears — the plan still reaches its gates.

## 5 · Anti-stop turn close (mandatory every BILLION turn)

End every turn with:

```
accion_realizada: <qué hizo>
observacion: <qué resultó>
siguiente_paso: <específico y ejecutable — esto ES el siguiente prompt>
tarea_completa: true|false
evidencia: <output real de runs / archivos / URLs>
```

`tarea_completa: true` is only valid when the PARENT gate verified it (ledger `great`
with evidence; Gates 1-3 enforce mechanically). Persist state BEFORE closing.

**WATCHDOG (mechanical, v1.16.0):** while BILLION is armed and ledger objectives are
open, every stop attempt is re-BLOCKED with a NUDGE by the gatekeeper (up to
`AURA_BILLION_NUDGES`=12 per prompt) — continuing is not your choice, it is enforced.
Respond to a nudge by continuing the top objective, never by arguing with it.

**STICKY + RESILIENT (BILLION does not turn off):** the router keeps the mode armed
for the whole session (`billion-mode.json`, rolling 24h, refreshed per prompt) — only
"billion off" / exit conditions clear it. RESUME-FIRST: every prompt while active
starts by reading STATE.json + GOALS.md and continuing the open objective. Open one
ledger item per active objective (completeness gate blocks silent stops). If a turn
must yield with objectives open, SCHEDULE your own continuation (ScheduleWakeup for
in-session pacing; the loop skill or cron for recurring/cross-session) — ending a
turn without a closed objective gate OR a scheduled continuation is a zero-tolerance
violation. Exit conditions (the ONLY four): $1B defensible · budget cap · human
kill-switch ("billion off") · detected dead-end (reprioritize; never loop the
impossible).

## 6 · Meta-engine (every retro)

Find repeated requests in the period → crystallize each into a skill/command/agent →
log to memory (LightRAG) → the next cycle starts more capable. Query memory BEFORE
re-researching anything (zero-tolerance rule 6).
