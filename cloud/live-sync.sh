#!/usr/bin/env bash
# AURAMAXING live-sync — bidirectional live sync (mutagen) of a project Mac↔box,
# so Claude Code runs on the box against a dir that mirrors your Mac in real time.
# Pairs with acode.sh (run Claude Code on the box). Mac stays a thin client.
#
# Setup: export AURA_FLEET_HOST="root@<box-ip>"  ; needs ~/.local/bin/mutagen
# Usage: live-sync.sh <project-dir>     # start/ensure a live session for that project
#        live-sync.sh --list           # show sessions   |   --stop <name>
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
HOST="${AURA_FLEET_HOST:?set AURA_FLEET_HOST=root@<box-ip>}"; HOSTONLY="${HOST#*@}"

mutagen daemon start >/dev/null 2>&1 || true
case "${1:-}" in
  --list) mutagen sync list 2>&1; exit 0;;
  --stop) mutagen sync terminate "${2:?name}" 2>&1; exit 0;;
esac
PROJ="${1:?usage: live-sync.sh <project-dir>}"; PROJ="$(cd "$PROJ" && pwd)"; NAME="$(basename "$PROJ")"
REMOTE="/root/acode-live/$NAME"

# pre-create the remote parent (mutagen won't create missing root parents)
ssh "$HOST" "mkdir -p $REMOTE"
if mutagen sync list "$NAME" >/dev/null 2>&1; then
  echo "▸ live sync '$NAME' already running"; mutagen sync flush "$NAME" >/dev/null 2>&1 || true
else
  echo "▸ starting live sync '$NAME': $PROJ ↔ $HOST:$REMOTE"
  mutagen sync create --name="$NAME" --ignore-vcs \
    --ignore=node_modules --ignore=dist --ignore=.next --ignore=target \
    --ignore=swarm-results --ignore=fleet-results \
    "$PROJ" "$HOST:$REMOTE" 2>&1 | tail -1
fi
sleep 4
echo "▸ status: $(mutagen sync list "$NAME" 2>&1 | grep -i status | head -1)"
echo "▸ box path: $REMOTE   ·   open Claude Code there with:  acode-live $NAME"
