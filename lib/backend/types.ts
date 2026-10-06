/**
 * G-HIMS Master Backend Types
 * Definitive schemas for Commands, Contexts, Events, Outbox, Projections & Aggregates.
 */

export interface CommandContext {
  actorId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  /** Maximum minor-unit amount this actor may authorize for governed financial actions. */
  financialAuthorityMinorUnits?: number;
  departmentId?: string;
  departmentIds?: string[];
  facilityIds?: string[];
  verifiedCredentials?: string[];
  clinicalPrivileges?: string[];
  deviceId?: string;
  correlationId: string;
  causationEventId?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  isEmergencyOverride?: boolean;
  breakGlassGrantId?: string;
  breakGlassPatientId?: string;
  breakGlassEncounterId?: string;
}

export interface BaseCommand<TPayload = Record<string, unknown>> {
  commandId: string;
  idempotencyKey: string;
  tenantId: string;
  commandType: string;
  payload: TPayload;
  clientTimestamp?: number;
  schemaVersion: number;
}

export interface CommandResult<TData = unknown> {
  success: boolean;
  commandId: string;
  idempotencyKey: string;
  entityId?: string;
  eventType?: string;
  eventId?: string;
  auditId?: string;
  outboxId?: string;
  data?: TData;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  replayedFromCache?: boolean;
  /** Command was durably captured in the authenticated IndexedDB outbox for replay. */
  queuedOffline?: boolean;
}

export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: TPayload;
  actorId: string;
  actorRole: string;
  occurredAt: number;
  recordedAt: number;
  correlationId: string;
  causationEventId?: string;
  commandId: string;
  idempotencyKey: string;
  source: 'web' | 'mobile' | 'offline' | 'integration' | 'system';
  schemaVersion: number;
}

export interface AuditRecord {
  auditId: string;
  tenantId: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  commandId: string;
  eventId?: string;
  correlationId: string;
  occurredAt: number;
  recordedAt: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  oldValue?: unknown;
  newValue?: unknown;
}

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DEAD_LETTER';

export interface OutboxRecord {
  outboxId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  topic: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: number;
  publishedAt?: number;
  processingStartedAt?: number;
  leaseExpiresAt?: number;
  lastError?: string;
}

export interface IdempotencyRecord {
  tenantId: string;
  idempotencyKey: string;
  commandType: string;
  requestHash: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  result?: CommandResult;
  error?: string;
  createdAt: number;
  completedAt?: number;
  commandId?: string;
  leaseExpiresAt?: number;
  lastUpdatedAt?: number;
}

export type ConflictCategory =
  | 'SAFE_APPEND'
  | 'MERGEABLE'
  | 'STATE_CONFLICT'
  | 'SAFETY_CRITICAL'
  | 'FINANCIAL_CONFLICT';

export interface OfflineMutationItem {
  mutationId: string;
  occurredAt: number;
  commandType: string;
  collection: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  entityId?: string;
  schemaVersion: number;
  baseEntityVersion?: number;
  dependsOnMutationIds?: string[];
  vectorClock?: Record<string, number>;
  baseVectorClock?: Record<string, number>;
}

export interface OfflineSyncBatch {
  deviceId: string;
  tenantId: string;
  actorId: string;
  batchId: string;
  submittedAt: number;
  mutations: OfflineMutationItem[];
}

export interface SyncBatchResultItem {
  mutationId: string;
  status: 'accepted' | 'rejected' | 'conflict' | 'requires_review';
  conflictCategory?: ConflictCategory;
  serverEventId?: string;
  serverVersion?: number;
  vectorClock?: Record<string, number>;
  reason?: string;
  data?: unknown;
  entityMappings?: Array<{
    localId: string;
    canonicalId: string;
    entityType: string;
  }>;
}

export interface OfflineSyncResponse {
  batchId: string;
  tenantId: string;
  processedAt: number;
  summary: {
    total: number;
    accepted: number;
    conflicted: number;
    rejected: number;
  };
  results: SyncBatchResultItem[];
}
