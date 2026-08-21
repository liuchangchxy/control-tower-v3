import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Experiment } from '../server/types.js';
import { loadExperiments, recordExperiment, getExperimentById, addNotes } from '../server/services/experimentTracker.js';

let tmpDir: string;
let runLogsDir: string;
let experimentsFile: string;

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-001',
    timestamp: Date.now(),
    profilePath: '/path/to/test.env',
    profileSnapshot: { SERVED_NAME: 'test-model', MODEL_FAMILY: 'qwen3' },
    startDurationSec: 12.5,
    status: 'ready',
    ...overrides,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-experiment-'));
  runLogsDir = path.join(tmpDir, 'run-logs');
  experimentsFile = path.join(runLogsDir, 'experiments.json');
});

afterEach(() => {
  // Clean up experiments file, any .corrupted backups, and .tmp files
  if (fs.existsSync(runLogsDir)) {
    for (const f of fs.readdirSync(runLogsDir)) {
      if (f.startsWith('experiments')) {
        fs.unlinkSync(path.join(runLogsDir, f));
      }
    }
    try { fs.rmdirSync(runLogsDir); } catch { /* ignore if not empty */ }
  }
});

describe('experimentTracker', () => {
  beforeEach(() => {
    process.env.CONTROL_TOWER_HOME = tmpDir;
  });

  it('returns empty array when no experiments file exists', () => {
    const exps = loadExperiments();
    expect(exps).toEqual([]);
  });

  it('records an experiment and loads it back', () => {
    const exp = makeExperiment();
    recordExperiment(exp);
    const loaded = loadExperiments();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('exp-001');
    expect(loaded[0].status).toBe('ready');
  });

  it('appends multiple experiments', () => {
    recordExperiment(makeExperiment({ id: 'exp-001' }));
    recordExperiment(makeExperiment({ id: 'exp-002', status: 'error' }));
    const loaded = loadExperiments();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('exp-001');
    expect(loaded[1].id).toBe('exp-002');
  });

  it('creates run-logs directory if it does not exist', () => {
    if (fs.existsSync(runLogsDir)) fs.rmdirSync(runLogsDir);
    recordExperiment(makeExperiment());
    expect(fs.existsSync(runLogsDir)).toBe(true);
    expect(fs.existsSync(experimentsFile)).toBe(true);
  });

  it('getExperimentById returns the matching experiment', () => {
    recordExperiment(makeExperiment({ id: 'exp-aaa' }));
    recordExperiment(makeExperiment({ id: 'exp-bbb' }));
    const found = getExperimentById('exp-bbb');
    expect(found).toBeDefined();
    expect(found!.id).toBe('exp-bbb');
  });

  it('getExperimentById returns undefined for missing id', () => {
    recordExperiment(makeExperiment({ id: 'exp-aaa' }));
    const found = getExperimentById('no-such-id');
    expect(found).toBeUndefined();
  });

  it('addNotes updates notes on the experiment', () => {
    recordExperiment(makeExperiment({ id: 'exp-001' }));
    const ok = addNotes('exp-001', 'Some observations here');
    expect(ok).toBe(true);
    const exp = getExperimentById('exp-001');
    expect(exp!.notes).toBe('Some observations here');
  });

  it('addNotes returns false for non-existent id', () => {
    recordExperiment(makeExperiment({ id: 'exp-001' }));
    const ok = addNotes('nonexistent', 'Notes');
    expect(ok).toBe(false);
  });

  it('addNotes persists changes to disk', () => {
    recordExperiment(makeExperiment({ id: 'exp-001' }));
    addNotes('exp-001', 'Persisted note');
    // Reload from disk
    const reloaded = loadExperiments();
    expect(reloaded[0].notes).toBe('Persisted note');
  });

  it('handles corrupted experiments file gracefully', () => {
    fs.mkdirSync(runLogsDir, { recursive: true });
    fs.writeFileSync(experimentsFile, '{bad json', 'utf-8');
    const loaded = loadExperiments();
    expect(loaded).toEqual([]);
  });
});
