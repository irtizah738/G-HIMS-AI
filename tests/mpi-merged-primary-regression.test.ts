import { beforeEach, describe, expect, test } from 'bun:test';
import { PatientMergeDomainService } from '@/lib/backend/services/patient-merge-domain-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext } from '@/lib/backend/types';

const tenantId = 'mpi-primary-merged-regression';
const primaryId = 'primary-identity';
const duplicateId = 'duplicate-identity';

function context(): CommandContext {
  return {
    tenantId,
    actorId: 'him-supervisor',
    roles: ['ADMINISTRATOR'],
    permissions: [],
    clinicalPrivileges: [],
    requestId: 'req-mpi-merged-primary',
    correlationId: 'corr-mpi-merged-primary',
  };
}

function seed(id: string, extra: Record<string, unknown> = {}) {
  TransactionManager.seedEphemeralStateForTesting(tenantId, 'PATIENT_MPI', id, {
    id,
    tenantId,
    mrn: 'MRN-' + id,
    fullName: 'Synthetic Patient',
    gender: 'female',
    dateOfBirth: '1980-01-01',
    status: 'ACTIVE',
    version: 1,
    allergies: [],
    chronicConditions: [],
    ...extra,
  });
}

function merge(primaryPatientId = primaryId, secondaryPatientId = duplicateId) {
  return PatientMergeDomainService.merge(context(), 'cmd-mpi-merge', 'idemp-mpi-merge', {
    primaryPatientId,
    secondaryPatientId,
    mergeReason: 'Verified duplicate registration; identity documents and clinical chart compared.',
  });
}

describe('MPI already-merged primary regression', () => {
  beforeEach(() => TransactionManager.resetEphemeralStateForTesting());

  test('already-merged primary is rejected with surviving identity guidance, without mutation', async () => {
    seed(primaryId, { status: 'MERGED', mergedIntoPatientId: 'canonical-identity' });
    seed(duplicateId);
    const result = await merge();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PRIMARY_ALREADY_MERGED');
    expect(result.error?.message).toContain('canonical-identity');
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', duplicateId)?.status).toBe('ACTIVE');
    expect(await TransactionManager.getEvents(tenantId)).toHaveLength(0);
  });

  test('already merged secondary into the same primary is benign, with no new event', async () => {
    seed(primaryId);
    seed(duplicateId, { status: 'MERGED', mergedIntoPatientId: primaryId });
    const result = await merge();
    expect(result.success).toBe(true);
    expect((result.data as { alreadyMerged?: boolean })?.alreadyMerged).toBe(true);
    expect(await TransactionManager.getEvents(tenantId)).toHaveLength(0);
  });

  test('merged secondary pointing elsewhere cannot be redirected', async () => {
    seed(primaryId);
    seed(duplicateId, { status: 'MERGED', mergedIntoPatientId: 'different-patient' });
    const result = await merge();
    expect(result.error?.code).toBe('SECONDARY_ALREADY_MERGED');
    expect(await TransactionManager.getEvents(tenantId)).toHaveLength(0);
  });

  test('surviving patient keeps pre-existing DECEASED status after merge', async () => {
    seed(primaryId, { status: 'DECEASED' });
    seed(duplicateId);
    const result = await merge();
    expect(result.success).toBe(true);
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', primaryId)?.status).toBe('DECEASED');
    expect(TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', duplicateId)?.status).toBe('MERGED');
  });

  test('valid merge retains the secondary MRN and immutable audit history', async () => {
    seed(primaryId, { allergies: ['Penicillin'] });
    seed(duplicateId, { chronicConditions: ['Asthma'] });
    const result = await merge();
    expect(result.success).toBe(true);
    expect(result.eventId).toBeTruthy();
    expect(result.auditId).toBeTruthy();
    const secondary = TransactionManager.getEphemeralStateForTesting(tenantId, 'PATIENT_MPI', duplicateId);
    expect(secondary?.status).toBe('MERGED');
    expect(secondary?.mergedIntoPatientId).toBe(primaryId);
    expect(secondary?.mrn).toBe('MRN-' + duplicateId);
    const audits = await TransactionManager.getAudits(tenantId);
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toContain('Verified duplicate');
    expect(audits[0].actorId).toBe('him-supervisor');
    expect(audits[0].newValue).toBeUndefined();
    expect((await TransactionManager.getEvents(tenantId))[0].eventType).toBe('PATIENT_RECORDS_MERGED');
  });

  test('tenant_02bb76e3 mock patients resolve and merge without PRIMARY_PATIENT_NOT_FOUND', async () => {
    const mockContext: CommandContext = {
      tenantId: 'tenant_02bb76e3',
      actorId: 'admin-dev',
      roles: ['ADMINISTRATOR'],
      permissions: [],
      clinicalPrivileges: [],
      requestId: 'req-mock-merge',
      correlationId: 'corr-mock-merge',
    };
    const result = await PatientMergeDomainService.merge(mockContext, 'cmd-mock-1', 'idemp-mock-1', {
      primaryPatientId: 'mock-eleanor-001',
      secondaryPatientId: 'mock-test-002',
      mergeReason: 'Merging duplicate testing records for Eleanor Vance.',
      overrideDemographicConflict: true,
    });
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('MERGED');
  });

  test('MRN-based merge resolves correctly and prevents self-merge across ID and MRN formats', async () => {
    const mockContext: CommandContext = {
      tenantId: 'tenant_02bb76e3',
      actorId: 'admin-dev',
      roles: ['ADMINISTRATOR'],
      permissions: [],
      clinicalPrivileges: [],
      requestId: 'req-mrn-merge',
      correlationId: 'corr-mrn-merge',
    };
    // Passing mock-eleanor-001 and its MRN MRN-20260820-8790 should detect self-merge
    const selfMerge = await PatientMergeDomainService.merge(mockContext, 'cmd-self-1', 'idemp-self-1', {
      primaryPatientId: 'mock-eleanor-001',
      secondaryPatientId: 'MRN-20260820-8790',
      mergeReason: 'Attempting self-merge with differing ID representations.',
    });
    expect(selfMerge.success).toBe(false);
    expect(selfMerge.error?.code).toBe('INVALID_MERGE_SELF');
  });
});
