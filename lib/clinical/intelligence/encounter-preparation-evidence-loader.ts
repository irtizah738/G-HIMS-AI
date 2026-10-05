import { ConsultantVisibilityService } from '@/lib/clinical/intelligence/consultant-visibility-service';
import { LongitudinalEvidenceLoader } from '@/lib/clinical/intelligence/longitudinal-evidence-loader';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalEvidenceSupplementalCandidate,
  ClinicalEvidenceSupplementalSources,
} from '@/lib/clinical/intelligence/longitudinal-evidence-loader';

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export class EncounterPreparationEvidenceLoader {
  public static async load(
    context: CommandContext,
    patientId: string,
    encounterId: string
  ): Promise<ClinicalEvidenceSupplementalSources> {
    const [longitudinal, visibility, patient360] = await Promise.all([
      LongitudinalEvidenceLoader.load(context.tenantId, patientId),
      ConsultantVisibilityService.buildForActor(context, patientId, {
        encounterId,
        timelineLimit: 500,
      }),
      Patient360ProjectionService.getProjection(context.tenantId, patientId),
    ]);

    if (!patient360) {
      throw new Error('CI10_PATIENT360_PROJECTION_NOT_READY');
    }

    if (!visibility?.encounter || visibility.encounterId !== encounterId) {
      throw new Error('CI10C_ENCOUNTER_CONTEXT_NOT_FOUND');
    }

    if (visibility.patientId !== patientId) {
      throw new Error('CI10C_ENCOUNTER_PATIENT_MISMATCH');
    }

    if (
      visibility.patient360Revision !== patient360.revision ||
      visibility.patient360SourceCheckpoint !== patient360.sourceCheckpoint
    ) {
      throw new Error('CI10C_CONTEXT_REVISION_RACE');
    }

    const medicationSafety =
      MedicationSafetyService.evaluateProjection(patient360);

    const candidates: ClinicalEvidenceSupplementalCandidate[] = [
      ...longitudinal.candidates,
      {
        sourceType: 'ENCOUNTER_CONTEXT',
        sourceEntityId: encounterId,
        label: `${visibility.careSetting} encounter preparation context`,
        status: visibility.encounter.status,
        occurredAt: timestamp(visibility.encounter.startedAt),
        sourceEntityRefs: [encounterId],
        content: {
          encounter: visibility.encounter,
          relationship: visibility.relationship,
          lastReviewedAt: visibility.lastReviewedAt,
          lastReviewedRevision: visibility.lastReviewedRevision,
          patient360Revision: visibility.patient360Revision,
          patient360SourceCheckpoint: visibility.patient360SourceCheckpoint,
        },
      },
      ...visibility.changes.map((item) => ({
        sourceType: 'CONSULTANT_CHANGE' as const,
        sourceEntityId: item.changeId,
        label: item.statement,
        status: item.severity,
        occurredAt: item.occurredAt,
        sourceEventIds: item.sourceEventIds,
        sourceEntityRefs: [item.eventId],
        content: item,
      })),
      ...visibility.openItems.map((item) => ({
        sourceType: 'CLINICAL_OPEN_ITEM' as const,
        sourceEntityId: item.openItemId,
        label: item.description,
        status: `${item.clinicalPriority}/${item.status}`,
        occurredAt: item.createdAt,
        sourceEventIds: item.lastSourceEventId
          ? [item.lastSourceEventId]
          : [],
        sourceEntityRefs: item.sourceRefs,
        content: item,
      })),
      ...medicationSafety.findings
        .filter(
          (item) => !item.encounterId || item.encounterId === encounterId
        )
        .map((item) => ({
          sourceType: 'MEDICATION_SAFETY_FINDING' as const,
          sourceEntityId: item.findingId,
          label: item.title,
          status: item.severity,
          occurredAt: item.detectedAt,
          sourceEntityRefs: [
            ...item.medicationOrderIds,
            ...item.allergyIds,
            ...item.evidence.map((evidence) => evidence.entityId),
          ],
          content: item,
        })),
    ];

    return {
      candidates,
      scope: {
        encounterId,
        careSetting: visibility.careSetting,
        actorId: context.actorId,
        lastReviewedAt: visibility.lastReviewedAt,
        lastReviewedRevision: visibility.lastReviewedRevision,
      },
      coverage: {
        ...longitudinal.coverage,
        consultantChanges: {
          status: 'COMPLETE',
          recordCount: visibility.changes.length,
        },
        clinicalOpenItems: {
          status: 'COMPLETE',
          recordCount: visibility.openItems.length,
        },
        medicationSafetyFindings: {
          status: 'COMPLETE',
          recordCount: medicationSafety.findings.filter(
            (item) => !item.encounterId || item.encounterId === encounterId
          ).length,
        },
      },
    };
  }
}
