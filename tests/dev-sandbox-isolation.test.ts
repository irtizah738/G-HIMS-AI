import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SANDBOX_ACK, SANDBOX_PROJECT_ID, SANDBOX_TENANT_ID,
  validateDevelopmentSandbox,
} from '@/lib/dev-sandbox/safety';
import {
  SANDBOX_SCENARIOS, SANDBOX_PERSONAS, scenarioCarePointers,
} from '@/lib/dev-sandbox/scenarios';
import { simulateSandboxExternalSystem } from '@/lib/dev-sandbox/external-system-simulator';
import { sandboxEmulatorConnectSources } from '@/lib/dev-sandbox/csp';

const valid = {
  GHIMS_RUNTIME_MODE: 'TEST',
  NODE_ENV: 'development',
  FIREBASE_PROJECT_ID: SANDBOX_PROJECT_ID,
  GHIMS_FIREBASE_PROJECT_ID_TEST: SANDBOX_PROJECT_ID,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  GHIMS_DEV_SANDBOX_TENANT_ID: SANDBOX_TENANT_ID,
  GHIMS_DEV_SANDBOX_ACK: SANDBOX_ACK,
};

describe('DEV-1 dedicated sandbox safety boundary', () => {
  test('accepts explicit disposable emulator-only configuration', () => {
    expect(validateDevelopmentSandbox(valid)).toEqual({
      tenantId: SANDBOX_TENANT_ID, projectId: SANDBOX_PROJECT_ID,
    });
  });

  test.each([
    [{ GHIMS_RUNTIME_MODE: 'PRODUCTION' }, 'DEV_SANDBOX_TEST_RUNTIME_ONLY'],
    [{ GHIMS_RUNTIME_MODE: 'STAGING' }, 'DEV_SANDBOX_TEST_RUNTIME_ONLY'],
    [{ GHIMS_RUNTIME_MODE: 'DEMO' }, 'DEV_SANDBOX_TEST_RUNTIME_ONLY'],
    [{ NODE_ENV: 'production' }, 'DEV_SANDBOX_TEST_RUNTIME_ONLY'],
    [{ GHIMS_DEV_SANDBOX_ACK: 'yes' }, 'DEV_SANDBOX_OPERATOR_ACK_REQUIRED'],
    [{ FIRESTORE_EMULATOR_HOST: undefined }, 'DEV_SANDBOX_REQUIRES_LOCAL_FIRESTORE_AND_AUTH_EMULATORS'],
    [{ FIREBASE_AUTH_EMULATOR_HOST: '198.51.100.1:9099' }, 'DEV_SANDBOX_REQUIRES_LOCAL_FIRESTORE_AND_AUTH_EMULATORS'],
    [{ FIREBASE_AUTH_EMULATOR_HOST: 'https://localhost:9099' }, 'DEV_SANDBOX_REQUIRES_LOCAL_FIRESTORE_AND_AUTH_EMULATORS'],
    [{ FIREBASE_PROJECT_ID: 'g-hims-ai' }, 'DEV_SANDBOX_DEDICATED_PROJECT_REQUIRED'],
    [{ GHIMS_FIREBASE_PROJECT_ID_TEST: 'g-hims-ai' }, 'DEV_SANDBOX_DEDICATED_PROJECT_REQUIRED'],
    [{ GHIMS_DEV_SANDBOX_TENANT_ID: 'central-metro-hospital' }, 'DEV_SANDBOX_DEDICATED_TENANT_REQUIRED'],
    [{ GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: SANDBOX_PROJECT_ID }, 'DEV_SANDBOX_PROTECTED_PROJECT_COLLISION'],
    [{ GHIMS_FIREBASE_PROJECT_ID_STAGING: SANDBOX_PROJECT_ID }, 'DEV_SANDBOX_PROTECTED_PROJECT_COLLISION'],
  ] as const)('rejects unsafe environment %j', (changes, code) => {
    expect(() => validateDevelopmentSandbox({ ...valid, ...changes })).toThrow(code);
  });

  test('project-isolation contract explicitly includes TEST in protected project list', async () => {
    const source = await readFile(join(process.cwd(), 'lib/runtime/environment-contract.ts'), 'utf8');
    expect(source).toContain("['TEST', 'DEMO', 'STAGING', 'PRODUCTION']");
    expect(source).toContain('ENVIRONMENT_PROJECT_COLLISION');
  });
});

