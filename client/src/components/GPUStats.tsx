import { Card } from './common/Card';
import { Badge } from './common/Badge';
import { useGPU } from '../hooks/useGPU';
import { useMetrics } from '../hooks/useMetrics';

function formatBytes(mib: number): string {
  return `${(mib / 1024).toFixed(1)} GB`;
}

function ThrottleTag({ reason }: { reason: string }) {
  const severity = /SW_THERMAL|HW_SLOWDOWN|HW_THERMAL/i.test(reason) ? 'error' : 'warning';
  return <Badge tone={severity}>{reason}</Badge>;
}

export function GPUStats() {
  const { gpus } = useGPU();
  const { metrics } = useMetrics();
  const kvPct = metrics ? Math.round(metrics.kvCacheUsagePerc * 100) : 0;

  // Dual-card comparison: only show if 2+ GPUs
  const showComparison = gpus.length >= 2;

  return (
    <div className="space-y-3">
      {/* Dual card comparison strip */}
      {showComparison && (
        <Card title="GPU Comparison" className="border-accent/30">
          <div className="grid grid-cols-2 gap-4">
            {gpus.slice(0, 2).map(gpu => (
              <div key={gpu.index} className="text-center">
                <div className="text-xs text-text-muted mb-2">GPU {gpu.index}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-text-muted">Temp</div>
                    <div className={`font-mono font-medium ${gpu.temperature >= 80 ? 'text-red-400' : gpu.temperature >= 70 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {gpu.temperature}°C
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">Power</div>
                    <div className="font-mono">{gpu.powerDraw.toFixed(0)}W</div>
                  </div>
                  <div>
                    <div className="text-text-muted">Util</div>
                    <div className="font-mono">{gpu.utilization}%</div>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-text-muted text-xs">VRAM</div>
                  <div className="font-mono text-xs">{formatBytes(gpu.memoryUsed)} / {formatBytes(gpu.memoryTotal)}</div>
                  <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full transition-all ${(gpu.memoryUsed / gpu.memoryTotal) > 0.9 ? 'bg-red-500' : (gpu.memoryUsed / gpu.memoryTotal) > 0.75 ? 'bg-yellow-500' : 'bg-accent'}`}
                      style={{ width: `${(gpu.memoryUsed / gpu.memoryTotal) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Difference row */}
          <div className="mt-3 pt-2 border-t border-border/50 flex justify-center gap-6 text-xs text-text-muted">
            <span>Δ Temp: <span className="font-mono text-text-secondary">{Math.abs(gpus[0].temperature - gpus[1].temperature)}°C</span></span>
            <span>Δ VRAM: <span className="font-mono text-text-secondary">{formatBytes(Math.abs(gpus[0].memoryUsed - gpus[1].memoryUsed))}</span></span>
            <span>Δ Util: <span className="font-mono text-text-secondary">{Math.abs(gpus[0].utilization - gpus[1].utilization)}%</span></span>
          </div>
        </Card>
      )}

      {/* Individual GPU cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {gpus.map(gpu => {
          const memPct = (gpu.memoryUsed / gpu.memoryTotal) * 100;
          const tempColor = gpu.temperature >= 80 ? 'text-red-400' : gpu.temperature >= 70 ? 'text-yellow-400' : 'text-green-400';
          const flashClass = gpu.temperature > 80 ? 'animate-flash-red' : kvPct > 85 ? 'animate-flash-yellow' : '';

          return (
            <Card key={gpu.index} title={`GPU ${gpu.index} — ${gpu.name}`} className={flashClass}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-text-muted text-xs">Temperature</div>
                  <div className={`font-mono ${tempColor}`}>{gpu.temperature}°C</div>
                </div>
                <div>
                  <div className="text-text-muted text-xs">Power</div>
                  <div className="font-mono">{gpu.powerDraw.toFixed(0)}W / {gpu.powerLimit.toFixed(0)}W</div>
                </div>
                <div>
                  <div className="text-text-muted text-xs">SM Clock</div>
                  <div className="font-mono">{gpu.smClock.toFixed(0)} MHz</div>
                </div>
                <div>
                  <div className="text-text-muted text-xs">Utilization</div>
                  <div className="font-mono">{gpu.utilization}%</div>
                </div>
              </div>

              {/* Throttle Reasons */}
              {gpu.throttleReasons && gpu.throttleReasons.length > 0 && (
                <div className="mt-3 pt-2 border-t border-border/50">
                  <div className="text-text-muted text-xs mb-1.5">⚡ Throttle Reasons</div>
                  <div className="flex flex-wrap gap-1.5">
                    {gpu.throttleReasons.map((reason, i) => (
                      <ThrottleTag key={i} reason={reason} />
                    ))}
                  </div>
                </div>
              )}

              {/* Display Mode Indicator */}
              <div className="mt-2">
                <div className="text-text-muted text-xs">ECC Errors</div>
                <div className={`font-mono text-xs ${gpu.eccErrors > 0 ? 'text-red-400' : 'text-text-secondary'}`}>
                  {gpu.eccErrors > 0 ? `${gpu.eccErrors} uncorrected` : 'None'}
                </div>
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">VRAM</span>
                  <span className="font-mono">{formatBytes(gpu.memoryUsed)} / {formatBytes(gpu.memoryTotal)}</span>
                </div>
                <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${memPct > 90 ? 'bg-red-500' : memPct > 75 ? 'bg-yellow-500' : 'bg-accent'}`}
                    style={{ width: `${memPct}%` }}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
