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

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib.sh"   # shared SSH hardening + excludes + name helpers (DRY)
HOST="$(aura_resolve_host)" || { aura_box_unconfigured; exit 1; }   # beacon/AURA_FLEET_HOST → never the burned box
aura_require_host "$HOST"
PROJ="${1:?usage: swarm.sh <project-dir> <tasks-file>}"
TASKS="${2:?usage: swarm.sh <project-dir> <tasks-file>}"
[ -d "$PROJ" ] || { echo "no such project dir: $PROJ"; exit 1; }
[ -f "$TASKS" ] || { echo "no such tasks file: $TASKS"; exit 1; }
PROJ="$(cd "$PROJ" && pwd)"; NAME="$(aura_safe_name "$PROJ")"
N="${SWARM_N:-4}"; MEM="${SWARM_MEM:-3G}"; TO="${SWARM_TIMEOUT:-600}"; RETRIES="${SWARM_RETRIES:-2}"
# validate the knobs — they are interpolated RAW into the remote `bash -lc '…'`; reject injection/garbage
aura_require_int SWARM_N "$N"; aura_require_int SWARM_TIMEOUT "$TO"; aura_require_int SWARM_RETRIES "$RETRIES"; aura_require_mem SWARM_MEM "$MEM"
REMOTE="swarm/$NAME"

echo "▸ swarm: $NAME → $HOST  (workers=$N mem=$MEM/task timeout=${TO}s)"

# DRY_RUN=1 → print the plan and exit before any box/network side effect (used by smoke-test.sh).
if [ "${DRY_RUN:-0}" = "1" ]; then
  n=$(grep -vcE '^[[:space:]]*(#|$)' "$TASKS" || true); n=${n:-0}
  echo "[dry-run] would sync $PROJ → $HOST:~/$REMOTE and drain $n tasks ${N}-wide (mem=$MEM timeout=${TO}s)"
  exit 0
fi

ssh $AURA_SESSION_SSH "$HOST" "mkdir -p ~/$REMOTE/base ~/$REMOTE/out"
rsync -az --delete -e "ssh $AURA_SESSION_SSH" "${AURA_RSYNC_EXCLUDES[@]}" \
  "$PROJ"/ "$HOST:~/$REMOTE/base/"
# strip comments/blanks, ship the queue ([[:space:]] = POSIX-portable; \s is non-portable in BSD grep)
trap 'rm -f /tmp/.swarm-tasks.$$' EXIT   # clean the queue temp even on early failure
grep -vE '^[[:space:]]*(#|$)' "$TASKS" > /tmp/.swarm-tasks.$$ || true
NTASK=$(awk 'END{print NR}' /tmp/.swarm-tasks.$$)   # awk counts a final unterminated line; wc -l would undercount
echo "▸ $NTASK tasks queued, draining ${N}-wide"
rsync -az -e "ssh $AURA_SESSION_SSH" /tmp/.swarm-tasks.$$ "$HOST:~/$REMOTE/tasks.txt"; rm -f /tmp/.swarm-tasks.$$

# write a CLEAN empty-MCP json on the box (single-quoted → no escaping corruption)
printf '%s\n' "$AURA_EMPTY_MCP" | ssh $AURA_SESSION_SSH "$HOST" 'cat > ~/.swarm-empty-mcp.json'
# Disable the AURAMAXING autopilot hooks for workers. Without this, each task's hook subprocess tree
# (UserPromptSubmit prompt-engine + LightRAG sentence-transformers ~1-2GB + daemons) blows the
# MemoryMax cgroup cap → OOM SIGKILL, and adds ~70s/task. Written from local → guaranteed valid JSON.
printf '%s' '{"hooks":{}}' | ssh $AURA_SESSION_SSH "$HOST" 'cat > ~/.fleet-nohooks.json'

# remote driver: one fresh, capped, MCP-disabled claude -p per task; reap orphans; joblog
ssh $AURA_SESSION_SSH "$HOST" "bash -lc '
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
    \"\$CLAUDE\" -p \"\$task\" --settings \$HOME/.fleet-nohooks.json --strict-mcp-config --mcp-config \"\$EMPTY_MCP\" --dangerously-skip-permissions \
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
rsync -az -e "ssh $AURA_SESSION_SSH" --include='joblog.tsv' --include='*.meta/' --include='*.meta/**' --exclude='*' \
  "$HOST:~/$REMOTE/out/" "$PROJ/swarm-results/" 2>/dev/null || true
echo "▸ done. Results in $PROJ/swarm-results/task-N.meta/ (_agent.diff = clean code, _result.txt, _err.log) + joblog.tsv"
echo "  apply a diff:  (cd $PROJ && git apply swarm-results/task-N.meta/_agent.diff)"
