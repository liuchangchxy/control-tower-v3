import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { serverRouter } from './routes/server.js';
import { profilesRouter } from './routes/profiles.js';
import { gpuRouter } from './routes/gpu.js';
import { logsRouter } from './routes/logs.js';
import { benchmarkRouter } from './routes/benchmark.js';
import { experimentsRouter } from './routes/experiments.js';
import { settingsRouter } from './routes/settings.js';
import { recoverFromState } from './services/processManager.js';

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
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
app.use(express.json());

// API routes
app.use('/api/server', serverRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/gpu', gpuRouter);
app.use('/api/logs', logsRouter);
app.use('/api/benchmark', benchmarkRouter);
app.use('/api/experiments', experimentsRouter);
app.use('/api/settings', settingsRouter);

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
