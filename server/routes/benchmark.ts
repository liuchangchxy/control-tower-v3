import { Router } from 'express';
import {
  runBenchmark,
  runWarmup,
  BENCHMARK_PRESETS,
  BENCHMARK_PROMPTS,
} from '../services/benchmark.js';
import { getLatestMetrics } from '../services/vllmMetrics.js';
import { getStatus } from '../services/processManager.js';
import { recordExperiment } from '../services/experimentTracker.js';
import type { ApiResponse } from '../types.js';

export const benchmarkRouter = Router();

// Concurrency guard (M16)
let benchmarkRunning = false;

// GET /api/benchmark/presets — list available presets
benchmarkRouter.get('/presets', (_req, res) => {
  res.json({ ok: true, data: BENCHMARK_PRESETS });
});

// GET /api/benchmark/prompts — legacy prompt presets
benchmarkRouter.get('/prompts', (_req, res) => {
  const prompts = Object.entries(BENCHMARK_PROMPTS).map(([key, text]) => ({
    id: key,
    text,
    estimatedTokens: Math.ceil(text.length / 4),
  }));
  res.json({ ok: true, data: prompts });
});

// POST /api/benchmark/run — run a benchmark
// New API: { presetId?, inputTokens?, outputTokens?, customPrompt?, rounds? }
// Legacy API: { prompt?, promptId?, rounds? }
benchmarkRouter.post('/run', async (req, res) => {
  try {
    if (benchmarkRunning) {
      return res.status(409).json({ ok: false, error: 'A benchmark is already in progress' });
    }
    benchmarkRunning = true;

    const status = getStatus();
    if (status.status !== 'ready') {
      benchmarkRunning = false;
      return res.status(400).json({
        ok: false,
        error: `Server not ready (status: ${status.status})`,
      });
    }

    const {
      presetId,
      inputTokens,
      outputTokens,
      customPrompt,
      prompt,      // legacy
      promptId,    // legacy
      rounds: roundsRaw = 1,
    } = req.body;

    const rounds = Number(roundsRaw);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
      benchmarkRunning = false;
      return res.status(400).json({ ok: false, error: 'rounds must be an integer between 1 and 20' });
    }

    // Resolve legacy prompt/promptId → customPrompt
    let resolvedCustomPrompt = customPrompt;
    if (!resolvedCustomPrompt && prompt) {
      resolvedCustomPrompt = prompt;
    }
    if (!resolvedCustomPrompt && promptId) {
      resolvedCustomPrompt = BENCHMARK_PROMPTS[promptId];
      if (!resolvedCustomPrompt) {
        return res.status(400).json({
          ok: false,
          error: `Unknown prompt ID: ${promptId}. Available: ${Object.keys(BENCHMARK_PROMPTS).join(', ')}`,
        });
      }
    }

    const port = status.port;

    // Warmup
    await runWarmup(port);

    // Run benchmark with new API
    const result = await runBenchmark({
      presetId: presetId ?? 'chat',
      inputTokens,
      outputTokens,
      customPrompt: resolvedCustomPrompt,
      rounds,
      port,
    });

    // Attach current metrics snapshot
    const metrics = getLatestMetrics();

    // Record experiment
    const expId = Date.now().toString(36);
    recordExperiment({
      id: expId,
      timestamp: Date.now(),
      profilePath: status.profilePath || '',
      profileSnapshot: {},
      startDurationSec: status.startedAt ? Math.floor((Date.now() - status.startedAt) / 1000) : 0,
      status: 'ready',
      benchmarkResults: [{
        size: 'custom' as const,
        promptTokens: result.promptTokens,
        generationTokens: result.actualOutputTokens,
        tokPerSec: result.throughputTokPerSec,
        ttftMs: result.ttftMs,
        totalTimeMs: result.e2eLatencyMs,
        rounds: result.rounds,
      }],
      notes: undefined,
    });

    res.json({ ok: true, data: { result, metrics } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    benchmarkRunning = false;
  }
});
