import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const read = (name: string) => readFile(join(process.cwd(), name), 'utf8');

describe('MPI removal modal viewport and clinical-safety regression', () => {
  test('dialog stays within viewport and scrolls the body instead of clipping confirmation actions', async () => {
    const modal = await read('components/mpi/patient-record-removal-modal.tsx');
    expect(modal).toContain('max-h-[calc(100dvh-1rem)]');
    expect(modal).toContain('sm:max-h-[calc(100dvh-2rem)]');
    expect(modal).toContain('flex min-h-0 flex-1 flex-col');
    expect(modal).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain');
    expect(modal).toContain('data-testid="mpi-removal-dialog-scroll"');
    expect(modal).toContain('data-testid="mpi-removal-dialog-actions"');
    expect(modal.indexOf('data-testid="mpi-removal-dialog-actions"')).toBeGreaterThan(
      modal.indexOf('data-testid="mpi-removal-dialog-scroll"')
    );
    expect(modal).not.toContain('autoFocus');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
  });

  test('active care cannot trigger ordinary removal; eligible mock action remains explicitly verified and server-governed', async () => {
    const modal = await read('components/mpi/patient-record-removal-modal.tsx');
    const service = await read('lib/backend/services/confirmed-mock-patient-retirement-domain-service.ts');


    expect(modal).toContain("if (!canAttemptOrdinaryRemoval)");
    expect(modal).toContain("const canAttemptOrdinaryRemoval = valid && !removalBlocked && !inspectPending");
    expect(modal).toContain("type={removalBlocked ? 'button' : 'submit'}");
    expect(modal).toContain('Review clinical blockers');
    expect(modal).toContain("isConfirmedMock && hasActiveCare");
    expect(modal).toContain("disabled={!valid || !syntheticConfirmed}");
    expect(modal).toContain("data-testid=\"retire-confirmed-mock-patient\"");
    expect(modal).toContain("data-testid=\"retire-mock-synthetic-confirmation\"");
    expect(modal).toContain("'RetireConfirmedMockPatientCommand'");
    expect(modal).toContain("'RemovePatientRecordCommand'");
    expect(modal).toContain('result.queuedOffline');
    expect(service).toContain("assertMockCleanupEnvironment(context.tenantId)");
    expect(service).toContain("MOCK_CLEANUP_FINANCIAL_RECONCILIATION_REQUIRED");
    expect(service).toContain("MOCK_CLEANUP_NON_OPD_ACTIVE_CARE");
    expect(service).toContain("eventType: 'CONFIRMED_MOCK_PATIENT_RETIRED'");
  });

  test('reason, MRN, audit-retention acknowledgement, and admin identity remain mandatory', async () => {
    const modal = await read('components/mpi/patient-record-removal-modal.tsx');
    expect(modal).toContain('reasonLength >= 20');
    expect(modal).toContain('reasonLength <= 1000');
    expect(modal).toContain('verifiedMrn');
    expect(modal).toContain('retentionAcknowledged');
    expect(modal).toContain('!isOffline');
    expect(modal).toContain("['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN']");
    expect(modal).toContain('data-testid="remove-patient-error"');
    expect(modal).toContain('role="alert"');
  });
});
