export interface Stage {
  id: string;
  label: string;
  progressStart: number;
  progressEnd: number;
}

// Must match server/services/logParser.ts STAGES exactly
export const STAGES: Stage[] = [
  { id: 'init',      label: 'Initializing',          progressStart: 0,  progressEnd: 5 },
  { id: 'weights',   label: 'Loading model weights',  progressStart: 5,  progressEnd: 25 },
  { id: 'profile',   label: 'Profiling memory',       progressStart: 25, progressEnd: 45 },
  { id: 'cudagraph', label: 'Capturing CUDA graphs',  progressStart: 45, progressEnd: 55 },
  { id: 'kvcache',   label: 'Allocating KV cache',    progressStart: 55, progressEnd: 65 },
  { id: 'compile',   label: 'Compiling kernels',      progressStart: 65, progressEnd: 85 },
  { id: 'server',    label: 'Starting server',        progressStart: 85, progressEnd: 95 },
];
