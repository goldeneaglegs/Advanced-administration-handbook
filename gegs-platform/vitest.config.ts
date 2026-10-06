import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Phase 1 §14.1: integration tests run against a real PostgreSQL, never a
    // mock, because the invariants under test are database constraints.
    sequence: { concurrent: false },
    testTimeout: 20_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
