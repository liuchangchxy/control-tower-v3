# Control Tower v2.5 — Spec

**Date:** 2026-08-21
**Status:** Draft
**Replaces:** control-tower-v2 (Node.js + React rewrite)

## Goal

Support manual parameter-tuning workflow: edit profile params, restart vLLM, benchmark via Playground, iterate. Show vLLM internal state (KV cache, queue, throughput) in real time. Diagnose startup failures (especially OOM) with actionable repair suggestions.

## Architecture (unchanged from v2)

- **Backend**: Express + TypeScript, port 9090 (replaces old Python tower)
- **Frontend**: React + Vite + Tailwind, SSE for real-time push
- **Process**: Node.js `child_process.spawn` directly manages vLLM
- **Log parsing**: 7-stage progress from vLLM log patterns

## New Capabilities (v2 → v2.5)

### 1. vLLM /metrics Integration

vLLM exposes Prometheus metrics at `http://localhost:8000/metrics` after ready.

**Backend service:** `server/services/vllmMetrics.ts`
- Poll `/metrics` every 2s after vLLM ready
- Parse Prometheus exposition format
- Track time-series in memory (last 5 min, 30 samples × 2s)
- Expose parsed snapshot + history via SSE

**Metrics tracked:**
- `vllm:gpu_cache_usage_perc` — KV cache usage (0-1)
- `vllm:gpu_cache_usage` — bytes used
- `vllm:num_requests_running` — active requests
- `vllm:num_requests_waiting` — queue depth
- `vllm:prompt_tokens_total` — cumulative
- `vllm:generation_tokens_total` — cumulative
- `vllm:time_to_first_token_seconds_*` — TTFT p50/p90/p99
- `vllm:e2e_request_latency_seconds_*` — latency p50/p90/p99

**API:**
- `GET /api/metrics/snapshot` — latest values
- `GET /api/metrics/stream` — SSE: snapshot every 2s

**Frontend:** New "VLLM Metrics" panel showing:
- KV cache usage bar (red >85%, yellow >70%, blue otherwise)
- Active requests / queue depth counters
- tok/s (computed: delta(prompt_tokens_total) / delta(time))
- TTFT p99
- Historical sparkline (last 5 min)

### 2. Error Root-Cause Analysis + Repair Suggestions

**Backend service:** `server/services/errorAnalyzer.ts`
- Takes vLLM log text + error type
- Returns diagnosis + repair actions

**Error patterns and repairs:**

| Error pattern | Diagnosis | Repair suggestion |
|---|---|---|
| `OutOfMemoryError` (startup) | Model + workspace exceeds `GPU_UTIL * total_GPU` | Suggest `GPU_UTIL = current - 0.05` |
| `OutOfMemoryError` (runtime) | KV cache full | Reduce `MAX_NUM_SEQS` or `MAX_MODEL_LEN` |
| `CUDA out of memory` | Single GPU OOM | Suggest `TP_SIZE = 1` (single GPU mode) |
| `Workspace allocation failed` | int8kv prefill workspace (256 MiB) cannot fit | Disable `VLLM_INT8KV_FA_PREFILL=0` |
| `Address already in use :8000` | vLLM port occupied | List `lsof -i :8000` processes; suggest `PORT=8001` |
| `Compilation timeout` | torch.compile took too long | No fix needed; show stage duration |
| `EngineCore failed` | Worker died | Check `/health`, suggest full restart |

**API:**
- `GET /api/errors/latest` — last error diagnosis
- `POST /api/errors/diagnose` — body: `{logLines: string[]}` returns diagnosis

**Frontend:**
- Error detail panel on Dashboard
- When error detected: red banner with diagnosis + 1-click repair button (sets profile value)
- "Apply suggestion" button: writes new profile to `user/`, prompts to restart

### 3. Benchmark Panel

**Backend service:** `server/services/benchmark.ts`
- Run predefined prompts via vLLM `/v1/chat/completions`
- Measure: total time, prompt tokens, generation tokens, TTFT (time to first token chunk)

**Prompts:**
- Short: 17 tok (e.g. "What is 2+2?")
- Medium: 313 tok (one paragraph question)
- Long: 3212 tok (multi-paragraph prompt)

**API:**
- `POST /api/benchmark/run` — body: `{profile, size: "short"|"medium"|"long"}`
- `GET /api/benchmark/history` — list of past runs
- `GET /api/benchmark/stream` — SSE: live progress + result

