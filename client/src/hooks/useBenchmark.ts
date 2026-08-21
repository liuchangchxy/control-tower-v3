import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { BenchmarkPreset, DetailedBenchmarkResult, VLLMMetrics } from '../types';

interface BenchmarkPrompt {
  id: string;
  text: string;
  estimatedTokens: number;
}

interface DetailedBenchmarkRunResult {
  result: DetailedBenchmarkResult;
  metrics: VLLMMetrics | null;
}

// New: preset-based
export function useBenchmarkPresets() {
  return useQuery({
    queryKey: ['benchmark-presets'],
    queryFn: () => api.get<BenchmarkPreset[]>('/benchmark/presets'),
  });
}

// Legacy: prompt-based (still used by batch)
export function useBenchmarkPrompts() {
  return useQuery({
    queryKey: ['benchmark-prompts'],
    queryFn: () => api.get<BenchmarkPrompt[]>('/benchmark/prompts'),
  });
}

export function useRunBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      presetId?: string;
      inputTokens?: number;
      outputTokens?: number;
      customPrompt?: string;
      rounds?: number;
    }) => api.post<DetailedBenchmarkRunResult>('/benchmark/run', vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['experiments'] });
      qc.invalidateQueries({ queryKey: ['benchmark-presets'] }); // L9
    },
  });
}
