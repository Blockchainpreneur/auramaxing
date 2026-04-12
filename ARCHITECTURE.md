# Auramaxing v1.0.0 — Complete Architecture

## State Machine

```
                         ┌─────────────────┐
                         │   USER OPENS     │
                         │   CLAUDE CODE    │
                         └────────┬────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │    SESSION START HOOK     │
                    │   session-start.mjs       │
                    │                          │
                    │  1. Update check          │
                    │     └─ UPGRADE? → block   │
                    │  2. Load memory           │
                    │     └─ NLM compressed     │
                    │        (~100 tokens)      │
                    │  3. Load learnings        │
                    │  4. Welcome panel (stderr)│
                    │  5. [AURAMAXING MEMORY]    │
                    │     → stdout for Claude   │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │  USER TYPES    │
                         │  A PROMPT      │
                         └───────┬───────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │     UserPromptSubmit HOOK             │
              │     rational-router-apex.mjs (AURA)   │
              ├──────────────────────────────────────┤
              │                                      │
              │  ┌────────┐ ┌──────────┐ ┌────────┐ │
              │  │UPDATE  │ │ PROMPT   │ │ ROUTE  │ │
              │  │CHECK   │ │ ENGINE   │ │+ENRICH │ │
              │  └───┬────┘ └────┬─────┘ └───┬────┘ │
              │      │          │            │      │
              │      ▼          ▼            ▼      │
              │  ┌────────┐ ┌──────────┐ ┌────────┐ │
              │  │Cache:  │ │1.Memory  │ │Score   │ │
              │  │60min/  │ │  search  │ │complex │ │
              │  │12hr    │ │2.NLM     │ │<3%=off │ │
              │  │        │ │  auto-   │ │3-49%=  │ │
              │  │        │ │  call(bg)│ │ medium │ │
              │  │        │ │3.Anti-   │ │50%+=   │ │
              │  │        │ │  lazy    │ │ complex│ │
              │  │        │ │4.Quality │ │        │ │
              │  │        │ │  gate    │ │15 task │ │
              │  │        │ │5.Save    │ │types   │ │
              │  └────────┘ └──────────┘ └────────┘ │
              │                                      │
              │  Output to Claude (stdout):           │
              │  [AURAMAXING UPDATE]     (if outdated) │
              │  [AURAMAXING PROMPT-ENGINE] (enriched) │
              │  [AURAMAXING DISPLAY]    (loading bar) │
              │  [AURAMAXING DIRECTIVE]  (hidden)      │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │          CLAUDE PROCESSES              │
              │                                      │
              │  Reads CLAUDE.md protocols:           │
              │  • UPDATE → AskUserQuestion (blocks)  │
              │  • PROMPT-ENGINE → follow enriched    │
              │  • DISPLAY → render loading bar       │
              │  • DIRECTIVE → read, don't output     │
              │  • MEMORY → use context silently      │
              │  • SELF-HEAL → try recovery strategy  │
              │  • After tools → ✓ Done + ~$X.XX      │
              └──────────────────┬───────────────────┘
                                 │
                      ┌──────────┼──────────┐
                      │          │          │
                      ▼          ▼          ▼
              ┌────────────┐ ┌──────┐ ┌──────────┐
              │ PreToolUse │ │ TOOL │ │PostToolUse│
              │            │ │ RUNS │ │           │
              │ pii-       │ │      │ │ post-tool-│
              │ redactor   │ │      │ │ use-apex  │
              │ ├─approve  │ │      │ │           │
              │ └─BLOCK    │ │      │ │ 1.Log     │
              │            │ │      │ │ 2.SELF-   │
              │ code-      │ │      │ │   HEAL    │
              │ quality-   │ │      │ │   detect  │
              │ gate       │ │      │ │   failure │
              │ ├─approve  │ │      │ │   → suggest│
              │ └─warn     │ │      │ │   recovery│
              └────────────┘ └──────┘ └──────────┘
                                 │
                      (repeats per tool call)
                                 │
                                 ▼
                       ┌─────────────────┐
                       │ CLAUDE RESPONDS  │
                       │ ┌─[ ✓ Done ]──┐ │
                       │ │ task  ...    │ │
                       │ │ cost ~$X.XX  │ │
                       │ └─────────────┘ │
                       └────────┬────────┘
                                │
                                ▼
              ┌──────────────────────────────────────┐
              │          STOP HOOKS                    │
              │                                      │
              │  task-complete.mjs                    │
              │  ├─ Render diagram (stderr only)      │
              │  ├─ Clear turn events                 │
              │  └─ Send to daemon                    │
              │                                      │
              │  session-stop.mjs                     │
              │  ├─ Save session memory (JSON)        │
              │  ├─ Save decisions (if exist)          │
              │  ├─ AUTO: spawn NLM compress (bg)     │
              │  ├─ Prune memory (keep 50)             │
              │  └─ Send to daemon                    │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
                       ┌─────────────────┐
                       │  NEXT SESSION    │
                       │  loads NLM-      │
                       │  compressed      │
                       │  memory          │
                       │  (~100 tokens)   │
                       └─────────────────┘
```

