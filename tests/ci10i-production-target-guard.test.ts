import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { evaluateCi10iProductionTarget } from '@/lib/clinical/intelligence/ci10i-production-target-guard';

const PRODUCTION = 'g-hims-ai';
const OS_STAGE = 'studio-1130431360-48a05';
const normal: NodeJS.ProcessEnv = {
  GHIMS_RUNTIME_MODE: 'PRODUCTION',
  NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'PRODUCTION',
  VERCEL_ENV: 'production',
  FIREBASE_PROJECT_ID: PRODUCTION,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION,
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: PRODUCTION,
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: PRODUCTION,
  GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-p4-ci',
  GHIMS_FIREBASE_PROJECT_ID_DEMO: 'ghims-demo-only',
  GHIMS_FIREBASE_PROJECT_ID_STAGING: '',
};
const check = (override: NodeJS.ProcessEnv = {}) =>
  evaluateCi10iProductionTarget({...normal, ...override});

describe('CI10I official production target, not a clinical release gate', () => {
  test('exact genuine production settings allow configuration checks, never clinical authorization', () => {
    expect(check()).toEqual({
      status: 'CONFIGURATION_MATCH_ONLY',
      blockers: [],
      clinicalReleaseAuthorization: 'NOT_GRANTED',
      productionDeploymentAuthorization: 'NOT_GRANTED',
      networkCalls: 0,
      writesPerformed: 0,
    });
  });

  test('fully self-consistent wrong Firebase project still fails closed', () => {
    const stage = 'ghims-ai-synthetic-stage';
    const r = check({
      FIREBASE_PROJECT_ID: stage,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: stage,
      GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: stage,
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: stage,
    });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockers).toContain('CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED');
    expect(JSON.stringify(r)).not.toContain(stage);
  });

  test('cannot alias G-HIMS-OS staging to production', () => {
    const r = check({
      FIREBASE_PROJECT_ID: OS_STAGE,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: OS_STAGE,
      GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: OS_STAGE,
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: OS_STAGE,
    });
    expect(r.blockers).toContain('CI10I_GHIMS_OS_STAGING_NOT_PRODUCTION');
    expect(r.blockers).toContain('CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED');
  });

  test.each([
    [{ FIREBASE_PROJECT_ID: OS_STAGE }, 'CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED'],
    [{ NEXT_PUBLIC_FIREBASE_PROJECT_ID: OS_STAGE }, 'CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED'],
    [{ GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '' }, 'CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED'],
    [{ NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '' }, 'CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED'],
    [{ GHIMS_FIREBASE_PROJECT_ID_STAGING: PRODUCTION }, 'CI10I_PRODUCTION_PROJECT_REUSED_AS_NONPRODUCTION'],
    [{ GHIMS_FIREBASE_PROJECT_ID_TEST: PRODUCTION }, 'CI10I_PRODUCTION_PROJECT_REUSED_AS_NONPRODUCTION'],
    [{ VERCEL_ENV: 'preview' }, 'CI10I_VERCEL_PREVIEW_NOT_PRODUCTION'],
    [{ VERCEL_ENV: 'development' }, 'CI10I_VERCEL_PREVIEW_NOT_PRODUCTION'],
    [{ GHIMS_RUNTIME_MODE: 'TEST' }, 'CI10I_PRODUCTION_RUNTIME_REQUIRED'],
    [{ NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'STAGING' }, 'CI10I_PRODUCTION_RUNTIME_REQUIRED'],
    [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'CI10I_EMULATOR_FORBIDDEN_IN_PRODUCTION'],
    [{ FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, 'CI10I_EMULATOR_FORBIDDEN_IN_PRODUCTION'],
  ] as Array<[NodeJS.ProcessEnv,string]>)(
    'blocks deceptive targets and nonproduction runtimes %#',
    (overrides, code) => {
      const r = check(overrides);
      expect(r.status).toBe('BLOCKED');
      expect(r.blockers).toContain(code);
      expect(r.productionDeploymentAuthorization).toBe('NOT_GRANTED');
    }
  );

  test('production CLI refuses to imply SHA, hosted recovery, or institutional signoff', () => {
    const script = readFileSync('scripts/ops/ci10i-production-preflight.ts', 'utf8');
    expect(script).toContain('evaluateCi10iProductionTarget(process.env)');
    expect(script).toContain('CI10I_OFFICIAL_PRODUCTION_TARGET_BLOCKED');
    expect(script).toContain("sourceCommit: 'UNVERIFIED'");
    expect(script).toContain("deployedCommit: 'UNVERIFIED'");
    expect(script).toContain("patient360MigrationQualification: 'NOT_VERIFIED'");
    expect(script).toContain("clinicalReleaseAuthorization: 'NOT_GRANTED'");
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('runTransaction(');
  });
});
