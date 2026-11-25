import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Banco separado (<banco>_test), criado e migrado antes da suíte.
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['reflect-metadata', './test/setup-e2e.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
