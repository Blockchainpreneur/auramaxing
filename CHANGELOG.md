# Changelog

## v0.7.0 (2026-04-12)

### Core: NotebookLM + LightRAG Autopilot
- NotebookLM CLI integrated as core memory layer (not optional)
- LightRAG semantic search with sentence-transformers (all-MiniLM-L6-v2, 384-dim)
- Per-project NLM notebooks auto-created on first session
- Master progress file accumulates all decisions/patterns/failures across sessions
- NLM deep recall fallback when LightRAG returns weak results
- NLM auth auto-refresh via Chrome CDP (no more silent failures)
- Cross-project knowledge graph (scans gstack + Claude memory across projects)

### Anti-Laziness System
- Planning Gate enforced on every prompt (5-step structured thinking)
- THINK directive for complex tasks (>=50% complexity)
- AUTOCHAIN for full autopilot task execution
- NLM generates aggressive, specific anti-laziness directives per task type

### Token Optimization
- CLAUDE.md per-task segments (16 types, ~500 tokens vs ~6,000 full)
- Session briefing synthesized by NLM (87% token reduction)
- Learnings synthesized into 5 rules (96% token reduction)
- Enrichments compressed by NLM
- Prompt deduplication (stops echoing user prompt)
- Average tokens/prompt: ~478 (down from ~1,200-2,750)

### Infrastructure
- 10-step precompute pipeline (runs background on session end)
- Content-based vector dedup (eliminated 48% duplicates)
- 500-doc index cap with oldest-first pruning
- Type-aware memory pruning (50 sessions, 30 prompts, 10 decisions)
- Tool-specific failure detection (replaces blind regex)
- Shell injection fix (execSync → execFileSync with stdin)
- File consolidation (both router copies synced)
- Session intent prediction
- Status bar: model, context%, weekly limit%, real cost vs API cost

### Bug Fixes
- Fixed shell injection in router execSync
- Fixed question filter blocking investigation queries
- Fixed NLM cache key collision (SHA256 replaces 40-char truncation)
- Fixed anti-laziness regex stripping digits (e2e-testing)
- Fixed memory pruning flooding (separate limits by type)
- Fixed false-positive failure detection in post-tool-use
