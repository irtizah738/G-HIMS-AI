import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  CarePlan,
  ClinicalObservation,
  ClinicalProcedure,
  DiagnosticOrder,
  DiagnosticReport,
  MedicationOrder,
} from '@/types/clinical-canonical';
import type { ClinicalEvidenceSourceType } from '@/types/clinical-intelligence-evidence';

export interface LongitudinalEvidenceCandidate {
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  content: unknown;
}

export interface LongitudinalEvidenceSources {
  candidates: LongitudinalEvidenceCandidate[];
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

function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export class LongitudinalEvidenceLoader {
  public static async load(
    tenantId: string,
    patientId: string
  ): Promise<LongitudinalEvidenceSources> {
    const [
      encounters,
      medications,
      observations,
      reports,
      orders,
      procedures,
      carePlans,
    ] = await Promise.all([
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'encounters',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<MedicationOrder>(
        tenantId,
        'medicationOrders',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<ClinicalObservation>(
        tenantId,
        'clinicalObservations',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<DiagnosticReport>(
        tenantId,
        'diagnosticReports',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<DiagnosticOrder>(
        tenantId,
        'canonicalDiagnosticOrders',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<ClinicalProcedure>(
        tenantId,
        'clinicalProcedures',
        'patientId',
        patientId
      ),
      DomainStateRepository.queryAllEqual<CarePlan>(
        tenantId,
        'carePlans',
        'patientId',
        patientId
      ),
    ]);

    const candidates: LongitudinalEvidenceCandidate[] = [
      ...encounters.map((item) => ({
        sourceType: 'ENCOUNTER_HISTORY' as const,
        sourceEntityId: String(item.encounterId || item.id || ''),
        label: String(
          item.careSetting ||
            item.encounterType ||
            item.type ||
            'Clinical encounter'
        ),
        status: String(item.status || 'UNKNOWN'),
        occurredAt: timestamp(item.startedAt || item.createdAt || item.admitDate),
        content: item,
      })),
      ...medications.map((item) => ({
        sourceType: 'MEDICATION_HISTORY' as const,
        sourceEntityId: item.medicationOrderId,
        label: conceptText(item.medication, 'Medication order'),
        status: item.status,
        occurredAt: item.authoredAt,
        content: item,
      })),
      ...observations.map((item) => ({
        sourceType: 'OBSERVATION_HISTORY' as const,
        sourceEntityId: item.observationId,
        label: conceptText(item.code, 'Clinical observation'),
        status: item.status,
        occurredAt: item.effectiveAt,
        content: item,
      })),
      ...reports.map((item) => ({
        sourceType: 'DIAGNOSTIC_REPORT_HISTORY' as const,
        sourceEntityId: item.diagnosticReportId,
        label: conceptText(item.code, 'Diagnostic report'),
        status: item.status,
        occurredAt: item.issuedAt,
        content: item,
      })),
      ...orders.map((item) => ({
        sourceType: 'DIAGNOSTIC_ORDER' as const,
        sourceEntityId: item.diagnosticOrderId,
        label: conceptText(item.service, 'Diagnostic order'),
        status: item.status,
        occurredAt: item.orderedAt,
        content: item,
      })),
      ...procedures.map((item) => ({
        sourceType: 'PROCEDURE' as const,
        sourceEntityId: item.procedureId,
        label: conceptText(item.code, 'Clinical procedure'),
        status: item.status,
        occurredAt: item.performedAt,
        content: item,
      })),
      ...carePlans.map((item) => ({
        sourceType: 'CARE_PLAN' as const,
        sourceEntityId: item.carePlanId,
        label: item.title || 'Care plan',
        status: item.status,
        occurredAt: item.authoredAt,
        content: item,
      })),
    ].filter((item) => Boolean(item.sourceEntityId));

    return {
      candidates,
      coverage: {
        encounters: { status: 'COMPLETE', recordCount: encounters.length },
        medicationOrders: { status: 'COMPLETE', recordCount: medications.length },
        observations: { status: 'COMPLETE', recordCount: observations.length },
        diagnosticReports: { status: 'COMPLETE', recordCount: reports.length },
        diagnosticOrders: { status: 'COMPLETE', recordCount: orders.length },
        procedures: { status: 'COMPLETE', recordCount: procedures.length },
        carePlans: { status: 'COMPLETE', recordCount: carePlans.length },
      },
    };
  }
}
