#!/usr/bin/env bash
# AURAMAXING — orchestra REMOTE driver. Runs ON the cloud box, shipped + invoked by orchestra.sh.
# CWD = the run dir (contains GOAL.txt, roles.txt, out/). Env in: N TO JUDGES LIGHT.
# Single layer of shell quoting (no ssh/bash-lc nesting) → prompts are built cleanly here.
# Stages: 1) fan-out specialists (parallel) → 2) adversarial judges → 3) synthesizer.
set -uo pipefail
[ -f run.env ] && { set -a; . ./run.env; set +a; }   # N/TO/JUDGES/LIGHT/RESUME/MODEL — set when launched detached in tmux

. "$HOME/.nvm/nvm.sh" 2>/dev/null || true
CLAUDE="$(command -v claude)" || { echo "claude not found on box"; exit 1; }
[ -x "$CLAUDE" ] || { echo "claude not executable on box"; exit 1; }
GOAL="$(cat GOAL.txt)"

# LEAN WORKERS: --settings with an empty hooks map turns the AURAMAXING autopilot hooks OFF
# (they add ~70s/agent + a heavy subprocess tree). Box OAuth auth stays intact (unlike --bare).
SETTINGS="--settings $HOME/.fleet-nohooks.json"
MCP=""; [ "${LIGHT:-0}" = "1" ] && MCP="--strict-mcp-config --mcp-config $HOME/.orchestra-empty-mcp.json"
# Model tiering (saves the binding constraint = Max quota): ORCH_MODEL runs the many specialists +
# judges on a cheaper/faster model (e.g. claude-haiku-4-5 / claude-sonnet-4-6); the synthesizer keeps
# the strong default (unset = inherit). Empty MODEL → all agents inherit the box default.
ROLE_MODEL=""; [ -n "${MODEL:-}" ] && ROLE_MODEL="--model $MODEL"
export CLAUDE GOAL SETTINGS MCP TO ROLE_MODEL

# Detect a Claude Max quota / session-limit message in agent outputs, so a quota wall doesn't
# masquerade as a real result. Sets out/LIMIT_HIT and warns. The expensive stages are checkpointed
# (findings.md / critiques.md), so a re-run with ORCH_RESUME=1 reuses them and only redoes what's missing.
check_limit() { if grep -qiE 'hit your.*limit|session limit|usage limit|resets [0-9]' "$@" 2>/dev/null; then
  echo "⚠️  CLAUDE MAX LIMIT HIT — completed stages are saved; re-run with ORCH_RESUME=1 after the quota resets."
  : > out/LIMIT_HIT; fi; }

run_role() {
  local line="$1" idx="${2// /}"
  local name="${line%% ::*}" angle="${line#*:: }"
  timeout "$TO" "$CLAUDE" -p "You are the ${name} specialist on a multi-agent research team. GOAL:
${GOAL}

Your angle: ${angle}

Investigate deeply; use any skills/tools available to you. Produce a focused, evidence-backed findings brief for YOUR angle only. Be concrete, name real repos/sources, and explicitly flag uncertainty vs. solid evidence." $ROLE_MODEL $SETTINGS $MCP --dangerously-skip-permissions \
    > "out/role-$idx.txt" 2> "out/role-$idx.err" || echo "role $idx rc=$?" >> "out/role-$idx.err"
  pkill -f "mcp-server-|chrome-headless-shell" 2>/dev/null || true
}
export -f run_role

if [ "${RESUME:-0}" = "1" ] && [ -s out/findings.md ]; then
  echo "== stage 1: RESUME — reusing existing findings.md ($(wc -c < out/findings.md) bytes) =="
else
  echo "== stage 1: fan-out $(wc -l < roles.txt) specialists, ${N}-wide =="
  # shellcheck disable=SC1083  # {2} {1} are GNU parallel field placeholders, not brace expansion
  nl -ba roles.txt | parallel --colsep '\t' -j "$N" run_role {2} {1}
  : > out/findings.md; i=0
  while IFS= read -r l; do
    i=$((i+1)); nm="${l%% ::*}"
    printf '## %s\n' "$nm" >> out/findings.md
    cat "out/role-$i.txt" 2>/dev/null >> out/findings.md
    printf '\n\n' >> out/findings.md
  done < roles.txt
  check_limit out/role-*.txt
  echo "  stage 1 done: findings.md = $(wc -c < out/findings.md) bytes"
fi

echo "== stage 2: ${JUDGES} adversarial judges =="
run_judge() {
  local j="$1"
  timeout "$TO" "$CLAUDE" -p "You are judge #$j on a skeptical review panel. GOAL:
${GOAL}

Read the file out/findings.md in your working directory. Critically evaluate it: which claims are well-supported, which are hype/unsupported, what is MISSING, and rank the strongest actionable ideas. Be adversarial — actively try to refute weak claims. Output your critique + ranking." $ROLE_MODEL $SETTINGS $MCP --dangerously-skip-permissions \
    > "out/judge-$j.txt" 2> "out/judge-$j.err" || echo "judge $j rc=$?" >> "out/judge-$j.err"
}
export -f run_judge
if [ "${RESUME:-0}" = "1" ] && [ -s out/critiques.md ]; then
  echo "  stage 2: RESUME — reusing existing critiques.md ($(wc -c < out/critiques.md) bytes)"
else
  seq 1 "$JUDGES" | parallel -j "$N" run_judge {}
  : > out/critiques.md
  for j in $(seq 1 "$JUDGES"); do
    printf '## Judge %s\n' "$j" >> out/critiques.md
    cat "out/judge-$j.txt" 2>/dev/null >> out/critiques.md
    printf '\n\n' >> out/critiques.md
  done
  check_limit out/judge-*.txt
fi

echo "== stage 3: synthesis =="
timeout "$TO" "$CLAUDE" -p "You are the lead synthesizer. GOAL:
${GOAL}

Read out/findings.md (specialist briefs) and out/critiques.md (judge critiques) in your working directory. Merge them into ONE prioritized, decision-ready report: rank ideas by impact x effort, SEPARATE solid-evidence from experimental/promising, explicitly mark hype the judges refuted, and end with concrete next actions." $SETTINGS $MCP --dangerously-skip-permissions \
  > out/SYNTHESIS.md 2> out/synth.err || echo "synth rc=$?" >> out/synth.err
check_limit out/SYNTHESIS.md
pkill -f "mcp-server-|chrome-headless-shell" 2>/dev/null || true
echo "BOX_DONE: SYNTHESIS.md = $(wc -c < out/SYNTHESIS.md) bytes"
