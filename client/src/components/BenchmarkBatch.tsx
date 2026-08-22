import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Card } from './common/Card';
import { Button } from './common/Button';
import { Spinner } from './common/Spinner';
import { useToast } from './common/Toast';
import { useBenchmarkPresets, useRunBenchmark } from '../hooks/useBenchmark';
import { useProfiles } from '../hooks/useProfiles';
import { useServerStatus } from '../hooks/useServer';
import { useStartServer, useStopServer } from '../hooks/useServer';
import { useRecordExperiment } from '../hooks/useExperiments';
import { BenchmarkChart } from './BenchmarkChart';
import type { DetailedBenchmarkResult } from '../types';
import { useQueryClient } from '@tanstack/react-query';

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

interface ProfileRun {
  profileName: string;
  status: 'pending' | 'starting' | 'running' | 'done' | 'error';
  results: DetailedBenchmarkResult[];
  error?: string;
}

export function BenchmarkBatch() {
  const { data: profiles } = useProfiles();
  const { data: presets } = useBenchmarkPresets();
  const { data: status } = useServerStatus();
  const runBenchmark = useRunBenchmark();
  const startServer = useStartServer();
  const stopServer = useStopServer();
  const recordExperiment = useRecordExperiment();
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [rounds, setRounds] = useState(3);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [runs, setRuns] = useState<ProfileRun[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  const isReady = status?.status === 'ready';

  const toggleProfile = (name: string) => {
    setSelectedProfiles(prev =>
      prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
    );
  };

  const toggleAll = () => {
    if (!profiles) return;
    if (selectedProfiles.length === profiles.length) {
      setSelectedProfiles([]);
    } else {
      setSelectedProfiles(profiles.map(p => p.name));
    }
  };

  const updateRun = useCallback((index: number, patch: Partial<ProfileRun>) => {
    setRuns(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const handleBatchRun = async () => {
    if (selectedProfiles.length === 0 || !selectedPromptId) return;

    setIsBatchRunning(true);
    const initial: ProfileRun[] = selectedProfiles.map(name => ({
      profileName: name,
      status: 'pending',
      results: [],
    }));
    setRuns(initial);

    for (let i = 0; i < selectedProfiles.length; i++) {
      const profileName = selectedProfiles[i];

      // Start server with this profile
      updateRun(i, { status: 'starting' });
      try {
        // Stop current server if running (fresh status via queryClient)
        const freshStatus = await queryClient.fetchQuery({ queryKey: ['server-status'] }) as typeof status;
        if (freshStatus?.status === 'ready' || freshStatus?.status === 'loading' || freshStatus?.status === 'starting') {
          await stopServer.mutateAsync();
          await new Promise(r => setTimeout(r, 2000));
        }

        await startServer.mutateAsync(profileName);
        updateRun(i, { status: 'running' });

        // Wait for server to be ready (actual polling)
        const waitForReady = async (timeoutMs = 120_000) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const s = await queryClient.fetchQuery<{ status?: string }>({ queryKey: ['server-status'] });
            if (s?.status === 'ready') return;
            if (s?.status === 'error') throw new Error('Server failed to start');
            await new Promise(r => setTimeout(r, 3000));
          }
          throw new Error('Server did not become ready within timeout');
        };
        await waitForReady();

        // Run benchmark
        const result = await runBenchmark.mutateAsync({
          presetId: selectedPromptId,
          rounds,
        });

        updateRun(i, {
          status: 'done',
          results: [result.result],
        });

        // Record experiment
        await recordExperiment.mutateAsync({
          profilePath: profileName,
          status: 'ready',
          benchmarkResults: [{ size: 'custom' as const, promptTokens: result.result.promptTokens, generationTokens: result.result.actualOutputTokens, tokPerSec: result.result.throughputTokPerSec, ttftMs: result.result.ttftMs, totalTimeMs: result.result.e2eLatencyMs, rounds: result.result.rounds }],
          notes: `Batch benchmark run for ${profileName}`,
        });
      } catch (err) {
        updateRun(i, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    setIsBatchRunning(false);
  };

  // Aggregate results for chart
  const completedRuns = runs.filter(r => r.status === 'done' && r.results.length > 0);
  const chartData = completedRuns.map(r => ({
    label: r.profileName,
    result: r.results[0],
  }));

  const exportCSV = () => {
    const headers = ['Profile', 'tok/s', 'TTFT (ms)', 'Prompt Tokens', 'Gen Tokens', 'Total Time (ms)', 'Status'];
    const rows = runs.map(r => [
      r.profileName,
      r.results[0]?.throughputTokPerSec.toFixed(1) ?? '',
      r.results[0]?.ttftMs.toFixed(0) ?? '',
      r.results[0]?.promptTokens?.toString() ?? '',
      r.results[0]?.actualOutputTokens?.toString() ?? '',
      r.results[0]?.e2eLatencyMs?.toFixed(0) ?? '',
      r.status,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    download(csv, 'benchmark-results.csv', 'text/csv');
  };

  const exportJSON = () => {
    const data = runs.map(r => ({
      profile: r.profileName,
      status: r.status,
      result: r.results[0] ?? null,
    }));
    const json = JSON.stringify(data, null, 2);
    download(json, 'benchmark-results.json', 'application/json');
  };

  const copyCSV = async () => {
    const headers = ['Profile', 'tok/s', 'TTFT (ms)', 'Prompt Tokens', 'Gen Tokens', 'Total Time (ms)', 'Status'];
    const rows = runs.map(r => [
      r.profileName,
      r.results[0]?.throughputTokPerSec.toFixed(1) ?? '',
      r.results[0]?.ttftMs.toFixed(0) ?? '',
      r.results[0]?.promptTokens?.toString() ?? '',
      r.results[0]?.actualOutputTokens?.toString() ?? '',
      r.results[0]?.e2eLatencyMs?.toFixed(0) ?? '',
      r.status,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    try {
      await navigator.clipboard.writeText(csv);
      addToast('success', 'CSV copied to clipboard.');
    } catch {
      addToast('error', 'Failed to copy to clipboard.');
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Batch Benchmark">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-text-secondary">Prompt</span>
              <select
                className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
                value={selectedPromptId}
                onChange={e => setSelectedPromptId(e.target.value)}
              >
                <option value="">Select prompt...</option>
                {presets?.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} (~{p.inputTokens} tokens)
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-text-secondary">Rounds</span>
              <input
                type="number"
                min={1}
                max={10}
                value={rounds}
                onChange={e => setRounds(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-secondary">
                Profiles ({selectedProfiles.length}/{profiles?.length ?? 0})
              </span>
              <button
                onClick={toggleAll}
                className="text-xs text-accent hover:underline"
              >
                {selectedProfiles.length === profiles?.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {profiles?.map(p => (
                <button
                  key={p.name}
                  onClick={() => toggleProfile(p.name)}
                  aria-pressed={selectedProfiles.includes(p.name)}
                  className={`text-left text-xs p-2 rounded border transition-colors ${
                    selectedProfiles.includes(p.name)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg-tertiary text-text-secondary hover:border-border-hover'
                  }`}
                >
                  <div className="font-mono truncate">{p.name}</div>
                  {p.fields.SERVED_NAME && (
                    <div className="text-text-muted mt-0.5">{String(p.fields.SERVED_NAME)}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleBatchRun}
              disabled={selectedProfiles.length === 0 || !selectedPromptId || isBatchRunning}
              loading={isBatchRunning}
            >
              {isBatchRunning ? 'Running batch...' : `Run ${selectedProfiles.length} profiles`}
            </Button>

            {!isReady && selectedProfiles.length > 0 && (
              <span className="text-text-muted text-xs">Server must be ready to start</span>
            )}
          </div>
        </div>
      </Card>

      {runs.length > 0 && (
        <Card title="Progress">
          <div className="space-y-2">
            {runs.map((run, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-sm p-2 rounded bg-bg-tertiary"
              >
                <RunStatusIcon status={run.status} />
                <span className="font-mono flex-1 truncate">{run.profileName}</span>
                {run.status === 'done' && run.results.length > 0 && (
                  <span className="text-accent font-mono">
                    {run.results[0].throughputTokPerSec.toFixed(1)} tok/s
                  </span>
                )}
                {run.status === 'error' && (
                  <span className="text-red-400 text-xs truncate max-w-[200px]">{run.error}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {completedRuns.length > 1 && (
        <Card title="Comparison">
          <ComparisonTable runs={completedRuns} />
        </Card>
      )}

      {chartData.length > 0 && <BenchmarkChart data={chartData} />}

      {completedRuns.length > 0 && (
        <Card title="Export">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportCSV}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={exportJSON}>Export JSON</Button>
            <Button variant="secondary" size="sm" onClick={copyCSV}>Copy to Clipboard</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

const COLUMN_ORDER_KEY = 'benchmark-column-order';

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'profile', label: 'Profile', align: 'left' },
  { key: 'tokPerSec', label: 'tok/s', align: 'right' },
  { key: 'ttft', label: 'TTFT', align: 'right' },
  { key: 'promptTokens', label: 'Prompt Tokens', align: 'right' },
  { key: 'genTokens', label: 'Gen Tokens', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
];

interface ColumnDef {
  key: string;
  label: string;
  align: 'left' | 'right';
}

function ComparisonTable({ runs }: { runs: ProfileRun[] }) {
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMNS.length) {
          return parsed;
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS.map(c => c.key);
  });

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columnOrder));
    } catch { /* ignore */ }
  }, [columnOrder]);

  const resetColumns = () => {
    setColumnOrder(DEFAULT_COLUMNS.map(c => c.key));
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragOverIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragOverIndex(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newOrder = [...columnOrder];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    setColumnOrder(newOrder);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragCounterRef.current = 0;
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= columnOrder.length) return;
    const newOrder = [...columnOrder];
    const [moved] = newOrder.splice(index, 1);
    newOrder.splice(newIndex, 0, moved);
    setColumnOrder(newOrder);
  };

  const getOrderedColumns = () => columnOrder.map(key => DEFAULT_COLUMNS.find(c => c.key === key)!).filter(Boolean);

  const getCellValue = (run: ProfileRun, key: string) => {
    const r = run.results[0];
    if (key === 'profile') {
      return <td className="py-2 pr-4 font-mono text-xs">{run.profileName}</td>;
    }
    if (!r) return <td className="py-2 px-4 text-text-muted">-</td>;
    switch (key) {
      case 'tokPerSec':
        return <td className="text-right py-2 px-4 font-mono text-accent font-medium">{r.throughputTokPerSec.toFixed(1)}</td>;
      case 'ttft':
        return <td className="text-right py-2 px-4 font-mono">{r.ttftMs.toFixed(0)}ms</td>;
      case 'promptTokens':
        return <td className="text-right py-2 px-4 font-mono">{r.promptTokens.toLocaleString()}</td>;
      case 'genTokens':
        return <td className="text-right py-2 px-4 font-mono">{r.actualOutputTokens.toLocaleString()}</td>;
      case 'total':
        return <td className="text-right py-2 pl-4 font-mono">{r.e2eLatencyMs.toFixed(0)}ms</td>;
      default:
        return null;
    }
  };

  const orderedColumns = getOrderedColumns();
  const isDefaultOrder = columnOrder.every((key, i) => key === DEFAULT_COLUMNS[i].key);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={resetColumns}
          disabled={isDefaultOrder}
          className="text-xs text-text-muted hover:text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Reset columns
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-muted border-b border-border">
              {orderedColumns.map((col, index) => (
                <th
                  key={col.key}
                  draggable
                  tabIndex={0}
                  aria-roledescription="sortable column"
                  onKeyDown={e => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); moveColumn(index, -1); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); moveColumn(index, 1); }
                  }}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`${col.align === 'right' ? 'text-right' : 'text-left'} py-2 px-4 cursor-grab select-none transition-colors ${
                    dragIndex === index
                      ? 'opacity-50'
                      : dragOverIndex === index
                      ? 'bg-accent/10 border-b-2 border-accent'
                      : ''
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <span className="text-text-muted/50 text-xs">⠿</span>
                    {col.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-bg-hover">
                {orderedColumns.map(col => (
                  <React.Fragment key={col.key}>
                    {getCellValue(run, col.key)}
                  </React.Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunStatusIcon({ status }: { status: ProfileRun['status'] }) {
  const labels: Record<ProfileRun['status'], string> = {
    pending: 'Pending',
    starting: 'Starting',
    running: 'Running',
    done: 'Complete',
    error: 'Error',
  };
  switch (status) {
    case 'pending':
      return <div className="w-3 h-3 rounded-full bg-text-muted" role="img" aria-label={labels.pending} />;
    case 'starting':
      return <Spinner size="sm" />;
    case 'running':
      return <Spinner size="sm" className="text-accent" />;
    case 'done':
      return <div className="w-3 h-3 rounded-full bg-green-500" role="img" aria-label={labels.done} />;
    case 'error':
      return <div className="w-3 h-3 rounded-full bg-red-500" role="img" aria-label={labels.error} />;
  }
}
