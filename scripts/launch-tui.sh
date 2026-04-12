#!/bin/bash
# AURAMAXING — TUI launcher
set -e

export PATH="$HOME/.nvm/versions/node/v20.19.0/bin:/usr/local/bin:$PATH"

# Ensure Ruflo daemon is running
if ! npx ruflo@latest daemon status 2>/dev/null | grep -qi "running"; then
  echo "Starting Ruflo daemon..."
  npx ruflo@latest daemon start 2>/dev/null &
  sleep 2
fi

# Launch the TUI
cd "$(dirname "$0")/../tui"
python3 app.py
