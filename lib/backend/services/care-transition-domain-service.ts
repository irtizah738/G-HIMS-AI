/**
 * G-HIMS Patient 360 care-transition orchestration.
 *
 * Hospitalization is an Encounter lifecycle. Bed occupancy is a resource
 * assignment within that lifecycle, never the source of truth for admission.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import type { ClinicalHandoff } from '@/types/clinical-coordination';
import type { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { PatientClinicalKnowledgeDomainService } from './patient-clinical-knowledge-domain-service';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import {
  activateCareContext,
  closeCareContext,
  compatibilityEncounterId,
  normalizeCareSetting,
  normalizePatientCarePointers,
} from '@/lib/clinical/patient360/care-context';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import {
  criticalObservationIds,
  isCriticalDiagnosticResult,
} from '@/lib/clinical/diagnostics/critical-result';
import type { Bed } from '@/lib/types/ghims';
import type { PatientMPI } from '@/types/mpi';
import type { CareTransitionEvidence } from '@/types/care-transition-evidence';
import type {
  FinancialClearanceState,
  ResourceAssignmentState,
} from '@/types/clinical-state';

interface PersistedEncounter {
  encounterId: string;
  tenantId: string;
  patientId: string;
  encounterType: string;
  chiefComplaint?: string;
  departmentId?: string;
  status: string;
  currentStage?: string;
  clinicalState?: string;
  operationalState?: string;
  financialClearanceState?: FinancialClearanceState;
  resourceAssignmentState?: ResourceAssignmentState;
  priority?: string;
  assignedProviderId?: string;
  facilityId?: string;
  sourceAppointmentId?: string;
  billingReconciliationId?: string;
  billingReconciliationState?: string;
  billingMutationSequence?: number;
  dispositionData?: Record<string, unknown>;
  _serverVersion?: number;
  sourceEncounterId?: string;
  linkedEncounterId?: string;
  disposition?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  dischargedAt?: number;
  admissionTransitionEvidenceId?: string;
  dischargeTransitionEvidenceId?: string;
  dischargeSummaryEvidenceId?: string;
  followUpInstructions?: string;
}

export interface AdmitPatientToInpatientCarePayload {
  patientId: string;
  bedId: string;
  sourceEncounterId?: string;
  admittingDiagnosis: string;
  targetWard?: string;
  assignedDoctor?: string;
  assignedNurse?: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
}

export interface TransferInpatientBedPayload {
  encounterId: string;
  sourceBedId: string;
  targetBedId: string;
  reason: string;
  clinicalIndication?: string;
}

export interface DischargeInpatientEncounterPayload {
  encounterId: string;
  bedId: string;
  disposition: string;
  dischargeSummaryEvidenceId?: string;
  followUpInstructions: string;
  notes?: string;
}

function activeEncounterStatus(value: unknown): boolean {
  return ['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(String(value || '').toUpperCase());
}

function bedPatientId(bed: Bed | null | undefined): string | undefined {
  if (!bed) return undefined;
  return bed.patientId || bed.currentPatientId;
}

export class CareTransitionDomainService {
  public static async admitToInpatientCare(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AdmitPatientToInpatientCarePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'ADMISSION_OFFICER', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'ADMIT_INPATIENT',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Inpatient admission authority required.',
        },
      };
    }

    const [patient, bed, sourceEncounter] = await Promise.all([
      DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.patientId),
      DomainStateRepository.getById<Bed>(context.tenantId, 'beds', payload.bedId),
      payload.sourceEncounterId
        ? DomainStateRepository.getById<PersistedEncounter>(
            context.tenantId,
            'encounters',
            payload.sourceEncounterId
          )
        : Promise.resolve(null),
    ]);

    if (!patient) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_NOT_FOUND', message: 'Patient does not exist.' } };
    }
    if (!bed) {
      return { success: false, commandId, idempotencyKey, error: { code: 'BED_NOT_FOUND', message: 'Target bed does not exist.' } };
    }
    if (payload.sourceEncounterId && !sourceEncounter) {
      return { success: false, commandId, idempotencyKey, error: { code: 'SOURCE_ENCOUNTER_NOT_FOUND', message: 'Source encounter does not exist.' } };
    }
    if (sourceEncounter && sourceEncounter.patientId !== patient.id) {
      return { success: false, commandId, idempotencyKey, error: { code: 'SOURCE_ENCOUNTER_PATIENT_MISMATCH', message: 'Source encounter belongs to a different patient.' } };
    }

    const sourceIsOpd =
      Boolean(sourceEncounter) &&
      String(sourceEncounter?.encounterType || '').toUpperCase() === 'OPD';
    const sourceReconciliationId = sourceIsOpd
      ? String(sourceEncounter?.billingReconciliationId || '').trim()
      : '';
    const sourceAppointmentId = sourceIsOpd
      ? String(sourceEncounter?.sourceAppointmentId || '').trim()
      : '';

    const [sourceReconciliation, sourceAppointment] = await Promise.all([
      sourceReconciliationId
        ? DomainStateRepository.getById<Record<string, unknown>>(
            context.tenantId,
            'opdBillingReconciliations',
            sourceReconciliationId
          )
        : Promise.resolve(null),
      sourceAppointmentId
        ? DomainStateRepository.getById<Record<string, unknown>>(
            context.tenantId,
            'opdAppointments',
            sourceAppointmentId
          )
        : Promise.resolve(null),
    ]);

    if (sourceIsOpd) {
      if (!activeEncounterStatus(sourceEncounter?.status)) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SOURCE_OPD_ENCOUNTER_NOT_ACTIVE',
            message:
              'Only an active OPD encounter may transition atomically to inpatient care.',
          },
        };
      }
      if (
        String(sourceEncounter?.currentStage || '').toUpperCase() !==
        'DISCHARGE_OR_REFERRAL'
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SOURCE_OPD_DISPOSITION_STAGE_REQUIRED',
            message:
              'OPD-to-IPD transition requires the authoritative OPD workflow to reach DISCHARGE_OR_REFERRAL.',
          },
        };
      }
      if (
        !sourceReconciliationId ||
        !sourceReconciliation ||
        String(sourceEncounter?.billingReconciliationState || '').toUpperCase() !==
          'CLEARED' ||
        String(sourceReconciliation.status || '').toUpperCase() !== 'CLEARED' ||
        String(sourceReconciliation.encounterId || '') !==
          sourceEncounter?.encounterId ||
        String(sourceReconciliation.patientId || '') !== patient.id ||
        Number(sourceReconciliation.billingMutationSequence || -1) !==
          Number(sourceEncounter?.billingMutationSequence || 0)
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SOURCE_OPD_BILLING_RECONCILIATION_REQUIRED',
            message:
              'OPD-to-IPD transition requires current CLEARED final billing reconciliation for the exact source encounter.',
          },
        };
      }
      if (
        sourceAppointmentId &&
        (
          !sourceAppointment ||
          String(sourceAppointment.patientId || '') !== patient.id ||
          String(sourceAppointment.encounterId || '') !==
            sourceEncounter?.encounterId ||
          String(sourceAppointment.status || '') !== 'CHECKED_IN'
        )
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SOURCE_OPD_APPOINTMENT_LINEAGE_MISMATCH',
            message:
              'OPD source appointment linkage is missing, stale, or no longer CHECKED_IN.',
          },
        };
      }
      if (
        sourceEncounter?.facilityId &&
        bed.facilityId &&
        String(sourceEncounter.facilityId) !== String(bed.facilityId)
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'CROSS_FACILITY_OPD_IPD_TRANSITION_NOT_SUPPORTED',
            message:
              'Atomic OPD-to-IPD transition currently requires the source encounter and target bed to be in the same facility.',
          },
        };
      }
    }

    if (bed.status !== 'available' || bedPatientId(bed)) {
      return { success: false, commandId, idempotencyKey, error: { code: 'BED_UNAVAILABLE', message: `Bed ${bed.bedNumber || bed.id} is not available.` } };
    }
    if (patient.activeBedId) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_ALREADY_ADMITTED', message: `Patient is already assigned to bed ${patient.activeBedId}.` } };
    }
    const carePointers = normalizePatientCarePointers(patient.activeCareContexts);
    let activeIpdEncounterId = carePointers.activeIpdEncounterId;
    if (!activeIpdEncounterId && patient.activeEncounterId) {
      const legacyActive = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        patient.activeEncounterId
      );
      if (
        legacyActive &&
        normalizeCareSetting(legacyActive.encounterType || legacyActive.type) === 'IPD' &&
        activeEncounterStatus(legacyActive.status)
      ) {
        activeIpdEncounterId = patient.activeEncounterId;
      }
    }
    if (activeIpdEncounterId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_ACTIVE_IPD_ENCOUNTER_CONFLICT',
          message: `Patient already has active inpatient encounter ${activeIpdEncounterId}.`,
        },
      };
    }

    const actorRoles = new Set(
      context.roles.map((role) => String(role || '').trim().toUpperCase())
    );
    const actorCanAssumeInpatientClinicalResponsibility =
      actorRoles.has('DOCTOR') ||
      actorRoles.has('CONSULTANT') ||
      actorRoles.has('ATTENDING_PHYSICIAN');
    const assignedDoctor = sourceIsOpd
      ? String(sourceEncounter?.assignedProviderId || '').trim() ||
        (actorCanAssumeInpatientClinicalResponsibility ? context.actorId : '')
      : String(payload.assignedDoctor || '').trim() ||
        (actorCanAssumeInpatientClinicalResponsibility ? context.actorId : '');

    if (!assignedDoctor) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INPATIENT_CLINICIAN_ASSIGNMENT_REQUIRED',
          message:
            'Admission staff must assign a receiving doctor or consultant before inpatient admission can be committed.',
        },
      };
    }

    const authoritativeTargetWard = String(
      (bed as Bed & { departmentId?: string }).departmentId ||
        bed.ward ||
        ''
    ).trim();
    if (!authoritativeTargetWard) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'TARGET_BED_WARD_IDENTITY_REQUIRED',
          message:
            'The authoritative target bed must identify its inpatient ward/department before admission.',
        },
      };
    }

    const now = Date.now();
    const encounterId = `enc_ipd_${crypto.randomUUID()}`;
    const admissionTransitionEvidenceId = `care_transition_admission_${encounterId}`;
    const admissionDate = new Date(now).toISOString().slice(0, 10);

    const inpatientEncounter: PersistedEncounter = {
      encounterId,
      tenantId: context.tenantId,
      patientId: patient.id,
      encounterType: 'IPD',
      chiefComplaint: payload.admittingDiagnosis,
      departmentId: authoritativeTargetWard,
      status: 'ACTIVE',
      currentStage: 'CONSULTATION',
      clinicalState: 'CONSULTATION',
      operationalState: 'IN_SERVICE',
      financialClearanceState: 'NOT_REQUIRED',
      resourceAssignmentState: 'BED_ASSIGNED',
      priority: payload.priority || 'ROUTINE',
      assignedProviderId: assignedDoctor,
      sourceEncounterId: payload.sourceEncounterId,
      admissionTransitionEvidenceId,
      createdAt: now,
      updatedAt: now,
    };

    const bedState: Bed = {
      ...bed,
      status: 'occupied',
      patientId: patient.id,
      currentPatientId: patient.id,
      patientName: patient.fullName,
      patientMRN: patient.mrn,
      currentEncounterId: encounterId,
      admissionDate,
      assignedDoctor,
      assignedNurse: payload.assignedNurse || bed.assignedNurse,
    };

    let activeCareContexts = normalizePatientCarePointers(patient.activeCareContexts);
    if (sourceEncounter) {
      activeCareContexts = closeCareContext(
        activeCareContexts,
        normalizeCareSetting(sourceEncounter.encounterType),
        sourceEncounter.encounterId,
        now
      );
    }
    activeCareContexts = activateCareContext(
      activeCareContexts,
      'IPD',
      encounterId,
      now
    );

    const patientState: PatientMPI = {
      ...patient,
      activeBedId: bed.id,
      activeCareContexts,
      activeEncounterId: compatibilityEncounterId(activeCareContexts),
      updatedAt: now,
    };

    const transitionPatient360 = sourceEncounter
      ? await Patient360ProjectionService.getOrRebuildProjection(
          context.tenantId,
          patient.id
        )
      : null;
    if (
      sourceEncounter &&
      (
        !transitionPatient360 ||
        (
          sourceIsOpd &&
          !transitionPatient360.careContexts.activeOpdEncounters.some(
            (item) => item.encounterId === sourceEncounter.encounterId
          )
        )
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ADMISSION_PATIENT360_CONTEXT_REQUIRED',
          message:
            'The source encounter must be present in authoritative Patient 360 before cross-setting inpatient admission can be committed.',
        },
      };
    }

    const admissionHandoffId = sourceEncounter
      ? `handoff_admission_${encounterId}`
      : undefined;
    const receivingClinicianId = assignedDoctor;
    const admissionHandoff: ClinicalHandoff | null = sourceEncounter && admissionHandoffId
      ? {
          handoffId: admissionHandoffId,
          tenantId: context.tenantId,
          patientId: patient.id,
          encounterId,
          sourceEncounterId: sourceEncounter.encounterId,
          careSetting: 'IPD',
          fromClinicianId: context.actorId,
          fromDepartmentId: sourceEncounter.departmentId,
          toClinicianId: receivingClinicianId || undefined,
          toDepartmentId: authoritativeTargetWard,
          toRole: receivingClinicianId ? undefined : 'CONSULTANT',
          currentProblemSummary: payload.admittingDiagnosis,
          activeRisks: [],
          pendingDiagnostics: [],
          pendingProcedures: [],
          pendingConsultations: [],
          medicationConcerns: [],
          unresolvedItems: [],
          expectedActions: [
            'Review admission context and active Patient 360 evidence.',
            'Accept inpatient clinical responsibility.',
          ],
          sourceRefs: Array.from(
            new Set(
              [
                sourceEncounter.encounterId,
                sourceReconciliationId || undefined,
                sourceAppointmentId || undefined,
                admissionTransitionEvidenceId,
                transitionPatient360?.lastEventId,
              ].filter((value): value is string => Boolean(value))
            )
          ),
          patient360Revision: transitionPatient360?.revision,
          patient360SourceCheckpoint: transitionPatient360?.sourceCheckpoint,
          sourceArtifactId: admissionTransitionEvidenceId,
          sourceArtifactType: 'OTHER',
          status:
            receivingClinicianId && receivingClinicianId === context.actorId
              ? 'ACCEPTED'
              : 'PENDING_ACCEPTANCE',
          createdAt: now,
          acceptedAt:
            receivingClinicianId && receivingClinicianId === context.actorId
              ? now
              : undefined,
          acceptedBy:
            receivingClinicianId && receivingClinicianId === context.actorId
              ? context.actorId
              : undefined,
          updatedAt: now,
        }
      : null;

    const sourceEncounterState = sourceEncounter
      ? {
          ...sourceEncounter,
          status: 'TRANSFERRED',
          currentStage: 'COMPLETED',
          clinicalState: 'COMPLETED',
          operationalState: 'COMPLETED',
          resourceAssignmentState: 'RELEASED',
          disposition: 'INPATIENT_ADMISSION',
          dispositionData: {
            ...(sourceEncounter.dispositionData || {}),
            inpatientAdmissionRequest: {
              targetWard: authoritativeTargetWard,
              targetBedId: bed.id,
              clinicalIndication: payload.admittingDiagnosis,
              requestedTargetWard: payload.targetWard,
            },
            careTransitionEvidenceId: admissionTransitionEvidenceId,
          },
          linkedEncounterId: encounterId,
          completedAt: now,
          updatedAt: now,
        }
      : null;

    const sourceAppointmentState =
      sourceAppointmentId && sourceAppointment
        ? {
            ...sourceAppointment,
            status: 'COMPLETED',
            completedAt: now,
            completedBy: context.actorId,
            updatedAt: now,
          }
        : null;

    const admissionTransitionEvidence: CareTransitionEvidence = {
      careTransitionEvidenceId: admissionTransitionEvidenceId,
      tenantId: context.tenantId,
      patientId: patient.id,
      transitionType: sourceIsOpd
        ? 'OPD_TO_IPD_ADMISSION'
        : 'DIRECT_IPD_ADMISSION',
      sourceEncounterId: sourceEncounter?.encounterId,
      targetEncounterId: encounterId,
      inpatientEncounterId: encounterId,
      sourceAppointmentId: sourceAppointmentId || undefined,
      admissionHandoffId,
      bedId: bed.id,
      patient360Revision: transitionPatient360?.revision,
      patient360SourceCheckpoint: transitionPatient360?.sourceCheckpoint,
      facilityId: String(bed.facilityId || '').trim() || undefined,
      departmentId: authoritativeTargetWard,
      sourceRefs: Array.from(
        new Set(
          [
            sourceEncounter?.encounterId,
            encounterId,
            sourceAppointmentId || undefined,
            admissionHandoffId,
            bed.id,
            sourceReconciliationId || undefined,
          ].filter((value): value is string => Boolean(value))
        )
      ),
      recordedBy: context.actorId,
      recordedAt: now,
      schemaVersion: 1,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'DOCTOR',
      aggregateType: 'ENCOUNTER',
      aggregateId: encounterId,
      eventType: 'INPATIENT_ADMISSION_CREATED',
      eventPayload: {
        encounterId,
        patientId: patient.id,
        bedId: bed.id,
        sourceEncounterId: payload.sourceEncounterId,
        targetWard: authoritativeTargetWard,
        requestedTargetWard: payload.targetWard,
        admittingDiagnosis: payload.admittingDiagnosis,
        admissionHandoffId,
        admissionTransitionEvidenceId,
      },
      auditAction: 'ADMIT_PATIENT_TO_INPATIENT_CARE',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounterId,
      auditReason: `Created inpatient encounter ${encounterId} and assigned bed ${bed.bedNumber || bed.id}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: inpatientEncounter,
      additionalStateWrites: [
        {
          entityType: 'HOSPITAL_BED',
          entityId: bed.id,
          domainState: bedState,
          expectedServerVersion: Number(
            (bed as Bed & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        {
          entityType: 'PATIENT_MPI',
          entityId: patient.id,
          domainState: patientState,
          expectedServerVersion: Number(
            (patient as PatientMPI & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        ...(sourceEncounterState && sourceEncounter
          ? [{
              entityType: 'ENCOUNTER',
              entityId: sourceEncounterState.encounterId,
              domainState: sourceEncounterState,
              expectedServerVersion: Number(
                (sourceEncounter as PersistedEncounter & { _serverVersion?: number })._serverVersion || 0
              ),
            }]
          : []),
        ...(admissionHandoff
          ? [{
              entityType: 'CLINICAL_HANDOFF',
              entityId: admissionHandoff.handoffId,
              domainState: admissionHandoff,
              expectedServerVersion: 0,
            }]
          : []),
        ...(sourceAppointmentId &&
        sourceAppointmentState &&
        sourceAppointment
          ? [{
              entityType: 'OPD_APPOINTMENT',
              entityId: sourceAppointmentId,
              domainState: sourceAppointmentState,
              expectedServerVersion: Number(
                sourceAppointment._serverVersion || 0
              ),
            }]
          : []),
        {
          entityType: 'CARE_TRANSITION_EVIDENCE',
          entityId: admissionTransitionEvidenceId,
          domainState: admissionTransitionEvidence,
          expectedServerVersion: 0,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        encounter: inpatientEncounter,
        patient: patientState,
        bed: bedState,
        sourceEncounter: sourceEncounterState,
        sourceAppointment: sourceAppointmentState,
        careTransitionEvidence: admissionTransitionEvidence,
      },
    };
  }

  public static async transferInpatientBed(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransferInpatientBedPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'NURSE', 'ADMISSION_OFFICER', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Inpatient transfer authority required.',
        },
      };
    }

    if (
      !payload.encounterId ||
      !payload.sourceBedId ||
      !payload.targetBedId ||
      payload.sourceBedId === payload.targetBedId ||
      !payload.reason?.trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_INPATIENT_BED_TRANSFER',
          message:
            'Encounter, distinct source/target beds, and a transfer reason are required.',
        },
      };
    }

    const [encounter, sourceBed, targetBed] = await Promise.all([
      DomainStateRepository.getById<PersistedEncounter>(
        context.tenantId,
        'encounters',
        payload.encounterId
      ),
      DomainStateRepository.getById<Bed>(
        context.tenantId,
        'beds',
        payload.sourceBedId
      ),
      DomainStateRepository.getById<Bed>(
        context.tenantId,
        'beds',
        payload.targetBedId
      ),
    ]);

    if (
      !encounter ||
      String(encounter.encounterType).toUpperCase() !== 'IPD' ||
      !activeEncounterStatus(encounter.status)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ACTIVE_INPATIENT_ENCOUNTER_REQUIRED',
          message: 'An active inpatient encounter is required for bed transfer.',
        },
      };
    }

    if (
      !sourceBed ||
      sourceBed.status !== 'occupied' ||
      bedPatientId(sourceBed) !== encounter.patientId ||
      (sourceBed.currentEncounterId &&
        sourceBed.currentEncounterId !== encounter.encounterId)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'SOURCE_BED_CENSUS_CONFLICT',
          message: 'Source bed does not match the active inpatient encounter.',
        },
      };
    }

    if (!targetBed || targetBed.status !== 'available' || bedPatientId(targetBed)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'TARGET_BED_UNAVAILABLE',
          message: 'Target bed is not available for inpatient transfer.',
        },
      };
    }

    const patient = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId,
      'patients',
      encounter.patientId
    );
    const activeIpdForTransfer = patient
      ? normalizePatientCarePointers(patient.activeCareContexts).activeIpdEncounterId ||
        patient.activeEncounterId
      : undefined;
    if (
      !patient ||
      activeIpdForTransfer !== encounter.encounterId ||
      patient.activeBedId !== sourceBed.id
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_CENSUS_STATE_CONFLICT',
          message:
            'Patient active encounter/bed does not match the requested transfer.',
        },
      };
    }

    const now = Date.now();
    const transferId = `trf_${crypto.randomUUID()}`;
    const sourceState: Bed = {
      ...sourceBed,
      status: 'cleaning',
      patientId: undefined,
      currentPatientId: undefined,
      patientName: undefined,
      patientMRN: undefined,
      currentEncounterId: undefined,
      notes: `Transferred to ${targetBed.bedNumber || targetBed.id}: ${payload.reason.trim()}`,
    };
    const targetState: Bed = {
      ...targetBed,
      status: 'occupied',
      patientId: patient.id,
      currentPatientId: patient.id,
      patientName: patient.fullName,
      patientMRN: patient.mrn,
      currentEncounterId: encounter.encounterId,
      admissionDate: sourceBed.admissionDate,
      assignedDoctor: sourceBed.assignedDoctor || targetBed.assignedDoctor,
      assignedNurse: targetBed.assignedNurse || sourceBed.assignedNurse,
      notes: `Transferred from ${sourceBed.bedNumber || sourceBed.id}: ${payload.reason.trim()}`,
    };
    const patientState: PatientMPI = {
      ...patient,
      activeBedId: targetBed.id,
      updatedAt: now,
    };
    const transferRecord = {
      id: transferId,
      tenantId: context.tenantId,
      encounterId: encounter.encounterId,
      patientId: patient.id,
      patientName: patient.fullName,
      patientMRN: patient.mrn,
      sourceBedId: sourceBed.id,
      sourceBedNumber: sourceBed.bedNumber,
      targetBedId: targetBed.id,
      targetBedNumber: targetBed.bedNumber,
      requestedBy: context.actorId,
      approvedBy: context.actorId,
      reason: payload.reason.trim(),
      clinicalIndication: String(payload.clinicalIndication || '').trim(),
      status: 'completed',
      timestamp: new Date(now).toISOString(),
      completedAt: new Date(now).toISOString(),
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'HOSPITAL_BED',
      aggregateId: sourceBed.id,
      eventType: 'INPATIENT_BED_TRANSFERRED',
      eventPayload: {
        transferId,
        encounterId: encounter.encounterId,
        patientId: patient.id,
        sourceBedId: sourceBed.id,
        targetBedId: targetBed.id,
        reason: payload.reason.trim(),
      },
      auditAction: 'TRANSFER_INPATIENT_BED',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounter.encounterId,
      auditReason: `Transferred inpatient encounter ${encounter.encounterId} from bed ${sourceBed.id} to ${targetBed.id}.`,
      outboxTopic: 'g-hims-inpatient-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: sourceState,
      expectedPrimaryServerVersion: Number(
        (sourceBed as Bed & { _serverVersion?: number })._serverVersion || 0
      ),
      additionalStateWrites: [
        {
          entityType: 'HOSPITAL_BED',
          entityId: targetBed.id,
          domainState: targetState,
          expectedServerVersion: Number(
            (targetBed as Bed & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        {
          entityType: 'PATIENT_MPI',
          entityId: patient.id,
          domainState: patientState,
          expectedServerVersion: Number(
            (patient as PatientMPI & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        { entityType: 'BED_TRANSFER', entityId: transferId, domainState: transferRecord },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: transferId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        transfer: transferRecord,
        sourceBed: sourceState,
        targetBed: targetState,
        patient: patientState,
      },
    };
  }

  public static async dischargeInpatientEncounter(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DischargeInpatientEncounterPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'DISCHARGE_INPATIENT',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Inpatient discharge authority required.',
        },
      };
    }

    if (
      !payload.encounterId ||
      !payload.bedId ||
      !String(payload.disposition || '').trim() ||
      !String(payload.followUpInstructions || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_INPATIENT_DISCHARGE_INPUT',
          message:
            'Encounter, bed, disposition, and follow-up instructions are required. Signed discharge evidence is resolved authoritatively.',
        },
      };
    }

    const [encounter, bed] = await Promise.all([
      DomainStateRepository.getById<PersistedEncounter>(context.tenantId, 'encounters', payload.encounterId),
      DomainStateRepository.getById<Bed>(context.tenantId, 'beds', payload.bedId),
    ]);

    if (!encounter) {
      return { success: false, commandId, idempotencyKey, error: { code: 'ENCOUNTER_NOT_FOUND', message: 'Inpatient encounter does not exist.' } };
    }
    if (String(encounter.encounterType).toUpperCase() !== 'IPD') {
      return { success: false, commandId, idempotencyKey, error: { code: 'NOT_INPATIENT_ENCOUNTER', message: 'Only an inpatient encounter can use inpatient discharge.' } };
    }
    if (!activeEncounterStatus(encounter.status)) {
      return { success: false, commandId, idempotencyKey, error: { code: 'ENCOUNTER_ALREADY_CLOSED', message: `Encounter is already ${encounter.status}.` } };
    }
    if (!bed || bed.status !== 'occupied' || bedPatientId(bed) !== encounter.patientId) {
      return { success: false, commandId, idempotencyKey, error: { code: 'CENSUS_STATE_CONFLICT', message: 'Occupied-bed state does not match the inpatient encounter.' } };
    }

    const patient = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId,
      'patients',
      encounter.patientId
    );
    if (!patient) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_NOT_FOUND', message: 'Assigned patient record does not exist.' } };
    }
    const activeIpdForDischarge =
      normalizePatientCarePointers(patient.activeCareContexts).activeIpdEncounterId ||
      patient.activeEncounterId;
    if (activeIpdForDischarge !== encounter.encounterId || patient.activeBedId !== bed.id) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_CENSUS_STATE_CONFLICT', message: 'Patient active inpatient encounter/bed does not match the discharge target.' } };
    }

    // Architecture contract:
    // immutable clinical events -> longitudinal Patient 360 projection -> CI-7
    // -> credentialed clinician review -> governed discharge command.
    // The raw clinical checks below remain defense-in-depth.
    const [patient360, readiness, readinessReviews] = await Promise.all([
      Patient360ProjectionService.getProjection(
        context.tenantId,
        encounter.patientId
      ),
      DischargeReadinessService.getProjection(
        context.tenantId,
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'dischargeReadinessReviews',
        'encounterId',
        encounter.encounterId
      ),
    ]);

    if (
      !patient360 ||
      patient360.careContexts.activeIpdEncounter?.encounterId !== encounter.encounterId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT360_DECISION_CONTEXT_REQUIRED',
          message:
            'The current inpatient encounter must be present in authoritative Patient 360 before discharge can execute.',
        },
      };
    }

    if (
      !readiness ||
      readiness.patientId !== encounter.patientId ||
      readiness.encounterId !== encounter.encounterId ||
      readiness.patient360Revision !== patient360.revision ||
      readiness.patient360SourceCheckpoint !== patient360.sourceCheckpoint
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_EVALUATION_STALE',
          message:
            'CI-7 has not evaluated the current Patient 360 revision. Wait for projection processing and review the latest assessment.',
        },
      };
    }

    if (readiness.blockers.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_BLOCKERS_PRESENT',
          message:
            'The current CI-7 assessment contains unresolved discharge blockers.',
          details: readiness.blockers.map((item) => ({
            findingId: item.findingId,
            code: item.code,
            title: item.title,
          })),
        },
      };
    }

    const currentReadinessReview = [...readinessReviews]
      .filter((review) => {
        const outcome = String(review.outcome || '').toUpperCase();
        return (
          String(review.evaluationId || '') === readiness.evaluationId &&
          String(review.patientId || '') === encounter.patientId &&
          ['ACKNOWLEDGED', 'PROCEED_WITH_WARNINGS'].includes(outcome)
        );
      })
      .sort(
        (left, right) =>
          Number(right.reviewedAt || right.createdAt || 0) -
          Number(left.reviewedAt || left.createdAt || 0)
      )[0];

    if (!currentReadinessReview) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_REVIEW_REQUIRED',
          message:
            'A credentialed clinician must acknowledge the current CI-7 Patient 360 assessment before the discharge command can execute.',
          details: {
            evaluationId: readiness.evaluationId,
            readinessState: readiness.state,
          },
        },
      };
    }

    const [
      allEncounterEvidence,
      diagnosticOrders,
      diagnosticResults,
      clinicalObservations,
      diagnosticAcknowledgements,
      encounterEvidence,
      inpatientOrders,
      allergyFacts,
      medicationFacts,
      allergyKnowledge,
      medicationKnowledge,
    ] = await Promise.all([
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'encounterEvidence',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'orders',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'diagnosticResults',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'clinicalObservations',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'diagnosticResultAcknowledgements',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'encounterEvidence',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'inpatientOrders',
        'encounterId',
        encounter.encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'clinicalAllergies',
        'patientId',
        encounter.patientId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'medicationOrders',
        'patientId',
        encounter.patientId
      ),
      PatientClinicalKnowledgeDomainService.getDomainRecord(
        context.tenantId,
        encounter.patientId,
        'ALLERGIES'
      ),
      PatientClinicalKnowledgeDomainService.getDomainRecord(
        context.tenantId,
        encounter.patientId,
        'MEDICATIONS'
      ),
    ]);

    const dischargeEvidence =
      (payload.dischargeSummaryEvidenceId
        ? allEncounterEvidence.find(
            (item) =>
              String(item.evidenceId || item.id || '') ===
              payload.dischargeSummaryEvidenceId
          )
        : [...allEncounterEvidence]
            .filter(
              (item) =>
                item.encounterId === encounter.encounterId &&
                item.patientId === encounter.patientId &&
                item.evidenceType === 'SIGNED_CLINICAL_NOTE' &&
                item.category === 'DISCHARGE' &&
                item.status === 'FINAL' &&
                Boolean(String(item.signedBy || '').trim()) &&
                Number.isFinite(Number(item.signedAt))
            )
            .sort(
              (left, right) =>
                Number(right.signedAt || right.createdAt || 0) -
                Number(left.signedAt || left.createdAt || 0)
            )[0]) || null;

    if (
      !dischargeEvidence ||
      dischargeEvidence.encounterId !== encounter.encounterId ||
      dischargeEvidence.patientId !== encounter.patientId ||
      dischargeEvidence.evidenceType !== 'SIGNED_CLINICAL_NOTE' ||
      dischargeEvidence.category !== 'DISCHARGE' ||
      dischargeEvidence.status !== 'FINAL' ||
      !String(dischargeEvidence.signedBy || '').trim() ||
      !Number.isFinite(Number(dischargeEvidence.signedAt))
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_SUMMARY_REQUIRED',
          message: 'A final signed discharge summary for this encounter is required.',
        },
      };
    }

    const resolvedDischargeSummaryEvidenceId = String(
      dischargeEvidence.evidenceId || dischargeEvidence.id || ''
    ).trim();
    if (!resolvedDischargeSummaryEvidenceId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_SUMMARY_EVIDENCE_ID_REQUIRED',
          message:
            'The authoritative signed discharge summary is missing its immutable evidence identifier.',
        },
      };
    }

    const unresolvedStatOrders = diagnosticOrders.filter((order) => {
      const priority = String(order.priority || '').toUpperCase();
      const status = String(order.status || '').toUpperCase();
      return priority === 'STAT' && !['COMPLETED', 'CANCELLED', 'RESULTS_READY', 'FINALIZED'].includes(status);
    });
    if (unresolvedStatOrders.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNRESOLVED_STAT_ORDERS',
          message: 'Outstanding STAT diagnostic orders must be completed, cancelled, or formally handed off before discharge.',
          details: unresolvedStatOrders.map((order) => order.orderId || order.id),
        },
      };
    }

    const criticalIds = criticalObservationIds(clinicalObservations);
    const acknowledgedReportIds = new Set(
      diagnosticAcknowledgements
        .map((item) =>
          String(item.reportId || '').trim()
        )
        .filter(Boolean)
    );
    const unacknowledgedCriticalResults = diagnosticResults.filter((result) => {
      const reportId = String(
        result.reportId || result.diagnosticResultId || ''
      ).trim();
      return (
        isCriticalDiagnosticResult(result, criticalIds) &&
        !acknowledgedReportIds.has(reportId)
      );
    });
    if (unacknowledgedCriticalResults.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNACKNOWLEDGED_CRITICAL_DIAGNOSTIC_RESULT',
          message:
            'All final critical diagnostic results must be acknowledged by an authorized clinician before routine discharge.',
          details: unacknowledgedCriticalResults.map(
            (result) => result.reportId || result.diagnosticResultId
          ),
        },
      };
    }

    const unresolvedStatInpatientOrders = inpatientOrders.filter((order) => {
      const priority = String(order.priority || '').toUpperCase();
      const status = String(order.status || '').toUpperCase();
      return (
        priority === 'STAT' &&
        !['COMPLETED', 'CANCELLED', 'DISCONTINUED'].includes(status)
      );
    });
    if (unresolvedStatInpatientOrders.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNRESOLVED_STAT_INPATIENT_ORDERS',
          message:
            'Active STAT inpatient orders must be completed or discontinued before routine discharge.',
          details: unresolvedStatInpatientOrders.map(
            (order) => order.orderId || order.id
          ),
        },
      };
    }

    const resolvedKnowledgeStatuses = new Set(['KNOWN', 'KNOWN_NONE']);
    const allergyKnowledgeResolved =
      allergyFacts.length > 0 ||
      resolvedKnowledgeStatuses.has(
        String(allergyKnowledge?.status || '').toUpperCase()
      );
    if (!allergyKnowledgeResolved) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ALLERGY_HISTORY_UNRESOLVED',
          message:
            'Allergy history must be reviewed or explicitly documented as known-none before inpatient discharge.',
        },
      };
    }

    const medicationKnowledgeResolved =
      medicationFacts.length > 0 ||
      resolvedKnowledgeStatuses.has(
        String(medicationKnowledge?.status || '').toUpperCase()
      );
    if (!medicationKnowledgeResolved) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_HISTORY_UNRESOLVED',
          message:
            'Medication history must be reviewed or explicitly documented as known-none before inpatient discharge.',
        },
      };
    }

    const medicationReconciliation = encounterEvidence
      .filter((item) => item.evidenceType === 'MEDICATION_RECONCILIATION' && item.status === 'FINAL')
      .sort((a, b) => Number(b.completedAt || b.createdAt || 0) - Number(a.completedAt || a.createdAt || 0))[0];

    if (!medicationReconciliation) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_RECONCILIATION_REQUIRED',
          message: 'A final medication reconciliation is required before inpatient discharge.',
        },
      };
    }

    const latestVitals = encounterEvidence
      .filter((item) => item.evidenceType === 'VITALS' && item.status === 'FINAL')
      .sort((a, b) => Number(b.measuredAt || b.createdAt || 0) - Number(a.measuredAt || a.createdAt || 0))[0];

    if (
      !latestVitals ||
      String(latestVitals.news2Status || '').toUpperCase() !== 'VERIFIED' ||
      !Number.isFinite(Number(latestVitals.news2Score))
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_NEWS2_UNVERIFIED',
          message: 'Latest authoritative vitals do not contain a verified NEWS2 score.',
        },
      };
    }

    if (Number(latestVitals.news2Score) >= 5 && !context.isEmergencyOverride) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'HIGH_CLINICAL_DETERIORATION_RISK',
          message: `NEWS2 ${latestVitals.news2Score} requires clinical escalation before routine discharge.`,
        },
      };
    }

    const now = Date.now();
    const dischargeTransitionEvidenceId =
      `care_transition_discharge_${encounter.encounterId}`;
    const dischargeReadinessReviewId = String(
      currentReadinessReview.reviewId ||
        currentReadinessReview.dischargeReadinessReviewId ||
        currentReadinessReview.id ||
        ''
    ).trim();

    if (!dischargeReadinessReviewId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DISCHARGE_READINESS_REVIEW_ID_REQUIRED',
          message:
            'The accepted CI-7 review is missing its immutable review identifier.',
        },
      };
    }

    const dischargeTransitionEvidence: CareTransitionEvidence = {
      careTransitionEvidenceId: dischargeTransitionEvidenceId,
      tenantId: context.tenantId,
      patientId: encounter.patientId,
      transitionType: 'IPD_DISCHARGE',
      sourceEncounterId: encounter.sourceEncounterId,
      inpatientEncounterId: encounter.encounterId,
      bedId: bed.id,
      facilityId: encounter.facilityId,
      departmentId: encounter.departmentId,
      admissionTransitionEvidenceId: encounter.admissionTransitionEvidenceId,
      dischargeSummaryEvidenceId: resolvedDischargeSummaryEvidenceId,
      medicationReconciliationEvidenceId: String(
        medicationReconciliation.evidenceId ||
          medicationReconciliation.id ||
          ''
      ).trim(),
      dischargeReadinessEvaluationId: readiness.evaluationId,
      dischargeReadinessReviewId,
      patient360Revision: patient360.revision,
      patient360SourceCheckpoint: patient360.sourceCheckpoint,
      disposition: String(payload.disposition).trim(),
      sourceRefs: Array.from(
        new Set(
          [
            encounter.sourceEncounterId,
            encounter.admissionTransitionEvidenceId,
            encounter.encounterId,
            resolvedDischargeSummaryEvidenceId,
            String(
              medicationReconciliation.evidenceId ||
                medicationReconciliation.id ||
                ''
            ).trim(),
            readiness.evaluationId,
            dischargeReadinessReviewId,
            bed.id,
          ].filter((value): value is string => Boolean(value))
        )
      ),
      recordedBy: context.actorId,
      recordedAt: now,
      schemaVersion: 1,
    };

    const dischargedEncounter: PersistedEncounter = {
      ...encounter,
      status: 'DISCHARGED',
      currentStage: 'COMPLETED',
      clinicalState: 'COMPLETED',
      operationalState: 'COMPLETED',
      resourceAssignmentState: 'RELEASED',
      disposition: payload.disposition,
      dischargeTransitionEvidenceId,
      dischargeSummaryEvidenceId: resolvedDischargeSummaryEvidenceId,
      followUpInstructions: payload.followUpInstructions,
      completedAt: now,
      dischargedAt: now,
      updatedAt: now,
    };

    const bedState: Bed = {
      ...bed,
      status: 'cleaning',
      patientId: undefined,
      currentPatientId: undefined,
      patientName: undefined,
      patientMRN: undefined,
      currentEncounterId: undefined,
      notes: payload.notes || 'Sanitizing protocol in progress (Discharged)',
    };

    const activeCareContexts = closeCareContext(
      patient.activeCareContexts,
      'IPD',
      encounter.encounterId,
      now
    );
    const patientState: PatientMPI = {
      ...patient,
      activeBedId: undefined,
      activeCareContexts,
      activeEncounterId: compatibilityEncounterId(activeCareContexts),
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'DOCTOR',
      aggregateType: 'ENCOUNTER',
      aggregateId: encounter.encounterId,
      eventType: 'INPATIENT_ENCOUNTER_DISCHARGED',
      eventPayload: {
        encounterId: encounter.encounterId,
        patientId: encounter.patientId,
        bedId: bed.id,
        disposition: payload.disposition,
        sourceEncounterId: encounter.sourceEncounterId,
        admissionTransitionEvidenceId: encounter.admissionTransitionEvidenceId,
        dischargeTransitionEvidenceId,
        dischargeSummaryEvidenceId: resolvedDischargeSummaryEvidenceId,
        medicationReconciliationEvidenceId:
          dischargeTransitionEvidence.medicationReconciliationEvidenceId,
        dischargeReadinessEvaluationId: readiness.evaluationId,
        dischargeReadinessReviewId,
        patient360Revision: patient360.revision,
        patient360SourceCheckpoint: patient360.sourceCheckpoint,
        latestNews2Score: Number(latestVitals.news2Score),
      },
      auditAction: 'DISCHARGE_INPATIENT_ENCOUNTER',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounter.encounterId,
      auditReason: `Discharged inpatient encounter ${encounter.encounterId} to ${payload.disposition}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: dischargedEncounter,
      expectedPrimaryServerVersion: Number(
        (encounter as PersistedEncounter & { _serverVersion?: number })._serverVersion || 0
      ),
      additionalStateWrites: [
        {
          entityType: 'HOSPITAL_BED',
          entityId: bed.id,
          domainState: bedState,
          expectedServerVersion: Number(
            (bed as Bed & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        {
          entityType: 'PATIENT_MPI',
          entityId: patient.id,
          domainState: patientState,
          expectedServerVersion: Number(
            (patient as PatientMPI & { _serverVersion?: number })._serverVersion || 0
          ),
        },
        {
          entityType: 'CARE_TRANSITION_EVIDENCE',
          entityId: dischargeTransitionEvidenceId,
          domainState: dischargeTransitionEvidence,
          expectedServerVersion: 0,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounter.encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        encounter: dischargedEncounter,
        patient: patientState,
        bed: bedState,
        careTransitionEvidence: dischargeTransitionEvidence,
      },
    };
  }
}
