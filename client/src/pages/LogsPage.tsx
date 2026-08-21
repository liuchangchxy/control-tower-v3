import { LogViewer } from '../components/LogViewer';

export function LogsPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <h1 className="text-2xl font-semibold mb-4">Logs</h1>
      <div className="flex-1">
        <LogViewer />
      </div>
    </div>
  );
}
