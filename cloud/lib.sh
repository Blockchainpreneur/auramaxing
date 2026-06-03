#!/usr/bin/env bash
# AURAMAXING cloud — shared library. Sourced by acode.sh / box-sync-env.sh / fleet.sh.
# Single source of truth for SSH options, rsync excludes, MCP configs, and reachability —
# so they can't drift across scripts. Keep POSIX-bash; no side effects on source.

# Base SSH options used everywhere: trust-on-first-use (MITM protection on key change),
# never hang on a prompt, bounded connect.
AURA_SSH_BASE="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"

# Warm, MULTIPLEXED connection for sequential aux calls (reachability, env-check, rsync): one
# shared master reused across calls → near-instant relaunch. NOT for parallel work.
AURA_SSH_OPTS="$AURA_SSH_BASE -o ControlMaster=auto -o ControlPath=$HOME/.ssh/cm-%r@%h:%p -o ControlPersist=600"

# Own, NON-multiplexed connection. Use for (a) the interactive session that carries the -R tunnel
# (adding -R to an existing master is unreliable across OpenSSH versions), and (b) fleet's parallel
# agents (ControlMaster would serialize them over one connection, killing the parallelism).
AURA_SESSION_SSH="$AURA_SSH_BASE -o ControlPath=none"

# rsync excludes shared by every project/env sync (build dirs, vcs, caches).
AURA_RSYNC_EXCLUDES=(--exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.next'
                     --exclude 'target' --exclude '.venv' --exclude '__pycache__')

# MCP configs written to the box. Empty = headless one-shot (compute only, RAM-light).
# Browser = interactive session: chrome-devtools pointed at the -R-tunneled Mac Chrome.
AURA_EMPTY_MCP='{"mcpServers":{}}'
AURA_BROWSER_MCP='{"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@1.1.0","--browserUrl","http://127.0.0.1:9222"]}}}'

# aura_box_reachable HOST — true if the box answers over the warm connection.
aura_box_reachable() { ssh $AURA_SSH_OPTS "$1" true 2>/dev/null; }

# aura_box_has_mac_chrome HOST — true if the box can already reach the Mac's CDP Chrome (a live
# tunnel still serves :9222), so callers can skip re-binding -R and avoid the "forwarding failed" warn.
aura_box_has_mac_chrome() { ssh $AURA_SSH_OPTS "$1" 'curl -s --max-time 2 http://localhost:9222/json/version >/dev/null 2>&1'; }
