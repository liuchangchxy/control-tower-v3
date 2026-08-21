import { Router } from 'express';
import fs from 'node:fs';
import * as pm from '../services/processManager.js';

export const logsRouter = Router();

logsRouter.get('/', (req, res) => {
  const raw = parseInt(req.query.lines as string || '100', 10);
  const lines = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 10000) : 100;
  const logFile = pm.getStatus().logFile;
  if (!logFile || !fs.existsSync(logFile)) {
    return res.json({ ok: true, data: { lines: [] } });
  }

  // Read from end of file to avoid OOM on large logs (H10)
  try {
    const stat = fs.statSync(logFile);
    const maxBytes = lines * 500; // estimate ~500 bytes per log line
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logFile, 'r');
    const buf = Buffer.alloc(Math.min(stat.size - start, maxBytes));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const content = buf.toString('utf-8');
    const allLines = content.split('\n').filter(Boolean);
    // If we read from the middle, the first line may be partial
    const tail = start > 0 ? allLines.slice(1).slice(-lines) : allLines.slice(-lines);
    res.json({ ok: true, data: { lines: tail } });
  } catch (err: any) {
    // Fallback: read entire file for small files
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    const tail = allLines.slice(-lines);
    res.json({ ok: true, data: { lines: tail } });
  }
});

logsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = pm.onLogLine(line => {
    try { res.write(`data: ${JSON.stringify({ line })}\n\n`); } catch { unsub(); }
  });

  req.on('close', () => {
    unsub();
  });
});
