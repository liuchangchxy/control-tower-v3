import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadState, saveState, clearState } from '../server/services/state.js';

let tmpDir: string;
let stateFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-state-'));
  stateFile = path.join(tmpDir, 'state.json');
});

describe('state service', () => {
  beforeEach(() => {
    process.env.CONTROL_TOWER_HOME = tmpDir;
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  it('returns null when state file does not exist', () => {
    const s = loadState();
    expect(s).toBeNull();
  });

  it('persists and loads state', () => {
    saveState({ pid: 12345, profile: 'qwen27b/normal/int4/test.env', profilePath: '/abs/path/test.env', logFile: '/abs/path/test.log', startedAt: Date.now(), servedName: 'test-served', port: 8000 });
    const s = loadState();
    expect(s).not.toBeNull();
    expect(s!.pid).toBe(12345);
    expect(s!.profile).toBe('qwen27b/normal/int4/test.env');
    expect(s!.servedName).toBe('test-served');
    expect(s!.port).toBe(8000);
  });

  it('clears state file', () => {
    saveState({ pid: 12345, profile: null, profilePath: null, logFile: null, startedAt: null, servedName: null, port: 8000 });
    expect(fs.existsSync(stateFile)).toBe(true);
    clearState();
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});
