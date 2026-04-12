#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  AURAMAXING — One-command installer
#  Usage: curl -fsSL https://raw.githubusercontent.com/Blockchainpreneur/AURAMAXING/main/install.sh | bash
#  Or:    bash ~/auramaxing/install.sh
#
#  What this does (fully automatic, zero manual steps):
#  1. Installs Node 20+ and Claude Code if missing
#  2. Installs gstack (AI Software Factory skills)
#  3. Copies hooks (pii-redactor, code-quality-gate) to ~/.claude/helpers/
#  4. Merges AURAMAXING hooks into ~/.claude/settings.json (non-destructive)
#  5. Installs global CLAUDE.md with gstack + design system rules
#  6. Installs Ruflo (60+ agents, vector memory, self-learning swarms)
#  7. Installs MCP servers (context7, playwright, shadcn, magicui)
#  8. Adds shell alias: `cm` → cd ~/auramaxing && claude
#  9. Verifies all hooks pass a live smoke test
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$HOME/auramaxing"
HELPERS_DIR="$HOME/.claude/helpers"
CLAUDE_DIR="$HOME/.claude"
BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}▶ $1${RESET}"; }
ok()    { echo -e "  ${GREEN}✓ $1${RESET}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
fail()  { echo -e "  ${RED}✗ $1${RESET}"; exit 1; }
info()  { echo -e "  ${CYAN}→ $1${RESET}"; }

print_header() {
  echo -e "\n${CYAN}${BOLD}"
  echo "   █████╗ ██╗   ██╗██████╗  █████╗ ███╗   ███╗ █████╗ ██╗  ██╗██╗███╗   ██╗ ██████╗ "
  echo "  ██╔══██╗██║   ██║██╔══██╗██╔══██╗████╗ ████║██╔══██╗╚██╗██╔╝██║████╗  ██║██╔════╝ "
  echo "  ███████║██║   ██║██████╔╝███████║██╔████╔██║███████║ ╚███╔╝ ██║██╔██╗ ██║██║  ███╗"
  echo "  ██╔══██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║██╔══██║ ██╔██╗ ██║██║╚██╗██║██║   ██║"
  echo "  ██║  ██║╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██║██╔╝ ██╗██║██║ ╚████║╚██████╔╝"
  echo "  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝ "
  echo -e "${RESET}"
  echo -e "  ${BOLD}The AI Development Operating System${RESET}  —  Powered by Aura Engine v1.0\n"
}

# ── 1. OS + Node ──────────────────────────────────────────────────────────────
check_os() {
  [[ "$OSTYPE" == "darwin"* ]] && OS="macos" || \
  [[ "$OSTYPE" == "linux-gnu"* ]] && OS="linux" || \
  fail "Unsupported OS: $OSTYPE"
  ok "OS: $OS ($(uname -m))"
}

install_node() {
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" 2>/dev/null || true
  # Dynamic nvm path — works regardless of node version
  local _NVM_VER
  _NVM_VER=$(cat "$NVM_DIR/alias/default" 2>/dev/null | tr -d '[:space:]' | sed 's/^v//')
  [ -n "$_NVM_VER" ] && export PATH="$NVM_DIR/versions/node/v${_NVM_VER}/bin:$PATH"
  export PATH="/usr/local/bin:$PATH"

  if command -v node &>/dev/null && node -e "process.exit(parseInt(process.version.slice(1))>=20?0:1)" 2>/dev/null; then
    ok "Node.js $(node --version) already installed"
    return
  fi
  info "Installing Node.js 20 via nvm..."
  if [ ! -d "$NVM_DIR" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source "$NVM_DIR/nvm.sh"
  fi
  nvm install 20 --lts && nvm use 20
  ok "Node.js $(node --version) installed"
}

# ── 2. Claude Code ────────────────────────────────────────────────────────────
install_claude_code() {
  if command -v claude &>/dev/null; then
    ok "Claude Code $(claude --version 2>/dev/null | head -1) already installed"
  else
    info "Installing Claude Code..."
    npm install -g @anthropic-ai/claude-code 2>/dev/null
    ok "Claude Code installed"
  fi
}

# ── 3. gstack ─────────────────────────────────────────────────────────────────
install_gstack() {
  GSTACK_DIR="$HOME/.claude/skills/gstack"
  if [ -d "$GSTACK_DIR/.git" ]; then
    info "Updating gstack..."
    cd "$GSTACK_DIR" && git fetch origin -q && git reset --hard origin/main -q && ./setup >/dev/null 2>&1
    ok "gstack updated to $(cat "$GSTACK_DIR/VERSION" 2>/dev/null)"
  elif [ -d "$GSTACK_DIR" ]; then
    ok "gstack $(cat "$GSTACK_DIR/VERSION" 2>/dev/null) already installed"
  else
    info "Installing gstack..."
    mkdir -p "$HOME/.claude/skills"
    git clone --depth 1 https://github.com/garrytan/gstack.git "$GSTACK_DIR" -q
    cd "$GSTACK_DIR" && ./setup >/dev/null 2>&1
    ok "gstack $(cat "$GSTACK_DIR/VERSION" 2>/dev/null) installed"
  fi
}

# ── 4. Helpers (hooks) ────────────────────────────────────────────────────────
install_helpers() {
  mkdir -p "$HELPERS_DIR/.cache"
  local count=0
  for f in "$REPO_DIR/helpers/"*.mjs; do
    [ -f "$f" ] || continue
    cp "$f" "$HELPERS_DIR/"
    chmod +x "$HELPERS_DIR/$(basename "$f")"
    count=$((count+1))
  done
  ok "$count helper hooks installed → $HELPERS_DIR/"
}

# ── 5. settings.json — smart merge (non-destructive) ──────────────────────────
install_settings() {
  mkdir -p "$CLAUDE_DIR"
  local SETTINGS="$CLAUDE_DIR/settings.json"
  # Dynamic nvm path embedded in hook commands — resolves at hook runtime, not install time
  # Single-quoted so $HOME and $(...) are NOT expanded here; bash expands them when hooks run
  local _DYN='$HOME/.nvm/versions/node/v$(cat $HOME/.nvm/alias/default 2>/dev/null | tr -d '"'"'[:space:]'"'"' | sed '"'"'s/^v//'"'"')/bin:/usr/local/bin:/usr/bin:/bin:$PATH'
  local _PFX="export PATH=\"${_DYN}\" && "

  # Pass hook commands via env vars — avoids all quoting issues in heredocs
  export _CM_PII_CMD="${_PFX}node ~/.claude/helpers/pii-redactor.mjs"
  export _CM_QG_CMD="${_PFX}node ~/.claude/helpers/code-quality-gate.mjs 2>/dev/null || true"
  export _CM_RR_CMD="${_PFX}node ~/.claude/helpers/rational-router-apex.mjs 2>/dev/null || true"
  export _CM_SS_CMD="${_PFX}node ~/.claude/helpers/session-start.mjs || true"
  export _CM_SSD_CMD="${_PFX}node ~/auramaxing/helpers/session-start-daemon.mjs 2>/dev/null || true"
  export _CM_RUFLO_CMD="${_PFX}cd ~/.ruflo-global && npx ruflo@latest daemon status 2>/dev/null | grep -qi running || (npx ruflo@latest daemon start 2>/dev/null &) || true"
  export _CM_PTU_CMD="${_PFX}node ~/.claude/helpers/post-tool-use-apex.mjs 2>/dev/null || true"
  export _CM_TC_CMD="${_PFX}node ~/.claude/helpers/task-complete.mjs 2>/dev/null || true"
  export _CM_STOP_CMD="${_PFX}node ~/auramaxing/helpers/session-stop.mjs 2>/dev/null || true"
  export _CM_SETTINGS="$SETTINGS"

  # If file doesn't exist or is empty/corrupt → fresh install
  local IS_FRESH=false
  if [ ! -f "$SETTINGS" ] || [ ! -s "$SETTINGS" ]; then
    IS_FRESH=true
  elif ! python3 -c "import json; json.load(open('$SETTINGS'))" 2>/dev/null; then
    IS_FRESH=true
  fi

  if $IS_FRESH; then
    # stdout = pure JSON only (no status messages — captured by apply_settings)
    python3 - <<'PYEOF'
import json, os
pii   = os.environ["_CM_PII_CMD"]
qg    = os.environ["_CM_QG_CMD"]
rr    = os.environ["_CM_RR_CMD"]
ss_h  = os.environ["_CM_SS_CMD"]
ssd   = os.environ["_CM_SSD_CMD"]
ruflo = os.environ["_CM_RUFLO_CMD"]
ptu   = os.environ["_CM_PTU_CMD"]
tc    = os.environ["_CM_TC_CMD"]
stop  = os.environ["_CM_STOP_CMD"]
settings = {
  "fastMode": True,
  "skipDangerousModePermissionPrompt": True,
  "permissions": {"defaultMode": "bypassPermissions"},
  "hooks": {
    "PreToolUse": [
      {"matcher": "Write|Edit|MultiEdit|Bash",
       "hooks": [{"type": "command", "command": pii, "timeout": 2000}]},
      {"matcher": "Write|Edit|MultiEdit",
       "hooks": [{"type": "command", "command": qg,  "timeout": 1500}]}
    ],
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": rr, "timeout": 3000}]}
    ],
    "PostToolUse": [
      {"hooks": [{"type": "command", "command": ptu, "timeout": 2000}]}
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": tc,   "timeout": 2000}]},
      {"hooks": [{"type": "command", "command": stop, "timeout": 2000}]}
    ],
    "SessionStart": [
      {"hooks": [{"type": "command", "command": ss_h,  "timeout": 3000}]},
      {"hooks": [{"type": "command", "command": ssd,   "timeout": 2000}]},
      {"hooks": [{"type": "command", "command": ruflo, "timeout": 5000}]}
    ]
  }
}
print(json.dumps(settings, indent=2))
PYEOF
    return
  fi

  # Existing valid file — merge all hooks without overwriting user config
  # stdout = pure JSON only
  python3 - <<'PYEOF'
import json, os

pii   = os.environ["_CM_PII_CMD"]
qg    = os.environ["_CM_QG_CMD"]
rr    = os.environ["_CM_RR_CMD"]
ss_h  = os.environ["_CM_SS_CMD"]
ssd   = os.environ["_CM_SSD_CMD"]
ruflo = os.environ["_CM_RUFLO_CMD"]
ptu   = os.environ["_CM_PTU_CMD"]
tc    = os.environ["_CM_TC_CMD"]
stop  = os.environ["_CM_STOP_CMD"]
path  = os.environ["_CM_SETTINGS"]

with open(path) as f:
    settings = json.load(f)

hooks = settings.setdefault("hooks", {})
settings.setdefault("permissions", {})["defaultMode"] = "bypassPermissions"
settings["skipDangerousModePermissionPrompt"] = True
settings["fastMode"] = True

def has_hook(hook_list, marker):
    for block in hook_list:
        for h in block.get("hooks", []):
            if marker in h.get("command", ""):
                return True
    return False

# PreToolUse — security guards
pre = hooks.setdefault("PreToolUse", [])
if not has_hook(pre, "pii-redactor"):
    pre.insert(0, {"matcher": "Write|Edit|MultiEdit|Bash",
                   "hooks": [{"type": "command", "command": pii, "timeout": 2000}]})
if not has_hook(pre, "code-quality-gate"):
    pre.append({"matcher": "Write|Edit|MultiEdit",
                "hooks": [{"type": "command", "command": qg, "timeout": 1500}]})

# UserPromptSubmit — upgrade old router to apex (replace, don't skip)
usp = hooks.setdefault("UserPromptSubmit", [])
if not has_hook(usp, "rational-router-apex"):
    hooks["UserPromptSubmit"] = [b for b in usp if not any(
        "rational-router" in h.get("command", "") for h in b.get("hooks", []))]
    hooks["UserPromptSubmit"].insert(0, {"hooks": [{"type": "command", "command": rr, "timeout": 3000}]})

# PostToolUse
ptu_hooks = hooks.setdefault("PostToolUse", [])
if not has_hook(ptu_hooks, "post-tool-use-apex"):
    hooks["PostToolUse"] = [b for b in ptu_hooks if not any(
        "post-tool-use" in h.get("command", "") for h in b.get("hooks", []))]
    hooks["PostToolUse"].insert(0, {"hooks": [{"type": "command", "command": ptu, "timeout": 2000}]})

# Stop — completion diagram + session cleanup
stop_hooks = hooks.setdefault("Stop", [])
if not has_hook(stop_hooks, "task-complete"):
    stop_hooks.insert(0, {"hooks": [{"type": "command", "command": tc, "timeout": 2000}]})
if not has_hook(stop_hooks, "session-stop"):
    stop_hooks.append({"hooks": [{"type": "command", "command": stop, "timeout": 2000}]})

# SessionStart — welcome + daemon ping + ruflo
ss = hooks.setdefault("SessionStart", [])
if not has_hook(ss, "session-start.mjs"):
    ss.insert(0, {"hooks": [{"type": "command", "command": ss_h, "timeout": 3000}]})
if not has_hook(ss, "session-start-daemon"):
    ss.append({"hooks": [{"type": "command", "command": ssd, "timeout": 2000}]})
if not has_hook(ss, "ruflo") and not has_hook(ss, "daemon start"):
    ss.append({"hooks": [{"type": "command", "command": ruflo, "timeout": 5000}]})

# Remove old noisy hooks
for event in ["PostToolUse", "Stop"]:
    if event in hooks:
        hooks[event] = [
            b for b in hooks[event]
            if not any(
                x in h.get("command", "")
                for h in b.get("hooks", [])
                for x in ["memory-learn", "memory-enrich"]
            )
        ]
        if not hooks[event]:
            del hooks[event]

print(json.dumps(settings, indent=2))
PYEOF
}

# Apply the generated settings
apply_settings() {
  local SETTINGS="$CLAUDE_DIR/settings.json"
  local BAK="$SETTINGS.bak.$(date +%s)"
  # Backup BEFORE any writes
  [ -f "$SETTINGS" ] && cp "$SETTINGS" "$BAK"
  # Capture output FIRST, then write — avoids truncating the file before Python reads it
  local TMP
  TMP=$(mktemp)
  if install_settings > "$TMP" 2>/dev/null && python3 -c "import json; json.load(open('$TMP'))" 2>/dev/null; then
    mv "$TMP" "$SETTINGS"
    ok "settings.json valid"
  else
    rm -f "$TMP"
    if [ -f "$BAK" ]; then
      cp "$BAK" "$SETTINGS"
      warn "settings.json merge failed — restored backup"
    else
      warn "settings.json merge failed — no backup available"
    fi
  fi
}

# ── 6. CLAUDE.md global ───────────────────────────────────────────────────────
install_claude_md() {
  # Try CLAUDE.global.md first, fall back to setup/CLAUDE.md
  local SRC=""
  [ -f "$REPO_DIR/setup/CLAUDE.global.md" ] && SRC="$REPO_DIR/setup/CLAUDE.global.md"
  [ -z "$SRC" ] && [ -f "$REPO_DIR/setup/CLAUDE.md" ] && SRC="$REPO_DIR/setup/CLAUDE.md"
  local DST="$CLAUDE_DIR/CLAUDE.md"

  if [ -z "$SRC" ]; then
    warn "No CLAUDE.md template found in setup/ — skipping global CLAUDE.md install"
    return
  fi

  [ -f "$DST" ] && cp "$DST" "$DST.bak.$(date +%s)" 2>/dev/null || true
  cp "$SRC" "$DST"
  ok "CLAUDE.md installed globally (from $(basename $SRC))"
}

# ── 7. Ruflo — Enterprise swarm orchestration ─────────────────────────────────
install_ruflo() {
  local _NVM_VER
  _NVM_VER=$(cat "$HOME/.nvm/alias/default" 2>/dev/null | tr -d '[:space:]' | sed 's/^v//')
  [ -n "$_NVM_VER" ] && export PATH="$HOME/.nvm/versions/node/v${_NVM_VER}/bin:$PATH"
  export PATH="/usr/local/bin:$PATH"
  # Ruflo = 60+ specialized agents, vector memory, self-learning, MCP integration
  # Wraps @claude-flow/cli with enterprise orchestration layer
  local RUFLO_HOME="$HOME/.ruflo-global"
  mkdir -p "$RUFLO_HOME"

  # Check if already initialized
  if [ -f "$RUFLO_HOME/package.json" ] && command -v ruflo &>/dev/null 2>&1; then
    local VER
    VER=$(npx ruflo@latest --version 2>/dev/null | head -1 || echo "?")
    ok "Ruflo $VER already installed"
    return
  fi

  info "Installing Ruflo (enterprise swarm orchestration)..."
  cd "$RUFLO_HOME"
  echo '{"name":"ruflo-global"}' > package.json
  npx ruflo@latest init --yes 2>/dev/null \
    || npx ruflo@latest init 2>/dev/null \
    || { warn "Ruflo init skipped — run: cd ~/.ruflo-global && npx ruflo@latest init"; return; }
  ok "Ruflo installed (60+ agents, vector memory, self-learning)"
}

# ── 8. MCP servers — write directly to ~/.claude.json (no interactive session needed)
install_mcp() {
  local CLAUDE_JSON="$HOME/.claude.json"
  export _CM_CLAUDE_JSON="$CLAUDE_JSON"

  python3 - <<'PYEOF'
import json, os

path = os.environ["_CM_CLAUDE_JSON"]

# Load or create ~/.claude.json
cfg = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            cfg = json.load(f)
    except Exception:
        pass

servers = cfg.setdefault("mcpServers", {})

# Core MCPs — always install (no tokens needed)
defaults = {
    "context7":              {"type":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"],"env":{}},
    "playwright":            {"type":"stdio","command":"npx","args":["-y","@playwright/mcp@latest"],"env":{}},
    "shadcn":                {"type":"stdio","command":"npx","args":["-y","shadcn@canary","registry"],"env":{}},
    "magicuidesign-mcp":     {"type":"stdio","command":"npx","args":["-y","magicui-mcp"],"env":{}},
    "sequential-thinking":   {"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-sequential-thinking"],"env":{}},
    "firecrawl":             {"type":"stdio","command":"npx","args":["-y","firecrawl-mcp"],"env":{"FIRECRAWL_API_KEY":""}},
    "sentry":                {"type":"sse","url":"https://mcp.sentry.dev/sse","env":{}},
    "n8n":                   {"type":"stdio","command":"npx","args":["-y","n8n-mcp-server"],"env":{"N8N_BASE_URL":"","N8N_API_KEY":""}},
    "figma":                 {"type":"stdio","command":"npx","args":["-y","figma-developer-mcp"],"env":{"FIGMA_ACCESS_TOKEN":""}},
}

added = []
for name, conf in defaults.items():
    if name not in servers:
        servers[name] = conf
        added.append(name)
    else:
        # Ensure env key exists
        servers[name].setdefault("env", {})

import sys
if added:
    print(f"added:{','.join(added)}", file=sys.stderr)
else:
    print("already:all", file=sys.stderr)

with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
PYEOF

  local result
  result=$(python3 - 2>&1 <<'PYEOF2'
import json, os, sys
path = os.environ["_CM_CLAUDE_JSON"]
cfg = json.load(open(path))
names = list(cfg.get("mcpServers", {}).keys())
print(", ".join(names))
PYEOF2
)
  ok "MCP servers active: $result"
  info "Some MCPs need API keys — add once via: claude mcp add -s user <name> -e KEY=xxx ..."
  info "Tokens needed: GitHub, Supabase, Firecrawl, n8n, Figma"
  info "Zero-config: context7, playwright, shadcn, magicui, sentry, sequential-thinking"
}

# ── agent-browser — Rust-native browser CLI for AI agents ─────────────────────
install_agent_browser() {
  if command -v agent-browser >/dev/null 2>&1; then
    ok "agent-browser already installed ($(agent-browser --version 2>/dev/null | head -1 || echo '?'))"
  else
    info "Installing agent-browser (Vercel, Rust-native, 5.7x more token-efficient)..."
    npm i -g agent-browser 2>/dev/null && agent-browser install 2>/dev/null \
      && ok "agent-browser installed" \
      || warn "agent-browser install failed — optional, browser-server.mjs is the default"
  fi

  # Ensure browser scripts are executable
  chmod +x "$REPO_DIR/scripts/browser-server.mjs" "$REPO_DIR/scripts/browser-tab.mjs" 2>/dev/null
  ok "Browser automation: browser-server.mjs + browser-tab.mjs (CDP on port 9222)"
  info "First run syncs your Chrome profile — log in once, sessions persist forever"
}

# ── Shell alias: cm → cd ~/auramaxing && claude ─────────────────────────────
install_alias() {
  local NVM_HELPER='_ensure_nvm() { [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 2>/dev/null; }'

  for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
    [ -f "$RC" ] || continue
    # Add NVM helper if not present
    if ! grep -q "_ensure_nvm" "$RC" 2>/dev/null; then
      printf "\n# AURAMAXING — aliases for starting sessions with full autopilot\n%s\n" "$NVM_HELPER" >> "$RC"
      echo 'alias claude="_ensure_nvm && command claude"' >> "$RC"
      echo 'alias auramaxing="_ensure_nvm && command claude"' >> "$RC"
      echo 'alias ax="cd ~/auramaxing && _ensure_nvm && command claude"' >> "$RC"
      ok "Added claude, auramaxing, ax aliases to $(basename $RC)"
    else
      ok "Auramaxing aliases already in $(basename $RC)"
    fi
  done
  info "Run: source ~/.zshrc  (or open a new terminal)"
  info "Then: claude / auramaxing / ax → all start Claude Code with full autopilot"
}

# ── 9. Smoke test — verify all hooks pass ────────────────────────────────────
verify_hooks() {
  local passed=0 failed=0

  # Test pii-redactor — should approve clean input
  result=$(echo '{"tool_name":"bash","tool_input":{"command":"echo hello"}}'  \
    | node "$HELPERS_DIR/pii-redactor.mjs" 2>/dev/null)
  if echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('decision')=='approve' else 1)" 2>/dev/null; then
    ok "pii-redactor ✓ approve"
    passed=$((passed+1))
  else
    warn "pii-redactor: unexpected result: $result"
    failed=$((failed+1))
  fi

  # Test code-quality-gate — should approve clean TypeScript
  result=$(echo '{"tool_name":"write","tool_input":{"file_path":"src/add.ts","content":"export function add(a: number, b: number): number { return a + b; }"},"tool_result":"ok"}' \
    | node "$HELPERS_DIR/code-quality-gate.mjs" 2>/dev/null)
  if echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('decision')=='approve' else 1)" 2>/dev/null; then
    ok "code-quality-gate ✓ approve clean code"
    passed=$((passed+1))
  else
    warn "code-quality-gate: unexpected result: $result"
    failed=$((failed+1))
  fi

  # Test rational-router-apex — should exit 0 on trivial prompt
  echo '{"prompt":"hello","cwd":"/tmp","hook_event_name":"UserPromptSubmit"}' \
    | node "$HELPERS_DIR/rational-router-apex.mjs" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    ok "rational-router-apex ✓ exits cleanly"
    passed=$((passed+1))
  else
    warn "rational-router-apex: non-zero exit on trivial prompt"
    failed=$((failed+1))
  fi

  # Test task-complete — should exit 0
  echo '{}' | node "$HELPERS_DIR/task-complete.mjs" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    ok "task-complete ✓ exits cleanly"
    passed=$((passed+1))
  else
    warn "task-complete: non-zero exit"
    failed=$((failed+1))
  fi

  # Test session-start — should exit 0
  echo '{"session_id":"smoke-test","cwd":"/tmp"}' \
    | node "$HELPERS_DIR/session-start.mjs" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    ok "session-start ✓ exits cleanly"
    passed=$((passed+1))
  else
    warn "session-start: non-zero exit"
    failed=$((failed+1))
  fi

  # Verify settings.json is valid JSON
  if python3 -c "import json; json.load(open('$CLAUDE_DIR/settings.json'))" 2>/dev/null; then
    ok "settings.json ✓ valid JSON"
    passed=$((passed+1))
  else
    warn "settings.json: invalid JSON"
    failed=$((failed+1))
  fi

  # Verify CLAUDE.md has visual protocol (critical for diagram rendering)
  if [ -f "$CLAUDE_DIR/CLAUDE.md" ] && grep -q "AURAMAXING DISPLAY" "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null; then
    ok "CLAUDE.md ✓ visual protocol present"
    passed=$((passed+1))
  else
    warn "CLAUDE.md: visual protocol missing — diagrams will not render"
    failed=$((failed+1))
  fi

  if [ $failed -eq 0 ]; then
    ok "All $passed smoke tests passed"
  else
    warn "$passed passed, $failed failed — check ~/.claude/helpers/"
  fi
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_success() {
  echo ""
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}  ✅ AURAMAXING installed successfully!${RESET}"
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Stack:"
  echo "  • Claude Code + gstack v$(cat ~/.claude/skills/gstack/VERSION 2>/dev/null || echo '?') (AI Software Factory)"
  echo "  • Ruflo enterprise swarm — 60+ agents, vector memory, self-learning"
  echo "  • Aura autopilot: fires on every prompt → auto-routes through gstack"
  echo "  • Hooks: pii-redactor + code-quality-gate (security guards)"
  echo "  • Ruflo daemon auto-starts every session"
  echo "  • MCP: context7, playwright, shadcn, magic-ui, github, supabase"
  echo "  • Global CLAUDE.md + shell alias: ax → ~/auramaxing"
  echo ""
  echo -e "  ${BOLD}Start:${RESET}  source ~/.zshrc && ax"
  echo -e "  ${BOLD}Or anywhere:${RESET}  claude  (global stack active in any directory)"
  echo ""
}

