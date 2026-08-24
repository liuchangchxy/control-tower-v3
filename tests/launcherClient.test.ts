import { describe, expect, it } from 'vitest';
import { parseHandoff } from '../server/services/launcherClient.js';

describe('launcher client handoff parsing', () => {
  const base = { schemaVersion: 1, status: 'ready', profile: 'user/test.env', servedName: 'test', modelDir: '/models/test', pid: 123, pgid: 123, pidFile: '/run/test.pid', logFile: '/run/test.log', stateFile: '/run/state.json', port: 8000, startedAt: 1, healthUrl: 'http://127.0.0.1:8000/health', smokePassed: true, error: null };
  it('parses the last valid NDJSON event', () => {
    expect(parseHandoff(`diagnostic\n${JSON.stringify(base)}\n`).pid).toBe(123);
  });
  it('rejects unsupported schema', () => {
    expect(() => parseHandoff(JSON.stringify({ ...base, schemaVersion: 2 }))).toThrow(/valid JSON handoff/);
  });
  it('rejects malformed handoff', () => {
    expect(() => parseHandoff(JSON.stringify({ schemaVersion: 1, status: 'ready' }))).toThrow(/valid JSON handoff/);
  });
  it('parses launcher capability and backend evidence', () => {
    const value = parseHandoff(JSON.stringify({
      ...base,
      launcherRevision: 'launcher-abc',
      capabilities: {
        protocolVersion: 1,
        launcherRevision: 'launcher-abc',
        profileRef: 'user/test.env',
        backends: { flashqlaLegacy: true, turboquant: true, mtp: true },
      },
      backend: {
        selected: 'flashqla_legacy',
        active: true,
        source: 'launcher',
        detail: 'legacy extension loaded',
      },
    }));
    expect(value.capabilities?.backends?.flashqlaLegacy).toBe(true);
    expect(value.backend).toMatchObject({ selected: 'flashqla_legacy', active: true });
  });

  it('rejects malformed capability evidence', () => {
    expect(() => parseHandoff(JSON.stringify({
      ...base,
      capabilities: { protocolVersion: 1, backends: { flashqlaLegacy: 'yes' } },
    }))).toThrow(/valid JSON handoff/);
  });

  it('accepts stopped handoff with no pid', () => {
    expect(parseHandoff(JSON.stringify({ ...base, status: 'stopped', pid: null, smokePassed: false })).status).toBe('stopped');
  });
});
