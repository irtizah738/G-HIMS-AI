import { expect, test } from '@playwright/test';

const TENANT = 'dev-sandbox-hospital';
const PATIENT = 'ciqp_browser_patient';
const PASSWORD = process.env.GHIMS_DEV_SANDBOX_PASSWORD || '';

test('authenticated synthetic doctor can establish scoped session and open Patient 360', async ({ page, request }) => {
  if (
    process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
    process.env.FIREBASE_PROJECT_ID !== 'ghims-dev-sandbox-local' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    PASSWORD.length < 16
  ) throw new Error('CIQP_BROWSER_NOT_ISOLATED_SYNTHETIC_TEST');

  await page.goto('/login');
  await expect(page.getByTestId('login-workspace')).toBeVisible();
  await expect(page.getByTestId('login-tenant-id').locator(`option[value="${TENANT}"]`))
    .toHaveCount(1);
  await page.getByTestId('login-tenant-id').selectOption(TENANT);
  await page.getByTestId('login-email').fill('doctor@ghims-dev-sandbox.invalid');
  await page.getByTestId('login-password').fill(PASSWORD);

  // Capture the actual Firebase-to-server session exchange initiated by the UI.
  const sessionResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/auth/session') &&
    response.request().method() === 'POST'
  );
  await page.getByTestId('login-submit').click();
  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  expect(session.authenticated).toBe(true);
  expect(session.tenant.tenantId).toBe(TENANT);
  expect(session.user.uid).toBe('dev-sandbox-doctor');
  expect(session.authorization.roles.map((role: string) => role.toUpperCase())).toContain('DOCTOR');
  expect(session.authorization.clinicalPrivileges).toContain('SIGN_CLINICAL_NOTES');
  expect(session.session.sessionId).toBeTruthy();
  // The AuthClient must finish caching the authenticated session before route navigation.
  await page.waitForURL('http://127.0.0.1:3000/', { timeout: 20_000 });

  // Verify durable encrypted session metadata without exposing the stored
  // identity, session ID, ciphertext or credential to test output.
  const encryptedSessionPresent = await page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('ghims_offline_auth_db', 2);
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('auth_session')) {
        db.close(); resolve(false); return;
      }
      const tx = db.transaction('auth_session', 'readonly');
      const get = tx.objectStore('auth_session').get('current_active_session');
      get.onsuccess = () => {
        const found = Boolean(get.result?.encryptedPayload && get.result?.tenantId === 'dev-sandbox-hospital');
        db.close(); resolve(found);
      };
      get.onerror = () => { db.close(); resolve(false); };
    };
  }));
  expect(encryptedSessionPresent, 'Login must durably encrypt and cache the session before browser reload').toBe(true);

  // Firebase Auth emulator verifies the same actual test user. Use the token
  // for an additional protected read to assert the real server-side session.
  const login = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=ghims-local-synthetic-api-key',
    { data: { email: 'doctor@ghims-dev-sandbox.invalid', password: PASSWORD, returnSecureToken: true } }
  );
  expect(login.ok()).toBe(true);
  const identity = await login.json();
  expect(identity.localId).toBe('dev-sandbox-doctor');

  const scopedHeaders = {
    Authorization: `Bearer ${identity.idToken}`,
    'x-ghims-tenant-id': TENANT,
    'x-ghims-session-id': session.session.sessionId as string,
    ...(session.session.deviceId ? { 'x-ghims-device-id': session.session.deviceId as string } : {}),
  };

  const patientResponse = await request.get(
    `/api/clinical/patient360/${PATIENT}?tenantId=${TENANT}`,
    { headers: scopedHeaders }
  );
  expect(patientResponse.status()).toBe(200);
  const patient = await patientResponse.json();
  expect(patient.success).toBe(true);
  expect(patient.tenantId).toBe(TENANT);
  expect(patient.patientId).toBe(PATIENT);
  expect(patient.projection.patientId).toBe(PATIENT);
  expect(patient.projection.timelineReady).toBe(true);
  expect(patient.freshness.contentHash).toBeTruthy();

  // Browser must use the genuine Patient 360 application route, not a mocked
  // component. The route issues its own authenticated request.
  const browserFailures: string[] = [];
  const patientRequests: string[] = [];
  const sessionReloadStatuses: string[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/api/auth/session') && response.request().method() === 'GET') {
      const headers = await response.request().allHeaders();
      const body = await response.json().catch(() => ({})) as { code?: string };
      // Log only a server error code and header-presence/match booleans.
      // Never log bearer tokens, device IDs, session IDs or clinical payloads.
      sessionReloadStatuses.push([
        String(response.status()),
        body.code || 'UNSPECIFIED',
        headers['x-ghims-session-id'] === session.session.sessionId ? 'SESSION_MATCH' : 'SESSION_MISMATCH',
        headers['x-ghims-device-id'] === session.session.deviceId ? 'DEVICE_MATCH' : 'DEVICE_MISMATCH',
        headers.authorization?.startsWith('Bearer ') ? 'BEARER_PRESENT' : 'BEARER_MISSING',
      ].join(':'));
    }
  });
  page.on('pageerror', (error) => browserFailures.push(error.message.slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Applying inline style violates')) {
      browserFailures.push(message.text().slice(0, 300));
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/clinical/patient360/')) {
      patientRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  const uiResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/api/clinical/patient360/${PATIENT}`) &&
    response.request().method() === 'GET',
    { timeout: 25_000 }
  );
  const uiDocument = await page.goto(`/${TENANT}/patients/${PATIENT}/360`);
  expect(uiDocument?.status()).toBe(200);
  let uiResponse: import('@playwright/test').Response;
  try {
    uiResponse = await uiResponsePromise;
  } catch (error) {
    const pageText = (await page.locator('body').innerText().catch(() => 'unreadable')).slice(0, 1200);
    const dbNames = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name || '').sort()
    ).catch(() => ['INDEXEDDB_LIST_FAILED']);
    // No user tokens, password or patient PHI in diagnostics: synthetic page only.
    throw new Error(`CIQP_BROWSER_PATIENT360_REQUEST_MISSING: currentURL=${page.url()} document=${uiDocument?.status()} responses=${JSON.stringify(patientRequests)} sessionRefresh=${JSON.stringify(sessionReloadStatuses)} dbs=${JSON.stringify(dbNames)} errors=${JSON.stringify(browserFailures.slice(0, 8))} page=${JSON.stringify(pageText)} cause=${String(error)}`);
  }
  expect(uiResponse.status()).toBe(200);
  const uiPatient = await uiResponse.json();
  expect(uiPatient.patientId).toBe(PATIENT);
  expect(uiPatient.projection.contentHash).toBe(patient.projection.contentHash);

  // No bearer/session header is ever treated as authenticated.
  const unauthenticated = await request.get(
    `/api/clinical/patient360/${PATIENT}?tenantId=${TENANT}`
  );
  expect([401, 403]).toContain(unauthenticated.status());

  // A valid doctor token cannot supply a different tenant selector.
  const wrongTenant = await request.get(
    `/api/clinical/patient360/${PATIENT}?tenantId=foreign-synthetic-tenant`,
    { headers: { ...scopedHeaders, 'x-ghims-tenant-id': 'foreign-synthetic-tenant' } }
  );
  expect([401, 403, 404]).toContain(wrongTenant.status());
  expect(wrongTenant.status()).not.toBe(200);
});

test('synthetic doctor resumes, edits, approves, and signs an evidence-fenced draft through the real UI', async ({ page }) => {
  if (
    process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
    process.env.FIREBASE_PROJECT_ID !== 'ghims-dev-sandbox-local' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    PASSWORD.length < 16
  ) throw new Error('CIQP_SIGNING_BROWSER_REQUIRES_DISPOSABLE_EMULATORS');

  await page.goto('/login');
  await expect(page.getByTestId('login-workspace')).toBeVisible();
  await page.getByTestId('login-tenant-id').selectOption(TENANT);
  await page.getByTestId('login-email').fill('doctor@ghims-dev-sandbox.invalid');
  await page.getByTestId('login-password').fill(PASSWORD);
  const serverSession = page.waitForResponse((response) =>
    response.url().includes('/api/auth/session') && response.request().method() === 'POST'
  );
  await page.getByTestId('login-submit').click();
  expect((await serverSession).status()).toBe(200);
  await page.waitForURL('http://127.0.0.1:3000/');

  await page.goto(`/${TENANT}/patients/${PATIENT}/360`);
  await expect(page.getByRole('heading', { name: /CI-10G Clinical Intelligence Copilot/i }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Drafting', exact: true }).click();
  await expect(page.getByText('Governed drafting boundary')).toBeVisible();

  // The draft is a pre-generated synthetic fixture. No AI provider runs.
  await page.getByRole('textbox', { name: 'Resume existing governed draft' })
    .fill('ciqp_browser_governed_draft');
  const retrieval = page.waitForResponse((response) =>
    response.url().includes('/api/clinical/intelligence/drafts') &&
    response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Resume draft for this encounter' }).click();
  expect((await retrieval).status()).toBe(200);
  await expect(page.getByText('Draft ciqp_browser_governed_draft', { exact: false })).toBeVisible();

  // Generated text is explicitly non-authoritative until an actual edit.
  await expect(page.getByRole('button', { name: 'Approve current revision' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign authoritative clinical document' }))
    .toHaveCount(0);
  await page.getByRole('textbox', { name: 'Clinical draft text' })
    .fill('Synthetic clinician reviewed the source evidence and edited the assessment for this test.');
  await page.getByRole('button', { name: 'Save clinician-edited revision' }).click();
  await expect(page.getByText(/Clinician-edited immutable revision saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve current revision' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I have reviewed the complete current revision/i })
    .check();
  await page.getByRole('button', { name: 'Approve current revision' }).click();
  await expect(page.getByText(/Exact current revision approved for signature/)).toBeVisible();

  await expect(page.getByRole('button', { name: 'Sign authoritative clinical document' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I am signing this exact approved revision/i })
    .check();
  await page.getByRole('button', { name: 'Sign authoritative clinical document' }).click();
  await expect(page.getByText(/Signed authoritative clinical document .* committed/))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/This revision is signed and immutable/)).toBeVisible();

  // The authoritative document is verified separately from Firestore
  // with server Admin SDK after this Playwright command completes.
});
