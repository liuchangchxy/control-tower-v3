import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ProfileConfig, ProfileSummary } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<ProfileSummary[]>('/profiles'),
  });
}

export function useProfile(path: string | null) {
  return useQuery({
    queryKey: ['profile', path],
    queryFn: () => api.get<ProfileConfig>(`/profiles/${path}`),
    enabled: !!path,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; config: Partial<ProfileConfig> }) =>
      api.post<{ path: string }>('/profiles', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { path: string; config: Partial<ProfileConfig> }) =>
      api.put(`/profiles/${vars.path}`, vars.config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.del(`/profiles/${path}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useValidateProfile() {
  return useMutation({
    mutationFn: (config: Partial<ProfileConfig>) =>
      api.post<ValidationResult>('/profiles/validate', config),
  });
}
