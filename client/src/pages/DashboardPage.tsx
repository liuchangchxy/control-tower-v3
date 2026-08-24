import { ServerControl } from '../components/ServerControl';
import { GPUStats } from '../components/GPUStats';
import { MetricsPanel } from '../components/MetricsPanel';
import { ProgressBar } from '../components/ProgressBar';
import { LoadingOverlay } from '../components/LoadingOverlay';

export function DashboardPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <ServerControl />
      <LoadingOverlay />
      <ProgressBar />
      <MetricsPanel />
      <GPUStats />
    </div>
  );
}
