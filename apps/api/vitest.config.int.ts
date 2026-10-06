import { defineConfig } from 'vitest/config';

// Integration tests need the Compose database: `docker compose up -d db`
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.int-spec.ts'],
    // Every file boots the app, and migrating a new database from two files at once fails
    fileParallelism: false,
    env: {
      LLM_PROVIDER: 'mock',
      JWT_SECRET: 'integration-test-secret-of-32-characters',
      API_DOCS_ENABLED: 'false',
    },
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
