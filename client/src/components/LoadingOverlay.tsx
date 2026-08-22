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
    <div role="status" aria-busy="true" className="fixed top-0 left-0 right-0 z-50 h-1 bg-bg-tertiary">
      <div
        className="h-full bg-accent transition-all duration-500"
        style={{ width: `${status?.progress ?? 0}%` }}
      />
    </div>
  );
}
