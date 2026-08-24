import { Router } from 'express';
import { BENCHMARK_PROMPTS } from '../services/benchmark.js';
import { benchmarkOrchestrator } from '../services/benchmarkOrchestrator.js';

export const benchmarkRouter = Router();
benchmarkRouter.get('/presets', (_req, res) => res.json({ ok: true, data: benchmarkOrchestrator.presets }));
benchmarkRouter.get('/prompts', (_req, res) => res.json({ ok: true, data: benchmarkOrchestrator.prompts }));
benchmarkRouter.post('/run', async (req, res) => {
  try { res.json({ ok: true, data: await benchmarkOrchestrator.run(req.body) }); }
  catch (err: any) { res.status(err.statusCode ?? 500).json({ ok: false, error: err.message }); }
});
