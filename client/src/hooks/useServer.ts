import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { VLLMProcess } from '../types';

export function useServerStatus() {
  return useQuery({
    queryKey: ['server-status'],
    queryFn: () => api.get<VLLMProcess>('/server/status'),
    refetchInterval: 10000, // L11: reduced from 3s — SSE provides real-time updates
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
