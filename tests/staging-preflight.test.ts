import { describe, expect, test } from 'bun:test';
import { evaluateStagingConfiguration } from '@/scripts/ops/staging-preflight';

const isolated: NodeJS.ProcessEnv = {
  GHIMS_RUNTIME_MODE: 'STAGING',
  NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'STAGING',
  VERCEL_ENV: 'preview',
  FIREBASE_PROJECT_ID: 'ghims-ai-synthetic-stage',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ghims-ai-synthetic-stage',
  GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-ai-synthetic-stage',
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-ai-synthetic-stage',
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
  FIRESTORE_DATABASE_ID: '(default)',
  NEXT_PUBLIC_FIRESTORE_DATABASE_ID: '(default)',
  FIREBASE_CLIENT_EMAIL: 'reader@ghims-ai-synthetic-stage.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: 'FAKE_TEST_KEY_DO_NOT_USE',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'FAKE_TEST_API_KEY_DO_NOT_USE',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'ghims-ai-synthetic-stage.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_APP_ID: 'FAKE_TEST_APP_ID',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'FAKE_TEST_SENDER',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'ghims-ai-synthetic-stage.firebasestorage.app',
  GHIMS_INTEGRATION_AI_STATE: 'DISABLED',
  GHIMS_INTEGRATION_HL7_STATE: 'DISABLED',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
  GHIMS_INTEGRATION_DICOMWEB_STATE: 'DISABLED',
  GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE: 'DISABLED',
  GHIMS_INTEGRATION_EDI_X12_STATE: 'DISABLED',
};

function check(changes: NodeJS.ProcessEnv) {
  return evaluateStagingConfiguration({ ...isolated, ...changes });
}

