# AURAMAXING

**A persistent cognitive operating system for Claude Code.**

AURAMAXING transforms Claude Code from a stateless terminal assistant into a context-aware, self-routing, self-healing execution environment. Every prompt is classified, enriched, and executed through a defined pipeline. Memory accumulates across sessions via NotebookLM and LightRAG. Safety guards run on every write. The system operates without user intervention.

---

## Architecture

AURAMAXING is composed of seven layers:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — Cognitive Router (UserPromptSubmit)              │
│  Classifies prompt against 25 task types. Computes          │
│  complexity score. Selects model tier. Emits routing        │
│  directives: EXECUTE / SPAWN / THINK / AUTOCHAIN.           │
│  Planning Gate enforces 5-step structured thinking.         │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2 — Safety Guards (PreToolUse)                       │
│  PII redactor: blocks API keys, tokens, wallet addresses.   │
│  Code quality gate: rejects hardcoded secrets, empty catch. │
│  Runs on every Write / Edit / Bash invocation.              │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3 — Event Accumulator (PostToolUse)                  │
│  Writes structured tool events to turn-events.jsonl.        │
│  Tool-specific failure detection (replaces blind regex).    │
│  Forwards to daemon for long-term session memory.           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 4 — Completion Feedback (Stop)                       │
│  Reads accumulated events. Renders DONE diagram.            │
│  Writes structured session summary to daemon.               │
├─────────────────────────────────────────────────────────────┤
│  LAYER 5 — Session Context (SessionStart)                   │
│  Reads project memory from daemon + NLM notebook.           │
│  Session intent prediction. Injects NLM-synthesized         │
│  briefing. Starts Ruflo swarm engine. Status bar.           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 6 — NotebookLM + LightRAG (Core Memory)             │
│  Per-project NLM notebooks auto-created on first session.   │
│  LightRAG semantic search (sentence-transformers,           │
│  all-MiniLM-L6-v2, 384-dim dense embeddings).               │
│  NLM deep recall fallback when LightRAG returns weak.       │
│  Cross-project knowledge graph. NLM auth auto-refresh       │
│  via Chrome CDP.                                            │
├─────────────────────────────────────────────────────────────┤
│  LAYER 7 — Anti-Laziness & Token Optimization               │
│  NLM generates aggressive, task-specific directives.        │
│  CLAUDE.md per-task segments (16 types, ~500 tokens).       │
│  Master progress accumulator (infinite memory via NLM).     │
│  10-step precompute pipeline on session end.                │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

- **Aura Autopilot** — always-on router, prompt enrichment, model selection
- **NotebookLM CLI** — core memory layer, per-project notebooks, deep recall fallback
- **LightRAG** — semantic search with sentence-transformers (384-dim dense embeddings)
- **Planning Gate** — 5-step structured thinking on every prompt
- **THINK directive** — deep reasoning for complex tasks (>=50% complexity)
- **AUTOCHAIN** — full autopilot task execution without user intervention
- **Anti-laziness enforcement** — NLM-generated, aggressive, per-task-type directives
- **Session intent prediction** — predicts what the user will need before they ask
- **Self-healing** — tool-specific failure detection, 3-retry with learned strategies
- **Status bar** — model, context%, weekly limit%, real cost vs API cost

---

## Key Features (v0.7.0)

### Memory
- Per-project NLM notebooks auto-created on first session
- Master progress file accumulates decisions/patterns/failures across sessions
- Cross-project knowledge graph (scans gstack + Claude memory)
- NLM auth auto-refresh via Chrome CDP (no silent failures)
- Content-based vector dedup (eliminated 48% duplicates)
- 500-doc index cap with oldest-first pruning
- Type-aware memory pruning (50 sessions, 30 prompts, 10 decisions)

### Token Optimization
- CLAUDE.md per-task segments (16 types, ~500 tokens vs ~6,000 full)
- Session briefing synthesized by NLM (87% token reduction)
- Learnings synthesized into 5 rules (96% token reduction)
- Prompt deduplication (stops echoing user prompt)
- Average tokens/prompt: ~478 (down from ~1,200-2,750)

