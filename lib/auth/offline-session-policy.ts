import type { AuthenticatedUser, UserSessionRecord } from './auth-types';

export interface CachedIdentity {
  user: AuthenticatedUser;
  session: UserSessionRecord;
}

/**
 * Offline review is a bounded, local identity continuation, NEVER a fresh
 * server session or a grant of clinical authority. Revocations cannot be
 * checked until the network returns and replay requires reauthorization.
 */
export function canResumeOfflineIdentity(
  firebaseUid: string | undefined,
  cached: CachedIdentity | null,
  nowMs = Date.now()
): boolean {
  if (!firebaseUid || !cached) return false;
  const { user, session } = cached;
  if (user.uid !== firebaseUid || session.userId !== firebaseUid) return false;
  if (!user.tenantId || user.tenantId !== session.tenantId) return false;
  if (!user.sessionId || user.sessionId !== session.sessionId) return false;
  if (user.accountStatus !== 'ACTIVE' || session.status !== 'ACTIVE') return false;
  const expiresAt = Date.parse(session.expiresAt);
  const authenticatedAt = Date.parse(session.authenticatedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(authenticatedAt)) return false;
  if (authenticatedAt > nowMs || nowMs >= expiresAt) return false;
  // Local identity display may not outlive the original 12-hour server
  // session window, even if the cached expiresAt was malformed/extended.
  if (nowMs - authenticatedAt > 12 * 60 * 60 * 1000) return false;
  return true;
}
