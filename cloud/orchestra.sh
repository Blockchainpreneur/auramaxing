#!/usr/bin/env bash
# AURAMAXING — /orchestra: role-based, RAM-aware agent fleet on the cloud box.
# 3-stage pipeline, ALL on the box's RAM (the Mac stays a thin client):
#   1. FAN-OUT  — N specialist agents, each a distinct ROLE/angle, run in parallel (RAM-capped).
#   2. JUDGE    — J adversarial critics read ALL stage-1 findings and score/refute them.
#   3. SYNTH    — 1 synthesizer merges survivors + critiques into the final decision-ready report.
# Concurrency AUTO-SCALES to the box's FREE RAM (free -g ÷ per-agent cap) so it never thrashes —
# the lesson from the 8 GB Mac, enforced here. Reuses swarm.sh's RAM caps/timeouts + lib.sh SSH.
#
# Usage:
#   orchestra.sh "<GOAL>" [roles-file]
#   roles-file: one role per non-comment line →  RoleName :: angle / instructions
#               (omitted → built-in deep-research preset)
# Knobs (env): ORCH_MEM=3G  ORCH_TIMEOUT=900  ORCH_JUDGES=3  ORCH_N=<auto>  ORCH_LIGHT=0
#   ORCH_LIGHT=1 → agents run with an EMPTY MCP set (RAM-min, fastest); 0 → full skills+MCP.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib.sh"   # script-relative → works at any install path
HOST="$(aura_resolve_host)" || { aura_box_unconfigured; exit 1; }   # beacon/AURA_FLEET_HOST → never the burned box
aura_require_host "$HOST"

GOAL="${1:?usage: orchestra.sh \"<GOAL>\" [roles-file]}"
ROLES_FILE="${2:-}"
MEM="${ORCH_MEM:-3G}"; TO="${ORCH_TIMEOUT:-900}"; JUDGES="${ORCH_JUDGES:-3}"; LIGHT="${ORCH_LIGHT:-0}"
RESUME="${ORCH_RESUME:-0}"   # 1 = reuse existing findings.md/critiques.md (e.g. after a Max-quota stop), redo only what's missing
MODEL="${ORCH_MODEL:-}"      # tier specialists+judges to a cheaper model (e.g. claude-haiku-4-5) to save Max quota; synth keeps the strong default
aura_require_int ORCH_TIMEOUT "$TO"; aura_require_posint ORCH_JUDGES "$JUDGES"; aura_require_mem ORCH_MEM "$MEM"

# Built-in role preset (generic deep-research) used when no roles-file is given.
DEFAULT_ROLES='Landscape :: Map the overall landscape, key players, and current state of the art.
Evidence :: Find the strongest empirical evidence, benchmarks, and data. Be skeptical of hype.
Contrarian :: Argue the opposite — why the popular approach fails; steelman the alternative.
Practitioner :: What do top practitioners ACTUALLY do (real repos, blogs, workflows)?
Risks :: Failure modes, costs, hidden tradeoffs, and what breaks at scale.'

# Materialize roles (strip comments/blanks).
TMP_ROLES="$(mktemp)"; trap 'rm -f "$TMP_ROLES"' EXIT
if [ -n "$ROLES_FILE" ]; then
  [ -f "$ROLES_FILE" ] || { echo "no such roles-file: $ROLES_FILE"; exit 1; }
  grep -vE '^[[:space:]]*(#|$)' "$ROLES_FILE" > "$TMP_ROLES"
else
  printf '%s\n' "$DEFAULT_ROLES" > "$TMP_ROLES"
fi
NROLES=$(awk 'END{print NR}' "$TMP_ROLES")
[ "${NROLES:-0}" -gt 0 ] || { echo "no roles to run"; exit 1; }

RUN="$(aura_safe_name "$GOAL")"
REMOTE="orchestra/$RUN"

# RAM-aware concurrency: floor(free_gb / per_agent_gb), clamped to [1, NROLES]; ORCH_N overrides.
PER_GB="${MEM%[GgMmKk]}"; case "$MEM" in *[Mm]) PER_GB=1;; *[Kk]) PER_GB=1;; esac; [ -z "$PER_GB" ] && PER_GB=3; [ "$PER_GB" -lt 1 ] && PER_GB=1
if [ -n "${ORCH_N:-}" ]; then N="$ORCH_N"; aura_require_posint ORCH_N "$N"
else
  FREE_GB=$(ssh $AURA_SESSION_SSH "$HOST" "free -g | awk '/^Mem:/{print \$7}'" 2>/dev/null || echo 4)
  case "$FREE_GB" in ''|*[!0-9]*) FREE_GB=4;; esac
  N=$(( FREE_GB / PER_GB )); [ "$N" -lt 1 ] && N=1; [ "$N" -gt "$NROLES" ] && N="$NROLES"
