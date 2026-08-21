import { useState } from 'react';
import { useSSE } from './useSSE';
import type { VLLMMetrics } from '../types';

export function useMetrics() {
  const [metrics, setMetrics] = useState<VLLMMetrics | null>(null);
  const [stale, setStale] = useState(false);
  useSSE<VLLMMetrics>('/server/metrics/stream', {
    onMessage: (data) => { setMetrics(data); setStale(false); },
    // M20: Track staleness instead of showing outdated data silently
    onError: () => setStale(true),
  });
  return { metrics, stale };
}
