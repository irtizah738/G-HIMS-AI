import { db } from '@/lib/firebase/client';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { AuthClient } from '@/lib/auth/auth-client';

export type AuditAction =
  | 'READ'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'OFFLINE_SYNC_OVERRIDE'
  | 'OFFLINE_SYNC_COMPLETE'
  | 'CONFLICT_DETECTED'
  | 'CONFLICT_RESOLVED'
  | 'EXPORT'
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'PATIENT_MERGE'
  | 'MAR_ADMINISTRATION'
  | 'SOAP_RECONCILE';

export type AuditStatus =
  | 'SUCCESS'
  | 'WARNING'
  | 'SECURITY_ALERT'
  | 'CONFLICT_RESOLVED'
  | 'FAILURE';

export type AuditSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  userRole: string;
  action: AuditAction;
  resource: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  status: AuditStatus;
  severity?: AuditSeverity;
  details: string;
  previousHash: string;
  hash: string;
  metadata?: Record<string, unknown>;
  integrityMode?: 'SERVER_APPEND_ONLY' | 'STORED_HASH_CHAIN';
}

export interface AuditEventInput {
  tenantId: string;
  action: AuditAction;
  resource: string;
  status?: AuditStatus;
  severity?: AuditSeverity;
  details: string;
  metadata?: Record<string, unknown>;
}

export interface ChainVerificationResult {
  isValid: boolean;
  totalLogsChecked: number;
  brokenAtIndex: number | null;
  brokenLogId: string | null;
  mismatchedHash: { expected: string; actual: string } | null;
  calculatedHashes: string[];
}

export async function calculateSha256(content: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('CRYPTOGRAPHIC_HASH_UNAVAILABLE: Web Crypto SHA-256 is required.');
  }

  const data = new TextEncoder().encode(content);
  const hashBuffer = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function getLogSeverity(log: {
  action?: AuditAction | string;
  status?: AuditStatus | string;
  resource?: string;
  severity?: AuditSeverity;
}): AuditSeverity {
  if (log.severity) return log.severity;
  if (
    log.action === 'DELETE' ||
    log.status === 'SECURITY_ALERT' ||
    log.status === 'FAILURE' ||
    log.action === 'PATIENT_MERGE'
  ) return 'CRITICAL';

  if (
    log.action === 'OFFLINE_SYNC_OVERRIDE' ||
    log.action === 'CONFLICT_DETECTED' ||
    log.status === 'WARNING' ||
    log.action === 'EXPORT'
  ) return 'WARNING';

  return 'INFO';
}

export function buildCanonicalAuditString(
  previousHash: string,
  tenantId: string,
  userId: string,
  action: string,
  resource: string,
  timestamp: string,
  status: string,
  details: string
): string {
  return [
    previousHash,
    tenantId,
    userId,
    action,
    resource,
    timestamp,
    status,
    details,
  ].join('|');
}

