# Control Tower v3 — Design Spec

**Date:** 2026-08-21
**Status:** Draft
**Based on:** `docs/superpowers/specs/2026-08-21-brainstorm-what-we-know.md`

---

## 1. Goal

Build a **vLLM configuration optimization workbench + runtime control console** that completely replaces vLLM Playground. The tool provides full control over the vLLM-2080Ti-Definitive Edition (v0.21.0 fork) running on dual RTX 2080Ti 22GB + NVLink hardware.

**Core workflow:** Select parameters → Start vLLM → Benchmark → View data → Adjust parameters → Iterate

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│  React SPA (Vite + Tailwind CSS)                │
│  ┌───────────┬──────────┬──────────┬──────────┐ │
│  │ Dashboard │ Profiles │ Benchmark│ Logs     │ │
│  └─────┬─────┴────┬─────┴────┬─────┴────┬─────┘ │
│        │ SSE      │ REST     │ SSE      │ REST  │
└────────┼──────────┼──────────┼──────────┼───────┘
         │          │          │          │
┌────────┼──────────┼──────────┼──────────┼───────┐
│ Express Server (TypeScript)                     │
│  ┌─────┴──────┬────┴──────┬──┴──────┬───┴─────┐ │
│  │ processMgr │ profileMgr│ metrics │ gpuMon  │ │
│  │            │           │         │         │ │
│  │ spawn/kill │ CRUD .env │ /metrics│ nvidia  │ │
│  │ health     │ templates │ scrape  │ smi     │ │
│  └─────┬──────┴───────────┴─────────┴─────────┘ │
│        │ child_process.spawn                     │
│        ▼                                         │
│  python3 -m vllm.entrypoints.openai.api_server  │
└─────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend | Express + TypeScript | Mature, good AI code quality |
| Frontend | React + Vite + Tailwind | Fast dev, rich ecosystem |
| Process mgmt | Node.js child_process.spawn | Full lifecycle control |
| Real-time | SSE | Simpler than WebSocket, sufficient |
| Profile storage | .env files | Compatible with launcher.sh ecosystem |
| State persistence | JSON file | Simple, no database needed |
| vLLM version | Only 2080Ti Definitive Edition | Simplify design |
| Launcher | Replace launcher.sh | Full control over logs/process |

---

## 3. Hardware Context

| Component | Spec |
|-----------|------|
| GPU 0 | RTX 2080Ti 22GB (modded) + NVLink |
| GPU 1 | RTX 2080Ti 22GB (modded) + NVLink |
| NVLink | 2 links, ~51.56 GB/s bidirectional |
| PCIe | Gen3 x16 (needs driver enable: `NVreg_EnablePCIeGen3=1`) |
| CPU | Intel Xeon E5-2696 v3, 18 cores / 36 threads |
| RAM | 15 GB total, ~10 GB available |
| Disk | 106 GB total, ~11 GB free |
| vLLM | Qwen3.8-27B-GPTQ-Int4, TP=2, int8kv, 256K context |

**Startup time:** ~5 minutes (3 min model load + 30s torch.compile + 1s CUDA graph)

---

## 4. Features (12 total, all important)

### 4.1 Profile Management

**Form-based editing with 65 configurable parameters.**

Parameters are grouped:
- **Core (6):** GPU_UTIL, MAX_MODEL_LEN, KV_CACHE_DTYPE, MTP_K, MAX_NUM_SEQS, MAX_BATCHED_TOKENS
- **Metadata (5):** SERVED_NAME, COMPATIBLE_MODES, MODEL_FAMILY, PROFILE_GROUP, MODEL_VARIANT
- **Advanced (54):** All other launcher.sh parameters

**Features:**
- Form with dropdowns/inputs, default values for each parameter
- Save as .env file to `profiles/user/` directory
- Auto-generate name based on parameters + manual edit
- Default template: `int8kv-256K-nomtp-text-only`
- Profile diff (side-by-side comparison with highlighted differences)
- Dry-run (validate parameters without starting vLLM)
- One-click rollback to last successful profile

### 4.2 Batch Rotation Comparison

**Select multiple profiles → Auto-start each → Benchmark → Compare results.**

**Flow:**
1. User selects N profiles (any number)
2. System starts vLLM with profile 1
3. Waits for ready (~5 min)
4. Runs benchmark (3 prompts × configurable rounds)
5. Records results
6. Stops vLLM
7. Repeats for profiles 2..N
8. Shows comparison table + charts

