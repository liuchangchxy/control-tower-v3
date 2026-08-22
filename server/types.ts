// Re-export all shared types
export type { ServerStatus, Diagnosis, VLLMProcess, ProgressEvent, GPUInfo, ProfileConfig, ProfileSummary, ApiResponse, Experiment, BenchmarkResult, VLLMMetrics, BenchmarkPreset, DetailedBenchmarkResult } from '../shared/types.js';

// ── Server-only: Process state (persisted to state.json) ──────────────────

export interface PersistedState {
  pid: number | null;
  profile: string | null;
  profilePath: string | null;
  logFile: string | null;
  startedAt: number | null;
  servedName: string | null;
  port: number;
}
