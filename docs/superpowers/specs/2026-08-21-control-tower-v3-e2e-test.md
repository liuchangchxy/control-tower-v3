# Control Tower v3 — End-to-End Test Plan

**Date:** 2026-08-21
**Target:** http://192.168.1.103:9092 (debian103)
**Duration:** ~10 minutes (5 min vLLM startup + 5 min tests)

---

## Test Environment

- Server: debian103, Node.js 20, Express
- vLLM: Qwen3.8-27B-GPTQ-Int4, TP=2, int8kv, 256K context
- GPU: Dual RTX 2080Ti 22GB + NVLink
- Profile: `qwen27b/normal/int4/int8kv-256K-nomtp-text-only.env`

---

## Test Suite

### Phase 1: Pre-flight (no vLLM running)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Server responds | `GET /api/server/status` | `ok:true, status:"stopped"` |
| 1.2 | Profiles load | `GET /api/profiles` | Array with 18+ profiles |
| 1.3 | GPU stats work | `GET /api/gpu` | Array with 2 GPUs, temp/power/mem |
| 1.4 | Settings load | `GET /api/settings` | Config fields present |
| 1.5 | UI serves | `GET /` | HTML with "Control Tower" title |
| 1.6 | Profile validation | `POST /api/profiles/validate` with valid config | `{valid: true, errors: []}` |
| 1.7 | Profile validation fail | `POST /api/profiles/validate` with `GPU_UTIL: 2.0` | `{valid: false, errors: [...]}` |
| 1.8 | Create test profile | `POST /api/profiles` with test config | Profile created in `user/` |
| 1.9 | Read test profile | `GET /api/profiles/user/test-e2e.env` | Profile data matches |
| 1.10 | Delete test profile | `DELETE /api/profiles/user/test-e2e.env` | Profile deleted |

### Phase 2: Start vLLM

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Start server | `POST /api/server/start` with profile | `{ok: true}` |
| 2.2 | Status is starting | `GET /api/server/status` | `status:"starting"` or `"loading"` |
| 2.3 | Progress SSE connects | `GET /api/server/progress` (SSE) | Receives progress events |
| 2.4 | Progress stages appear | Wait, collect SSE events | Events with stages: init, weights, profile, kvcache, cudagraph, compile, server |
| 2.5 | GPU memory increases | `GET /api/gpu` during startup | memoryUsed increases from ~0 to ~19GB |
| 2.6 | Wait for ready | Poll `GET /api/server/status` every 10s | `status:"ready"` within 5 min |
| 2.7 | Metrics SSE works | `GET /api/metrics/stream` (SSE) | Receives metrics with kvCacheUsagePerc > 0 |

### Phase 3: vLLM Running

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.1 | Status shows ready | `GET /api/server/status` | `status:"ready"`, `uptime > 0` |
| 3.2 | Metrics populated | `GET /api/metrics` | `numRequestsRunning: 0`, `kvCacheUsagePerc > 0` |
| 3.3 | GPU memory high | `GET /api/gpu` | `memoryUsed > 15000` (MiB) |
| 3.4 | Chat works | `POST /v1/chat/completions` via proxy | Streaming response with tokens |
| 3.5 | Chat TTFT measured | Check first token latency | `ttftMs > 0` and `< 10000` |
| 3.6 | Benchmark short | `POST /api/benchmark/run` with short prompt | `{tokPerSec > 0, ttftMs > 0}` |
| 3.7 | Benchmark medium | `POST /api/benchmark/run` with medium prompt | `{tokPerSec > 0, ttftMs > 0}` |
| 3.8 | Benchmark long | `POST /api/benchmark/run` with long prompt | `{tokPerSec > 0, ttftMs > 0}` |
| 3.9 | Experiment recorded | `GET /api/experiments` | At least 1 experiment with status "ready" |
| 3.10 | Logs stream | `GET /api/logs/stream` (SSE) | Receives log lines |
| 3.11 | Logs tail | `GET /api/logs?lines=10` | Returns last 10 log lines |
| 3.12 | Restart works | `POST /api/server/restart` | `{ok: true}`, status transitions to ready |

### Phase 4: Batch Benchmark

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | Batch run | Select 2 profiles, run batch | Both complete with results |
| 4.2 | Results compare | Check comparison table | Both profiles have tok/s values |
| 4.3 | Export CSV | Click export | CSV file downloaded |
| 4.4 | Export JSON | Click export | JSON file downloaded |

### Phase 5: Error Scenarios

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Start while running | `POST /api/server/start` again | Error: "already running" |
| 5.2 | Invalid profile | `POST /api/server/start` with bad profile path | Error: "not found" |
| 5.3 | Stop graceful | `POST /api/server/stop` | Status transitions to stopped |
| 5.4 | GPU memory freed | `GET /api/gpu` after stop | `memoryUsed < 1000` |

