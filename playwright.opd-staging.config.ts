import { defineConfig, devices } from '@playwright/test';

const baseURL = String(process.env.GHIMS_STAGING_BASE_URL || '')
  .trim()
  .replace(/\/$/, '');

if (!baseURL) {
  throw new Error(
    'GHIMS_STAGING_BASE_URL_REQUIRED: OPD staging qualification requires a deployed STAGING URL.'
  );
}

const parsed = new URL(baseURL);
if (
  parsed.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
) {
  throw new Error(
    'GHIMS_STAGING_BASE_URL_INVALID: deployed OPD qualification requires a remote HTTPS STAGING endpoint.'
  );
}


const bypassHeaderName = String(
  process.env.GHIMS_STAGING_BYPASS_HEADER_NAME || ''
).trim();
const bypassHeaderValue = String(
  process.env.GHIMS_STAGING_BYPASS_HEADER_VALUE || ''
).trim();
const extraHTTPHeaders =
  bypassHeaderName && bypassHeaderValue
    ? { [bypassHeaderName]: bypassHeaderValue }
    : undefined;

export default defineConfig({
  testDir: './e2e/staging',
  testMatch: /opd-cross-role\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/opd-staging', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-opd-staging',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results/opd-staging',
});
