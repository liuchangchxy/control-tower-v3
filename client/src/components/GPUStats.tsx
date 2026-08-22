import { Card } from './common/Card';
import { Badge } from './common/Badge';
import { useGPU } from '../hooks/useGPU';
import { useMetrics } from '../hooks/useMetrics';
import { useSystem } from '../hooks/useSystem';

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
  const { system } = useSystem();
  const kvPct = metrics ? Math.round(metrics.kvCacheUsagePerc * 100) : 0;

  return (
    <div className="space-y-3">
      {/* System card — CPU / RAM */}
      {system && (
        <Card title="System" className="border-accent/30">
          <div className="grid grid-cols-2 gap-4 text-xs">
            {/* CPU Usage */}
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <div className="text-text-muted">CPU Usage</div>
                <div className="font-mono">{system.cpuUsage.toFixed(1)}%</div>
              </div>
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${system.cpuUsage > 90 ? 'bg-red-500' : system.cpuUsage > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(system.cpuUsage, 100)}%` }}
                />
              </div>
            </div>
            {/* CPU Temp */}
            <div className="flex justify-between items-baseline">
              <div className="text-text-muted">CPU Temp</div>
              <div className={`font-mono ${system.cpuTemp === null ? 'text-text-secondary' : system.cpuTemp >= 80 ? 'text-red-400' : system.cpuTemp >= 70 ? 'text-yellow-400' : 'text-green-400'}`}>
                {system.cpuTemp !== null ? `${system.cpuTemp}°C` : 'N/A'}
              </div>
            </div>
            {/* RAM */}
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <div className="text-text-muted">RAM</div>
                <div className="font-mono">{formatBytes(system.ramUsed)} / {formatBytes(system.ramTotal)}</div>
              </div>
              <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${system.ramUsage > 90 ? 'bg-red-500' : system.ramUsage > 75 ? 'bg-yellow-500' : 'bg-accent'}`}
                  style={{ width: `${Math.min(system.ramUsage, 100)}%` }}
                />
              </div>
            </div>
            {/* Swap — only if swap is configured */}
            {system.swapTotal > 0 && (
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <div className="text-text-muted">Swap</div>
                  <div className="font-mono">{formatBytes(system.swapUsed)} / {formatBytes(system.swapTotal)}</div>
                </div>
                <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${system.swapUsage > 90 ? 'bg-red-500' : system.swapUsage > 75 ? 'bg-yellow-500' : 'bg-accent'}`}
                    style={{ width: `${Math.min(system.swapUsage, 100)}%` }}
                  />
                </div>
              </div>
            )}
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
                <div className="flex justify-between items-baseline">
                  <div className="text-text-muted text-xs">Temperature</div>
                  <div className={`font-mono ${tempColor}`}>{gpu.temperature}°C</div>
                </div>
                <div className="flex justify-between items-baseline">
                  <div className="text-text-muted text-xs">Power</div>
                  <div className="font-mono">{gpu.powerDraw.toFixed(0)}W / {gpu.powerLimit.toFixed(0)}W</div>
                </div>
                <div className="flex justify-between items-baseline">
                  <div className="text-text-muted text-xs">SM Clock</div>
                  <div className="font-mono">{gpu.smClock.toFixed(0)} MHz</div>
                </div>
                <div className="flex justify-between items-baseline">
                  <div className="text-text-muted text-xs">Utilization</div>
                  <div className="font-mono">{gpu.utilization}%</div>
                </div>
              </div>

              {/* Throttle Reasons */}
              {gpu.throttleReasons && gpu.throttleReasons.length > 0 && (
                <div className="mt-3 pt-2 border-t border-border/50">
                  <div className="text-text-muted text-xs mb-1.5">⚡ Throttle Reasons</div>
                  <div className="flex flex-wrap gap-1.5">
                    {gpu.throttleReasons.map((reason: string, i: number) => (
                      <ThrottleTag key={i} reason={reason} />
                    ))}
                  </div>
                </div>
              )}

              {/* Display Mode Indicator */}
              <div className="mt-2 flex justify-between items-baseline">
                <div className="text-text-muted text-xs">ECC Errors</div>
                <div
                  className={`font-mono text-xs ${gpu.eccErrors > 0 ? 'text-yellow-400' : 'text-text-secondary'}`}
                  title={gpu.eccErrors > 0 ? '(software ECC)' : undefined}
                >
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
