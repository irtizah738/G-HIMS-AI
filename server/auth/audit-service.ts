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
  const sanitizedMeta = { ...params.metadata };
  delete sanitizedMeta.password;
  delete sanitizedMeta.token;
  delete sanitizedMeta.idToken;

  const auditRecord: AuthAuditEvent = {
    id: eventId,
    eventType: params.eventType,
    userId: params.userId,
    userEmail: params.userEmail,
    tenantId: params.tenantId || 'central-metro-hospital',
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    requestId: params.requestId || `req_${Date.now().toString(36)}`,
    correlationId: params.correlationId || `corr_${Date.now().toString(36)}`,
    timestamp: now,
    ipHash: hashString(params.ip),
    userAgentHash: hashString(params.userAgent),
    reason: params.reason,
    metadata: sanitizedMeta,
  };

  if (!db) {
    return auditRecord;
  }

  try {
    const tenantId = auditRecord.tenantId || 'central-metro-hospital';

    // 1. Tenant-scoped audit log
    const tenantLogRef = db.collection('tenants').doc(tenantId).collection('audit_logs').doc(eventId);
    // 2. Global audit log for enterprise compliance
    const globalLogRef = db.collection('auditLogs').doc(eventId);

    const batch = db.batch();
    batch.set(tenantLogRef, auditRecord);
    batch.set(globalLogRef, {
      ...auditRecord,
      action: params.eventType,
      resource: `auth/tenant/${tenantId}`,
      status: params.eventType.includes('FAILURE') || params.eventType.includes('UNAUTHORIZED') ? 'FAILED' : 'SUCCESS',
    });

    await batch.commit();
  } catch (err) {
    console.warn('Audit log write notice:', err);
  }

  return auditRecord;
}
