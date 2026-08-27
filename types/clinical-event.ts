/**
 * Clinical Event Envelope Specification
 * Standardized schema for event-driven clinical workflow and immutable audit dispatch
 */

export interface ClinicalEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  eventType: string;
  producerModule: string;
  occurredAt: number;
  actorId: string;
  actorRole: string;
  actorName?: string;
  payload: T;
  schemaVersion: number;
  correlationId?: string;
}

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  destinationQueue: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'DISPATCHED' | 'FAILED';
  retryCount: number;
  maxRetries: number;
  scheduledFor: number;
  createdAt: number;
  dispatchedAt?: number;
  error?: string;
}
