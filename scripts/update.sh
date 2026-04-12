#!/bin/bash
# AURAMAXING — Update script
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "🔄 Updating AURAMAXING..."

cd "$REPO_DIR"
git pull origin main

# Dynamic nvm path — no hardcoded versions
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
_NVM_VER=$(cat "$NVM_DIR/alias/default" 2>/dev/null | tr -d '[:space:]' | sed 's/^v//')
[ -n "$_NVM_VER" ] && export PATH="$NVM_DIR/versions/node/v${_NVM_VER}/bin:$PATH"
export PATH="/usr/local/bin:$PATH"

# Re-run installer to sync hooks, helpers, CLAUDE.md
bash "$REPO_DIR/install.sh"

echo "✅ AURAMAXING updated successfully."
