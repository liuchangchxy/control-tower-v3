import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { resolveConfig } from './config.js';
import { recoverFromState, getEndpoint } from './services/processManager.js';

export async function bootstrap(): Promise<http.Server> {
  const config = resolveConfig();
  const clientDist = path.join(config.home, 'client', 'dist');
  const app = createApp({
    home: config.home,
    clientDist: fs.existsSync(clientDist) ? clientDist : undefined,
    getEndpoint,
  });
  await recoverFromState();
  const server = app.listen(config.port, () => {
    console.log(`Control Tower v3 running on http://localhost:${config.port}`);
  });
  return server;
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap().catch(error => {
    console.error('Control Tower bootstrap failed:', error);
    process.exitCode = 1;
  });
}
