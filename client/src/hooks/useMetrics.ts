import { useState } from 'react';
import { useSSE } from './useSSE';
import type { VLLMMetrics } from '../types';

export function useMetrics() {
  const [metrics, setMetrics] = useState<VLLMMetrics | null>(null);
  useSSE<VLLMMetrics>('/server/metrics/stream', {
    onMessage: setMetrics,
  });
  return metrics;
}
