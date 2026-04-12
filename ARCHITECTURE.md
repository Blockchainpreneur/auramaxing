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

## MCP Servers (9)

context7, playwright, github, supabase, sequential-thinking,
firecrawl, sentry, n8n, figma
