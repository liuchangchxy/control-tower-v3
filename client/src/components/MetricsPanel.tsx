import { useMetrics } from '../hooks/useMetrics';
import { useServerStatus } from '../hooks/useServer';
import { useToast } from './common/Toast';
import { Card } from './common/Card';
import { useEffect, useRef } from 'react';

function MetricRow({ label, value, unit, highlight }: { label: string; value: string | number; unit?: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="text-text-muted text-xs shrink-0">{label}</div>
      <div className={`font-mono text-right ${highlight ? 'text-yellow-400 font-semibold' : 'text-text-primary'}`}>
        {value}{unit && <span className="text-text-muted text-xs ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export function MetricsPanel() {
  const { metrics, health } = useMetrics();
  const { data: status } = useServerStatus();
  const globalToast = useToast();
  const kvWarnedRef = useRef(false);

  // KV cache warning toast (once per threshold crossing)
  useEffect(() => {
    if (metrics?.kvCacheWarning && !kvWarnedRef.current) {
      globalToast.addToast('warning', `KV Cache at ${Math.round(metrics.kvCacheUsagePerc * 100)}% — approaching limit`, 6000);
      kvWarnedRef.current = true;
    }
    if (!metrics?.kvCacheWarning) {
      kvWarnedRef.current = false;
    }
  }, [metrics?.kvCacheWarning, metrics?.kvCacheUsagePerc]);

  if (status?.status !== 'ready') return null;
  if (!metrics || !health?.available) return <Card title="Live Metrics"><div className="text-sm text-text-muted">{health?.error ? `Metrics unavailable: ${health.error}` : 'Waiting for a valid /metrics sample…'}</div></Card>;

  const kvPct = Math.round(metrics.kvCacheUsagePerc * 100);
  const kvColor = kvPct > 90 ? 'bg-red-500' : kvPct > 85 ? 'bg-yellow-500 animate-pulse' : kvPct > 75 ? 'bg-yellow-500' : 'bg-accent';

  return (
    <Card title="Live Metrics">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
        <MetricRow label="Requests" value={`${metrics.numRequestsRunning}/${metrics.numRequestsWaiting}`} unit="run/wait" />
        <MetricRow label="Throughput" value={metrics.tokPerSec > 0 ? metrics.tokPerSec.toFixed(1) : 'N/A'} unit="tok/s" />
        <MetricRow label="TTFT p50" value={metrics.ttftP50 < 1 ? `${Math.round(metrics.ttftP50 * 1000)}ms` : `${Math.round(metrics.ttftP50)}s`} />
        <MetricRow label="Prefix Cache" value={`${Math.round(metrics.prefixCacheHitRate * 100)}%`} />
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-muted">KV Cache</span>
          <span className={`font-mono ${kvPct > 85 ? 'text-yellow-400 font-semibold' : ''}`}>{kvPct}%</span>
        </div>
        <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
          <div className={`h-full transition-all ${kvColor}`} style={{ width: `${kvPct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4">
        <MetricRow label="Prompt tokens" value={metrics.promptTokens.toLocaleString()} />
        <MetricRow label="Generated" value={metrics.generationTokens.toLocaleString()} />
        <MetricRow label="TTFT p90" value={metrics.ttftP90 < 1 ? `${Math.round(metrics.ttftP90 * 1000)}ms` : `${Math.round(metrics.ttftP90)}s`} />
        <MetricRow label="TTFT p99" value={metrics.ttftP99 != null && metrics.ttftP99 < 1 ? `${Math.round(metrics.ttftP99 * 1000)}ms` : `${Math.round(metrics.ttftP99 ?? 0)}s`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4">
        <MetricRow label="Preemptions" value={metrics.numPreemptions} />
        <MetricRow label="KV Warning" value={metrics.kvCacheWarning ? 'YES' : 'No'} highlight={metrics.kvCacheWarning} />
      </div>
    </Card>
  );
}
