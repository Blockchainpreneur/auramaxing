#!/bin/bash
# ram-manager.sh — Keeps free RAM above threshold for Ruflo agents
THRESHOLD=3
CHECK_INTERVAL=120

while true; do
  FREE_PCT=$(python3 -c "
import subprocess, re
out = subprocess.check_output(['vm_stat']).decode()
pages_free = int(re.search(r'Pages free:\s+(\d+)', out).group(1))
pages_total = int(subprocess.check_output(['sysctl','-n','hw.memsize']).decode()) // 4096
print(round(pages_free / pages_total * 100, 1))
" 2>/dev/null || echo "10")

  if (( $(echo "$FREE_PCT < $THRESHOLD" | bc -l) )); then
    sudo purge 2>/dev/null || true
    echo "[ram-manager] Purged at $(date '+%H:%M:%S') — was ${FREE_PCT}% free"
  fi

  sleep $CHECK_INTERVAL
done
