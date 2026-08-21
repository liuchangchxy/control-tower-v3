import { useServerStatus } from '../hooks/useServer';
import { useSSE } from '../hooks/useSSE';
import { useState } from 'react';
import { STAGES } from '../lib/stages';
import type { ProgressEvent } from '../types';

export function ProgressBar() {
  const { data: status } = useServerStatus();
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  useSSE<ProgressEvent>('/server/progress', {
    onMessage: setProgress,
    enabled: status?.status === 'starting' || status?.status === 'loading',
  });

  if (!status || status.status === 'stopped' || status.status === 'ready') return null;

  const pct = Math.max(progress?.progress ?? 0, status.progress ?? 0);
  const currentStageId = progress?.stage;
  const isError = status.status === 'error' || progress?.status === 'error';
  const detail = progress?.label || status.healthDetail || 'Loading...';

  return (
    <div className="bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-text-secondary">{detail}</div>
        <div className="text-sm font-mono">{Math.round(pct)}%</div>
      </div>
      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden mb-4">
        <div
          className={`h-full transition-all duration-300 ${isError ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1">
        {STAGES.map(stage => {
          const isCompleted = pct >= stage.progressEnd;
          const isActive = currentStageId === stage.id || (!currentStageId && pct >= stage.progressStart && pct < stage.progressEnd);
          return (
            <div key={stage.id} className="flex items-center gap-2 text-sm">
              <div className={`w-4 h-4 flex items-center justify-center ${
                isCompleted ? 'text-green-400' : isActive ? 'text-accent animate-pulse' : 'text-text-muted'
              }`}>
                {isCompleted ? '✓' : isActive ? '●' : '○'}
              </div>
              <div className={isCompleted || isActive ? 'text-text-primary' : 'text-text-muted'}>
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>
      {progress?.message && (
        <div className={`mt-3 p-2 rounded text-sm ${isError ? 'bg-red-900/30 border border-red-800 text-red-400' : 'bg-bg-tertiary text-text-muted'}`}>
          {progress.message}
        </div>
      )}
      {status.error && !progress?.message && (
        <div className="mt-3 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
          {status.error}
        </div>
      )}
    </div>
  );
}
