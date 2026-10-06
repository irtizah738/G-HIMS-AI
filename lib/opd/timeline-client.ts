import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import type { OpdTimelineEvent } from '@/types/opd-domain';

export interface AuthoritativeOpdTimelineResponse {
  success: boolean;
  tenantId: string;
  patientId: string;
  encounterId: string;
  timeline: OpdTimelineEvent[];
  integrity: {
    mode: 'SERVER_APPEND_ONLY';
    eventCount: number;
    linkedAuditCount: number;
    unlinkedEventCount: number;
    ambiguousAuditCount: number;
    truncated: boolean;
    fullyLinked: boolean;
  };
}

export async function fetchAuthoritativeOpdTimeline(
  tenantId: string,
  encounterId: string
): Promise<AuthoritativeOpdTimelineResponse> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedEncounterId = String(encounterId || '').trim();
  if (!normalizedTenantId || !normalizedEncounterId) {
    throw new Error(
      'OPD_TIMELINE_SCOPE_REQUIRED: tenantId and encounterId are required.'
    );
  }

  const currentUser = auth.currentUser;
  const cached = await getCachedAuthSession();
  if (!currentUser || !cached) {
    throw new Error(
      'AUTHENTICATION_REQUIRED: authoritative OPD timeline requires an active session.'
    );
  }
  if (cached.user.tenantId !== normalizedTenantId) {
    throw new Error(
      'TENANT_MISMATCH: active session does not match requested OPD timeline tenant.'
    );
  }

  const idToken = await currentUser.getIdToken(false);
  const params = new URLSearchParams({
    tenantId: normalizedTenantId,
    encounterId: normalizedEncounterId,
  });

  const response = await fetch(`/api/opd/timeline?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'x-ghims-tenant-id': normalizedTenantId,
      'x-ghims-session-id': cached.session.sessionId,
      ...(cached.session.deviceId
        ? { 'x-ghims-device-id': cached.session.deviceId }
        : {}),
    },
  });

  const result = (await response.json()) as
    | AuthoritativeOpdTimelineResponse
    | { success?: false; error?: string };

  if (!response.ok || result.success !== true) {
    throw new Error(
      ('error' in result && result.error) ||
        'Authoritative OPD timeline could not be loaded.'
    );
  }

  return result as AuthoritativeOpdTimelineResponse;
}
