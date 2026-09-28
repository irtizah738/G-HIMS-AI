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
});
