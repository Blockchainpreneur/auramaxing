#!/usr/bin/env bash
# AURAMAXING Nightly Engine — idempotent installer.
# Run from the Mac:  bash ~/auramaxing/cloud/nightly-install.sh [--gh-token <pat>]
#
# What it does:
#   1. SCPs nightly.sh + nightly-projects.conf to the box at ~/nightly/
#   2. Creates ~/nightly/projects.conf on the box (copied from nightly-projects.conf)
#   3. Optionally writes GH_TOKEN into /root/.ssh/environment on the box for private repos
#   4. Installs a systemd timer to run nightly.sh at 02:00 America/Cancun (= 08:00 UTC)
#      Uses Timezone= (systemd 244+, box has 255 — supported)
#      Falls back to crontab with CRON_TZ if systemd install fails
#   5. Idempotent: re-running replaces files and reloads units cleanly
#      Marker: /root/nightly/.nightly-installed (contains install timestamp)
#
# Usage:
#   bash ~/auramaxing/cloud/nightly-install.sh
#   bash ~/auramaxing/cloud/nightly-install.sh --gh-token ghp_xxxxxxxxxxxx
#   bash ~/auramaxing/cloud/nightly-install.sh --uninstall

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"   # aura_resolve_host (beacon/AURA_FLEET_HOST → never the burned box)
HOST="$(aura_resolve_host)" || { aura_box_unconfigured; exit 1; }
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"

GH_TOKEN_ARG=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --gh-token) GH_TOKEN_ARG="${2:?--gh-token requires a value}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

echo "▸ AURAMAXING nightly installer → $HOST"

# ── verify box is reachable ────────────────────────────────────────────────────
if ! ssh $SSH_OPTS "$HOST" true 2>/dev/null; then
  echo "✗ box unreachable: $HOST" >&2; exit 1
fi
echo "  box reachable ✓"

# ── uninstall path ─────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = "1" ]; then
  echo "▸ uninstalling..."
  ssh $SSH_OPTS "$HOST" bash << 'UNINSTALL_EOF'
systemctl stop aura-nightly.timer 2>/dev/null || true
systemctl disable aura-nightly.timer 2>/dev/null || true
rm -f /etc/systemd/system/aura-nightly.timer /etc/systemd/system/aura-nightly.service
systemctl daemon-reload 2>/dev/null || true
crontab -l 2>/dev/null | grep -v "# AURAMAXING-NIGHTLY" | crontab - 2>/dev/null || true
rm -f /root/nightly/.nightly-installed
echo "uninstalled"
UNINSTALL_EOF
  echo "✓ uninstalled"
  exit 0
fi

# ── copy scripts ───────────────────────────────────────────────────────────────
echo "▸ copying nightly.sh + nightly-projects.conf to box..."
ssh $SSH_OPTS "$HOST" "mkdir -p /root/nightly"
scp $SSH_OPTS "$SCRIPT_DIR/nightly.sh" "$HOST:/root/nightly/nightly.sh"
scp $SSH_OPTS "$SCRIPT_DIR/nightly-projects.conf" "$HOST:/root/nightly/projects.conf"
ssh $SSH_OPTS "$HOST" "chmod +x /root/nightly/nightly.sh"
echo "  copied ✓"

# ── optional GH_TOKEN ─────────────────────────────────────────────────────────
if [ -n "$GH_TOKEN_ARG" ]; then
  echo "▸ installing GH_TOKEN into /root/.ssh/environment..."
  # Write GH_TOKEN to box; quote heredoc to prevent local expansion of ${GH_TOKEN_ARG}
  # then substitute the value explicitly to avoid SC2087 / client-side expansion leakage
  GH_TOK_ESCAPED="$(printf '%s' "$GH_TOKEN_ARG" | sed "s/'/'\\\\''/g")"
  ssh $SSH_OPTS "$HOST" "
grep -v '^GH_TOKEN=' /root/.ssh/environment > /root/.ssh/environment.tmp 2>/dev/null || true
echo 'GH_TOKEN=$GH_TOK_ESCAPED' >> /root/.ssh/environment.tmp
mv /root/.ssh/environment.tmp /root/.ssh/environment
chmod 600 /root/.ssh/environment
grep -v '^GH_TOKEN=' /root/nightly/.nightly-env > /root/nightly/.nightly-env.tmp 2>/dev/null || true
echo 'GH_TOKEN=$GH_TOK_ESCAPED' >> /root/nightly/.nightly-env.tmp
mv /root/nightly/.nightly-env.tmp /root/nightly/.nightly-env
chmod 600 /root/nightly/.nightly-env
echo '  GH_TOKEN written'
"
fi

