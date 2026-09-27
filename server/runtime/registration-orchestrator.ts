import 'server-only';
import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
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
  patientId?: string;
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

function generateMRN(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = crypto.randomInt(1000, 10000);
  return `MRN-${yyyy}${mm}${dd}-${suffix}`;
}

function generateTokenNumber(): string {
  return `OPD-${crypto.randomInt(100, 1000)}`;
}

export async function registerPatientAndEncounter(
  params: RegisterPatientEncounterParams
): Promise<OrchestrationResult> {
  const db = getAdminFirestore();
  if (!db) throw new Error('TRANSACTION_STORE_UNAVAILABLE: Firebase Admin Firestore is required.');

  const now = Date.now();
  const tenantId = params.tenantId.trim().toLowerCase();
  const patientId = params.patientId || `pat_${crypto.randomUUID()}`;
  const encounterId = `enc_${crypto.randomUUID()}`;
  const mrn = generateMRN();
  const tokenNumber = generateTokenNumber();

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
    chiefComplaint: params.chiefComplaint || '',
    assignedDoctor: params.assignedDoctor || '',
    tokenNumber,
  };

  const workflowSnapshot = compileWorkflow(OPD_WORKFLOW_DEFINITION, encounterId);
  encounterRecord.workflowSnapshotId = workflowSnapshot.id;

  const timelineEventId = `tl_${crypto.randomUUID()}`;
  const timelineRecord: PatientTimelineProjection = {
    id: timelineEventId,
    patientId,
    tenantId,
    encounterId,
    title: 'Patient Registered & Encounter Initialized',
    summary: `Patient registered under MRN ${mrn}. Outpatient encounter started in ${encounterRecord.department} (Token ${tokenNumber}).`,
    category: 'REGISTRATION',
    timestamp: now,
    actorName: params.actorName,
    actorRole: params.actorRole,
    severity: 'NORMAL',
    metadata: {
      tokenNumber,
      department: encounterRecord.department,
      chiefComplaint: encounterRecord.chiefComplaint,
      initialStage: 'REGISTRATION',
    },
  };

  const outboxRecord: OutboxEventRecord = {
    id: `ob_${crypto.randomUUID()}`,
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

  const auditLogId = `aud_${crypto.randomUUID()}`;
  const auditLogEntry = {
    id: auditLogId,
    tenantId,
    timestamp: new Date(now).toISOString(),
    userId: params.actorId,
    userName: params.actorName,
    role: params.actorRole,
    action: 'PATIENT_REGISTERED_ENCOUNTER_INIT',
    resource: `patients/${patientId}`,
    status: 'SUCCESS',
    details: `Registered patient ${params.fullName} (${mrn}) with encounter ${encounterId}`,
  };

  await db.runTransaction(async (transaction) => {
    const patientRef = db.doc(patientDocPath(tenantId, patientId));
    const encounterRef = db.doc(encounterDocPath(tenantId, encounterId));
    const workflowRef = db.doc(workflowSnapshotDocPath(tenantId, encounterId, workflowSnapshot.id));
    const timelineRef = db.doc(timelineEventDocPath(tenantId, patientId, timelineEventId));
    const outboxRef = db.doc(outboxEventDocPath(tenantId, outboxRecord.id));
    const auditRef = db.doc(auditLogDocPath(tenantId, auditLogId));

    transaction.create(patientRef, sanitizeForFirestore(patientRecord));
    transaction.create(encounterRef, sanitizeForFirestore(encounterRecord));
    transaction.create(workflowRef, sanitizeForFirestore(workflowSnapshot));
    transaction.create(timelineRef, sanitizeForFirestore(timelineRecord));
    transaction.create(outboxRef, sanitizeForFirestore(outboxRecord));
    transaction.create(auditRef, sanitizeForFirestore(auditLogEntry));

    const primaryId = params.identifiers?.find((identifier) => identifier.type === 'CNIC') || params.identifiers?.[0];
    if (primaryId?.value) {
      const mpiKey = `${primaryId.type}_${primaryId.value}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const mpiRef = db.doc(mpiRegistryDocPath(tenantId, mpiKey));
      const existing = await transaction.get(mpiRef);
      if (existing.exists) {
        throw new Error('MPI_IDENTITY_CONFLICT: primary patient identifier already exists.');
      }
      transaction.create(mpiRef, sanitizeForFirestore({
        mpiKey,
        patientId,
        mrn,
        fullName: params.fullName,
        dateOfBirth: params.dateOfBirth,
        createdAt: new Date(now).toISOString(),
      }));
    }
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
