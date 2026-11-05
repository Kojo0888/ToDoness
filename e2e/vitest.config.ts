import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Browser tests share one server per file; run files one after another.
    fileParallelism: false,
  },
});
