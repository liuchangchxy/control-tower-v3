#!/usr/bin/env bash
# start.sh — launch control-tower server (for systemd/supervisor)
export PATH="$HOME/local/node/bin:$PATH"
export CONTROL_TOWER_HOME="$HOME/control-tower-v3"
cd "$CONTROL_TOWER_HOME"
exec node dist/server/index.js