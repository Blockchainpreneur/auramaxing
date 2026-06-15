#!/usr/bin/env bash
# AURAMAXING Nightly Engine — autonomous audit + improve loop (runs ON the Hetzner box).
#
# Reads ~/nightly/projects.conf (one line: <slug> <test_cmd>).
# For each project: clone/pull → AUDIT → FIX (≤3/round) → GATE (bash, not claude) → commit
# → repeat up to NIGHTLY_MAX_ROUNDS.  Commits land on branch aura/nightly-YYYYMMDD only.
# NEVER touches main.  NEVER deploys.  NEVER publishes packages.  NEVER reads .env files.
#
# Knobs (env):
#   NIGHTLY_END_HOUR       — stop starting new projects after this hour (24h, box UTC)
#                            default 8 (= 2am Cancun / America/Cancun = UTC-6 in CST)
#   NIGHTLY_PER_PROJECT_MIN — soft time budget per project in minutes (default 50)
#   NIGHTLY_MODEL          — claude model for audit/fix passes (default claude-opus-4-8)
#   NIGHTLY_MAX_ROUNDS     — max audit→fix→gate cycles per project (default 4)
#   NIGHTLY_CONF           — path to projects.conf (default ~/nightly/projects.conf)
#   NIGHTLY_GH_TOKEN       — GitHub PAT for private repos (optional; falls back to GH_TOKEN env)
#
# Run with --only <slug> to process a single project (smoke-test mode).
# Run with NIGHTLY_PER_PROJECT_MIN=4 NIGHTLY_MAX_ROUNDS=1 NIGHTLY_END_HOUR=23 for quick smoke.

set -uo pipefail

# ── paths & knobs ──────────────────────────────────────────────────────────────
CLAUDE_BIN="${CLAUDE_BIN:-/root/.local/bin/claude}"
BASE="$HOME/nightly"
WORK="$BASE/work"
REPORTS="$BASE/reports"
LOGS="$BASE/logs"
TODAY="$(date +%F)"
# Unique branch per RUN (not per day) — two runs in one day used to collide on the
# same branch: the 2nd run based its branch on main, the remote already had the 1st
# run's commits, push rejected non-fast-forward and the whole run's work stranded
# in the work dir (found live 2026-06-12: 4 repos' evening fixes needed manual rescue).
RUN_STAMP="$(date +%Y%m%d-%H%M)"
LOG_FILE="$LOGS/$TODAY.log"
REPORT_FILE="$REPORTS/$TODAY.md"
LOCK_FILE="$BASE/.lock"

NIGHTLY_END_HOUR="${NIGHTLY_END_HOUR:-8}"
NIGHTLY_PER_PROJECT_MIN="${NIGHTLY_PER_PROJECT_MIN:-50}"
NIGHTLY_MODEL="${NIGHTLY_MODEL:-claude-opus-4-8}"
NIGHTLY_MAX_ROUNDS="${NIGHTLY_MAX_ROUNDS:-4}"
CONF="${NIGHTLY_CONF:-$BASE/projects.conf}"

# Resolve GH token (nightly-install writes it to CONF dir; env fallback).
# Source the env file explicitly — systemd timer runs do not go through sshd,
# so /root/nightly/.nightly-env is the only path that reaches scheduled runs.
# shellcheck disable=SC1091
[ -f "$BASE/.nightly-env" ] && . "$BASE/.nightly-env"
GH_TOK="${NIGHTLY_GH_TOKEN:-${GH_TOKEN:-}}"

mkdir -p "$WORK" "$REPORTS" "$LOGS"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== AURAMAXING nightly $TODAY start $(date -Is) ==="
echo "model=$NIGHTLY_MODEL end_hour=$NIGHTLY_END_HOUR per_project=${NIGHTLY_PER_PROJECT_MIN}m max_rounds=$NIGHTLY_MAX_ROUNDS"

# ── no-overlap flock ───────────────────────────────────────────────────────────
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nightly] already running — exiting" >&2
  exit 0
fi

