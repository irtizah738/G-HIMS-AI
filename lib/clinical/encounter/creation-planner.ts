/**
 * Encounter Creation Planner
 * Plans the complete runtime bundle for patient MPI registration, encounter orchestration, and workflow snapshotting.
 */

import {
  EncounterCreationBundle,
  EncounterPriority,
  EncounterRuntimePlan,
  EncounterType,
  OutboxEventRecord,
  WorkflowRuntimeStage,
  WorkflowSnapshot,
} from '@/types/clinical-workflow';
import { PatientMpiCreationFlow, PatientRegistrationInput } from '../mpi/mpi-creation-flow';
import { CompiledGeneralOpdWorkflow } from '../workflow/compiler';
import { createEncounterCreatedEvent, createPatientRegisteredEvent } from '../events/envelope';
import { createOutboxEventRecord } from '@/lib/events/outbox';
import { buildCanonicalAuditString, calculateSha256 } from '@/lib/audit/logger';

export interface EncounterPlanningRequest {
  tenantId: string;
  facilityCode?: string;
  patientInput: PatientRegistrationInput;
  encounterType?: EncounterType;
  department: string;
  priority?: EncounterPriority;
  chiefComplaint: string;
  attendingPhysicianId?: string;
  attendingPhysicianName?: string;
  triageNurseId?: string;
  triageNurseName?: string;
  tariffId?: string;
  tariffPlanName?: string;
  copayPercent?: number;
  maxCopayCap?: number;
  initiatorUserId: string;
  initiatorUserName: string;
  initiatorUserRole: string;
  clientIp?: string;
}

