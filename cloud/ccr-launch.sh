#!/usr/bin/env bash
# AURAMAXING — Claude-first launcher with OSS fallback on limit/error.
# Max can't proxy (ToS), so: try native Claude; if it reports a usage limit or fails,
# relaunch the SAME task through claude-code-router (→ Kimi→DeepSeek→Qwen).
# Usage: ccr-launch.sh "<prompt>"   [extra claude args...]
set -uo pipefail
. "$HOME/.nvm/nvm.sh" 2>/dev/null || true
PROMPT="${1:?usage: ccr-launch.sh <prompt>}"; shift || true
EMPTY_MCP="$HOME/.swarm-empty-mcp.json"; [ -f "$EMPTY_MCP" ] || echo '{"mcpServers":{}}' > "$EMPTY_MCP"
OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT

# 1) try native Claude (Max)
claude -p "$PROMPT" --strict-mcp-config --mcp-config "$EMPTY_MCP" --dangerously-skip-permissions "$@" >"$OUT" 2>&1
rc=$?
if [ $rc -eq 0 ] && ! grep -qiE 'limit reached|usage limit|rate.?limit|429|quota' "$OUT"; then
  cat "$OUT"; echo "[via: claude/max]" >&2; exit 0
fi

# 2) limit/err → fall back through CCR (OSS) if keys present + ccr running
if [ -z "${MOONSHOT_API_KEY:-}${OPENROUTER_API_KEY:-}" ]; then
  echo "[fallback unavailable — no OSS API keys set]" >&2; cat "$OUT"; exit $rc
fi
command -v ccr >/dev/null && (ccr status >/dev/null 2>&1 || ccr start >/dev/null 2>&1 || true)
echo "[claude limited/failed → falling back to OSS via CCR]" >&2
ANTHROPIC_BASE_URL="http://127.0.0.1:3456" ANTHROPIC_AUTH_TOKEN="auramaxing-local" \
  claude -p "$PROMPT" --strict-mcp-config --mcp-config "$EMPTY_MCP" --dangerously-skip-permissions "$@"
