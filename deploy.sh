#!/usr/bin/env bash
# deploy.sh — sync local code to debian103, build, and restart
set -euo pipefail

REMOTE="debian103"
REMOTE_DIR="/home/chang/control-tower-v3"

echo "==> Syncing code to ${REMOTE}:${REMOTE_DIR}"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'client/dist' \
  --exclude '.git' \
  --exclude 'run-logs' \
  --exclude 'state.json' \
  ./ "${REMOTE}:${REMOTE_DIR}/"

echo "==> Installing dependencies"
ssh "${REMOTE}" "cd ${REMOTE_DIR} && npm install --production=false 2>&1 | tail -3"
ssh "${REMOTE}" "cd ${REMOTE_DIR}/client && npm install 2>&1 | tail -3"

echo "==> Building server"
ssh "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR} && npx tsc -p tsconfig.server.json 2>&1"

echo "==> Building client"
ssh "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR}/client && npx vite build 2>&1 | tail -5"

echo "==> Restarting control-tower"
ssh "${REMOTE}" "pkill -f 'node dist/server/index.js' 2>/dev/null || true"
sleep 2
ssh -f "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR} && nohup node dist/server/index.js > /tmp/ct.log 2>&1 &"
sleep 3

echo "==> Verifying"
STATUS=$(ssh "${REMOTE}" "curl -s http://localhost:9092/api/server/status 2>/dev/null | head -c 50" || echo "FAILED")
echo "  ${STATUS}"

echo "==> Done"
