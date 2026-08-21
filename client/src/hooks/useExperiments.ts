import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Experiment } from '../types';

export function useExperiments() {
  return useQuery({
    queryKey: ['experiments'],
    queryFn: () => api.get<Experiment[]>('/experiments'),
    refetchInterval: 5000,
  });
}

export function useExperiment(id: string | null) {
  return useQuery({
    queryKey: ['experiment', id],
    queryFn: () => api.get<Experiment>(`/experiments/${id}`),
    enabled: !!id,
  });
}

export function useRecordExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      profilePath?: string;
      profileSnapshot?: Record<string, string | number>;
      startDurationSec?: number;
      status?: Experiment['status'];
      errorMessage?: string;
      benchmarkResults?: Experiment['benchmarkResults'];
      notes?: string;
    }) => api.post<Experiment>('/experiments', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['experiments'] }),
  });
}

export function useAddNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; notes: string }) =>
      api.patch<Experiment>(`/experiments/${vars.id}/notes`, { notes: vars.notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['experiments'] }),
  });
}
