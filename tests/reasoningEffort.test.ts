import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';

const servers: Array<ReturnType<ReturnType<typeof createApp>['listen']>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('monitor-only model API boundary', () => {
  it('does not proxy or rewrite requests under /v1', async () => {
    const server = createApp({ home: process.cwd() }).listen(0);
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind to a port');

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reasoning_effort: 'high', tools: [{ name: 'keep-me' }] }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'The Control Tower no longer proxies the model API. Connect directly to the vLLM endpoint shown in the dashboard.',
    });
  });
});
