#!/usr/bin/env bash
# auramaxing-update-check — periodic version check, modeled after gstack.
#
# Output (one line, or nothing):
#   UPGRADE_AVAILABLE <old> <new>   — remote VERSION differs from local
#   (nothing)                       — up to date, snoozed, or check skipped
#
# Called by SessionStart hook and rational-router. Non-blocking.
set -euo pipefail

CM_DIR="${CM_DIR:-$HOME/auramaxing}"
STATE_DIR="$HOME/.auramaxing"
CACHE_FILE="$STATE_DIR/last-update-check"
SNOOZE_FILE="$STATE_DIR/update-snoozed"
VERSION_FILE="$CM_DIR/VERSION"
REMOTE_URL="https://raw.githubusercontent.com/Blockchainpreneur/AURAMAXING/main/VERSION"

mkdir -p "$STATE_DIR"

# ── Snooze check ──────────────────────────────────────────────
# Snooze file format: <version> <level> <epoch>
# Levels: 1=24h, 2=48h, 3+=7d. New version resets snooze.
check_snooze() {
  local remote_ver="$1"
  [ -f "$SNOOZE_FILE" ] || return 1

  local sv sl se
  sv="$(awk '{print $1}' "$SNOOZE_FILE" 2>/dev/null || true)"
  sl="$(awk '{print $2}' "$SNOOZE_FILE" 2>/dev/null || true)"
  se="$(awk '{print $3}' "$SNOOZE_FILE" 2>/dev/null || true)"

  [ -n "$sv" ] && [ -n "$sl" ] && [ -n "$se" ] || return 1
  case "$sl" in *[!0-9]*) return 1 ;; esac
  case "$se" in *[!0-9]*) return 1 ;; esac

  # New version resets snooze
  [ "$sv" = "$remote_ver" ] || return 1

  local dur
  case "$sl" in
    1) dur=86400 ;;    # 24h
    2) dur=172800 ;;   # 48h
    *) dur=604800 ;;   # 7 days
  esac

  local now expires
  now="$(date +%s)"
  expires=$(( se + dur ))
  [ "$now" -lt "$expires" ]
}

# ── Read local version ────────────────────────────────────────
LOCAL=""
[ -f "$VERSION_FILE" ] && LOCAL="$(cat "$VERSION_FILE" 2>/dev/null | tr -d '[:space:]')"
[ -z "$LOCAL" ] && exit 0

# ── Check cache freshness ────────────────────────────────────
# UP_TO_DATE: 60 min TTL (detect new releases quickly)
# UPGRADE_AVAILABLE: 720 min TTL (keep showing banner)
if [ -f "$CACHE_FILE" ]; then
  CACHED="$(cat "$CACHE_FILE" 2>/dev/null || true)"
  case "$CACHED" in
    UP_TO_DATE*)        CACHE_TTL=60 ;;
    UPGRADE_AVAILABLE*) CACHE_TTL=720 ;;
    *)                  CACHE_TTL=0 ;;
  esac

  STALE=$(find "$CACHE_FILE" -mmin +$CACHE_TTL 2>/dev/null || true)
  if [ -z "$STALE" ] && [ "$CACHE_TTL" -gt 0 ]; then
    case "$CACHED" in
      UP_TO_DATE*)
        CACHED_VER="$(echo "$CACHED" | awk '{print $2}')"
        [ "$CACHED_VER" = "$LOCAL" ] && exit 0
        ;;
      UPGRADE_AVAILABLE*)
        CACHED_OLD="$(echo "$CACHED" | awk '{print $2}')"
        if [ "$CACHED_OLD" = "$LOCAL" ]; then
          CACHED_NEW="$(echo "$CACHED" | awk '{print $3}')"
          check_snooze "$CACHED_NEW" && exit 0
          echo "$CACHED"
          exit 0
        fi
        ;;
    esac
  fi
fi

# ── Fetch remote version (slow path) ─────────────────────────
REMOTE=""
REMOTE="$(curl -sf --max-time 4 "$REMOTE_URL" 2>/dev/null || true)"
REMOTE="$(echo "$REMOTE" | tr -d '[:space:]')"

# Validate: must look like a version number
if ! echo "$REMOTE" | grep -qE '^[0-9]+\.[0-9.]+$'; then
  echo "UP_TO_DATE $LOCAL" > "$CACHE_FILE"
  exit 0
fi

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "UP_TO_DATE $LOCAL" > "$CACHE_FILE"
  exit 0
fi

echo "UPGRADE_AVAILABLE $LOCAL $REMOTE" > "$CACHE_FILE"
check_snooze "$REMOTE" && exit 0
echo "UPGRADE_AVAILABLE $LOCAL $REMOTE"
