#!/bin/bash
input=$(cat)
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"' 2>/dev/null | sed 's/Claude //;s/ (.*//')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' 2>/dev/null | cut -d. -f1)
API_COST=$(printf "%.2f" "$(echo "$input" | jq -r '.cost.total_cost_usd // 0' 2>/dev/null)" 2>/dev/null || echo "0.00")
CWD=$(echo "$input" | jq -r '.cwd // "?"' 2>/dev/null)
DIR=$(basename "$CWD")
R5H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null | cut -d. -f1)

# Your real cost: $200/mo ÷ ~1.35B tokens = ~0.0068x of API cost
# Simpler: API cost × 0.0068 ≈ your actual token spend on Max
YOUR_COST=$(echo "$API_COST" | awk '{printf "%.2f", $1 * 0.007}' 2>/dev/null || echo "0.00")

if [ "$PCT" -ge 80 ]; then SC="\033[31m"; elif [ "$PCT" -ge 60 ]; then SC="\033[33m"; else SC="\033[32m"; fi

RATE=""
if [ -n "$R5H" ]; then
  if [ "$R5H" -ge 80 ]; then RC="\033[31m"; elif [ "$R5H" -ge 60 ]; then RC="\033[33m"; else RC="\033[32m"; fi
  RATE=" ${RC}\033[1m${R5H}%%w\033[0m"
fi

printf "\033[36m%s\033[0m ${SC}\033[1m${PCT}%%ctx\033[0m${RATE} \033[32m\$${YOUR_COST}\033[0m \033[2mvs\033[0m \033[31m\$${API_COST}\033[0m \033[2m${DIR}\033[0m\n" "$MODEL"
