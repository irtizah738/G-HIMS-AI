/**
 * G-HIMS Master Transaction Manager
 * Production path atomically persists Domain State + Immutable Event + Audit + Outbox.
 */

import { DomainEventEnvelope, AuditRecord, OutboxRecord, CommandContext } from '../types';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { IdempotencyService } from '../idempotency/idempotency-service';

export interface TransactionPayload<TState = unknown> {
  entityType: string;
  entityId: string;
  eventType: string;
  domainState: TState;
  eventPayload: Record<string, unknown>;
  auditReason?: string;
  auditMetadata?: Record<string, unknown>;
  outboxTopic?: string;
}

export interface CommittedTransaction<TState = unknown> {
  success: boolean;
  entityId: string;
  domainState: TState;
  event: DomainEventEnvelope;
  audit: AuditRecord;
  outbox: OutboxRecord;
  committedAt: number;
}

export interface AdditionalStateWrite {
  entityType: string;
  entityId: string;
  domainState: unknown;
}

export interface AtomicMutationParams {
  tenantId: string;
  actorId: string;
  actorRole: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  auditAction?: string;
  auditResourceType?: string;
  auditResourceId?: string;
  auditReason?: string;
  auditMetadata?: Record<string, unknown>;
  outboxTopic?: string;
  idempotencyKey?: string;
  commandId?: string;
  correlationId?: string;
  domainState?: unknown;
  additionalStateWrites?: AdditionalStateWrite[];
  /** @deprecated State must be represented by domainState/additionalStateWrites. */
  stateWrite?: () => Promise<void> | void;
}

export interface AtomicMutationResult {
  success: boolean;
  eventId: string;
  auditId: string;
  outboxId: string;
  committedAt: number;
}

function generateUuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function canUseEphemeralPersistence(): boolean {
  const mode = getRuntimeMode();
  return mode === 'DEMO' || mode === 'TEST';
}

function collectionForEntityType(entityType: string): string {
  const map: Record<string, string> = {
    ENCOUNTER: 'encounters',
    ENCOUNTER_STAGE: 'encounterStages',
    DIAGNOSTIC_ORDER: 'orders',
    PRESCRIPTION: 'prescriptions',
    JOURNAL_ENTRY: 'journalEntries',
    EMPLOYEE_MASTER: 'employees',
    EMPLOYEE_CREDENTIAL: 'clinicalCredentials',
    CLINICAL_PRIVILEGE: 'clinicalPrivileges',
    ROSTER_SHIFT: 'rosterAssignments',
    ATTENDANCE_RECORD: 'attendanceRecords',
    LEAVE_REQUEST: 'leaveRequests',
    RESOURCE_MASTER: 'resources',
    HOSPITAL_ROOM: 'rooms',
    RESOURCE_RESERVATION: 'resourceReservations',
    MAINTENANCE_WORK_ORDER: 'maintenanceWorkOrders',
    CALIBRATION_RECORD: 'calibrationRecords',
    PATIENT_MPI: 'patients',
    PATIENT_SAFETY: 'patients',
  };

  const collection = map[entityType];
  if (!collection) throw new Error(`UNMAPPED_DOMAIN_ENTITY_TYPE: ${entityType}`);
  return collection;
}

export class TransactionManager {
  private static inMemoryEventStore: DomainEventEnvelope[] = [];
  private static inMemoryAuditStore: AuditRecord[] = [];
  private static inMemoryOutboxStore: OutboxRecord[] = [];

