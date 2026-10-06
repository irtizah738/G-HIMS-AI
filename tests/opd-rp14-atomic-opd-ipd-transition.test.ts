import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CareTransitionDomainService } from '@/lib/backend/services/care-transition-domain-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext } from '@/lib/backend/types';

process.env.GHIMS_RUNTIME_MODE = 'TEST';
process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE = 'TEST';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function context(tenantId: string): CommandContext {
  return {
    actorId: 'doctor-rp14',
    tenantId,
    roles: ['DOCTOR'],
    permissions: [],
    departmentIds: ['MEDICAL_WARD'],
    facilityIds: ['facility-rp14'],
    clinicalPrivileges: ['ADMIT_INPATIENT'],
    correlationId: 'corr-rp14',
    requestId: 'req-rp14',
  };
}

function seedAtomicOpdSource(
  tenantId: string,
  suffix: string,
  options: { includeReconciliation?: boolean } = {}
) {
  const patientId = `patient-${suffix}`;
  const opdEncounterId = `enc-opd-${suffix}`;
  const bedId = `bed-${suffix}`;
  const appointmentId = `appt-${suffix}`;
  const reconciliationId = `opd_billrec_${opdEncounterId}`;
  const includeReconciliation = options.includeReconciliation !== false;

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'PATIENT_MPI',
    patientId,
    {
      id: patientId,
      tenantId,
      mrn: `MRN-${suffix}`,
      fullName: 'RP14 Test Patient',
      status: 'ACTIVE',
      activeCareContexts: {
        activeOpdEncounterIds: [opdEncounterId],
        latestOpdEncounterId: opdEncounterId,
      },
      activeEncounterId: opdEncounterId,
      createdAt: 1,
      updatedAt: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'ENCOUNTER',
    opdEncounterId,
    {
      encounterId: opdEncounterId,
      tenantId,
      patientId,
      encounterType: 'OPD',
      facilityId: 'facility-rp14',
      departmentId: 'OPD',
      status: 'ACTIVE',
      currentStage: 'DISCHARGE_OR_REFERRAL',
      clinicalState: 'DISPOSITION',
      operationalState: 'IN_SERVICE',
      financialClearanceState: 'FINAL_BILLING_CLEARED',
      resourceAssignmentState: 'RELEASED',
      billingReconciliationId: reconciliationId,
      billingReconciliationState: includeReconciliation ? 'CLEARED' : undefined,
      billingMutationSequence: 7,
      sourceAppointmentId: appointmentId,
      assignedProviderId: 'doctor-rp14',
      createdAt: 1,
      updatedAt: 1,
    }
  );

  if (includeReconciliation) {
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'OPD_BILLING_RECONCILIATION',
      reconciliationId,
      {
        reconciliationId,
        tenantId,
        encounterId: opdEncounterId,
        patientId,
        status: 'CLEARED',
        billingMutationSequence: 7,
        reconciledBy: 'cashier-rp14',
        reconciledAt: 2,
        schemaVersion: 1,
      }
    );
  }

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'OPD_APPOINTMENT',
    appointmentId,
    {
      appointmentId,
      tenantId,
      patientId,
      encounterId: opdEncounterId,
      facilityId: 'facility-rp14',
      departmentId: 'OPD',
      status: 'CHECKED_IN',
      createdAt: 1,
      updatedAt: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'HOSPITAL_BED',
    bedId,
    {
      id: bedId,
      tenantId,
      bedNumber: `B-${suffix}`,
      facilityId: 'facility-rp14',
      departmentId: 'MEDICAL_WARD',
      ward: 'General',
      roomId: 'room-rp14',
      status: 'available',
      createdAt: 1,
      updatedAt: 1,
    }
  );

  return {
    patientId,
    opdEncounterId,
    bedId,
    appointmentId,
    reconciliationId,
  };
}

