/**
 * G-HIMS Master Security & Authentication Audit Logging Engine
 * Immutable, tenant-isolated HIPAA audit trails
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { AuthAuditEvent, AuthAuditEventType } from '@/lib/auth/auth-types';
import { hashString } from './session-service';
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

export async function logAuthEvent(params: RecordAuthAuditParams): Promise<AuthAuditEvent> {
  const db = getAdminFirestore();
  const now = new Date().toISOString();
  const eventId = `audit_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  // Sanitize metadata
  const sanitizedMeta = { ...(params.metadata || {}) };
  delete sanitizedMeta.password;
  delete sanitizedMeta.token;
  delete sanitizedMeta.idToken;

  const auditRecord: AuthAuditEvent = {
    id: eventId,
    eventType: params.eventType,
    userId: params.userId ?? null,
    userEmail: params.userEmail ?? null,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    sessionId: params.sessionId ?? null,
    deviceId: params.deviceId ?? null,
    requestId: params.requestId || `req_${Date.now().toString(36)}`,
    correlationId: params.correlationId || `corr_${Date.now().toString(36)}`,
    timestamp: now,
    ipHash: params.ip ? hashString(params.ip) : null,
    userAgentHash: params.userAgent ? hashString(params.userAgent) : null,
    reason: params.reason ?? null,
    metadata: sanitizedMeta,
  };

  if (!db) {
    return auditRecord;
  }

  try {
    const tenantId = auditRecord.tenantId;

    const globalLogRef = db.collection('auditLogs').doc(eventId);
    const batch = db.batch();

    if (tenantId) {
      const tenantLogRef = db.collection('tenants').doc(tenantId).collection('audit_logs').doc(eventId);
      batch.set(tenantLogRef, auditRecord);
    }

    // Authentication failures that occur before tenant resolution are deliberately
    // recorded only in the server-owned global security stream; they are never
    // attributed to a fabricated default hospital.
    batch.set(globalLogRef, {
      ...auditRecord,
      action: params.eventType,
      resource: tenantId ? `auth/tenant/${tenantId}` : 'auth/unscoped',
      status: params.eventType.includes('FAILURE') || params.eventType.includes('UNAUTHORIZED') ? 'FAILED' : 'SUCCESS',
    });

    await batch.commit();
  } catch (err) {
    // Keep audit service resilient if offline or during provisioning
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Audit log write notice:', err instanceof Error ? err.message : String(err));
    }
  }

  return auditRecord;
}