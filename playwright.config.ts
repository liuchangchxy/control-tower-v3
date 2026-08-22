import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-ui',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:9092',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
