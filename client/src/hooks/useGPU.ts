import { useRef, useCallback, useState } from 'react';
import { useSSE } from './useSSE';
import type { GPUInfo } from '../types';

/**
 * EMA smoothing for GPU metrics to prevent visual jumping.
 * nvidia-smi values fluctuate naturally, especially during compilation
 * when CUDA allocates/frees memory frequently.
 * α=0.3 means ~3 samples to converge to a new stable value.
 */
function smoothGPU(prev: GPUInfo | undefined, next: GPUInfo, alpha = 0.3): GPUInfo {
  if (!prev) return next;
  return {
    ...next,
    memoryUsed: prev.memoryUsed + alpha * (next.memoryUsed - prev.memoryUsed),
    utilization: prev.utilization + alpha * (next.utilization - prev.utilization),
    temperature: prev.temperature + alpha * (next.temperature - prev.temperature),
    powerDraw: prev.powerDraw + alpha * (next.powerDraw - prev.powerDraw),
  };
}

export function useGPU() {
  const [gpus, setGpus] = useState<GPUInfo[]>([]);
  const [stale, setStale] = useState(false);
  const prevRef = useRef<GPUInfo[]>([]);

  const onMessage = useCallback((data: GPUInfo[]) => {
    const smoothed = data.map((gpu, i) => smoothGPU(prevRef.current[i], gpu));
    prevRef.current = smoothed;
    setGpus(smoothed);
    setStale(false);
  }, []);

  useSSE<GPUInfo[]>('/gpu/stream', {
    onMessage,
    // H8: Don't clear GPU data on transient disconnects — just mark stale
    onError: () => setStale(true),
  });
  return { gpus, stale };
}
