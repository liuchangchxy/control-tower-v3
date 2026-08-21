import { useState } from 'react';
import { useExperiments } from '../hooks/useExperiments';
import { Badge } from './common/Badge';
import { Card } from './common/Card';
import type { Experiment } from '../types';

const STATUS_BADGE: Record<Experiment['status'], { tone: 'success' | 'error' | 'warning'; label: string }> = {
  ready: { tone: 'success', label: 'Ready' },
  error: { tone: 'error', label: 'Error' },
  running: { tone: 'warning', label: 'Running' },
};

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function profileName(p: string) {
  const name = p.split(/[/\\]/).pop() ?? p;
  return name.replace(/\.profile$/i, '');
}

function bestTokPerSec(e: Experiment): string | null {
  if (!e.benchmarkResults?.length) return null;
  return Math.max(...e.benchmarkResults.map(r => r.tokPerSec)).toFixed(1);
}

function Expanded({ e }: { e: Experiment }) {
  return (
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      <div>
        <h4 className="text-xs font-medium text-text-secondary mb-1">Profile Config</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted max-h-48 overflow-auto">
          {Object.entries(e.profileSnapshot).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="truncate">{k}</span>
              <span className="ml-2 text-text-secondary">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
      {e.benchmarkResults && e.benchmarkResults.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-1">Benchmarks</h4>
          {e.benchmarkResults.map((r, i) => (
            <div key={i} className="flex gap-4 text-xs text-text-muted">
              <span className="w-16">{r.size}</span>
              <span>{r.tokPerSec.toFixed(1)} tok/s</span>
              <span>{r.ttftMs.toFixed(0)}ms TTFT</span>
              <span>{r.promptTokens}+{r.generationTokens} tok</span>
            </div>
          ))}
        </div>
      )}
      {e.errorMessage && (
        <div>
          <h4 className="text-xs font-medium text-red-400 mb-1">Error</h4>
          <p className="text-xs text-red-300/80">{e.errorMessage}</p>
        </div>
      )}
      {e.notes && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-1">Notes</h4>
          <p className="text-xs text-text-muted whitespace-pre-wrap">{e.notes}</p>
        </div>
      )}
    </div>
  );
}

function ExperimentCard({ e }: { e: Experiment }) {
  const [open, setOpen] = useState(false);
  const badge = STATUS_BADGE[e.status];
  const tokPerSec = bestTokPerSec(e);
  const dotColor = e.status === 'ready' ? 'bg-green-500 border-green-400' : e.status === 'error' ? 'bg-red-500 border-red-400' : 'bg-yellow-500 border-yellow-400';

  return (
    <div className="relative pl-8">
      <div className="absolute left-0 top-4 flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full border-2 ${dotColor}`} />
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <Card className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{profileName(e.profilePath)}</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <span className="text-xs text-text-muted">{fmt(e.timestamp)}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          {tokPerSec && <span>{tokPerSec} tok/s</span>}
          <span>Started: {e.startDurationSec}s</span>
          {e.benchmarkResults && <span>{e.benchmarkResults.length} benchmark{e.benchmarkResults.length !== 1 ? 's' : ''}</span>}
        </div>
        {e.notes && <p className="text-xs text-text-muted mt-2 line-clamp-2">{e.notes}</p>}
        <button onClick={() => setOpen(!open)} className="mt-2 text-xs text-accent hover:underline">
          {open ? 'Collapse' : 'Expand'}
        </button>
        {open && <Expanded e={e} />}
      </Card>
    </div>
  );
}

export function ExperimentTimeline() {
  const { data, isLoading, error } = useExperiments();

  if (isLoading) return <div className="text-text-muted text-sm">Loading experiments...</div>;
  if (error) return <div className="text-red-400 text-sm">Failed to load experiments.</div>;
  if (!data?.length) {
    return <div className="text-text-muted text-sm text-center py-12">No experiments recorded yet.</div>;
  }

  const sorted = [...data].sort((a, b) => b.timestamp - a.timestamp);
  return (
    <div className="py-2">
      {sorted.map(e => <ExperimentCard key={e.id} e={e} />)}
    </div>
  );
}
