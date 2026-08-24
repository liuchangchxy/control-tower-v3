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
# Stop only the exact deployed Tower command; never use the vLLM PID from state.json.
ssh "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && pids=\$(ps -eo pid=,comm=,args= | awk '\$2==\"node\" && \$0 ~ /dist\\/server\\/index\\.js/ {print \$1}'); [ -z \"\$pids\" ] || kill \$pids 2>/dev/null || true"
sleep 2
ssh -f "${REMOTE}" "export PATH=\$HOME/local/node/bin:\$PATH && cd ${REMOTE_DIR} && nohup node dist/server/index.js > /tmp/ct.log 2>&1 &" || true
sleep 3

echo "==> Verifying"
STATUS=$(ssh "${REMOTE}" "curl -fsS http://localhost:9092/api/server/status" 2>/dev/null || echo "FAILED")
printf '%s\n' "  ${STATUS}"
if [[ "${STATUS}" == "FAILED" ]]; then
  echo "Control Tower did not start; remote log follows:" >&2
  ssh "${REMOTE}" "tail -n 80 /tmp/ct.log" >&2 || true
  exit 1
fi
node -e 'const s=JSON.parse(process.argv[1]); if(!s.ok || !s.data || !s.data.status) process.exit(1)' "${STATUS}"

echo "==> Done"