# ── Python deps (LightRAG + sentence-transformers) ───────────────────────────
install_python_deps() {
  local PY=""
  for p in python3.12 python3 python; do
    if command -v "$p" >/dev/null 2>&1; then PY="$p"; break; fi
  done
  if [ -z "$PY" ]; then
    warn "Python 3 not found — LightRAG semantic search disabled (keyword fallback active)"
    return 0
  fi
  local PIP="$PY -m pip"
  $PIP install --quiet nano-vectordb numpy sentence-transformers 2>/dev/null && \
    ok "nano-vectordb + sentence-transformers installed" || \
    warn "Some Python deps failed — LightRAG will use TF-IDF fallback"
}

# ── Status bar ───────────────────────────────────────────────────────────────
install_statusline() {
  local SRC="$REPO_DIR/scripts/statusline.sh"
  local DST="$CLAUDE_DIR/statusline.sh"
  if [ -f "$SRC" ]; then
    cp "$SRC" "$DST" && chmod +x "$DST"
    # Add statusLine to settings.json if not present
    if ! grep -q "statusLine" "$CLAUDE_DIR/settings.json" 2>/dev/null; then
      python3 -c "
import json
with open('$CLAUDE_DIR/settings.json') as f: d = json.load(f)
d['statusLine'] = {'type': 'command', 'command': '~/.claude/statusline.sh'}
with open('$CLAUDE_DIR/settings.json', 'w') as f: json.dump(d, f, indent=2)
" 2>/dev/null
    fi
    ok "Status bar installed (model + context% + cost)"
  fi
}