**Storage:** `run-logs/benchmark-history.json`

**Frontend:**
- Benchmark card on Dashboard with 3 buttons (short/medium/long)
- Live progress during run
- Result table: profile, size, prompt tok, gen tok, tok/s, TTFT, total time
- History chart: tok/s by profile (bar chart)

### 4. Dry-Run Profile Validation

**Backend:** extend `server/services/profileManager.ts` with `validateProfile()`
- Check `GPU_UTIL * 2 * 22528 MiB > estimated_model_size` (~14 GB for int4 27B)
- Check `MAX_MODEL_LEN * kv_per_token < GPU_UTIL * pool`
- Check `PORT` not in use
- Check `MODEL_PATH` exists

**API:**
- `POST /api/profiles/validate` — body: `ProfileConfig` returns `{valid: bool, errors: string[]}`

**Frontend:**
- Profile form shows validation errors inline before submit
- "Dry Run" button on profile list: tests without saving

### 5. Experiment Tracking

**Storage:** `run-logs/experiments.json` (append-only log)
```ts
interface Experiment {
  id: string;
  timestamp: number;
  profilePath: string;
  profileSnapshot: Record<string, string | number>;
  startDurationSec: number;
  status: "running" | "ready" | "error";
  errorMessage?: string;
  benchmarkResults?: Array<{ size: string; tokPerSec: number; ttftMs: number }>;
  notes?: string;
}
```

**API:**
- `GET /api/experiments` — list all (paginated)
- `GET /api/experiments/:id` — get detail
- `POST /api/experiments/:id/notes` — add notes

**Frontend:**
- Experiments page (`/experiments`): timeline of past runs
- Each experiment card: profile + duration + status + tok/s
- Click → detail view with diff vs current profile

### 6. GPU Throttle + Display Mode

**Backend:** extend `server/services/gpuMonitor.ts`

Throttle reasons: parse `nvidia-smi -q -d PERFORMANCE` output. Returns:
- `HW_SLOWDOWN`: hardware thermal limit
- `SW_THERMAL`: software thermal limit
- `SYNC_BOOST`: sync boost active
- `HW_POWER_BRAKE`: power brake active
- `APPLICATION_CLOCKS`: app clocks set
- `SW_POWER_CAP`: software power cap

Display mode: parse `nvidia-smi --query-gpu=display_mode` (or check `DISPLAY` env + running processes).

**Frontend:** Throttle reasons as colored tags on GPU card. Display mode as warning badge if active.

### 7. Restart Endpoint

**Backend:** `POST /api/server/restart` — `server/routes/server.ts`
- Calls `stop()` then `start()` with the current profile
- 30s timeout for graceful stop, then start (which has its own 60s PID wait)

### 8. Log Search + Jump to Error

**Frontend:** extend `client/src/components/LogViewer.tsx`
- Add Ctrl+F keyboard shortcut for search
- Match highlighting
- "Jump to error" button: scrolls to first matching error line (`OutOfMemoryError|CUDA error|EngineDeadError`)
- "Download log" button: blob URL of full log content

### 9. Profile Diff

**Backend:** `POST /api/profiles/diff` — body: `{pathA, pathB}` returns `{field: {a, b, changed: bool}[]}`

**Frontend:** Profile editor has "Compare with..." dropdown selecting another profile, shows side-by-side diff.

### 10. Port 9090 (Replaces Old Tower)

**Config:** `config.json` change `port` to 9090. New control-tower fully replaces old Python tower. Old Python tower process killed at deploy time.

## Removed from v2.5 (YAGNI)

- ❌ Auth (single-user LAN)
- ❌ Swagger /docs
- ❌ Multi-instance
- ❌ Remote access / mobile
- ❌ Profile import/export (use git)
- ❌ Toast system (use status banners + auto-dismiss)
- ❌ Playground API integration (Playground runs independently)

## Implementation Phases

**Phase 1 (Core pain points):**
1. vLLM /metrics integration (largest item)
2. Error analyzer with repair suggestions
3. Benchmark panel
4. Restart endpoint
5. Port → 9090

**Phase 2 (UX):**
6. Dry-run validation
7. Log search + jump to error
8. Profile diff

**Phase 3 (Polish):**
9. Throttle + display mode
10. Experiment tracking timeline
11. Historical charts (sparklines)

## Out of Scope

- vLLM config validation beyond basic checks
- Auto-restart on crash (manual restart only for now)
- Multi-vLLM-instance management
- GPU pool across machines