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
    <div className="flex gap-6 h-full max-w-5xl">
      <nav className="w-40 shrink-0 flex flex-col gap-1 pt-10" role="tablist" aria-label="Benchmark mode">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            id={`tab-${t.id}`}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium rounded transition-colors text-left',
              tab === t.id
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-4">
        <h1 className="text-2xl font-semibold">Benchmark</h1>
        <p className="text-text-muted text-sm">
          {TABS.find(t => t.id === tab)?.description}
        </p>
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'manual' && <BenchmarkManual />}
          {tab === 'batch' && <BenchmarkBatch />}
        </div>
      </div>
    </div>
  );
}
