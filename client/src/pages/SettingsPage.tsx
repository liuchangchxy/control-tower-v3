import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Spinner } from '../components/common/Spinner';
import { useToast } from '../components/common/Toast';

// ── Config field metadata ─────────────────────────────────────────────────────

interface ConfigFieldMeta {
  type: 'number' | 'string';
  description: string;
}

interface SettingsData {
  config: Record<string, unknown>;
  fields: Record<string, ConfigFieldMeta>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  // Fetch settings on mount
  useEffect(() => {
    api.get<SettingsData>('/settings')
      .then(res => {
        setData(res);
        setDraft(res.config);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleChange = (key: string, value: unknown) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.put<Record<string, unknown>>('/settings', { config: draft });
      setDraft(result);
      setData(prev => prev ? { ...prev, config: result } : prev);
      addToast('success', 'Settings saved successfully. Changes apply on next server restart.');
    } catch (err) {
      setError((err as Error).message);
      addToast('error', `Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Card>
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Spinner size="md" className="mr-2" /> Loading configuration...
          </div>
        </Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Card>
          <div className="text-red-400 text-sm py-4">{error}</div>
        </Card>
      </div>
    );
  }

  const fields = data?.fields ?? {};
  const fieldOrder = ['port', 'launcherDir', 'modelDir'];

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Configuration">
        <p className="text-text-secondary text-sm mb-4">
          Edit the Control Tower configuration below. Changes are written to{' '}
          <code className="text-text-muted">config.json</code> and take effect after the server is restarted.
        </p>

        <div className="space-y-4">
          {fieldOrder.map(key => {
            const meta = fields[key];
            const value = draft[key];
            return (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-secondary">
                  {key}
                  {meta?.description && (
                    <span className="ml-2 text-text-muted font-normal">{meta.description}</span>
                  )}
                </label>
                {meta?.type === 'number' ? (
                  <input
                    type="number"
                    className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono text-sm text-text-primary"
                    value={typeof value === 'number' ? value : ''}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      handleChange(key, isNaN(v) ? undefined : v);
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono text-sm text-text-primary"
                    value={typeof value === 'string' ? value : ''}
                    onChange={e => handleChange(key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* JSON preview */}
        <div className="mt-4">
          <details>
            <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
              Raw JSON
            </summary>
            <pre className="mt-2 bg-bg-tertiary border border-border rounded p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto text-text-secondary">
              {JSON.stringify(draft, null, 2)}
            </pre>
          </details>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-3 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            onClick={() => data && setDraft(data.config)}
            disabled={saving}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
          >
            Save Settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
