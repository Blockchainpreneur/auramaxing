#!/usr/bin/env bash
# AURAMAXING acode — run a Claude Code session ON the cloud box; the Mac stays a thin client.
# Delegates the session's compute (node, MCP servers, Python/LightRAG/NLM, agents, RAM) to the
# 16 GB box. The browser/CDP stays on the Mac, reachable from the box via a reverse SSH tunnel.
#
#   acode                   sync CWD → box, open the interactive Claude Code TUI there
#   acode /path/to/project  same, for a specific project
#   acode -p "do X"         one-shot headless task on the box (compute only)
set -uo pipefail
. "$HOME/auramaxing/cloud/lib.sh"

HOST="${AURA_FLEET_HOST:?set AURA_FLEET_HOST=root@<box-ip>}"
TUNNEL="-R 9222:localhost:9222"   # expose the Mac's CDP Chrome (:9222) to the box session

if ! aura_box_reachable "$HOST"; then
  echo "✗ box $HOST unreachable — powered off? wrong AURA_FLEET_HOST? Start the box, then retry." >&2
  exit 1
fi

# Mirror the Mac's AURAMAXING env onto the box (autopilot + memory) so the session is imperceptible.
# TTL-gated: the first launch provisions (~2 min), later launches skip. Force a refresh: acode-sync.
ENVSYNC_FLAG="$HOME/.auramaxing/.last-box-envsync"
ENVSYNC_TTL=$(( ${AURA_ENVSYNC_TTL_MIN:-120} * 60 ))
if [ ! -f "$ENVSYNC_FLAG" ] || [ "$(( $(date +%s) - $(cat "$ENVSYNC_FLAG" 2>/dev/null || echo 0) ))" -gt "$ENVSYNC_TTL" ]; then
  bash "$HOME/auramaxing/cloud/box-sync-env.sh" && date +%s > "$ENVSYNC_FLAG"
fi

ONESHOT=""; PROJ="$PWD"
if [ "${1:-}" = "-p" ]; then ONESHOT="${2:?-p needs a prompt}"
elif [ -n "${1:-}" ] && [ -d "$1" ]; then PROJ="$(cd "$1" && pwd)"; fi

# Sanitize the remote workspace name: spaces/special chars in the path otherwise split the unquoted
# ~/$REMOTE on the box ("cd: too many arguments" + junk dirs). cksum suffix avoids basename collisions.
NAME="$(basename "$PROJ" | tr -c 'A-Za-z0-9._-' '_')-$(printf '%s' "$PROJ" | cksum | cut -d' ' -f1)"
REMOTE="acode/$NAME"

# NEVER rsync $HOME or other huge/sensitive roots (gigabytes, unreadable files, --delete risk).
# Launch a clean box workspace instead; cd into a project dir to sync that project.
SKIP_SYNC=0
case "$PROJ" in
  "$HOME"|"/"|"$HOME/Desktop"|"$HOME/Documents"|"$HOME/Downloads"|"$HOME/Library")
    REMOTE="acode/home"; SKIP_SYNC=1 ;;
esac

sync_up() {
  ssh $AURA_SSH_OPTS "$HOST" "mkdir -p ~/$REMOTE"
  rsync -az --delete -e "ssh $AURA_SSH_OPTS" "${AURA_RSYNC_EXCLUDES[@]}" "$PROJ"/ "$HOST:~/$REMOTE/" 2>/dev/null
}
sync_back() {
  [ "$SKIP_SYNC" = "1" ] && return 0   # home/clean session: never rsync back into $HOME
  rsync -az -e "ssh $AURA_SSH_OPTS" --backup --backup-dir=".fleet-backup/$(date +%s)" \
    "${AURA_RSYNC_EXCLUDES[@]}" "$HOST:~/$REMOTE/" "$PROJ"/ 2>/dev/null || true
}

# Decide the box working dir + how files get there, per mode.
#  - $HOME launch  → clean box workspace, no sync.
#  - one-shot      → one-shot rsync (batch; live mirror is overkill).
#  - interactive   → mutagen LIVE bidirectional mirror: the box operates on your project files in
#    REAL TIME (edits flow both ways instantly; full source incl. .git; node_modules/build excluded
#    as regenerable). Falls back to one-shot rsync if mutagen isn't installed.
LIVE=0; MNAME=""
if [ "$SKIP_SYNC" = "1" ]; then
  WORKDIR="~/$REMOTE"
  echo "▸ launched from \$HOME — CLEAN box session in $WORKDIR (no sync). cd into a project for a live mirror."
  ssh $AURA_SSH_OPTS "$HOST" "mkdir -p ~/$REMOTE"
