#!/usr/bin/env bash
# AURAMAXING — Oracle Cloud (Ubuntu ARM / Always-Free) one-shot provisioner.
# Turns a fresh box into the AURAMAXING agent-fleet node: Node + Claude Code + gh + git + AURAMAXING.
# Idempotent — safe to re-run. Run ON THE BOX:  bash provision.sh
set -euo pipefail

log() { printf '\033[36m▸ %s\033[0m\n' "$*"; }

log "1/6 system packages"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential rsync jq unzip

log "2/6 Node.js (nvm, ARM-native)"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
fi
. "$HOME/.nvm/nvm.sh" 2>/dev/null || true
node --version

log "3/6 Claude Code CLI (npm — no curl|bash)"
npm i -g @anthropic-ai/claude-code
claude --version

log "4/6 GitHub CLI"
if ! command -v gh >/dev/null 2>&1; then
  (type -p wget >/dev/null || sudo apt-get install -y wget)
  sudo mkdir -p -m 755 /etc/apt/keyrings
  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y gh
fi

log "5/6 AURAMAXING repo + helpers/skills"
AUR="$HOME/auramaxing"
if [ -d "$AUR/.git" ]; then git -C "$AUR" pull --ff-only || true
else git clone https://github.com/Blockchainpreneur/auramaxing.git "$AUR"; fi
mkdir -p "$HOME/.claude/helpers" "$HOME/.claude/skills" "$HOME/fleet"
# mirror helpers + skills so the box behaves like the Mac
[ -d "$AUR/helpers" ] && cp -f "$AUR"/helpers/*.mjs "$HOME/.claude/helpers/" 2>/dev/null || true
[ -d "$AUR/skills" ] && cp -rf "$AUR"/skills/* "$HOME/.claude/skills/" 2>/dev/null || true

log "6/6 done — agent-fleet node ready"
echo
echo "NEXT (one-time, yours): authenticate Claude Code to your Max plan:"
echo "    claude login        # opens a device-code URL; paste the code from your laptop browser"
echo "Then test:  claude -p 'print hello from the cloud box'"
