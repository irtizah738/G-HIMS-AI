import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateHospital0Evidence } from '@/lib/qualification/hospital0-evidence';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

const qualificationContext = {
  qualificationRunId: 'h0-run-20261007',
  gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
};

const baseEvidence = {
  schemaVersion: 1 as const,
  qualificationRunId: qualificationContext.qualificationRunId,
  gitCommitSha: qualificationContext.gitCommitSha,
  deploymentId: 'deploy-h0-001',
  firebaseProjectId: 'ghims-h0-staging',
  deploymentUrl: 'https://staging.example.test',
  runtime: 'STAGING' as const,
  success: true as const,
  recordedAt: '2026-10-07T10:00:00.000Z',
};

describe('Hospital-0 deployment and qualification contract', () => {
  test('empty JSON can never satisfy an evidence gate', () => {
    expect(
      validateHospital0Evidence(
        'hospital0-alert-routing.json',
        {},
        qualificationContext
      ).length
    ).toBeGreaterThan(0);
  });

  test('evidence from a stale commit can never qualify the current run', () => {
    const issues = validateHospital0Evidence(
      'staging-deployment-evidence.json',
      {
        ...baseEvidence,
        gitCommitSha: '1111111111111111111111111111111111111111',
        mainSha: '1111111111111111111111111111111111111111',
        dedicatedProject: true,
      },
      qualificationContext
    );
    expect(issues).toContain('QUALIFICATION_COMMIT_SHA_MISMATCH');
  });

  test('deployment evidence must bind exact main SHA and dedicated STAGING project', () => {
    expect(
      validateHospital0Evidence(
        'staging-deployment-evidence.json',
        {
          ...baseEvidence,
          mainSha: qualificationContext.gitCommitSha,
          dedicatedProject: true,
          demoProjectId: 'ghims-demo',
          productionProjectId: 'ghims-prod',
        },
        qualificationContext
      )
    ).toEqual([]);
  });

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
    expect(manifest).toContain('QUALIFICATION_RUN_ID_REQUIRED');
    expect(manifest).toContain('QUALIFICATION_COMMIT_SHA_REQUIRED');
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