fi

echo "▸ orchestra: $NROLES specialists + $JUDGES judges + 1 synth → $HOST (concurrency=$N, ${MEM}/agent, light=$LIGHT)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[dry-run] would run $NROLES specialists ${N}-wide, $JUDGES judges, 1 synthesizer on $HOST:~/$REMOTE (mem=$MEM timeout=${TO}s)"
  exit 0
fi

# Light mode → empty MCP set (RAM-min). Otherwise agents inherit the box's full skills+MCP.
MCP_FLAGS=""
if [ "$LIGHT" = "1" ]; then
  printf '%s\n' "$AURA_EMPTY_MCP" | ssh $AURA_SESSION_SSH "$HOST" 'cat > ~/.orchestra-empty-mcp.json'
  MCP_FLAGS="--strict-mcp-config --mcp-config \$HOME/.orchestra-empty-mcp.json"
fi
# Hook-disabling settings (valid JSON, written from the LOCAL side → no nested-quote corruption).
# Every agent passes --settings ~/.fleet-nohooks.json so the AURAMAXING autopilot hooks stay OFF.
printf '%s' '{"hooks":{}}' | ssh $AURA_SESSION_SSH "$HOST" 'cat > ~/.fleet-nohooks.json'

ssh $AURA_SESSION_SSH "$HOST" "mkdir -p ~/$REMOTE/out"
printf '%s' "$GOAL" | base64 | ssh $AURA_SESSION_SSH "$HOST" "base64 -d > ~/$REMOTE/GOAL.txt"   # injection-safe
rsync -az -e "ssh $AURA_SESSION_SSH" "$TMP_ROLES" "$HOST:~/$REMOTE/roles.txt"

# Ship the standalone driver and run it ON the box. Single-layer quoting — prompts are built on the
# box reading GOAL.txt/roles.txt, so there is NO ssh→bash-lc→parallel nested-quote minefield.
rsync -az -e "ssh $AURA_SESSION_SSH" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/orchestra-driver.sh" "$HOST:~/$REMOTE/driver.sh"
# Params via a clean env file (no nested-quote hell) — the driver sources run.env.
printf 'N=%s\nTO=%s\nJUDGES=%s\nLIGHT=%s\nRESUME=%s\nMODEL=%s\n' "$N" "$TO" "$JUDGES" "$LIGHT" "$RESUME" "$MODEL" \
  | ssh $AURA_SESSION_SSH "$HOST" "cat > ~/$REMOTE/run.env"
# RESILIENCE: a big fleet run can outlive one SSH — run the driver DETACHED in tmux so a dropped/reset
# connection never kills it (the lesson from acode). Poll the sentinel over the warm multiplexed conn.
TMUX_S="orch-$(printf %s "$RUN" | tr '.' '-')"
ssh $AURA_SESSION_SSH "$HOST" "cd ~/$REMOTE && rm -f out/.DONE && tmux new-session -d -s '$TMUX_S' 'cd ~/$REMOTE && bash driver.sh > driver.log 2>&1; touch out/.DONE'"
echo "▸ fleet running detached in tmux ($TMUX_S) — resilient to SSH drops; polling…"
while :; do
  ssh $AURA_SSH_OPTS "$HOST" "test -f ~/$REMOTE/out/.DONE" 2>/dev/null && break
  ssh $AURA_SSH_OPTS "$HOST" "tmux has-session -t '$TMUX_S' 2>/dev/null" || { ssh $AURA_SSH_OPTS "$HOST" "test -f ~/$REMOTE/out/.DONE" 2>/dev/null || echo "▸ tmux ended without sentinel — pulling whatever exists"; break; }
  sleep 12
done
ssh $AURA_SSH_OPTS "$HOST" "tail -4 ~/$REMOTE/driver.log 2>/dev/null" || true

mkdir -p "$HOME/orchestra-results/$RUN"
rsync -az -e "ssh $AURA_SESSION_SSH" "$HOST:~/$REMOTE/out/" "$HOME/orchestra-results/$RUN/" 2>/dev/null || true
echo "▸ done. Final report → ~/orchestra-results/$RUN/SYNTHESIS.md"
echo "  raw: role-*.txt (specialists), judge-*.txt (panel), findings.md, critiques.md"