# ── hooks-off settings (prevents AURAMAXING autopilot hooks OOMing the box) ──
# NOTE: '{"hooks":{}}' alone does NOT clear hooks — --settings MERGES with
# ~/.claude/settings.json (an empty object removes nothing). The claude calls
# below also pass --setting-sources project so user-level hooks never load
# (proven 2026-06-11: with hooks live, the "audit" answered ledger hook noise —
# "Ledger cleared. All items done." — instead of the audit prompt).
HOOKS_OFF_SETTINGS="$HOME/.nightly-nohooks.json"
printf '{"hooks":{}}' > "$HOOKS_OFF_SETTINGS"

# ── --only flag ────────────────────────────────────────────────────────────────
ONLY_SLUG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY_SLUG="${2:?--only requires a slug argument}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── helper: check end-hour guard ──────────────────────────────────────────────
past_end_hour() {
  local h
  h="$(date -u +%H | sed 's/^0*//')"
  [ -z "$h" ] && h=0
  [ "$h" -ge "$NIGHTLY_END_HOUR" ]
}

# ── report helpers ────────────────────────────────────────────────────────────
append_report() { printf '%s\n' "$*" >> "$REPORT_FILE"; }
begin_report() {
  cat >> "$REPORT_FILE" << HEADER
# AURAMAXING Nightly Report — $TODAY

Generated: $(date -Is)
Model: $NIGHTLY_MODEL
Window: until ${NIGHTLY_END_HOUR}:00 UTC | ${NIGHTLY_PER_PROJECT_MIN}min/project | max ${NIGHTLY_MAX_ROUNDS} rounds

---
HEADER
}

# ── read projects.conf ────────────────────────────────────────────────────────
[ -f "$CONF" ] || { echo "no projects.conf at $CONF — abort" >&2; exit 1; }

declare -a PROJECTS=()
declare -a TEST_CMDS=()
while IFS= read -r line; do
  # skip comments and blanks
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  slug="$(echo "$line" | awk '{print $1}')"
  testcmd="$(echo "$line" | cut -d' ' -f2-)"
  [ -z "$slug" ] && continue
  if [ -n "$ONLY_SLUG" ] && [ "$slug" != "$ONLY_SLUG" ]; then continue; fi
  PROJECTS+=("$slug")
  TEST_CMDS+=("$testcmd")
done < "$CONF"

if [ "${#PROJECTS[@]}" -eq 0 ]; then
  if [ -n "$ONLY_SLUG" ]; then
    echo "[nightly] --only $ONLY_SLUG not found in $CONF" >&2; exit 1
  fi
  echo "[nightly] no projects in $CONF — nothing to do" >&2; exit 0
fi

begin_report
echo "[nightly] ${#PROJECTS[@]} project(s) queued"

# ── configure git credential helper if GH_TOKEN available ────────────────────
if [ -n "$GH_TOK" ]; then
  git config --global credential.helper \
    "!f(){ echo username=x-token; echo password=$GH_TOK; }; f" 2>/dev/null || true
fi

