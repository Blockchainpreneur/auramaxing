#!/usr/bin/env bash
# AURAMAXING — /fleet remote driver. Runs on your LOCAL Mac; delegates a parallel agent
# fleet to the 16 GB cloud box, keeping the project LOCAL as the source of truth.
#
# Flow: rsync local project → box → spawn N parallel `claude -p` agents (one per subtask, each
# in its own copy, capped at FLEET_N) → rsync each agent's diff/log back to ./fleet-results/.
#
# Setup: export AURA_FLEET_HOST="root@<box-ip>"   (add to ~/.zshrc)
# Usage:  fleet.sh <project-dir> "subtask one" "subtask two" ...
#   or:   fleet.sh <project-dir> --file tasks.txt    (one subtask per line)
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib.sh"   # script-relative → works at any install path
HOST="$(aura_resolve_host)" || { aura_box_unconfigured; exit 1; }   # beacon/AURA_FLEET_HOST → never the burned box
aura_require_host "$HOST"

PROJ="${1:?usage: fleet.sh <project-dir> <subtasks...>}"; shift
[ -d "$PROJ" ] || { echo "no such project dir: $PROJ"; exit 1; }
PROJ="$(cd "$PROJ" && pwd)"; NAME="$(aura_safe_name "$PROJ")"
FLEET_N="${FLEET_N:-6}"; aura_require_posint FLEET_N "$FLEET_N"   # validated BEFORE the dry-run exit; ≥1 (0 would hang the throttle)

# collect subtasks (args or --file)
TASKS=()
# portable read loop instead of `mapfile` (bash-4 only — absent on macOS /bin/bash 3.2);
# `|| [ -n "$_l" ]` also captures a final line with no trailing newline.
if [ "${1:-}" = "--file" ]; then
  TASKS=(); while IFS= read -r _l || [ -n "$_l" ]; do TASKS+=("$_l"); done < "${2:?--file needs a path}"
else TASKS=("$@"); fi
[ "${#TASKS[@]}" -gt 0 ] || { echo "give at least one subtask"; exit 1; }

REMOTE_BASE="fleet/$NAME"

# DRY_RUN=1 → print the plan and exit before any box/network side effect (used by smoke-test.sh).
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[dry-run] would sync $PROJ → $HOST:~/$REMOTE_BASE/base and dispatch ${#TASKS[@]} agents (max ${FLEET_N:-6})"
  exit 0
fi

echo "▸ syncing $NAME → $HOST:~/$REMOTE_BASE/base"
ssh $AURA_SESSION_SSH "$HOST" "mkdir -p ~/$REMOTE_BASE/base"
rsync -az --delete -e "ssh $AURA_SESSION_SSH" "${AURA_RSYNC_EXCLUDES[@]}" \
  "$PROJ"/ "$HOST:~/$REMOTE_BASE/base/"

# Each agent uses its OWN connection (AURA_SESSION_SSH, no ControlMaster) — multiplexing would
# serialize the parallel agents over one socket. FLEET_N caps concurrency (sshd MaxStartups).
# Disable the AURAMAXING autopilot hooks for workers — else each agent's hook subprocess tree
# (LightRAG ~1-2GB + prompt-engine + daemons) adds ~70s and can thrash the box. Local-written → valid JSON.
printf '%s' '{"hooks":{}}' | ssh $AURA_SESSION_SSH "$HOST" 'cat > ~/.fleet-nohooks.json'
echo "▸ dispatching ${#TASKS[@]} parallel agents on the cloud box (max $FLEET_N concurrent)"
i=0
for task in "${TASKS[@]}"; do
  i=$((i+1))
  # base64 the task so its content can never break out of the remote shell (cloud-fleet #7 injection)
  B64=$(printf '%s' "$task" | base64 | tr -d '\n')
  ssh $AURA_SESSION_SSH "$HOST" "
    set -e
    . ~/.nvm/nvm.sh 2>/dev/null || true
    rm -rf ~/$REMOTE_BASE/agent-$i && cp -r ~/$REMOTE_BASE/base ~/$REMOTE_BASE/agent-$i
    cd ~/$REMOTE_BASE/agent-$i
    git init -q 2>/dev/null && git add -A && git commit -qm baseline 2>/dev/null || true
    claude -p \"\$(printf %s '$B64' | base64 -d)\" --settings ~/.fleet-nohooks.json --dangerously-skip-permissions > _agent.log 2>&1 || true
    git add -A && git diff --cached > _agent.diff 2>/dev/null || true
  " &
  # bash 3.2-safe concurrency throttle (macOS /bin/bash has no 'wait -n')
  while [ "$(jobs -r | wc -l)" -ge "$FLEET_N" ]; do sleep 0.3; done
done
wait
echo "▸ all agents finished — pulling results back"

mkdir -p "$PROJ/fleet-results"
for n in $(seq 1 "$i"); do
  rsync -az -e "ssh $AURA_SESSION_SSH" "$HOST:~/$REMOTE_BASE/agent-$n/_agent.diff" "$PROJ/fleet-results/agent-$n.diff" 2>/dev/null || true
  rsync -az -e "ssh $AURA_SESSION_SSH" "$HOST:~/$REMOTE_BASE/agent-$n/_agent.log"  "$PROJ/fleet-results/agent-$n.log"  2>/dev/null || true
done
echo "▸ done. Review diffs in $PROJ/fleet-results/ (agent-N.diff) and apply the winners with: git apply fleet-results/agent-N.diff"
