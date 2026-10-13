import type { AuthenticatedUser, UserSessionRecord } from '@/lib/auth/auth-types';

/**
 * Local clinical PHI may be accessed only by the *currently restored*
 * Firebase actor, not merely by the actor named in an encrypted cache.
 * This is offline read continuity, never a grant of online clinical authority.
 */
export function canReadOfflineClinicalSnapshot(
  restoredUid: string | undefined | null,
  cached: { user: AuthenticatedUser; session: UserSessionRecord } | null,
  tenantId: string,
  now = Date.now()
): boolean {
  if (!restoredUid || !cached || !tenantId.trim()) return false;
  const tenant = tenantId.trim().toLowerCase();
  const expires = Date.parse(cached.session.expiresAt);
  return cached.user.uid === restoredUid &&
    cached.session.userId === restoredUid &&
    cached.user.sessionId === cached.session.sessionId &&
    cached.user.tenantId.trim().toLowerCase() === tenant &&
    cached.session.tenantId.trim().toLowerCase() === tenant &&
    cached.user.accountStatus === 'ACTIVE' &&
    cached.session.status === 'ACTIVE' &&
    Boolean(cached.session.sessionId) &&
    Number.isFinite(expires) &&
    now < expires;
}
