import { useState } from 'react';
import { Card } from './common/Card';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { Spinner } from './common/Spinner';
import { useBenchmarkPresets, useRunBenchmark } from '../hooks/useBenchmark';
import { useServerStatus } from '../hooks/useServer';
import type { DetailedBenchmarkResult, VLLMMetrics } from '../types';

interface RunEntry {
  result: DetailedBenchmarkResult;
  metrics: VLLMMetrics | null;
}

export function BenchmarkManual() {
  const { data: presets, isLoading: presetsLoading } = useBenchmarkPresets();
  const { data: status } = useServerStatus();
  const runBenchmark = useRunBenchmark();

  const [selectedPreset, setSelectedPreset] = useState('chat');
  const [customInput, setCustomInput] = useState('');
  const [customOutput, setCustomOutput] = useState('');
  const [rounds, setRounds] = useState(1);
  const [results, setResults] = useState<RunEntry[]>([]);

  const isReady = status?.status === 'ready';
  const isRunning = runBenchmark.isPending;

  const handleRun = async () => {
    if (!isReady) return;

    const vars: {
      presetId?: string;
      inputTokens?: number;
      outputTokens?: number;
      rounds: number;
    } = { rounds };

    if (selectedPreset === '__custom__') {
      const inp = parseInt(customInput) || 512;
      const out = parseInt(customOutput) || 256;
      vars.inputTokens = inp;
      vars.outputTokens = out;
    } else {
      vars.presetId = selectedPreset;
    }

    try {
      const result = await runBenchmark.mutateAsync(vars);
      setResults(prev => [result, ...prev]);
    } catch {
      // error via runBenchmark.error
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Run Benchmark">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block text-sm">
              <span className="text-text-secondary">Preset</span>
              <select
                className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
                value={selectedPreset}
                onChange={e => setSelectedPreset(e.target.value)}
              >
                {presets?.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.inputTokens}in/{p.outputTokens}out)
                  </option>
                ))}
                <option value="__custom__">Custom tokens</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-text-secondary">Rounds</span>
              <input
                type="number"
                min={1}
                max={20}
                value={rounds}
                onChange={e => setRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
              />
            </label>

            {selectedPreset !== '__custom__' && presets && (
              <div className="flex items-end">
                <p className="text-text-muted text-xs pb-2">
                  {presets.find(p => p.id === selectedPreset)?.description}
                </p>
              </div>
            )}
          </div>

          {selectedPreset === '__custom__' && (
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm">
                <span className="text-text-secondary">Input tokens</span>
                <input
                  type="number"
                  min={1}
                  value={customInput}
                  onChange={e => setCustomInput(e.target.value)}
                  placeholder="512"
                  className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-text-secondary">Output tokens</span>
                <input
                  type="number"
                  min={1}
                  value={customOutput}
                  onChange={e => setCustomOutput(e.target.value)}
                  placeholder="256"
                  className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2 text-sm"
                />
              </label>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleRun}
              disabled={!isReady || (!selectedPreset)}
              loading={isRunning}
            >
              {isRunning ? 'Running...' : 'Run Benchmark'}
            </Button>
            {!isReady && (
              <span className="text-text-muted text-xs">Server must be ready</span>
            )}
            {runBenchmark.error && (
              <span className="text-red-400 text-xs">
                {(runBenchmark.error as Error).message}
              </span>
            )}
          </div>
        </div>
      </Card>

      {presetsLoading && (
        <Card>
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <Spinner size="sm" /> Loading presets...
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <Card title={`Results (${results.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted border-b border-border">
                  <th className="text-left py-2 pr-3">Preset</th>
                  <th className="text-right py-2 px-3">In/Out</th>
                  <th className="text-right py-2 px-3">tok/s</th>
                  <th className="text-right py-2 px-3">TTFT</th>
                  <th className="text-right py-2 px-3">TPOT</th>
                  <th className="text-right py-2 px-3">ITL p50</th>
                  <th className="text-right py-2 px-3">ITL p99</th>
                  <th className="text-right py-2 px-3">E2E</th>
                  <th className="text-right py-2 pl-3">Rounds</th>
                </tr>
              </thead>
              <tbody>
                {results.map((entry, i) => {
                  const r = entry.result;
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-bg-hover">
                      <td className="py-2 pr-3">
                        <Badge tone={presetTone(r.presetId)}>{r.presetId}</Badge>
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-xs">
                        {r.inputTokens}/{r.actualOutputTokens}
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-accent font-semibold">
                        {r.throughputTokPerSec.toFixed(1)}
                      </td>
                      <td className="text-right py-2 px-3 font-mono">
                        {r.ttftMs < 1000 ? `${r.ttftMs.toFixed(0)}ms` : `${(r.ttftMs/1000).toFixed(1)}s`}
                      </td>
                      <td className="text-right py-2 px-3 font-mono">
                        {r.tpotMs.toFixed(1)}ms
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-xs">
                        {r.itl.p50Ms.toFixed(1)}ms
                      </td>
                      <td className="text-right py-2 px-3 font-mono text-xs">
                        {r.itl.p99Ms.toFixed(1)}ms
                      </td>
                      <td className="text-right py-2 px-3 font-mono">
                        {r.e2eLatencyMs < 1000 ? `${r.e2eLatencyMs}ms` : `${(r.e2eLatencyMs/1000).toFixed(1)}s`}
                      </td>
                      <td className="text-right py-2 pl-3 font-mono">{r.rounds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function presetTone(id: string): 'info' | 'warning' | 'success' | 'neutral' {
  switch (id) {
    case 'quick': return 'success';
    case 'chat': return 'info';
    case 'summary': return 'warning';
    case 'longgen': case 'stress': return 'warning';
    default: return 'neutral';
  }
}