### Infrastructure
- 10-step precompute pipeline (background, on session end)
- Tool-specific failure detection (replaces blind regex)
- Shell injection fix (execSync to execFileSync with stdin)
- Session intent prediction
- Status bar with live metrics

---

## Task Taxonomy

The cognitive router classifies prompts against 25 task types. See CLAUDE.md for the full taxonomy.

**Entrepreneur**: brain-dump, write-content, brainstorm, decide, research, strategy, pitch, fundraise, hire

**Engineering**: bug-fix, new-feature, deploy-ship, design, security, refactor, performance, investigate, planning, code-review, autoplan

Complexity scoring adjusts dynamically: repeat task types get +15%, large projects get +5%.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Blockchainpreneur/AURAMAXING/main/install.sh | bash
```

Or clone and run locally:

```bash
git clone https://github.com/Blockchainpreneur/AURAMAXING ~/auramaxing
cd ~/auramaxing && bash install.sh
```

---

## Hook Pipeline

```
Event             File                          Function
─────────────────────────────────────────────────────────────────────
PreToolUse        pii-redactor.mjs              Block secrets on Write/Edit/Bash
PreToolUse        code-quality-gate.mjs         Block hardcoded creds, warn on any/empty-catch
UserPromptSubmit  rational-router-apex.mjs      Classify → route → Planning Gate → directives
PostToolUse       post-tool-use-apex.mjs        Accumulate tool events, failure detection
Stop              task-complete.mjs             DONE diagram + structured session summary
Stop              session-stop.mjs              Post session end to memory daemon
SessionStart      session-start.mjs             Welcome panel + status bar
SessionStart      session-start-daemon.mjs      Inject NLM-synthesized project context
SessionStart      ruflo daemon                  Start swarm engine (60+ agents)
```

All hooks exit 0 unconditionally. Claude never waits on them.

---

## gstack — AI Software Factory (28 Skills)

Sprint workflow: `/office-hours` → `/plan-ceo-review` → `/plan-eng-review` → `/plan-design-review` → `/design-consultation` → `/review` → `/investigate` → `/design-review` → `/qa` → `/qa-only` → `/cso` → `/ship` → `/land-and-deploy` → `/canary` → `/benchmark` → `/document-release` → `/retro`

Power tools: `/browse`, `/autoplan`, `/codex`, `/careful`, `/freeze`, `/unfreeze`, `/guard`, `/setup-deploy`, `/gstack-upgrade`

Non-negotiable: never ship without `/review` + `/qa` + `/cso`. After deploy: `/canary` then `/retro`.

---

## Memory System

Session memory stored at `~/.auramaxing/contexts/{project-slug}.md`. NotebookLM notebooks at `~/.auramaxing/nlm/{project-slug}/`. LightRAG index at `~/.auramaxing/lightrag/`.

The 10-step precompute pipeline runs on session end:
1. Accumulate tool events → 2. Synthesize session summary → 3. Update NLM notebook → 4. Rebuild LightRAG index → 5. Deduplicate vectors → 6. Prune by type limits → 7. Generate anti-laziness directives → 8. Compress learnings → 9. Build per-task CLAUDE.md segments → 10. Update cross-project knowledge graph

---

## MCP Servers

11 servers available. Use CLI tools first; MCP only when no CLI equivalent exists.

- **context7** — live framework/library docs
- **shadcn** — UI component registry
- **supabase** — database, auth, storage
- **github** — PRs, issues, releases (prefer `gh` CLI)
- **sentry** — error monitoring
- **figma** — design file reading
- **n8n** — workflow automation
- **magicuidesign** — Magic UI components
- **playwright** — browser automation (prefer CLI)
- **chrome-devtools** — Chrome DevTools Protocol
- **sequential-thinking** — structured reasoning

---

## Requirements

- macOS or Linux
- Node.js >= 18
- Claude Code CLI — `npm install -g @anthropic-ai/claude-code`
- Bun — `curl -fsSL https://bun.sh/install | bash`
- Python 3.10+ (for sentence-transformers / LightRAG)

---

## License

MIT
