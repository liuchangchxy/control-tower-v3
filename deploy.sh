#!/usr/bin/env bash
# Build, test, restart, and verify the Linux-local Control Tower checkout.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${HOME}/local/node/bin:${PATH}"
cd "${ROOT}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked source changes exist; commit or review them before building." >&2
  git status --short >&2
  exit 1
fi

npm run build
npx tsc -p tsconfig.server.json --noEmit
npx vitest run --config vitest.config.ts

SERVICE_NAME="control-tower.service"
SERVICE_SOURCE="${ROOT}/deploy/${SERVICE_NAME}"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}"

sudo install -o root -g root -m 0644 "${SERVICE_SOURCE}" "${SERVICE_TARGET}"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl stop "${SERVICE_NAME}" 2>/dev/null || true

tower_pids=()
while read -r pid comm args; do
  [[ "${comm}" == "node" ]] || continue
  [[ "${args}" == "node dist/server/index.js" ]] || continue
  [[ -r "/proc/${pid}/cwd" ]] || continue
  [[ "$(readlink -f "/proc/${pid}/cwd")" == "${ROOT}" ]] || continue
  tower_pids+=("${pid}")
done < <(ps -eo pid=,comm=,args=)

if ((${#tower_pids[@]})); then
  kill "${tower_pids[@]}" 2>/dev/null || true
  sleep 2
fi

sudo systemctl start "${SERVICE_NAME}"
sleep 3
if ! sudo systemctl is-active --quiet "${SERVICE_NAME}"; then
  sudo systemctl --no-pager --full status "${SERVICE_NAME}" || true
  exit 1
fi

status="$(curl -fsS http://localhost:9092/api/server/status)"
node -e 'const s=JSON.parse(process.argv[1]); if (!s.ok || !s.data || !s.data.status) process.exit(1)' "${status}"
server_pid="$(sudo systemctl show --property=MainPID --value "${SERVICE_NAME}")"

printf 'commit=%s\n' "$(git rev-parse HEAD)"
printf 'branch=%s\n' "$(git branch --show-current)"
printf 'service=%s\n' "${SERVICE_NAME}"
printf 'server_pid=%s\n' "${server_pid}"
printf 'status=%s\n' "${status}"
printf 'tracked_status=\n'
git status --short --branch
