import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { LongitudinalEvidenceLoader } from '@/lib/clinical/intelligence/longitudinal-evidence-loader';
import { ConsultantVisibilityService } from '@/lib/clinical/intelligence/consultant-visibility-service';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import { ClinicalDeteriorationService } from '@/lib/clinical/intelligence/clinical-deterioration-service';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalCareSetting,
  ConsultantPatientStateProjection,
} from '@/types/consultant-visibility';
import type {
  ClinicalEvidenceSourceType,
} from '@/types/clinical-intelligence-evidence';
import type { Patient360Projection } from '@/types/patient360-projection';

export interface EncounterPreparationEvidenceCandidate {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  sourceEventIds?: string[];
  content: unknown;
}

export interface EncounterPreparationEvidenceSources {
  candidates: EncounterPreparationEvidenceCandidate[];
  coverage: Record<
    string,
    {
      status: 'COMPLETE' | 'NOT_INCLUDED';
      recordCount: number;
    }
  >;
  selectedEncounterId: string;
  careSetting: ClinicalCareSetting;
  lastConsultantReviewAt?: number;
  lastConsultantReviewRevision?: number;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim();
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function flattenDeterioration(
  projection: Awaited<ReturnType<typeof ClinicalDeteriorationService.getProjection>>
) {
  if (!projection) return [];
  return [
    ...projection.critical,
    ...projection.escalations,
    ...projection.warnings,
    ...projection.information,
  ];
}

function flattenDischarge(
  projection: Awaited<ReturnType<typeof DischargeReadinessService.getProjection>>
) {
  if (!projection) return [];
  return [
    ...projection.blockers,
    ...projection.warnings,
    ...projection.information,
  ];
}

function changeCandidates(
  visibility: ConsultantPatientStateProjection | null
): EncounterPreparationEvidenceCandidate[] {
  if (!visibility) return [];

  return visibility.changes.map((item) => ({
    sourceType: 'CONSULTANT_CHANGE',
    sourceEntityId: item.changeId,
    label: item.statement,
    status: item.severity,
    occurredAt: item.occurredAt,
    sourceEventIds: item.sourceEventIds,
    content: item,
  }));
}

function openItemCandidates(
  visibility: ConsultantPatientStateProjection | null
): EncounterPreparationEvidenceCandidate[] {
  if (!visibility) return [];

  return visibility.openItems.map((item) => ({
    sourceType: 'CLINICAL_OPEN_ITEM',
    sourceEntityId: item.openItemId,
    label: item.description,
    status: `${item.status}/${item.clinicalPriority}`,
    occurredAt: item.createdAt,
    sourceEventIds: item.lastSourceEventId ? [item.lastSourceEventId] : [],
    content: item,
  }));
}

export class EncounterPreparationEvidenceLoader {
  public static async load(
    context: CommandContext,
    patientId: string,
    projection: Patient360Projection,
    options: { encounterId?: string; careSetting?: ClinicalCareSetting } = {}
  ): Promise<EncounterPreparationEvidenceSources> {
    let encounter =
      (options.encounterId
        ? projection.recentEncounters.find(
            (item) => item.encounterId === options.encounterId
          )
        : undefined) ||
      (options.careSetting === 'IPD'
        ? projection.careContexts.activeIpdEncounter ||
          projection.careContexts.latestIpdEncounter
        : options.careSetting === 'EMERGENCY'
          ? projection.careContexts.activeEmergencyEncounter ||
            projection.careContexts.latestEmergencyEncounter
          : options.careSetting === 'TELEHEALTH'
            ? projection.careContexts.activeTelehealthEncounters[0] ||
              projection.careContexts.latestTelehealthEncounter
            : options.careSetting === 'OPD'
              ? projection.careContexts.activeOpdEncounters[0] ||
                projection.careContexts.latestOpdEncounter
              : projection.activeEncounter ||
                projection.careContexts.activeOpdEncounters[0] ||
                projection.careContexts.activeIpdEncounter ||
                projection.careContexts.activeEmergencyEncounter);

    if (!encounter?.encounterId && options.encounterId) {
      const direct = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        options.encounterId
      );
      if (direct && normalized(direct.patientId) === patientId) {
        const encounterType = String(direct.encounterType || direct.type || 'UNKNOWN');
        encounter = {
          encounterId: options.encounterId,
          encounterType,
          careSetting: String(direct.careSetting || options.careSetting || encounterType) as any,
          status: String(direct.status || 'UNKNOWN'),
          chiefComplaint: String(direct.chiefComplaint || '') || undefined,
        };
      }
    }

    if (!encounter?.encounterId) {
      throw new Error('CI10C_ACTIVE_ENCOUNTER_REQUIRED');
    }

    const encounterId = encounter.encounterId;
    const careSetting =
      (encounter.careSetting || options.careSetting || 'UNKNOWN') as ClinicalCareSetting;

    const [
      longitudinal,
      encounterRecord,
      consultantVisibility,
      medicationSafety,
      deterioration,
      dischargeReadiness,
    ] = await Promise.all([
      LongitudinalEvidenceLoader.load(context.tenantId, patientId),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        encounterId
      ),
      ConsultantVisibilityService.buildForActor(context, patientId, {
        encounterId,
        careSetting,
        timelineLimit: 500,
      }),
      MedicationSafetyService.getProjection(context.tenantId, patientId),
      ClinicalDeteriorationService.getProjection(
        context.tenantId,
        encounterId
      ),
      careSetting === 'IPD'
        ? DischargeReadinessService.getProjection(
            context.tenantId,
            encounterId
          )
        : Promise.resolve(null),
    ]);

