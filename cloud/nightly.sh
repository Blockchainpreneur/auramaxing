#!/usr/bin/env bash
# AURAMAXING — nightly autonomous loop (runs ON the cloud box via systemd timer).
# Stage A: consolidate the memory store (Kimi).  Stage B: audit a repo → prioritized
# morning suggestions (deterministic collectors + Kimi judgment).  Stage C: sync back.
# Idempotent, flock-guarded, cost-capped. The Kimi layer is GATED on MOONSHOT_API_KEY:
# without it, deterministic collectors still run and a raw report is produced.
#
# Env:  MOONSHOT_API_KEY (optional → enables Kimi judgment)
#       NIGHTLY_REPO (default ~/auramaxing)   NIGHTLY_MEM (optional memory dir)
#       NIGHTLY_MODEL (default kimi-k2.6)      MAC_SYNC (optional rsync target e.g. mac:~/swarm-morning)
set -uo pipefail
RUN="$(date +%Y-%m-%d)"
BASE="$HOME/nightly"; OUT="$BASE/$RUN"; LOGS="$BASE/logs"; mkdir -p "$OUT" "$LOGS"
exec > >(tee -a "$LOGS/$RUN.log") 2>&1
echo "=== AURAMAXING nightly $RUN start $(date -Is) ==="

# no-overlap guard
exec 9>"$BASE/.lock"; if ! flock -n 9; then echo "already running — exit"; exit 0; fi

REPO="${NIGHTLY_REPO:-$HOME/auramaxing}"
MODEL="${NIGHTLY_MODEL:-kimi-k2.6}"
KIMI_ON=0; [ -n "${MOONSHOT_API_KEY:-}" ] && KIMI_ON=1
echo "repo=$REPO model=$MODEL kimi=$([ $KIMI_ON = 1 ] && echo ON || echo OFF-deterministic-only)"

# thin Kimi caller (retry 3x). Reads system prompt $1, user file $2; prints content.
kimi() {
  [ $KIMI_ON = 1 ] || { echo "[kimi skipped — no MOONSHOT_API_KEY]"; return 0; }
  local sys="$1" body; body="$(jq -Rs --arg s "$sys" --arg m "$MODEL" \
    '{model:$m,temperature:0.3,messages:[{role:"system",content:$s},{role:"user",content:.}]}' < "$2")"
  for t in 1 2 3; do
    local r; r="$(curl -sf --max-time 180 https://api.moonshot.ai/v1/chat/completions \
      -H "Authorization: Bearer $MOONSHOT_API_KEY" -H 'content-type: application/json' -d "$body")" \
      && { echo "$r" | jq -r '.choices[0].message.content'; return 0; }
    sleep $((t*5))
  done
  echo "[kimi call failed after 3 tries]"; return 1
}

# ---------- Stage A: memory consolidation ----------
if [ -n "${NIGHTLY_MEM:-}" ] && [ -d "$NIGHTLY_MEM" ]; then
  echo "--- Stage A: memory consolidation ---"
  cat "$NIGHTLY_MEM"/*.md 2>/dev/null > "$OUT/memory-digest.txt" || true
  if [ $KIMI_ON = 1 ] && [ -s "$OUT/memory-digest.txt" ]; then
    kimi 'You are a memory curator. Dedupe, cluster by topic, drop stale entries, and output a clean ordered index + one-line summary per cluster. PRESERVE every unique decision/fact verbatim — never lose information. Markdown only.' \
      "$OUT/memory-digest.txt" > "$OUT/MEMORY.consolidated.md"
    [ -s "$OUT/MEMORY.consolidated.md" ] && cp "$NIGHTLY_MEM/MEMORY.md" "$OUT/MEMORY.$RUN.bak" 2>/dev/null || true
    echo "memory consolidated → $OUT/MEMORY.consolidated.md (review before swapping into $NIGHTLY_MEM)"
  fi
else
  echo "--- Stage A: skipped (no NIGHTLY_MEM dir) ---"
fi

# ---------- Stage B: repo audit (deterministic collectors → Kimi prioritizer) ----------
echo "--- Stage B: repo audit ($REPO) ---"
{ echo "## TODO/FIXME/HACK"; grep -rnE 'TODO|FIXME|HACK|XXX' "$REPO" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' --include='*.sh' --include='*.md' \
    2>/dev/null | grep -v node_modules | head -400; } > "$OUT/raw-todos.txt" || true
( cd "$REPO" && git log --since='1 day ago' --stat 2>/dev/null ) > "$OUT/raw-churn.txt" || true
( cd "$REPO" && command -v osv-scanner >/dev/null && osv-scanner --format json . 2>/dev/null ) > "$OUT/raw-vulns.json" || true
[ -f "$REPO/package.json" ] && ( cd "$REPO" && npm audit --json 2>/dev/null ) > "$OUT/raw-npm.json" || true
echo "collectors done: $(wc -l < "$OUT/raw-todos.txt" 2>/dev/null||echo 0) todo-hits, churn $(wc -l < "$OUT/raw-churn.txt" 2>/dev/null||echo 0) lines"

cat "$OUT"/raw-*.{txt,json} 2>/dev/null > "$OUT/audit-input.txt" || true
if [ $KIMI_ON = 1 ] && [ -s "$OUT/audit-input.txt" ]; then
  kimi 'You are a staff engineer doing a morning triage. From these TODOs, git churn, and vuln scans, produce a PRIORITIZED suggestions list: P0 security, P1 correctness/bugs, P2 cleanup/debt. Each item: file:line · why it matters · concrete suggested fix · rough effort (S/M/L). Be specific and cite evidence. Markdown only.' \
    "$OUT/audit-input.txt" > "$OUT/MORNING-SUGGESTIONS.md"
  echo "morning suggestions → $OUT/MORNING-SUGGESTIONS.md"
else
  { echo "# MORNING SUGGESTIONS ($RUN) — deterministic-only (no Kimi key)";
    echo; echo "## TODO/FIXME"; head -40 "$OUT/raw-todos.txt" 2>/dev/null;
    echo; echo "## Recent churn"; head -20 "$OUT/raw-churn.txt" 2>/dev/null; } > "$OUT/MORNING-SUGGESTIONS.md"
  echo "wrote deterministic-only report (add MOONSHOT_API_KEY for Kimi prioritization)"
fi

# ---------- Stage C: sync back ----------
if [ -n "${MAC_SYNC:-}" ]; then
  rsync -az --partial "$OUT/" "$MAC_SYNC/$RUN/" 2>/dev/null \
    && echo "synced report → $MAC_SYNC/$RUN/" \
    || echo "Mac offline — report staged at $OUT (syncs next reachable run)"
fi
echo "=== nightly $RUN done $(date -Is) ==="
