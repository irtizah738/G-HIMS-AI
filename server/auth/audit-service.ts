/**
 * Server-authoritative authentication audit logging.
 *
 * Production-like runtimes fail closed when a successful authenticated action
 * cannot be durably audited. Pre-authentication failures may be global because
 * no tenant authority exists yet; they must never be assigned to a fake tenant.
 */
import { getAdminFirestore } from '@/server/firebase/admin';
import { AuthAuditEvent, AuthAuditEventType } from '@/lib/auth/auth-types';
import { hashString } from './session-service';
import { isProductionLikeRuntime } from '@/lib/runtime/runtime-mode';
import crypto from 'crypto';

export interface RecordAuthAuditParams {
  eventType: AuthAuditEventType;
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  deviceId?: string;
  requestId?: string;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const source = { ...(metadata || {}) };
  for (const key of Object.keys(source)) {
    if (/password|token|secret|private.?key|authorization|cookie/i.test(key)) {
      delete source[key];
    }
  }
  return source;
}

export async function logAuthEvent(params: RecordAuthAuditParams): Promise<AuthAuditEvent> {
  const db = getAdminFirestore();
  const timestamp = new Date().toISOString();
  const eventId = `audit_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  const auditRecord: AuthAuditEvent = {
    id: eventId,
    eventType: params.eventType,
    userId: params.userId ?? null,
    userEmail: params.userEmail ?? null,
    ...(params.tenantId ? { tenantId: params.tenantId.trim().toLowerCase() } : {}),
    sessionId: params.sessionId ?? null,
    deviceId: params.deviceId ?? null,
    requestId: params.requestId || `req_${crypto.randomUUID()}`,
    correlationId: params.correlationId || `corr_${crypto.randomUUID()}`,
    timestamp,
    ipHash: params.ip ? hashString(params.ip) : null,
    userAgentHash: params.userAgent ? hashString(params.userAgent) : null,
    reason: params.reason ?? null,
    metadata: sanitizeMetadata(params.metadata),
  };

  if (!db) {
    if (isProductionLikeRuntime()) {
      throw new Error('AUDIT_STORE_UNAVAILABLE: durable authentication audit storage is required.');
    }
    return auditRecord;
  }

  const globalLogRef = db.collection('auditLogs').doc(eventId);
  const globalRecord = {
    ...auditRecord,
    action: params.eventType,
    resource: auditRecord.tenantId ? `auth/tenant/${auditRecord.tenantId}` : 'auth/pre-tenant',
    status:
      params.eventType.includes('FAILURE') || params.eventType.includes('UNAUTHORIZED')
        ? 'FAILED'
        : 'SUCCESS',
    recordedAt: Date.now(),
  };

  try {
    const batch = db.batch();
    batch.create(globalLogRef, globalRecord);

    if (auditRecord.tenantId) {
      const tenantLogRef = db
        .collection('tenants')
        .doc(auditRecord.tenantId)
        .collection('audit_logs')
        .doc(eventId);
      batch.create(tenantLogRef, auditRecord);
    }

    await batch.commit();
  } catch (error) {
    if (isProductionLikeRuntime()) {
      throw new Error(
        'AUDIT_WRITE_FAILED: ' +
          (error instanceof Error ? error.message : 'authentication audit persistence failed')
      );
    }
    console.warn(
      'Audit log write notice:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return auditRecord;
}
