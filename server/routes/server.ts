import { Router } from 'express';
import * as pm from '../services/processManager.js';
import { getLatestMetrics, getMetricsHistory, onMetricsSample } from '../services/vllmMetrics.js';
import type { ApiResponse } from '../types.js';

export const serverRouter = Router();

serverRouter.get('/status', (_req, res) => {
  const status = pm.getStatus();
  res.json({ ok: true, data: status } satisfies ApiResponse<typeof status>);
});

serverRouter.post('/start', async (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) {
      return res.status(400).json({ ok: false, error: 'profile required' });
    }
    await pm.start(profile);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

serverRouter.post('/stop', async (_req, res) => {
  try {
    await pm.stop();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

serverRouter.post('/kill', async (_req, res) => {
  try {
    await pm.kill();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

serverRouter.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsub();
  };

  const unsub = pm.onProgress(event => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { cleanup(); }
  });

  // Heartbeat to detect dead connections (M15)
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
  }, 15000);

  req.on('close', cleanup);
});

// ── Restart ──────────────────────────────────────────────────────────────────

serverRouter.post('/restart', async (_req, res) => {
  try {
    await pm.restart();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Metrics (snapshot + history) ─────────────────────────────────────────────

serverRouter.get('/metrics', (_req, res) => {
  const latest = getLatestMetrics();
  res.json({ ok: true, data: latest });
});

serverRouter.get('/metrics/history', (_req, res) => {
  const history = getMetricsHistory();
  res.json({ ok: true, data: history });
});

// ── Metrics SSE stream ──────────────────────────────────────────────────────

serverRouter.get('/metrics/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let cleaned = false;
  const unsubscribe = onMetricsSample(metric => {
    if (cleaned) return;
    try { res.write(`data: ${JSON.stringify(metric)}\n\n`); } catch { cleanup(); }
  });
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
  }, 15000);
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
});
