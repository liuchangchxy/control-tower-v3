import { Router } from 'express';
import { getGPUSnapshot, getSystemSnapshot } from '../services/gpuMonitor.js';
import { gpuEventHub } from '../services/gpuEventHub.js';

export const gpuRouter = Router();

gpuRouter.get('/', async (_req, res) => {
  try {
    const data = await getGPUSnapshot();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

gpuRouter.get('/system', async (_req, res) => {
  try {
    const data = await getSystemSnapshot();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

gpuRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stop = gpuEventHub.subscribe(data => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { stop(); }
  });

  req.on('close', () => {
    stop();
  });
});
