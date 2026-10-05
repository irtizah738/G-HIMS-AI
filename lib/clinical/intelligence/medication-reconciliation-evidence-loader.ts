import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalAllergy,
  MedicationAdministration,
  MedicationDispense,
  MedicationOrder,
} from '@/types/clinical-canonical';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { ClinicalEvidenceSourceType } from '@/types/clinical-intelligence-evidence';
import type { Patient360Projection } from '@/types/patient360-projection';

export interface MedicationReconciliationEvidenceCandidate {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  sourceEventIds?: string[];
  content: unknown;
}

export interface MedicationReconciliationEvidenceSources {
  candidates: MedicationReconciliationEvidenceCandidate[];
  coverage: Record<
    string,
    { status: 'COMPLETE' | 'NOT_INCLUDED'; recordCount: number }
  >;
  selectedEncounterId: string;
  careSetting: ClinicalCareSetting;
}

function text(value: unknown): string {
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

function conceptText(
  concept:
    | { text?: string; codings?: Array<{ display?: string; code?: string }> }
    | undefined,
  fallback: string
): string {
  return (
    concept?.text ||
    concept?.codings?.[0]?.display ||
    concept?.codings?.[0]?.code ||
    fallback
  );
}

function selectedEncounter(
  projection: Patient360Projection,
  options: { encounterId?: string; careSetting?: ClinicalCareSetting }
) {
  if (options.encounterId) {
    const exact = projection.recentEncounters.find(
      (item) => item.encounterId === options.encounterId
    );
    if (exact) return exact;
  }

  if (options.careSetting === 'IPD') {
    return (
      projection.careContexts.activeIpdEncounter ||
      projection.careContexts.latestIpdEncounter
    );
  }
  if (options.careSetting === 'EMERGENCY') {
    return (
      projection.careContexts.activeEmergencyEncounter ||
      projection.careContexts.latestEmergencyEncounter
    );
  }
  if (options.careSetting === 'TELEHEALTH') {
    return (
      projection.careContexts.activeTelehealthEncounters[0] ||
      projection.careContexts.latestTelehealthEncounter
    );
  }
  if (options.careSetting === 'OPD') {
    return (
      projection.careContexts.activeOpdEncounters[0] ||
      projection.careContexts.latestOpdEncounter
    );
  }

  return (
    projection.activeEncounter ||
    projection.careContexts.activeIpdEncounter ||
    projection.careContexts.activeEmergencyEncounter ||
    projection.careContexts.activeOpdEncounters[0] ||
    projection.careContexts.activeTelehealthEncounters[0] ||
    projection.careContexts.latestIpdEncounter ||
    projection.careContexts.latestEmergencyEncounter ||
    projection.careContexts.latestOpdEncounter ||
    projection.careContexts.latestTelehealthEncounter
  );
}

export class MedicationReconciliationEvidenceLoader {
  public static async load(
    context: CommandContext,
    patientId: string,
    projection: Patient360Projection,
    options: { encounterId?: string; careSetting?: ClinicalCareSetting } = {}
  ): Promise<MedicationReconciliationEvidenceSources> {
    const encounter = selectedEncounter(projection, options);
    if (!encounter?.encounterId) {
      throw new Error('CI10E_ACTIVE_ENCOUNTER_REQUIRED');
    }

    const encounterId = encounter.encounterId;
    const careSetting =
      (encounter.careSetting || options.careSetting || 'UNKNOWN') as ClinicalCareSetting;

    const [
      encounterRecord,
      orders,
      dispenses,
      administrations,
      reconciliationRecords,
      allergies,
      medicationSafety,
    ] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<MedicationOrder>(
        context.tenantId,
        'medicationOrders',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<MedicationDispense>(
        context.tenantId,
        'medicationDispenses',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<MedicationAdministration>(
        context.tenantId,
        'canonicalMedicationAdministrations',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        context.tenantId,
        'encounterEvidence',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<ClinicalAllergy>(
        context.tenantId,
        'clinicalAllergies',
        'patientId',
        patientId
      ),
      MedicationSafetyService.getProjection(context.tenantId, patientId),
    ]);

    if (
      encounterRecord &&
      text(encounterRecord.patientId) !== patientId
    ) {
      throw new Error('CI10E_ENCOUNTER_PATIENT_MISMATCH');
    }

    const medReconciliations = reconciliationRecords.filter(
      (item) =>
        text(item.evidenceType).toUpperCase() ===
        'MEDICATION_RECONCILIATION'
    );

    const candidates: MedicationReconciliationEvidenceCandidate[] = [
      {
        sourceType: 'ENCOUNTER_CONTEXT',
        sourceEntityId: encounterId,
        label: `${careSetting} medication reconciliation context`,
        status: encounter.status,
        occurredAt: timestamp(encounter.startedAt),
        content: {
          encounter,
          authoritativeEncounter: encounterRecord || null,
          medicationKnowledge: projection.dataQuality.medicationKnowledge,
          lastMedicationReconciliationAt:
            projection.dataQuality.lastMedicationReconciliationAt || null,
        },
      },
      {
        sourceType: 'KNOWLEDGE_STATUS',
        sourceEntityId: `${patientId}:medication-knowledge`,
        label: 'Medication knowledge status',
        occurredAt: projection.dataQuality.lastMedicationReconciliationAt,
        content: {
          medicationKnowledge: projection.dataQuality.medicationKnowledge,
          lastMedicationReconciliationAt:
            projection.dataQuality.lastMedicationReconciliationAt || null,
          missingCanonicalFacts:
            projection.dataQuality.missingCanonicalFacts || [],
        },
      },
      ...orders.map((item) => ({
        sourceType: 'MEDICATION_HISTORY' as const,
        sourceEntityId: item.medicationOrderId,
        label: conceptText(item.medication, 'Medication order'),
        status: item.status,
        occurredAt: item.authoredAt,
        content: item,
      })),
      ...dispenses.map((item) => ({
        sourceType: 'MEDICATION_DISPENSE' as const,
        sourceEntityId: item.medicationDispenseId,
        label: conceptText(item.medication, 'Medication dispense'),
        status: item.status,
        occurredAt: item.dispensedAt,
        content: item,
      })),
      ...administrations.map((item) => ({
        sourceType: 'MEDICATION_ADMINISTRATION' as const,
        sourceEntityId: item.medicationAdministrationId,
        label: conceptText(item.medication, 'Medication administration'),
        status: item.status,
        occurredAt: item.administeredAt,
        content: item,
      })),
      ...medReconciliations.map((item) => ({
        sourceType: 'MEDICATION_RECONCILIATION' as const,
        sourceEntityId: text(item.evidenceId) || `medrec-${text(item.completedAt)}`,
        label: 'Medication reconciliation record',
        status: text(item.status) || 'FINAL',
        occurredAt: timestamp(item.completedAt || item.createdAt),
        content: item,
      })),
      ...allergies.map((item) => ({
        sourceType: 'ALLERGY' as const,
        sourceEntityId: item.allergyId,
        label: conceptText(item.substance, 'Allergy/intolerance'),
        status: `${item.clinicalStatus}/${item.verificationStatus}`,
        occurredAt: item.recordedAt,
        content: item,
      })),
    ];

    const ci9Current =
      medicationSafety &&
      medicationSafety.patient360Revision === projection.revision &&
      medicationSafety.patient360SourceCheckpoint === projection.sourceCheckpoint &&
      (!medicationSafety.encounterId ||
        medicationSafety.encounterId === encounterId);

    if (ci9Current && medicationSafety) {
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

    return {
      candidates: candidates.filter((item) => Boolean(item.sourceEntityId)),
      coverage: {
        encounterContext: { status: 'COMPLETE', recordCount: 1 },
        medicationOrders: { status: 'COMPLETE', recordCount: orders.length },
        medicationDispenses: {
          status: 'COMPLETE',
          recordCount: dispenses.length,
        },
        medicationAdministrations: {
          status: 'COMPLETE',
          recordCount: administrations.length,
        },
        medicationReconciliations: {
          status: 'COMPLETE',
          recordCount: medReconciliations.length,
        },
        medicationAllergies: {
          status: 'COMPLETE',
          recordCount: allergies.length,
        },
        medicationSafety: {
          status: ci9Current ? 'COMPLETE' : 'NOT_INCLUDED',
          recordCount:
            ci9Current && medicationSafety
              ? medicationSafety.findings.length
              : 0,
        },
      },
      selectedEncounterId: encounterId,
      careSetting,
    };
  }
}
