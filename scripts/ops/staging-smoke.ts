export {};

const rawBaseUrl = String(process.env.GHIMS_STAGING_BASE_URL || '').trim();

if (!rawBaseUrl) {
  throw new Error('STAGING_SMOKE_BASE_URL_REQUIRED: set GHIMS_STAGING_BASE_URL.');
}

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== 'https:') {
  throw new Error('STAGING_SMOKE_HTTPS_REQUIRED');
}
if (
  baseUrl.hostname === 'localhost' ||
  baseUrl.hostname === '127.0.0.1' ||
  baseUrl.hostname === '0.0.0.0'
) {
  throw new Error('STAGING_SMOKE_REMOTE_TARGET_REQUIRED');
}

const expectedRuntime = String(
  process.env.GHIMS_STAGING_EXPECTED_RUNTIME || 'STAGING'
).trim().toUpperCase();

const timeoutMs = Number(process.env.GHIMS_STAGING_SMOKE_TIMEOUT_MS || 15000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
  throw new Error('STAGING_SMOKE_TIMEOUT_INVALID');
}

const headers: Record<string, string> = {
  'Cache-Control': 'no-cache',
  'User-Agent': 'G-HIMS-Staging-Smoke/1.0',
};

const headerName = String(process.env.GHIMS_STAGING_SMOKE_HEADER_NAME || '').trim();
const headerValue = String(process.env.GHIMS_STAGING_SMOKE_HEADER_VALUE || '').trim();
if (headerName && headerValue) {
  headers[headerName] = headerValue;
}

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  const url = new URL(pathname, baseUrl);
  return fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `STAGING_SMOKE_INVALID_JSON: ${response.status} ${response.url}`
    );
  }
}

const checks: Array<Record<string, unknown>> = [];

// 1. Readiness must prove Firebase Auth + Firestore connectivity.
const readyResponse = await request('/api/health/ready');
const readyPayload = await readJson(readyResponse);
checks.push({
  check: 'readiness',
  status: readyResponse.status,
  payload: readyPayload,
});

if (readyResponse.status !== 200 || readyPayload?.status !== 'ready') {
  throw new Error(
    `STAGING_NOT_READY: status=${readyResponse.status} blockers=${JSON.stringify(
      readyPayload?.blockers || []
    )}`
  );
}
if (String(readyPayload?.runtime || '').toUpperCase() !== expectedRuntime) {
  throw new Error(
    `STAGING_RUNTIME_MISMATCH: expected=${expectedRuntime} actual=${String(
      readyPayload?.runtime || ''
    )}`
  );
}

// 2. Liveness route should respond, but liveness alone is not enough for readiness.
const healthResponse = await request('/api/health');
checks.push({
  check: 'liveness',
  status: healthResponse.status,
});
if (healthResponse.status !== 200) {
  throw new Error(`STAGING_LIVENESS_FAILED: status=${healthResponse.status}`);
}

// 3. A protected command endpoint must reject an unauthenticated mutation attempt.
const protectedResponse = await request('/api/commands/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    command: {
      commandId: 'staging-smoke-unauthenticated',
      idempotencyKey: 'staging-smoke-unauthenticated',
      tenantId: 'staging-smoke-invalid',
      commandType: 'RecordVitalsCommand',
      schemaVersion: 1,
      payload: {},
    },
  }),
});
checks.push({
  check: 'unauthenticated_command_denial',
  status: protectedResponse.status,
});

if (![401, 403].includes(protectedResponse.status)) {
  throw new Error(
    `STAGING_PROTECTED_ROUTE_FAIL_OPEN: expected 401/403, got ${protectedResponse.status}`
  );
}

// 4. Login shell must be reachable without leaking an application error.
const loginResponse = await request('/login');
checks.push({
  check: 'login_shell',
  status: loginResponse.status,
});
if (loginResponse.status !== 200) {
  throw new Error(`STAGING_LOGIN_UNAVAILABLE: status=${loginResponse.status}`);
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      baseUrl: baseUrl.origin,
      expectedRuntime,
      checks,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
