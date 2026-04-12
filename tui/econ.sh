#!/usr/bin/env bash
# AURAMAXING launcher — starts daemon if needed, then Python TUI

DAEMON_PORT=57821
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_FILE="/tmp/auramaxing-tui.lock"
LOCAL_VERSION=$(cat "$DIR/VERSION" 2>/dev/null | tr -d '[:space:]')
VERSION_URL="https://raw.githubusercontent.com/Blockchainpreneur/AURAMAXING/main/VERSION"
UPDATE_CMD="cd ~/auramaxing && git pull && bash install.sh"

# Require a real terminal — exit immediately if no TTY (hooks, pipes, etc.)
[ -t 0 ] || exit 0

# Background version check — warn if outdated (non-blocking)
{
  REMOTE_VERSION=$(curl -sf --max-time 3 "$VERSION_URL" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$REMOTE_VERSION" ] && [ "$REMOTE_VERSION" != "$LOCAL_VERSION" ]; then
    echo ""
    echo "  ┌─────────────────────────────────────────────────────┐"
    echo "  │  ⚠  AURAMAXING UPDATE REQUIRED                       │"
    echo "  │                                                      │"
    echo "  │  Your version : $LOCAL_VERSION                              │"
    echo "  │  Latest       : $REMOTE_VERSION (critical bug fixes)        │"
    echo "  │                                                      │"
    echo "  │  Run this now:                                       │"
    echo "  │  cd ~/auramaxing && git pull && bash install.sh       │"
    echo "  └─────────────────────────────────────────────────────┘"
    echo ""
  fi
} &

# Single-instance guard — kill stale lock if process is dead
if [ -f "$LOCK_FILE" ]; then
  OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "AURAMAXING is already running (PID $OLD_PID)" >&2
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT INT TERM

# Start daemon if not responding
curl -sf "http://localhost:$DAEMON_PORT/status" >/dev/null 2>&1 || {
  cd "$DIR/daemon" && bun run src/index.ts >/dev/null 2>&1 &
  # Poll up to 3s for daemon to be ready
  for i in 1 2 3 4 5 6; do
    sleep 0.5
    curl -sf "http://localhost:$DAEMON_PORT/status" >/dev/null 2>&1 && break
  done
}

exec python3 "$DIR/tui/auramaxing.py"
