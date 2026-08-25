#!/usr/bin/env bash
# auramaxing-update — pull latest AURAMAXING and re-apply hooks/settings.
#
# Usage:
#   bash ~/auramaxing/scripts/update.sh               # normal update
#   bash ~/auramaxing/scripts/update.sh --force-stash # stash dirty tree first
#
set -euo pipefail

AX_DIR="${AX_DIR:-$HOME/auramaxing}"
STATE_FILE="$HOME/.auramaxing/update-state.json"

# ── Color helpers ──────────────────────────────────────────────────────────
R='\033[0m'; B='\033[1m'; G='\033[32m'; Y='\033[33m'; C='\033[36m'; E='\033[31m'
info()  { echo -e "${C}${B}[update]${R} $*"; }
ok()    { echo -e "${G}${B}[  ok  ]${R} $*"; }
warn()  { echo -e "${Y}${B}[ warn ]${R} $*"; }
err()   { echo -e "${E}${B}[error ]${R} $*" >&2; }

FORCE_STASH=0
for arg in "$@"; do
  case "$arg" in --force-stash) FORCE_STASH=1 ;; esac
done

# ── Check git tree ─────────────────────────────────────────────────────────
cd "$AX_DIR"

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  err "~/auramaxing is not a git repository. Cannot update."
  exit 1
fi

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  if [ "$FORCE_STASH" -eq 1 ]; then
    info "Tree is dirty — stashing local changes..."
    git stash push -m "auramaxing-update-stash-$(date +%s)" || {
      err "git stash failed. Aborting."
      exit 1
    }
    ok "Stash complete. Run 'git stash pop' to restore after update."
  else
    err "Working tree has uncommitted changes."
    err "Run with --force-stash to stash them first:"
    err "  bash ~/auramaxing/scripts/update.sh --force-stash"
    exit 1
  fi
fi

# ── Pull ───────────────────────────────────────────────────────────────────
info "Pulling latest AURAMAXING from upstream..."
if ! git pull --ff-only 2>&1; then
  err "git pull --ff-only failed. Diverged history or network error."
  err "If your local branch has diverged, reconcile manually then re-run."
  exit 1
fi
ok "Pull complete."

# ── Re-apply (idempotent) ──────────────────────────────────────────────────
info "Re-applying hooks and settings (install.sh)..."
if [ ! -f "$AX_DIR/install.sh" ]; then
  err "install.sh not found at $AX_DIR/install.sh. Cannot apply."
  exit 1
fi
bash "$AX_DIR/install.sh" || {
  err "install.sh exited non-zero. Review the output above."
  exit 1
}
ok "Install complete."

# ── Clear update state so gate re-evaluates ───────────────────────────────
if [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  ok "Update state cleared."
fi

# ── Print new version ──────────────────────────────────────────────────────
NEW_VER="$(cat "$AX_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || echo 'unknown')"
echo ""
echo -e "${G}${B}  AURAMAXING updated to v${NEW_VER}${R}"
echo -e "${C}  Prompts are unblocked. Start a fresh Claude Code session.${R}"
echo ""
echo -e "${Y}${B}  ┌─ HEADS-UP ─────────────────────────────────────────────┐${R}"
echo -e "${Y}  │${R}  Updating is MANDATORY: only the latest version        ${Y}│${R}"
echo -e "${Y}  │${R}  is supported - prompts block until you update.        ${Y}│${R}"
echo -e "${Y}  │${R}                                                        ${Y}│${R}"
echo -e "${Y}  │${R}  Continued use of AURAMAXING will become               ${Y}│${R}"
echo -e "${Y}  │${R}  ${B}USD \$1,499 per user / year.${R}                           ${Y}│${R}"
echo -e "${Y}  │${R}  Not charged yet - advance notice only, so the         ${Y}│${R}"
echo -e "${Y}  │${R}  price is no surprise when it takes effect.            ${Y}│${R}"
echo -e "${Y}${B}  └────────────────────────────────────────────────────────┘${R}"
echo ""