# ── LightRAG initial index ───────────────────────────────────────────────────
install_lightrag_index() {
  mkdir -p "$HOME/.auramaxing/lightrag-workspace" "$HOME/.auramaxing/lightrag-cache" "$HOME/.auramaxing/prompt-cache"
  local BRIDGE="$REPO_DIR/helpers/lightrag-bridge.mjs"
  if [ -f "$BRIDGE" ]; then
    node "$BRIDGE" ingest-all 2>/dev/null && \
      ok "LightRAG index built" || \
      warn "LightRAG index build skipped (will build on first session end)"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  print_header

  step "1/10 Checking OS"
  check_os

  step "2/10 Node.js 20+"
  install_node

  step "3/10 Claude Code"
  install_claude_code

  step "4/10 gstack (AI Software Factory)"
  install_gstack

  step "5/10 AURAMAXING hook helpers"
  install_helpers

  step "6/10 settings.json (smart merge)"
  apply_settings

  step "7/10 Global CLAUDE.md"
  install_claude_md

  step "8/10 Ruflo (enterprise swarm orchestration)"
  install_ruflo

  step "9/11 MCP servers"
  install_mcp

  step "10/14 agent-browser (token-efficient browser automation)"
  install_agent_browser

  step "11/14 Python dependencies (LightRAG + sentence-transformers)"
  install_python_deps

  step "12/14 Status bar"
  install_statusline

  step "13/14 Shell aliases (claude, auramaxing, cm)"
  install_alias

  step "14/14 LightRAG initial index"
  install_lightrag_index

  step "✓    Smoke tests"
  verify_hooks

  print_success
}

main "$@"
