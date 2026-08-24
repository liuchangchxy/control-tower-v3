import { BENCHMARK_PROMPTS, BENCHMARK_PRESETS, runBenchmark, runWarmup } from './benchmark.js';
import { getLatestMetrics } from './vllmMetrics.js';
import { recordExperiment } from './experimentTracker.js';
import type { DetailedBenchmarkResult, VLLMMetrics, VLLMProcess } from '../types.js';
import { controlPlane } from './controlPlane.js';

export interface BenchmarkRequest {
  presetId?: string;
  inputTokens?: number;
  outputTokens?: number;
  customPrompt?: string;
  prompt?: string;
  promptId?: string;
  rounds?: number;
}

export class BenchmarkOrchestrator {
  private running = false;
  constructor(private readonly runtime: { getStatus(): VLLMProcess } = { getStatus: () => ({ status: 'stopped' } as VLLMProcess) }) {}
  get presets() { return BENCHMARK_PRESETS; }
  get prompts() { return Object.entries(BENCHMARK_PROMPTS).map(([id, text]) => ({ id, text, estimatedTokens: Math.ceil(text.length / 4) })); }
  async run(request: BenchmarkRequest): Promise<{ result: DetailedBenchmarkResult; metrics: VLLMMetrics | null }> {
    if (this.running) throw Object.assign(new Error('A benchmark is already in progress'), { statusCode: 409 });
    this.running = true;
    try {
      const status = this.runtime.getStatus();
      if (status.status !== 'ready') throw Object.assign(new Error(`Server not ready (status: ${status.status})`), { statusCode: 400 });
      const rounds = Number(request.rounds ?? 1);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw Object.assign(new Error('rounds must be an integer between 1 and 20'), { statusCode: 400 });
      let customPrompt = request.customPrompt ?? request.prompt;
      if (!customPrompt && request.promptId) {
        customPrompt = BENCHMARK_PROMPTS[request.promptId];
        if (!customPrompt) throw Object.assign(new Error(`Unknown prompt ID: ${request.promptId}. Available: ${Object.keys(BENCHMARK_PROMPTS).join(', ')}`), { statusCode: 400 });
      }
      await runWarmup(status.port);
      const result = await runBenchmark({ presetId: request.presetId ?? 'chat', inputTokens: request.inputTokens, outputTokens: request.outputTokens, customPrompt, rounds, port: status.port });
      const metrics = getLatestMetrics();
      void recordExperiment({ id: Date.now().toString(36), timestamp: Date.now(), profilePath: status.profilePath || '', profileSnapshot: {}, startDurationSec: status.startedAt ? Math.floor((Date.now() - status.startedAt) / 1000) : 0, status: 'ready', benchmarkResults: [{ size: 'custom', promptTokens: result.promptTokens, generationTokens: result.actualOutputTokens, tokPerSec: result.throughputTokPerSec, ttftMs: result.ttftMs, totalTimeMs: result.e2eLatencyMs, rounds: result.rounds }] }).catch(err => console.error('Failed to record experiment:', err));
      return { result, metrics };
    } finally { this.running = false; }
  }
}

export const benchmarkOrchestrator = new BenchmarkOrchestrator({ getStatus: () => controlPlane.getStatus() });