# ── per-project loop ──────────────────────────────────────────────────────────
for i in "${!PROJECTS[@]}"; do
  SLUG="${PROJECTS[$i]}"
  TEST_CMD="${TEST_CMDS[$i]}"
  REPO_NAME="${SLUG##*/}"
  WORK_DIR="$WORK/$REPO_NAME"
  BRANCH="aura/nightly-$RUN_STAMP"
  PROJECT_START="$(date +%s)"
  PROJECT_DEADLINE=$(( PROJECT_START + NIGHTLY_PER_PROJECT_MIN * 60 ))

  echo ""
  echo "══════════════════════════════════════════════"
  echo "[nightly] project $((i+1))/${#PROJECTS[@]}: $SLUG"
  echo "══════════════════════════════════════════════"

  # end-hour guard
  if past_end_hour; then
    echo "[nightly] past end hour — stopping before $SLUG"
    append_report ""
    append_report "## $SLUG — SKIPPED (past end hour)"
    append_report ""
    continue
  fi

  # per-project error isolation
  {

  # ── clone / pull ────────────────────────────────────────────────────────────
  CLONE_URL="https://github.com/$SLUG"
  if [ -n "$GH_TOK" ]; then
    CLONE_URL="https://x-token:${GH_TOK}@github.com/$SLUG"
  fi

  if [ -d "$WORK_DIR/.git" ]; then
    echo "[nightly] updating existing clone at $WORK_DIR"
    # Safety: abort if there are unexpected local changes
    if ! git -C "$WORK_DIR" diff --quiet HEAD 2>/dev/null; then
      echo "[nightly] WARN: $WORK_DIR has unexpected local changes — re-cloning for safety"
      rm -rf "$WORK_DIR"
    fi
  fi

  if [ ! -d "$WORK_DIR/.git" ]; then
    echo "[nightly] cloning $SLUG → $WORK_DIR"
    if ! git clone --depth=50 "$CLONE_URL" "$WORK_DIR" 2>&1; then
      echo "[nightly] ERROR: clone failed for $SLUG"
      append_report ""
      append_report "## $SLUG — CLONE FAILED"
      append_report ""
      append_report "Could not clone \`$SLUG\`. Is the repo accessible? Is GH_TOKEN set?"
      append_report ""
      continue
    fi
  else
    git -C "$WORK_DIR" remote set-url origin "$CLONE_URL" 2>/dev/null || true
    git -C "$WORK_DIR" fetch --depth=50 origin 2>&1 || true
    git -C "$WORK_DIR" reset --hard origin/main 2>&1 \
      || git -C "$WORK_DIR" reset --hard origin/master 2>&1 \
      || true
  fi

  # Verify clean state after clone/pull
  if ! git -C "$WORK_DIR" diff --quiet HEAD 2>/dev/null; then
    echo "[nightly] WARN: working tree not clean after clone/pull — skipping"
    append_report ""
    append_report "## $SLUG — SKIPPED (unclean working tree after pull)"
    append_report ""
    continue
  fi

  # ── create / checkout nightly branch ───────────────────────────────────────
  git -C "$WORK_DIR" checkout -B "$BRANCH" 2>&1 || {
    echo "[nightly] ERROR: could not create branch $BRANCH"
    continue
  }

  # install deps (best-effort, non-fatal)
  if [ -f "$WORK_DIR/package.json" ]; then
    echo "[nightly] installing deps..."
    (cd "$WORK_DIR" && { pnpm install --frozen-lockfile 2>&1 || npm ci 2>&1 || npm install 2>&1; } | tail -5) || true
  fi

  # ── round loop ──────────────────────────────────────────────────────────────
  round=0
  total_commits=0
  total_fixes_attempted=0
  total_fixes_applied=0
  fixes_list=""

  while [ "$round" -lt "$NIGHTLY_MAX_ROUNDS" ]; do
    # time budget check
    if [ "$(date +%s)" -ge "$PROJECT_DEADLINE" ]; then
      echo "[nightly] per-project budget exhausted at round $round"
      break
    fi
    if past_end_hour; then
      echo "[nightly] end-hour reached mid-project — stopping rounds"
      break
    fi

    round=$(( round + 1 ))
    echo ""
    echo "── Round $round/$NIGHTLY_MAX_ROUNDS ──"

    # ── (a) AUDIT ───────────────────────────────────────────────────────────
    AUDIT_OUT="$BASE/tmp-audit-${REPO_NAME}-r${round}.txt"
    AUDIT_PROMPT="$(cat << 'AUDIT_EOF'
You are an automated code auditor. Audit this codebase and output ONLY a ranked fix list.

RULES:
- Output format: one fix per line, exactly: FIX: <short title> | <file:line or 'general'> | <category: bug|test|perf|security|cleanup> | <effort: S|M|L>
- Maximum 10 fixes. Prioritize: security > bugs > failing/missing tests > perf > dead code.
- Only propose changes that are self-contained and verifiable by running the test command.
- Do NOT propose: dependency upgrades, config changes, UI/design changes, refactors that break APIs.
- Do NOT propose: reading or modifying .env files.
- If no meaningful fixes exist, output exactly: NO_FIXES_NEEDED
- Be terse. No prose. Just the FIX: lines (or NO_FIXES_NEEDED).
AUDIT_EOF
)"

    echo "[nightly] running audit pass..."
    # Gate on OUTPUT presence, NOT exit code: claude -p can return valid audit output AND
    # still exit non-zero (transient warning/refresh). Only an EMPTY result skips the round.
    AUDIT_RESULT="$(cd "$WORK_DIR" && "$CLAUDE_BIN" \
      --model "$NIGHTLY_MODEL" \
      --settings "$HOOKS_OFF_SETTINGS" \
      --setting-sources project \
      --dangerously-skip-permissions \
      -p "$AUDIT_PROMPT" 2>&1)" || true
    if [ -z "${AUDIT_RESULT//[[:space:]]/}" ]; then
      echo "[nightly] WARN: audit produced NO output — skipping round"
      break
    fi
    # Rate/session-limit resilience: the account limit message is NOT an audit result.
    # Wait and retry the round instead of silently treating it as "no fixes" (found
    # live 2026-06-12: 3 of 4 projects got zero work because the limit hit mid-run).
    if echo "$AUDIT_RESULT" | grep -qiE "hit your (session|usage) limit|rate.?limit|resets [0-9]"; then
      echo "[nightly] WARN: Claude session/rate limit hit — sleeping 15m then retrying (round not consumed)"
      round=$(( round - 1 ))
      sleep 900
      continue
    fi
    echo "[nightly] audit done ($(echo "$AUDIT_RESULT" | wc -l) lines)"

    # write audit to file for log
    echo "$AUDIT_RESULT" > "$AUDIT_OUT"

    # check for no-fixes signal
    if echo "$AUDIT_RESULT" | grep -q "^NO_FIXES_NEEDED"; then
      echo "[nightly] audit: no fixes needed — done with $SLUG"
      break
    fi

    # extract fix lines
    mapfile -t FIX_LINES < <(echo "$AUDIT_RESULT" | grep "^FIX:" | head -3)
    if [ "${#FIX_LINES[@]}" -eq 0 ]; then
      echo "[nightly] no FIX: lines in audit output — done"
      break
    fi

    echo "[nightly] ${#FIX_LINES[@]} fix(es) proposed this round"

    # ── (b) FIX — one claude run per fix ───────────────────────────────────
    for fix_line in "${FIX_LINES[@]}"; do
      total_fixes_attempted=$(( total_fixes_attempted + 1 ))

      fix_title="$(echo "$fix_line" | cut -d'|' -f1 | sed 's/^FIX:[[:space:]]*//')"
      fix_loc="$(echo "$fix_line" | cut -d'|' -f2 | tr -d ' ')"

      echo "[nightly] applying fix: $fix_title ($fix_loc)"

      # snapshot for rollback
      git -C "$WORK_DIR" stash push -m "pre-fix-$round-$total_fixes_attempted" 2>&1 || true

      FIX_PROMPT="$(cat << FIX_EOF
