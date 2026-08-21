import { useState, useMemo } from 'react';
import { useExperiments } from '../hooks/useExperiments';
import { Badge } from './common/Badge';
import type { Experiment } from '../types';

const STATUS_BADGE: Record<Experiment['status'], { tone: 'success' | 'error' | 'warning'; label: string }> = {
  ready: { tone: 'success', label: 'Ready' },
  error: { tone: 'error', label: 'Error' },
  running: { tone: 'warning', label: 'Running' },
};

type SortKey = 'timestamp' | 'profile' | 'status' | 'tokPerSec' | 'ttftMs' | 'notes';
type SortDir = 'asc' | 'desc';

const fmt = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const profileName = (p: string) => (p.split(/[/\\]/).pop() ?? p).replace(/\.profile$/i, '');
const bestTok = (e: Experiment) => e.benchmarkResults?.length ? Math.max(...e.benchmarkResults.map(r => r.tokPerSec)) : null;
const bestTtft = (e: Experiment) => e.benchmarkResults?.length ? Math.min(...e.benchmarkResults.map(r => r.ttftMs)) : null;

const COLS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'profile', label: 'Profile' },
  { key: 'status', label: 'Status' },
  { key: 'tokPerSec', label: 'tok/s', right: true },
  { key: 'ttftMs', label: 'TTFT (ms)', right: true },
  { key: 'notes', label: 'Notes' },
];

function getVal(e: Experiment, key: SortKey): string | number {
  switch (key) {
    case 'timestamp': return e.timestamp;
    case 'profile': return profileName(e.profilePath);
    case 'status': return e.status;
    case 'tokPerSec': return bestTok(e) ?? -1;
    case 'ttftMs': return bestTtft(e) ?? Infinity;
    case 'notes': return e.notes ?? '';
  }
}

export function ExperimentTable() {
  const { data, isLoading, error } = useExperiments();
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    if (!data) return [];
    let list = data;
    if (statusFilter !== 'all') list = list.filter(e => e.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => profileName(e.profilePath).toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const cmp = (() => {
        const av = getVal(a, sortKey), bv = getVal(b, sortKey);
        return typeof av === 'number' ? (av as number) - (bv as number) : String(av).localeCompare(String(bv));
      })();
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, statusFilter, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  if (isLoading) return <div className="text-text-muted text-sm">Loading experiments...</div>;
  if (error) return <div className="text-red-400 text-sm">Failed to load experiments.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-bg-tertiary border border-border rounded px-2 py-1 text-sm text-text-primary">
          <option value="all">All Statuses</option>
          <option value="ready">Ready</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search profiles..." className="bg-bg-tertiary border border-border rounded px-2 py-1 text-sm text-text-primary w-48" />
      </div>

      {!sorted.length ? (
        <div className="text-text-muted text-sm text-center py-8">No experiments match filters.</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {COLS.map(c => (
                  <th key={c.key} onClick={() => toggleSort(c.key)} className={`px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>
                    {c.label}{sortKey === c.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(e => {
                const b = STATUS_BADGE[e.status], tok = bestTok(e), ttft = bestTtft(e);
                return (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-bg-hover">
                    <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmt(e.timestamp)}</td>
                    <td className="px-3 py-2 text-xs text-text-primary">{profileName(e.profilePath)}</td>
                    <td className="px-3 py-2"><Badge tone={b.tone}>{b.label}</Badge></td>
                    <td className="px-3 py-2 text-xs text-text-secondary text-right">{tok != null ? tok.toFixed(1) : '-'}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary text-right">{ttft != null ? ttft.toFixed(0) : '-'}</td>
                    <td className="px-3 py-2 text-xs text-text-muted max-w-48 truncate">{e.notes || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
