#!/usr/bin/env bash
# deploy.sh — build locally, deploy to debian103, restart
set -euo pipefail

REMOTE="debian103"
REMOTE_DIR="/home/chang/control-tower-v3"

echo "==> Building client + server locally"
npm run build 2>&1 | tail -5

echo "==> Syncing to ${REMOTE}:${REMOTE_DIR}"
# tar pipe avoids rsync dependency (works on Windows Git Bash)
tar --exclude='node_modules' --exclude='.git' --exclude='run-logs' \
  -czf - ./ | ssh "${REMOTE}" "cd ${REMOTE_DIR} && tar -xzf - --strip-components=0"

echo "==> Installing dependencies on remote (for runtime)"
ssh "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR} && npm install --production 2>&1 | tail -3"

echo "==> Restarting control-tower"
ssh "${REMOTE}" "ps aux | grep 'node dist/server' | grep -v grep | awk '{print \$2}' | xargs -r kill 2>/dev/null; echo killed"
sleep 2
ssh -f "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR} && nohup node dist/server/index.js > /tmp/ct.log 2>&1 &" || true
sleep 3

echo "==> Verifying"
STATUS=$(ssh "${REMOTE}" "curl -s http://localhost:9092/api/server/status 2>/dev/null | head -c 50" || echo "FAILED")
echo "  ${STATUS}"

echo "==> Done"
