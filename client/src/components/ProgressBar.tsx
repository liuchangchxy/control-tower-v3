import { useServerStatus } from '../hooks/useServer';
import { useSSE } from '../hooks/useSSE';
import { useState, useRef, useEffect } from 'react';
import { STAGES } from '../lib/stages';
import type { ProgressEvent } from '../types';

/**
 * Enforce monotonic progress on the client.
 * Progress from SSE may briefly go backwards due to race conditions;
 * this hook guarantees the displayed value never decreases.
 */
/**
 * Enforce monotonic progress — never decrease during a single startup.
 * Resets when status transitions away from loading (handles server restarts).
 */
function useMonotonicProgress(raw: ProgressEvent | null, status: string | undefined): ProgressEvent | null {
  const maxRef = useRef(0);
  const lastStatusRef = useRef(status);

  // Reset maxRef when status transitions from loading/starting → anything else
  // This handles server restarts where progress goes 90% → 0%
  if (lastStatusRef.current !== status) {
    if ((lastStatusRef.current === 'loading' || lastStatusRef.current === 'starting') &&
        status !== 'loading' && status !== 'starting') {
      maxRef.current = 0;
    }
    lastStatusRef.current = status;
  }

  if (!raw) return null;
  // Never let progress decrease
  maxRef.current = Math.max(maxRef.current, raw.progress);
  return { ...raw, progress: maxRef.current };
}

export function ProgressBar() {
  const { data: status } = useServerStatus();
  const [rawProgress, setRawProgress] = useState<ProgressEvent | null>(null);

  useSSE<ProgressEvent>('/server/progress', {
    onMessage: setRawProgress,
    enabled: status?.status === 'starting' || status?.status === 'loading',
  });

  const progress = useMonotonicProgress(rawProgress, status?.status);

  if (!status || (status.status !== 'starting' && status.status !== 'loading')) return null;

  const pct = progress?.progress ?? status.progress ?? 0;
  const currentStageId = progress?.stage;
  const progressKnown = progress?.progressKnown ?? currentStageId === 'weights';
  const isError = progress?.status === 'error';
  const detail = progress?.label || status.healthDetail || (status.status === 'starting' ? 'Starting vLLM server...' : 'Loading model...');

  return (
    <div className="bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-text-secondary">{detail}{progress?.elapsedMs ? ` · ${Math.floor(progress.elapsedMs / 1000)}s` : ''}</div>
        <div className="text-sm font-mono">{progressKnown ? `${Math.round(pct)}%` : 'working…'}</div>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Server loading progress"
        className="h-2 bg-bg-tertiary rounded-full overflow-hidden mb-4"
      >
        <div
          className={`h-full ${isError ? 'bg-red-500' : progressKnown ? 'bg-accent' : 'bg-accent animate-pulse'}`}
          style={progressKnown ? { width: `${pct}%`, transition: 'width 500ms ease-out' } : { width: '35%' }}
        />
      </div>
      <div className="space-y-2" aria-live="polite">
        {STAGES.map(stage => {
          const isCompleted = progressKnown && pct >= stage.progressEnd;
          const isActive = currentStageId === stage.id || (!currentStageId && progressKnown && pct >= stage.progressStart && pct < stage.progressEnd);
          let subPct = 0;
          if (isCompleted) {
            subPct = 100;
          } else if (isActive && progress?.stage === stage.id && progress.stageProgress != null) {
            subPct = progress.stageProgress;
          } else if (isActive) {
            const range = stage.progressEnd - stage.progressStart;
            subPct = progressKnown && range > 0 ? Math.min(100, Math.max(0, ((pct - stage.progressStart) / range) * 100)) : 0;
          }
          // Clamp subPct to never decrease below what's shown for completed stages
          if (isCompleted) subPct = 100;
          return (
            <div key={stage.id}>
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-4 h-4 flex items-center justify-center ${
                  isCompleted ? 'text-green-400' : isActive ? 'text-accent' : 'text-text-muted'
                }`} aria-hidden="true">
                  {isCompleted ? '✓' : isActive ? '●' : '○'}
                </div>
                <span className="sr-only">
                  {stage.label}: {isCompleted ? 'completed' : isActive ? `in progress ${Math.round(subPct)}%` : 'pending'}
                </span>
                <div className={`flex-1 ${isCompleted || isActive ? 'text-text-primary' : 'text-text-muted'}`}>
                  {stage.label}
                </div>
                {isActive && (
                  <div className="text-xs font-mono text-text-muted">{Math.round(subPct)}%</div>
                )}
              </div>
              {(isActive || isCompleted) && (
                <div className="ml-6 mt-1">
                  <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${isCompleted ? 'bg-green-400' : 'bg-accent'}`}
                      style={{ width: `${subPct}%`, transition: isCompleted ? 'none' : 'width 300ms ease-out' }}
                    />
                  </div>
                </div>
              )}
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
