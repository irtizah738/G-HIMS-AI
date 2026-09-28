import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS P5C pilot readiness guards', () => {
  test('tenant switching refuses inactive membership before claim mutation', async () => {
    const route = await source('app/api/auth/tenant-selection/route.ts');

    const activeGuard = route.indexOf("membership.status !== 'ACTIVE'");
    const claimMutation = route.indexOf('setCustomUserClaims');

    expect(activeGuard).toBeGreaterThanOrEqual(0);
    expect(claimMutation).toBeGreaterThan(activeGuard);
    expect(route).toContain("'ACCOUNT_SUSPENDED'");
    expect(route).toContain("'ACCOUNT_PENDING'");
  });

  test('Firestore reads re-check active membership rather than trusting stale tenant claims alone', async () => {
    const rules = await source('firestore.rules');

    expect(rules).toContain('function hasActiveMembership(tenantId)');
    expect(rules).toContain("get(membershipPath(tenantId)).data.status == 'ACTIVE'");
    expect(rules).toContain('function canReadClinical(tenantId)');
    expect(rules).toContain('function canReadFinance(tenantId)');
    expect(rules).toContain('function canReadAudit(tenantId)');
  });

  test('patient accounts are not granted tenant-wide direct clinical reads', async () => {
    const rules = await source('firestore.rules');

    const clinicalStart = rules.indexOf('function canReadClinical(tenantId)');
    const financeStart = rules.indexOf('function canReadFinance(tenantId)');
    const clinicalBlock = rules.slice(clinicalStart, financeStart);

    expect(clinicalBlock).not.toContain("'patient'");
  });

  test('patient registration requires a stable caller-supplied idempotency key', async () => {
    const route = await source('app/api/clinical/encounter/create/route.ts');

    expect(route).toContain("req.headers.get('idempotency-key')");
    expect(route).toContain('IDEMPOTENCY_KEY_REQUIRED');
    expect(route).not.toContain("body.idempotencyKey || `idem_");
  });

  test('P5C validation includes security rules and staged recovery regressions', async () => {
    const pkg = JSON.parse(await source('package.json'));

    expect(pkg.scripts['validate:p5c']).toContain('test:rules');
    expect(pkg.scripts['validate:p5c']).toContain('test:p5a:emulator');
    expect(pkg.scripts['validate:p5c']).toContain('test:p4:emulator');
    expect(pkg.scripts['validate:p5c']).toContain('test:e2e');
  });

  test('P5C CI aligns Firebase Admin project identity with embedded emulator suites', async () => {
    const workflow = await source('.github/workflows/p5c-validation.yml');

    expect(workflow).toContain('FIREBASE_PROJECT_ID: ghims-p5a-ci');
    expect(workflow).toContain('GHIMS_FIREBASE_PROJECT_ID_TEST: ghims-p5a-ci');
    expect(workflow).toContain('FIREBASE_PROJECT_ID: ghims-p4-ci');
    expect(workflow).toContain('GHIMS_FIREBASE_PROJECT_ID_TEST: ghims-p4-ci');
  });

  test('main cannot auto-deploy directly to Vercel production', async () => {
    const config = JSON.parse(await source('vercel.json'));

    expect(config.git?.deploymentEnabled?.main).toBe(false);
  });

  test('manual staging workflow is pinned to current main and never uses a production target', async () => {
    const workflow = await source('.github/workflows/staging-deploy.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('git rev-parse origin/main');
    expect(workflow).toContain('vercel pull --yes --environment=staging');
    expect(workflow).toContain('vercel deploy --target=staging');
    expect(workflow).toContain('bun run ops:staging-smoke');
    expect(workflow).toContain('VERCEL_TOKEN');
    expect(workflow).not.toContain('vercel --prod');
    expect(workflow).not.toContain('vercel deploy --prod');
    expect(workflow).not.toContain('--target=production');
  });
});
