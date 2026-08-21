import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeError } from '../server/services/errorAnalyzer.js';
import { isErrorLine } from '../server/services/logParser.js';

// Test the error analysis pipeline that processManager now uses.
// processManager itself depends on spawn/pgrep/nvidia-smi which make it
// unsuitable for unit testing without heavy mocking. These tests verify
// the integration logic that processManager delegates to.

describe('processManager error integration', () => {
  it('isErrorLine detects OOM errors', () => {
    expect(isErrorLine('torch.cuda.OutOfMemoryError: CUDA out of memory.')).toBe(true);
  });

  it('isErrorLine detects CUDA errors', () => {
    expect(isErrorLine('RuntimeError: CUDA error: device-side assert triggered')).toBe(true);
  });

  it('isErrorLine returns false for normal log lines', () => {
    expect(isErrorLine('INFO: Loading model weights...')).toBe(false);
  });

  it('analyzeError returns diagnosis for OOM', () => {
    const line = 'torch.cuda.OutOfMemoryError: CUDA out of memory.';
    const diagnosis = analyzeError([line]);
    expect(diagnosis.errorType).toBe('oom_startup');
    expect(diagnosis.message).toContain('out of memory');
    expect(diagnosis.repairs.length).toBeGreaterThan(0);
  });

  it('analyzeError returns diagnosis for CUDA error', () => {
    const line = 'RuntimeError: CUDA error: device-side assert triggered';
    const diagnosis = analyzeError([line]);
    expect(diagnosis.errorType).toBe('cuda_error');
    expect(diagnosis.repairs[0].description).toContain('temperature');
  });

  it('analyzeError returns unknown for unrecognized lines', () => {
    const line = 'INFO: Some normal log output';
    const diagnosis = analyzeError([line]);
    expect(diagnosis.errorType).toBe('unknown');
    expect(diagnosis.repairs.length).toBe(0);
  });

  it('processManager exports restart function', async () => {
    // Dynamic import to check the export exists
    const mod = await import('../server/services/processManager.js');
    expect(typeof mod.restart).toBe('function');
  });

  it('restart throws when no profile loaded', async () => {
    const mod = await import('../server/services/processManager.js');
    // stop() clears state, so restart should throw
    await mod.stop().catch(() => {}); // ignore errors from stop
    await expect(mod.restart()).rejects.toThrow('No profile to restart with');
  });
});
