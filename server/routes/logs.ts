import { Router } from 'express';
import fs from 'node:fs';
import * as pm from '../services/processManager.js';

export const logsRouter = Router();

logsRouter.get('/', (req, res) => {
  const lines = parseInt(req.query.lines as string || '100', 10);
  const logFile = pm.getStatus().logFile;
  if (!logFile || !fs.existsSync(logFile)) {
    return res.json({ ok: true, data: { lines: [] } });
  }
  const content = fs.readFileSync(logFile, 'utf-8');
  const allLines = content.split('\n').filter(Boolean);
  const tail = allLines.slice(-lines);
  res.json({ ok: true, data: { lines: tail } });
});

logsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = pm.onLogLine(line => {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  });

  req.on('close', () => {
    unsub();
  });
});
