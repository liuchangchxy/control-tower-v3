#!/usr/bin/env bash
# start.sh — launch the Control Panel server from the canonical Debian checkout.
export PATH="$HOME/local/node/bin:$PATH"
export CONTROL_PANEL_HOME="${CONTROL_PANEL_HOME:-$HOME/vllm-2080ti-control-panel}"
cd "$CONTROL_PANEL_HOME"
exec node dist/server/index.js