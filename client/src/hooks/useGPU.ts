import { useState } from 'react';
import { useSSE } from './useSSE';
import type { GPUInfo } from '../types';

export function useGPU() {
  const [gpus, setGpus] = useState<GPUInfo[]>([]);
  useSSE<GPUInfo[]>('/gpu/stream', {
    onMessage: setGpus,
    onError: () => setGpus([]),
  });
  return gpus;
}
