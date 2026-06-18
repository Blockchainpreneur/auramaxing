#!/usr/bin/env bash
# AURAMAXING — REX beacon client.
#
# The NEW cloud box has NO hardcoded IP. It registers itself with a small Vercel-hosted "beacon",
# and the Mac talks to the box THROUGH the beacon. This replaced the old SSH-to-a-fixed-IP model:
# the previous Hetzner box (root@<ip>) had its IP committed to git history, so it is treated as
# BURNED and must never be auto-connected.
#
# Reactivate by configuring two env vars (e.g. synced from Vercel into your shell):
#     export REX_BEACON_URL="https://<your-vercel-beacon>"
#     export REX_BEACON_TOKEN="<token>"
#
# Subcommands:
#     beacon.sh health             — is the beacon up and a box registered?  (GET  $URL/health)
#     beacon.sh resolve            — print the current box host (user@ip)     (GET  $URL/resolve → {"host":"..."})
#     beacon.sh dispatch '<json>'  — POST a job payload; beacon relays to box (POST $URL/dispatch)
#
# Contract (implement these on the Vercel side; override paths via REX_BEACON_*_PATH if yours differ):
#     GET  /health   → 2xx when the beacon is live and a box is online
#     GET  /resolve  → JSON {"host":"user@ip"} of the currently-online box
#     POST /dispatch → accepts a JSON job, returns 2xx
# Auth on every request: Authorization: Bearer $REX_BEACON_TOKEN
#
# Unconfigured (either var unset) → exit 3 with guidance. NEVER contacts any hardcoded host.
set -uo pipefail

URL="${REX_BEACON_URL:-}"
TOKEN="${REX_BEACON_TOKEN:-}"
if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "✗ beacon not configured — set REX_BEACON_URL + REX_BEACON_TOKEN to reactivate box delegation." >&2
  echo "  (The old Hetzner box is decommissioned; its IP was exposed in git history.)" >&2
  exit 3
fi
URL="${URL%/}"   # strip trailing slash

HEALTH_PATH="${REX_BEACON_HEALTH_PATH:-/health}"
RESOLVE_PATH="${REX_BEACON_RESOLVE_PATH:-/resolve}"
DISPATCH_PATH="${REX_BEACON_DISPATCH_PATH:-/dispatch}"

curl_beacon() {
  curl -fsS --max-time "${REX_BEACON_TIMEOUT:-10}" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" "$@"
}

cmd="${1:-health}"; [ $# -gt 0 ] && shift
case "$cmd" in
  health)
    if curl_beacon "$URL$HEALTH_PATH" >/dev/null 2>&1; then echo "✓ beacon up: $URL"; else echo "✗ beacon unreachable: $URL" >&2; exit 1; fi ;;
  resolve)
    # Extract "host":"user@ip" from the JSON without a jq dependency.
    curl_beacon "$URL$RESOLVE_PATH" 2>/dev/null \
      | sed -n 's/.*"host"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 ;;
  dispatch)
    curl_beacon -X POST "$URL$DISPATCH_PATH" -d "${1:-{\}}" ;;
  *)
    echo "usage: beacon.sh {health|resolve|dispatch <json>}" >&2; exit 2 ;;
esac
