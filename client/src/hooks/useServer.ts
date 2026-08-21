import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { VLLMProcess } from '../types';

export function useServerStatus() {
  return useQuery({
    queryKey: ['server-status'],
    queryFn: () => api.get<VLLMProcess>('/server/status'),
    refetchInterval: 3000,
  });
}

export function useStartServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: string) => api.post('/server/start', { profile }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}

export function useStopServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/server/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}

export function useKillServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/server/kill'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}

export function useRestartServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/server/restart'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}