export class EncounterCreationPlanner {
  /**
   * Prepares the entire atomic EncounterCreationBundle.
   */
  public static async planBundle(request: EncounterPlanningRequest): Promise<EncounterCreationBundle> {
    const timestamp = new Date().toISOString();
    const tenantId = request.tenantId || 'central-metro-hospital';
    const facilityCode = request.facilityCode || 'METRO';

    // 1. Create Patient MPI Record
    const patientRecord = PatientMpiCreationFlow.createPatientRecord(request.patientInput);

    // 2. Plan Encounter Runtime
    const encounterId = `enc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const encounterType: EncounterType = request.encounterType || 'OPD_GENERAL';
    const priority: EncounterPriority = request.priority || 'ROUTINE';
    const department = request.department || 'General OPD';

    const careTeam = {
      attendingPhysicianId: request.attendingPhysicianId || 'dr-sarah-jenkins',
      attendingPhysicianName: request.attendingPhysicianName || 'Dr. Sarah Jenkins, MD',
      triageNurseId: request.triageNurseId || 'nurse-elena-rostova',
      triageNurseName: request.triageNurseName || 'Elena Rostova, RN',
    };

    const slaConfig = {
      overallTargetDurationMinutes: CompiledGeneralOpdWorkflow.totalEstimatedSlaMinutes,
      stageTargets: {
        REGISTRATION: 8,
        TRIAGE: 12,
        CONSULTATION: 25,
        DIAGNOSTICS_LAB_RAD: 40,
        PHARMACY_DISPENSARY: 15,
        BILLING_SETTLEMENT: 10,
        DISCHARGE_OR_REFERRAL: 8,
      },
      alertThresholdPercent: 80,
    };

    const tariffBinding = request.tariffId
      ? {
          tariffId: request.tariffId,
          planName: request.tariffPlanName || 'Standard Ambulatory Tariff',
          copayPercent: request.copayPercent ?? 10,
          maxCopayCap: request.maxCopayCap,
          verifiedBy: request.initiatorUserName,
        }
      : undefined;

    const encounterPlan: EncounterRuntimePlan = {
      id: encounterId,
      tenantId,
      patientId: patientRecord.id,
      patientMrn: patientRecord.mrn,
      encounterType,
      department,
      priority,
      chiefComplaint: request.chiefComplaint,
      careTeam,
      workflowDefinitionId: CompiledGeneralOpdWorkflow.workflowId,
      workflowVersion: CompiledGeneralOpdWorkflow.version,
      slaConfig,
      tariffBinding,
      plannedAt: timestamp,
    };

    // 3. Initialize Workflow Snapshot
    const snapshotId = `wf_snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const initialSnapshot: WorkflowSnapshot = {
      id: snapshotId,
      tenantId,
      encounterId,
      patientId: patientRecord.id,
      patientMrn: patientRecord.mrn,
      workflowDefinitionId: CompiledGeneralOpdWorkflow.workflowId,
      workflowVersion: CompiledGeneralOpdWorkflow.version,
      currentStage: 'REGISTRATION',
      currentStageStatus: 'ACTIVE',
      currentStageStartedAt: timestamp,
      completedStages: [],
      totalDwellMinutes: 0,
      slaBreached: false,
      careTeam,
      transitionHistory: [
        {
          fromStage: 'REGISTRATION',
          toStage: 'REGISTRATION',
          transitionedAt: timestamp,
          userId: request.initiatorUserId,
          userName: request.initiatorUserName,
          reason: 'Initial Registration & Encounter Planning',
        },
      ],
      updatedAt: timestamp,
    };

    // 4. Initialize Registration Stage
    const stageId = `stage_reg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const initialStage: WorkflowRuntimeStage = {
      id: stageId,
      stageType: 'REGISTRATION',
      sequenceOrder: 1,
      status: 'ACTIVE',
      startedAt: timestamp,
      slaTargetMinutes: 8,
      slaExceeded: false,
      performedByUserId: request.initiatorUserId,
      performedByUserName: request.initiatorUserName,
      stageData: {
        patientId: patientRecord.id,
        mrn: patientRecord.mrn,
        fullName: patientRecord.fullName,
        dateOfBirth: patientRecord.dateOfBirth,
        contactNumber: patientRecord.phone,
        department,
        chiefComplaint: request.chiefComplaint,
        priority,
      },
      notes: 'Initial ambulatory patient intake initiated at front desk.',
    };

    // 5. Generate Clinic Queue Token
    const prefix = priority === 'EMERGENCY' ? 'E' : priority === 'URGENT' ? 'U' : 'A';
    const randomSeq = Math.floor(Math.random() * 80) + 10;
    const tokenNumber = `${prefix}-${randomSeq}`;
    const tokenId = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const tokenQueueItem = {
      id: tokenId,
      tokenNumber,
      patientId: patientRecord.id,
      patientName: patientRecord.fullName,
      mrn: patientRecord.mrn,
      department,
      assignedDoctor: careTeam.attendingPhysicianName,
      priority,
      status: 'waiting' as const,
      arrivalTime: timestamp,
      chiefComplaint: request.chiefComplaint,
    };

    // 6. Clinical Event Envelopes
    const producer = {
      service: 'ghims-encounter-planner',
      userId: request.initiatorUserId,
      userName: request.initiatorUserName,
      userRole: request.initiatorUserRole,
      ipAddress: request.clientIp || '127.0.0.1',
      facilityCode,
    };

    const patRegEvent = createPatientRegisteredEvent({
      tenantId,
      patientId: patientRecord.id,
      mrn: patientRecord.mrn,
      fullName: patientRecord.fullName,
      dob: patientRecord.dateOfBirth,
      gender: patientRecord.gender,
      contactNumber: patientRecord.phone,
      producer,
    });

    const encCreatedEvent = createEncounterCreatedEvent({
      tenantId,
      encounterId,
      patientId: patientRecord.id,
      patientMrn: patientRecord.mrn,
      encounterType,
      department,
      chiefComplaint: request.chiefComplaint,
      assignedDoctor: careTeam.attendingPhysicianName,
      tokenNumber,
      producer,
    });

    // 7. Transactional Outbox Events
    const outboxEvents: OutboxEventRecord[] = [
      createOutboxEventRecord({
        tenantId,
        destinationQueue: 'HL7_V2_BROKER',
        envelope: encCreatedEvent,
      }),
      createOutboxEventRecord({
        tenantId,
        destinationQueue: 'FHIR_SERVER',
        envelope: patRegEvent,
      }),
      createOutboxEventRecord({
        tenantId,
        destinationQueue: 'BILLING_SYSTEM',
        envelope: encCreatedEvent,
      }),
    ];

    // 8. Cryptographic HIPAA Audit Ledger Entry
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const action = 'CREATE';
    const resource = `encounter:${encounterId} | patient:${patientRecord.mrn}`;
    const auditDetails = `Encounter initialized for ${patientRecord.fullName} (${patientRecord.mrn}) in ${department}. Token: ${tokenNumber}`;
    const previousHash = '0000000000000000000000000000000000000000000000000000000000000000';

    const canonical = buildCanonicalAuditString(
      previousHash,
      tenantId,
      request.initiatorUserId,
      action,
      resource,
      timestamp,
      'SUCCESS',
      auditDetails
    );
    const hash = await calculateSha256(canonical);

    const auditEntry = {
      id: auditId,
      tenantId,
      userId: request.initiatorUserId,
      userName: request.initiatorUserName,
      userRole: request.initiatorUserRole,
      action,
      resource,
      ipAddress: request.clientIp || '127.0.0.1',
      userAgent: 'G-HIMS Clinical Runtime v1.2',
      timestamp,
      status: 'SUCCESS',
      severity: 'INFO',
      details: auditDetails,
      previousHash,
      hash,
      metadata: {
        encounterId,
        patientId: patientRecord.id,
        tokenNumber,
        department,
      },
    };

    return {
      patientRecord,
      encounterPlan,
      initialSnapshot,
      initialStage,
      tokenQueueItem,
      auditEntry,
      outboxEvents,
    };
  }
}
