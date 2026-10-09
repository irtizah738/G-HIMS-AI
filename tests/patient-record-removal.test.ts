import { beforeEach, describe, expect, test } from 'bun:test';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { PatientRecordRemovalDomainService } from '@/lib/backend/services/patient-record-removal-domain-service';
import type { CommandContext } from '@/lib/backend/types';

const tenantId = 'patient-record-removal-tenant';
const patientId = 'patient-to-remove';
const mrn = 'GH-2026-REMOVE-1';

function context(roles: string[] = ['ADMINISTRATOR']): CommandContext {
  return {
    tenantId,
    actorId: 'admin-uid-001',
    roles,
    permissions: [],
    clinicalPrivileges: [],
    correlationId: 'corr-patient-removal',
    requestId: 'req-patient-removal',
    deviceId: 'device-verified-001',
    sessionId: 'session-verified-001',
  };
}

function seedPatient(extra: Record<string, unknown> = {}): void {
  TransactionManager.seedEphemeralStateForTesting(tenantId, 'PATIENT_MPI', patientId, {
    id: patientId,
    tenantId,
    mrn,
    fullName: 'Test Patient',
    dateOfBirth: '1990-01-01',
    gender: 'other',
    identifiers: [{ type: 'MRN', value: mrn, issuer: 'HOSPITAL' }],
    contactPhone: '03000000000',
    address: 'Synthetic',
    createdAt: 1,
    updatedAt: 1,
    createdById: 'registration-staff',
    version: 1,
    status: 'ACTIVE',
    ...extra,
  });
}

function payload() {
  return {
    patientId,
    expectedMrn: mrn,
    reason: 'Duplicate registration entered in error, approved by HIM supervisor.',
  };
}

describe('Governed patient removal from active MPI', () => {
  beforeEach(() => TransactionManager.resetEphemeralStateForTesting());

  test('admin removal preserves patient identity and commits event, audit and outbox together', async () => {
    seedPatient();
    const result = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-remove-1', 'idemp-remove-1', payload()
    );
    expect(result.success).toBe(true);
    expect(result.eventId).toBeTruthy();
    expect(result.auditId).toBeTruthy();
    expect(result.outboxId).toBeTruthy();

    const patient = TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', patientId);
    expect(patient?.status).toBe('REMOVED');
    expect(patient?.mrn).toBe(mrn);
    expect(patient?.fullName).toBe('Test Patient');
    expect((patient?.removal as any)?.removedBy).toBe('admin-uid-001');
    expect((patient?.removal as any)?.reason).toBe(payload().reason);
    expect(patient?.version).toBe(2);

    const events = await TransactionManager.getEvents(tenantId);
    const audits = await TransactionManager.getAudits(tenantId);
    const outbox = await TransactionManager.getPendingOutbox(tenantId);
    expect(events.some(e => e.eventType === 'PATIENT_RECORD_REMOVED_FROM_ACTIVE_MPI')).toBe(true);
    const audit = audits.find(a => a.action === 'PATIENT_RECORD_REMOVED');
    expect(audit?.actorId).toBe('admin-uid-001');
    expect(audit?.resourceId).toBe(patientId);
    expect(audit?.reason).toBe(payload().reason);
    expect(audit?.recordedAt).toBeGreaterThan(0);
    expect(outbox.some(o => o.eventType === 'PATIENT_RECORD_REMOVED_FROM_ACTIVE_MPI')).toBe(true);
  });

  test('receptionist and clinician cannot remove a patient', async () => {
    seedPatient();
    for (const role of ['RECEPTIONIST', 'DOCTOR', 'BILLING_CLERK']) {
      const result = await PatientRecordRemovalDomainService.remove(
        context([role]), 'cmd-denied-' + role, 'idem-denied-' + role, payload()
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT_ROLE');
    }
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', patientId)?.status).toBe('ACTIVE');
  });

  test('reason missing or too short is rejected without an audit mutation', async () => {
    seedPatient();
    const result = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-empty-reason', 'idem-empty-reason',
      { ...payload(), reason: 'Cleanup' }
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATIENT_REMOVAL_REASON_REQUIRED');
    expect(await TransactionManager.getAudits(tenantId)).toHaveLength(0);
  });

  test('wrong MRN and cross-tenant identity never mutate a patient', async () => {
    seedPatient();
    const mismatch = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-wrong-mrn', 'idem-wrong-mrn',
      { ...payload(), expectedMrn: 'NOT-THE-MRN' }
    );
    expect(mismatch.error?.code).toBe('PATIENT_MRN_CONFIRMATION_MISMATCH');

    const foreign = await PatientRecordRemovalDomainService.remove(
      { ...context(), tenantId: 'other-tenant' },
      'cmd-cross-tenant', 'idem-cross-tenant', payload()
    );
    expect(foreign.error?.code).toBe('PATIENT_NOT_FOUND');
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', patientId)?.status).toBe('ACTIVE');
  });

  test('active encounter blocks removal with no partial mutation', async () => {
    seedPatient();
    TransactionManager.seedEphemeralStateForTesting(tenantId, 'ENCOUNTER', 'enc-active', {
      id: 'enc-active',
      patientId,
      tenantId,
      operationalState: 'ACTIVE',
      status: 'IN_PROGRESS',
    });
    const result = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-active', 'idem-active', payload()
    );
    expect(result.error?.code).toBe('PATIENT_HAS_ACTIVE_CARE');
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', patientId)?.status).toBe('ACTIVE');
    expect(await TransactionManager.getEvents(tenantId)).toHaveLength(0);
  });

  test('active care pointers also block removal, even without an encounter query hit', async () => {
    seedPatient({ activeCareContexts: { activeIpdEncounterId: 'ipd-123', activeOpdEncounterIds: [] } });
    const result = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-active-pointer', 'idem-active-pointer', payload()
    );
    expect(result.error?.code).toBe('PATIENT_HAS_ACTIVE_CARE');
    expect((await TransactionManager.getAudits(tenantId))).toHaveLength(0);
  });

  test('same patient cannot be removed twice with a new command', async () => {
    seedPatient();
    const first = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-first', 'idem-first', payload()
    );
    expect(first.success).toBe(true);

    const next = await PatientRecordRemovalDomainService.remove(
      context(), 'cmd-second', 'idem-second', payload()
    );
    expect(next.error?.code).toBe('PATIENT_ALREADY_REMOVED');
    expect((await TransactionManager.getAudits(tenantId))).toHaveLength(1);
  });
});
