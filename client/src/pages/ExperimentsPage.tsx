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
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-semibold">Experiments</h1>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px',
              view === t.id
                ? 'border-b-2 border-accent text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'timeline' && <ExperimentTimeline />}
      {view === 'table' && <ExperimentTable />}
    </div>
  );
}
