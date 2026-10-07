export {};

type LoadResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
};

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
if (runtime !== 'STAGING') throw new Error('WAVE5_LOAD_STAGING_ONLY');

const baseRaw = String(process.env.GHIMS_WAVE5_BASE_URL || '').trim();
const tenantId = String(process.env.GHIMS_WAVE5_TENANT_ID || '').trim().toLowerCase();
const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
const email = String(process.env.GHIMS_WAVE5_LOAD_EMAIL || '').trim().toLowerCase();
const password = String(process.env.GHIMS_WAVE5_LOAD_PASSWORD || '');
const requestCount = Number(process.env.GHIMS_WAVE5_LOAD_REQUESTS || 100);
const concurrency = Number(process.env.GHIMS_WAVE5_LOAD_CONCURRENCY || 10);
const p95LimitMs = Number(process.env.GHIMS_WAVE5_LOAD_P95_LIMIT_MS || 3000);
const maxErrorRate = Number(process.env.GHIMS_WAVE5_LOAD_MAX_ERROR_RATE || 0.01);
const timeoutMs = Number(process.env.GHIMS_WAVE5_LOAD_TIMEOUT_MS || 15000);

if (!baseRaw || !tenantId || !apiKey || !email || password.length < 16) {
  throw new Error('WAVE5_LOAD_CONFIGURATION_INCOMPLETE');
}
if (!Number.isInteger(requestCount) || requestCount < 10 || requestCount > 5000) {
  throw new Error('WAVE5_LOAD_REQUEST_COUNT_INVALID');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('WAVE5_LOAD_CONCURRENCY_INVALID');
}
if (!Number.isFinite(p95LimitMs) || p95LimitMs < 100) {
  throw new Error('WAVE5_LOAD_P95_LIMIT_INVALID');
}
if (!Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate >= 1) {
  throw new Error('WAVE5_LOAD_ERROR_RATE_INVALID');
}

const baseUrl = new URL(baseRaw);
if (
  baseUrl.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(baseUrl.hostname)
) {
  throw new Error('WAVE5_LOAD_REMOTE_HTTPS_STAGING_REQUIRED');
}

const bypassName = String(process.env.GHIMS_WAVE5_BYPASS_HEADER_NAME || '').trim();
const bypassValue = String(process.env.GHIMS_WAVE5_BYPASS_HEADER_VALUE || '').trim();

function commonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    'User-Agent': 'G-HIMS-Wave5-Load/1.0',
    ...(bypassName && bypassValue ? { [bypassName]: bypassValue } : {}),
    ...extra,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('WAVE5_LOAD_INVALID_JSON_RESPONSE');
  }
}

async function firebaseSignIn(): Promise<string> {
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
      encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  const payload = await readJson(response);
  const idToken = String(payload.idToken || '');
  if (!response.ok || !idToken) {
    throw new Error('WAVE5_LOAD_FIREBASE_LOGIN_FAILED');
  }
  return idToken;
}

async function establishSession(idToken: string): Promise<string> {
  const response = await fetch(new URL('/api/auth/session', baseUrl), {
    method: 'POST',
    headers: commonHeaders({
      Authorization: 'Bearer ' + idToken,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      tenantId,
      rememberDevice: false,
      device: {
        deviceId: 'wave5-load-' + crypto.randomUUID(),
        deviceType: 'QUALIFICATION_RUNNER',
        platform: 'SERVER',
        appVersion: 'WAVE5',
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readJson(response);
  const session = payload.session as Record<string, unknown> | undefined;
  const sessionId = String(session?.sessionId || '');
  if (!response.ok || !sessionId) {
    throw new Error('WAVE5_LOAD_SESSION_FAILED');
  }
  return sessionId;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

const idToken = await firebaseSignIn();
const sessionId = await establishSession(idToken);

let cursor = 0;
const results: LoadResult[] = [];
const statuses = new Map<number, number>();

async function runOne(): Promise<LoadResult> {
  const started = performance.now();
  try {
    const response = await fetch(
      new URL('/api/offline/bootstrap?tenantId=' + encodeURIComponent(tenantId), baseUrl),
      {
        method: 'GET',
        headers: commonHeaders({
          Authorization: 'Bearer ' + idToken,
          'x-ghims-tenant-id': tenantId,
          'x-ghims-session-id': sessionId,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    const latencyMs = Math.round(performance.now() - started);
    const payload = await readJson(response);
    const ok =
      response.ok &&
      payload.success === true &&
      String(payload.tenantId || '').toLowerCase() === tenantId;
    statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    return { ok, status: response.status, latencyMs };
  } catch {
    const latencyMs = Math.round(performance.now() - started);
    statuses.set(0, (statuses.get(0) || 0) + 1);
    return { ok: false, status: 0, latencyMs };
  }
}

async function worker(): Promise<void> {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= requestCount) return;
    results.push(await runOne());
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
const failures = results.filter((result) => !result.ok).length;
const errorRate = results.length ? failures / results.length : 1;
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const p99 = percentile(latencies, 99);
const success = errorRate <= maxErrorRate && p95 <= p95LimitMs;

const evidence = {
  schemaVersion: 1,
  program: 'Wave 5 Enterprise Hardening',
  check: 'authenticated_read_model_load',
  runtime: 'STAGING',
  syntheticOnly: true,
  baseOrigin: baseUrl.origin,
  tenantId,
  executedAt: new Date().toISOString(),
  requests: requestCount,
  concurrency,
  results: {
    successes: results.length - failures,
    failures,
    errorRate,
    statusCounts: Object.fromEntries(
      [...statuses.entries()].map(([status, count]) => [String(status), count])
    ),
    latencyMs: { p50, p95, p99, max: latencies.at(-1) || 0 },
  },
  thresholds: {
    maxErrorRate,
    p95LimitMs,
  },
  success,
};

process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
if (!success) process.exit(2);
