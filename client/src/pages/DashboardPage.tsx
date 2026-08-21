import { ServerControl } from '../components/ServerControl';
import { GPUStats } from '../components/GPUStats';
import { MetricsPanel } from '../components/MetricsPanel';
import { ProgressBar } from '../components/ProgressBar';
import { LoadingOverlay } from '../components/LoadingOverlay';

export function DashboardPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <LoadingOverlay />
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <ServerControl />
      <ProgressBar />
      <MetricsPanel />
      <GPUStats />
    </div>
  );
}
