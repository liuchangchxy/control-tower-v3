// ── Shared types for Control Tower v3 ─────────────────────────────────────
// Single source of truth for types used by both server and client.
// server/types.ts and client/src/types.ts re-export from here.

// ── Server state ────────────────────────────────────────────────────────────

export type ServerStatus = 'stopped' | 'starting' | 'loading' | 'ready' | 'stopping' | 'killing' | 'unknown' | 'error';

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
  pgid?: number | null;
  profile: string | null;
  profilePath: string | null;
  status: ServerStatus;
  lifecyclePhase?: string | null;
  lifecycleOperationStartedAt?: number | null;
  startedAt: number | null;
  uptime: number;
  healthDetail: string;
  progress: number;
  progressKnown?: boolean;
  logFile: string | null;
  error: string | null;
  errorDiagnosis: Diagnosis | null;
  servedName: string | null;
  port: number;
  runId?: string | null;
  eventLog?: string | null;
  stdoutFile?: string | null;
  stderrFile?: string | null;
  lastRuntimeObservationAt?: number | null;
  exitCode?: number | null;
  exitSignal?: string | null;
  postmortemDir?: string | null;
  /** Evidence reported by the canonical launcher, when supported. */
  launcherRevision?: string | null;
  launcherCapabilities?: {
    protocolVersion: number;
    launcherRevision?: string;
    profileRef?: string;
    backends?: {
      flashqlaLegacy?: boolean;
      flashinfer?: boolean;
      turboquant?: boolean;
      mtp?: boolean;
    };
  } | null;
  backend?: {
    selected: string | null;
    active: boolean | null;
    source: 'launcher' | 'log' | null;
    detail: string | null;
  } | null;
  /** Evidence from an identity-scoped runtime reconciliation probe. */
  runtimeEvidence?: {
    state: 'present' | 'absent' | 'indeterminate';
    pid: number | null;
    pgid: number | null;
    port: number;
    apiReachable: boolean;
    modelMatches: boolean;
    processMatches: boolean;
    detail: string;
  } | null;
  /** Whether the configured model API is verified and usable for chat. */
  apiAvailable?: boolean;
  /** Current scraping health; zero values are not used as an unavailable sentinel. */
  metricsAvailable?: boolean;
  metricsError?: string | null;
  metricsSampleAgeMs?: number | null;
  metricsSource?: string | null;
  /** Last lifecycle operation and whether launcher postcondition was confirmed. */
  lifecycleAction?: 'stop' | 'kill' | null;
  lifecycleError?: string | null;
  lifecycleConfirmed?: boolean;
}

// ── Progress events (SSE) ───────────────────────────────────────────────────

export interface ProgressEvent {
  stage: string;
  label: string;
  progress: number;
  stageProgress: number; // 0-100 within the current stage
  progressKnown?: boolean;
  elapsedMs?: number;
  status: 'active' | 'completed' | 'error';
  message?: string;
  timestamp: number;
}

// ── GPU monitoring ──────────────────────────────────────────────────────────

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

// ── System (CPU/RAM) monitoring ─────────────────────────────────────────

export interface SystemInfo {
  cpuUsage: number;        // 0-100
  cpuTemp: number | null;  // Celsius or null
  ramTotal: number;        // MB
  ramUsed: number;         // MB
  ramUsage: number;        // 0-100
  swapTotal: number;       // MB
  swapUsed: number;        // MB
  swapUsage: number;       // 0-100
}

// ── Profile config (superset — server uses subset, client uses full) ───────

export interface ProfileConfig {
  // Core (required)
  SERVED_NAME: string;
  MODEL_FAMILY: string;
  MODEL_VARIANT: string;
  GPU_UTIL: number;
  MAX_MODEL_LEN: number;
  MTP_K: number;
  PROFILE_GROUP: string;
  COMPATIBLE_MODES: string;
  KV_CACHE_DTYPE: string;
  MAX_BATCHED_TOKENS: number;
  MAX_NUM_SEQS: number;
  VLLM_INT8KV_FA_PREFILL: number;
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_DEQUANT: number;
  ENABLE_AUTO_TOOL_CHOICE: number;
  TOOL_CALL_PARSER: string;
  LANGUAGE_MODEL_ONLY: number;
  SKIP_MM_PROFILING: number;

