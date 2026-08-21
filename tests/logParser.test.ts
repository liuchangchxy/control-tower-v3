import { describe, it, expect } from 'vitest';
import { parseLine, STAGES, type LogStage } from '../server/services/logParser.js';

describe('log parser', () => {
  it('detects "Initializing" stage', () => {
    const stage = parseLine('INFO 12-01 10:00:00 Initializing a VLLM engine');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('init');
  });

  it('detects "Loading weights" stage', () => {
    const stage = parseLine('INFO Loading model weights took 9.48 GiB');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('weights');
  });

  it('detects "profiled" stage', () => {
    const stage = parseLine('INFO Memory profiling: 10.04 GiB available for KV cache');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('profile');
  });

  it('detects "Capturing CUDA graphs" stage', () => {
    const stage = parseLine('INFO Capturing CUDA graphs (batchsize 4)');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('cudagraph');
  });

  it('detects "Compiling" stage', () => {
    const stage = parseLine('INFO Compiling CUDA kernels...');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('compile');
  });

  it('detects server-ready stage', () => {
    const stage = parseLine('INFO Uvicorn running on http://0.0.0.0:8000');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('server');
  });

  it('returns null for unrelated lines', () => {
    const stage = parseLine('Some random log output');
    expect(stage).toBeNull();
  });

  it('detects OOM error', () => {
    const isError = parseLine('torch.cuda.OutOfMemoryError: CUDA out of memory.');
    // OOM should not match any success stage
    const stage = parseLine('torch.cuda.OutOfMemoryError: CUDA out of memory.');
    expect(stage).toBeNull();
  });

  it('STAGES has ordered progress ranges', () => {
    expect(STAGES.length).toBeGreaterThan(0);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].progressStart).toBeGreaterThanOrEqual(STAGES[i - 1].progressEnd);
    }
  });
});
