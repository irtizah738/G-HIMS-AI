import { defineConfig, devices } from '@playwright/test';

const baseURL = String(process.env.GHIMS_STAGING_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');

if (!baseURL) {
  throw new Error(
    'GHIMS_STAGING_BASE_URL_REQUIRED: Wave 2 staging qualification requires a deployed STAGING URL.'
  );
}

const parsed = new URL(baseURL);
if (
  parsed.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
) {
  throw new Error(
    'GHIMS_STAGING_BASE_URL_INVALID: Wave 2 qualification requires a remote HTTPS STAGING endpoint.'
  );
}

export default defineConfig({
  testDir: './e2e/staging',
  testMatch: /wave2-cross-role\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 300_000,
  expect: { timeout: 25_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/wave2-staging', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 25_000,
    navigationTimeout: 40_000,
  },
  projects: [
    {
      name: 'chromium-wave2-staging',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results/wave2-staging',
});
