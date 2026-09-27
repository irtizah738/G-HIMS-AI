import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { hashString } from '@/server/auth/session-service';

const ALLOWED_ACTIONS = new Set([
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'OFFLINE_SYNC_OVERRIDE',
  'OFFLINE_SYNC_COMPLETE',
  'CONFLICT_DETECTED',
  'CONFLICT_RESOLVED',
  'EXPORT',
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'PATIENT_MERGE',
  'MAR_ADMINISTRATION',
  'SOAP_RECONCILE',
]);

const ALLOWED_STATUS = new Set([
  'SUCCESS',
  'WARNING',
  'SECURITY_ALERT',
  'CONFLICT_RESOLVED',
  'FAILURE',
]);

const ALLOWED_SEVERITY = new Set(['CRITICAL', 'WARNING', 'INFO']);
const SENSITIVE_METADATA_KEY = /(password|token|authorization|secret|raw|note|content|payload)/i;

function bounded(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

function sanitizeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, string | number | boolean | null> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_METADATA_KEY.test(key)) continue;
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      output[key.slice(0, 80)] =
        typeof raw === 'string' ? raw.slice(0, 500) : raw;
    }
  }

  return output;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = bounded(body.tenantId, 160).toLowerCase();
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const action = bounded(body.action, 80).toUpperCase();
    const resource = bounded(body.resource, 240);
    const details = bounded(body.details, 1000);
    const status = bounded(body.status || 'SUCCESS', 40).toUpperCase();
    const severity = bounded(body.severity || 'INFO', 40).toUpperCase();

    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unsupported audit action.' }, { status: 400 });
    }
    if (!resource || !details) {
      return NextResponse.json({ error: 'resource and details are required.' }, { status: 400 });
    }
    if (!ALLOWED_STATUS.has(status) || !ALLOWED_SEVERITY.has(severity)) {
      return NextResponse.json({ error: 'Invalid audit status or severity.' }, { status: 400 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ error: 'Authoritative audit store unavailable.' }, { status: 503 });
    }

    const id = 'audit_client_' + crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const forwardedIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const userAgent = req.headers.get('user-agent') || undefined;

    const entry = {
      id,
      auditId: id,
      tenantId: context.tenantId,
      userId: context.actorId,
      actorId: context.actorId,
      userName: context.actorId,
      userRole: context.roles[0] || 'AUTHENTICATED_USER',
      actorRole: context.roles[0] || 'AUTHENTICATED_USER',
      action,
      resource,
      resourceType: 'CLIENT_ACTIVITY',
      resourceId: resource,
      status,
      severity,
      details,
      timestamp,
      occurredAt: Date.now(),
      recordedAt: Date.now(),
      requestId: context.requestId,
      correlationId: context.correlationId,
      ipHash: forwardedIp ? hashString(forwardedIp) : null,
      userAgentHash: userAgent ? hashString(userAgent) : null,
      metadata: sanitizeMetadata(body.metadata),
      integrityMode: 'SERVER_APPEND_ONLY',
    };

    await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('audit_logs')
      .doc(id)
      .create(entry);

    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audit event rejected';
    const unauthorized = /AUTH|TENANT|SESSION|DEVICE/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
