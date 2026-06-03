#!/usr/bin/env bash
# AURAMAXING cloud — shared library. Sourced by acode.sh / box-sync-env.sh / fleet.sh.
# Single source of truth for SSH options, rsync excludes, MCP configs, and reachability —
# so they can't drift across scripts. Keep POSIX-bash; no side effects on source.

# Base SSH options used everywhere: trust-on-first-use (MITM protection on key change), never hang
# on a prompt, bounded connect, AND keepalives — ServerAlive probes every 15s (×4 = 60s grace) stop
# NAT/firewall/idle from resetting a long interactive session ("Connection reset by peer" / "Broken
# pipe"); TCPKeepAlive adds OS-level liveness. This is the resilience floor for every connection.
# shellcheck disable=SC2034  # the AURA_* vars below are consumed by the scripts that SOURCE this lib (acode/fleet/swarm/box-sync-env), not here
AURA_SSH_BASE="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o TCPKeepAlive=yes"

# Warm, MULTIPLEXED connection for sequential aux calls (reachability, env-check, rsync): one
# shared master reused across calls → near-instant relaunch. NOT for parallel work.
AURA_SSH_OPTS="$AURA_SSH_BASE -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-%r@%h:%p -o ControlPersist=600"

# Own, NON-multiplexed connection. Use for (a) the interactive session that carries the -R tunnel
# (adding -R to an existing master is unreliable across OpenSSH versions), and (b) fleet's parallel
# agents (ControlMaster would serialize them over one connection, killing the parallelism).
AURA_SESSION_SSH="$AURA_SSH_BASE -o ControlPath=none"

# rsync excludes shared by every project/env sync (build dirs, vcs, caches).
AURA_RSYNC_EXCLUDES=(--exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next'
                     --exclude 'target' --exclude '.venv' --exclude '__pycache__'
                     --exclude '.fleet-backup' --exclude 'fleet-results' --exclude 'swarm-results')

# MCP configs written to the box. Empty = headless one-shot (compute only, RAM-light).
# Browser = interactive session: chrome-devtools pointed at the -R-tunneled Mac Chrome.
AURA_EMPTY_MCP='{"mcpServers":{}}'
AURA_BROWSER_MCP='{"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@1.1.0","--browserUrl","http://127.0.0.1:9222"]}}}'

# aura_box_reachable HOST — true if the box answers over the warm connection.
aura_box_reachable() { ssh $AURA_SSH_OPTS "$1" true 2>/dev/null; }

# aura_box_has_mac_chrome HOST — true if the box can already reach the Mac's CDP Chrome (a live
# tunnel still serves :9222), so callers can skip re-binding -R and avoid the "forwarding failed" warn.
aura_box_has_mac_chrome() { ssh $AURA_SSH_OPTS "$1" 'curl -s --max-time 2 http://localhost:9222/json/version >/dev/null 2>&1'; }

# aura_safe_name PATH — a filesystem/SSH-safe remote-workspace name derived from a project PATH.
# Replaces every char outside [A-Za-z0-9._-] with '_' (so spaces/quotes/metachars can't split or
# inject an unquoted ~/$REMOTE on the box) and appends a cksum of the FULL path so two different
# projects that share a basename never collide. Single source of truth for acode/fleet/swarm.
aura_safe_name() {
  local base; base="$(basename "$1" | tr -c 'A-Za-z0-9._-' '_')"
  printf '%s-%s' "$base" "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
}

# aura_mutagen_name PREFIX PATH — a mutagen-safe session name. mutagen allows ONLY [A-Za-z0-9-]
# (no '_' or '.'), so we never derive it from the basename — PREFIX + a cksum of the path.
aura_mutagen_name() {
  printf '%s-%s' "$1" "$(printf '%s' "$2" | cksum | cut -d' ' -f1)"
}

# aura_run CMD... — execute CMD, or just print it when DRY_RUN=1. Lets the smoke test exercise a
# script's planning/arg-parsing with ZERO box/network/filesystem side effects.
aura_run() {
  if [ "${DRY_RUN:-0}" = "1" ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

# aura_require_int LABEL VALUE — abort unless VALUE is a non-negative integer. Guards numeric knobs
# (SWARM_N/timeouts/retries) that get interpolated RAW into remote shell strings.
aura_require_int() { case "$2" in ''|*[!0-9]*) echo "✗ $1 must be a non-negative integer, got: '$2'" >&2; exit 2 ;; esac; }
# aura_require_posint LABEL VALUE — as aura_require_int but ≥ 1 (e.g. FLEET_N=0 would infinite-loop the throttle).
aura_require_posint() { aura_require_int "$1" "$2"; [ "$2" -ge 1 ] || { echo "✗ $1 must be an integer ≥ 1, got: '$2'" >&2; exit 2; }; }
# aura_require_mem LABEL VALUE — abort unless VALUE is a well-formed memory limit: digits + optional K/M/G.
aura_require_mem() { printf '%s' "$2" | grep -qE '^[0-9]+[KMGkmg]?$' || { echo "✗ $1 must look like 3G/512M, got: '$2'" >&2; exit 2 ;}; }
# aura_require_host VALUE — reject an AURA_FLEET_HOST ssh could misread as an option (leading '-') or with spaces.
aura_require_host() { case "$1" in ''|-*|*[[:space:]]*) echo "✗ AURA_FLEET_HOST unsafe/empty: '$1' (want user@host, no leading '-'/spaces)" >&2; exit 2 ;; esac; }
