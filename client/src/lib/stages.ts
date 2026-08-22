export interface LogStage {
  id: string;
  label: string;
  pattern: RegExp;
  progressStart: number;
  progressEnd: number;
}

// Mirror of server STAGES — must stay in sync with server/services/logParser.ts
export const STAGES: LogStage[] = [
  { id: 'weights',           label: 'Loading model weights',   pattern: /Loading model\b|Loading (?:weight|safetensors)(?!.*\btook\b)|checkpoint shards/i,               progressStart: 0,  progressEnd: 25 },
  { id: 'compile_backbone',  label: 'Compiling backbone',      pattern: /Using cache directory.*backbone|Dynamo bytecode transform|Compiling.*backbone/i,               progressStart: 25, progressEnd: 50 },
  { id: 'compile_eagle',     label: 'Compiling eagle head',    pattern: /Using cache directory.*eagle_head|Compiling.*eagle/i,                                          progressStart: 50, progressEnd: 60 },
  { id: 'cudagraph',         label: 'Capturing CUDA graphs',   pattern: /Capturing CUDA graphs?|CUDAGraphMode/i,                                                        progressStart: 60, progressEnd: 75 },
  { id: 'kvcache',           label: 'Allocating KV cache',     pattern: /KV cache memory|Allocating KV|token blocks|Memory pool|num_\d+k_blocks/i,                      progressStart: 75, progressEnd: 80 },
  { id: 'warmup',            label: 'Warming up model',        pattern: /init engine|warmup|torch\.compile took/i,                                                      progressStart: 80, progressEnd: 90 },
  { id: 'server',            label: 'Starting server',         pattern: /Uvicorn|startup complete|listening on/i,                                                       progressStart: 90, progressEnd: 95 },
];

export function parseLine(line: string): LogStage | null {
  for (const stage of STAGES) {
    if (stage.pattern.test(line)) return stage;
  }
  return null;
}