You are an automated code fixer. Apply EXACTLY this fix and nothing else.

FIX TO APPLY: $fix_title
LOCATION: $fix_loc
TEST COMMAND: $TEST_CMD

RULES (non-negotiable):
1. Make the minimal change that addresses the fix. Do not refactor unrelated code.
2. Do NOT read, create, or modify any .env files or files containing secrets/credentials.
3. Do NOT add any new dependencies.
4. Do NOT push, publish, deploy, or run anything except the test command.
5. After making your change, run the test command and verify it exits 0.
6. If the test fails, revert your change immediately with: git -C . checkout .
7. Output at the end: APPLIED or REVERTED (one word, last line of output).
FIX_EOF
)"

      # Run the fix; do NOT gate on exit code — the deterministic TEST GATE below is the only
      # arbiter. A non-zero exit with a valid change must still reach the gate (which commits on
      # green, reverts on red). Only the gate decides; claude's exit code is advisory.
      (cd "$WORK_DIR" && "$CLAUDE_BIN" \
        --model "$NIGHTLY_MODEL" \
        --settings "$HOOKS_OFF_SETTINGS" \
        --setting-sources project \
        --dangerously-skip-permissions \
        -p "$FIX_PROMPT" 2>&1) || true
      echo "[nightly] fix call returned (exit advisory — test gate decides)"

      # ── (c) GATE — deterministic bash test, not claude's word ────────────
      echo "[nightly] running test gate: $TEST_CMD"
      TEST_OUTPUT="$BASE/tmp-test-${REPO_NAME}-r${round}-f${total_fixes_attempted}.txt"

      gate_pass=0
      if (cd "$WORK_DIR" && eval "$TEST_CMD" > "$TEST_OUTPUT" 2>&1); then
        gate_pass=1
      fi

      if [ "$gate_pass" -eq 0 ]; then
        echo "[nightly] GATE FAILED — reverting fix"
        git -C "$WORK_DIR" checkout . 2>&1 || true
        # pop stash if still there
        git -C "$WORK_DIR" stash pop 2>&1 || true
        echo "[nightly] fix reverted: $fix_title"
        fixes_list="${fixes_list}  - REVERTED (gate fail): $fix_title\n"
        echo "--- test output tail ---"
        tail -10 "$TEST_OUTPUT" 2>/dev/null
        continue
      fi

      # drop the stash (fix was good)
      git -C "$WORK_DIR" stash drop 2>&1 || true

      # check if there's actually a diff
      if git -C "$WORK_DIR" diff --quiet HEAD 2>/dev/null; then
        echo "[nightly] gate passed but no diff — fix was a no-op"
        fixes_list="${fixes_list}  - NOOP: $fix_title\n"
        continue
      fi

      # ── (d) commit ──────────────────────────────────────────────────────
      commit_msg="[nightly] $fix_title ($fix_loc)"
      git -C "$WORK_DIR" add -A 2>&1
      git -C "$WORK_DIR" commit -m "$commit_msg

