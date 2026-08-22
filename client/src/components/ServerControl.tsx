import { useState, useEffect, useRef } from 'react';
import { Card } from './common/Card';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { useServerStatus, useStartServer, useStopServer, useKillServer, useRestartServer } from '../hooks/useServer';
import { useProfiles } from '../hooks/useProfiles';
import { useExperiments } from '../hooks/useExperiments';
import { useMetrics } from '../hooks/useMetrics';
import { useCreateProfile } from '../hooks/useProfiles';
import { Modal } from './common/Modal';
import { useToast } from './common/Toast';
import type { ProfileConfig } from '../types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  ready: 'success',
  loading: 'info',
  starting: 'info',
  error: 'error',
  stopped: 'neutral',
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ServerControl() {
  const { data: status } = useServerStatus();
  const { data: profiles } = useProfiles();
  const { data: experiments } = useExperiments();
  const start = useStartServer();
  const stop = useStopServer();
  const kill = useKillServer();
  const restart = useRestartServer();
  const createProfile = useCreateProfile();
  const toast = useToast();
  const [showStartModal, setShowStartModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  // Global toast on status transitions
  const prevStatusRef = useRef(status?.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = status?.status;
    if (prev && curr && prev !== curr) {
      if (curr === 'ready') {
        toast.addToast('success', `vLLM is ready (${status?.servedName ?? 'model'})`);
      } else if (curr === 'error' && status?.error) {
        toast.addToast('error', `vLLM failed: ${status.error}`);
      }
    }
    prevStatusRef.current = curr;
  }, [status?.status, status?.error, status?.servedName]);

  const isRunning = status?.status === 'ready' || status?.status === 'loading' || status?.status === 'starting';

  const lastReadyExperiment = experiments
    ?.filter(e => e.status === 'ready')
    ?.sort((a, b) => b.timestamp - a.timestamp)?.[0];

  const repairs = status?.errorDiagnosis?.repairs ?? [];

  return (
    <Card title="vLLM Server">
      <div className="flex items-center gap-2 mb-3">
        <Badge tone={STATUS_TONE[status?.status ?? 'stopped']}>{status?.status ?? 'unknown'}</Badge>
        {status?.pid && <span className="text-text-muted text-xs font-mono">PID {status.pid}</span>}
        {status?.uptime && status.uptime > 0 && (
          <span className="text-text-muted text-xs">uptime {formatUptime(status.uptime)}</span>
        )}
      </div>

      <div className="space-y-1 text-sm mb-4">
        <div><span className="text-text-muted">Profile:</span> <span className="font-mono">{status?.profile ?? '—'}</span></div>
        <div><span className="text-text-muted">Served as:</span> <span className="font-mono">{status?.servedName ?? '—'}</span></div>
        <div><span className="text-text-muted">Port:</span> <span className="font-mono">{status?.port ?? '—'}</span></div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => setShowStartModal(true)} disabled={isRunning} variant="primary">Start</Button>
        <Button onClick={() => restart.mutate()} disabled={!isRunning} loading={restart.isPending} variant="secondary">Restart</Button>
        <Button onClick={() => stop.mutate()} disabled={!isRunning} loading={stop.isPending} variant="secondary">Stop</Button>
        <Button onClick={() => kill.mutate()} disabled={!isRunning} loading={kill.isPending} variant="danger">Kill</Button>
        <Button
          onClick={async () => {
            if (!lastReadyExperiment) return;
            try {
              await start.mutateAsync(lastReadyExperiment.profilePath);
              toast.addToast('success', `Rolled back to ${lastReadyExperiment.profilePath.split('/').pop()}`);
            } catch (err) {
              toast.addToast('error', `Rollback failed: ${(err as Error).message}`);
            }
          }}
          disabled={isRunning || !lastReadyExperiment}
          loading={start.isPending}
          variant="secondary"
        >Rollback</Button>
      </div>

      {status?.error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded text-sm space-y-2">
          <div className="text-red-400 font-medium">Error Diagnosis</div>
          <div className="text-red-300">{status.error}</div>
          {status.errorDiagnosis?.message && (
            <div className="text-red-200 text-xs">{status.errorDiagnosis.message}</div>
          )}
          {repairs.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="text-text-muted text-xs">Suggested fixes:</div>
              {repairs.map((repair: { description: string; profilePatch: Partial<ProfileConfig> }, i: number) => (
                <Button key={i} size="sm" variant="secondary"
                  onClick={async () => {
                    try {
                      const patchName = `fix-${status.errorDiagnosis?.errorType ?? 'unknown'}-${Date.now()}`;
                      await createProfile.mutateAsync({ name: patchName, config: repair.profilePatch });
                      toast.addToast('success', `Profile "${patchName}" created. Restart the server to apply.`);
                    } catch (err) {
                      toast.addToast('error', `Failed to apply fix: ${(err as Error).message}`);
                    }
                  }}
                  loading={createProfile.isPending}
                >Apply: {repair.description}</Button>
              ))}
            </div>
          )}
          {!repairs.length && (
            <div className="text-text-muted text-xs">
              Suggestion: Check GPU memory usage and model size. Try restarting the server or switching to a profile with lower GPU utilization.
            </div>
          )}
        </div>
      )}

      <Modal open={showStartModal} onClose={() => setShowStartModal(false)} title="Start vLLM">
        <div className="space-y-3">
          <label className="block text-sm">
            Profile
            <select className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2" value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}>
              <option value="">Select profile...</option>
              {profiles?.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShowStartModal(false)}>Cancel</Button>
            <Button variant="primary" disabled={!selectedProfile} loading={start.isPending}
              onClick={async () => {
                try {
                  await start.mutateAsync(selectedProfile);
                  setShowStartModal(false);
                } catch {
                  // Error is shown via start.error below
                }
              }}
            >Start</Button>
          </div>
          {start.error && <div className="text-red-400 text-sm mt-2">{(start.error as Error).message}</div>}
        </div>
      </Modal>
    </Card>
  );
}
