import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/e2e-ui/**', 'node_modules/**', 'dist/**', 'client/**', '.claude/**'],
  },
});
