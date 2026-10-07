import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('Hospital-0 deployment and qualification contract', () => {
  test('Hospital-0 is evidence-gated beyond engineering qualification', async () => {
    const manifest = await source('scripts/ops/hospital0-qualification-manifest.ts');

    for (const gate of [
      'H0_1_STAGING_DEPLOYMENT',
      'H0_2_IDENTITY_TENANT',
      'H0_3_PHYSICAL_OFFLINE',
      'H0_4_CROSS_ROLE',
      'H0_5_RESILIENCE',
      'H0_6_SECURITY_PERFORMANCE',
      'H0_7_CONTROLLED_PILOT',
    ]) {
      expect(manifest).toContain(gate);
    }

    expect(manifest).toContain('TWO_PHYSICAL_DEVICES_REQUIRED');
    expect(manifest).toContain('INDEPENDENT_ASSESSOR_REQUIRED');
    expect(manifest).toContain('CONSENT_NOT_SIGNED');
    expect(manifest).toContain('PILOT_QUALIFIED');
    expect(manifest).toContain('ENGINEERING_QUALIFIED');
  });

  test('STAGING deployment remains isolated from production and requires dedicated project identity', async () => {
    const [docs, deploy, runtime] = await Promise.all([
      source('docs/operations/HOSPITAL0_DEPLOYMENT_QUALIFICATION.md'),
      source('.github/workflows/staging-deploy.yml'),
      source('lib/runtime/environment-contract.ts'),
    ]);

    expect(docs).toContain('dedicated Firebase project');
    expect(docs).toContain('GHIMS_FIREBASE_PROJECT_ID_STAGING');
    expect(docs).toContain('NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING');
    expect(deploy).toContain('GHIMS_STAGING_EXPECTED_RUNTIME: STAGING');
    expect(deploy).toContain('vercel pull --yes --environment=preview');
    expect(runtime).toContain('ENVIRONMENT_PROJECT_COLLISION');
    expect(runtime).toContain("STAGING: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING)");
  });

  test('automatic Git deployments remain disabled before Preview receives STAGING credentials', async () => {
    const vercel = JSON.parse(await source('vercel.json'));
    expect(vercel.git?.deploymentEnabled).toBe(false);
  });

  test('controlled pilot cannot substitute repository automation for human/external gates', async () => {
    const docs = await source('docs/operations/HOSPITAL0_DEPLOYMENT_QUALIFICATION.md');
    expect(docs).toContain('independent deployed-build penetration/security assessment');
    expect(docs).toContain('institutional approval is signed');
    expect(docs).toContain('application offline toggle is not sufficient evidence');
  });
});
