import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@cortex/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