### Phase 6: Cleanup

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Stop vLLM | `POST /api/server/stop` | `{ok: true}` |
| 6.2 | Status stopped | `GET /api/server/status` | `status:"stopped"` |
| 6.3 | GPU clean | `GET /api/gpu` | `memoryUsed < 500` |

---

## Implementation

Test script: `tests/e2e.sh` (bash, runs from Windows via SSH)

```bash
#!/bin/bash
# E2E test for Control Tower v3
# Run: ssh debian103 "cd ~/control-tower-v3 && bash tests/e2e.sh"

BASE="http://localhost:9092"
PROFILE="qwen27b/normal/int4/int8kv-256K-nomtp-text-only.env"
PASS=0
FAIL=0

assert_ok() {
  local desc="$1" url="$2" expected="$3"
  local actual=$(curl -s --max-time 10 "$url" | python3 -c "import json,sys; d=json.load(sys.stdin); print($expected)" 2>/dev/null)
  if [[ "$actual" == *"True"* ]] || [[ "$actual" == *"true"* ]] || [[ "$actual" == "$expected" ]]; then
    echo "✅ $desc"
    ((PASS++))
  else
    echo "❌ $desc (expected: $expected, got: $actual)"
    ((FAIL++))
  fi
}

# Phase 1: Pre-flight
echo "=== Phase 1: Pre-flight ==="
assert_ok "Server responds" "$BASE/api/server/status" "d['ok']==True"
assert_ok "Status stopped" "$BASE/api/server/status" "d['data']['status']=='stopped'"
assert_ok "Profiles load" "$BASE/api/profiles" "len(d['data'])>10"
assert_ok "GPU stats work" "$BASE/api/gpu" "len(d['data'])==2"
assert_ok "UI serves" "$BASE/" "True"

# Phase 2: Start vLLM
echo "=== Phase 2: Start vLLM ==="
curl -s -X POST "$BASE/api/server/start" -H "Content-Type: application/json" -d "{\"profile\":\"$PROFILE\"}"
echo "Starting vLLM... waiting up to 5 minutes"
for i in $(seq 1 30); do
  sleep 10
  STATUS=$(curl -s "$BASE/api/server/status" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
  echo "  [$((i*10))s] status=$STATUS"
  if [[ "$STATUS" == "ready" ]]; then
    echo "✅ vLLM ready in $((i*10))s"
    ((PASS++))
    break
  fi
  if [[ "$STATUS" == "error" ]]; then
    echo "❌ vLLM failed to start"
    ((FAIL++))
    break
  fi
done

# Phase 3: vLLM Running
echo "=== Phase 3: vLLM Running ==="
assert_ok "Status ready" "$BASE/api/server/status" "d['data']['status']=='ready'"
assert_ok "Metrics populated" "$BASE/api/metrics" "d['data']['kvCacheUsagePerc']>0"

# Benchmark test
echo "Running benchmark..."
RESULT=$(curl -s -X POST "$BASE/api/benchmark/run" -H "Content-Type: application/json" -d '{"prompt":"What is 2+2?","rounds":1}')
TOKPS=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['tokPerSec'])" 2>/dev/null)
if [[ -n "$TOKPS" ]] && [[ "$TOKPS" != "None" ]]; then
  echo "✅ Benchmark: $TOKPS tok/s"
  ((PASS++))
else
  echo "❌ Benchmark failed"
  ((FAIL++))
fi

# Phase 5: Stop
echo "=== Phase 5: Stop ==="
curl -s -X POST "$BASE/api/server/stop"
sleep 5
assert_ok "Status stopped" "$BASE/api/server/status" "d['data']['status']=='stopped'"

# Summary
echo ""
echo "=== Results ==="
echo "✅ PASS: $PASS"
echo "❌ FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
```

---

## Execution

```bash
# On debian103:
cd ~/control-tower-v3
bash tests/e2e.sh

# Expected output:
# === Phase 1: Pre-flight ===
# ✅ Server responds
# ✅ Status stopped
# ✅ Profiles load
# ✅ GPU stats work
# ✅ UI serves
# === Phase 2: Start vLLM ===
# Starting vLLM... waiting up to 5 minutes
#   [10s] status=starting
#   [20s] status=loading
#   ...
#   [240s] status=ready
# ✅ vLLM ready in 240s
# === Phase 3: vLLM Running ===
# ✅ Status ready
# ✅ Metrics populated
# ✅ Benchmark: 12.5 tok/s
# === Phase 5: Stop ===
# ✅ Status stopped
# === Results ===
# ✅ PASS: 8
# ❌ FAIL: 0
# ALL TESTS PASSED
```
