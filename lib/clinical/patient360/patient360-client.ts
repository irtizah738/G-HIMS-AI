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
  ClinicalOpenItemProjection,
  ConsultantPatientStateProjection,
} from '@/types/consultant-visibility';
import { selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';
import type { DischargeReadinessProjection } from '@/types/discharge-readiness';
import type { DeteriorationProjection } from '@/types/clinical-deterioration';
import type { MedicationSafetyProjection } from '@/types/medication-safety';
import type { ClinicalLongitudinalSummaryResponse } from '@/types/clinical-longitudinal-summary';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';
import type { ClinicalTrendIntelligenceResponse } from '@/types/clinical-trend-intelligence';

export interface Patient360ClinicalView {
  tenantId: string;
  patientId: string;
  projection: Patient360Projection;
  timeline: Patient360TimelineItem[];
  selectedCareContext: Patient360EncounterSummary | null;
  dischargeReadiness: DischargeReadinessProjection | null;
  deterioration: DeteriorationProjection | null;
  medicationSafety: MedicationSafetyProjection | null;
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

  const medicationSafetyRows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'medicationSafetyProjections'
  );
  const medicationSafety =
    (medicationSafetyRows as unknown as MedicationSafetyProjection[])
      .find((item) => item.patientId === patientId) || null;

  const openItemRows = await listSecureEdgeEntities<Record<string, unknown>>(
    tenantId,
    cached.user.uid,
    'clinicalOpenItems'
  );
  const openItems = (openItemRows as unknown as ClinicalOpenItemProjection[])
    .filter(
      (item) =>
        item.patientId === patientId &&
        item.status !== 'RESOLVED' &&
        (!selectedCareContext?.encounterId ||
          item.encounterId === selectedCareContext.encounterId)
    )
    .sort(
      (left, right) =>
        Number(left.dueAt || Number.MAX_SAFE_INTEGER) -
          Number(right.dueAt || Number.MAX_SAFE_INTEGER) ||
        Number(left.createdAt || 0) - Number(right.createdAt || 0)
    );

  const consultantVisibility: ConsultantPatientStateProjection | null =
    selectedCareContext
      ? {
          tenantId,
          consultantId: cached.user.uid,
          patientId,
          encounter: selectedCareContext,
          encounterId: selectedCareContext.encounterId,
          careSetting: selectedCareContext.careSetting,
          relationship: 'REVIEWER',
          patient360Revision: projection.revision,
          patient360SourceCheckpoint: projection.sourceCheckpoint,
          unreadClinicalChanges: 0,
          unresolvedItemsCount: openItems.length,
          criticalItemsCount: openItems.filter(
            (item) => item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED'
          ).length,
          pendingDiagnosticCount: openItems.filter(
            (item) => item.category === 'DIAGNOSTIC'
          ).length,
          unacknowledgedResultCount: openItems.filter(
            (item) =>
              item.category === 'DIAGNOSTIC' &&
              item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED' &&
              item.status === 'OPEN'
          ).length,
          medicationChangesCount: 0,
          dataQualityState:
            projection.dataQuality.missingCanonicalFacts.length > 0
              ? 'REVIEW_REQUIRED'
              : 'COMPLETE',
          changes: [],
          openItems,
          generatedAt: projection.projectedAt,
        }
      : null;

  return {
    tenantId,
    patientId,
    projection,
    timeline: [],
    selectedCareContext,
    dischargeReadiness,
    deterioration,
    medicationSafety,
    consultantVisibility,
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
      medicationSafety:
        (payload.medicationSafety as MedicationSafetyProjection | null) || null,
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


export async function recordConsultantPatientReview(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    careSetting: 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH';
    patient360Revision: number;
    patient360SourceCheckpoint: string;
    reviewedChangeIds?: string[];
    note?: string;
  }
): Promise<Record<string, unknown>> {
  const commandId = `cmd_consultant_review_${crypto.randomUUID()}`;
  const idempotencyKey = `consultant-review:${input.encounterId}:${input.patient360SourceCheckpoint}`;

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
          commandType: 'RecordConsultantPatientReviewCommand',
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
      'Consultant review checkpoint could not be recorded.'
    );
  }

  return payload as Record<string, unknown>;
}

export async function completeMedicationReconciliation(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    reconciledMedicationIds: string[];
    discrepancyCount: number;
    unresolvedDiscrepancies?: string[];
    notes?: string;
  }
): Promise<Record<string, unknown>> {
  const commandId = `cmd_medrec_${crypto.randomUUID()}`;
  const idempotencyKey = `medrec:${input.encounterId}:${crypto.randomUUID()}`;

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
          commandType: 'CompleteMedicationReconciliationCommand',
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
        'Medication reconciliation could not be completed.'
    );
  }
  return payload as Record<string, unknown>;
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


export async function generateLongitudinalClinicalSummary(
  tenantId: string,
  patientId: string
): Promise<ClinicalLongitudinalSummaryResponse> {
  const response = await AuthClient.authorizedFetch(
    `/api/clinical/intelligence/longitudinal-summary?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, patientId }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.summary) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        'Longitudinal clinical summary could not be generated.'
    );
  }

  return {
    summary: payload.summary,
    evidenceIndex: payload.evidenceIndex || [],
  } as ClinicalLongitudinalSummaryResponse;
}


export async function generateEncounterPreparationBrief(
  tenantId: string,
  input: {
    patientId: string;
    encounterId: string;
    careSetting?: ClinicalCareSetting;
  }
): Promise<ClinicalEncounterPreparationResponse> {
  const response = await AuthClient.authorizedFetch(
    `/api/clinical/intelligence/encounter-preparation?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...input }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.brief) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        'Encounter preparation brief could not be generated.'
    );
  }

  return {
    brief: payload.brief,
    evidenceIndex: payload.evidenceIndex || [],
  } as ClinicalEncounterPreparationResponse;
}


export async function generateClinicalTrendIntelligence(
  tenantId: string,
  patientId: string
): Promise<ClinicalTrendIntelligenceResponse> {
  const response = await AuthClient.authorizedFetch(
    `/api/clinical/intelligence/trends?tenantId=${encodeURIComponent(tenantId)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, patientId }),
    },
    tenantId
  );

  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload?.artifact) {
    throw new Error(
      payload?.error?.message ||
        payload?.error ||
        'Clinical trend intelligence could not be generated.'
    );
  }

  return {
    artifact: payload.artifact,
    evidenceIndex: payload.evidenceIndex || [],
  } as ClinicalTrendIntelligenceResponse;
}
