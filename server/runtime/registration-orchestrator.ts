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
import { activateCareContext, compatibilityEncounterId, normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import { EncounterRuntime, WorkflowSnapshot, EncounterType } from '@/types/encounter-runtime';
import { PatientTimelineProjection } from '@/types/patient-timeline';
import { OutboxEventRecord } from '@/types/clinical-event';
import type { AuditRecord, DomainEventEnvelope, OutboxRecord } from '@/lib/backend/types';
import { OPD_WORKFLOW_DEFINITION } from '@/lib/workflow/opd-definition';
import { compileWorkflow } from '@/lib/workflow/compiler';

const REGISTRATION_COMMAND_TYPE = 'RegisterPatientAndEncounterCommand';

const REGISTRATION_CONSENT_POLICY_VERSION = {
  GENERAL_OUTPATIENT: '2026.1',
  DATA_SHARING_HIE: '2026.1',
} as const;

export interface RegistrationConsentDecision {
  consentType: keyof typeof REGISTRATION_CONSENT_POLICY_VERSION;
  status: 'GRANTED' | 'WITHHELD';
  method: 'DIGITAL_ATTESTATION';
}

export interface AuthoritativeRegistrationConsent {
  consentId: string;
  tenantId: string;
  patientId: string;
  consentType: RegistrationConsentDecision['consentType'];
  status: RegistrationConsentDecision['status'];
  method: RegistrationConsentDecision['method'];
  policyVersion: string;
  capturedAt: number;
  capturedBy: string;
  source: 'OPD_REGISTRATION';
}

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
  facilityId: string;
  departmentId: string;
  department?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  chiefComplaint?: string;
  assignedDoctor?: string;
  actorId: string;
  actorRole: string;
  actorName: string;
  source?: DomainEventEnvelope['source'];
  bloodGroup?: string;
  allergies?: string[];
  chronicConditions?: string[];
  tariffPlan?: 'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE';
  insuranceDetails?: {
    payerName?: string;
    policyNumber?: string;
    memberId?: string;
  };
  consentDecisions?: RegistrationConsentDecision[];
}

export interface OrchestrationResult {
  success: boolean;
  patient: PatientMPI;
  encounter: EncounterRuntime;
  workflowSnapshot: WorkflowSnapshot;
  timelineEvent: PatientTimelineProjection;
  outboxEvent: OutboxEventRecord;
  consentRecords: AuthoritativeRegistrationConsent[];
  queueToken: {
    id: string;
    encounterId: string;
    patientId: string;
    patientName: string;
    mrn: string;
    tokenNumber: string;
    facilityId: string;
    departmentId: string;
    department: string;
    priority: string;
    status: 'payment_pending';
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
    facilityId: params.facilityId,
    departmentId: params.departmentId,
    department: params.department || params.departmentId || 'General Medicine',
    priority: params.priority || 'ROUTINE',
    chiefComplaint: params.chiefComplaint || '',
    assignedDoctor: params.assignedDoctor || '',
    bloodGroup: params.bloodGroup,
    allergies: params.allergies || [],
    chronicConditions: params.chronicConditions,
    tariffPlan: params.tariffPlan,
    insuranceDetails: params.insuranceDetails,
    consentDecisions: params.consentDecisions || [],
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
  const correlationId = `corr_${crypto.randomUUID()}`;
  const canonicalEventId = `evt_${crypto.randomUUID()}`;
  const canonicalOutboxId = `obx_${crypto.randomUUID()}`;

  const activeCareContexts = activateCareContext(undefined, normalizeCareSetting(params.encounterType || 'OPD'), encounterId, now);

  const uniqueConsentTypes = new Set(
    (params.consentDecisions || []).map((decision) => decision.consentType)
  );
  if (uniqueConsentTypes.size !== (params.consentDecisions || []).length) {
    throw new Error('DUPLICATE_CONSENT_DECISION: each registration consent type may appear only once.');
  }

  const consentRecords: AuthoritativeRegistrationConsent[] = (params.consentDecisions || []).map(
    (decision) => ({
      consentId: `consent_${crypto.randomUUID()}`,
      tenantId,
      patientId,
      consentType: decision.consentType,
      status: decision.status,
      method: decision.method,
      policyVersion: REGISTRATION_CONSENT_POLICY_VERSION[decision.consentType],
      capturedAt: now,
      capturedBy: params.actorId,
      source: 'OPD_REGISTRATION',
    })
  );

  const consentSummary = Object.fromEntries(
    consentRecords.map((record) => [
      record.consentType,
      {
        consentId: record.consentId,
        status: record.status,
        method: record.method,
        policyVersion: record.policyVersion,
        capturedAt: record.capturedAt,
      },
    ])
  ) as PatientMPI['consentSummary'];

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
    bloodGroup: params.bloodGroup || 'Unknown',
    allergies: params.allergies || [],
    ...(params.chronicConditions ? { chronicConditions: params.chronicConditions } : {}),
    ...(params.tariffPlan ? { tariffPlan: params.tariffPlan } : {}),
    ...(params.insuranceDetails ? { insuranceDetails: params.insuranceDetails } : {}),
    ...(consentRecords.length > 0 ? { consentSummary } : {}),
    createdAt: now,
    updatedAt: now,
    createdById: params.actorId,
    version: 1,
    status: 'ACTIVE',
    activeCareContexts,
    activeEncounterId: compatibilityEncounterId(activeCareContexts),
  };

