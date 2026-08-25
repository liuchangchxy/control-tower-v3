import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { serverRouter } from './routes/server.js';
import { profilesRouter } from './routes/profiles.js';
import { gpuRouter } from './routes/gpu.js';
import { logsRouter } from './routes/logs.js';
import { benchmarkRouter } from './routes/benchmark.js';
import { experimentsRouter } from './routes/experiments.js';
import { settingsRouter } from './routes/settings.js';
import { chatHistoryRouter } from './routes/chatHistory.js';

export interface AppDependencies {
  home: string;
  clientDist?: string;
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/192\.168\.\d+\.\d+:\d+$/, /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/] }));
  app.use('/v1', (_req, res) => res.status(410).json({
    ok: false,
    error: 'The Control Tower no longer proxies the model API. Connect directly to the vLLM endpoint shown in the dashboard.',
  }));
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
