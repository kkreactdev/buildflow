import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000, // first run downloads a mongod binary
    setupFiles: ['./src/test/setupEnv.ts'],
    fileParallelism: false,
  },
});
