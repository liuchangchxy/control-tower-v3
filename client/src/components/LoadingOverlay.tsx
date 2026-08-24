import { useServerStatus } from '../hooks/useServer';

const STATUS_TEXT: Record<string, string> = {
  starting: 'Starting vLLM server...',
  loading: 'Loading model...',
};

export function LoadingOverlay() {
  const { data: status } = useServerStatus();
  const serverStatus = status?.status;

  if (serverStatus !== 'starting' && serverStatus !== 'loading') return null;

  return (
    <div role="status" aria-busy="true" className="pointer-events-none fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-accent/40 bg-bg-secondary/95 px-4 py-2 text-xs text-text-secondary shadow-lg">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent mr-2" />
      {STATUS_TEXT[serverStatus ?? 'starting']} {Math.round(status?.progress ?? 0)}%
    </div>
  );
}
