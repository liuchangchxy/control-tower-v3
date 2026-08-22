import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import * as http from 'node:http';
import { serverRouter } from './routes/server.js';
import { profilesRouter } from './routes/profiles.js';
import { gpuRouter } from './routes/gpu.js';
import { logsRouter } from './routes/logs.js';
import { benchmarkRouter } from './routes/benchmark.js';
import { experimentsRouter } from './routes/experiments.js';
import { settingsRouter } from './routes/settings.js';
import { recoverFromState, getStatus as getProcessStatus } from './services/processManager.js';

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
let config: Record<string, unknown>;
try {
  config = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf-8'));
} catch (err: any) {
  console.error(`Failed to load config.json from ${HOME}: ${err.message}`);
  process.exit(1);
}
const PORT = (config as any).port || 9090;

const app = express();
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/192\.168\.\d+\.\d+:\d+$/, /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/] }));
app.use(express.json());

// Request logging for debugging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// API routes
app.use('/api/server', serverRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/gpu', gpuRouter);
app.use('/api/logs', logsRouter);
app.use('/api/benchmark', benchmarkRouter);
app.use('/api/experiments', experimentsRouter);
app.use('/api/settings', settingsRouter);

// ── /v1 reverse proxy to vLLM ────────────────────────────────────────────────
// Stream-friendly proxy for /v1/chat/completions (SSE) plus any other vLLM
// /v1/* endpoint exposed by the running model server. Uses the live status
// port so restarts/port changes are picked up automatically.
function getVLLMBaseUrl(): string {
  const port = (getProcessStatus().port ?? 8000);
  return `http://127.0.0.1:${port}`;
}

function proxyToVLLM(req: http.IncomingMessage, res: express.Response): void {
  const upstream = getVLLMBaseUrl();
  const url = upstream + (req.url ?? '');
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // Skip hop-by-hop and Host — Node will set Host from the upstream URL.
    if (k === 'connection' || k === 'transfer-encoding' || k === 'keep-alive' || k === 'host') continue;
    headers[k] = v as string | string[];
  }
  const proxyReq = http.request(url, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 502);
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      // Skip hop-by-hop headers; express will set its own transfer-encoding
      if (k === 'connection' || k === 'transfer-encoding' || k === 'keep-alive') continue;
      res.setHeader(k, v as string | string[]);
    }
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: `vLLM unreachable: ${err.message}` });
    } else {
      res.end();
    }
  });
  req.on('close', () => proxyReq.destroy());
  req.pipe(proxyReq);
}

app.use('/v1', proxyToVLLM);

// Serve React build in production
const clientDist = path.join(HOME, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Only catch-all for non-API paths
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Global error handler — prevents Express from leaking stack traces (C1)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// Recover state on startup
recoverFromState().then(() => {
  app.listen(PORT, () => {
    console.log(`Control Tower v3 running on http://localhost:${PORT}`);
  });
});