  private static buildRecords(params: {
    tenantId: string;
    actorId: string;
    actorRole: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    auditAction?: string;
    auditResourceType?: string;
    auditResourceId?: string;
    auditReason?: string;
    auditMetadata?: Record<string, unknown>;
    outboxTopic?: string;
    idempotencyKey: string;
    commandId: string;
    correlationId: string;
    domainState?: unknown;
  }) {
    const timestamp = Date.now();
    const eventId = generateUuid('evt');
    const auditId = generateUuid('aud');
    const outboxId = generateUuid('obx');

    const event: DomainEventEnvelope = {
      eventId,
      tenantId: params.tenantId,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      eventVersion: 1,
      payload: params.eventPayload,
      actorId: params.actorId,
      actorRole: params.actorRole,
      occurredAt: timestamp,
      recordedAt: timestamp,
      correlationId: params.correlationId,
      commandId: params.commandId,
      idempotencyKey: params.idempotencyKey,
      source: 'web',
      schemaVersion: 1,
    };

    const audit: AuditRecord = {
      auditId,
      tenantId: params.tenantId,
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.auditAction || params.eventType,
      resourceType: params.auditResourceType || params.aggregateType,
      resourceId: params.auditResourceId || params.aggregateId,
      commandId: params.commandId,
      eventId,
      correlationId: params.correlationId,
      occurredAt: timestamp,
      recordedAt: timestamp,
      reason: params.auditReason || `Executed ${params.eventType}`,
      metadata: params.auditMetadata || {},
      ...(params.domainState !== undefined ? { newValue: params.domainState } : {}),
    };

    const outbox: OutboxRecord = {
      outboxId,
      tenantId: params.tenantId,
      eventId,
      eventType: params.eventType,
      topic: params.outboxTopic || 'g-hims-domain-events',
      payload: params.eventPayload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: timestamp,
      createdAt: timestamp,
    };

    return { timestamp, event, audit, outbox };
  }

