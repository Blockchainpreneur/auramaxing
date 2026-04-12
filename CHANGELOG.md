# Changelog

All notable changes to Auramaxing are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-12

Initial release. Repolished from CLAUDEMAX with full rebrand to Auramaxing.

### Added

- **Aura autopilot engine** (`rational-router-apex.mjs`) — complexity scoring, 15 task types, auto-routing to gstack skills, ENRICH protocol for production-ready defaults
- **20 hooks** covering the full lifecycle: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop events
- **Browser CDP integration** — `browser-server.mjs` and `browser-tab.mjs` for tab-based Chrome automation via the user's existing session (no new windows, sessions preserved)
- **LightRAG semantic search** — sentence-transformers (all-MiniLM-L6-v2, 384-dim), 500-doc index with oldest-first pruning, content-based vector dedup
- **NotebookLM integration** — core memory layer with per-project notebooks, deep recall fallback, NLM-compressed session briefings (~100 tokens, 87% reduction), auto auth refresh via Chrome CDP
- **PII redactor** (`pii-redactor.mjs`) — PreToolUse gate that blocks API keys, tokens, passwords, and credentials before Write/Edit/Bash executes
- **Code quality gate** (`code-quality-gate.mjs`) — PreToolUse scanner for hardcoded secrets (block), debug statements, `any` types, and empty catch blocks (warn)
- **Self-healing engine** (`self-heal.mjs`) — records winning strategies, retries up to 3 alternatives on failure, persists outcomes to `~/.auramaxing/learnings/`
- **Statusline** with MAXING label — displays model, context%, weekly limit%, real cost vs API cost
- **Prompt engine** with anti-laziness system — 5-step planning gate, NLM-generated directives, task-specific CLAUDE.md segments (~500 tokens vs ~6,000 full)
- **Memory lifecycle** — session-start loads, prompt-engine searches (LightRAG + NLM), session-stop saves, NLM compresses in background
- **Intent predictor** — analyzes recent sessions to predict next task for precomputation
- **10-step precompute pipeline** — runs in background after session stop (vector dedup, knowledge graph, intent prediction, LightRAG rebuild)
- **Token optimization** — average ~478 tokens/prompt (down from ~1,200-2,750), prompt deduplication, per-task CLAUDE.md segments
- **State daemon** (port 57821) — persistent project state across hooks
- **Cross-project knowledge graph** — scans gstack + Claude memory across all projects
- **Type-aware memory pruning** — 50 sessions, 30 prompts, 10 decisions with oldest-first eviction

### Fixed

- Shell injection in router (`execSync` replaced with `execFileSync` + stdin)
- Question filter blocking investigation queries
- NLM cache key collision (SHA256 replaces 40-char truncation)
- Anti-laziness regex stripping digits from task names (e.g., `e2e-testing`)
- Memory pruning flooding (separate limits by type)
- False-positive failure detection in post-tool-use hook

### Changed

- Full rebrand from CLAUDEMAX to Auramaxing — all paths, references, environment blocks, and display strings updated
- Autopilot engine renamed from Ripple to Aura
- All data paths moved to `~/.auramaxing/`
- Project root at `~/auramaxing/`
