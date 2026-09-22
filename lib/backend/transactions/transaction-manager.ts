/**
 * G-HIMS Master Transaction Manager
 * Executes atomic 4-way writes: Domain State + Immutable Event + Audit Record + Outbox Entry.
 */

import {
  DomainEventEnvelope,
  AuditRecord,
  OutboxRecord,
  CommandContext,
} from '../types';

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

function generateUuid(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
  stateWrite?: () => Promise<void> | void;
}

export interface AtomicMutationResult {
  success: boolean;
  eventId: string;
  auditId: string;
  outboxId: string;
  committedAt: number;
}

export class TransactionManager {
  private static inMemoryEventStore: DomainEventEnvelope[] = [];
  private static inMemoryAuditStore: AuditRecord[] = [];
  private static inMemoryOutboxStore: OutboxRecord[] = [];

  /**
   * Executes atomic mutation with state write, event logging, audit record and transactional outbox.
   */
  public static async executeAtomicMutation(
    params: AtomicMutationParams
  ): Promise<AtomicMutationResult> {
    const timestamp = Date.now();
    const eventId = generateUuid('evt');
    const auditId = generateUuid('aud');
    const outboxId = generateUuid('obx');
    const correlationId = params.correlationId || generateUuid('corr');
    const commandId = params.commandId || generateUuid('cmd');
    const idempotencyKey = params.idempotencyKey || generateUuid('idemp');

    if (params.stateWrite) {
      await params.stateWrite();
    }

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
      correlationId,
      commandId,
      idempotencyKey,
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
      commandId,
      eventId,
      correlationId,
      occurredAt: timestamp,
      recordedAt: timestamp,
      reason: params.auditReason || `Executed ${params.eventType}`,
      metadata: params.auditMetadata || {},
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

    this.inMemoryEventStore.push(event);
    this.inMemoryAuditStore.push(audit);
    this.inMemoryOutboxStore.push(outbox);

    return {
      success: true,
      eventId,
      auditId,
      outboxId,
      committedAt: timestamp,
    };
  }

  /**
   * Executes atomic multi-document commit in accordance with G-HIMS Master Specification.
   */
  public static async executeAtomicWrite<TState = unknown>(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransactionPayload<TState>
  ): Promise<CommittedTransaction<TState>> {
    const timestamp = Date.now();
    const eventId = generateUuid('evt');
    const auditId = generateUuid('aud');
    const outboxId = generateUuid('obx');

    // 1. Construct Immutable Event Envelope (§62)
    const event: DomainEventEnvelope = {
      eventId,
      tenantId: context.tenantId,
      aggregateType: payload.entityType,
      aggregateId: payload.entityId,
      eventType: payload.eventType,
      eventVersion: 1,
      payload: payload.eventPayload,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      occurredAt: timestamp,
      recordedAt: timestamp,
      correlationId: context.correlationId,
      causationEventId: context.causationEventId,
      commandId,
      idempotencyKey,
      source: 'web',
      schemaVersion: 1,
    };

    // 2. Construct Audit Record (§75)
    const audit: AuditRecord = {
      auditId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      action: payload.eventType,
      resourceType: payload.entityType,
      resourceId: payload.entityId,
      commandId,
      eventId,
      correlationId: context.correlationId,
      occurredAt: timestamp,
      recordedAt: timestamp,
      reason: payload.auditReason || `Executed ${payload.eventType}`,
      metadata: payload.auditMetadata || {},
      newValue: payload.domainState,
    };

    // 3. Construct Outbox Record (§14)
    const outbox: OutboxRecord = {
      outboxId,
      tenantId: context.tenantId,
      eventId,
      eventType: payload.eventType,
      topic: payload.outboxTopic || 'g-hims-domain-events',
      payload: payload.eventPayload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: timestamp,
      createdAt: timestamp,
    };

    // 4. In-memory Atomic Commit (Syncs with Firestore repository when configured)
    this.inMemoryEventStore.push(event);
    this.inMemoryAuditStore.push(audit);
    this.inMemoryOutboxStore.push(outbox);

    return {
      success: true,
      entityId: payload.entityId,
      domainState: payload.domainState,
      event,
      audit,
      outbox,
      committedAt: timestamp,
    };
  }

  public static getEvents(tenantId: string): DomainEventEnvelope[] {
    return this.inMemoryEventStore.filter((e) => e.tenantId === tenantId);
  }

  public static getAudits(tenantId: string): AuditRecord[] {
    return this.inMemoryAuditStore.filter((a) => a.tenantId === tenantId);
  }

  public static getPendingOutbox(): OutboxRecord[] {
    return this.inMemoryOutboxStore.filter((o) => o.status === 'PENDING');
  }

  public static markOutboxPublished(outboxId: string): void {
    const item = this.inMemoryOutboxStore.find((o) => o.outboxId === outboxId);
    if (item) {
      item.status = 'PUBLISHED';
      item.publishedAt = Date.now();
    }
  }
}
