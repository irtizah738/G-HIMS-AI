'use client';

import { AuthClient } from '@/lib/auth/auth-client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { listSecureEdgeEntities } from '@/lib/offline/secure-store';
import type {
  Patient360EncounterSummary,
  Patient360Projection,
  Patient360TimelineItem,
} from '@/types/patient360-projection';
import type {
  ClinicalCareSetting,
  ConsultantPatientStateProjection,
} from '@/types/consultant-visibility';
import { selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';
import type { DischargeReadinessProjection } from '@/types/discharge-readiness';
import type { DeteriorationProjection } from '@/types/clinical-deterioration';

export interface Patient360ClinicalView {
  tenantId: string;
  patientId: string;
  projection: Patient360Projection;
  timeline: Patient360TimelineItem[];
  selectedCareContext: Patient360EncounterSummary | null;
  dischargeReadiness: DischargeReadinessProjection | null;
  deterioration: DeteriorationProjection | null;
  consultantVisibility: ConsultantPatientStateProjection | null;
  source: 'SERVER' | 'LOCAL_EDGE';
  freshness: {
    projectionVersion: number;
    revision: number;
    projectedAt: number;
    sourceCheckpoint: string;
    lastEventId?: string;
    lastEventRecordedAt?: number;
    contentHash: string;
  };
}

function freshness(projection: Patient360Projection) {
  return {
    projectionVersion: projection.projectionVersion,
    revision: projection.revision,
    projectedAt: projection.projectedAt,
    sourceCheckpoint: projection.sourceCheckpoint,
    lastEventId: projection.lastEventId,
    lastEventRecordedAt: projection.lastEventRecordedAt,
    contentHash: projection.contentHash,
  };
}

async function loadLocalPatient360(
  tenantId: string,
  patientId: string,
  options: { careSetting?: ClinicalCareSetting; encounterId?: string } = {}
): Promise<Patient360ClinicalView | null> {
  const cached = await getCachedAuthSession();
  if (
    !cached ||
    cached.user.tenantId.trim().toLowerCase() !== tenantId.trim().toLowerCase()
  ) {
    return null;
  }

  const projectionRows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'patient360Projections'
  );
  const projections = projectionRows as unknown as Patient360Projection[];

  const projection =
    projections.find((item) => item.patientId === patientId) || null;

  if (!projection) return null;

  const selectedCareContext =
    (options.encounterId
      ? projection.recentEncounters.find(
          (item) => item.encounterId === options.encounterId
        )
      : projection.careContexts
        ? selectCareContextEncounter(projection.careContexts, options.careSetting)
        : projection.activeEncounter) || null;

  const readinessRows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'dischargeReadinessProjections'
  );
  const readiness = readinessRows as unknown as DischargeReadinessProjection[];
  const dischargeReadiness =
    readiness.find(
      (item) =>
        item.patientId === patientId &&
        (!selectedCareContext?.encounterId ||
          item.encounterId === selectedCareContext.encounterId)
    ) || null;

  const deteriorationRows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'deteriorationProjections'
  );
  const deteriorationItems =
    deteriorationRows as unknown as DeteriorationProjection[];
  const deterioration =
    deteriorationItems.find(
      (item) =>
        item.patientId === patientId &&
        (!selectedCareContext?.encounterId ||
          item.encounterId === selectedCareContext.encounterId)
    ) || null;

  return {
    tenantId,
    patientId,
    projection,
    timeline: [],
    selectedCareContext,
    dischargeReadiness,
    deterioration,
    consultantVisibility: null,
    source: 'LOCAL_EDGE',
    freshness: freshness(projection),
  };
}

export async function loadPatient360ClinicalView(
  tenantId: string,
  patientId: string,
  options: { careSetting?: ClinicalCareSetting; encounterId?: string } = {}
): Promise<Patient360ClinicalView> {
  let serverResponseStatus: number | null = null;

  try {
    const response = await AuthClient.authorizedFetch(
      `/api/clinical/patient360/${encodeURIComponent(patientId)}?tenantId=${encodeURIComponent(tenantId)}${options.careSetting ? `&careSetting=${encodeURIComponent(options.careSetting)}` : ''}${options.encounterId ? `&encounterId=${encodeURIComponent(options.encounterId)}` : ''}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
      tenantId
    );
    serverResponseStatus = response.status;

    const payload = await response.json();
    if (!response.ok || !payload?.success || !payload?.projection) {
      throw new Error(
        payload?.error || 'Patient 360 projection could not be loaded.'
      );
    }

    return {
      tenantId: payload.tenantId,
      patientId: payload.patientId,
      projection: payload.projection as Patient360Projection,
      timeline: (payload.timeline || []) as Patient360TimelineItem[],
      selectedCareContext:
        (payload.selectedCareContext as Patient360EncounterSummary | null) || null,
      dischargeReadiness:
        (payload.dischargeReadiness as DischargeReadinessProjection | null) || null,
      deterioration:
        (payload.deterioration as DeteriorationProjection | null) || null,
      consultantVisibility:
        (payload.consultantVisibility as ConsultantPatientStateProjection | null) || null,
      source: 'SERVER',
      freshness: payload.freshness || freshness(payload.projection),
    };
  } catch (error) {
    // A reachable authoritative server denial/conflict must never be hidden by
    // stale PHI from the edge cache. Local continuity is only for transport or
    // transient server-availability failures.
    if (
      serverResponseStatus !== null &&
      [400, 401, 403, 404, 409, 422].includes(serverResponseStatus)
    ) {
      throw error;
    }

    const local = await loadLocalPatient360(tenantId, patientId, options);
    if (local) return local;
    throw error;
  }
}


export async function recordDischargeReadinessReview(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    evaluationId: string;
    outcome: 'ACKNOWLEDGED' | 'ESCALATE' | 'PROCEED_WITH_WARNINGS';
    reviewedFindingIds?: string[];
    reason?: string;
  }
): Promise<Record<string, unknown>> {
  const commandId = `cmd_ci7_review_${crypto.randomUUID()}`;
  const idempotencyKey = `ci7-review:${input.evaluationId}:${input.outcome}`;

  const response = await AuthClient.authorizedFetch(
    '/api/commands/execute',
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId,
          idempotencyKey,
          tenantId,
          commandType: 'RecordDischargeReadinessReviewCommand',
          payload: input,
          clientTimestamp: Date.now(),
          schemaVersion: 1,
        },
      }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message ||
      payload?.error ||
      'Discharge-readiness review could not be recorded.'
    );
  }
  return payload as Record<string, unknown>;
}


export async function acknowledgeCriticalDiagnosticResult(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    reportId: string;
    note?: string;
  }
): Promise<Record<string, unknown>> {
  const commandId = `cmd_diag_ack_${crypto.randomUUID()}`;
  const idempotencyKey = `idem_diag_ack_${crypto.randomUUID()}`;

  const response = await AuthClient.authorizedFetch(
    '/api/commands/execute',
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId,
          idempotencyKey,
          tenantId,
          commandType: 'AcknowledgeCriticalDiagnosticResultCommand',
          payload: input,
          clientTimestamp: Date.now(),
          schemaVersion: 1,
        },
      }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message ||
      payload?.error ||
      'Critical diagnostic result acknowledgement could not be recorded.'
    );
  }

  return payload as Record<string, unknown>;
}
