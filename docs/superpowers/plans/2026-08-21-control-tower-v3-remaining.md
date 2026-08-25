# Control Tower v3 — Remaining 15 Features Plan

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Implement 15 remaining features from the v3 checklist.

**Spec:** `docs/superpowers/specs/2026-08-21-control-tower-v3-remaining.md`

## Global Constraints

- Project: Windows checkout for source editing; canonical Debian checkout `/home/chang/vllm-2080ti-control-panel` for testing, building, and deployment
- TypeScript strict mode
- All tests must pass after each task
- Deploy to debian103 after each batch

---

## Batch 1: Backend + Simple Fixes

### Task 1: TTFT Histogram Parsing

**Files:** Modify `server/services/vllmMetrics.ts`

- [ ] Parse `vllm:time_to_first_token_seconds_bucket{le="..."}` lines
- [ ] Compute p50/p90/p99 from cumulative bucket counts
- [ ] Update `parsePrometheusMetrics` to populate ttftP50/P90/P99
- [ ] Run tests, commit

### Task 2: KV Cache Warning

**Files:** Modify `server/services/vllmMetrics.ts`, `server/types.ts`

- [ ] Add `kvCacheWarning: boolean` to `VLLMMetrics`
- [ ] Set `kvCacheWarning = kvCacheUsagePerc > 0.85`
- [ ] Run tests, commit

### Task 3: Port Conflict Process List

**Files:** Modify `server/services/errorAnalyzer.ts`

- [ ] When `Address already in use` detected, run `ss -tlnp | grep PORT`
- [ ] Parse PID + process name from output
- [ ] Return in `Diagnosis.context`
- [ ] Run tests, commit

### Task 4: Error Context 50 Lines

**Files:** Modify `server/services/errorAnalyzer.ts`

- [ ] Add `context: string[]` field to `Diagnosis`
- [ ] In `analyzeError`, find error line index, extract ±25 lines
- [ ] Run tests, commit

### Task 5: Port 9090 Config

**Files:** `config.json` on debian103

- [ ] Change port to 9090 in config.json
- [ ] Restart server

---

## Batch 2: Frontend Basic Components

### Task 6: Loading Overlay

**Files:** Create `client/src/components/LoadingOverlay.tsx`

- [ ] Full-screen overlay with spinner + status text
- [ ] Show when server status is 'starting' or 'loading'
- [ ] Integrate into DashboardPage
- [ ] Commit

### Task 7: Status Change Highlight

**Files:** Modify `client/src/components/GPUStats.tsx`

- [ ] Add CSS animation for temp >80°C (red flash)
- [ ] Add CSS animation for KV cache >85% (yellow flash)
- [ ] Commit

### Task 8: One-Click Rollback

**Files:** Modify `client/src/components/ServerControl.tsx`

- [ ] Add "Rollback" button
- [ ] Find last successful profile from experiments
- [ ] Start vLLM with that profile
- [ ] Commit

### Task 9: One-Click Apply Fix

**Files:** Modify `client/src/components/ServerControl.tsx`

- [ ] Show "Apply Fix" buttons when error diagnosis has repairs
- [ ] Click → write profile to user/ → prompt restart
- [ ] Commit

---

## Batch 3: Chat + Export

### Task 10: Chat UI

**Files:** Create `client/src/pages/ChatPage.tsx`, `client/src/components/ChatMessage.tsx`

- [ ] Chat page with message list + input
- [ ] Streaming response via fetch to `/v1/chat/completions`
- [ ] Add route and sidebar nav
- [ ] Commit

### Task 11: Chat TTFT + tok/s

**Files:** Modify `client/src/components/ChatMessage.tsx`

- [ ] Measure TTFT from first chunk timestamp
- [ ] Compute tok/s from token count / elapsed time
- [ ] Display below each assistant message
- [ ] Commit

### Task 12: CSV/JSON Export

**Files:** Modify `client/src/components/BenchmarkBatch.tsx`

- [ ] Add "Export CSV" and "Export JSON" buttons
- [ ] Add "Copy to clipboard" button
- [ ] Generate downloadable files
- [ ] Commit

---

## Batch 4: Experiment Views

### Task 13: Experiment Timeline

**Files:** Create `client/src/components/ExperimentTimeline.tsx`, modify `client/src/pages/DashboardPage.tsx` or new page

- [ ] Vertical timeline with experiment cards
- [ ] Each card: timestamp, profile, status, tok/s
- [ ] Click to expand details
- [ ] Commit

### Task 14: Experiment Table

**Files:** Create `client/src/components/ExperimentTable.tsx`

- [ ] Sortable, filterable table
- [ ] Columns: timestamp, profile, status, tok/s, TTFT, notes
- [ ] Filter by status, date range
- [ ] Commit

---

## Batch 5: Table Enhancement

### Task 15: Column Drag Reorder

**Files:** Modify `client/src/components/BenchmarkBatch.tsx`

- [ ] Add drag handles to table headers
- [ ] Save column order to localStorage
- [ ] Load on mount
- [ ] Commit
