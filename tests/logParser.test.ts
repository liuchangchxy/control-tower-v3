import { describe, it, expect } from 'vitest';
import { parseLine, isErrorLine, extractProgressPercent, interpolateProgress, STAGES } from '../server/services/logParser';

describe('logParser', () => {
  describe('stage patterns', () => {
    it('detects weights stage from "Loading model"', () => {
      const stage = parseLine('INFO: Loading model weights...');
      expect(stage?.id).toBe('weights');
    });

    it('detects weights stage from "Loading safetensors"', () => {
      const stage = parseLine('Loading safetensors checkpoint shards');
      expect(stage?.id).toBe('weights');
    });

    it('detects weights stage from "checkpoint shards"', () => {
      const stage = parseLine('Loading checkpoint shards: 50% Completed |████      | 2/4');
      expect(stage?.id).toBe('weights');
    });

    it('detects compile_backbone from "Using cache directory...backbone"', () => {
      const stage = parseLine('Using cache directory: /home/.cache/vllm/torch_compile_cache/abc123/backbone');
      expect(stage?.id).toBe('compile_backbone');
    });

    it('detects compile_backbone from "Dynamo bytecode transform"', () => {
      const stage = parseLine('dynamo bytecode transform time: 3.45 s');
      expect(stage?.id).toBe('compile_backbone');
    });

    it('detects compile_backbone from "Compiling...backbone"', () => {
      const stage = parseLine('Compiling aot_inductor model for backbone');
      expect(stage?.id).toBe('compile_backbone');
    });

    it('detects compile_eagle from "Using cache directory...eagle_head"', () => {
      const stage = parseLine('Using cache directory: /home/.cache/vllm/torch_compile_cache/abc123/eagle_head');
      expect(stage?.id).toBe('compile_eagle');
    });

    it('detects compile_eagle from "Compiling...eagle"', () => {
      const stage = parseLine('Compiling aot_inductor model for eagle_head');
      expect(stage?.id).toBe('compile_eagle');
    });

    it('detects cudagraph stage', () => {
      const stage = parseLine('Capturing CUDA graph for 256 tokens');
      expect(stage?.id).toBe('cudagraph');
    });

    it('detects kvcache stage', () => {
      const stage = parseLine('KV cache memory: 4096 blocks allocated');
      expect(stage?.id).toBe('kvcache');
    });

    it('detects kvcache stage from num_4k_blocks', () => {
      const stage = parseLine('num_4k_blocks: 512');
      expect(stage?.id).toBe('kvcache');
    });

    it('detects warmup stage', () => {
      const stage = parseLine('torch.compile took 12.34 s in total');
      expect(stage?.id).toBe('warmup');
    });

    it('detects server stage from "Uvicorn"', () => {
      const stage = parseLine('INFO: Uvicorn running on http://0.0.0.0:8000');
      expect(stage?.id).toBe('server');
    });

    it('does NOT detect "init" stage — removed', () => {
      const stage = parseLine('Initializing a VLLM engine...');
      expect(stage).toBeNull();
    });

    it('does NOT match "Loading weights took" as weights stage', () => {
      const stage = parseLine('Loading safetensors took 5.2 seconds');
      expect(stage).toBeNull();
    });
  });

  describe('isErrorLine', () => {
    it('detects OutOfMemoryError', () => {
      expect(isErrorLine('torch.OutOfMemoryError: CUDA out of memory')).toBe(true);
    });

    it('detects Traceback', () => {
      expect(isErrorLine('Traceback (most recent call last):')).toBe(true);
    });

    it('does not false-positive on normal lines', () => {
      expect(isErrorLine('Loading model weights...')).toBe(false);
    });
  });

  describe('extractProgressPercent', () => {
    it('extracts tqdm-style percentage', () => {
      expect(extractProgressPercent('50%|████      | 2/4')).toBe(50);
    });

    it('extracts "Completed" percentage', () => {
      expect(extractProgressPercent('75.0% Completed |██████████| 3/4')).toBe(75);
    });

    it('extracts parenthesized percentage', () => {
      expect(extractProgressPercent('Loading (25%)')).toBe(25);
    });

    it('returns null for non-progress lines', () => {
      expect(extractProgressPercent('Loading model weights...')).toBeNull();
    });
  });

  describe('interpolateProgress', () => {
    const weightsStage = STAGES.find(s => s.id === 'weights')!;
    const backboneStage = STAGES.find(s => s.id === 'compile_backbone')!;
    const serverStage = STAGES.find(s => s.id === 'server')!;

    it('uses real tqdm percentage for weights stage', () => {
      const progress = interpolateProgress(weightsStage, 10, 50);
      // 0 + (50/100) * 25 = 12.5
      expect(progress).toBeCloseTo(12.5, 0);
    });

    it('starts at progressStart for compile stage at t=0', () => {
      const progress = interpolateProgress(backboneStage, 0, null);
      expect(progress).toBe(25);
    });

    it('keeps unknown compile progress indeterminate at the stage start', () => {
      // Compile stages have no trustworthy percentage source. Keep the bar at
      // the stage boundary instead of inventing elapsed-time progress.
      const progress = interpolateProgress(backboneStage, 600, null);
      expect(progress).toBe(backboneStage.progressStart);
      expect(progress).toBeLessThan(backboneStage.progressEnd);
    });

    it('never returns a value below progressStart', () => {
      const progress = interpolateProgress(backboneStage, 0, null);
      expect(progress).toBeGreaterThanOrEqual(backboneStage.progressStart);
    });

    it('handles server stage correctly', () => {
      const progress = interpolateProgress(serverStage, 0, null);
      expect(progress).toBe(90);
    });
  });
});
