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
    const readSize = Math.min(stat.size - start, maxBytes);
    const fd = fs.openSync(logFile, 'r');
    try {
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, buf.length, start);
      const content = buf.toString('utf-8');
      const allLines = content.split('\n').filter(Boolean);
      // If we read from the middle, the first line may be partial
      const tail = start > 0 ? allLines.slice(1).slice(-lines) : allLines.slice(-lines);
      res.json({ ok: true, data: { lines: tail } });
    } finally {
      fs.closeSync(fd);
    }
  } catch (err: any) {
    // Fallback: read only the last 64KB to avoid OOM on large files
    let fd: number | undefined;
    try {
      fd = fs.openSync(logFile, 'r');
      const stat = fs.fstatSync(fd);
      const readSize = Math.min(stat.size, 65536);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      const content = buf.toString('utf-8');
      const allLines = content.split('\n').filter(Boolean);
      const tail = allLines.slice(-lines);
      res.json({ ok: true, data: { lines: tail } });
    } catch {
      res.json({ ok: true, data: { lines: [] } });
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
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
