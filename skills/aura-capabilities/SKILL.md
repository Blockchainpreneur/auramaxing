---
name: aura-capabilities
description: Invoke when you need to know WHICH tool, skill, MCP, or CLI AURAMAXING should use for a task, or when a capability gap blocks the prompt and you may need to install something. The capability registry + the autopilot composition rules + on-demand auto-install triggers. Use to pick the smallest sufficient tool set per task and to self-extend when a needed capability is missing.
---

# AURAMAXING Capabilities — what to compose, and how to self-extend

Full registry: read `~/auramaxing/docs/CAPABILITIES.md` and the task→tool table in `~/auramaxing/docs/AUTOPILOT-FLOW.md`. Operative summary:

## Active MCP (8, lazy-loaded via Tool Search)
context7 (lib docs) · shadcn (components) · magicui (animated) · **designlang** (site→DTCG tokens) · **deepwiki** (external/OSS repo Q&A, no clone) · **chrome-devtools** (devtools/perf). (6 registered MCP — serena/codegraph are NOT installed; use Grep/Glob + the Explore agent for symbol nav/repo graph.) CLI-first: prefer `gh`, `firecrawl`, `codex`, Playwright CLI over MCP on cost ties. NEVER Playwright MCP.

## Reasoning/planning brains
gstack `/office-hours` `/plan-eng-review` `/plan-ceo-review` `/plan-design-review` `/autoplan` · spec-kit (`specify`) · sequential-thinking · native Agent Teams + Workflows · `/codex` (cross-model).

## Memory
NLM (`python3 -m notebooklm`) + LightRAG + file memory + learnings. deepwiki for external repos. Retrieve before acting; distill after (ReasoningBank pattern).

## On-demand auto-install (free; verify source, then install + proceed — no manual step)
- 3D/video/audio/office-app automation → `/plugin marketplace add HKUDS/CLI-Anything` → `/cli-anything <app>`
- Real Word/Excel/PPT/PDF → `npx skills add anthropics/skills` (document skills)
- "make it look like <site>" → **designlang** MCP `/extract <url>`
- Understand an OSS library → **deepwiki** MCP `ask_question`
- Elite UI ship-gate → `nutlope/hallmark` + `npx @google/design.md lint`
- Brand SSOT seed → a `DESIGN.md` from `VoltAgent/awesome-design-md`
- Any skill → `npx skills add <owner/repo>` (vercel-labs/skills standard manager)

## Composition rule
Router proposes (DISPLAY/ENRICH/ORCHESTRATE), agent composes the smallest sufficient set per fit, doctrines govern. An MCP earns its slot only if no clean CLI exists AND (regular use OR unique capability) — else CLI or per-project add.

## Key-gated (ASK user for keys, don't assume)
Exa (neural search) · v0 API · Mobbin MCP · E2B/Vercel sandbox · Magic Patterns · Builder.io/Subframe.
