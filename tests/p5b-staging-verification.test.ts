import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS P5B staging verification boundary', () => {
  test('staging smoke requires remote HTTPS target and expected STAGING runtime', async () => {
    const smoke = await source('scripts/ops/staging-smoke.ts');

    expect(smoke).toContain('STAGING_SMOKE_BASE_URL_REQUIRED');
    expect(smoke).toContain("baseUrl.protocol !== 'https:'");
    expect(smoke).toContain('STAGING_SMOKE_REMOTE_TARGET_REQUIRED');
    expect(smoke).toContain("GHIMS_STAGING_EXPECTED_RUNTIME || 'STAGING'");
    expect(smoke).toContain('STAGING_RUNTIME_MISMATCH');
  });

  test('readiness is a hard gate and surfaces blocker evidence', async () => {
    const smoke = await source('scripts/ops/staging-smoke.ts');

    expect(smoke).toContain("request('/api/health/ready')");
    expect(smoke).toContain("readyPayload?.status !== 'ready'");
    expect(smoke).toContain('readyPayload?.blockers');
    expect(smoke).toContain('STAGING_NOT_READY');
  });

  test('protected command boundary must fail closed for unauthenticated mutation', async () => {
    const smoke = await source('scripts/ops/staging-smoke.ts');

    expect(smoke).toContain("request('/api/commands/execute'");
    expect(smoke).toContain('[401, 403]');
    expect(smoke).toContain('STAGING_PROTECTED_ROUTE_FAIL_OPEN');
  });

  test('smoke gate never embeds staging secrets or bypass values', async () => {
    const smoke = await source('scripts/ops/staging-smoke.ts');

    expect(smoke).toContain('GHIMS_STAGING_SMOKE_HEADER_NAME');
    expect(smoke).toContain('GHIMS_STAGING_SMOKE_HEADER_VALUE');
    expect(smoke).not.toContain('x-vercel-protection-bypass');
    expect(smoke).not.toContain('Bearer ');
  });
});
