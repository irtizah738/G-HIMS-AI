import { db } from '@/lib/firebase/client';
import { getDocs, collection, query, orderBy, limit } from 'firebase/firestore';

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
  authoritative?: boolean;
  persistenceStatus?: 'DURABLE' | 'CLIENT_INTENT_UNPERSISTED';
}

export interface AuditEventInput {
  tenantId: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  action: AuditAction;
  resource: string;
  status?: AuditStatus;
  severity?: AuditSeverity;
  details: string;
  metadata?: Record<string, unknown>;
  userAgent?: string;
}

export interface ChainVerificationResult {
  isValid: boolean;
  totalLogsChecked: number;
  brokenAtIndex: number | null;
  brokenLogId: string | null;
  mismatchedHash: { expected: string; actual: string } | null;
  calculatedHashes: string[];
  reason?: string;
}

const GENESIS_HASH = '0'.repeat(64);

/**
 * Browser verification uses the platform SHA-256 implementation only.
 * There is deliberately no pseudo-cryptographic fallback.
 */
export async function calculateSha256(content: string): Promise<string> {
  if (
    typeof globalThis.crypto === 'undefined' ||
    !globalThis.crypto.subtle ||
    typeof TextEncoder === 'undefined'
  ) {
    throw new Error('SHA256_UNAVAILABLE: WebCrypto SubtleCrypto is required.');
  }

  const encoded = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
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
  return [previousHash, tenantId, userId, action, resource, timestamp, status, details].join('|');
}

/**
 * Client-side code is not an audit authority. This compatibility function records
 * only an explicit unpersisted intent object; authoritative audit evidence must be
 * created by server commands/authentication services.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<AuditLogEntry> {
  const timestamp = new Date().toISOString();
  return {
    id: `client_intent_${crypto.randomUUID()}`,
    tenantId: input.tenantId,
    userId: input.userId || 'UNRESOLVED_CLIENT_ACTOR',
    userName: input.userName || 'Unresolved client actor',
    userRole: input.userRole || 'UNRESOLVED',
    action: input.action,
    resource: input.resource,
    ipAddress: 'SERVER_ONLY',
    userAgent:
      input.userAgent ||
      (typeof navigator !== 'undefined' ? navigator.userAgent : 'UNAVAILABLE'),
    timestamp,
    status: input.status || 'WARNING',
    severity: input.severity || getLogSeverity(input),
    details: input.details,
    previousHash: '',
    hash: '',
    metadata: input.metadata || {},
    authoritative: false,
    persistenceStatus: 'CLIENT_INTENT_UNPERSISTED',
  };
}

export async function verifyAuditChain(logs: AuditLogEntry[]): Promise<ChainVerificationResult> {
  if (!logs || logs.length === 0) {
    return {
      isValid: true,
      totalLogsChecked: 0,
      brokenAtIndex: null,
      brokenLogId: null,
      mismatchedHash: null,
      calculatedHashes: [],
      reason: 'NO_AUDIT_RECORDS',
    };
  }

  if (logs.some((log) => log.authoritative === false || !log.hash || !log.previousHash)) {
    return {
      isValid: false,
      totalLogsChecked: 0,
      brokenAtIndex: 0,
      brokenLogId: logs.find((log) => log.authoritative === false || !log.hash || !log.previousHash)?.id || null,
      mismatchedHash: null,
      calculatedHashes: [],
      reason: 'NON_AUTHORITATIVE_OR_UNHASHED_RECORD',
    };
  }

  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const calculatedHashes: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const expectedPreviousHash = i === 0 ? current.previousHash : sorted[i - 1].hash;

    if (i > 0 && current.previousHash !== expectedPreviousHash) {
      return {
        isValid: false,
        totalLogsChecked: i,
        brokenAtIndex: i,
        brokenLogId: current.id,
        mismatchedHash: { expected: expectedPreviousHash, actual: current.previousHash },
        calculatedHashes,
        reason: 'CHAIN_LINK_MISMATCH',
      };
    }

    const canonical = buildCanonicalAuditString(
      current.previousHash,
      current.tenantId,
      current.userId,
      current.action,
      current.resource,
      current.timestamp,
      current.status,
      current.details
    );
    const expectedCurrentHash = await calculateSha256(canonical);
    calculatedHashes.push(expectedCurrentHash);

    if (expectedCurrentHash !== current.hash) {
      return {
        isValid: false,
        totalLogsChecked: i + 1,
        brokenAtIndex: i,
        brokenLogId: current.id,
        mismatchedHash: { expected: expectedCurrentHash, actual: current.hash },
        calculatedHashes,
        reason: 'RECORD_HASH_MISMATCH',
      };
    }
  }

  return {
    isValid: true,
    totalLogsChecked: sorted.length,
    brokenAtIndex: null,
    brokenLogId: null,
    mismatchedHash: null,
    calculatedHashes,
  };
}

/**
 * Reads only durable server-created audit records. Empty or failed queries remain
 * empty/failed; the UI must never substitute fabricated security incidents.
 */
export async function fetchAuditLogs(
  tenantId: string,
  options?: { limitCount?: number }
): Promise<AuditLogEntry[]> {
  const limitCount = Math.max(1, Math.min(options?.limitCount || 50, 500));
  const snapshot = await getDocs(
    query(
      collection(db, 'tenants', tenantId, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    )
  );

  return snapshot.docs.map((docSnapshot) => ({
    ...(docSnapshot.data() as AuditLogEntry),
    authoritative: true,
    persistenceStatus: 'DURABLE',
  }));
}

export { GENESIS_HASH };
