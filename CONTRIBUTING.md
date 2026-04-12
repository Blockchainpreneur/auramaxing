# Contributing to Auramaxing

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Dev Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Blockchainpreneur/AURAMAXING ~/auramaxing
   cd ~/auramaxing
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Requirements:
   - macOS or Linux
   - Node.js >= 18
   - Bun >= 1.0
   - Python 3.10+ (for LightRAG / sentence-transformers)
   - Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

4. Run the installer to wire up hooks and config:
   ```bash
   bash install.sh
   ```

## Project Structure

```
~/auramaxing/
├── helpers/           Hook scripts (the core pipeline)
│   ├── rational-router-apex.mjs   Cognitive router (UserPromptSubmit)
│   ├── pii-redactor.mjs           Secrets blocker (PreToolUse)
│   ├── code-quality-gate.mjs      Code quality checks (PreToolUse)
│   ├── post-tool-use-apex.mjs     Event accumulator (PostToolUse)
│   ├── task-complete.mjs          Done diagram (Stop)
│   ├── session-stop.mjs           Memory save (Stop)
│   ├── session-start.mjs          Welcome + memory load (SessionStart)
│   ├── session-start-daemon.mjs   NLM context injection (SessionStart)
│   ├── prompt-engine.mjs          Anti-laziness enrichment
│   ├── self-heal.mjs              Failure recovery strategies
│   ├── notebooklm-bridge.mjs      NLM integration
│   ├── lightrag-bridge.mjs        LightRAG semantic search
│   └── ...                        Other helpers
├── scripts/           CLI tools and utilities
│   ├── browser-server.mjs         Chrome CDP server
│   ├── browser-tab.mjs            Tab management
│   ├── update-check.sh            Version check
│   ├── update.sh                  Self-updater
│   ├── statusline.sh              Status bar renderer
│   └── ...                        Other scripts
├── setup/             Installer configs and templates
│   ├── settings.json              Claude Code settings template
│   ├── CLAUDE.md                  Project CLAUDE.md template
│   ├── CLAUDE.global.md           Global CLAUDE.md template
│   ├── mcp-config.json            MCP server definitions
│   └── ...                        Other config files
├── tui/               Terminal UI (Textual app)
│   ├── app.py                     Main TUI application
│   ├── auramaxing.py              Core TUI logic
│   ├── theme.tcss                 Textual CSS theme
│   └── ...                        Other TUI modules
├── daemon/            State daemon (port 57821)
│   └── src/                       Daemon source
├── ruflo/             Swarm engine
│   ├── agents/                    Agent definitions
│   └── daemon-state.json          Swarm state
├── tests/             Playwright E2E tests
├── skills/            Custom Claude Code skills
├── install.sh         One-command installer
├── VERSION            Current version
└── package.json       Project metadata
```

## How Hooks Work

Auramaxing uses Claude Code's hook system. Hooks are `.mjs` scripts that receive JSON on stdin and write JSON to stdout. They run at five lifecycle events:

| Event | When it fires | Key hooks |
|-------|--------------|-----------|
| **SessionStart** | Claude Code session opens | `session-start.mjs`, `session-start-daemon.mjs` |
| **UserPromptSubmit** | User sends a prompt | `rational-router-apex.mjs` (the Aura router) |
| **PreToolUse** | Before any tool executes | `pii-redactor.mjs`, `code-quality-gate.mjs` |
| **PostToolUse** | After any tool executes | `post-tool-use-apex.mjs` |
| **Stop** | Claude finishes responding | `task-complete.mjs`, `session-stop.mjs` |

Every hook reads a JSON payload from stdin, processes it, and writes a JSON result to stdout. All hooks must exit 0 unconditionally so they never block Claude.

Hook registration lives in `setup/settings.json`. The installer copies this to `~/.claude/settings.json`.

## Testing Changes

### Syntax check

Before committing any `.mjs` file, verify it parses:

```bash
node --check helpers/your-file.mjs
```

### Functional tests

Hooks expect JSON on stdin. Test them by piping sample input:

```bash
echo '{"user_prompt":"hello"}' | node helpers/rational-router-apex.mjs
echo '{"tool_name":"Write","tool_input":{"content":"test"}}' | node helpers/pii-redactor.mjs
```

Verify the output is valid JSON and the hook exits 0.

### E2E tests

Playwright tests live in `tests/`. Run them with:

```bash
npx playwright test
```

## Commit Style

- **One logical change per commit.** Don't bundle unrelated fixes.
- Write clear, imperative commit messages: `Add NLM auth retry logic`, not `added stuff`.
- Keep the first line under 72 characters.
- Reference issue numbers when applicable: `Fix memory pruning crash (#42)`.
- Never commit `.env` files, API keys, or credentials.

## Pull Request Guidelines

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-change
   ```
2. Make your changes. Keep diffs focused.
3. Run `node --check` on all modified `.mjs` files.
4. Test hooks with piped JSON input.
5. Push and open a PR against `main`.
6. Describe what changed and why in the PR body.
7. PRs that touch hooks should include before/after JSON examples.
8. Wait for CI to pass before requesting review.

## Code Standards

- All hooks are ES modules (`.mjs`). Read stdin, write JSON to stdout, exit 0.
- Keep files under 500 lines. No hardcoded secrets.
- See `ARCHITECTURE.md` for deep technical details.