# ── required env for systemd runs (idempotent) ────────────────────────────────
# IS_SANDBOX=1: claude refuses --dangerously-skip-permissions as root without it.
# SSH sessions inherit it from /root/.ssh/environment; systemd does NOT — it must
# be in the EnvironmentFile or every scheduled audit dies in 400ms with exit 1.
# NIGHTLY_END_HOUR=13 (UTC) = 8am Cancun — the intended 2am-8am window (default 8
# UTC gave only a 1-hour window).
echo "▸ ensuring IS_SANDBOX + NIGHTLY_END_HOUR in .nightly-env..."
ssh $SSH_OPTS "$HOST" "
touch /root/nightly/.nightly-env
grep -q '^IS_SANDBOX=' /root/nightly/.nightly-env || echo 'IS_SANDBOX=1' >> /root/nightly/.nightly-env
grep -q '^NIGHTLY_END_HOUR=' /root/nightly/.nightly-env || echo 'NIGHTLY_END_HOUR=13' >> /root/nightly/.nightly-env
chmod 600 /root/nightly/.nightly-env
echo '  env ensured'
"

# ── install systemd timer (preferred) or crontab fallback ─────────────────────
echo "▸ installing schedule (02:00 America/Cancun = 08:00 UTC)..."

ssh $SSH_OPTS "$HOST" bash << 'SCHED_EOF'
set -euo pipefail

NIGHTLY_SH=/root/nightly/nightly.sh
ENV_FILE=/root/nightly/.nightly-env
CLAUDE_BIN=/root/.local/bin/claude

# Determine if env file exists
ENV_LINE=""
[ -f "$ENV_FILE" ] && ENV_LINE="EnvironmentFile=$ENV_FILE"

# Write systemd service unit
cat > /etc/systemd/system/aura-nightly.service << SERVICE_EOF
[Unit]
Description=AURAMAXING Nightly Audit+Improve Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Environment=PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=/root
${ENV_LINE}
ExecStart=/usr/bin/env bash ${NIGHTLY_SH}
StandardOutput=append:/root/nightly/logs/systemd.log
StandardError=append:/root/nightly/logs/systemd.log
TimeoutStartSec=21600
SERVICE_EOF

# Write systemd timer unit — 07:00 UTC = 02:00 America/Cancun (UTC-5, no DST)
# Note: using explicit UTC avoids POSIX tzdata sign-convention bugs in systemd Timezone=
cat > /etc/systemd/system/aura-nightly.timer << TIMER_EOF
[Unit]
Description=AURAMAXING Nightly Engine — runs at 02:00 America/Cancun (07:00 UTC)

[Timer]
OnCalendar=*-*-* 07:00:00 UTC
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
TIMER_EOF

systemctl daemon-reload
systemctl enable --now aura-nightly.timer
echo "systemd timer installed ✓"
systemctl list-timers | grep aura-nightly || echo "(timer may not list until next activation)"
SCHED_EOF

echo "  schedule installed ✓"

# ── write marker ───────────────────────────────────────────────────────────────
ssh $SSH_OPTS "$HOST" "echo 'installed=$(date -Is)' > /root/nightly/.nightly-installed"
echo ""
echo "✓ AURAMAXING nightly engine installed on $HOST"
echo "  script:  /root/nightly/nightly.sh"
echo "  conf:    /root/nightly/projects.conf"
echo "  schedule: 02:00 America/Cancun (08:00 UTC) daily"
echo "  reports: /root/nightly/reports/YYYY-MM-DD.md"
echo "  logs:    /root/nightly/logs/YYYY-MM-DD.log"
echo ""
echo "  Verify: ssh $HOST 'systemctl list-timers | grep aura'"
echo "  Fetch report: bash ~/auramaxing/cloud/nightly-report.sh"
echo ""
echo "  NOTE: Private repos require GH_TOKEN."
echo "  Re-run with --gh-token <pat> to enable private repo access."