/**
 * Client-originated audit events are requests, never authority.
 * Identity, role, tenant session, network origin and persistence are re-derived server-side.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<AuditLogEntry> {
  const response = await AuthClient.authorizedFetch(
    '/api/audit/events',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    input.tenantId
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.entry) {
    throw new Error(body?.error || 'AUDIT_EVENT_REJECTED');
  }

  return normalizeAuditEntry(body.entry, body.entry.id || body.entry.auditId || '');
}

function toIsoTimestamp(raw: Record<string, unknown>): string {
  if (typeof raw.timestamp === 'string') return raw.timestamp;
  const numeric = Number(raw.recordedAt || raw.occurredAt || Date.now());
  return new Date(Number.isFinite(numeric) ? numeric : Date.now()).toISOString();
}

function normalizeAuditEntry(raw: Record<string, unknown>, docId: string): AuditLogEntry {
  const status = String(raw.status || 'SUCCESS').toUpperCase() as AuditStatus;
  const action = String(raw.action || raw.eventType || 'READ').toUpperCase() as AuditAction;
  const resource =
    String(raw.resource || '') ||
    [raw.resourceType, raw.resourceId].filter(Boolean).map(String).join(':') ||
    'UNSPECIFIED_RESOURCE';

  return {
    id: String(raw.id || raw.auditId || docId),
    tenantId: String(raw.tenantId || ''),
    userId: String(raw.userId || raw.actorId || ''),
    userName: String(raw.userName || raw.actorId || raw.userId || 'Recorded actor'),
    userRole: String(raw.userRole || raw.actorRole || 'RECORDED_ROLE'),
    action,
    resource,
    ipAddress: raw.ipHash ? 'hashed-origin-recorded' : 'not-recorded',
    userAgent: raw.userAgentHash ? 'hashed-agent-recorded' : 'not-recorded',
    timestamp: toIsoTimestamp(raw),
    status,
    severity: getLogSeverity({
      action,
      status,
      severity: raw.severity as AuditSeverity | undefined,
    }),
    details: String(raw.details || raw.reason || raw.action || 'Audit event'),
    previousHash: String(raw.previousHash || ''),
    hash: String(raw.hash || ''),
    metadata:
      raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {},
    integrityMode: raw.hash && raw.previousHash ? 'STORED_HASH_CHAIN' : 'SERVER_APPEND_ONLY',
  };
}

/**
 * Verifies only hashes that were actually persisted by an authoritative chaining service.
 * Missing hashes are not generated client-side and are therefore not presented as verified.
 */
export async function verifyAuditChain(
  logs: AuditLogEntry[]
): Promise<ChainVerificationResult> {
  if (!logs.length) {
    return {
      isValid: true,
      totalLogsChecked: 0,
      brokenAtIndex: null,
      brokenLogId: null,
      mismatchedHash: null,
      calculatedHashes: [],
    };
  }

  const chain = [...logs]
    .filter((log) => Boolean(log.hash && log.previousHash))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!chain.length) {
    return {
      isValid: false,
      totalLogsChecked: 0,
      brokenAtIndex: null,
      brokenLogId: null,
      mismatchedHash: null,
      calculatedHashes: [],
    };
  }

  const calculatedHashes: string[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];

    if (index > 0 && current.previousHash !== chain[index - 1].hash) {
      return {
        isValid: false,
        totalLogsChecked: index,
        brokenAtIndex: index,
        brokenLogId: current.id,
        mismatchedHash: {
          expected: chain[index - 1].hash,
          actual: current.previousHash,
        },
        calculatedHashes,
      };
    }

    const expected = await calculateSha256(
      buildCanonicalAuditString(
        current.previousHash,
        current.tenantId,
        current.userId,
        current.action,
        current.resource,
        current.timestamp,
        current.status,
        current.details
      )
    );
    calculatedHashes.push(expected);

    if (expected !== current.hash) {
      return {
        isValid: false,
        totalLogsChecked: index + 1,
        brokenAtIndex: index,
        brokenLogId: current.id,
        mismatchedHash: { expected, actual: current.hash },
        calculatedHashes,
      };
    }
  }

  return {
    isValid: true,
    totalLogsChecked: chain.length,
    brokenAtIndex: null,
    brokenLogId: null,
    mismatchedHash: null,
    calculatedHashes,
  };
}

export async function fetchAuditLogs(
  tenantId: string,
  options?: { limitCount?: number }
): Promise<AuditLogEntry[]> {
  const cleanTenantId = String(tenantId || '').trim();
  if (!cleanTenantId) return [];

  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'tenants', cleanTenantId, 'audit_logs'),
        orderBy('recordedAt', 'desc'),
        limit(options?.limitCount || 50)
      )
    );

    return snapshot.docs.map((snapshotDoc) =>
      normalizeAuditEntry(
        snapshotDoc.data() as Record<string, unknown>,
        snapshotDoc.id
      )
    );
  } catch {
    // Audit evidence is never replaced with generated/demo records.
    return [];
  }
}
