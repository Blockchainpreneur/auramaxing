#!/usr/bin/env bash
# AURAMAXING acode — run Claude Code ON the cloud box; the Mac stays a thin client.
# Delegates ALL of a Claude Code session's processing (orchestration, subagents,
# MCP servers, tool exec, RAM) to the 16GB box. The Mac only runs the SSH client.
#
# Setup:  export AURA_FLEET_HOST="root@<box-ip>"   (already in ~/.zshrc)
# Usage:
#   acode                      # sync CWD → box, open interactive Claude Code TUI there
#   acode /path/to/project     # same, for a specific project
#   acode -p "do X"            # one-shot headless task on the box (synced CWD)
set -uo pipefail
HOST="${AURA_FLEET_HOST:?set AURA_FLEET_HOST=root@<box-ip>}"
# accept-new = trust on first connect then pin (MITM protection if the key changes); BatchMode = never hang on a prompt (cloud-fleet #6).
# ControlMaster: keep one warm multiplexed connection (10 min) so the reachability check, env-sync,
# project rsync and the session ssh all REUSE it — no repeated TCP/auth handshake → near-instant relaunch.
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-%r@%h:%p -o ControlPersist=600"
# Reverse tunnel: expose the Mac's CDP Chrome (:9222) to the box, so a box-side session drives the
# user's logged-in browser via connectOverCDP('http://localhost:9222'). Browser stays on the Mac
# (the agreed split); only the session's COMPUTE moves to the box. Verified box→tunnel→Mac Chrome.
TUNNEL="-R 9222:localhost:9222"
# The interactive SESSION carries the -R tunnel and is long-lived, so it opens its OWN connection
# (ControlPath=none) instead of multiplexing: a master created by the quick aux calls has no -R, and
# adding -R to an existing master is unreliable across OpenSSH versions. Aux calls keep the warm master.
SESSION_SSH="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -o ControlPath=none"
# Fail fast + clear if the box is unreachable (powered off to save €, wrong host) instead of a confusing rsync error.
if ! ssh $SSH_OPTS "$HOST" 'true' 2>/dev/null; then
  echo "✗ box $HOST unreachable — powered off? wrong AURA_FLEET_HOST? Start the box, then retry." >&2
  exit 1
fi

# Mirror the Mac's AURAMAXING env onto the box (autopilot hooks + helpers + CLAUDE.md + skills +
# memory) so a box session is imperceptible from a Mac session. TTL-gated (default 120 min): the
# first launch provisions (~2 min, one-time), later launches skip instantly. Force: acode-sync.
ENVSYNC_FLAG="$HOME/.auramaxing/.last-box-envsync"
ENVSYNC_TTL=$(( ${AURA_ENVSYNC_TTL_MIN:-120} * 60 ))
if [ ! -f "$ENVSYNC_FLAG" ] || [ "$(( $(date +%s) - $(cat "$ENVSYNC_FLAG" 2>/dev/null || echo 0) ))" -gt "$ENVSYNC_TTL" ]; then
  bash "$HOME/auramaxing/cloud/box-sync-env.sh" && date +%s > "$ENVSYNC_FLAG"
fi

ONESHOT=""; PROJ="$PWD"
if [ "${1:-}" = "-p" ]; then ONESHOT="${2:?-p needs a prompt}";
elif [ -n "${1:-}" ] && [ -d "$1" ]; then PROJ="$(cd "$1" && pwd)"; fi
# Sanitize the remote workspace name: spaces/special chars in the project path (e.g. "Claudecode
# Tune") otherwise split the UNQUOTED ~/$REMOTE on the box → "cd: too many arguments" + junk dirs.
# The cksum suffix keeps two same-basename projects from colliding on the box.
SAFE="$(basename "$PROJ" | tr -c 'A-Za-z0-9._-' '_')"
NAME="${SAFE}-$(printf '%s' "$PROJ" | cksum | cut -d' ' -f1)"
REMOTE="acode/$NAME"
# NEVER rsync the Mac's $HOME or other huge/sensitive roots (gigabytes, unreadable files → "IO error",
# and --delete risk). Launch a clean box workspace instead; cd into a project dir to sync that project.
SKIP_SYNC=0
case "$PROJ" in
  "$HOME"|"/"|"$HOME/Desktop"|"$HOME/Documents"|"$HOME/Downloads"|"$HOME/Library")
    REMOTE="acode/home"; SKIP_SYNC=1 ;;