**Features:**
- Progress bar showing current profile / total
- Error handling: record error, continue to next profile
- Browser notification + UI status on completion
- Export results to CSV/JSON + clipboard

### 4.3 vLLM /metrics Real-time Monitoring

**Poll vLLM Prometheus endpoint every 2 seconds.**

**Metrics tracked:**
- `vllm:num_requests_running` — Active requests
- `vllm:num_requests_waiting` — Queue depth
- `vllm:kv_cache_usage_perc` — KV cache usage (0-1)
- `vllm:prompt_tokens` — Cumulative prefill tokens
- `vllm:generation_tokens` — Cumulative generation tokens
- `vllm:time_to_first_token_seconds` — TTFT histogram (p50/p90/p99)
- `vllm:inter_token_latency_seconds` — Inter-token latency histogram
- `vllm:e2e_request_latency_seconds` — E2E latency histogram
- `vllm:prefix_cache_hits` / `vllm:prefix_cache_queries` — Prefix cache hit rate
- `vllm:num_preemptions` — Cumulative preemptions

**Derived metrics:**
- tok/s = delta(prompt_tokens + generation_tokens) / delta(time)
- KV cache warning = kv_cache_usage_perc > 0.85

### 4.4 Simple Chat

**Quick test interface with latency stats.**

- Text input + streaming response
- Display: first token latency (TTFT), tok/s
- No tool calling, no history management, no sampling parameter control

### 4.5 Benchmark Panel

**Manual + batch benchmarking.**

**Prompts:**
- Short: 17 tokens
- Medium: 313 tokens
- Long: 3212 tokens
- Custom: user-defined text

**Metrics:**
- tok/s
- First token latency (TTFT)
- Total time
- Prompt tokens, generation tokens

**Features:**
- Warm-up: 1-2 runs before official measurement
- Configurable rounds (1/3/5/10)
- History: past runs with profile + results
- Charts: bar chart (tok/s comparison), line chart (history)

### 4.6 Startup Error Analysis + Repair Suggestions

**Diagnose vLLM startup failures with actionable fixes.**

| Error Pattern | Diagnosis | Repair Suggestion |
|---------------|-----------|-------------------|
| `OutOfMemoryError` (startup) | Model + workspace exceeds GPU memory | Reduce GPU_UTIL by 0.05 |
| `OutOfMemoryError` (runtime) | KV cache full | Reduce MAX_NUM_SEQS or MAX_MODEL_LEN |
| `CUDA out of memory` | Single GPU OOM | Check GPU utilization balance |
| `Workspace allocation failed` | int8kv prefill workspace | Disable VLLM_INT8KV_FA_PREFILL |
| `Address already in use :8000` | Port occupied | List occupying processes, suggest PORT change |

**Features:**
- Error detail panel with 50-line log context
- One-click "Apply Fix" button (writes new profile)

### 4.7 GPU Hardware Monitoring

**Monitor GPU state with pynvml.**

**Metrics:**
- Temperature, power draw, SM clock, memory used/total, utilization
- Throttle reasons (HW_SLOWDOWN, SW_THERMAL, SYNC_BOOST, etc.)
- Display mode detection (warns if desktop process using GPU)
- Dual GPU side-by-side comparison
- GPU memory fragmentation detection

**Display GPU Warning:**
- Detects Xorg, Xwayland, gnome-shell, kwin, plasmashell, Hyprland, sway, gdm, sddm, lightdm
- Shows warning badge on GPU card

### 4.8 Experiment Tracking

**Persistent record of all optimization runs.**

**Data recorded per experiment:**
- Profile configuration (snapshot)
- Start duration
- Benchmark results (tok/s, TTFT per prompt size)
- Status (success/error)
- Timestamp
- User notes

**Storage:** `run-logs/experiments.json`

**Views:**
- Timeline view (each run as a row)
- Table view (sortable, filterable)

### 4.9 Log Enhancement

**Rich log viewer with search and navigation.**

- Live log stream via SSE
- Full-text search (Ctrl+F)
- Jump to error (one-click定位 OOM/CUDA error lines)
- Download complete log file
- Log folding by stage (collapse/expand sections)
- Color coding: errors (red), warnings (yellow), info (cyan)

