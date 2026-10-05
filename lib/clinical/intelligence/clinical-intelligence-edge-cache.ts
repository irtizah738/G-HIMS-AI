'use client';

import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import {
  listSecureEdgeEntities,
  putSecureEdgeEntities,
} from '@/lib/offline/secure-store';
import type { ClinicalLongitudinalSummaryResponse } from '@/types/clinical-longitudinal-summary';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';
import type { ClinicalTrendIntelligenceResponse } from '@/types/clinical-trend-intelligence';
import type { MedicationReconciliationCopilotResponse } from '@/types/medication-reconciliation-copilot';
import type { ClinicalCopilotWorkspaceArtifacts } from '@/types/clinical-copilot-workspace';
import type { ClinicalIntelligenceEdgeCacheMetadata } from '@/types/clinical-intelligence-production';

export const CLINICAL_INTELLIGENCE_EDGE_COLLECTION =
  'clinicalIntelligenceArtifacts';

type CacheableArtifactKey =
  | 'LONGITUDINAL'
  | 'ENCOUNTER_PREP'
  | 'TRENDS'
  | 'MEDICATIONS';

type CacheableArtifactMap = {
  LONGITUDINAL: ClinicalLongitudinalSummaryResponse;
  ENCOUNTER_PREP: ClinicalEncounterPreparationResponse;
  TRENDS: ClinicalTrendIntelligenceResponse;
  MEDICATIONS: MedicationReconciliationCopilotResponse;
};

interface CachedClinicalIntelligenceArtifact<
  K extends CacheableArtifactKey = CacheableArtifactKey,
> extends Record<string, unknown> {
  id: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  key: K;
  cachedAt: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  source: ClinicalIntelligenceEdgeCacheMetadata['source'];
  payload: CacheableArtifactMap[K];
}

function normalize(value: string): string {
  return String(value || '').trim();
}

function cacheId(
  patientId: string,
  encounterId: string | undefined,
  key: CacheableArtifactKey
): string {
  return [
    'ci10',
    normalize(patientId),
    normalize(encounterId || 'patient'),
    key.toLowerCase(),
  ].join(':');
}

function artifactFreshness<K extends CacheableArtifactKey>(
  key: K,
  payload: CacheableArtifactMap[K]
): Pick<
  ClinicalIntelligenceEdgeCacheMetadata,
  'patient360Revision' | 'patient360SourceCheckpoint'
> {
  switch (key) {
    case 'LONGITUDINAL': {
      const value = payload as ClinicalLongitudinalSummaryResponse;
      return {
        patient360Revision: value.summary.patient360Revision,
        patient360SourceCheckpoint:
          value.summary.patient360SourceCheckpoint,
      };
    }
    case 'ENCOUNTER_PREP': {
      const value = payload as ClinicalEncounterPreparationResponse;
      return {
        patient360Revision: value.brief.patient360Revision,
        patient360SourceCheckpoint:
          value.brief.patient360SourceCheckpoint,
      };
    }
    case 'TRENDS': {
      const value = payload as ClinicalTrendIntelligenceResponse;
      return {
        patient360Revision: value.artifact.patient360Revision,
        patient360SourceCheckpoint:
          value.artifact.patient360SourceCheckpoint,
      };
    }
    case 'MEDICATIONS': {
      const value = payload as MedicationReconciliationCopilotResponse;
      return {
        patient360Revision: value.artifact.patient360Revision,
        patient360SourceCheckpoint:
          value.artifact.patient360SourceCheckpoint,
      };
    }
  }
}

export async function cacheAuthoritativeClinicalIntelligence<
  K extends CacheableArtifactKey,
>(
  tenantId: string,
  patientId: string,
  encounterId: string | undefined,
  key: K,
  payload: CacheableArtifactMap[K]
): Promise<void> {
  const cached = await getCachedAuthSession();
  const normalizedTenant = normalize(tenantId).toLowerCase();
  if (
    !cached ||
    cached.user.tenantId.trim().toLowerCase() !== normalizedTenant
  ) {
    throw new Error('CI10I_EDGE_CACHE_SESSION_SCOPE_MISMATCH');
  }

  const freshness = artifactFreshness(key, payload);
  const record: CachedClinicalIntelligenceArtifact<K> = {
    id: cacheId(patientId, encounterId, key),
    tenantId: normalizedTenant,
    patientId: normalize(patientId),
    ...(encounterId ? { encounterId: normalize(encounterId) } : {}),
    key,
    cachedAt: Date.now(),
    patient360Revision: freshness.patient360Revision,
    patient360SourceCheckpoint: freshness.patient360SourceCheckpoint,
    source: 'AUTHORITATIVE_SERVER',
    payload,
  };

  await putSecureEdgeEntities(
    normalizedTenant,
    cached.user.uid,
    CLINICAL_INTELLIGENCE_EDGE_COLLECTION,
    [record]
  );
}

export async function loadCachedClinicalIntelligence(
  tenantId: string,
  patientId: string,
  encounterId?: string
): Promise<ClinicalCopilotWorkspaceArtifacts> {
  const cached = await getCachedAuthSession();
  const normalizedTenant = normalize(tenantId).toLowerCase();
  if (
    !cached ||
    cached.user.tenantId.trim().toLowerCase() !== normalizedTenant
  ) {
    return {
      longitudinal: null,
      encounterPreparation: null,
      trends: null,
      medicationReconciliation: null,
      draft: null,
    };
  }

  const rows = await listSecureEdgeEntities<CachedClinicalIntelligenceArtifact>(
    normalizedTenant,
    cached.user.uid,
    CLINICAL_INTELLIGENCE_EDGE_COLLECTION
  );

  const relevant = rows
    .filter(
      (row) =>
        row.patientId === normalize(patientId) &&
        (!row.encounterId ||
          (encounterId && row.encounterId === normalize(encounterId)))
    )
    .sort((left, right) => right.cachedAt - left.cachedAt);

  const latest = new Map<CacheableArtifactKey, CachedClinicalIntelligenceArtifact>();
  for (const row of relevant) {
    if (!latest.has(row.key)) latest.set(row.key, row);
  }

  return {
    longitudinal:
      (latest.get('LONGITUDINAL')?.payload as
        | ClinicalLongitudinalSummaryResponse
        | undefined) || null,
    encounterPreparation:
      (latest.get('ENCOUNTER_PREP')?.payload as
        | ClinicalEncounterPreparationResponse
        | undefined) || null,
    trends:
      (latest.get('TRENDS')?.payload as
        | ClinicalTrendIntelligenceResponse
        | undefined) || null,
    medicationReconciliation:
      (latest.get('MEDICATIONS')?.payload as
        | MedicationReconciliationCopilotResponse
        | undefined) || null,
    // Governed drafts deliberately remain online-only. An offline workstation
    // may read authoritative B-E intelligence but never carries a draft
    // lifecycle forward from edge state.
    draft: null,
  };
}
