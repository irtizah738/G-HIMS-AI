import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import {
  ConfirmedMockPatientRetirementDomainService,
  assertMockCleanupEnvironment,
} from '@/lib/backend/services/confirmed-mock-patient-retirement-domain-service';
import type { CommandContext } from '@/lib/backend/types';

const prior = {
  GHIMS_RUNTIME_MODE: process.env.GHIMS_RUNTIME_MODE,
  GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP: process.env.GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP,
  GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT: process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  GHIMS_FIREBASE_PROJECT_ID_TEST: process.env.GHIMS_FIREBASE_PROJECT_ID_TEST,
  NODE_ENV: process.env.NODE_ENV,
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
  GHIMS_MOCK_CLEANUP_DEV_PROJECT_ACK: process.env.GHIMS_MOCK_CLEANUP_DEV_PROJECT_ACK,
};
const tenant = 'tenant_02bb76e3';
const patientId = 'mock-eleanor-001';

function configureTestEnvironment() {
  process.env.GHIMS_RUNTIME_MODE = 'TEST';
  process.env.NODE_ENV = 'test';
  process.env.FIREBASE_PROJECT_ID = 'ghims-mock-retirement-test';
  process.env.GHIMS_FIREBASE_PROJECT_ID_TEST = 'ghims-mock-retirement-test';
  process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT = 'ghims-mock-retirement-test';
  process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION = 'ghims-production-separate';
  process.env.GHIMS_ENABLE_CONFIRMED_MOCK_CLEANUP = 'true';
}

function context(role = 'ADMINISTRATOR', tenantId = tenant): CommandContext {
  return {
    actorId: 'verified-dev-admin-uid', tenantId,
    roles: [role], permissions: [], clinicalPrivileges: [],
    correlationId: 'corr-mock-cleanup', requestId: 'req-mock-cleanup',
  };
}

function seedPatient(input: Record<string, unknown> = {}) {
  TransactionManager.seedEphemeralStateForTesting(tenant, 'PATIENT_MPI', patientId, {
    id: patientId,
    tenantId: tenant,
    mrn: 'MRN-20260820-8790',
    fullName: 'Eleanor Vance',
    dateOfBirth: '1984-01-01',
    gender: 'female',
    bloodGroup: 'O+',
    identifiers: [{ type: 'MRN', value: 'MRN-20260820-8790', issuer: 'DEV' }],
    contactPhone: '000',
    address: 'Synthetic',
    createdAt: 1, createdById: 'dev-staff', updatedAt: 1,
    version: 1, status: 'ACTIVE',
    activeEncounterId: 'opd-mock-1',
    activeCareContexts: {
      activeOpdEncounterIds: ['opd-mock-1'],
      activeTelehealthEncounterIds: [],
    },
    ...input,
  });
}

function seedEncounter(input: Record<string, unknown> = {}) {
  TransactionManager.seedEphemeralStateForTesting(tenant, 'ENCOUNTER', 'opd-mock-1', {
    id: 'opd-mock-1',
    encounterId: 'opd-mock-1',
    tenantId: tenant,
    patientId,
    encounterType: 'OPD',
    status: 'ACTIVE',
    currentStage: 'TRIAGE',
    clinicalState: 'ACTIVE',
    operationalState: 'QUEUED',
    ...input,
  });
}

function payload(input: Record<string, unknown> = {}) {
  return {
    patientId,
    expectedMrn: 'MRN-20260820-8790',
    reason: 'User confirmed this is an entirely synthetic development test patient.',
    confirmedSynthetic: true as const,
    ...input,
  };
}

beforeEach(() => {
  configureTestEnvironment();
  TransactionManager.resetEphemeralStateForTesting();
});
afterAll(() => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key as keyof NodeJS.ProcessEnv];
    else process.env[key as keyof NodeJS.ProcessEnv] = value;
  }
});

