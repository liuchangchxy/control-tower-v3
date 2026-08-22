# Control Tower v3 — Remaining 15 Features Spec

**Date:** 2026-08-21
**Status:** Draft
**Based on:** checklist from brainstorm document

---

## Batch 1: Backend + Simple Fixes (5 items)

### 1.1 TTFT Histogram Parsing

**File:** `server/services/vllmMetrics.ts`

Parse `vllm:time_to_first_token_seconds_bucket`, `vllm:time_to_first_token_seconds_count`, `vllm:time_to_first_token_seconds_sum` from Prometheus output. Compute p50/p90/p99 from bucket cumulative counts.

Same for `vllm:inter_token_latency_seconds` and `vllm:e2e_request_latency_seconds`.

### 1.2 KV Cache >85% Warning

**File:** `server/services/vllmMetrics.ts`

Add `kvCacheWarning: boolean` field to `VLLMMetrics`. Set true when `kvCacheUsagePerc > 0.85`. Frontend shows yellow flash on MetricsPanel when true.

### 1.3 Port Conflict: List Occupying Processes

**File:** `server/services/errorAnalyzer.ts`

When `Address already in use` detected, run `lsof -i :PORT` or `ss -tlnp | grep PORT` to get PID + process name. Return in diagnosis.

### 1.4 Error Context 50 Lines

**File:** `server/services/errorAnalyzer.ts`

When any error detected, include 50 lines of log context around the error line in the `Diagnosis.context` field.

### 1.5 Port 9090

**File:** `config.json` on debian103

Change port from 9091 to 9090. Kill mihomo on 9090 first, or use 9091 if mihomo is needed.

---

## Batch 2: Frontend Basic Components (4 items)

### 2.1 Loading Overlay

**File:** `client/src/components/LoadingOverlay.tsx`

Full-screen semi-transparent overlay with spinner + status text. Shows during vLLM startup (status === 'starting' || 'loading'). Dismisses when ready.

### 2.2 Status Change Highlight

**File:** `client/src/components/GPUStats.tsx`

When temperature >80°C, GPU card border flashes red (CSS animation). When KV cache >85%, card border flashes yellow. Add CSS keyframe animations.

### 2.3 One-Click Rollback

**File:** `client/src/components/ServerControl.tsx`

"Rollback" button: loads last successful profile from experiment history, starts vLLM with it. Uses `useExperiments` to find last `status: 'ready'` experiment.

### 2.4 One-Click Apply Fix

**File:** `client/src/components/ServerControl.tsx`

When error diagnosis has `repairs[]`, show "Apply Fix" button for each repair. Click → writes new profile to `user/` → prompts to restart.

---

## Batch 3: Chat + Export (3 items)

### 3.1 Chat UI

**File:** `client/src/pages/ChatPage.tsx`, `client/src/components/ChatMessage.tsx`

- Text input + send button
- Streaming response via SSE to `/v1/chat/completions`
- Message list with user/assistant bubbles
- No history persistence (session only)
- Route: `/chat`, sidebar nav item

### 3.2 Chat TTFT + tok/s Display

**File:** `client/src/components/ChatMessage.tsx`

After each response, display: TTFT (ms), tok/s, total tokens. Computed from streaming timestamps.

### 3.3 CSV/JSON Export

**File:** `client/src/components/BenchmarkBatch.tsx`

"Export" button on batch results. Options: CSV, JSON. Downloads file. Also "Copy to clipboard" button.

---

## Batch 4: Experiment Views (2 items)

### 4.1 Experiment Timeline View

**File:** `client/src/components/ExperimentTimeline.tsx`

Vertical timeline: each experiment as a card with timestamp, profile name, status badge, tok/s summary. Click to expand details.

### 4.2 Experiment Table View

**File:** `client/src/components/ExperimentTable.tsx`

Sortable, filterable table. Columns: timestamp, profile, status, tok/s, TTFT, notes. Filter by status, date range.

---

## Batch 5: Table Enhancement (1 item)

### 5.1 Column Drag Reorder + Persistence

**File:** `client/src/components/BenchmarkBatch.tsx`

Add drag handles to table headers. Save column order to localStorage. Load on mount.
