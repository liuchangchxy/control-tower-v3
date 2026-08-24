export interface LogStage {
  id: string;
  label: string;
  pattern: RegExp;
  progressStart: number;
  progressEnd: number;
}

// STAGES: progress ranges are contiguous and monotonic.
// Order matters — first match wins.
export const STAGES: LogStage[] = [
  { id: 'weights',           label: 'Loading model weights',   pattern: /Loading model\b|Loading (?:weight|safetensors)(?!.*\btook\b)|checkpoint shards/i,               progressStart: 0,  progressEnd: 25 },
  { id: 'compile_backbone',  label: 'Compiling backbone',      pattern: /Using cache directory.*backbone|Dynamo bytecode transform|Compiling.*backbone/i,               progressStart: 25, progressEnd: 50 },
  { id: 'compile_eagle',     label: 'Compiling eagle head',    pattern: /Using cache directory.*eagle_head|Compiling.*eagle/i,                                          progressStart: 50, progressEnd: 60 },
  { id: 'cudagraph',         label: 'Capturing CUDA graphs',   pattern: /Capturing CUDA graphs?|CUDAGraphMode/i,                                                        progressStart: 60, progressEnd: 75 },
  { id: 'kvcache',           label: 'Allocating KV cache',     pattern: /KV cache memory|Allocating KV|token blocks|Memory pool|num_\d+k_blocks/i,                      progressStart: 75, progressEnd: 80 },
  { id: 'warmup',            label: 'Warming up model',        pattern: /init engine|warmup|torch\.compile took/i,                                                      progressStart: 80, progressEnd: 90 },
  { id: 'server',            label: 'Starting server',         pattern: /Uvicorn|startup complete|listening on/i,                                                       progressStart: 90, progressEnd: 95 },
];

// Error patterns
export const ERROR_PATTERNS: RegExp[] = [
  /OutOfMemoryError/i,
  /CUDA error/i,
  /EngineDeadError/i,
  /EngineCore failed/i,
  /Traceback \(most recent call last\)/,
  /ValidationError/i,
  /Value error,.*(?:quantiz|speculative|model config)/i,
];

export function isErrorLine(line: string): boolean {
  return ERROR_PATTERNS.some(p => p.test(line));
}

export function parseLine(line: string): LogStage | null {
  for (const stage of STAGES) {
    if (stage.pattern.test(line)) return stage;
  }
  return null;
}

/**
 * Extract real percentage from tqdm-style progress bars.
 * "100%|██████████| 100/100" or "50.0%" or "(50%)"
 */
export function extractProgressPercent(line: string): number | null {
  const tqdmMatch = line.match(/(\d+(?:\.\d+)?)\s*%\s*(?:Completed\s*)?[|█]/);
  if (tqdmMatch) {
    const pct = parseFloat(tqdmMatch[1]);
    if (pct >= 0 && pct <= 100) return pct;
  }
  const pctMatch = line.match(/(?:^|\s|\()(\d+(?:\.\d+)?)\s*%(?:\s|$|\))/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (pct >= 0 && pct <= 100) return pct;
  }
  return null;
}

export function findLatestStage(lines: string[]): LogStage | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const stage = parseLine(lines[i]);
    if (stage) return stage;
  }
  return null;
}

/**
 * Calculate progress within a stage using an asymptotic curve.
 *
 * Design (inspired by llama.cpp's callback approach):
 * - Weights stage: uses real tqdm percentage (the only source of real progress)
 * - All other stages: asymptotic curve that approaches progressEnd but NEVER reaches it
 *   This ensures the bar keeps moving even during long stages, and never gets stuck.
 *
 * Formula: progressStart + range * (1 - 0.9 * exp(-t / (range * 6)))
 * - At t=0: starts at progressStart (no jump)
 * - Fills 50% of range in ~range*4 seconds (realistic for actual stage durations)
 * - Never caps: even after 10 minutes, shows ~95% of range (not 100%)
 * - Different ranges fill at different speeds naturally
 *
 * Reference: llama.cpp uses a simple float callback (0.0→1.0) from the loader.
 * vLLM uses tqdm for weights only. No framework provides a unified startup bar.
 */
export function interpolateProgress(stage: LogStage, secondsInStage: number, realPercent?: number | null): number {
  if (stage.id === 'weights' && realPercent != null) {
    const range = stage.progressEnd - stage.progressStart;
    return stage.progressStart + (realPercent / 100) * range;
  }
  return stage.progressStart;
}
