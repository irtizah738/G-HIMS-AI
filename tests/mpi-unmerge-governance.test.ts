import { describe, expect, test, beforeEach } from 'bun:test';
import { PatientMergeDomainService } from '@/lib/backend/services/patient-merge-domain-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { CommandContext } from '@/lib/backend/types';

describe('MPI Unmerge Governance & Compensating Identity Engine', () => {
  const tenantId = 'tenant_unmerge_audit';
  const adminContext: CommandContext = {
    tenantId,
    actorId: 'user_director_01',
    roles: ['MEDICAL_DIRECTOR', 'ADMINISTRATOR'],
    permissions: ['MANAGE_MPI'],
    correlationId: 'corr_unmerge_test',
  };

  const nurseContext: CommandContext = {
    tenantId,
    actorId: 'user_nurse_01',
    roles: ['TRIAGE_NURSE'],
    permissions: ['VIEW_PATIENTS'],
    correlationId: 'corr_unmerge_nurse',
  };

  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
  });

  test('Unmerge requires Medical Director or Administrator role', async () => {
    expect(async () => {
      await PatientMergeDomainService.unmerge(
        nurseContext,
        'cmd_unmerge_nurse',
        'idemp_nurse',
        {
          primaryPatientId: 'mock-eleanor-001',
          secondaryPatientId: 'mock-test-002',
          unmergeReason: 'Accidentally merged distinct individuals with similar names',
        }
      );
    }).toThrow('INSUFFICIENT_ROLE');
  });

  test('Unmerge rejects short reasons under 10 characters', async () => {
    const result = await PatientMergeDomainService.unmerge(
      adminContext,
      'cmd_short_reason',
      'idemp_short',
      {
        primaryPatientId: 'mock-eleanor-001',
        secondaryPatientId: 'mock-test-002',
        unmergeReason: 'mistake',
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNMERGE_REASON_TOO_SHORT');
  });

  test('Unmerge rejects unmerging an ACTIVE, unmerged patient', async () => {
    // Both fixtures start as ACTIVE
    const result = await PatientMergeDomainService.unmerge(
      adminContext,
      'cmd_not_merged',
      'idemp_not_merged',
      {
        primaryPatientId: 'mock-eleanor-001',
        secondaryPatientId: 'mock-test-002',
        unmergeReason: 'Attempting to unmerge an identity that was never merged',
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATIENT_NOT_MERGED');
  });

  test('Merge then Unmerge restores secondary identity to ACTIVE with compensating audit event', async () => {
    // 1. First merge mock-test-002 into mock-eleanor-001
    const mergeResult = await PatientMergeDomainService.merge(
      adminContext,
      'cmd_initial_merge',
      'idemp_initial_merge',
      {
        primaryPatientId: 'mock-eleanor-001',
        secondaryPatientId: 'mock-test-002',
        mergeReason: 'Suspected duplicate entry created at registration desk',
      }
    );

    expect(mergeResult.success).toBe(true);

    // 2. Now perform governed unmerge
    const unmergeResult = await PatientMergeDomainService.unmerge(
      adminContext,
      'cmd_governed_unmerge',
      'idemp_governed_unmerge',
      {
        primaryPatientId: 'mock-eleanor-001',
        secondaryPatientId: 'mock-test-002',
        unmergeReason: 'Verified national identity documents confirmed twin siblings, not duplicate records',
      }
    );

    expect(unmergeResult.success).toBe(true);
    expect(unmergeResult.data?.status).toBe('ACTIVE');
    expect(unmergeResult.data?.secondaryPatientId).toBe('mock-test-002');
    expect(unmergeResult.eventId).toBeDefined();
    expect(unmergeResult.auditId).toBeDefined();

    // 3. Verify idempotent retry
    const retryResult = await PatientMergeDomainService.unmerge(
      adminContext,
      'cmd_retry_unmerge',
      'idemp_retry_unmerge',
      {
        primaryPatientId: 'mock-eleanor-001',
        secondaryPatientId: 'mock-test-002',
        unmergeReason: 'Retrying unmerge on already active unmerged identity',
      }
    );

    expect(retryResult.success).toBe(true);
    expect(retryResult.data?.alreadyUnmerged).toBe(true);
  });
});
