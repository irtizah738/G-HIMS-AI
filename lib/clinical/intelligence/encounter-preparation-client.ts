import { AuthClient } from '@/lib/auth/auth-client';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';

export async function generateEncounterPreparationBrief(
  tenantId: string,
  patientId: string,
  encounterId: string
): Promise<ClinicalEncounterPreparationResponse> {
  const response = await AuthClient.authorizedFetch(
    `/api/clinical/intelligence/encounter-preparation?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        patientId,
        encounterId,
      }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.brief) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        'Encounter preparation could not be generated.'
    );
  }

  return {
    brief: payload.brief,
    evidenceIndex: payload.evidenceIndex || [],
  } as ClinicalEncounterPreparationResponse;
}
