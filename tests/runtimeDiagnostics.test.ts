import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeDiagnostics } from '../server/services/runtimeDiagnostics.js';

let home: string;
let previous: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-diagnostics-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ launcherDir: path.join(home, 'launcher'), modelDir: '/fake/model', logDir: 'run-logs', stateFile: 'state.json' }));
  previous = process.env.CONTROL_TOWER_HOME;
  process.env.CONTROL_TOWER_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.CONTROL_TOWER_HOME; else process.env.CONTROL_TOWER_HOME = previous;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('runtime diagnostics', () => {
  it('writes correlated JSONL lifecycle events', () => {
    const diagnostics = new RuntimeDiagnostics();
    const run = diagnostics.createRun();
    diagnostics.event(run, 'launch_requested', { profile: 'user/fake.env', servedName: 'fake-model', port: 8000, pid: null, pgid: null }, { prompt: 'x'.repeat(3000) });
    const lines = fs.readFileSync(run.eventLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ runId: run.runId, phase: 'launch_requested', profile: 'user/fake.env', servedName: 'fake-model', port: 8000 });
    expect(lines[0].details.prompt).toHaveLength(2001);
  });

  it('captures a best-effort postmortem without requiring a live pid', async () => {
    const diagnostics = new RuntimeDiagnostics();
    const run = diagnostics.createRun();
    const snapshot = await diagnostics.capturePostmortem(run, null, { profile: 'user/fake.env', servedName: 'fake-model', port: 8000 });
    expect(snapshot).toBe(path.join(run.snapshotDir, 'snapshot.txt'));
    expect(fs.existsSync(snapshot!)).toBe(true);
    expect(fs.readFileSync(run.eventLog, 'utf8')).toContain('postmortem_captured');
  });
});
