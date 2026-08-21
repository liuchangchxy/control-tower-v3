import { describe, it, expect } from 'vitest';
import { analyzeError } from '../server/services/errorAnalyzer.js';

describe('error analyzer', () => {
  it('detects OOM and suggests GPU_UTIL reduction', () => {
    const logLines = ['torch.cuda.OutOfMemoryError: CUDA out of memory.'];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('oom_startup');
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.repairs[0].profilePatch.GPU_UTIL).toBeLessThan(0.88);
  });

  it('detects OOM in multi-line logs', () => {
    const logLines = [
      'INFO: Initializing vLLM engine',
      'INFO: Loading model weights...',
      'torch.cuda.OutOfMemoryError: CUDA out of memory. Tried to allocate 256.00 MiB',
      'Process ended with exit code 1',
    ];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('oom_startup');
    expect(result.message).toContain('out of memory');
  });

  it('detects CUDA error', () => {
    const logLines = ['RuntimeError: CUDA error: device-side assert triggered'];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('cuda_error');
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.repairs[0].description).toContain('temperature');
  });

  it('detects workspace allocation failure', () => {
    const logLines = ['RuntimeError: CUDA workspace allocation failed'];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('workspace_alloc_failed');
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('detects port conflict', () => {
    const logLines = ['OSError: [Errno 98] Address already in use'];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('port_in_use');
    expect(result.repairs.length).toBe(1);
    expect(result.repairs[0].profilePatch.PORT).toBe(8001);
  });

  it('returns unknown for unrecognized errors', () => {
    const logLines = ['Some random log line with no error'];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('unknown');
    expect(result.repairs.length).toBe(0);
  });

  it('handles empty log lines', () => {
    const result = analyzeError([]);
    expect(result.errorType).toBe('unknown');
    expect(result.message).toContain('No log lines');
    expect(result.repairs.length).toBe(0);
  });

  it('OOM repair patches GPU_UTIL below 0.88', () => {
    const logLines = ['OutOfMemoryError: CUDA out of memory'];
    const result = analyzeError(logLines);
    const gpuUtil = result.repairs.find((r) => r.profilePatch.GPU_UTIL !== undefined);
    expect(gpuUtil).toBeDefined();
    expect(gpuUtil!.profilePatch.GPU_UTIL!).toBeLessThan(0.88);
  });

  it('OOM repair includes MAX_MODEL_LEN reduction', () => {
    const logLines = ['OutOfMemoryError: CUDA out of memory'];
    const result = analyzeError(logLines);
    const lenRepair = result.repairs.find((r) => r.profilePatch.MAX_MODEL_LEN !== undefined);
    expect(lenRepair).toBeDefined();
    expect(lenRepair!.profilePatch.MAX_MODEL_LEN!).toBeLessThanOrEqual(131072);
  });

  // ── Task 4: Error context ±25 lines ──────────────────────────────────────

  it('includes context array with surrounding lines', () => {
    const logLines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    logLines[10] = 'RuntimeError: something broke';
    const result = analyzeError(logLines);
    expect(result.context).toBeDefined();
    expect(Array.isArray(result.context)).toBe(true);
    expect(result.context.length).toBe(20); // all 20 lines fit within ±25
    expect(result.context).toContain('RuntimeError: something broke');
  });

  it('context extracts ±25 lines around error', () => {
    // 60 lines, error at index 30
    const logLines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    logLines[30] = 'OutOfMemoryError: CUDA out of memory';
    const result = analyzeError(logLines);
    expect(result.context.length).toBe(51); // 25 before + error + 25 after
    expect(result.context[0]).toBe('line 5'); // 30 - 25 = 5
    expect(result.context[25]).toBe('OutOfMemoryError: CUDA out of memory');
    expect(result.context[50]).toBe('line 55'); // 30 + 25 = 55
  });

  it('context clamps to start/end of log', () => {
    // Error at index 2 — can only go 2 lines back
    const logLines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    logLines[2] = 'CUDA error: something';
    const result = analyzeError(logLines);
    expect(result.context.length).toBe(10); // all lines fit
    expect(result.context[0]).toBe('line 0');
  });

  it('context for unknown error uses first error/exception line', () => {
    const logLines = [
      'INFO: normal',
      'WARNING: almost there',
      'ERROR: something unexpected',
      'INFO: continuing',
    ];
    const result = analyzeError(logLines);
    expect(result.errorType).toBe('unknown');
    expect(result.context).toBeDefined();
    expect(result.context.length).toBe(4);
  });

  it('empty logs return empty context', () => {
    const result = analyzeError([]);
    expect(result.context).toEqual([]);
  });
});
