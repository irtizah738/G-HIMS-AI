/**
 * G-HIMS Patient 360 care-transition orchestration.
 *
 * Hospitalization is an Encounter lifecycle. Bed occupancy is a resource
 * assignment within that lifecycle, never the source of truth for admission.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import type { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { PatientClinicalKnowledgeDomainService } from './patient-clinical-knowledge-domain-service';
import type { Bed } from '@/lib/types/ghims';
import type { PatientMPI } from '@/types/mpi';
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
  sourceEncounterId?: string;
  linkedEncounterId?: string;
  disposition?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  dischargedAt?: number;
  dischargeSummaryEvidenceId?: string;
  followUpInstructions?: string;
}

export interface AdmitPatientToInpatientCarePayload {
  patientId: string;
  bedId: string;
  sourceEncounterId?: string;
  admittingDiagnosis: string;
  targetWard: string;
  assignedDoctor?: string;
  assignedNurse?: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
}

export interface DischargeInpatientEncounterPayload {
  encounterId: string;
  bedId: string;
  disposition: string;
  dischargeSummaryEvidenceId: string;
  followUpInstructions: string;
  notes?: string;
}

function activeEncounterStatus(value: unknown): boolean {
  return ['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(String(value || '').toUpperCase());
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
    if (bed.status !== 'available' || bed.patientId) {
      return { success: false, commandId, idempotencyKey, error: { code: 'BED_UNAVAILABLE', message: `Bed ${bed.bedNumber || bed.id} is not available.` } };
    }
    if (patient.activeBedId) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_ALREADY_ADMITTED', message: `Patient is already assigned to bed ${patient.activeBedId}.` } };
    }
    if (patient.activeEncounterId && patient.activeEncounterId !== payload.sourceEncounterId) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_ACTIVE_ENCOUNTER_CONFLICT', message: `Patient already has active encounter ${patient.activeEncounterId}.` } };
    }

    const now = Date.now();
    const encounterId = `enc_ipd_${crypto.randomUUID()}`;
    const admissionDate = new Date(now).toISOString().slice(0, 10);

    const inpatientEncounter: PersistedEncounter = {
      encounterId,
      tenantId: context.tenantId,
      patientId: patient.id,
      encounterType: 'IPD',
      chiefComplaint: payload.admittingDiagnosis,
      departmentId: payload.targetWard,
      status: 'ACTIVE',
      currentStage: 'CONSULTATION',
      clinicalState: 'CONSULTATION',
      operationalState: 'IN_SERVICE',
      financialClearanceState: 'NOT_REQUIRED',
      resourceAssignmentState: 'BED_ASSIGNED',
      priority: payload.priority || 'ROUTINE',
      assignedProviderId: payload.assignedDoctor || context.actorId,
      sourceEncounterId: payload.sourceEncounterId,
      createdAt: now,
      updatedAt: now,
    };

    const bedState: Bed = {
      ...bed,
      status: 'occupied',
      patientId: patient.id,
      patientName: patient.fullName,
      admissionDate,
      assignedDoctor: payload.assignedDoctor || bed.assignedDoctor,
      assignedNurse: payload.assignedNurse || bed.assignedNurse,
    };

    const patientState: PatientMPI = {
      ...patient,
      activeBedId: bed.id,
      activeEncounterId: encounterId,
      updatedAt: now,
    };

    const sourceEncounterState = sourceEncounter
      ? {
          ...sourceEncounter,
          status: 'TRANSFERRED',
          currentStage: 'COMPLETED',
          clinicalState: 'COMPLETED',
          operationalState: 'COMPLETED',
          resourceAssignmentState: 'RELEASED',
          disposition: 'INPATIENT_ADMISSION',
          linkedEncounterId: encounterId,
          completedAt: now,
          updatedAt: now,
        }
      : null;

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
        targetWard: payload.targetWard,
        admittingDiagnosis: payload.admittingDiagnosis,
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
        { entityType: 'HOSPITAL_BED', entityId: bed.id, domainState: bedState },
        { entityType: 'PATIENT_MPI', entityId: patient.id, domainState: patientState },
        ...(sourceEncounterState
          ? [{ entityType: 'ENCOUNTER', entityId: sourceEncounterState.encounterId, domainState: sourceEncounterState }]
          : []),
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
    if (!bed || bed.status !== 'occupied' || bed.patientId !== encounter.patientId) {
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
    if (patient.activeEncounterId !== encounter.encounterId || patient.activeBedId !== bed.id) {
      return { success: false, commandId, idempotencyKey, error: { code: 'PATIENT_CENSUS_STATE_CONFLICT', message: 'Patient active encounter/bed does not match the discharge target.' } };
    }

    const [
      dischargeEvidence,
      diagnosticOrders,
      encounterEvidence,
      inpatientOrders,
      allergyFacts,
      medicationFacts,
      allergyKnowledge,
      medicationKnowledge,
    ] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounterEvidence',
        payload.dischargeSummaryEvidenceId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'orders',
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
    const dischargedEncounter: PersistedEncounter = {
      ...encounter,
      status: 'DISCHARGED',
      currentStage: 'COMPLETED',
      clinicalState: 'COMPLETED',
      operationalState: 'COMPLETED',
      resourceAssignmentState: 'RELEASED',
      disposition: payload.disposition,
      dischargeSummaryEvidenceId: payload.dischargeSummaryEvidenceId,
      followUpInstructions: payload.followUpInstructions,
      completedAt: now,
      dischargedAt: now,
      updatedAt: now,
    };

    const bedState: Bed = {
      ...bed,
      status: 'cleaning',
      patientId: undefined,
      patientName: undefined,
      notes: payload.notes || 'Sanitizing protocol in progress (Discharged)',
    };

    const patientState: PatientMPI = {
      ...patient,
      activeBedId: undefined,
      activeEncounterId: undefined,
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
        dischargeSummaryEvidenceId: payload.dischargeSummaryEvidenceId,
        medicationReconciliationEvidenceId: medicationReconciliation.evidenceId,
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
      additionalStateWrites: [
        { entityType: 'HOSPITAL_BED', entityId: bed.id, domainState: bedState },
        { entityType: 'PATIENT_MPI', entityId: patient.id, domainState: patientState },
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
      },
    };
  }
}
