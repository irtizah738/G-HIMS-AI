'use client';

import { AuthClient } from '@/lib/auth/auth-client';

export type MpiLookupType = 'AUTO' | 'MRN' | 'CNIC';

export interface MpiIdentityMatch {
  patientId: string;
  mrn: string;
  cnic: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  status: string;
  matchedBy: 'MRN' | 'CNIC';
}

export async function lookupPatientByMpi(
  value: string,
  type: MpiLookupType = 'AUTO'
): Promise<MpiIdentityMatch | null> {
  const tenantId = await AuthClient.getActiveTenantId();
  const params = new URLSearchParams({
    tenantId,
    value,
    type,
  });

  const response = await AuthClient.authorizedFetch(
    `/api/clinical/mpi/lookup?${params.toString()}`,
    { method: 'GET', cache: 'no-store' },
    tenantId
  );

  if (response.status === 404) return null;

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.match) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        'MPI identity lookup failed.'
    );
  }

  return payload.match as MpiIdentityMatch;
}
