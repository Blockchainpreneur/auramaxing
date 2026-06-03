# AURAMAXING — cloud delegation (CORRECTED philosophy, 2026-06-03).
#
# Your interactive Claude Code session runs LOCALLY on the Mac — so it keeps NATIVE, full access to
# ALL your project files, your CDP Chrome, and the MAXING statusline footer. Only heavy COMPUTE
# (parallel agent fleets, batch refactors, indexing) is delegated to the 16 GB cloud box, where the
# project is mirrored per-job and the results come back. The box NEVER hosts your session.
#
# Why this replaced the old "run the whole session on the box" default: hosting the session remotely
# meant the box could only ever see ONE synced project dir (or an empty workspace when launched from
# $HOME), the browser had to be reverse-tunneled, and the statusline depended on a fragile box
# env-sync. Running locally + offloading only compute is what you actually want:
#   "delega solo lo que requiere cómputo; navegador y archivos locales desde mi Mac."
#
# Source this from ~/.zshrc.

# `claude` is intentionally NOT wrapped — a normal launch is a fully native LOCAL session
# (full files + CDP browser + MAXING statusline, all on your Mac).

# Delegate a parallel agent FLEET to the box (project stays local; diffs land in ./fleet-results/).
#   fleet <project-dir> "subtask one" "subtask two" ...
fleet() { command bash ~/auramaxing/cloud/fleet.sh "$@"; }

# Drain a task BACKLOG through a bounded worker pool on the box (one prompt per line, N-wide).
#   swarm <project-dir> <tasks-file>
swarm() { command bash ~/auramaxing/cloud/swarm.sh "$@"; }

# Explicit opt-in: run a WHOLE interactive session ON the box (16 GB TUI). Use ONLY when you
# deliberately want the box as the host (e.g. away from your Mac, or a RAM-bound interactive job) —
# it mirrors one project dir and reverse-tunnels your Chrome. For normal work just run `claude`.
acode() { command bash ~/auramaxing/cloud/acode.sh "$@"; }

# Force-refresh the box's AURAMAXING env (autopilot + memory + statusline) after local updates.
acode-sync() { command rm -f ~/.auramaxing/.last-box-envsync; command bash ~/auramaxing/cloud/box-sync-env.sh && date +%s > ~/.auramaxing/.last-box-envsync; }

# Back-compat shim: some muscle memory / scripts still call `claude-local`. It's plain local claude now.
claude-local() { command claude "$@"; }
