import express from 'express';
import cors from 'cors';
import path from 'node:path';
import type * as http from 'node:http';
import { serverRouter } from './routes/server.js';
import { profilesRouter } from './routes/profiles.js';
import { gpuRouter } from './routes/gpu.js';
import { logsRouter } from './routes/logs.js';
import { benchmarkRouter } from './routes/benchmark.js';
import { experimentsRouter } from './routes/experiments.js';
import { settingsRouter } from './routes/settings.js';
import { chatHistoryRouter } from './routes/chatHistory.js';

export interface RuntimeEndpointResolver {
  getEndpoint(): string;
}

export interface AppDependencies extends RuntimeEndpointResolver {
  home: string;
  clientDist?: string;
}

function proxyToVLLM(
  req: http.IncomingMessage & { body?: unknown },
  res: express.Response,
  runtime: RuntimeEndpointResolver,
): void {
  const reqPath = req.url ?? '/';
  if (reqPath.includes('..')) {
    res.status(400).json({ ok: false, error: 'Invalid path' });
    return;
  }
  const url = runtime.getEndpoint() + '/v1' + reqPath;
  const fwdHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['connection', 'transfer-encoding', 'keep-alive', 'host', 'content-length'].includes(key)) continue;
    fwdHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const rawBody = req.body;
  const bodyStr = rawBody && typeof rawBody === 'object' && Object.keys(rawBody).length > 0
    ? JSON.stringify(rawBody)
    : undefined;
  if (bodyStr) fwdHeaders['content-type'] = fwdHeaders['content-type'] || 'application/json';

  fetch(url, { method: req.method, headers: fwdHeaders, body: bodyStr })
    .then(upstream => {
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!['connection', 'transfer-encoding', 'keep-alive'].includes(key)) res.setHeader(key, value);
      });
      const reader = upstream.body?.getReader();
      if (!reader) { res.end(); return; }
      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) { res.end(); return; }
          res.write(value);
          pump();
        }).catch(() => res.end());
      };
      pump();
    })
    .catch(err => {
      console.error(`[proxy] ${req.method} ${url} failed: ${err.message}`);
      if (!res.headersSent) res.status(502).json({ ok: false, error: `vLLM unreachable: ${err.message}` });
      else res.end();
    });
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/192\.168\.\d+\.\d+:\d+$/, /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/] }));
  // Claude Code requests include long tool schemas and conversation history.
  // This is an HTTP-body limit, not the model's token context limit.
  app.use(express.json({ limit: '32mb' }));
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`);
    next();
  });

  app.use('/api/server', serverRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/gpu', gpuRouter);
  app.use('/api/logs', logsRouter);
  app.use('/api/benchmark', benchmarkRouter);
  app.use('/api/experiments', experimentsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/chat-history', chatHistoryRouter);
  app.use('/v1', (req, res) => proxyToVLLM(req, res, deps));

  const clientDist = deps.clientDist ?? path.join(deps.home, 'client', 'dist');
  if (clientDist) {
    app.use(express.static(clientDist));
    app.use((req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'Request body too large', limit: '32mb' });
    }
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  });
  return app;
}
