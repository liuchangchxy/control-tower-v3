import { describe, expect, it } from 'vitest';
import { parseLauncherHandoff, validateLauncherHandoff } from '../server/services/launcherProtocol.js';

const base = {
  schemaVersion: 1 as const,
  status: 'stopped' as const,
  profile: 'user/fake.env',
  servedName: 'fake-model',
  modelDir: '/fake/model',
  pid: null,
  pgid: null,
  pidFile: '/tmp/fake.pid',
  logFile: null,
  stateFile: '/tmp/fake-state.json',
  port: 8000,
  startedAt: 1,
  healthUrl: 'http://127.0.0.1:8000/health',
  smokePassed: false,
  error: null,
};

describe('launcher runtime evidence', () => {
  it('accepts a stopped handoff with a matching orphan runtime', () => {
    const handoff = {
      ...base,
      runtimeEvidence: {
        state: 'present' as const,
        pid: 1234,
        pgid: 1234,
        port: 8000,
        apiReachable: true,
        modelMatches: true,
        processMatches: true,
        detail: 'matching vLLM runtime remains after launcher state reset',
      },
      apiAvailable: true,
    };
    expect(() => validateLauncherHandoff(handoff)).not.toThrow();
    expect(parseLauncherHandoff(JSON.stringify(handoff))).toMatchObject({
      status: 'stopped',
      runtimeEvidence: { state: 'present', pid: 1234, modelMatches: true },
    });
  });

  it('rejects malformed evidence instead of permitting unsafe cleanup', () => {
    expect(() => validateLauncherHandoff({ ...base, runtimeEvidence: { state: 'present' } })).toThrow();
  });
});