describe('DEV-1 browser CSP emulator isolation', () => {
  const browserSandbox = {
    ...valid,
    NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'TEST',
    NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS: 'true',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: SANDBOX_PROJECT_ID,
    NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST: SANDBOX_PROJECT_ID,
  };

  test('permits only exact local Firebase emulator origins for the localhost TEST app', () => {
    const sources = ['http://127.0.0.1:9099', 'http://127.0.0.1:8080'];
    expect(sandboxEmulatorConnectSources(browserSandbox, 'localhost')).toEqual(sources);
    expect(sandboxEmulatorConnectSources(browserSandbox, '127.0.0.1')).toEqual(sources);
  });

  test.each([
    [{ NODE_ENV: 'production' }, 'localhost'],
    [{ GHIMS_RUNTIME_MODE: 'STAGING' }, 'localhost'],
    [{ NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'PRODUCTION' }, 'localhost'],
    [{ NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS: 'false' }, 'localhost'],
    [{ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'g-hims-ai' }, 'localhost'],
    [{ NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST: 'g-hims-ai' }, 'localhost'],
    [{ GHIMS_DEV_SANDBOX_ACK: '' }, 'localhost'],
    [{ GHIMS_DEV_SANDBOX_TENANT_ID: 'central-metro-hospital' }, 'localhost'],
    [{ FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, 'localhost'],
    [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, 'localhost'],
    [{}, 'hospital.example.com'],
    [{}, '192.168.1.10'],
  ] as const)('keeps local emulator origins out of other environments (%j, %s)', (changes, hostname) => {
    expect(sandboxEmulatorConnectSources({ ...browserSandbox, ...changes }, hostname)).toEqual([]);
  });

  test('proxy applies loopback CSP exception only after the complete sandbox guard', async () => {
    const source = await readFile(join(process.cwd(), 'proxy.ts'), 'utf8');
    expect(source).toContain('sandboxEmulatorConnectSources(process.env, hostname)');
    expect(source).toContain('buildContentSecurityPolicy(nonce, request.nextUrl.hostname)');
    expect(source).toContain('sandboxConnectSources.join');
    expect(source).toContain("sandboxConnectSources.length === 0 ? ['upgrade-insecure-requests'] : []");
  });
});

describe('DEV-2 to DEV-5 synthetic scenario integrity', () => {
  test('scenario patients and permanent IDs are unique, and no real records are embedded', () => {
    expect(new Set(SANDBOX_SCENARIOS.map(s => s.patientId)).size).toBe(SANDBOX_SCENARIOS.length);
    expect(new Set(SANDBOX_SCENARIOS.map(s => s.mrn)).size).toBe(SANDBOX_SCENARIOS.length);
    expect(SANDBOX_SCENARIOS.every(s => s.patientId.startsWith('ds_') && s.mrn.startsWith('DS-MRN-'))).toBe(true);
    expect(SANDBOX_SCENARIOS).toHaveLength(8);
  });

  test('completed care has no active pointers, unresolved care remains active', () => {
    const done = SANDBOX_SCENARIOS.find(s => s.id === 'telehealth-completed')!;
    const unused = SANDBOX_SCENARIOS.find(s => s.id === 'telehealth-unused')!;
    expect(scenarioCarePointers(done).activeTelehealthEncounterIds).toEqual([]);
    expect(scenarioCarePointers(unused).activeTelehealthEncounterIds).toEqual([unused.encounterId]);
    const inpatient = SANDBOX_SCENARIOS.find(s => s.id === 'inpatient-care')!;
    expect(scenarioCarePointers(inpatient).activeIpdEncounterId).toBe(inpatient.encounterId);
  });

  test('synthetic doctor has real credential and signing privilege fixture; no admin clinical override', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/dev-sandbox/manage.ts'), 'utf8');
    expect(SANDBOX_PERSONAS.some(p => p.key === 'doctor' && p.role === 'DOCTOR')).toBe(true);
    expect(script).toContain("'SIGN_CLINICAL_NOTES'");
    expect(script).toContain("verificationStatus: 'VERIFIED'");
    expect(script).toContain("verifiedByActorId: personaUid('admin')");
    expect(script).toContain('verifiedAt: nowIso');
    expect(script).toContain("'CONSULT_OPD'");
    expect(script).toContain("shiftName: 'DAY', status: 'PUBLISHED'");
    expect(script).toContain("employmentStatus: 'ACTIVE'");
    expect(script).toContain("collection('clinicalPrivileges')");
    expect(script).toContain("collection('rosterAssignments')");
    expect(script).not.toContain("roles: ['SYSTEM_ADMIN', 'DOCTOR']");
  });

  test('external service simulations cannot touch clinical or billing authority', () => {
    const result = simulateSandboxExternalSystem(valid, 'WEBRTC_MEDIA', 'TIMEOUT');
    expect(result.simulated).toBe(true);
    expect(result.externalActivityExecuted).toBe(false);
    expect(result.clinicalOrFinancialAuthorityChanged).toBe(false);
    expect(result.traceLabel).toBe('SYNTHETIC_ONLY:WEBRTC_MEDIA:TIMEOUT');
    expect(() => simulateSandboxExternalSystem({
      ...valid, GHIMS_RUNTIME_MODE: 'STAGING',
    }, 'EXTERNAL_PAYMENT_GATEWAY', 'AVAILABLE')).toThrow('DEV_SANDBOX_TEST_RUNTIME_ONLY');
  });

  test('reset only destroys a verified marked sandbox tenant with double acknowledgment', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/dev-sandbox/manage.ts'), 'utf8');
    expect(script).toContain('validateDevelopmentSandbox(process.env)');
    expect(script).toContain('assertExistingMarker()');
    expect(script).toContain('RESET_DISPOSABLE_EMULATOR_TENANT');
    expect(script).toContain('await db.recursiveDelete(tenant)');
    expect(script).toContain('DEV_SANDBOX_AUTH_UID_COLLISION');
    expect(script).toContain('DEV_SANDBOX_ALREADY_SEEDED');
  });

  test('sandbox does not silently turn fixtures into executed medical records', async () => {
    const script = await readFile(join(process.cwd(), 'scripts/dev-sandbox/manage.ts'), 'utf8');
    expect(script).toContain('Fixtures establish starting conditions, not successful clinical commands.');
    expect(script).not.toContain("collection('encounterEvidence').doc(");
    expect(script).not.toContain("collection('journalEntries').doc(");
    expect(script).not.toContain('SignClinicalNoteCommand');
  });
});
