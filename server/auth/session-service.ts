/**
 * G-HIMS Server-Side Session Lifecycle Management
 * Production rule: session validation is fail-closed and never creates authorization.
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { UserSessionRecord } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import crypto from 'crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;

const inMemorySessionStore = new Map<string, UserSessionRecord>();

function mayUseInMemorySessions(): boolean {
  const mode = getRuntimeMode();
  return mode === 'DEMO' || mode === 'TEST';
}

export function hashString(value?: string): string {
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 32);
}

export interface CreateSessionParams {
  userId: string;
  tenantId: string;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

export async function createSession(params: CreateSessionParams): Promise<UserSessionRecord> {
  const db = getAdminFirestore();
  const sessionId = `sess_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  const sessionRecord: UserSessionRecord = {
    sessionId,
    userId: params.userId,
    tenantId: params.tenantId,
    deviceId: params.deviceId,
    status: 'ACTIVE',
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    authenticatedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    expiresAt,
    ipHash: hashString(params.ip),
    userAgentHash: hashString(params.userAgent),
  };

  if (!db) {
    if (mayUseInMemorySessions()) {
      inMemorySessionStore.set(`${params.tenantId}:${sessionId}`, sessionRecord);
      return sessionRecord;
    }

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative session store is unavailable',
      statusCode: 503,
    });
  }

  try {
    await db
      .collection('tenants')
      .doc(params.tenantId)
      .collection('sessions')
      .doc(sessionId)
      .set(sessionRecord);

    return sessionRecord;
  } catch (error) {
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Failed to persist authoritative session',
      statusCode: 503,
      originalError: error,
    });
  }
}

export interface ValidateSessionOptions {
  /**
   * Background health/replica probes must not count as clinician activity.
   * Defaults to true for normal authenticated requests.
   */
  touchActivity?: boolean;
}

export async function validateSession(
  tenantId: string,
  sessionId: string,
  userId: string,
  options: ValidateSessionOptions = {}
): Promise<UserSessionRecord> {
  if (!tenantId || !sessionId || !userId) {
    throw new AuthError({
      code: 'SESSION_NOT_FOUND',
      message: 'Tenant, session and user identifiers are required',
      statusCode: 401,
    });
  }

  const cacheKey = `${tenantId}:${sessionId}`;
  const db = getAdminFirestore();

  if (!db) {
    if (mayUseInMemorySessions()) {
      const cached = inMemorySessionStore.get(cacheKey);
      if (cached) return validateSessionRecord(cached, userId);
    }

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative session store is unavailable',
      statusCode: 503,
    });
  }

  try {
    const sessionDocRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('sessions')
      .doc(sessionId);

    const docSnap = await sessionDocRef.get();

    if (!docSnap.exists) {
      throw new AuthError({
        code: 'SESSION_NOT_FOUND',
        message: 'Clinical session does not exist',
        statusCode: 401,
      });
    }

    const sessionData = validateSessionRecord(docSnap.data() as UserSessionRecord, userId);

    if (options.touchActivity === false) {
      return sessionData;
    }

    const now = new Date().toISOString();

    await sessionDocRef.update({
      lastSeenAt: now,
      lastActivityAt: now,
    });

    return {
      ...sessionData,
      lastSeenAt: now,
      lastActivityAt: now,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Unable to validate authoritative session',
      statusCode: 503,
      originalError: error,
    });
  }
}

export function validateSessionRecord(
  sessionData: UserSessionRecord,
  expectedUserId: string
): UserSessionRecord {
  if (sessionData.userId !== expectedUserId) {
    throw new AuthError({
      code: 'SESSION_REVOKED',
      message: 'Session user identifier mismatch',
      statusCode: 401,
    });
  }

  if (sessionData.status === 'REVOKED') {
    throw new AuthError({
      code: 'SESSION_REVOKED',
      message: sessionData.revokeReason || 'Session has been revoked',
      statusCode: 401,
    });
  }

  if (sessionData.status === 'EXPIRED') {
    throw new AuthError({
      code: 'SESSION_EXPIRED',
      message: 'Clinical session has expired',
      statusCode: 401,
    });
  }

  const now = Date.now();
  if (now > new Date(sessionData.expiresAt).getTime()) {
    throw new AuthError({
      code: 'SESSION_EXPIRED',
      message: 'Clinical session expired',
      statusCode: 401,
    });
  }

  const lastActivity = new Date(
    sessionData.lastActivityAt || sessionData.lastSeenAt
  ).getTime();

  if (now - lastActivity > INACTIVITY_LIMIT_MS) {
    throw new AuthError({
      code: 'SESSION_EXPIRED',
      message: 'Session expired due to inactivity',
      statusCode: 401,
    });
  }

  return sessionData;
}

export async function revokeSession(
  tenantId: string,
  sessionId: string,
  revokedBy: string,
  reason = 'User signed out'
): Promise<void> {
  if (!tenantId || !sessionId) return;

  const db = getAdminFirestore();

  if (!db) {
    if (mayUseInMemorySessions()) {
      const cacheKey = `${tenantId}:${sessionId}`;
      const cached = inMemorySessionStore.get(cacheKey);
      if (cached) {
        inMemorySessionStore.set(cacheKey, {
          ...cached,
          status: 'REVOKED',
          revokedAt: new Date().toISOString(),
          revokedBy,
          revokeReason: reason,
        });
      }
      return;
    }

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative session store is unavailable',
      statusCode: 503,
    });
  }

  try {
    const sessionDocRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('sessions')
      .doc(sessionId);

    await sessionDocRef.update({
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
      revokedBy,
      revokeReason: reason,
    });
  } catch (error) {
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Failed to revoke authoritative session',
      statusCode: 503,
      originalError: error,
    });
  }
}
