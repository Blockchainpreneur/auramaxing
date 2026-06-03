#!/usr/bin/env bash
# AURAMAXING — /fleet remote driver. Runs on your LOCAL Mac; delegates a parallel agent
# fleet to the Oracle cloud box, keeping the project LOCAL as source of truth.
#
# Flow: rsync local project → box → spawn N parallel `claude -p` agents (one per subtask, each
# in its own copy) on the box's 24GB → rsync each agent's diff/log back to ./fleet-results/.
#
# Setup: export AURA_FLEET_HOST="ubuntu@<box-ip>"   (add to ~/.zshrc)
# Usage:  fleet.sh <project-dir> "subtask one" "subtask two" ...
#   or:   fleet.sh <project-dir> --file tasks.txt    (one subtask per line)
set -euo pipefail

HOST="${AURA_FLEET_HOST:-}"
[ -z "$HOST" ] && { echo "set AURA_FLEET_HOST=ubuntu@<box-ip> first (see ~/auramaxing/cloud/README.md)"; exit 1; }

PROJ="${1:?usage: fleet.sh <project-dir> <subtasks...>}"; shift
[ -d "$PROJ" ] || { echo "no such project dir: $PROJ"; exit 1; }
PROJ="$(cd "$PROJ" && pwd)"; NAME="$(basename "$PROJ")"

# collect subtasks (args or --file)
TASKS=()
if [ "${1:-}" = "--file" ]; then mapfile -t TASKS < "${2:?--file needs a path}"; else TASKS=("$@"); fi
[ "${#TASKS[@]}" -gt 0 ] || { echo "give at least one subtask"; exit 1; }

REMOTE_BASE="fleet/$NAME"
echo "▸ syncing $NAME → $HOST:~/$REMOTE_BASE/base"
ssh "$HOST" "mkdir -p ~/$REMOTE_BASE/base"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next' \
  --exclude 'target' --exclude '.venv' --exclude '__pycache__' \
  "$PROJ"/ "$HOST:~/$REMOTE_BASE/base/"

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"
FLEET_N="${FLEET_N:-6}"   # cap concurrent SSH sessions — was unbounded (50 tasks = 50 sshd sessions → MaxStartups), cloud-fleet #4
echo "▸ dispatching ${#TASKS[@]} parallel agents on the cloud box (max $FLEET_N concurrent)"
i=0
for task in "${TASKS[@]}"; do
  i=$((i+1))
  # base64 the task so its content can never break out of the remote shell (cloud-fleet #7 injection)
  B64=$(printf '%s' "$task" | base64 | tr -d '\n')
  ssh $SSH_OPTS "$HOST" "
    set -e
    . ~/.nvm/nvm.sh 2>/dev/null || true
    rm -rf ~/$REMOTE_BASE/agent-$i && cp -r ~/$REMOTE_BASE/base ~/$REMOTE_BASE/agent-$i
    cd ~/$REMOTE_BASE/agent-$i
    git init -q 2>/dev/null && git add -A && git commit -qm baseline 2>/dev/null || true
    claude -p \"\$(printf %s '$B64' | base64 -d)\" --dangerously-skip-permissions > _agent.log 2>&1 || true
    git add -A && git diff --cached > _agent.diff 2>/dev/null || true
  " &
  # bash 3.2-safe concurrency throttle (macOS /bin/bash has no 'wait -n')
  while [ "$(jobs -r | wc -l)" -ge "$FLEET_N" ]; do sleep 0.3; done
done
wait
echo "▸ all agents finished — pulling results back"

mkdir -p "$PROJ/fleet-results"
for n in $(seq 1 "$i"); do
  rsync -az "$HOST:~/$REMOTE_BASE/agent-$n/_agent.diff" "$PROJ/fleet-results/agent-$n.diff" 2>/dev/null || true
  rsync -az "$HOST:~/$REMOTE_BASE/agent-$n/_agent.log"  "$PROJ/fleet-results/agent-$n.log"  2>/dev/null || true
done
echo "▸ done. Review diffs in $PROJ/fleet-results/ (agent-N.diff) and apply the winners with: git apply fleet-results/agent-N.diff"