esac

# 1) push project to the box (fast incremental; skip heavy build dirs)
sync_up() {
  ssh $SSH_OPTS "$HOST" "mkdir -p ~/$REMOTE"
  rsync -az --delete -e "ssh $SSH_OPTS" \
    --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next' \
    --exclude 'target' --exclude '.venv' --exclude '__pycache__' \
    "$PROJ"/ "$HOST:~/$REMOTE/" 2>/dev/null
}
sync_back() {
  [ "$SKIP_SYNC" = "1" ] && return 0   # home/clean session: nothing to bring back (never rsync into $HOME)
  # --backup keeps any locally-edited file the box would overwrite under .fleet-backup/<ts> (cloud-fleet #10)
  rsync -az -e "ssh $SSH_OPTS" --backup --backup-dir=".fleet-backup/$(date +%s)" \
    --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next' \
    "$HOST:~/$REMOTE/" "$PROJ"/ 2>/dev/null || true
}

if [ "$SKIP_SYNC" = "1" ]; then
  echo "▸ launched from \$HOME — opening a CLEAN box session in ~/$REMOTE (no home sync)."
  echo "  → for a specific project on the box: cd into it first, or run  acode /path/to/project"
  ssh $SSH_OPTS "$HOST" "mkdir -p ~/$REMOTE"
else
  echo "▸ acode: syncing $NAME → box ($HOST)"; sync_up
fi

# box-side claude env: aggressive use of the full 16GB (big node heap), token already set
REMOTE_ENV='. ~/.nvm/nvm.sh 2>/dev/null; export NODE_OPTIONS="--max-old-space-size=12288"; export IS_SANDBOX=1'

# Avoid the "remote port forwarding failed for listen port 9222" warning: only request the reverse
# tunnel if the box can't ALREADY reach the Mac's Chrome. A prior/persistent session (or the
# ControlMaster) may still hold :9222 — and it still works, so we reuse it instead of re-binding.
if [ -n "$TUNNEL" ] && ssh $SSH_OPTS "$HOST" 'curl -s --max-time 2 http://localhost:9222/json/version >/dev/null 2>&1'; then
  TUNNEL=""
fi

if [ -n "$ONESHOT" ]; then
  echo "▸ one-shot on box"
  # Headless one-shot: disable MCP servers on the box (mirror swarm.sh) — RAM-heavy and unused for a
  # single --dangerously-skip-permissions run (cloud-fleet #5).
  printf '%s\n' '{"mcpServers":{}}' | ssh $SSH_OPTS "$HOST" 'cat > ~/.swarm-empty-mcp.json'
  # SECURITY: base64 the prompt so its content can never break out of the remote shell command —
  # `claude -p \"$ONESHOT\"` let a prompt like '"; rm -rf ~; echo "' execute on the box (CRITICAL #2).
  # PROMPT_B64 is pure [A-Za-z0-9+/=], safe to interpolate; the box decodes it to a single quoted arg.
  PROMPT_B64="$(printf '%s' "$ONESHOT" | base64 | tr -d '\n')"
  ssh $SESSION_SSH "$HOST" "$REMOTE_ENV; cd ~/$REMOTE && claude -p \"\$(printf %s '$PROMPT_B64' | base64 -d)\" --strict-mcp-config --mcp-config ~/.swarm-empty-mcp.json --dangerously-skip-permissions"
  echo "▸ syncing results back"; sync_back
else
  echo "▸ opening Claude Code ON the box (Mac = thin client). Exit to sync back."
  # Ensure the browser MCP config exists on the box, else `claude --mcp-config` ERRORS and the
  # session never starts (verified: "Invalid MCP configuration: file not found"). Idempotent.
  printf '%s\n' '{"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@1.1.0","--browserUrl","http://127.0.0.1:9222"]}}}' | ssh $SSH_OPTS "$HOST" 'cat > ~/.acode-mcp.json'
  # --mcp-config gives the box session chrome-devtools MCP pointed at 127.0.0.1:9222, which the
  # $TUNNEL forwards to the Mac's logged-in Chrome → browser automation works from the box session.
  ssh -t $SESSION_SSH $TUNNEL "$HOST" "$REMOTE_ENV; cd ~/$REMOTE && claude --mcp-config ~/.acode-mcp.json" || true
  echo "▸ session ended — syncing results back"; sync_back
fi
echo "▸ done."