  // Optional — model
  MODEL_PATH?: string;
  TP_SIZE?: number;
  PORT?: number;

  // Optional — memory
  GPU_MEMORY_UTILIZATION?: number;
  DISABLE_CUSTOM_ALL_REDUCE?: number;
  CPU_OFFLOAD_GB?: number;
  MAX_SWA_LEN?: number;
  BLOCK_SIZE?: number;

  // Optional — scheduling
  MAX_SCHEDULING_BATCH_TOKENS?: number;
  SCHEDULER_POLICY?: string;
  PREEMPTION_MODE?: string;
  SWAP_SPACE_GB?: number;
  SWAP_SPACE_CPU?: number;
  PRIORITY_FAIROFF_ENABLED?: number;
  PRIORITY_SCALEDOWN_ENABLED?: number;

  // Optional — attention
  VLLM_INT8KV_FA_CASCADE_TILE_TOKENS?: number;
  ATTENTION_BACKEND?: string;
  PREFIX_CACHING?: number;

  // Optional — speculative decoding
  SPECULATIVE_MODEL?: string;
  NUM_SPECULATIVE_TOKENS?: number;
  DRAFT_TENSOR_PARALLEL_SIZE?: number;
  DRAFT_MODEL_TP_SIZE?: number;
  SPECULATIVE_DECODE_METHOD?: string;

  // Optional — tool calling
  TOOL_CALL_PARSER_PATH?: string;
  TOOL_CALL_LIMIT?: number;

  // Optional — compilation
  COMPILATION_CONFIG_JSON?: string;
  ADDITIONAL_CONFIG_JSON?: string;
  ENABLE_PREFIX_CACHING_COMPILE?: number;
  VLLM_ATTENTION_BACKEND_COMPILE?: string;
  TORCH_COMPILE_CACHE_DIR?: string;
  DISABLE_COMPILE_CACHE?: number;

  // Optional — system
  SYSTEM_PROMPT?: string;
  CHAT_TEMPLATE?: string;
  TRUST_REMOTE_CODE?: number;

  // Optional — runtime
  CUDA_VISIBLE_DEVICES?: string;
  VLLM_HOST_IP?: string;
  VLLM_RPC_BASE_URL?: string;
  RAY_ADDRESS?: string;
  RAY_OBJECT_STORE_MEMORY?: number;

  // Optional — logging & API
  VLLM_LOGGING_LEVEL?: string;
  ENABLE_REQUEST_LOGGING?: number;
  LOG_STATS?: number;
  ENABLE_PROMPT_TOKEN_COUNTS?: number;
  API_KEY?: string;

  // Optional — misc
  MULTI_VLM?: number;
  VLM_INPUT_TYPE?: string;
  SKIP_MODEL_INIT?: number;
  LOAD_FORMAT?: string;
  QUANTIZATION?: string;

  // Optional — multimodal
  MESSAGE_TYPE?: string;      // "text-only" | "text+image"
  MM_LIMIT_JSON?: string;     // e.g. '{"image":1,"video":0,"audio":0}'
}

export interface ProfileSummary {
  name: string;
  path: string;
  writable: boolean;
  fields: Partial<ProfileConfig>;
}

// ── API response shape ──────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Experiments ─────────────────────────────────────────────────────────────

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

// ── Benchmark results ───────────────────────────────────────────────────────

export interface BenchmarkResult {
  size: 'short' | 'medium' | 'long' | 'custom';
  promptTokens: number;
  generationTokens: number;
  tokPerSec: number;
  ttftMs: number;
  totalTimeMs: number;
  rounds: number;
}

// ── Live vLLM metrics ──────────────────────────────────────────────────────

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
  metricsAvailable?: boolean;
  metricsError?: string | null;
  metricsSampleAgeMs?: number | null;
  metricsSource?: string | null;
}

// ── Benchmark presets (client-side, also used by server route) ─────────────

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