## Data Flow

```
~/.auramaxing/
├── memory/                     Session memory
│   ├── 2026-04-10-*.json       Raw entries (pruned to 50)
│   └── _compressed-summary.json NLM-compressed briefing
├── learnings/                  Self-healing patterns
│   ├── *-success.json          Winning strategies
│   └── *-failure.json          Error logs
├── nlm-cache/                  NotebookLM cache (1hr TTL)
├── nlm-notebook-id             Active NLM notebook
├── turn-events.jsonl           Current tool events
├── current-task.json           Current task from Aura
├── last-update-check           Version cache
└── chrome-cdp-profile/         Chrome session data

~/.claude/
├── CLAUDE.md                   All protocols
├── settings.json               Hooks + permissions
├── helpers/                    Active hooks (synced)
└── skills/obsidian/            Knowledge skills

~/auramaxing/
├── helpers/                    Source hooks
├── daemon/                     State daemon (port 57821)
├── scripts/                    Browser, update, batch tools
├── setup/                      Installer configs
├── skills/                     Custom skills
├── install.sh                  One-command installer
└── VERSION                     1.0.0
```

## Hook Execution Order

| Event | Hooks | What they do |
|-------|-------|-------------|
| SessionStart | session-start → daemon → ruflo | Memory load + welcome + update |
| UserPromptSubmit | rational-router-apex (Aura) | Update check + prompt engine + route + enrich |
| PreToolUse | pii-redactor → code-quality-gate | Block secrets + code quality |
| PostToolUse | post-tool-use-apex | Log events + self-healing |
| Stop | task-complete → session-stop | Diagram + memory save + NLM compress |

## Tool Priority

| Priority | Type | Examples |
|:---:|------|---------|
| 1 | gstack skills | /investigate, /review, /qa, /ship, /cso |
| 2 | CLI tools | codex, gws, firecrawl, playwright, notebooklm |
| 3 | Browser CDP | browser-server.mjs, browser-tab.mjs |
| 4 | MCP servers | context7, shadcn, sentry, supabase, github |

## Installed Tools

| Tool | Version | Command |
|------|---------|---------|
| GWS | 0.22.5 | `gws` |
| Codex | 0.118.0 | `codex` |
| Playwright | 1.59.1 | `npx playwright` |
| Firecrawl | 1.13.0 | `firecrawl` |
| NotebookLM | 0.3.4 | `notebooklm` |
| LightRAG | 1.3.9 | `lightrag` |
| Bun | 1.3.4 | `bun` |
| Node | 20.19.0 | `node` |

## Components (20 Helpers)

| # | Helper | Purpose |
|---|--------|---------|
| 1 | `rational-router-apex.mjs` | Aura autopilot engine — scores complexity, routes tasks, emits directives |
| 2 | `rational-router.mjs` | Legacy router (deprecated, superseded by apex) |
| 3 | `prompt-engine.mjs` | Enriches every prompt with memory, anti-laziness gates, and quality requirements |
| 4 | `session-start.mjs` | SessionStart hook — welcome panel, update check, memory load, NLM briefing |
| 5 | `session-start-daemon.mjs` | Pings the state daemon on session start, writes project context |
| 6 | `session-stop.mjs` | SessionStop hook — saves session memory, prunes entries, spawns NLM compress |
| 7 | `task-complete.mjs` | Stop hook — renders completion diagram from accumulated tool events |
| 8 | `pii-redactor.mjs` | PreToolUse gate — blocks secrets, API keys, and credentials before Write/Edit/Bash |
| 9 | `code-quality-gate.mjs` | PreToolUse gate — scans generated code for anti-patterns and hardcoded secrets |
| 10 | `post-tool-use-apex.mjs` | PostToolUse hook — logs events, detects failures, triggers self-healing |
| 11 | `self-heal.mjs` | Self-healing engine — records strategies, retries on failure, logs successes |
| 12 | `memory-enrich.mjs` | Surfaces relevant past decisions and context on UserPromptSubmit and SessionStart |
| 13 | `memory-learn.mjs` | PostToolUse learner — stores tool outcomes and patterns with rich context |
| 14 | `notebooklm-bridge.mjs` | CLI bridge to NotebookLM for offloading reasoning and memory compression |
| 15 | `nlm-session-setup.mjs` | Background process spawned by session-start to prepare NLM notebook |
| 16 | `nlm-auth-refresh.mjs` | Auto-refreshes NotebookLM authentication via Chrome CDP |
| 17 | `lightrag-bridge.mjs` | Node.js wrapper around LightRAG Python CLI with caching and timeouts |
| 18 | `intent-predictor.mjs` | Analyzes recent sessions and predicts next likely task for precomputation |
| 19 | `precompute-pipeline.mjs` | 10-step background pipeline that runs after SessionStop (non-blocking) |
| 20 | `claudemd-segments.mjs` | Task-specific CLAUDE.md segment generator — serves ~500 tokens per task type |