describe('G-HIMS-AI Preview isolation configuration preflight', () => {
  test('reports only a configuration candidate, never a clinical release approval', () => {
    expect(check({})).toEqual({
      operation: 'GHIMS_AI_STAGING_CONFIGURATION_PREFLIGHT',
      status: 'CONFIGURATION_CANDIDATE',
      missingKeys: [],
      blockerCodes: [],
      firebaseNetworkCalls: 0,
      writesPerformed: 0,
      clinicalReleaseAuthority: 'NOT_GRANTED',
      productionDeploymentAuthority: 'NOT_GRANTED',
    });
  });

  test('rejects the exact observed Preview/Production Firebase collision', () => {
    const project = isolated.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION!;
    const report = check({
      GHIMS_FIREBASE_PROJECT_ID_STAGING: project,
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING: project,
      FIREBASE_PROJECT_ID: project,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.blockerCodes).toContain('STAGING_PRODUCTION_PROJECT_COLLISION');
  });

  test('rejects a missing browser comparator even with distinct server IDs', () => {
    const report = check({
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '',
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.missingKeys).toContain('NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');
    expect(report.blockerCodes).toContain('STAGING_PROJECT_ISOLATION_UNVERIFIED');
  });

  test.each([
    [{ GHIMS_RUNTIME_MODE: 'PRODUCTION' }, 'STAGING_RUNTIME_NOT_EXPLICIT'],
    [{ NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'PRODUCTION' }, 'STAGING_RUNTIME_NOT_EXPLICIT'],
    [{ VERCEL_ENV: 'production' }, 'STAGING_VERCEL_TARGET_NOT_PREVIEW'],
    [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'STAGING_EMULATOR_CONFIG_NOT_HOSTED'],
    [{ FIREBASE_PROJECT_ID: 'other-project' }, 'STAGING_ACTIVE_FIREBASE_PROJECT_MISMATCH'],
    [{ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'other-project' }, 'STAGING_ACTIVE_FIREBASE_PROJECT_MISMATCH'],
    [{ GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-ai-synthetic-stage' }, 'STAGING_NONPRODUCTION_PROJECT_COLLISION'],
    [{ NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'unexpected-prod' },
      'STAGING_PRODUCTION_COMPARATOR_MISMATCH'],
    [{ NEXT_PUBLIC_FIRESTORE_DATABASE_ID: 'wrong-db' }, 'STAGING_FIRESTORE_DATABASE_MISMATCH'],
    [{ FIREBASE_CLIENT_EMAIL: 'admin@g-hims-ai.iam.gserviceaccount.com' },
      'STAGING_ADMIN_IDENTITY_NOT_PROJECT_SCOPED'],
    [{ GHIMS_INTEGRATION_HL7_STATE: 'ENABLED' }, 'STAGING_UNQUALIFIED_INTEGRATION_ACTIVE'],
  ] as Array<[NodeJS.ProcessEnv, string]>)(
    'denies unsafe project, identity or runtime configuration %#',
    (changes, code) => {
      const report = check(changes);
      expect(report.status).toBe('BLOCKED');
      expect(report.blockerCodes).toContain(code);
    }
  );

  test('rejects G-HIMS-OS staging even if browser, server and credential project values agree', () => {
    const forbidden = 'studio-1130431360-48a05';
    const report = check({
      FIREBASE_PROJECT_ID: forbidden,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: forbidden,
      GHIMS_FIREBASE_PROJECT_ID_STAGING: forbidden,
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING: forbidden,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: forbidden + '.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: forbidden + '.firebasestorage.app',
      FIREBASE_CLIENT_EMAIL: 'reader@' + forbidden + '.iam.gserviceaccount.com',
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.blockerCodes).toContain('STAGING_GHIMS_OS_FIREBASE_FORBIDDEN');
    expect(JSON.stringify(report)).not.toContain(forbidden);
  });

  test('never accepts the real production project as staging even with falsified comparators', () => {
    const production = 'g-hims-ai';
    const report = check({
      GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'different-fake-comparator',
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'different-fake-comparator',
      GHIMS_FIREBASE_PROJECT_ID_STAGING: production,
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING: production,
      FIREBASE_PROJECT_ID: production,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: production,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: production + '.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: production + '.firebasestorage.app',
      FIREBASE_CLIENT_EMAIL: 'reader@' + production + '.iam.gserviceaccount.com',
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.blockerCodes).toContain('STAGING_OFFICIAL_PRODUCTION_FIREBASE_FORBIDDEN');
    expect(report.blockerCodes).toContain('STAGING_PRODUCTION_COMPARATOR_UNTRUSTED');
  });

  test.each([
    [{ NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'g-hims-ai.firebaseapp.com' },
      'STAGING_AUTH_DOMAIN_PROJECT_MISMATCH'],
    [{ NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'g-hims-ai.firebasestorage.app' },
      'STAGING_STORAGE_BUCKET_PROJECT_MISMATCH'],
    [{ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/credential.json' },
      'STAGING_VERCEL_FILE_CREDENTIALS_FORBIDDEN'],
    [{ NEXT_PUBLIC_ENABLE_APPCHECK_DEBUG: 'true' },
      'STAGING_APPCHECK_DEBUG_FORBIDDEN'],
    [{ GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'spoofed-production' },
      'STAGING_PRODUCTION_COMPARATOR_UNTRUSTED'],
  ] as Array<[NodeJS.ProcessEnv,string]>)(
    'rejects inconsistent external Auth, Storage, App Check and comparator %#',
    (changes, code) => {
      const report = check(changes);
      expect(report.status).toBe('BLOCKED');
      expect(report.blockerCodes).toContain(code);
      expect(report.writesPerformed).toBe(0);
      expect(report.firebaseNetworkCalls).toBe(0);
    }
  );

  test('reports absent credentials/config by key NAME only, never value', () => {
    const report = check({
      FIREBASE_PRIVATE_KEY: '',
      NEXT_PUBLIC_FIREBASE_APP_ID: '',
    });
    expect(report.missingKeys).toEqual([
      'FIREBASE_PRIVATE_KEY', 'NEXT_PUBLIC_FIREBASE_APP_ID',
    ]);
    const serialized = JSON.stringify(check({}));
    for (const value of [
      isolated.FIREBASE_PRIVATE_KEY!,
      isolated.NEXT_PUBLIC_FIREBASE_API_KEY!,
      isolated.FIREBASE_PROJECT_ID!,
      isolated.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION!,
      isolated.FIREBASE_CLIENT_EMAIL!,
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  test('is pure: no SDK import, network, secret dumps or filesystem writes', async () => {
    const source = await Bun.file('scripts/ops/staging-preflight.ts').text();
    expect(source).not.toContain('firebase-admin');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('setDoc(');
    expect(source).not.toContain('runTransaction(');
    expect(source).not.toContain('Object.entries(env)');
    expect(source).not.toContain('JSON.stringify(process.env)');
  });
});