  public static async executeAtomicMutation(params: AtomicMutationParams): Promise<AtomicMutationResult> {
    const correlationId = params.correlationId || generateUuid('corr');
    const commandId = params.commandId || generateUuid('cmd');
    const idempotencyKey = params.idempotencyKey || generateUuid('idemp');
    const { timestamp, event, audit, outbox } = this.buildRecords({
      ...params,
      correlationId,
      commandId,
      idempotencyKey,
    });

    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) {
        throw new Error('TRANSACTION_STORE_UNAVAILABLE: durable Firestore transaction store is required.');
      }
      if (params.stateWrite) await params.stateWrite();
      this.inMemoryEventStore.push(event);
      this.inMemoryAuditStore.push(audit);
      this.inMemoryOutboxStore.push(outbox);
      return { success: true, eventId: event.eventId, auditId: audit.auditId, outboxId: outbox.outboxId, committedAt: timestamp };
    }

    const tenantRef = db.collection('tenants').doc(params.tenantId);
    const eventRef = tenantRef.collection('events').doc(event.eventId);
    const auditRef = tenantRef.collection('audit_logs').doc(audit.auditId);
    const outboxRef = tenantRef.collection('outbox').doc(outbox.outboxId);

    await db.runTransaction(async (transaction) => {
      if (params.domainState !== undefined) {
        const stateRef = tenantRef.collection(collectionForEntityType(params.aggregateType)).doc(params.aggregateId);
        transaction.set(stateRef, sanitizeForFirestore(params.domainState), { merge: true });
      }

      for (const write of params.additionalStateWrites || []) {
        const stateRef = tenantRef.collection(collectionForEntityType(write.entityType)).doc(write.entityId);
        transaction.set(stateRef, sanitizeForFirestore(write.domainState), { merge: true });
      }

      transaction.create(eventRef, sanitizeForFirestore(event));
      transaction.create(auditRef, sanitizeForFirestore(audit));
      transaction.create(outboxRef, sanitizeForFirestore(outbox));
    });

    return { success: true, eventId: event.eventId, auditId: audit.auditId, outboxId: outbox.outboxId, committedAt: timestamp };
  }

  public static async executeAtomicWrite<TState = unknown>(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransactionPayload<TState>
  ): Promise<CommittedTransaction<TState>> {
    const { timestamp, event, audit, outbox } = this.buildRecords({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: payload.entityType,
      aggregateId: payload.entityId,
      eventType: payload.eventType,
      eventPayload: payload.eventPayload,
      auditReason: payload.auditReason,
      auditMetadata: payload.auditMetadata,
      outboxTopic: payload.outboxTopic,
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: payload.domainState,
    });

    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) {
        throw new Error('TRANSACTION_STORE_UNAVAILABLE: durable Firestore transaction store is required.');
      }
      this.inMemoryEventStore.push(event);
      this.inMemoryAuditStore.push(audit);
      this.inMemoryOutboxStore.push(outbox);
      return { success: true, entityId: payload.entityId, domainState: payload.domainState, event, audit, outbox, committedAt: timestamp };
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const stateRef = tenantRef.collection(collectionForEntityType(payload.entityType)).doc(payload.entityId);
    const eventRef = tenantRef.collection('events').doc(event.eventId);
    const auditRef = tenantRef.collection('audit_logs').doc(audit.auditId);
    const outboxRef = tenantRef.collection('outbox').doc(outbox.outboxId);
    const idempotencyRef = tenantRef.collection('idempotency').doc(IdempotencyService.getDocumentId(idempotencyKey));

    await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);

      transaction.set(stateRef, sanitizeForFirestore(payload.domainState), { merge: true });
      transaction.create(eventRef, sanitizeForFirestore(event));
      transaction.create(auditRef, sanitizeForFirestore(audit));
      transaction.create(outboxRef, sanitizeForFirestore(outbox));

      if (idempotencySnapshot.exists) {
        transaction.set(idempotencyRef, sanitizeForFirestore({
          ...idempotencySnapshot.data(),
          status: 'COMPLETED',
          completedAt: timestamp,
          result: {
            success: true,
            commandId,
            idempotencyKey,
            entityId: payload.entityId,
            eventType: payload.eventType,
            eventId: event.eventId,
            auditId: audit.auditId,
            outboxId: outbox.outboxId,
          },
        }), { merge: true });
      }
    });

    return { success: true, entityId: payload.entityId, domainState: payload.domainState, event, audit, outbox, committedAt: timestamp };
  }

  public static async getEvents(tenantId: string): Promise<DomainEventEnvelope[]> {
    const db = getAdminFirestore();
    if (!db) {
      return canUseEphemeralPersistence() ? this.inMemoryEventStore.filter((event) => event.tenantId === tenantId) : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('events').orderBy('recordedAt', 'asc').get();
    return snapshot.docs.map((doc) => doc.data() as DomainEventEnvelope);
  }

  public static async getAudits(tenantId: string): Promise<AuditRecord[]> {
    const db = getAdminFirestore();
    if (!db) {
      return canUseEphemeralPersistence() ? this.inMemoryAuditStore.filter((audit) => audit.tenantId === tenantId) : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('audit_logs').orderBy('recordedAt', 'asc').get();
    return snapshot.docs.map((doc) => doc.data() as AuditRecord);
  }

  public static async getPendingOutbox(tenantId: string): Promise<OutboxRecord[]> {
    const db = getAdminFirestore();
    if (!db) {
      return canUseEphemeralPersistence()
        ? this.inMemoryOutboxStore.filter((record) =>
            record.tenantId === tenantId &&
            (record.status === 'PENDING' || record.status === 'FAILED') &&
            record.nextAttemptAt <= Date.now()
          )
        : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('outbox')
      .where('status', 'in', ['PENDING', 'FAILED']).limit(100).get();

    return snapshot.docs
      .map((doc) => doc.data() as OutboxRecord)
      .filter((record) => record.nextAttemptAt <= Date.now());
  }

  public static async updateOutbox(
    tenantId: string,
    outboxId: string,
    patch: Partial<OutboxRecord>
  ): Promise<void> {
    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) throw new Error('TRANSACTION_STORE_UNAVAILABLE');
      const item = this.inMemoryOutboxStore.find((record) => record.outboxId === outboxId);
      if (item) Object.assign(item, patch);
      return;
    }

    await db.collection('tenants').doc(tenantId).collection('outbox').doc(outboxId)
      .set(sanitizeForFirestore(patch), { merge: true });
  }
}
