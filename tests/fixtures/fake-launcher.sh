#!/usr/bin/env bash
set -euo pipefail

# Deterministic launcher fixture for ControlPlane tests.
# It accepts the same lifecycle verbs as the canonical JSON contract.
STATE_FILE=${FAKE_LAUNCHER_STATE_FILE:?FAKE_LAUNCHER_STATE_FILE is required}
mkdir -p "$(dirname "$STATE_FILE")"
write() {
  local status=$1 pid=${2:-} profile=${FAKE_PROFILE:-user/fake.env}
  python3 - "$STATE_FILE" "$status" "$pid" "$profile" <<'PY'
import json, os, sys, tempfile
p, status, pid, profile = sys.argv[1:]
state={'schemaVersion':1,'status':status,'profile':profile,'servedName':'fake-model','modelDir':'/fake/model','pid':int(pid) if pid else None,'pgid':int(pid) if pid else None,'pidFile':p+'.pid','logFile':p+'.log','stateFile':p,'port':8000,'startedAt':1,'healthUrl':'http://127.0.0.1:8000/health','smokePassed':status=='ready','error':None}
fd,tmp=tempfile.mkstemp(dir=os.path.dirname(p),prefix='.fake-',text=True)
with os.fdopen(fd,'w') as f: json.dump(state,f); f.write('\n')
os.replace(tmp,p)
print(json.dumps(state))
PY
}
case "${1:-status}" in
  start|restart) write ready "${FAKE_PID:-12345}" ;;
  status) [[ -f "$STATE_FILE" ]] && cat "$STATE_FILE" || write stopped ;;
  stop|kill) write stopped ;;
  *) exit 2 ;;
esac
