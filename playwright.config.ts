import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['staging/**'],
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run start',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      GHIMS_RUNTIME_MODE: 'TEST',
      NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'TEST',
      FIREBASE_PROJECT_ID: 'ghims-p3-ci',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ghims-p3-ci',
    },
  },
});
