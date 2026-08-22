import { useState } from 'react';
import { ExperimentTimeline } from '../components/ExperimentTimeline';
import { ExperimentTable } from '../components/ExperimentTable';
import { cn } from '../lib/cn';

type View = 'timeline' | 'table';

const TABS: { id: View; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'table', label: 'Table' },
];

export function ExperimentsPage() {
  const [view, setView] = useState<View>('timeline');

  return (
    <div className="flex gap-6 h-full max-w-5xl">
      <nav className="w-40 shrink-0 flex flex-col gap-1 pt-10" role="tablist" aria-label="Experiment view">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            id={`tab-${t.id}`}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setView(t.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium rounded transition-colors text-left',
              view === t.id
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-4">
        <h1 className="text-2xl font-semibold">Experiments</h1>
        <div role="tabpanel" id={`tabpanel-${view}`} aria-labelledby={`tab-${view}`}>
          {view === 'timeline' && <ExperimentTimeline />}
          {view === 'table' && <ExperimentTable />}
        </div>
      </div>
    </div>
  );
}