## Hook Pipeline Detail

### SessionStart Pipeline

```
Claude Code opens
  │
  ├─ session-start.mjs
  │   ├─ Reads ~/auramaxing/VERSION → compares with remote
  │   │   └─ Outdated? → emits [AURAMAXING UPDATE] block (blocks everything)
  │   ├─ Loads ~/.auramaxing/memory/_compressed-summary.json (NLM briefing)
  │   ├─ Loads ~/.auramaxing/learnings/*-success.json (winning strategies)
  │   ├─ Renders welcome panel → stderr (visible to user, not Claude)
  │   └─ Emits [AURAMAXING MEMORY] → stdout (Claude reads silently)
  │
  ├─ session-start-daemon.mjs
  │   └─ HTTP POST to daemon (port 57821) with project context
  │
  └─ nlm-session-setup.mjs (background, detached)
      ├─ Creates/verifies per-project NLM notebook
      ├─ Uploads master progress file if changed
      └─ Caches notebook ID → ~/.auramaxing/nlm-notebook-id
```

### UserPromptSubmit Pipeline (Aura)

```
User types a prompt
  │
  rational-router-apex.mjs (Aura)
  │
  ├─ 1. UPDATE CHECK
  │   └─ Reads ~/.auramaxing/last-update-check (60min/12hr cache)
  │       └─ Stale? → fetch remote VERSION → emit [AURAMAXING UPDATE] if newer
  │
  ├─ 2. PROMPT ENGINE (prompt-engine.mjs)
  │   ├─ memory-enrich.mjs → searches memory for matching past decisions
  │   ├─ lightrag-bridge.mjs → semantic vector search (all-MiniLM-L6-v2, 384-dim)
  │   │   └─ Weak results? → notebooklm-bridge.mjs deep recall fallback
  │   ├─ Anti-laziness injection (5-step planning gate, NLM-generated directives)
  │   ├─ Quality gate enforcement (production requirements per task type)
  │   ├─ claudemd-segments.mjs → serves only relevant CLAUDE.md sections (~500 tokens)
  │   └─ intent-predictor.mjs → predicts next task for prefetch
  │
  ├─ 3. ROUTE + ENRICH
  │   ├─ Scores complexity: <3% trivial, 3-49% medium, 50%+ complex
  │   ├─ Maps to one of 15 task types → selects gstack skill or direct action
  │   └─ Appends ENRICH block (production defaults the user didn't ask for)
  │
  └─ OUTPUT → stdout (Claude reads all blocks):
      ├─ [AURAMAXING UPDATE]        (if version outdated)
      ├─ [AURAMAXING PROMPT-ENGINE] (enriched prompt + memory + anti-laziness)
      ├─ [AURAMAXING DISPLAY]       (loading bar — rendered verbatim)
      └─ [AURAMAXING DIRECTIVE]     (EXECUTE/ENRICH/TOOLS/SPAWN — hidden from user)
```

### PreToolUse Pipeline

```
Claude calls a tool (Write, Edit, Bash)
  │
  ├─ pii-redactor.mjs
  │   ├─ Scans tool_input for API keys, tokens, passwords, PII
  │   ├─ Match? → BLOCK (tool does not execute, Claude sees error)
  │   └─ Clean? → APPROVE (pass through)
  │
  └─ code-quality-gate.mjs
      ├─ Scans for hardcoded secrets → HIGH (block)
      ├─ Scans for debug statements, `any` types, empty catch → WARN
      └─ Clean? → APPROVE
```

