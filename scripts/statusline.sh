#!/bin/bash
input=$(cat)

MODEL_ID=$(echo "$input" | jq -r '.model.id // "?"' 2>/dev/null)
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"' 2>/dev/null | sed 's/Claude //;s/ (.*//')

# AURAMAXING: Recompute context % against the model's REAL window.
# Claude Code's runtime sometimes reports context_window_size=200000 even for
# 1M-window models (e.g. Opus 4.7) because its model catalog hasn't caught up.
# We override with our own map and recompute from current_usage tokens.
case "$MODEL_ID" in
  claude-opus-4-7|claude-opus-4-6|claude-sonnet-4-6) REAL_WINDOW=1000000 ;;
  claude-haiku-4-5*|claude-sonnet-4-5*|claude-opus-4-5*|claude-opus-4-1*) REAL_WINDOW=200000 ;;
  *) REAL_WINDOW=$(echo "$input" | jq -r '.context_window.context_window_size // 200000' 2>/dev/null) ;;
esac

# Real input tokens = input + cache_creation + cache_read (matches Claude Code formula)
INPUT_TOK=$(echo "$input" | jq -r '(.context_window.current_usage.input_tokens // 0) + (.context_window.current_usage.cache_creation_input_tokens // 0) + (.context_window.current_usage.cache_read_input_tokens // 0)' 2>/dev/null)

if [ -z "$INPUT_TOK" ] || [ "$INPUT_TOK" = "null" ] || [ "$INPUT_TOK" = "0" ]; then
  PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' 2>/dev/null | cut -d. -f1)
else
  PCT=$(awk "BEGIN { printf \"%d\", ($INPUT_TOK / $REAL_WINDOW) * 100 }")
fi

TOK_K=$(awk "BEGIN { printf \"%.0f\", $INPUT_TOK / 1000 }")
WIN_LBL=$(awk "BEGIN { if ($REAL_WINDOW >= 1000000) printf \"%.0fM\", $REAL_WINDOW / 1000000; else printf \"%.0fk\", $REAL_WINDOW / 1000 }")

# Persist for UserPromptSubmit hooks (uses CORRECTED percentage)
echo "{\"pct\":$PCT,\"ts\":$(date +%s),\"model\":\"$MODEL_ID\",\"window\":$REAL_WINDOW,\"input_tokens\":$INPUT_TOK}" > "$HOME/.auramaxing/last-ctx.json" 2>/dev/null

API_COST=$(printf "%.2f" "$(echo "$input" | jq -r '.cost.total_cost_usd // 0' 2>/dev/null)" 2>/dev/null || echo "0.00")
CWD=$(echo "$input" | jq -r '.cwd // "?"' 2>/dev/null)
DIR=$(basename "$CWD")
R5H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null | cut -d. -f1)

# Your real cost: $200/mo ÷ ~1.35B tokens = ~0.0068x of API cost
YOUR_COST=$(echo "$API_COST" | awk '{printf "%.2f", $1 * 0.007}' 2>/dev/null || echo "0.00")

if [ "$PCT" -ge 80 ]; then SC="\033[31m"; elif [ "$PCT" -ge 60 ]; then SC="\033[33m"; else SC="\033[32m"; fi

RATE=""
if [ -n "$R5H" ]; then
  if [ "$R5H" -ge 80 ]; then RC="\033[31m"; elif [ "$R5H" -ge 60 ]; then RC="\033[33m"; else RC="\033[32m"; fi
  RATE=" ${RC}\033[1m${R5H}%%w\033[0m"
fi

printf "\033[35m\033[1mMAXING\033[0m \033[36m%s\033[0m ${SC}\033[1m${PCT}%%ctx\033[0m \033[2m(${TOK_K}k/${WIN_LBL})\033[0m${RATE} \033[32m\$${YOUR_COST}\033[0m \033[2mvs\033[0m \033[31m\$${API_COST}\033[0m \033[2m${DIR}\033[0m\n" "$MODEL"
