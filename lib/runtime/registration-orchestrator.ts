import {
  doc,
  runTransaction,
  Firestore,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import {
  patientDocPath,
  encounterDocPath,
  workflowSnapshotDocPath,
  timelineEventDocPath,
  auditLogDocPath,
  outboxEventDocPath,
  mpiRegistryDocPath,
} from '@/lib/firestore/paths';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { PatientMPI, PatientIdentifier } from '@/types/mpi';
import { EncounterRuntime, WorkflowSnapshot, EncounterType } from '@/types/encounter-runtime';
import { PatientTimelineProjection } from '@/types/patient-timeline';
import { OutboxEventRecord } from '@/types/clinical-event';
import { OPD_WORKFLOW_DEFINITION } from '@/lib/workflow/opd-definition';
import { compileWorkflow } from '@/lib/workflow/compiler';

export interface RegisterPatientEncounterParams {
  tenantId: string;
  patientId?: string; // Optional: If existing patient
  fullName: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  dateOfBirth: string;
  identifiers: PatientIdentifier[];
  contactPhone: string;
  address: string;
  encounterType?: EncounterType;
  department?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  chiefComplaint?: string;
  assignedDoctor?: string;
  actorId: string;
  actorRole: string;
  actorName: string;
  bloodGroup?: string;
  allergies?: string[];
  chronicConditions?: string[];
}

export interface OrchestrationResult {
  success: boolean;
  patient: PatientMPI;
  encounter: EncounterRuntime;
  workflowSnapshot: WorkflowSnapshot;
  timelineEvent: PatientTimelineProjection;
  outboxEvent: OutboxEventRecord;
}

/**
 * Generates standard deterministic MRN format: MRN-YYYYMMDD-XXXX
 */
export function generateMRN(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MRN-${yyyy}${mm}${dd}-${rand}`;
}

/**
 * Generates an OPD token string: OPD-XXX
 */
export function generateTokenNumber(): string {
  const num = Math.floor(100 + Math.random() * 900);
  return `OPD-${num}`;
}

/**
 * Executes an atomic multi-document transaction for clinical registration and workflow initialization
 */
export async function registerPatientAndEncounter(
  params: RegisterPatientEncounterParams,
  firestoreInstance: Firestore = db
): Promise<OrchestrationResult> {
  const now = Date.now();
  const tenantId = params.tenantId || 'metro_general';
  const patientId = params.patientId || `pat_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const encounterId = `enc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const mrn = generateMRN();
  const tokenNumber = generateTokenNumber();

  // 1. Prepare Patient MPI Record
  const patientRecord: PatientMPI = {
    id: patientId,
    tenantId,
    mrn,
    fullName: params.fullName,
    gender: params.gender,
    dateOfBirth: params.dateOfBirth,
    identifiers: params.identifiers || [],
    contactPhone: params.contactPhone,
    address: params.address,
    bloodGroup: params.bloodGroup || 'O+',
    allergies: params.allergies || [],
    chronicConditions: params.chronicConditions || [],
    createdAt: now,
    updatedAt: now,
    createdById: params.actorId,
    version: 1,
  };

  // 2. Prepare Encounter Runtime Record
  const encounterRecord: EncounterRuntime = {
    id: encounterId,
    tenantId,
    patientId,
    type: params.encounterType || 'OPD',
    status: 'IN_PROGRESS',
    currentStageId: 'REGISTRATION',
    workflowSnapshotId: '',
    startedAt: now,
    department: params.department || 'General Medicine',
    priority: params.priority || 'ROUTINE',
    chiefComplaint: params.chiefComplaint || 'General consultation & health check',
    assignedDoctor: params.assignedDoctor || 'Dr. Sarah Al-Mansoor, MD',
    tokenNumber,
  };

  // 3. Compile Workflow Snapshot
  const workflowSnapshot = compileWorkflow(OPD_WORKFLOW_DEFINITION, encounterId);
  encounterRecord.workflowSnapshotId = workflowSnapshot.id;

  // 4. Prepare Longitudinal Timeline Projection
  const timelineEventId = `tl_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const timelineRecord: PatientTimelineProjection = {
    id: timelineEventId,
    patientId,
    tenantId,
    encounterId,
    title: 'Patient Registered & Encounter Initialized',
    summary: `Patient registered under MRN ${mrn}. Outpatient encounter started in ${encounterRecord.department} (Token ${tokenNumber}).`,
    category: 'REGISTRATION',
    timestamp: now,
    actorName: params.actorName || 'Reception Desk Staff',
    actorRole: params.actorRole || 'receptionist',
    severity: 'NORMAL',
    metadata: {
      tokenNumber,
      department: encounterRecord.department,
      chiefComplaint: encounterRecord.chiefComplaint,
      initialStage: 'REGISTRATION',
    },
  };

  // 5. Prepare Transactional Outbox Event (HL7 v2 ADT^A04 registration message)
  const outboxEventId = `ob_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const outboxRecord: OutboxEventRecord = {
    id: outboxEventId,
    tenantId,
    destinationQueue: 'clinical_hl7_queue',
    eventType: 'PATIENT_REGISTERED',
    aggregateType: 'ENCOUNTER',
    aggregateId: encounterId,
    payload: {
      messageType: 'ADT^A04',
      patientId,
      mrn,
      patientName: params.fullName,
      gender: params.gender,
      dateOfBirth: params.dateOfBirth,
      encounterId,
      department: encounterRecord.department,
      timestamp: new Date(now).toISOString(),
    },
    status: 'PENDING',
    retryCount: 0,
    maxRetries: 5,
    scheduledFor: now,
    createdAt: now,
  };

  // 6. Prepare Immutable Audit Log Entry
  const auditLogId = `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const auditLogEntry = {
    id: auditLogId,
    timestamp: new Date(now).toISOString(),
    userId: params.actorId,
    userName: params.actorName,
    role: params.actorRole,
    action: 'PATIENT_REGISTERED_ENCOUNTER_INIT',
    resource: `patients/${patientId}`,
    ipAddress: '127.0.0.1',
    status: 'SUCCESS',
    details: `Registered patient ${params.fullName} (${mrn}) with encounter ${encounterId}`,
  };

  // Reference Document Paths
  const patientDocRef = doc(firestoreInstance, patientDocPath(tenantId, patientId));
  const encounterDocRef = doc(firestoreInstance, encounterDocPath(tenantId, encounterId));
  const workflowDocRef = doc(firestoreInstance, workflowSnapshotDocPath(tenantId, encounterId, workflowSnapshot.id));
  const timelineDocRef = doc(firestoreInstance, timelineEventDocPath(tenantId, patientId, timelineEventId));
  const outboxDocRef = doc(firestoreInstance, outboxEventDocPath(tenantId, outboxEventId));
  const auditDocRef = doc(firestoreInstance, auditLogDocPath(tenantId, auditLogId));

  // Execute Atomic Transaction
  await runTransaction(firestoreInstance, async (transaction) => {
    // Write Patient MPI
    transaction.set(patientDocRef, sanitizeForFirestore(patientRecord));

    // Optional primary identifier MPI key mapping for deduplication
    const primaryId = params.identifiers?.find((i) => i.type === 'CNIC') || params.identifiers?.[0];
    if (primaryId && primaryId.value) {
      const mpiKey = `${primaryId.type}_${primaryId.value}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const mpiKeyRef = doc(firestoreInstance, mpiRegistryDocPath(tenantId, mpiKey));
      transaction.set(mpiKeyRef, sanitizeForFirestore({
        mpiKey,
        patientId,
        mrn,
        fullName: params.fullName,
        dateOfBirth: params.dateOfBirth,
        createdAt: new Date(now).toISOString(),
      }));
    }

    // Write Encounter Runtime
    transaction.set(encounterDocRef, sanitizeForFirestore(encounterRecord));

    // Write Initial Workflow Snapshot
    transaction.set(workflowDocRef, sanitizeForFirestore(workflowSnapshot));

    // Write Initial Timeline Event
    transaction.set(timelineDocRef, sanitizeForFirestore(timelineRecord));

    // Write Outbox Dispatch Record
    transaction.set(outboxDocRef, sanitizeForFirestore(outboxRecord));

    // Write Audit Log
    transaction.set(auditDocRef, sanitizeForFirestore(auditLogEntry));
  });

  return {
    success: true,
    patient: patientRecord,
    encounter: encounterRecord,
    workflowSnapshot,
    timelineEvent: timelineRecord,
    outboxEvent: outboxRecord,
  };
}
