import { EncounterPreparationEvidenceLoader } from '@/lib/clinical/intelligence/encounter-preparation-evidence-loader';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { CommandContext } from '@/lib/backend/types';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { Patient360Projection } from '@/types/patient360-projection';
import type { ClinicalConsultationRequest, ClinicalHandoff } from '@/types/clinical-coordination';
import type { ClinicalEvidenceSourceType } from '@/types/clinical-intelligence-evidence';

export interface ClinicalDraftEvidenceCandidate {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  sourceEventIds?: string[];
  content: unknown;
}

export interface ClinicalDraftEvidenceSources {
  candidates: ClinicalDraftEvidenceCandidate[];
  coverage: Record<string, { status: 'COMPLETE' | 'NOT_INCLUDED'; recordCount: number }>;
  selectedEncounterId: string;
  careSetting: ClinicalCareSetting;
}

export class ClinicalDraftEvidenceLoader {
  public static async load(
    context: CommandContext,
    patientId: string,
    projection: Patient360Projection,
    options: { encounterId?: string; careSetting?: ClinicalCareSetting } = {}
  ): Promise<ClinicalDraftEvidenceSources> {
    const base = await EncounterPreparationEvidenceLoader.load(
      context,
      patientId,
      projection,
      options
    );

    const [consultations, handoffs] = await Promise.all([
      DomainStateRepository.queryAllEqual<ClinicalConsultationRequest>(
        context.tenantId,
        'consultationRequests',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<ClinicalHandoff>(
        context.tenantId,
        'clinicalHandoffs',
        'patientId',
        patientId
      ),
    ]);

    const scopedConsultations = consultations.filter(
      (item) => item.encounterId === base.selectedEncounterId
    );
    const scopedHandoffs = handoffs.filter(
      (item) => item.encounterId === base.selectedEncounterId
    );

    return {
      candidates: [
        ...base.candidates,
        ...scopedConsultations.map((item) => ({
          sourceType: 'CLINICAL_CONSULTATION' as const,
          sourceEntityId: item.consultationId,
          label: `Consultation: ${item.requestedSpecialty}`,
          status: item.status,
          occurredAt: item.completedAt || item.acceptedAt || item.requestedAt,
          sourceEventIds: item.sourceRefs,
          content: item,
        })),
        ...scopedHandoffs.map((item) => ({
          sourceType: 'CLINICAL_HANDOFF' as const,
          sourceEntityId: item.handoffId,
          label: 'Clinical handoff',
          status: item.status,
          occurredAt: item.acceptedAt || item.createdAt,
          content: item,
        })),
      ],
      coverage: {
        ...base.coverage,
        consultations: { status: 'COMPLETE', recordCount: scopedConsultations.length },
        handoffs: { status: 'COMPLETE', recordCount: scopedHandoffs.length },
      },
      selectedEncounterId: base.selectedEncounterId,
      careSetting: base.careSetting,
    };
  }
}
