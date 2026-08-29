#!/usr/bin/env bash
# auramaxing-update-check — periodic version check, modeled after gstack.
#
# Output (one line, or nothing):
#   UPGRADE_AVAILABLE <old> <new>   — remote VERSION differs from local
#   (nothing)                       — up to date, snoozed, or check skipped
#
# Called by SessionStart hook and rational-router. Non-blocking.
#
# Flags:
#   --write-state   also write ~/.auramaxing/update-state.json atomically
#                   (used by update-gate.mjs for the mandatory update gate).
#                   Stdout contract is UNCHANGED — callers that don't pass
#                   this flag see identical behavior.
set -euo pipefail

AX_DIR="${AX_DIR:-$HOME/auramaxing}"
STATE_DIR="$HOME/.auramaxing"
CACHE_FILE="$STATE_DIR/last-update-check"
SNOOZE_FILE="$STATE_DIR/update-snoozed"
VERSION_FILE="$AX_DIR/VERSION"
REMOTE_URL="https://raw.githubusercontent.com/Blockchainpreneur/AURAMAXING/main/VERSION"

# Parse --write-state flag (does not affect stdout contract)
WRITE_STATE=0
for _arg in "$@"; do
  case "$_arg" in --write-state) WRITE_STATE=1 ;; esac
done

# ── write_state_file <local> <remote> ─────────────────────────
# Writes ~/.auramaxing/update-state.json atomically (tmp+mv).
# Called after the result is known (both slow and cache paths).
write_state_file() {
  local _local="$1" _remote="$2"
  [ "$WRITE_STATE" -eq 0 ] && return 0
  local _now _tmp _state_file
  _now="$(date +%s)000"   # epoch_ms (seconds * 1000; no sub-second needed)
  _state_file="$STATE_DIR/update-state.json"
  _tmp="$STATE_DIR/update-state.json.tmp.$$"
  printf '{"checkedAt":%s,"local":"%s","remote":"%s"}\n' \
    "$_now" "$_local" "$_remote" > "$_tmp" \
    && mv -f "$_tmp" "$_state_file" \
    || rm -f "$_tmp" 2>/dev/null || true
}

mkdir -p "$STATE_DIR"

# ── Censo de instalaciones (fire-and-forget) ──────────────────
# Este script corre en el SessionStart de CADA instalación viva. Es el ÚNICO
# punto donde una instalación ya existente puede darse de alta sin reinstalar
# nada: por eso el ping vive aquí y no solo en install.sh.
# Contrato: background, salida descartada, nunca toca stdout (el contrato de
# este script es una sola línea UPGRADE_AVAILABLE) y nunca falla el script.
if [ -z "${AURA_NO_TELEMETRY:-}" ] && [ ! -f "$STATE_DIR/no-telemetry" ] \
   && command -v node >/dev/null 2>&1 && [ -f "$AX_DIR/helpers/install-ping.mjs" ]; then
  ( node "$AX_DIR/helpers/install-ping.mjs" >/dev/null 2>&1 & ) 2>/dev/null || true
fi

# ── Snooze check ──────────────────────────────────────────────
# Snooze file format: <version> <level> <epoch>
# Levels: 1=24h, 2=48h, 3+=7d. New version resets snooze.
check_snooze() {
  local remote_ver="$1"
  # v1.24.0: updates are MANDATORY — there is no "not now". Snoozing is disabled,
  # otherwise a legacy snooze file would hide the update window while the gate
  # keeps blocking prompts (blocked with no explanation).
  rm -f "$SNOOZE_FILE" 2>/dev/null || true
  return 1
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

# ── ver_gt <a> <b> — true (0) iff version a > b, numeric per-segment ──────
# String inequality is NOT a version comparison: "1.10.0" != "1.9.0" used to
# emit UPGRADE_AVAILABLE telling the user to "upgrade" 1.10.0 → 1.9.0
# (lexicographic 1.10.0 < 1.9.0). Found live 2026-06-11.
ver_gt() {
  local IFS=.
  # shellcheck disable=SC2206
  local -a a=($1) b=($2)
  local i av bv
  for i in 0 1 2 3; do
    av="${a[i]:-0}"; bv="${b[i]:-0}"
    case "$av" in *[!0-9]*|'') av=0 ;; esac
    case "$bv" in *[!0-9]*|'') bv=0 ;; esac
    if [ "$av" -gt "$bv" ]; then return 0; fi
    if [ "$av" -lt "$bv" ]; then return 1; fi
  done
  return 1
}

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
        if [ "$CACHED_VER" = "$LOCAL" ]; then
          write_state_file "$LOCAL" "$LOCAL"
          exit 0
        fi
        ;;
      UPGRADE_AVAILABLE*)
        CACHED_OLD="$(echo "$CACHED" | awk '{print $2}')"
        CACHED_NEW="$(echo "$CACHED" | awk '{print $3}')"
        # Re-validate with ver_gt: a poisoned/legacy cache (remote OLDER than
        # local) must never re-serve the banner for its 720-min TTL.
        if [ "$CACHED_OLD" = "$LOCAL" ] && ver_gt "$CACHED_NEW" "$LOCAL"; then
          write_state_file "$LOCAL" "$CACHED_NEW"
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
  write_state_file "$LOCAL" "$LOCAL"
  exit 0
fi

# Upgrade only when remote is STRICTLY NEWER (equal, or local ahead of remote
# — e.g. a release just pushed from this machine — are both up-to-date).
if ! ver_gt "$REMOTE" "$LOCAL"; then
  echo "UP_TO_DATE $LOCAL" > "$CACHE_FILE"
  write_state_file "$LOCAL" "$LOCAL"
  exit 0
fi

echo "UPGRADE_AVAILABLE $LOCAL $REMOTE" > "$CACHE_FILE"
write_state_file "$LOCAL" "$REMOTE"
check_snooze "$REMOTE" && exit 0
echo "UPGRADE_AVAILABLE $LOCAL $REMOTE"
