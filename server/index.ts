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
  const reqPath = req.url ?? '/';
  if (reqPath.includes('..')) {
    res.status(400).json({ ok: false, error: 'Invalid path' });
    return;
  }
  const upstream = getVLLMBaseUrl();
  const url = upstream + '/v1' + reqPath;

  // Rebuild headers
  const fwdHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue;
    if (['connection','transfer-encoding','keep-alive','host','content-length'].includes(k)) continue;
    fwdHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
  }

  // express.json() consumed the stream — reconstruct body from req.body
  const rawBody = (req as any).body;
  const bodyStr = (rawBody && typeof rawBody === 'object' && Object.keys(rawBody).length > 0)
    ? JSON.stringify(rawBody)
    : undefined;

  if (bodyStr) {
    fwdHeaders['content-type'] = fwdHeaders['content-type'] || 'application/json';
  }

  fetch(url, {
    method: req.method,
    headers: fwdHeaders,
    body: bodyStr,
  }).then(upstreamRes => {
    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((v, k) => {
      if (['connection','transfer-encoding','keep-alive'].includes(k)) return;
      res.setHeader(k, v);
    });
    // Stream the response body
    const reader = upstreamRes.body?.getReader();
    if (!reader) { res.end(); return; }
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) { res.end(); return; }
        res.write(value);
        pump();
      }).catch(() => res.end());
    };
    pump();
  }).catch(err => {
    console.error(`[proxy] ${req.method} ${url} failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: `vLLM unreachable: ${err.message}` });
    } else {
      res.end();
    }
  });
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
