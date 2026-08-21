// Client-local type declarations — mirrors a subset of server/types.ts
// so hooks can use them without importing Node.js server code.

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
  profile: string | null;
  profilePath: string | null;
  status: ServerStatus;
  startedAt: number | null;
  healthDetail: string;
  progress: number;
  logFile: string | null;
  error: string | null;
  errorDiagnosis: Diagnosis | null;
  servedName: string | null;
  port: number;
  uptime: number;
}

export interface ProgressEvent {
  progress: number;
  stage: string;
  label: string;
  status?: 'active' | 'completed' | 'error';
  message?: string;
  timestamp?: number;
}

export interface GPUInfo {
  index: number;
  name: string;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  smClock: number;
  memoryUsed: number;
  memoryTotal: number;
  utilization: number;
  eccErrors: number;
  throttleReasons: string[];
}

// ── 65-parameter ProfileConfig (v3) ───────────────────────────────────────────

export interface ProfileConfig {
  // ── Core (6) ────────────────────────────────────────────────────────────
  SERVED_NAME: string;
  MODEL_FAMILY: string;
  MODEL_VARIANT: string;          // "int4" | "fp8"
  GPU_UTIL: number;               // 0.0-1.0
  MAX_MODEL_LEN: number;
  MTP_K: number;                  // 0 = disabled

  // ── Metadata (5) ────────────────────────────────────────────────────────
  PROFILE_GROUP: string;
  MODEL_PATH?: string;
  TP_SIZE?: number;               // default 2
  PORT?: number;                  // default 8000
  COMPATIBLE_MODES: string;       // "normal" | "mm" | "all"

  // ── Advanced: Memory (7) ────────────────────────────────────────────────
  KV_CACHE_DTYPE: string;
  MAX_BATCHED_TOKENS: number;
  MAX_NUM_SEQS: number;
  GPU_MEMORY_UTILIZATION?: number;
  CPU_OFFLOAD_GB?: number;
  MAX_SWA_LEN?: number;
  BLOCK_SIZE?: number;

  // ── Advanced: Scheduling (7) ────────────────────────────────────────────
  MAX_SCHEDULING_BATCH_TOKENS?: number;
  SCHEDULER_POLICY?: string;
  PREEMPTION_MODE?: string;
  SWAP_SPACE_GB?: number;
  SWAP_SPACE_CPU?: number;
  PRIORITY_FAIROFF_ENABLED?: number;
  PRIORITY_SCALEDOWN_ENABLED?: number;

  // ── Advanced: Attention (6) ─────────────────────────────────────────────
  VLLM_INT8KV_FA_PREFILL: number;
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_TILE_TOKENS?: number;
  ATTENTION_BACKEND?: string;
  PREFIX_CACHING?: number;

  // ── Advanced: Speculative Decoding (5) ──────────────────────────────────
  SPECULATIVE_MODEL?: string;
  NUM_SPECULATIVE_TOKENS?: number;
  DRAFT_TENSOR_PARALLEL_SIZE?: number;
  DRAFT_MODEL_TP_SIZE?: number;
  SPECULATIVE_DECODE_METHOD?: string;

  // ── Advanced: Tool Calling (4) ──────────────────────────────────────────
  ENABLE_AUTO_TOOL_CHOICE: number;
  TOOL_CALL_PARSER: string;
  TOOL_CALL_PARSER_PATH?: string;
  TOOL_CALL_LIMIT?: number;

  // ── Advanced: Compilation (5) ───────────────────────────────────────────
  COMPILATION_CONFIG_JSON?: string;
  ENABLE_PREFIX_CACHING_COMPILE?: number;
  VLLM_ATTENTION_BACKEND_COMPILE?: string;
  TORCH_COMPILE_CACHE_DIR?: string;
  DISABLE_COMPILE_CACHE?: number;

  // ── Advanced: System (5) ────────────────────────────────────────────────
  LANGUAGE_MODEL_ONLY: number;
  SKIP_MM_PROFILING: number;
  SYSTEM_PROMPT?: string;
  CHAT_TEMPLATE?: string;
  TRUST_REMOTE_CODE?: number;

  // ── Advanced: Runtime (5) ───────────────────────────────────────────────
  CUDA_VISIBLE_DEVICES?: string;
  VLLM_HOST_IP?: string;
  VLLM_RPC_BASE_URL?: string;
  RAY_ADDRESS?: string;
  RAY_OBJECT_STORE_MEMORY?: number;

  // ── Advanced: Logging & API (5) ─────────────────────────────────────────
  VLLM_LOGGING_LEVEL?: string;
  ENABLE_REQUEST_LOGGING?: number;
  LOG_STATS?: number;
  ENABLE_PROMPT_TOKEN_COUNTS?: number;
  API_KEY?: string;

  // ── Advanced: Misc (5) ──────────────────────────────────────────────────
  MULTI_VLM?: number;
  VLM_INPUT_TYPE?: string;
  SKIP_MODEL_INIT?: number;
  LOAD_FORMAT?: string;
  QUANTIZATION?: string;
}

export interface ProfileSummary {
  name: string;
  path: string;
  writable: boolean;
  fields: Partial<ProfileConfig>;
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

// ── v3: Detailed benchmark (new preset API) ─────────────────────────────────

export interface BenchmarkPreset {
  id: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  description: string;
}

export interface DetailedBenchmarkResult {
  presetId: string;
  inputTokens: number;
  outputTokensRequested: number;
  ttftMs: number;
  tpotMs: number;
  e2eLatencyMs: number;
  throughputTokPerSec: number;
  actualOutputTokens: number;
  promptTokens: number;
  itl: {
    meanMs: number;
    p50Ms: number;
    p90Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  rounds: number;
  perRound: Array<{
    ttftMs: number;
    tpotMs: number;
    e2eLatencyMs: number;
    outputTokens: number;
    itlSamples: number[];
  }>;
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
