// Standalone vitest config: keeps vitest from loading vite.config.ts, whose
// reactRouter() plugin expects a full app build context and breaks test runs.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
