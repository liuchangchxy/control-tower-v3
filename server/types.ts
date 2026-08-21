// ── Server state ────────────────────────────────────────────────────────────

export type ServerStatus = 'stopped' | 'starting' | 'loading' | 'ready' | 'error';

export interface Diagnosis {
  errorType: string;
  message: string;
  repairs: Array<{
    description: string;
    profilePatch: Partial<ProfileConfig>;
  }>;
  context: string[];
}

export interface VLLMProcess {
  pid: number | null;
  profile: string | null;        // relative path like "qwen27b/normal/int4/foo.env"
  profilePath: string | null;    // absolute path
  status: ServerStatus;
  startedAt: number | null;     // epoch ms
  uptime: number;                // seconds since startedAt
  healthDetail: string;          // e.g. "loading model weights", "compiling kernels"
  progress: number;              // 0-100
  logFile: string | null;
  error: string | null;
  errorDiagnosis: Diagnosis | null;
  servedName: string | null;
  port: number;
}

// ── Progress events (SSE) ───────────────────────────────────────────────────

export interface ProgressEvent {
  stage: string;                 // stage id
  label: string;                 // human-readable
  progress: number;              // 0-100
  status: 'active' | 'completed' | 'error';
  message?: string;              // optional detail
  timestamp: number;             // epoch ms
}

// ── GPU monitoring ──────────────────────────────────────────────────────────

export interface GPUInfo {
  index: number;
  name: string;
  temperature: number;           // °C
  powerDraw: number;             // W
  powerLimit: number;            // W
  smClock: number;               // MHz
  memoryUsed: number;            // MiB
  memoryTotal: number;           // MiB
  utilization: number;           // %
  eccErrors: number;             // uncorrected ECC errors (aggregate total)
  throttleReasons: string[];
}

// ── Profile config ──────────────────────────────────────────────────────────

export interface ProfileConfig {
  // Model
  MODEL_PATH?: string;
  SERVED_NAME: string;
  MODEL_FAMILY: string;
  PROFILE_GROUP: string;
  MODEL_VARIANT: string;          // "int4" | "fp8"

  // Memory
  GPU_UTIL: number;               // 0.0-1.0
  KV_CACHE_DTYPE: string;         // "auto" | "int8_per_token_head"
  MAX_MODEL_LEN: number;
  MAX_BATCHED_TOKENS: number;
  MAX_NUM_SEQS: number;
  TP_SIZE?: number;               // default 2

  // Speculative decoding
  MTP_K: number;                  // 0 = disabled

  // int8kv fast attention
  VLLM_INT8KV_FA_PREFILL: number;
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_TILE_TOKENS?: number;

  // Tool calling
  ENABLE_AUTO_TOOL_CHOICE: number;
  TOOL_CALL_PARSER: string;

  // Compilation
  COMPILATION_CONFIG_JSON?: string;

  // Metadata
  COMPATIBLE_MODES: string;
  LANGUAGE_MODEL_ONLY: number;
  SKIP_MM_PROFILING: number;

  // Server
  PORT?: number;                  // default 8000
}

export interface ProfileSummary {
  name: string;                   // relative path
  path: string;                   // absolute path
  writable: boolean;              // true for user/ profiles
  fields: Partial<ProfileConfig>;
}

// ── API response shape ──────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Process state (persisted to state.json) ─────────────────────────────────

export interface PersistedState {
  pid: number | null;
  profile: string | null;         // relative path
  profilePath: string | null;
  logFile: string | null;
  startedAt: number | null;
  servedName: string | null;
  port: number;
}

// ── v3: Experiments ─────────────────────────────────────────────────────────

export interface Experiment {
  id: string;
  timestamp: number;
  profilePath: string;
  profileSnapshot: Record<string, string | number>;
  startDurationSec: number;
  status: 'running' | 'ready' | 'error';
  errorMessage?: string;
  benchmarkResults?: BenchmarkResult[];
  notes?: string;
}

// ── v3: Benchmark results ───────────────────────────────────────────────────

export interface BenchmarkResult {
  size: 'short' | 'medium' | 'long' | 'custom';
  promptTokens: number;
  generationTokens: number;
  tokPerSec: number;
  ttftMs: number;
  totalTimeMs: number;
  rounds: number;
}

// ── v3: Live vLLM metrics ──────────────────────────────────────────────────

export interface VLLMMetrics {
  numRequestsRunning: number;
  numRequestsWaiting: number;
  kvCacheUsagePerc: number;
  kvCacheWarning: boolean;
  promptTokens: number;
  generationTokens: number;
  tokPerSec: number;
  ttftP50: number;
  ttftP90: number;
  ttftP99: number;
  prefixCacheHitRate: number;
  numPreemptions: number;
  timestamp: number;
}