describe('OPD-RP14 atomic OPD to IPD transition', () => {
  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
  });

  test('OPD UI uses one admission command instead of committing disposition first', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const handlerStart = workspace.indexOf('const handleCommitDisposition');
    const handlerEnd = workspace.indexOf('setActiveTab', handlerStart + 5000);
    const handler = workspace.slice(handlerStart, handlerEnd + 1000);

    const directAdmission = handler.indexOf('if (directAdmission)');
    const atomicAdmission = handler.indexOf(
      "'AdmitPatientToInpatientCareCommand'"
    );
    const normalDisposition = handler.indexOf(
      "'CommitEncounterDispositionCommand'"
    );

    expect(directAdmission).toBeGreaterThan(-1);
    expect(atomicAdmission).toBeGreaterThan(directAdmission);
    expect(normalDisposition).toBeGreaterThan(atomicAdmission);
    expect(handler).not.toContain(
      'OPD disposition was recorded, but inpatient admission could not be completed.'
    );
  });

  test('OPD-source admission requires final billing, disposition stage, appointment lineage and authoritative bed ward', async () => {
    const service = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(service).toContain("'SOURCE_OPD_DISPOSITION_STAGE_REQUIRED'");
    expect(service).toContain(
      "'SOURCE_OPD_BILLING_RECONCILIATION_REQUIRED'"
    );
    expect(service).toContain(
      "'SOURCE_OPD_APPOINTMENT_LINEAGE_MISMATCH'"
    );
    expect(service).toContain(
      "'CROSS_FACILITY_OPD_IPD_TRANSITION_NOT_SUPPORTED'"
    );
    expect(service).toContain("'TARGET_BED_WARD_IDENTITY_REQUIRED'");
    expect(service).toContain('authoritativeTargetWard');
  });

  test('one command atomically closes OPD, completes appointment, occupies bed and activates IPD', async () => {
    const tenantId = 'tenant-rp14-success';
    const fixture = seedAtomicOpdSource(tenantId, 'success');

    const result = await CareTransitionDomainService.admitToInpatientCare(
      context(tenantId),
      'cmd-rp14-success',
      'idem-rp14-success',
      {
        patientId: fixture.patientId,
        bedId: fixture.bedId,
        sourceEncounterId: fixture.opdEncounterId,
        admittingDiagnosis: 'Acute condition requiring inpatient monitoring',
        targetWard: 'client-supplied-label-that-is-not-authority',
        assignedDoctor: 'doctor-rp14',
        priority: 'URGENT',
      }
    );

    expect(result.success).toBe(true);
    const ipdEncounterId = String(result.entityId || '');
    expect(ipdEncounterId.startsWith('enc_ipd_')).toBe(true);

    const sourceEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        fixture.opdEncounterId
      ) || {};
    const inpatientEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        ipdEncounterId
      ) || {};
    const bed =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'HOSPITAL_BED',
        fixture.bedId
      ) || {};
    const patient =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'PATIENT_MPI',
        fixture.patientId
      ) || {};
    const appointment =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_APPOINTMENT',
        fixture.appointmentId
      ) || {};
    const handoff =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'CLINICAL_HANDOFF',
        `handoff_admission_${ipdEncounterId}`
      ) || {};

    expect(sourceEncounter.status).toBe('TRANSFERRED');
    expect(sourceEncounter.currentStage).toBe('COMPLETED');
    expect(sourceEncounter.linkedEncounterId).toBe(ipdEncounterId);
    expect(
      (sourceEncounter.dispositionData as any)?.inpatientAdmissionRequest
        ?.targetBedId
    ).toBe(fixture.bedId);

    expect(inpatientEncounter.encounterType).toBe('IPD');
    expect(inpatientEncounter.sourceEncounterId).toBe(
      fixture.opdEncounterId
    );
    expect(inpatientEncounter.departmentId).toBe('MEDICAL_WARD');
    expect(inpatientEncounter.status).toBe('ACTIVE');

    expect(bed.status).toBe('occupied');
    expect(bed.currentPatientId).toBe(fixture.patientId);
    expect(bed.currentEncounterId).toBe(ipdEncounterId);

    expect(patient.activeBedId).toBe(fixture.bedId);
    expect(patient.activeEncounterId).toBe(ipdEncounterId);
    expect(
      (patient.activeCareContexts as any)?.activeIpdEncounterId
    ).toBe(ipdEncounterId);
    expect(
      (patient.activeCareContexts as any)?.activeOpdEncounterIds || []
    ).not.toContain(fixture.opdEncounterId);

    expect(appointment.status).toBe('COMPLETED');
    expect(handoff.sourceEncounterId).toBe(fixture.opdEncounterId);
    expect(handoff.encounterId).toBe(ipdEncounterId);
    expect(handoff.toDepartmentId).toBe('MEDICAL_WARD');
  });

  test('missing final billing reconciliation fails before any OPD or bed mutation', async () => {
    const tenantId = 'tenant-rp14-reject';
    const fixture = seedAtomicOpdSource(tenantId, 'reject', {
      includeReconciliation: false,
    });

    const result = await CareTransitionDomainService.admitToInpatientCare(
      context(tenantId),
      'cmd-rp14-reject',
      'idem-rp14-reject',
      {
        patientId: fixture.patientId,
        bedId: fixture.bedId,
        sourceEncounterId: fixture.opdEncounterId,
        admittingDiagnosis: 'Should not commit',
        targetWard: 'MEDICAL_WARD',
        assignedDoctor: 'doctor-rp14',
        priority: 'URGENT',
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(
      'SOURCE_OPD_BILLING_RECONCILIATION_REQUIRED'
    );

    const sourceEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        fixture.opdEncounterId
      ) || {};
    const bed =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'HOSPITAL_BED',
        fixture.bedId
      ) || {};
    const patient =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'PATIENT_MPI',
        fixture.patientId
      ) || {};
    const appointment =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_APPOINTMENT',
        fixture.appointmentId
      ) || {};

    expect(sourceEncounter.status).toBe('ACTIVE');
    expect(sourceEncounter.currentStage).toBe('DISCHARGE_OR_REFERRAL');
    expect(sourceEncounter.linkedEncounterId).toBeUndefined();
    expect(bed.status).toBe('available');
    expect(bed.currentPatientId).toBeUndefined();
    expect(patient.activeBedId).toBeUndefined();
    expect(patient.activeEncounterId).toBe(fixture.opdEncounterId);
    expect(appointment.status).toBe('CHECKED_IN');
  });
});
