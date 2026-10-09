import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (filename: string) =>
  readFile(path.join(process.cwd(), filename), 'utf8');

describe('MPI patient removal action visibility', () => {
  test('hospital-wide MPI renders a wired Remove Record action for selected patient', async () => {
    const view = await source('components/views/patient-mpi-view.tsx');
    expect(view).toContain('id="btn-remove-patient-record"');
    expect(view).toContain('data-testid="mpi-remove-patient-record"');
    expect(view).toContain('onClick={() => setRemovalCandidate(currentPatient)}');
    expect(view).toContain('disabled={!canRemove || auth.loading || auth.isOffline}');
    expect(view).toContain('Admin authorization required');
    expect(view).toContain('className="flex flex-wrap items-center gap-2"');
    expect(view).toContain('<PatientRecordRemovalModal');
    expect(view).toContain('onRemoved={(patientId) => {');
    expect(view).toContain("new CustomEvent('ghims:edge-sync-complete'");
    expect(view).toContain('detail: { tenantId: auth.activeTenant?.tenantId }');
  });

  test('confirmation requires a reason and MRN; command is authoritative and online-only', async () => {
    const modal = await source('components/mpi/patient-record-removal-modal.tsx');
    const service = await source('lib/backend/services/patient-record-removal-domain-service.ts');
    expect(modal).toContain('Why are you removing this patient record?');
    expect(modal).toContain('data-testid="remove-patient-reason"');
    expect(modal).toContain('data-testid="remove-patient-mrn"');
    expect(modal).toContain('reasonLength >= 20');
    expect(modal).toContain('verifiedMrn');
    expect(modal).toContain('retentionAcknowledged');
    expect(modal).toContain("'RemovePatientRecordCommand'");
    expect(modal).toContain('result.queuedOffline');
    expect(service).toContain("eventType: 'PATIENT_RECORD_REMOVED_FROM_ACTIVE_MPI'");
    expect(service).toContain("auditAction: 'PATIENT_RECORD_REMOVED'");
    expect(service).toContain('auditReason: reason');
    expect(service).toContain('omitDomainStateFromAudit: true');
    expect(service).not.toContain('.delete(');
  });

  test('removal role requirement on UI matches server enforcement', async () => {
    const view = await source('components/views/patient-mpi-view.tsx');
    const service = await source('lib/backend/services/patient-record-removal-domain-service.ts');
    for (const role of ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN']) {
      expect(view).toContain(role);
      expect(service).toContain(role);
    }
    expect(service).toContain('AuthorizationPipeline.evaluate');
    expect(service).toContain('requiredRoles: ADMIN_ROLES');
  });
});