elif [ -n "$ONESHOT" ]; then
  WORKDIR="~/$REMOTE"
  echo "▸ acode: syncing $NAME → box"; sync_up
elif [ -x "$HOME/.local/bin/mutagen" ] || command -v mutagen >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$PATH"
  WORKDIR="/root/acode-live/$NAME"; LIVE=1
  # mutagen session names allow only [A-Za-z0-9-] (NO _ or .) — derive a safe one from a hash.
  MNAME="acode-$(printf '%s' "$PROJ" | cksum | cut -d' ' -f1)"
  echo "▸ live mirror: $NAME ↔ box in real time (your files — full source + .git — operated from the box)…"
  mutagen daemon start >/dev/null 2>&1 || true
  ssh $AURA_SSH_OPTS "$HOST" "mkdir -p $WORKDIR"
  mutagen sync list "$MNAME" >/dev/null 2>&1 || mutagen sync create --name="$MNAME" \
    --ignore=node_modules --ignore=dist --ignore=.next --ignore=target --ignore=.venv --ignore=__pycache__ \
    "$PROJ" "$HOST:$WORKDIR" >/dev/null 2>&1
  mutagen sync flush "$MNAME" >/dev/null 2>&1 || true   # block until the initial sync completes before launch
else
  WORKDIR="~/$REMOTE"
  echo "▸ acode: syncing $NAME → box (mutagen not found → one-shot rsync)"; sync_up
fi

# Box-side env: exploit the full 16 GB heap; OAuth token already set on the box.
REMOTE_ENV='. ~/.nvm/nvm.sh 2>/dev/null; export NODE_OPTIONS="--max-old-space-size=12288"; export IS_SANDBOX=1'

if [ -n "$ONESHOT" ]; then
  echo "▸ one-shot on box (compute only)"
  printf '%s\n' "$AURA_EMPTY_MCP" | ssh $AURA_SSH_OPTS "$HOST" 'cat > ~/.swarm-empty-mcp.json'
  # base64 the prompt so its content can never break out of the remote shell (command injection).
  B64="$(printf '%s' "$ONESHOT" | base64 | tr -d '\n')"
  ssh $AURA_SESSION_SSH "$HOST" "$REMOTE_ENV; cd $WORKDIR && claude -p \"\$(printf %s '$B64' | base64 -d)\" --strict-mcp-config --mcp-config ~/.swarm-empty-mcp.json --dangerously-skip-permissions"
  echo "▸ syncing results back"; sync_back
else
  echo "▸ opening Claude Code ON the box (resilient tmux session; files live-mirrored). Exit to sync back."
  # Ensure the browser MCP config exists on the box, else `claude --mcp-config` errors at startup.
  printf '%s\n' "$AURA_BROWSER_MCP" | ssh $AURA_SSH_OPTS "$HOST" 'cat > ~/.acode-mcp.json'
  TMUX_SESSION="aura-$NAME"
  # RESILIENCE: claude runs inside tmux ON THE BOX, so a dropped/reset SSH never kills the session.
  # Auto-reconnect: if ssh ends while the tmux session still lives (= a network drop), re-attach with
  # NO work lost; exit only when the user actually quits claude. Keepalives (lib.sh) prevent most drops.
  while :; do
    TUN="$TUNNEL"; aura_box_has_mac_chrome "$HOST" && TUN=""   # reuse a live tunnel, else open -R
    ssh -t $AURA_SESSION_SSH $TUN "$HOST" \
      "$REMOTE_ENV; tmux new-session -A -s '$TMUX_SESSION' 'cd $WORKDIR && claude --mcp-config ~/.acode-mcp.json'" || true
    ssh $AURA_SSH_OPTS "$HOST" "tmux has-session -t '$TMUX_SESSION' 2>/dev/null" || break
    echo "▸ connection dropped — re-attaching to your live box session (no work lost)…"; sleep 1
  done
  if [ "$LIVE" = "1" ]; then
    mutagen sync flush "$MNAME" >/dev/null 2>&1 || true
    echo "▸ session ended — files stay live-mirrored (mutagen keeps watching; re-launch is instant)."
  else
    echo "▸ session ended — syncing results back"; sync_back
  fi
fi
echo "▸ done."