### 4.10 Process Management

**Restart endpoint + port 9090.**

- `POST /api/server/restart` — stop + start in one call
- Port 9090 (replaces old tower)
- Startup progress bar (7 stages: init/weights/profile/kv/cuda/compile/server)
- Graceful shutdown: SIGTERM → 30s → SIGKILL → cleanup workers

### 4.11 Toast Notifications

**4 types, top-right corner.**

- Success (green): startup complete, benchmark complete, profile saved
- Error (red): OOM, CUDA error, port conflict
- Warning (yellow): KV >85%, GPU temp >80, throttle active
- Info (blue): status changes, progress updates

### 4.12 Profile Diff / Dry-run / Rollback

**Configuration management utilities.**

- Diff: side-by-side comparison of two profiles with highlighted differences
- Dry-run: validate parameters without starting vLLM (check GPU memory, port availability)
- Rollback: one-click start with last successful profile

---

## 5. UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌─────────────────────────────────────────────┐│
│ │ Dashboard │ │                                             ││
│ │ Profiles  │ │         Dynamic Content Area                ││
│ │ Benchmark │ │         (switches based on sidebar)         ││
│ │ Logs      │ │                                             ││
│ │ Settings  │ │                                             ││
│ └──────────┘ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Sidebar:** 5 fixed items (Dashboard, Profiles, Benchmark, Logs, Settings)

**Dashboard page:**
- Server status card (status badge, PID, uptime, profile, port)
- Action buttons (Start, Stop, Restart, Kill)
- Startup progress bar (when loading)
- vLLM /metrics panel (KV cache, requests, tok/s)
- GPU cards (2 GPUs side-by-side)
- Recent log lines

**Profiles page:**
- Profile card grid with tags
- Create New button → Profile form
- Profile form: grouped flat display (Core/Metadata/Advanced)
- Diff view for comparing profiles

**Benchmark page:**
- Manual mode: select profile + prompt size + rounds → run
- Batch mode: select multiple profiles → auto-run → comparison table + charts
- Result table: profile params + tok/s + TTFT + status
- Charts: bar chart (tok/s), line chart (history)

**Logs page:**
- Live log stream
- Search input
- Jump to error button
- Download button
- Fold by stage

**Settings page:**
- All config.json fields editable

---

## 6. Technical Details

### 6.1 vLLM Startup

v3 replaces launcher.sh by learning its startup logic and reimplementing in Node.js.

**Startup flow:**
1. Read profile .env file
2. Build vLLM command: `python3 -m vllm.entrypoints.openai.api_server` with all parameters
3. Set environment variables (PYTORCH_CUDA_ALLOC_CONF, VLLM_INT8KV_FA_*, etc.)
4. Spawn process with `detached: true`
5. Pipe stdout/stderr to log file
6. Monitor log for stage transitions
7. Poll `/health` endpoint for ready state

**vLLM command building:**
- Parse all 65 parameters from profile
- Map to vLLM CLI flags
- Set environment variables for non-CLI parameters

### 6.2 vLLM /metrics Scraping

- Poll `http://localhost:8000/metrics` every 2 seconds
- Parse Prometheus exposition format
- Compute derived metrics (tok/s, TTFT percentiles)
- Store time-series in memory (last 5 min)
- Push via SSE to frontend

### 6.3 GPU Monitoring

- Poll `nvidia-smi` every 2 seconds
- Parse `nvidia-smi -q` for throttle reasons
- Detect display processes via `fuser /dev/nvidia*`
- Push via SSE to frontend

### 6.4 Profile Storage

- Profiles stored as .env files in `profiles/` directory
- User-created profiles in `profiles/user/`
- v3 reads/writes .env format (compatible with launcher.sh)
- Profile form generates .env content

### 6.5 Experiment Storage

- Experiments stored in `run-logs/experiments.json`
- Append-only log
- Each experiment: id, timestamp, profile snapshot, start duration, benchmark results, status, notes

---

## 7. What We're NOT Building

- ❌ Authentication (single-user LAN)
- ❌ Swagger /docs
- ❌ Multi-vLLM-instance support
- ❌ Remote access / mobile UI
- ❌ Playground integration (v3 replaces it)
- ❌ Sleep Mode support (not needed)
- ❌ Other vLLM versions/forks

---

## 8. Open Questions

None. All decisions made in brainstorm.
