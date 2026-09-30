'use client';

import { AuthClient } from '@/lib/auth/auth-client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { listSecureEdgeEntities } from '@/lib/offline/secure-store';
import type { DeteriorationProjection } from '@/types/clinical-deterioration';

export interface ActiveDeteriorationCensus {
  tenantId: string;
  projections: DeteriorationProjection[];
  source: 'SERVER' | 'LOCAL_EDGE';
}

async function loadLocal(
  tenantId: string
): Promise<ActiveDeteriorationCensus | null> {
  const cached = await getCachedAuthSession();
  if (
    !cached ||
    cached.user.tenantId.trim().toLowerCase() !==
      tenantId.trim().toLowerCase()
  ) {
    return null;
  }

  const rows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'deteriorationProjections'
  );
  const projections = rows as unknown as DeteriorationProjection[];

  return {
    tenantId,
    projections: projections.filter(
      (item) => item.state !== 'NOT_APPLICABLE'
    ),
    source: 'LOCAL_EDGE',
  };
}

export async function loadActiveDeteriorationCensus(
  tenantId: string
): Promise<ActiveDeteriorationCensus> {
  let serverStatus: number | null = null;

  try {
    const response = await AuthClient.authorizedFetch(
      `/api/clinical/deterioration/active?tenantId=${encodeURIComponent(
        tenantId
      )}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
      tenantId
    );
    serverStatus = response.status;

    const payload = await response.json();
    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.error ||
          'Active deterioration intelligence could not be loaded.'
      );
    }

    return {
      tenantId: payload.tenantId,
      projections: (payload.projections || []) as DeteriorationProjection[],
      source: 'SERVER',
    };
  } catch (error) {
    if (
      serverStatus !== null &&
      [400, 401, 403, 404, 409, 422].includes(serverStatus)
    ) {
      throw error;
    }

    const local = await loadLocal(tenantId);
    if (local) return local;
    throw error;
  }
}
