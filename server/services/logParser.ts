export interface LogStage {
  id: string;
  label: string;
  pattern: RegExp;
  progressStart: number;
  progressEnd: number;
}

export const STAGES: LogStage[] = [
  { id: 'init',      label: 'Initializing',          pattern: /Initializing a VLLM/i,                                           progressStart: 0,  progressEnd: 5  },
  { id: 'weights',   label: 'Loading model weights', pattern: /Loading model|Loading weights|model loading/i,                   progressStart: 5,  progressEnd: 25 },
  { id: 'profile',   label: 'Profiling memory',       pattern: /profiled|Memory profiling|GPU memory|determining.*memory/i,      progressStart: 25, progressEnd: 45 },
  { id: 'cudagraph', label: 'Capturing CUDA graphs',  pattern: /Capturing CUDA graphs?|cudagraph capture/i,                      progressStart: 45, progressEnd: 55 },
  { id: 'kvcache',   label: 'Allocating KV cache',   pattern: /^(?!.*CUDA graph).*KV cache memory|^(?!.*CUDA graph).*Allocating KV|token blocks|Memory pool/i, progressStart: 55, progressEnd: 65 },
  { id: 'compile',   label: 'Compiling kernels',      pattern: /Compiling|torch\.compile/i,                                       progressStart: 65, progressEnd: 85 },
  { id: 'server',    label: 'Starting server',        pattern: /Uvicorn|startup complete|listening on/i,                          progressStart: 85, progressEnd: 95 },
];

// Error patterns (returns null from parseLine but detected separately)
export const ERROR_PATTERNS: RegExp[] = [
  /OutOfMemoryError/i,
  /CUDA error/i,
  /EngineDeadError/i,
  /EngineCore failed/i,
  /Traceback \(most recent call last\)/,
];

export function isErrorLine(line: string): boolean {
  return ERROR_PATTERNS.some(p => p.test(line));
}

/**
 * Parse a single log line. Returns the matching stage, or null if no match.
 */
export function parseLine(line: string): LogStage | null {
  for (const stage of STAGES) {
    if (stage.pattern.test(line)) return stage;
  }
  return null;
}

/**
 * Try to extract a real percentage from tqdm-style progress bars in log lines.
 * Matches patterns like: "100%|██████████| 100/100" or "(50%)" or "50.0%"
 * Returns 0-100 if found, null otherwise.
 */
export function extractProgressPercent(line: string): number | null {
  // tqdm bar: "100%|" or " 50%|"
  const tqdmMatch = line.match(/(\d+(?:\.\d+)?)\s*%\s*[|█]/);
  if (tqdmMatch) {
    const pct = parseFloat(tqdmMatch[1]);
    if (pct >= 0 && pct <= 100) return pct;
  }
  // Explicit percentage: "50.0%" or "(50%)"
  const pctMatch = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*%(?:\s|$|\))/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (pct >= 0 && pct <= 100) return pct;
  }
  return null;
}

/**
 * Find the latest completed stage for a set of log lines.
 */
export function findLatestStage(lines: string[]): LogStage | null {
  let latest: LogStage | null = null;
  for (const line of lines) {
    const stage = parseLine(line);
    if (stage) latest = stage;
  }
  return latest;
}

/**
 * Interpolate progress within a stage. If a real percent is available from
 * the log line, use it; otherwise fall back to time-based estimation.
 */
export function interpolateProgress(stage: LogStage, secondsInStage: number, realPercent?: number | null): number {
  if (realPercent != null && stage.id === 'weights') {
    // For model loading, map tqdm 0-100% onto the stage's progress range
    const range = stage.progressEnd - stage.progressStart;
    return Math.round(stage.progressStart + (realPercent / 100) * range);
  }
  // Fallback: time-based estimation (60s per stage)
  const duration = 60;
  const t = Math.min(1, secondsInStage / duration);
  return Math.round(stage.progressStart + (stage.progressEnd - stage.progressStart) * t);
}
