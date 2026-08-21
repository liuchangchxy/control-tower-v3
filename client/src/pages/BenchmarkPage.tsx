import { useState } from 'react';
import { BenchmarkManual } from '../components/BenchmarkManual';
import { BenchmarkBatch } from '../components/BenchmarkBatch';
import { cn } from '../lib/cn';

type Tab = 'manual' | 'batch';

const TABS: { id: Tab; label: string; description: string }[] = [
  { id: 'manual', label: 'Manual', description: 'Run a single benchmark with custom settings' },
  { id: 'batch', label: 'Batch', description: 'Compare multiple profiles side by side' },
];

export function BenchmarkPage() {
  const [tab, setTab] = useState<Tab>('manual');

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-semibold">Benchmark</h1>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px',
              tab === t.id
                ? 'border-b-2 border-accent text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-text-muted text-sm">
        {TABS.find(t => t.id === tab)?.description}
      </p>

      {tab === 'manual' && <BenchmarkManual />}
      {tab === 'batch' && <BenchmarkBatch />}
    </div>
  );
}
