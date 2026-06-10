#!/usr/bin/env bash
# AURAMAXING Nightly Engine — Mac-side report fetcher.
# SSH-pulls the latest nightly report from the box and prints it.
#
# Usage:
#   bash ~/auramaxing/cloud/nightly-report.sh           # latest report
#   bash ~/auramaxing/cloud/nightly-report.sh 2026-06-10  # specific date
#   bash ~/auramaxing/cloud/nightly-report.sh --list      # list available reports

set -uo pipefail

HOST="${AURA_FLEET_HOST:-root@178.104.225.194}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3"
LOCAL_DIR="$HOME/.auramaxing/nightly"
mkdir -p "$LOCAL_DIR"

# ── parse args ─────────────────────────────────────────────────────────────────
LIST_MODE=0
DATE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST_MODE=1; shift ;;
    --help|-h)
      echo "Usage: nightly-report.sh [date|--list]"
      echo "  (no args)   — fetch and print latest report"
      echo "  2026-06-10  — fetch report for that date"
      echo "  --list      — list all available reports on the box"
      exit 0 ;;
    *) DATE_ARG="$1"; shift ;;
  esac
done

# ── reachability check ─────────────────────────────────────────────────────────
if ! ssh $SSH_OPTS "$HOST" true 2>/dev/null; then
  echo "✗ box unreachable ($HOST) — cannot fetch nightly report"
  echo "  (Box may be offline. Reports cache locally once fetched.)"
  # Try to show most recent cached report
  LATEST_CACHED="$(ls -1t "$LOCAL_DIR"/*.md 2>/dev/null | head -1)"
  if [ -n "$LATEST_CACHED" ]; then
    echo ""
    echo "  Showing most recent cached report: $(basename "$LATEST_CACHED")"
    echo ""
    cat "$LATEST_CACHED"
  fi
  exit 1
fi

# ── list mode ──────────────────────────────────────────────────────────────────
if [ "$LIST_MODE" = "1" ]; then
  echo "▸ Available nightly reports on $HOST:"
  ssh $SSH_OPTS "$HOST" "ls -1t /root/nightly/reports/*.md 2>/dev/null | head -20" \
    | sed 's|/root/nightly/reports/||' \
    || echo "  (no reports found)"
  exit 0
fi

# ── determine which report to fetch ───────────────────────────────────────────
if [ -n "$DATE_ARG" ]; then
  REPORT_DATE="$DATE_ARG"
else
  # find the latest report on the box
  REPORT_DATE="$(ssh $SSH_OPTS "$HOST" \
    "ls -1t /root/nightly/reports/*.md 2>/dev/null | head -1 | xargs basename 2>/dev/null | sed 's/\.md//'" \
    2>/dev/null || true)"
fi

if [ -z "$REPORT_DATE" ]; then
  echo "✗ no nightly reports found on $HOST"
  echo "  The nightly engine may not have run yet."
  exit 1
fi

REMOTE_REPORT="/root/nightly/reports/${REPORT_DATE}.md"
LOCAL_REPORT="$LOCAL_DIR/${REPORT_DATE}.md"

# ── fetch report ───────────────────────────────────────────────────────────────
echo "▸ fetching nightly report for $REPORT_DATE from $HOST..."
if ! scp -q $SSH_OPTS "$HOST:$REMOTE_REPORT" "$LOCAL_REPORT" 2>/dev/null; then
  echo "✗ report not found: $REMOTE_REPORT"
  echo "  Run --list to see available dates."
  exit 1
fi

echo "  saved → $LOCAL_REPORT"
echo ""
cat "$LOCAL_REPORT"
