import { Card } from '../components/common/Card';
import { useServerStatus } from '../hooks/useServer';

export function ChatPage() {
  const { data: status } = useServerStatus();
  const isReady = status?.status === 'ready' || (status?.status === 'unknown' && status.apiAvailable === true && status.runtimeEvidence?.modelMatches === true);
  const model = status?.servedName || 'model';
  const apiPort = status?.port ?? 8000;
  const apiUrl = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${apiPort}/v1`;

  return (
    <Card className="max-w-3xl">
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Direct vLLM API</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Control Tower is monitor-only. Connect your Anthropic-compatible client directly to vLLM; requests are not proxied or transformed here.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-bg-tertiary p-4 space-y-2">
          <div className="text-xs text-text-muted">Base URL</div>
          <code className="block select-all break-all font-mono text-sm text-text-primary">{apiUrl}</code>
          <div className="text-xs text-text-muted">Model: <span className="text-text-secondary">{model}</span></div>
        </div>
        <div className="text-sm text-text-secondary space-y-2">
          <p>{isReady ? 'The managed vLLM runtime is ready.' : 'The managed vLLM runtime is not ready.'}</p>
          <p>Configure your client with the URL above and send tool definitions directly to the vLLM Messages API.</p>
          <p className="text-text-muted">Use Dashboard, Logs, Metrics, and Server controls here to monitor and manage the runtime.</p>
        </div>
      </div>
    </Card>
  );
}
