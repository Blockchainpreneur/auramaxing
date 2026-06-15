---
name: aura-orchestration
description: ALWAYS invoke at the start of any non-trivial coding, building, debugging, refactoring, deploying, or multi-step task. The AURAMAXING orchestration brain — the Iron Loop (research→plan→execute→audit→test→self-improve), how to compose tools/agents/skills, when to parallelize, and the exit bar. Do NOT start substantial work without applying this. Skip only for pure conversation or one-line trivial edits.
---

# AURAMAXING Orchestration — the Iron Loop

Full doctrine: read `~/auramaxing/docs/ORCHESTRATION.md` for the complete detail. This is the operative summary.

## The Iron Loop (non-negotiable on every executional task)
`RESEARCH → PLAN → EXECUTE → AUDIT → TEST → SELF-IMPROVE`, and **loop back** whenever AUDIT or TEST finds anything — restart at the step that owns the gap. Never stop on the first "good enough."

1. **RESEARCH** — read all relevant files; map dependencies; never guess an API (verify via context7/deepwiki + Grep/Explore/WebSearch); retrieve prior learnings first.
2. **PLAN** — state the full approach before coding; route through `/office-hours` → `/plan-eng-review` (+ceo/design) or spec-kit for non-trivial work. Strong specs multiply across agents.
3. **EXECUTE** — build the COMPLETE thing (states, errors, edge cases, tests); parallelize independent streams in one message; match surrounding style.
4. **AUDIT** — `/review` + `/cso` + cross-model `/codex`. UI also runs aura-design-supremacy.
5. **TEST** — prove it: real runs/browser (`npx playwright test`)/type-check/lint; UI adds vision-QA + axe + Lighthouse. "I think it's done" is banned.
6. **SELF-IMPROVE** — distill a win/loss learning so the next similar task retrieves it.

## Compose tools per fit (the registry is aura-capabilities / CAPABILITIES.md)
- **trivial** → answer direct. **medium** → 1 gstack skill + relevant MCP/CLI, verify with evidence.
- **complex** → full Iron Loop + parallel subagents/Agent Teams (cap 3-5 worktrees) OR a Workflow + adversarial verify (N skeptics, majority-refute kills) + synthesis.
- Under `ultracode`: default to multi-agent orchestration on substantial tasks; token cost is not the constraint, exhaustive correctness is.
- CLI > skill > MCP on cost ties. Cross-model `/codex` on non-trivial code.

## Goals & long work
Auto-activate TaskCreate/`/checkpoint` for large/multi-phase/multi-session tasks. Keep a machine-checkable progress file. `/checkpoint` before context refresh; the auto-handoff preserves state — resume directly, never re-ask.

## Exit bar
Done = a senior engineer's first reaction is "this is great." Functional ≠ done. Working ≠ done. Prove "done" with evidence (output/tests/screenshots). If a gate fails, restart at the owning step.

## Stance
Native Claude Code (subagents + Agent Teams + Skills) + gstack + a few MCP = the backbone. NOT claude-flow as an engine. The 10x is discipline, not framework surface.
