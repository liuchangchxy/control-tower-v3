import { useServerStatus } from '../hooks/useServer';
import { Spinner } from './common/Spinner';

const STATUS_TEXT: Record<string, string> = {
  starting: 'Starting vLLM server...',
  loading: 'Loading model weights...',
};

export function LoadingOverlay() {
  const { data: status } = useServerStatus();
  const serverStatus = status?.status;

  if (serverStatus !== 'starting' && serverStatus !== 'loading') return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 bg-bg-secondary border border-border rounded-[var(--radius-lg)] px-8 py-6 shadow-xl">
        <Spinner size="lg" className="text-accent" />
        <div className="text-text-primary text-sm font-medium">
          {STATUS_TEXT[serverStatus] ?? 'Working...'}
        </div>
        {status?.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <div className="text-text-muted text-xs text-center mt-1">{status.progress}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