### PostToolUse Pipeline

```
Tool finishes executing
  │
  post-tool-use-apex.mjs
  ├─ 1. Appends event to ~/.auramaxing/turn-events.jsonl
  │     (tool name, duration, input hash, exit code)
  ├─ 2. Failure detection (tool-specific, not blind regex)
  │     └─ Failure? → self-heal.mjs
  │         ├─ Checks ~/.auramaxing/learnings/ for known recovery
  │         ├─ Suggests up to 3 alternative strategies
  │         └─ Logs outcome (success.json or failure.json)
  └─ 3. memory-learn.mjs → stores tool outcome + context for future recall
```

### Stop Pipeline

```
Claude finishes responding
  │
  ├─ task-complete.mjs
  │   ├─ Reads turn-events.jsonl → renders completion diagram (stderr)
  │   ├─ Clears turn-events.jsonl for next turn
  │   └─ Sends summary to daemon
  │
  └─ session-stop.mjs (on session end)
      ├─ Builds session summary from events + current-task.json
      ├─ Saves to ~/.auramaxing/memory/YYYY-MM-DD-*.json
      ├─ Saves decisions (if any) separately
      ├─ Prunes memory (keep 50 sessions, 30 prompts, 10 decisions)
      ├─ Spawns NLM compress (background, detached)
      │   └─ notebooklm-bridge.mjs → compresses all memory → _compressed-summary.json
      └─ Sends session summary to daemon
```

### Self-Healing Flow

```
Tool call fails (non-zero exit, error pattern, timeout)
  │
  post-tool-use-apex.mjs detects failure
  │
  └─ self-heal.mjs
      │
      ├─ 1. LOOKUP: search ~/.auramaxing/learnings/*-success.json
      │     └─ Known pattern? → return winning strategy immediately
      │
      ├─ 2. RETRY: suggest up to 3 alternative approaches
      │     ├─ Strategy A: different tool or flag
      │     ├─ Strategy B: different approach entirely
      │     └─ Strategy C: fallback (manual or deferred)
      │
      ├─ 3. RECORD outcome:
      │     ├─ Success → write *-success.json (strategy + context + timestamp)
      │     └─ Failure → write *-failure.json (all attempts + error details)
      │
      └─ Next time same pattern appears → winning strategy tried first
```

### Memory Lifecycle

```
SESSION START
  │
  ├─ LOAD: session-start.mjs reads:
  │   ├─ ~/.auramaxing/memory/_compressed-summary.json  (NLM briefing, ~100 tokens)
  │   ├─ ~/.auramaxing/learnings/*-success.json         (winning strategies)
  │   └─ Emits [AURAMAXING MEMORY] block → Claude context
  │
  ▼
PROMPT (every turn)
  │
  ├─ SEARCH: prompt-engine.mjs / memory-enrich.mjs
  │   ├─ LightRAG vector search (semantic, 384-dim embeddings)
  │   ├─ NLM deep recall (fallback when LightRAG is weak)
  │   └─ Matching decisions injected into [AURAMAXING PROMPT-ENGINE]
  │
  ├─ LEARN: memory-learn.mjs (PostToolUse)
  │   └─ Stores tool outcomes + patterns in real time
  │
  ▼
SESSION STOP
  │
  ├─ SAVE: session-stop.mjs
  │   ├─ Writes session summary → ~/.auramaxing/memory/YYYY-MM-DD-*.json
  │   ├─ Writes decisions (if any) → separate entries
  │   └─ Prunes: 50 sessions, 30 prompts, 10 decisions (oldest first)
  │
  ├─ COMPRESS: NLM background job (detached)
  │   ├─ notebooklm-bridge.mjs reads all memory entries
  │   ├─ Synthesizes into single briefing (~100 tokens, 87% reduction)
  │   └─ Writes → _compressed-summary.json
  │
  └─ PRECOMPUTE: precompute-pipeline.mjs (background, 10 steps)
      ├─ Content-based vector dedup (eliminates ~48% duplicates)
      ├─ Cross-project knowledge graph update
      ├─ Intent prediction for next session
      └─ LightRAG index rebuild (500-doc cap, oldest-first pruning)
```

## MCP Servers (9)

context7, playwright, github, supabase, sequential-thinking,
firecrawl, sentry, n8n, figma
