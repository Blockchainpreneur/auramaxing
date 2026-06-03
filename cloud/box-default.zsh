# AURAMAXING — box-default delegation (philosophy: NO manual commands; heavy compute on the box).
# Source this from ~/.zshrc. It wraps `claude` so a normal interactive launch runs the SESSION on
# the 16GB Hetzner box (Mac = thin client): node, MCP servers, Python (LightRAG/NLM) and all agent
# compute live on the box. The browser/CDP stays on the Mac and is reachable from the box via a
# reverse SSH tunnel (acode sets up -R 9222 → the Mac's Chrome at localhost:9222).
#
# It stays out of your way: utility commands, piped/non-interactive use, and an unreachable box all
# fall through to LOCAL claude automatically — so nothing breaks when you don't want the box.

# Explicit box command (always available).
acode() { command bash ~/auramaxing/cloud/acode.sh "$@"; }

# Force a local session when you explicitly want one.
claude-local() { command claude "$@"; }

claude() {
  emulate -L zsh
  local box="${AURA_FLEET_HOST:-}"

  # Only auto-delegate a REAL human interactive launch (TTY in+out) with no claude utility flags.
  # Everything else → local `command claude` (so --version, mcp, config, -c/--continue, -r/--resume,
  # update, doctor, piped `... | claude -p`, and any scripted use keep working locally & instantly).
  if [[ -n "$box" && -t 0 && -t 1 ]]; then
    case "${1:-}" in
      ''|-p|/*|./*|../*|'~'*)
        if command ssh -o ConnectTimeout=4 -o BatchMode=yes -o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-%r@%h:%p" -o ControlPersist=600 "$box" true 2>/dev/null; then
          command bash ~/auramaxing/cloud/acode.sh "$@"
          return $?
        else
          print -u2 "▸ AURAMAXING: box ($box) unreachable — running Claude Code LOCALLY this time. (\`acode\` retries the box.)"
        fi
        ;;
    esac
  fi
  command claude "$@"
}

# Force a fresh AURAMAXING env push to the box (after updating helpers/skills/memory).
acode-sync() { command rm -f ~/.auramaxing/.last-box-envsync; command bash ~/auramaxing/cloud/box-sync-env.sh && date +%s > ~/.auramaxing/.last-box-envsync; }
