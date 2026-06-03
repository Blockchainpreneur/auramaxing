#!/usr/bin/env bash
# AURAMAXING — Ubuntu cloud-box one-shot provisioner (works on any x86/ARM Ubuntu: Hetzner, Oracle,
# Hetzner cpx42 is the current production box). Turns a fresh box into the AURAMAXING agent-fleet
# node: Node + Claude Code + gh + git + AURAMAXING. Idempotent — safe to re-run. Run ON THE BOX:
#   bash provision.sh                 # latest claude-code
#   CLAUDE_VERSION=2.1.161 bash provision.sh   # pin a specific claude-code for reproducible builds
set -euo pipefail

log() { printf '\033[36m▸ %s\033[0m\n' "$*"; }

log "1/6 system packages"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential rsync jq unzip

log "2/6 Node.js (nvm, arch-agnostic — x86 or ARM)"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
fi
. "$HOME/.nvm/nvm.sh" 2>/dev/null || true
node --version

log "3/6 Claude Code CLI (npm — no curl|bash)"
# CLAUDE_VERSION pins for reproducibility; defaults to latest. Echoes the resolved version.
npm i -g "@anthropic-ai/claude-code@${CLAUDE_VERSION:-latest}"
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
# Baseline MAXING statusline footer so a freshly-provisioned box isn't bare before the Mac's
# box-sync-env.sh runs (which later overwrites it with the Mac's exact copy + settings.json/CLAUDE.md).
[ -f "$AUR/scripts/statusline.sh" ] && { cp -f "$AUR/scripts/statusline.sh" "$HOME/.claude/statusline.sh"; chmod +x "$HOME/.claude/statusline.sh"; }

log "6/6 done — agent-fleet node ready"
echo
echo "NEXT (one-time, yours): authenticate Claude Code to your Max plan:"
echo "    claude login        # opens a device-code URL; paste the code from your laptop browser"
echo "Then test:  claude -p 'print hello from the cloud box'"
