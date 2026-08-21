#!/usr/bin/env bash
# start.sh — launch control-tower-v2 server
export PATH="$HOME/local/node/bin:$PATH"
export CONTROL_TOWER_HOME="$HOME/control-tower-v2"
cd "$CONTROL_TOWER_HOME"
exec node dist/server/index.js