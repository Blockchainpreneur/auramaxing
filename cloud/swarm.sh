#!/usr/bin/env bash
# AURAMAXING — /swarm: drain a BACKLOG of up to ~200 tasks through a bounded worker pool
# on the cloud box. Unlike fleet.sh (one agent per subtask, fired all at once), swarm.sh
# processes a queue N-at-a-time with memory caps, timeouts, retries, and orphan reaping —
# honest for a 16 GB box (~4 safe workers). Local project stays the source of truth.
#
# Setup:  export AURA_FLEET_HOST="root@<box-ip>"   (in ~/.zshrc)
# Usage:  swarm.sh <project-dir> <tasks-file>        # one task (prompt) per line, '#' comments ok
#   opts: SWARM_N=4 (workers)  SWARM_MEM=3G (per-task cap)  SWARM_TIMEOUT=600 (s)  SWARM_RETRIES=2
set -euo pipefail

HOST="${AURA_FLEET_HOST:-}"
[ -z "$HOST" ] && { echo "set AURA_FLEET_HOST=root@<box-ip> first"; exit 1; }
PROJ="${1:?usage: swarm.sh <project-dir> <tasks-file>}"
TASKS="${2:?usage: swarm.sh <project-dir> <tasks-file>}"
[ -d "$PROJ" ] || { echo "no such project dir: $PROJ"; exit 1; }
[ -f "$TASKS" ] || { echo "no such tasks file: $TASKS"; exit 1; }
PROJ="$(cd "$PROJ" && pwd)"; NAME="$(basename "$PROJ")"
N="${SWARM_N:-4}"; MEM="${SWARM_MEM:-3G}"; TO="${SWARM_TIMEOUT:-600}"; RETRIES="${SWARM_RETRIES:-2}"
REMOTE="swarm/$NAME"

echo "▸ swarm: $NAME → $HOST  (workers=$N mem=$MEM/task timeout=${TO}s)"
ssh "$HOST" "mkdir -p ~/$REMOTE/base ~/$REMOTE/out"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next' \
  --exclude 'target' --exclude '.venv' --exclude '__pycache__' \
  "$PROJ"/ "$HOST:~/$REMOTE/base/"
# strip comments/blanks, ship the queue
grep -vE '^\s*(#|$)' "$TASKS" > /tmp/.swarm-tasks.$$ || true
NTASK=$(wc -l < /tmp/.swarm-tasks.$$ | tr -d ' ')
echo "▸ $NTASK tasks queued, draining ${N}-wide"
rsync -az /tmp/.swarm-tasks.$$ "$HOST:~/$REMOTE/tasks.txt"; rm -f /tmp/.swarm-tasks.$$

# write a CLEAN empty-MCP json on the box (single-quoted → no escaping corruption)
printf '%s\n' '{"mcpServers":{}}' | ssh "$HOST" 'cat > ~/.swarm-empty-mcp.json'

# remote driver: one fresh, capped, MCP-disabled claude -p per task; reap orphans; joblog
ssh "$HOST" "bash -lc '
set -euo pipefail
cd ~/$REMOTE
. \$HOME/.nvm/nvm.sh 2>/dev/null || true
CLAUDE=\$(command -v claude); export CLAUDE
[ -x \"\$CLAUDE\" ] || { echo \"claude binary not found\"; exit 1; }
EMPTY_MCP=~/.swarm-empty-mcp.json; export EMPTY_MCP
run_one() {
  local task=\"\$1\" idx=\"\$2\"
  local d=~/$REMOTE/out/task-\$idx; local M=~/$REMOTE/out/task-\$idx.meta
  rm -rf \"\$d\" \"\$M\"; cp -r ~/$REMOTE/base \"\$d\"; mkdir -p \"\$M\"; cd \"\$d\"
  git init -q 2>/dev/null && git add -A && git commit -qm base 2>/dev/null || true
  systemd-run --scope -p MemoryMax=$MEM --quiet timeout $TO \
    \"\$CLAUDE\" -p \"\$task\" --strict-mcp-config --mcp-config \"\$EMPTY_MCP\" --dangerously-skip-permissions \
    > \"\$M/_result.txt\" 2> \"\$M/_err.log\" || echo \"FAIL idx=\$idx rc=\$?\" >> \"\$M/_err.log\"
  git add -A && git diff --cached > \"\$M/_agent.diff\" 2>/dev/null || true
  pkill -f \"mcp-server-|chrome-headless-shell\" 2>/dev/null || true
}
export -f run_one
nl -ba ~/$REMOTE/tasks.txt | parallel --colsep \"\t\" -j $N --joblog ~/$REMOTE/out/joblog.tsv \
  --retries $RETRIES run_one {2} {1}
pkill -f \"mcp-server-|chrome-headless-shell|claude\" 2>/dev/null || true
echo \"--- joblog (rc!=0 = failed) ---\"; awk -F\"\t\" \"NR>1{print \\\$4, \\\"rc=\\\"\\\$7, \\\$NF}\" ~/$REMOTE/out/joblog.tsv 2>/dev/null || true
'" || echo "▸ driver returned non-zero — pulling results anyway"

mkdir -p "$PROJ/swarm-results"
# pull only the lean meta dirs (clean diff + result + err) and the joblog — not the full repo copies
rsync -az --include='joblog.tsv' --include='*.meta/' --include='*.meta/**' --exclude='*' \
  "$HOST:~/$REMOTE/out/" "$PROJ/swarm-results/" 2>/dev/null || true
echo "▸ done. Results in $PROJ/swarm-results/task-N.meta/ (_agent.diff = clean code, _result.txt, _err.log) + joblog.tsv"
echo "  apply a diff:  (cd $PROJ && git apply swarm-results/task-N.meta/_agent.diff)"
