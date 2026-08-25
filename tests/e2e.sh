#!/bin/bash
# E2E test for the vLLM 2080Ti Control Panel.
# Run: ssh debian103 "cd /home/chang/vllm-2080ti-control-panel && bash tests/e2e.sh"

set -uo pipefail

BASE="http://localhost:9092"
PROFILE="qwen27b/normal/int4/int8kv-256K-nomtp-text-only.env"
PASS=0
FAIL=0
TEST_PROFILE="user/e2e-test.env"

assert() {
  local desc="$1" url="$2" jq_expr="$3"
  local response
  response=$(curl -s --max-time 10 "$url" 2>/dev/null || echo '{"ok":false}')
  local actual
  actual=$(echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print($jq_expr)
" 2>/dev/null || echo "PARSE_ERROR")
  if [[ "$actual" == "True" ]] || [[ "$actual" == "true" ]]; then
    echo "  ✅ $desc"
    ((PASS++))
  else
    echo "  ❌ $desc (got: $actual)"
    ((FAIL++))
  fi
}

assert_value() {
  local desc="$1" url="$2" expected="$3"
  local actual
  actual=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "ERROR")
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ $desc"
    ((PASS++))
  else
    echo "  ❌ $desc (expected: $expected)"
    ((FAIL++))
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Control Tower v3 — E2E Test Suite              ║"
echo "║   Target: $BASE                                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Phase 0: Clean state ────────────────────────────────────────────────────
echo "━━━ Phase 0: Ensure clean state ━━━"
echo "  Checking current status..."
CURRENT_STATUS=$(curl -s --max-time 5 "$BASE/api/server/status" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null || echo "unknown")
echo "  Current status: $CURRENT_STATUS"
if [[ "$CURRENT_STATUS" != "stopped" ]]; then
  echo "  Stopping vLLM first..."
  curl -s --max-time 30 -X POST "$BASE/api/server/stop" > /dev/null 2>&1
  for i in $(seq 1 30); do
    sleep 2
    S=$(curl -s --max-time 5 "$BASE/api/server/status" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null || echo "unknown")
    if [[ "$S" == "stopped" ]]; then
      echo "  ✅ vLLM stopped"
      break
    fi
  done
  sleep 3
fi

# ── Phase 1: Pre-flight (no vLLM running) ──────────────────────────────────
echo "━━━ Phase 1: Pre-flight ━━━"

assert "Server responds" "$BASE/api/server/status" "d['ok']==True"
assert "Status is stopped" "$BASE/api/server/status" "d['data']['status']=='stopped'"

assert "Profiles load (18+)" "$BASE/api/profiles" "len(d['data'])>=18"

assert "GPU stats return 2+ GPUs" "$BASE/api/gpu" "len(d['data'])>=2"

assert_value "UI serves HTML" "$BASE/" "<!doctype html>"

assert "Settings load" "$BASE/api/settings" "d['ok']==True"

# Profile validation - valid config
VALID=$(curl -s --max-time 10 -X POST "$BASE/api/profiles/validate" \
  -H "Content-Type: application/json" \
  -d '{"SERVED_NAME":"test-e2e","MODEL_FAMILY":"qwen","PROFILE_GROUP":"qwen36-27b-int4","MODEL_VARIANT":"int4","GPU_UTIL":0.88,"MAX_MODEL_LEN":256000,"KV_CACHE_DTYPE":"int8_per_token_head","MAX_BATCHED_TOKENS":2048,"MAX_NUM_SEQS":2,"MTP_K":0}')
VALID_RESULT=$(echo "$VALID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['valid'])" 2>/dev/null || echo "False")
if [[ "$VALID_RESULT" == "True" ]]; then
  echo "  ✅ Profile validation (valid config)"
  ((PASS++))
else
  echo "  ❌ Profile validation (valid config)"
  ((FAIL++))
fi

# Profile validation - invalid config
INVALID=$(curl -s --max-time 10 -X POST "$BASE/api/profiles/validate" \
  -H "Content-Type: application/json" \
  -d '{"config":{"SERVED_NAME":"test","GPU_UTIL":2.0,"MAX_MODEL_LEN":256000}}')
INVALID_RESULT=$(echo "$INVALID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['valid'])" 2>/dev/null || echo "True")
if [[ "$INVALID_RESULT" == "False" ]]; then
  echo "  ✅ Profile validation (invalid GPU_UTIL=2.0 rejected)"
  ((PASS++))
else
  echo "  ❌ Profile validation (invalid GPU_UTIL=2.0 not rejected)"
  ((FAIL++))
fi

# Create test profile
CREATE=$(curl -s --max-time 10 -X POST "$BASE/api/profiles" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-test","config":{"SERVED_NAME":"e2e-test","GPU_UTIL":0.88,"MAX_MODEL_LEN":256000,"KV_CACHE_DTYPE":"int8_per_token_head","MAX_BATCHED_TOKENS":2048,"MAX_NUM_SEQS":2,"MTP_K":0}}')
CREATE_OK=$(echo "$CREATE" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo "False")
if [[ "$CREATE_OK" == "True" ]]; then
  echo "  ✅ Create test profile"
  ((PASS++))
else
  echo "  ❌ Create test profile"
  ((FAIL++))
fi

# Read test profile
READ=$(curl -s --max-time 10 "$BASE/api/profiles/$TEST_PROFILE" 2>/dev/null || echo '{"ok":false}')
READ_OK=$(echo "$READ" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['ok'] and d['data']['SERVED_NAME']=='e2e-test')" 2>/dev/null || echo "False")
if [[ "$READ_OK" == "True" ]]; then
  echo "  ✅ Read test profile"
  ((PASS++))
else
  echo "  ❌ Read test profile"
  ((FAIL++))
fi

# Delete test profile
DEL=$(curl -s --max-time 10 -X DELETE "$BASE/api/profiles/$TEST_PROFILE" 2>/dev/null || echo '{"ok":false}')
DEL_OK=$(echo "$DEL" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo "False")
if [[ "$DEL_OK" == "True" ]]; then
  echo "  ✅ Delete test profile"
  ((PASS++))
else
  echo "  ❌ Delete test profile"
  ((FAIL++))
fi

echo ""

# ── Phase 2: Start vLLM ────────────────────────────────────────────────────
echo "━━━ Phase 2: Start vLLM (this takes ~5 minutes) ━━━"

START=$(curl -s --max-time 30 -X POST "$BASE/api/server/start" \
  -H "Content-Type: application/json" \
  -d "{\"profile\":\"$PROFILE\"}")
START_OK=$(echo "$START" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo "False")
if [[ "$START_OK" == "True" ]]; then
  echo "  ✅ Start request accepted"
  ((PASS++))
else
  echo "  ❌ Start request failed"
  echo "     $START"
  ((FAIL++))
fi

echo "  ⏳ Waiting for vLLM to become ready (up to 10 minutes)..."
READY=false
for i in $(seq 1 60); do
  sleep 10
  STATUS=$(curl -s --max-time 5 "$BASE/api/server/status" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null || echo "unknown")
  echo "     [$((i*10))s] status=$STATUS"
  if [[ "$STATUS" == "ready" ]]; then
    echo "  ✅ vLLM ready in $((i*10)) seconds"
    ((PASS++))
    READY=true
    break
  fi
  if [[ "$STATUS" == "error" ]]; then
    echo "  ❌ vLLM failed to start"
    ERROR=$(curl -s "$BASE/api/server/status" | python3 -c "import json,sys; print(json.load(sys.stdin)['data'].get('error','unknown'))" 2>/dev/null)
    echo "     Error: $ERROR"
    ((FAIL++))
    break
  fi
done

if [[ "$READY" != "true" ]]; then
  echo "  ❌ vLLM did not become ready within 10 minutes"
  ((FAIL++))
fi

echo ""

# ── Phase 3: vLLM Running ──────────────────────────────────────────────────
echo "━━━ Phase 3: vLLM Running Tests ━━━"

if [[ "$READY" == "true" ]]; then
  assert "Status is ready" "$BASE/api/server/status" "d['data']['status']=='ready'"
  assert "Uptime > 0" "$BASE/api/server/status" "d['data']['uptime']>0"
  assert "Profile matches" "$BASE/api/server/status" "d['data']['profile']=='$PROFILE'"

  # Metrics
  echo "  Sending request to populate KV cache..."
  curl -s --max-time 30 -X POST "http://localhost:8000/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"default","messages":[{"role":"user","content":"hello"}],"max_tokens":50}' > /dev/null 2>&1
  sleep 2
  assert "Metrics populated" "$BASE/api/server/metrics" "d['ok']==True"
  assert "Metrics has kvCacheUsagePerc field" "$BASE/api/server/metrics" "d['data']['kvCacheUsagePerc']>=0"

  # GPU memory
  assert "GPU memory > 15GB" "$BASE/api/gpu" "d['data'][0]['memoryUsed']>15000"

  # Benchmark presets endpoint
  assert "Benchmark presets available" "$BASE/api/benchmark/presets" "len(d['data'])>=4"

  # Benchmark - quick preset (128in/64out)
  echo "  Running benchmark (quick: 128in/64out)..."
  BENCH=$(curl -s --max-time 300 -X POST "$BASE/api/benchmark/run" \
    -H "Content-Type: application/json" \
    -d '{"presetId":"quick","rounds":1}')
  BENCH_OK=$(echo "$BENCH" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('data',{}).get('result',{}); print(d['ok'] and r.get('throughputTokPerSec',0)>0)" 2>/dev/null || echo "False")
  if [[ "$BENCH_OK" == "True" ]]; then
    TOKPS=$(echo "$BENCH" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['data']['result']; print(round(r.get('throughputTokPerSec',0),1))" 2>/dev/null)
    TTFT=$(echo "$BENCH" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['data']['result']; print(round(r.get('ttftMs',0),0))" 2>/dev/null)
    TPOT=$(echo "$BENCH" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['data']['result']; print(round(r.get('tpotMs',0),1))" 2>/dev/null)
    echo "  ✅ Benchmark quick: ${TOKPS} tok/s, TTFT ${TTFT}ms, TPOT ${TPOT}ms"
    ((PASS++))
  else
    echo "  ❌ Benchmark quick failed: $(echo $BENCH | head -c 200)"
    ((FAIL++))
  fi

  # Benchmark - chat preset (512in/256out)
  echo "  Running benchmark (chat: 512in/256out)..."
  BENCH_CHAT=$(curl -s --max-time 300 -X POST "$BASE/api/benchmark/run" \
    -H "Content-Type: application/json" \
    -d '{"presetId":"chat","rounds":1}')
  BENCH_CHAT_OK=$(echo "$BENCH_CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('data',{}).get('result',{}); print(d['ok'] and r.get('throughputTokPerSec',0)>0)" 2>/dev/null || echo "False")
  if [[ "$BENCH_CHAT_OK" == "True" ]]; then
    TOKPS_CHAT=$(echo "$BENCH_CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['data']['result']; print(round(r.get('throughputTokPerSec',0),1))" 2>/dev/null)
    echo "  ✅ Benchmark chat: ${TOKPS_CHAT} tok/s"
    ((PASS++))
  else
    echo "  ❌ Benchmark chat failed: $(echo $BENCH_CHAT | head -c 200)"
    ((FAIL++))
  fi

  # Experiments
  assert "Experiments recorded" "$BASE/api/experiments" "len(d['data'])>=1"

  # Logs
  assert "Logs tail works" "$BASE/api/logs?lines=10" "d['ok']==True"

  # Restart
  echo "  Testing restart..."
  RESTART=$(curl -s --max-time 30 -X POST "$BASE/api/server/restart")
  RESTART_OK=$(echo "$RESTART" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo "False")
  if [[ "$RESTART_OK" == "True" ]]; then
    echo "  ✅ Restart accepted"
    ((PASS++))
    echo "  ⏳ Waiting for restart to complete (up to 10 min)..."
    for i in $(seq 1 60); do
      sleep 10
      STATUS=$(curl -s --max-time 5 "$BASE/api/server/status" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null || echo "unknown")
      if [[ "$STATUS" == "ready" ]]; then
        echo "  ✅ Restart completed in $((i*10))s"
        ((PASS++))
        break
      fi
      if [[ "$STATUS" == "error" ]]; then
        echo "  ❌ Restart failed"
        ((FAIL++))
        break
      fi
    done
  else
    echo "  ❌ Restart failed"
    ((FAIL++))
  fi
else
  echo "  ⏭️  Skipping vLLM running tests (vLLM not ready)"
fi

echo ""

# ── Phase 4: Stop ──────────────────────────────────────────────────────────
echo "━━━ Phase 4: Stop vLLM ━━━"

STOP=$(curl -s --max-time 30 -X POST "$BASE/api/server/stop")
STOP_OK=$(echo "$STOP" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo "False")
if [[ "$STOP_OK" == "True" ]]; then
  echo "  ✅ Stop request accepted"
  ((PASS++))
else
  echo "  ❌ Stop failed"
  ((FAIL++))
fi

sleep 5
assert "Status stopped" "$BASE/api/server/status" "d['data']['status']=='stopped'"
assert "GPU memory freed" "$BASE/api/gpu" "d['data'][0]['memoryUsed']<1000"

echo ""

# ── Results ─────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════╗"
echo "║   Results                                        ║"
echo "╠══════════════════════════════════════════════════╣"
printf "║   ✅ PASS: %-3d                                    ║\n" "$PASS"
printf "║   ❌ FAIL: %-3d                                    ║\n" "$FAIL"
echo "╚══════════════════════════════════════════════════╝"

if [[ $FAIL -eq 0 ]]; then
  echo ""
  echo "🎉 ALL TESTS PASSED"
  exit 0
else
  echo ""
  echo "💥 $FAIL TEST(S) FAILED"
  exit 1
fi