  const encounterRecord: EncounterRuntime = {
    id: encounterId,
    encounterId,
    tenantId,
    patientId,
    type: params.encounterType || 'OPD',
    encounterType: params.encounterType || 'OPD',
    status: 'IN_PROGRESS',
    currentStageId: 'REGISTRATION',
    currentStage: 'REGISTERED',
    clinicalState: 'REGISTERED',
    operationalState: 'QUEUED',
    financialClearanceState:
      (params.encounterType || 'OPD') === 'EMERGENCY'
        ? 'NOT_REQUIRED'
        : 'CONSULTATION_PAYMENT_PENDING',
    resourceAssignmentState: 'NONE',
    workflowSnapshotId: '',
    startedAt: now,
    facilityId: params.facilityId,
    departmentId: params.departmentId,
    department: params.department || params.departmentId || 'General Medicine',
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
      facilityId: encounterRecord.facilityId,
      departmentId: encounterRecord.departmentId,
      department: encounterRecord.department,
      chiefComplaint: encounterRecord.chiefComplaint,
      initialStage: 'REGISTRATION',
    },
  };

  const canonicalEvent: DomainEventEnvelope = {
    eventId: canonicalEventId,
    tenantId,
    aggregateType: 'ENCOUNTER',
    aggregateId: encounterId,
    eventType: 'PATIENT_REGISTERED',
    eventVersion: 1,
    payload: {
      patientId,
      encounterId,
      mrn,
      encounterType: encounterRecord.type,
      department: encounterRecord.department,
      chiefComplaint: encounterRecord.chiefComplaint,
      priority: encounterRecord.priority,
      initialStage: encounterRecord.currentStageId,
      consentRecordIds: consentRecords.map((record) => record.consentId),
    },
    actorId: params.actorId,
    actorRole: params.actorRole,
    occurredAt: now,
    recordedAt: now,
    correlationId,
    commandId: params.commandId,
    idempotencyKey: params.idempotencyKey,
    source: params.source || 'web',
    schemaVersion: 1,
  };

  const canonicalOutbox: OutboxRecord = {
    outboxId: canonicalOutboxId,
    tenantId,
    eventId: canonicalEventId,
    eventType: canonicalEvent.eventType,
    topic: 'g-hims-clinical-events',
    payload: canonicalEvent.payload,
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: now,
    createdAt: now,
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
      facilityId: encounterRecord.facilityId,
      departmentId: encounterRecord.departmentId,
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
    facilityId: params.facilityId,
    departmentId: params.departmentId,
    department: encounterRecord.department || params.departmentId || 'General Medicine',
    priority: (params.priority || 'ROUTINE').toLowerCase(),
    status: 'payment_pending' as const,
    arrivalTime: new Date(now).toISOString(),
    createdAt: now,
  };

  const auditLogId = `aud_${crypto.randomUUID()}`;
  const auditDetails = `Registered patient ${params.fullName} (${mrn}) with encounter ${encounterId}`;
  const auditLogEntry: AuditRecord & {
    id: string;
    timestamp: string;
    userId: string;
    userName: string;
    role: string;
    resource: string;
    status: string;
    details: string;
  } = {
    id: auditLogId,
    auditId: auditLogId,
    tenantId,
    timestamp: new Date(now).toISOString(),
    userId: params.actorId,
    userName: params.actorName,
    role: params.actorRole,
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: 'PATIENT_REGISTERED_ENCOUNTER_INIT',
    resource: `patients/${patientId}`,
    resourceType: 'PATIENT',
    resourceId: patientId,
    status: 'SUCCESS',
    details: auditDetails,
    commandId: params.commandId,
    eventId: canonicalEventId,
    correlationId,
    occurredAt: now,
    recordedAt: now,
    reason: auditDetails,
    metadata: {
      encounterId,
      mrn,
    },
  };

  const result: OrchestrationResult = {
    success: true,
    patient: patientRecord,
    encounter: encounterRecord,
    workflowSnapshot,
    timelineEvent: timelineRecord,
    outboxEvent: outboxRecord,
    consentRecords,
    queueToken,
  };

  await db.runTransaction(async (transaction) => {
    const tenantRef = db.collection('tenants').doc(tenantId);
    const patientRef = db.doc(patientDocPath(tenantId, patientId));
    const encounterRef = db.doc(encounterDocPath(tenantId, encounterId));
    const workflowRef = db.doc(workflowSnapshotDocPath(tenantId, encounterId, workflowSnapshot.id));
    const timelineRef = db.doc(timelineEventDocPath(tenantId, patientId, timelineEventId));
    const outboxRef = db.doc(outboxEventDocPath(tenantId, outboxRecord.id));
    const auditRef = db.doc(auditLogDocPath(tenantId, auditLogId));
    const canonicalEventRef = tenantRef.collection('events').doc(canonicalEventId);
    const canonicalOutboxRef = tenantRef.collection('outbox').doc(canonicalOutboxId);
    const queueRef = tenantRef.collection('opd_queue').doc(queueToken.id);
    const consentRefs = consentRecords.map((record) => ({
      record,
      ref: tenantRef.collection('patientConsents').doc(record.consentId),
    }));
    const idempotencyRef = tenantRef
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
    transaction.create(canonicalEventRef, sanitizeForFirestore(canonicalEvent));
    transaction.create(canonicalOutboxRef, sanitizeForFirestore(canonicalOutbox));
    transaction.create(auditRef, sanitizeForFirestore(auditLogEntry));
    transaction.create(queueRef, sanitizeForFirestore(queueToken));
    for (const item of consentRefs) {
      transaction.create(item.ref, sanitizeForFirestore(item.record));
    }

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
        eventId: canonicalEventId,
        auditId: auditLogId,
        outboxId: canonicalOutboxId,
        data: result,
      },
      completedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      leaseExpiresAt: null,
    }), { merge: true });
  });

  return result;
}