    if (
      encounterRecord &&
      normalized(encounterRecord.patientId) !== patientId
    ) {
      throw new Error('CI10C_ENCOUNTER_PATIENT_MISMATCH');
    }

    if (
      consultantVisibility &&
      consultantVisibility.encounterId &&
      consultantVisibility.encounterId !== encounterId
    ) {
      throw new Error('CI10C_CONSULTANT_CONTEXT_MISMATCH');
    }

    const candidates: EncounterPreparationEvidenceCandidate[] = [
      ...longitudinal.candidates,
      {
        sourceType: 'ENCOUNTER_CONTEXT',
        sourceEntityId: encounterId,
        label: `${careSetting} encounter context`,
        status: encounter.status,
        occurredAt: timestamp(encounter.startedAt),
        content: {
          encounter,
          authoritativeEncounter: encounterRecord || null,
          consultantRelationship:
            consultantVisibility?.relationship || 'REVIEWER',
          lastConsultantReviewAt:
            consultantVisibility?.lastReviewedAt || null,
          lastConsultantReviewRevision:
            consultantVisibility?.lastReviewedRevision || null,
        },
      },
      ...changeCandidates(consultantVisibility),
      ...openItemCandidates(consultantVisibility),
    ];

    const medSafetyCurrent =
      medicationSafety &&
      medicationSafety.patient360Revision === projection.revision &&
      medicationSafety.patient360SourceCheckpoint === projection.sourceCheckpoint &&
      (!medicationSafety.encounterId ||
        medicationSafety.encounterId === encounterId);

    if (medSafetyCurrent && medicationSafety) {
      candidates.push(
        ...medicationSafety.findings.map((finding) => ({
          sourceType: 'MEDICATION_SAFETY_FINDING' as const,
          sourceEntityId: finding.findingId,
          label: finding.title,
          status: finding.severity,
          occurredAt: finding.detectedAt,
          content: finding,
        }))
      );
    }

    const deteriorationCurrent =
      deterioration &&
      deterioration.patient360Revision === projection.revision &&
      deterioration.patient360SourceCheckpoint === projection.sourceCheckpoint;

    if (deteriorationCurrent && deterioration) {
      candidates.push(
        ...flattenDeterioration(deterioration).map((finding) => ({
          sourceType: 'DETERIORATION_FINDING' as const,
          sourceEntityId: finding.findingId,
          label: finding.title,
          status: finding.severity,
          occurredAt: deterioration.evaluatedAt,
          sourceEventIds: finding.evidence
            .map((item) => item.eventId)
            .filter((value): value is string => Boolean(value)),
          content: finding,
        }))
      );
    }

    const dischargeCurrent =
      dischargeReadiness &&
      dischargeReadiness.patient360Revision === projection.revision &&
      dischargeReadiness.patient360SourceCheckpoint === projection.sourceCheckpoint;

    if (dischargeCurrent && dischargeReadiness) {
      candidates.push(
        ...flattenDischarge(dischargeReadiness).map((finding) => ({
          sourceType: 'DISCHARGE_READINESS_FINDING' as const,
          sourceEntityId: finding.findingId,
          label: finding.title,
          status: finding.severity,
          occurredAt: dischargeReadiness.evaluatedAt,
          sourceEventIds: finding.evidence
            .map((item) => item.eventId)
            .filter((value): value is string => Boolean(value)),
          content: finding,
        }))
      );
    }

    return {
      candidates,
      coverage: {
        ...longitudinal.coverage,
        encounterContext: { status: 'COMPLETE', recordCount: 1 },
        consultantChanges: {
          status: consultantVisibility ? 'COMPLETE' : 'NOT_INCLUDED',
          recordCount: consultantVisibility?.changes.length || 0,
        },
        clinicalOpenItems: {
          status: consultantVisibility ? 'COMPLETE' : 'NOT_INCLUDED',
          recordCount: consultantVisibility?.openItems.length || 0,
        },
        medicationSafety: {
          status: medSafetyCurrent ? 'COMPLETE' : 'NOT_INCLUDED',
          recordCount:
            medSafetyCurrent && medicationSafety
              ? medicationSafety.findings.length
              : 0,
        },
        deterioration: {
          status: deteriorationCurrent ? 'COMPLETE' : 'NOT_INCLUDED',
          recordCount:
            deteriorationCurrent && deterioration
              ? flattenDeterioration(deterioration).length
              : 0,
        },
        dischargeReadiness: {
          status:
            careSetting !== 'IPD'
              ? 'NOT_INCLUDED'
              : dischargeCurrent
                ? 'COMPLETE'
                : 'NOT_INCLUDED',
          recordCount:
            dischargeCurrent && dischargeReadiness
              ? flattenDischarge(dischargeReadiness).length
              : 0,
        },
      },
      selectedEncounterId: encounterId,
      careSetting,
      lastConsultantReviewAt: consultantVisibility?.lastReviewedAt,
      lastConsultantReviewRevision:
        consultantVisibility?.lastReviewedRevision,
    };
  }
}
