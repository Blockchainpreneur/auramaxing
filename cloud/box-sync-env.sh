#!/usr/bin/env bash
# AURAMAXING — replicate the Mac's AURAMAXING environment onto the box so a box session is
# imperceptible from a Mac session: autopilot (hooks + helpers + CLAUDE.md + skills) + memory +
# learnings + LightRAG workspace. EXCLUDES: the box's own auth (~/.claude.json, never touched),
# the 8.6 GB Chrome profile, logs, dead-letters, and session transcripts. Fast/incremental (rsync).
# Called by acode (TTL-gated). Safe to run standalone:  bash box-sync-env.sh
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib.sh"   # script-relative → works at any install path
HOST="$(aura_resolve_host)" || { aura_box_unconfigured; exit 1; }   # beacon/AURA_FLEET_HOST → never the burned box
R() { rsync -az -e "ssh $AURA_SSH_OPTS" "$@" 2>/dev/null; }

echo "▸ syncing AURAMAXING env → box (autopilot + memory; one-time-ish, then incremental)…"
ssh $AURA_SSH_OPTS "$HOST" 'mkdir -p ~/.claude/helpers ~/.claude/skills ~/.auramaxing ~/.claude/projects'

# 1) The repo: fixed helpers/scripts/skills/docs (minus heavy/local/build artifacts)
R --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'swarm-results' --exclude 'fleet-results' \
  --exclude '*.log' --exclude 'tui/.claude-flow' \
  "$HOME/auramaxing/" "$HOST:~/auramaxing/"

# 2) Autopilot wiring → ~/.claude/. NEVER sync ~/.claude.json (that is the box's own auth/OAuth).
# These are CRITICAL (settings.json + the statusline it references) — a silent failure here is
# exactly what made the MAXING footer vanish on box sessions, so warn loudly instead of hiding it.
Rcrit() { R "$1" "$2" || echo "  [box-env] ⚠️  WARN: failed to sync $(basename "$1") to the box — box may be stale"; }
[ -f "$HOME/.claude/settings.json" ] && Rcrit "$HOME/.claude/settings.json" "$HOST:~/.claude/settings.json"
[ -f "$HOME/.claude/CLAUDE.md" ]     && Rcrit "$HOME/.claude/CLAUDE.md"     "$HOST:~/.claude/CLAUDE.md"
# statusLine.command in settings.json points here — without it the box shows no MAXING footer.
if [ -f "$HOME/.claude/statusline.sh" ]; then
  Rcrit "$HOME/.claude/statusline.sh" "$HOST:~/.claude/statusline.sh"
  ssh $AURA_SSH_OPTS "$HOST" 'chmod +x ~/.claude/statusline.sh' 2>/dev/null \
    || echo "  [box-env] ⚠️  WARN: could not chmod +x statusline.sh on the box"
fi
R --delete "$HOME/.claude/helpers/" "$HOST:~/.claude/helpers/"
R --delete "$HOME/.claude/skills/"  "$HOST:~/.claude/skills/"

# 3) Memory + learnings + retrieval workspace (home-relative; AURAMAXING hooks read these via homedir()).
#    Explicit small dirs only — never the 8.6 GB chrome-cdp-profile or logs/dead-letters.
for d in memory learnings contexts prompt-cache lightrag-workspace nlm-cache; do
  [ -d "$HOME/.auramaxing/$d" ] && R "$HOME/.auramaxing/$d" "$HOST:~/.auramaxing/"
done
# notebook id + small config files (NOT logs/profile)
for f in nlm-notebook-id nlm-notebooks.json; do
  [ -f "$HOME/.auramaxing/$f" ] && R "$HOME/.auramaxing/$f" "$HOST:~/.auramaxing/$f"
done

# 4) Native project auto-memory (MEMORY.md + project_*.md) — keep the Mac slug so the index travels.
if [ -d "$HOME/.claude/projects/-Users-macbook/memory" ]; then
  ssh $AURA_SSH_OPTS "$HOST" 'mkdir -p ~/.claude/projects/-Users-macbook/memory'
  R "$HOME/.claude/projects/-Users-macbook/memory/" "$HOST:~/.claude/projects/-Users-macbook/memory/"
fi

# 5) NotebookLM auth (Google session storage_state) so NLM deep-recall works 1:1 on the box.
#    Sensitive — rsync only, NEVER committed to git.
if [ -d "$HOME/.notebooklm" ]; then
  ssh $AURA_SSH_OPTS "$HOST" 'mkdir -p ~/.notebooklm'
  R "$HOME/.notebooklm/" "$HOST:~/.notebooklm/"
fi

# 6) Ensure the box has the memory-stack Python deps (LightRAG semantic search via
#    sentence-transformers + NotebookLM via notebooklm-py) so memory is 1:1 with the Mac.
#    Idempotent: installs ONLY if missing (e.g. after a fresh box reprovision). One-time ~few min.
ssh $AURA_SSH_OPTS "$HOST" 'python3 -c "import sentence_transformers, notebooklm" 2>/dev/null || { \
  command -v pip3 >/dev/null 2>&1 || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pip python3-numpy; } >/dev/null 2>&1; \
  python3 -m pip install --user --break-system-packages -q sentence-transformers notebooklm-py==0.3.4 >/dev/null 2>&1; \
  python3 -c "import sentence_transformers" 2>/dev/null && echo "  [box-env] memory deps installed" || echo "  [box-env] WARN: memory deps install failed"; }'

# 7) Ensure tmux (drop-resilient sessions) + jq (the MAXING statusline footer parses its JSON with jq).
ssh $AURA_SSH_OPTS "$HOST" 'for p in tmux jq; do command -v $p >/dev/null 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $p >/dev/null 2>&1; }; done'

echo "▸ env synced (autopilot + memory live on box)."
