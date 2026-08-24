import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlPlane } from '../server/services/controlPlane.js';

const handoff = (status: 'ready' | 'stopped', pid: number | null = 4242) => ({
  schemaVersion: 1 as const,
  status,
  profile: 'user/fake.env',
  servedName: 'fake-model',
  modelDir: '/fake/model',
  pid,
  pgid: pid,
  pidFile: '/tmp/fake.pid',
  logFile: null,
  stateFile: '/tmp/fake-state.json',
  port: 8000,
  startedAt: 1,
  healthUrl: 'http://127.0.0.1:8000/health',
  smokePassed: status === 'ready',
  error: null,
});

describe('ControlPlane launcher boundary', () => {
  let home: string;
  let previous: string | undefined;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-control-plane-'));
    fs.mkdirSync(path.join(home, 'launcher', 'profiles', 'user'), { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ launcherDir: path.join(home, 'launcher'), modelDir: '/fake/model', stateFile: 'state.json', logDir: 'run-logs' }));
    fs.writeFileSync(path.join(home, 'launcher', 'profiles', 'user', 'fake.env'), 'SERVED_NAME=fake-model\n');
    previous = process.env.CONTROL_TOWER_HOME;
    process.env.CONTROL_TOWER_HOME = home;
  });
  afterEach(() => { if (previous === undefined) delete process.env.CONTROL_TOWER_HOME; else process.env.CONTROL_TOWER_HOME = previous; fs.rmSync(home, { recursive: true, force: true }); });

  it('delegates lifecycle and persists launcher identity', async () => {
    const calls: string[] = [];
    const launcher = {
      start: async () => { calls.push('start'); return handoff('ready'); },
      status: async () => handoff('ready'),
      stop: async () => { calls.push('stop'); return handoff('stopped', null); },
      kill: async () => { calls.push('kill'); return handoff('stopped', null); },
      restart: async () => { calls.push('restart'); return handoff('ready', 5252); },
    } as any;
    const plane = new ControlPlane({ launcher });
    await plane.start('user/fake.env');
    expect(calls).toEqual(['start']);
    expect(plane.getStatus()).toMatchObject({ status: 'ready', pid: 4242, profile: 'user/fake.env' });
    await plane.restart();
    expect(calls).toEqual(['start', 'restart']);
    expect(plane.getStatus()).toMatchObject({ status: 'ready', pid: 5252 });
    await plane.stop();
    expect(calls).toEqual(['start', 'restart', 'stop']);
    expect(plane.getStatus().status).toBe('stopped');
  });

  it('rejects concurrent lifecycle operations', async () => {
    let release!: () => void;
    const launcher = { start: () => new Promise(resolve => { release = () => resolve(handoff('ready')); }), status: async () => handoff('ready'), stop: async () => handoff('stopped', null), kill: async () => handoff('stopped', null), restart: async () => handoff('ready') } as any;
    const plane = new ControlPlane({ launcher });
    const pending = plane.start('user/fake.env');
    await expect(plane.start('user/fake.env')).rejects.toThrow('Operation already in progress');
    release();
    await pending;
    await plane.stop();
  });
});
