import { defineConfig } from '@playwright/test';

// Playwright runs only in a disposable local TEST process with both emulators
// already started by firebase emulators:exec. Never inherit a hosted origin.
export default defineConfig({
  testDir: './validation-e2e',
  testMatch: 'ciqp-clinical-validation.browser.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run dev --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      GHIMS_RUNTIME_MODE: 'TEST',
      NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'TEST',
      FIREBASE_PROJECT_ID: 'ghims-ciqp-synthetic',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ghims-ciqp-synthetic',
      GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-ciqp-synthetic',
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-ciqp-synthetic',
      NEXT_PUBLIC_GHIMS_CIQP_VALIDATION_EMULATORS: 'true',
      NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS: 'false',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      GHIMS_INTEGRATION_AI_STATE: 'DISABLED',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});