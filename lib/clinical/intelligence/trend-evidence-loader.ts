import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { ClinicalObservation } from '@/types/clinical-canonical';
import type { ClinicalEvidenceSourceType } from '@/types/clinical-intelligence-evidence';

export interface TrendEvidenceCandidate {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  content: unknown;
}

export interface TrendEvidenceSources {
  candidates: TrendEvidenceCandidate[];
  coverage: Record<
    string,
    {
      status: 'COMPLETE' | 'NOT_INCLUDED';
      recordCount: number;
    }
  >;
}

function conceptText(
  concept: { text?: string; codings?: Array<{ display?: string; code?: string }> } | undefined,
  fallback: string
): string {
  if (!concept) return fallback;
  return (
    concept.text ||
    concept.codings?.[0]?.display ||
    concept.codings?.[0]?.code ||
    fallback
  );
}

export class TrendEvidenceLoader {
  public static async load(
    tenantId: string,
    patientId: string
  ): Promise<TrendEvidenceSources> {
    const observations =
      await DomainStateRepository.queryAllEqual<ClinicalObservation>(
        tenantId,
        'clinicalObservations',
        'patientId',
        patientId
      );

    return {
      candidates: observations.map((item) => ({
        sourceType: 'OBSERVATION_HISTORY',
        sourceEntityId: item.observationId,
        label: conceptText(item.code, 'Clinical observation'),
        status: item.status,
        occurredAt: item.effectiveAt,
        content: item,
      })),
      coverage: {
        observations: {
          status: 'COMPLETE',
          recordCount: observations.length,
        },
      },
    };
  }
}
