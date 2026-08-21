import { useState } from 'react';
import { useSSE } from './useSSE';
import type { GPUInfo } from '../types';

export function useGPU() {
  const [gpus, setGpus] = useState<GPUInfo[]>([]);
  const [stale, setStale] = useState(false);
  useSSE<GPUInfo[]>('/gpu/stream', {
    onMessage: (data) => { setGpus(data); setStale(false); },
    // H8: Don't clear GPU data on transient disconnects — just mark stale
    onError: () => setStale(true),
  });
  return { gpus, stale };
}