describe('explicitly confirmed development-only mock retirement', () => {
  test('retires exact allowlisted mock patient and OPD encounter atomically with audit and no destruction', async () => {
    seedPatient();
    seedEncounter();
    TransactionManager.seedEphemeralStateForTesting(tenant, 'OPD_QUEUE_TOKEN', 'queue-mock-1', {
      id: 'queue-mock-1', tokenId: 'queue-mock-1', tenantId: tenant,
      patientId, encounterId: 'opd-mock-1', status: 'waiting',
    });

    const result = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-dev-cleanup-1', 'idem-dev-cleanup-1', payload()
    );
    expect(result.success).toBe(true);
    expect(result.auditId).toBeTruthy();
    expect(result.eventId).toBeTruthy();
    expect(result.outboxId).toBeTruthy();

    const p = TransactionManager.getEphemeralStateForTesting(tenant, 'PATIENT_MPI', patientId);
    const e = TransactionManager.getEphemeralStateForTesting(tenant, 'ENCOUNTER', 'opd-mock-1');
    const q = TransactionManager.getEphemeralStateForTesting(tenant, 'OPD_QUEUE_TOKEN', 'queue-mock-1');
    expect(p?.status).toBe('REMOVED');
    expect(p?.mrn).toBe('MRN-20260820-8790');
    expect((p?.removal as any).removedBy).toBe('verified-dev-admin-uid');
    expect((p?.activeCareContexts as any).activeOpdEncounterIds).toEqual([]);
    expect(e?.status).toBe('CANCELLED');
    expect((e?.syntheticCleanup as any).previousStatus).toBe('ACTIVE');
    expect(e?.clinicalState).toBe('ACTIVE');
    expect(q?.status).toBe('cancelled');
    const audits = await TransactionManager.getAudits(tenant);
    const events = await TransactionManager.getEvents(tenant);
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toBe(payload().reason);
    expect(audits[0].actorId).toBe('verified-dev-admin-uid');
    expect(audits[0].newValue).toBeUndefined();
    expect(events.some(v => v.eventType === 'CONFIRMED_MOCK_PATIENT_RETIRED')).toBe(true);
    expect(await TransactionManager.getPendingOutbox(tenant)).toHaveLength(1);
  });

  test('Test Patient second allowlisted MRN is accepted', async () => {
    const pId = 'mock-testpatient-001';
    TransactionManager.seedEphemeralStateForTesting(tenant, 'PATIENT_MPI', pId, {
      id: pId, tenantId: tenant, mrn: 'MRN-20260930-3611',
      fullName: 'Test Patient', gender: 'female', bloodGroup: 'O+',
      status: 'ACTIVE', createdAt: 1, updatedAt: 1, version: 1,
    });
    const r = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-dev-cleanup-2', 'idem-dev-cleanup-2',
      payload({ patientId: pId, expectedMrn: 'MRN-20260930-3611' })
    );
    expect(r.success).toBe(true);
  });

  test('production, staging, other tenants, and unconfirmed projects fail closed', async () => {
    expect(() => assertMockCleanupEnvironment('different-tenant')).toThrow();
    process.env.GHIMS_RUNTIME_MODE = 'PRODUCTION';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
    process.env.GHIMS_RUNTIME_MODE = 'STAGING';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
    process.env.GHIMS_RUNTIME_MODE = 'TEST';
    process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT = 'wrong-project';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
    process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT = 'ghims-mock-retirement-test';
    process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION = 'ghims-mock-retirement-test';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
  });

  test('nonadmin and other MRNs cannot use synthetic cleanup', async () => {
    seedPatient();
    seedEncounter();
    const denied = await ConfirmedMockPatientRetirementDomainService.retire(
      context('RECEPTIONIST'), 'cmd-role-denied', 'idem-role-denied', payload()
    );
    expect(denied.success).toBe(false);
    const notAllowed = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-other-mrn', 'idem-other-mrn',
      payload({ expectedMrn: 'MRN-OTHER-REAL-PATIENT' })
    );
    expect(notAllowed.error?.code).toBe('MOCK_CLEANUP_SCOPE_INVALID');
    expect(await TransactionManager.getEvents(tenant)).toHaveLength(0);
  });

  test('exact name is mandatory; active IPD or emergency contexts cannot be retired', async () => {
    seedPatient({ fullName: 'Someone Else' });
    seedEncounter();
    const mismatched = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-name-denied', 'idem-name-denied', payload()
    );
    expect(mismatched.error?.code).toBe('MOCK_CLEANUP_IDENTITY_NOT_VERIFIED');
    seedPatient({ activeBedId: 'bed-occupied' });
    const inpatient = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-ipd-denied', 'idem-ipd-denied', payload()
    );
    expect(inpatient.error?.code).toBe('MOCK_CLEANUP_NON_OPD_ACTIVE_CARE');
    expect(await TransactionManager.getEvents(tenant)).toHaveLength(0);
  });

  test('linked financial invoice blocks retirement; no clinical or financial state changed', async () => {
    seedPatient();
    seedEncounter();
    TransactionManager.seedEphemeralStateForTesting(tenant, 'INVOICE', 'inv_opd_consult_opd-mock-1', {
      id: 'inv_opd_consult_opd-mock-1', tenantId: tenant,
      patientId, encounterId: 'opd-mock-1', amount: 150000,
    });
    const result = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-invoice-denied', 'idem-invoice-denied', payload()
    );
    expect(result.error?.code).toBe('MOCK_CLEANUP_FINANCIAL_RECONCILIATION_REQUIRED');
    expect(TransactionManager.getEphemeralStateForTesting(tenant, 'PATIENT_MPI', patientId)?.status).toBe('ACTIVE');
    expect(TransactionManager.getEphemeralStateForTesting(tenant, 'ENCOUNTER', 'opd-mock-1')?.status).toBe('ACTIVE');
  });

  function seedEmptyTelehealth(options: Record<string, unknown> = {}) {
    seedPatient({
      activeEncounterId: 'tele-mock-1',
      activeCareContexts: {
        activeOpdEncounterIds: [],
        activeTelehealthEncounterIds: ['tele-mock-1'],
      },
    });
    seedEncounter({ status: 'IN_PROGRESS' });
    TransactionManager.seedEphemeralStateForTesting(tenant, 'ENCOUNTER', 'tele-mock-1', {
      id: 'tele-mock-1', encounterId: 'tele-mock-1', tenantId: tenant, patientId,
      encounterType: 'TELEHEALTH', status: 'ACTIVE',
    });
    TransactionManager.seedEphemeralStateForTesting(tenant, 'TELEHEALTH_SESSION', 'th-mock-1', {
      id: 'th-mock-1', encounterId: 'tele-mock-1', tenantId: tenant, patientId,
      status: 'IN_CONSULTATION',
      soapNote: { subjective: '', objective: '', assessment: '', plan: '', icd10Codes: [], cptCodes: [] },
      prescriptions: [], transcription: [], callDurationSeconds: 0, isRecording: false,
      vitals: { bp: '', hr: 0, spo2: 0, temp: 0, lastSync: 'Not yet captured' },
      ...options,
    });
  }

  test('retirement atomically cancels zero-activity synthetic telehealth and OPD with audit', async () => {
    seedEmptyTelehealth();
    const r = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-empty-tele', 'idem-empty-tele', payload()
    );
    expect(r.success).toBe(true);
    expect(r.auditId).toBeTruthy();
    const patient = TransactionManager.getEphemeralStateForTesting(tenant, 'PATIENT_MPI', patientId);
    const opd = TransactionManager.getEphemeralStateForTesting(tenant, 'ENCOUNTER', 'opd-mock-1');
    const encounter = TransactionManager.getEphemeralStateForTesting(tenant, 'ENCOUNTER', 'tele-mock-1');
    const session = TransactionManager.getEphemeralStateForTesting(tenant, 'TELEHEALTH_SESSION', 'th-mock-1');
    expect(patient?.status).toBe('REMOVED');
    expect(patient?.activeEncounterId).toBe('');
    expect((patient?.activeCareContexts as any).activeTelehealthEncounterIds).toEqual([]);
    expect(opd?.status).toBe('CANCELLED');
    expect(encounter?.status).toBe('CANCELLED');
    expect(session?.status).toBe('CANCELLED');
    expect((session?.syntheticCleanup as any).previousStatus).toBe('IN_CONSULTATION');
    expect((r.data as any).retiredTelehealthSessions).toEqual(['th-mock-1']);
    expect((await TransactionManager.getEvents(tenant))[0].eventType).toBe('CONFIRMED_MOCK_PATIENT_RETIRED');
    expect(await TransactionManager.getAudits(tenant)).toHaveLength(1);
  });

  test('telehealth signed note or call activity blocks retirement without side effects', async () => {
    for (const activity of [
      { signedEvidenceId: 'signed-test-note' },
      { soapNote: { subjective: 'real clinical history' } },
      { callDurationSeconds: 8 },
      { transcription: [{ role: 'clinician', text: 'clinical finding' }] },
      { soapNote: { icd10Codes: ['E11.9'] } },
      { vitals: { hr: 72 } },
    ]) {
      TransactionManager.resetEphemeralStateForTesting();
      seedEmptyTelehealth(activity);
      const r = await ConfirmedMockPatientRetirementDomainService.retire(
        context(), 'cmd-tele-block', 'idem-tele-block', payload()
      );
      expect(r.error?.code).toBe('MOCK_CLEANUP_TELEHEALTH_REVIEW_REQUIRED');
      expect(TransactionManager.getEphemeralStateForTesting(tenant, 'PATIENT_MPI', patientId)?.status).toBe('ACTIVE');
      expect(await TransactionManager.getEvents(tenant)).toHaveLength(0);
    }
  });

  test('telehealth missing session, clinical evidence, and bed links fail closed', async () => {
    seedEmptyTelehealth();
    TransactionManager.seedEphemeralStateForTesting(tenant, 'ENCOUNTER_EVIDENCE', 'test-signed-evidence', {
      id: 'test-signed-evidence', patientId, tenantId: tenant, encounterId: 'tele-mock-1',
      status: 'FINAL', evidenceType: 'SIGNED_CLINICAL_NOTE',
    });
    const r = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-evidence-block', 'idem-evidence-block', payload()
    );
    expect(r.error?.code).toBe('MOCK_CLEANUP_CLINICAL_REVIEW_REQUIRED');
    TransactionManager.resetEphemeralStateForTesting();
    seedPatient({
      activeEncounterId: 'tele-mock-1',
      activeCareContexts: {
        activeOpdEncounterIds: [], activeTelehealthEncounterIds: ['tele-mock-1'],
      },
    });
    seedEncounter();
    TransactionManager.seedEphemeralStateForTesting(tenant, 'ENCOUNTER', 'tele-mock-1', {
      id: 'tele-mock-1', encounterId: 'tele-mock-1', tenantId: tenant,
      patientId, encounterType: 'TELEHEALTH', status: 'ACTIVE',
    });
    const missing = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-missing-session', 'idem-missing-session', payload()
    );
    expect(missing.error?.code).toBe('MOCK_CLEANUP_TELEHEALTH_SESSION_MISSING');
    expect(await TransactionManager.getEvents(tenant)).toHaveLength(0);
  });

  test('single explicitly confirmed development project never permits cleanup without separate acknowledgement', () => {
    process.env.FIREBASE_PROJECT_ID = 'g-hims-ai';
    process.env.GHIMS_FIREBASE_PROJECT_ID_TEST = 'g-hims-ai';
    process.env.GHIMS_MOCK_CLEANUP_CONFIRM_PROJECT = 'g-hims-ai';
    process.env.NODE_ENV = 'development';
    delete process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION;
    delete process.env.GHIMS_MOCK_CLEANUP_DEV_PROJECT_ACK;
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
    process.env.GHIMS_MOCK_CLEANUP_DEV_PROJECT_ACK = 'I_CONFIRM_G_HIMS_AI_IS_SYNTHETIC_ONLY';
    expect(() => assertMockCleanupEnvironment(tenant)).not.toThrow();
    process.env.GHIMS_RUNTIME_MODE = 'PRODUCTION';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
    process.env.GHIMS_RUNTIME_MODE = 'TEST';
    process.env.GHIMS_FIREBASE_PROJECT_ID_TEST = 'another-project';
    expect(() => assertMockCleanupEnvironment(tenant)).toThrow();
  });

  test('non-OPD encounters and dangling active encounter pointers block cleanup', async () => {
    seedPatient();
    seedEncounter({ encounterType: 'EMERGENCY' });
    const emergency = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-emergency-denied', 'idem-emergency-denied', payload()
    );
    expect(emergency.error?.code).toBe('MOCK_CLEANUP_UNSUPPORTED_ENCOUNTER');
    seedEncounter();
    seedPatient({ activeEncounterId: 'missing-active-encounter' });
    const dangling = await ConfirmedMockPatientRetirementDomainService.retire(
      context(), 'cmd-orphan-denied', 'idem-orphan-denied', payload()
    );
    expect(dangling.error?.code).toBe('MOCK_CLEANUP_ORPHANED_CARE_POINTER');
  });
});