Automated fix by AURAMAXING nightly engine.
Project: $SLUG  Round: $round  Model: $NIGHTLY_MODEL
Co-Authored-By: AURAMAXING Nightly <noreply@auramaxing.ai>" 2>&1

      total_commits=$(( total_commits + 1 ))
      total_fixes_applied=$(( total_fixes_applied + 1 ))
      echo "[nightly] committed: $fix_title"
      echo "--- test output tail ---"
      tail -5 "$TEST_OUTPUT" 2>/dev/null
      fixes_list="${fixes_list}  - APPLIED: $fix_title ($fix_loc)\n"

    done  # end fix loop

  done  # end round loop

  # ── push to nightly branch (if any commits) ────────────────────────────────
  push_result="no commits — nothing to push"
  if [ "$total_commits" -gt 0 ]; then
    echo "[nightly] pushing $total_commits commit(s) to $BRANCH"
    if git -C "$WORK_DIR" push origin "$BRANCH" --force-with-lease 2>&1; then
      push_result="pushed $total_commits commit(s) to \`$BRANCH\`"
    else
      push_result="push failed (check credentials/access)"
    fi
  fi

  # ── report section ─────────────────────────────────────────────────────────
  append_report ""
  append_report "## $SLUG"
  append_report ""
  append_report "- Rounds completed: $round / $NIGHTLY_MAX_ROUNDS"
  append_report "- Fixes attempted: $total_fixes_attempted"
  append_report "- Fixes applied: $total_fixes_applied"
  append_report "- Push: $push_result"
  append_report ""
  append_report "### Fixes"
  append_report ""
  if [ -n "$fixes_list" ]; then
    printf '%b' "$fixes_list" >> "$REPORT_FILE"
  else
    append_report "  (none attempted)"
  fi
  if [ -f "$AUDIT_OUT" ]; then
    append_report ""
    append_report "<details><summary>Last audit output</summary>"
    append_report ""
    append_report '```'
    head -30 "$AUDIT_OUT" >> "$REPORT_FILE"
    append_report '```'
    append_report ""
    append_report "</details>"
  fi
  append_report ""

  } || {
    echo "[nightly] ERROR: uncaught error in project $SLUG — continuing to next"
    append_report ""
    append_report "## $SLUG — ERROR (uncaught exception in driver)"
    append_report ""
  }

done  # end project loop

# ── finalize report ────────────────────────────────────────────────────────────
append_report ""
append_report "---"
append_report ""
append_report "_Report generated by AURAMAXING nightly.sh — $(date -Is)_"

echo ""
echo "=== nightly $TODAY done $(date -Is) ==="
echo "report → $REPORT_FILE"
echo "log    → $LOG_FILE"
