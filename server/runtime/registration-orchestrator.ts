import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { IdempotencyService } from '@/lib/backend/idempotency/idempotency-service';
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

const REGISTRATION_COMMAND_TYPE = 'RegisterPatientAndEncounterCommand';

export interface RegisterPatientEncounterParams {
  tenantId: string;
  commandId: string;
  idempotencyKey: string;
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
  queueToken: {
    id: string;
    encounterId: string;
    patientId: string;
    patientName: string;
    mrn: string;
    tokenNumber: string;
    department: string;
    priority: string;
    status: 'waiting';
    arrivalTime: string;
    createdAt: number;
  };
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

function registrationPayload(params: RegisterPatientEncounterParams): Record<string, unknown> {
  return {
    patientId: params.patientId,
    fullName: params.fullName,
    gender: params.gender,
    dateOfBirth: params.dateOfBirth,
    identifiers: params.identifiers,
    contactPhone: params.contactPhone,
    address: params.address,
    encounterType: params.encounterType || 'OPD',
    department: params.department || 'General Medicine',
    priority: params.priority || 'ROUTINE',
    chiefComplaint: params.chiefComplaint || '',
    assignedDoctor: params.assignedDoctor || '',
    bloodGroup: params.bloodGroup,
    allergies: params.allergies || [],
    chronicConditions: params.chronicConditions || [],
  };
}

export async function registerPatientAndEncounter(
  params: RegisterPatientEncounterParams
): Promise<OrchestrationResult> {
  const db = getAdminFirestore();
  if (!db) throw new Error('TRANSACTION_STORE_UNAVAILABLE: Firebase Admin Firestore is required.');

  const tenantId = params.tenantId.trim().toLowerCase();
  const requestPayload = registrationPayload(params);
  const requestHash = IdempotencyService.computeHash(REGISTRATION_COMMAND_TYPE, requestPayload);

  const reservation = await IdempotencyService.acquireExecution(
    tenantId,
    params.idempotencyKey,
    REGISTRATION_COMMAND_TYPE,
    requestPayload,
    params.commandId
  );

  if (reservation.status === 'CACHED' && reservation.record?.result?.data) {
    return reservation.record.result.data as OrchestrationResult;
  }
  if (reservation.status === 'CONFLICT') {
    throw new Error('IDEMPOTENCY_KEY_CONFLICT: registration key was reused with a different request.');
  }
  if (reservation.status === 'IN_PROGRESS') {
    throw new Error('IDEMPOTENCY_IN_PROGRESS: registration request is already executing.');
  }

  const now = Date.now();
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

  const queueToken = {
    id: `opd_${encounterId}`,
    encounterId,
    patientId,
    patientName: params.fullName,
    mrn,
    tokenNumber,
    department: encounterRecord.department || 'General Medicine',
    priority: (params.priority || 'ROUTINE').toLowerCase(),
    status: 'waiting' as const,
    arrivalTime: new Date(now).toISOString(),
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

  const result: OrchestrationResult = {
    success: true,
    patient: patientRecord,
    encounter: encounterRecord,
    workflowSnapshot,
    timelineEvent: timelineRecord,
    outboxEvent: outboxRecord,
    queueToken,
  };

  await db.runTransaction(async (transaction) => {
    const patientRef = db.doc(patientDocPath(tenantId, patientId));
    const encounterRef = db.doc(encounterDocPath(tenantId, encounterId));
    const workflowRef = db.doc(workflowSnapshotDocPath(tenantId, encounterId, workflowSnapshot.id));
    const timelineRef = db.doc(timelineEventDocPath(tenantId, patientId, timelineEventId));
    const outboxRef = db.doc(outboxEventDocPath(tenantId, outboxRecord.id));
    const auditRef = db.doc(auditLogDocPath(tenantId, auditLogId));
    const queueRef = db.collection('tenants').doc(tenantId).collection('opd_queue').doc(queueToken.id);
    const idempotencyRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('idempotency')
      .doc(IdempotencyService.getDocumentId(params.idempotencyKey));

    const primaryId = params.identifiers?.find((identifier) => identifier.type === 'CNIC') || params.identifiers?.[0];
    const mpiKey = primaryId?.value
      ? `${primaryId.type}_${primaryId.value}`.replace(/[^a-zA-Z0-9_]/g, '_')
      : null;
    const mpiRef = mpiKey ? db.doc(mpiRegistryDocPath(tenantId, mpiKey)) : null;

    // Firestore requires transaction reads before writes.
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    const mpiSnapshot = mpiRef ? await transaction.get(mpiRef) : null;

    if (!idempotencySnapshot.exists) {
      throw new Error('IDEMPOTENCY_RESERVATION_MISSING');
    }

    const idempotencyData = idempotencySnapshot.data() as {
      status?: string;
      commandId?: string;
      requestHash?: string;
      commandType?: string;
    };

    if (
      idempotencyData.status !== 'PENDING' ||
      idempotencyData.commandId !== params.commandId ||
      idempotencyData.requestHash !== requestHash ||
      idempotencyData.commandType !== REGISTRATION_COMMAND_TYPE
    ) {
      throw new Error('IDEMPOTENCY_RESERVATION_INVALID');
    }

    if (mpiSnapshot?.exists) {
      throw new Error('MPI_IDENTITY_CONFLICT: primary patient identifier already exists.');
    }

    transaction.create(patientRef, sanitizeForFirestore(patientRecord));
    transaction.create(encounterRef, sanitizeForFirestore(encounterRecord));
    transaction.create(workflowRef, sanitizeForFirestore(workflowSnapshot));
    transaction.create(timelineRef, sanitizeForFirestore(timelineRecord));
    transaction.create(outboxRef, sanitizeForFirestore(outboxRecord));
    transaction.create(auditRef, sanitizeForFirestore(auditLogEntry));
    transaction.create(queueRef, sanitizeForFirestore(queueToken));

    if (mpiRef && mpiKey) {
      transaction.create(mpiRef, sanitizeForFirestore({
        mpiKey,
        patientId,
        mrn,
        fullName: params.fullName,
        dateOfBirth: params.dateOfBirth,
        createdAt: new Date(now).toISOString(),
      }));
    }

    transaction.set(idempotencyRef, sanitizeForFirestore({
      ...idempotencyData,
      status: 'COMPLETED',
      result: {
        success: true,
        commandId: params.commandId,
        idempotencyKey: params.idempotencyKey,
        entityId: patientId,
        data: result,
      },
      completedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      leaseExpiresAt: null,
    }), { merge: true });
  });

  return result;
}
