import type {
  ClinicalObservation,
  ClinicalProvenance,
  CodeableConcept,
  DiagnosticReport,
  ObservationValue,
  ReferenceRange,
} from '@/types/clinical-canonical';
import { TerminologyService } from '@/lib/clinical/terminology/terminology-service';

export interface DiagnosticResultItemInput {
  code: string;
  display: string;
  codingSystem?: string;
  value: string | number;
  unit?: string;
  unitCode?: string;
  referenceRange?: string;
  abnormalFlag?: string;
  status?: 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED';
  observedAt?: number;
}

export interface BuildDiagnosticResultFactsInput {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  orderId: string;
  reportId: string;
  actorId: string;
  sourceType: 'LAB_SYSTEM' | 'RADIOLOGY_SYSTEM' | 'CLINICIAN' | 'EXTERNAL_HL7';
  sourceSystem?: string;
  reportCode: string;
  reportDisplay: string;
  category: 'LAB' | 'RADIOLOGY' | 'PATHOLOGY' | 'OTHER';
  reportStatus: DiagnosticReport['status'];
  results: DiagnosticResultItemInput[];
  issuedAt: number;
  conclusion?: string;
  verifiedBy?: string;
  verifiedAt?: number;
  sourceEvidenceId: string;
}

function provenance(
  input: BuildDiagnosticResultFactsInput,
  sourceEvidenceId: string,
  effectiveAt?: number
): ClinicalProvenance {
  return {
    provenanceId: `prov_${sourceEvidenceId}`,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId,
    sourceType: input.sourceType,
    sourceSystem: input.sourceSystem,
    recordedBy: input.actorId,
    recordedAt: input.issuedAt,
    effectiveAt,
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt,
  };
}

function concept(system: string, code: string, display: string): CodeableConcept {
  const normalized = TerminologyService.normalizeCoding({ system, code, display });
  return { codings: [normalized], text: normalized.display || display };
}

function interpretation(flag?: string): CodeableConcept[] | undefined {
  const normalized = String(flag || '').trim().toUpperCase();
  if (!normalized || normalized === 'N' || normalized === 'NORMAL') return undefined;

  const map: Record<string, { code: string; display: string }> = {
    H: { code: 'H', display: 'High' },
    HIGH: { code: 'H', display: 'High' },
    L: { code: 'L', display: 'Low' },
    LOW: { code: 'L', display: 'Low' },
    HH: { code: 'HH', display: 'Critical high' },
    LL: { code: 'LL', display: 'Critical low' },
    C: { code: 'C', display: 'Critical' },
    CRITICAL: { code: 'C', display: 'Critical' },
    A: { code: 'A', display: 'Abnormal' },
    ABNORMAL: { code: 'A', display: 'Abnormal' },
  };
  const resolved = map[normalized] || { code: normalized, display: normalized };
  return [concept('LOCAL', `INTERP_${resolved.code}`, resolved.display)];
}

function resultStatus(
  status?: DiagnosticResultItemInput['status']
): ClinicalObservation['status'] {
  switch (status) {
    case 'PRELIMINARY':
      return 'PRELIMINARY';
    case 'AMENDED':
      return 'AMENDED';
    case 'CORRECTED':
      return 'CORRECTED';
    case 'FINAL':
    default:
      return 'FINAL';
  }
}

function parseReferenceRange(
  text?: string,
  unit?: string,
  unitCode?: string
): ReferenceRange[] | undefined {
  const raw = String(text || '').trim();
  if (!raw) return undefined;

  const range = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!range) return [{ text: raw }];

  const low = Number(range[1]);
  const high = Number(range[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [{ text: raw }];

  const knownUnit = unitCode ? TerminologyService.lookup('UCUM', unitCode) : null;
  return [{
    low: {
      value: low,
      unit: knownUnit?.display || unit || unitCode || '',
      ...(knownUnit ? { system: 'UCUM', code: knownUnit.code } : {}),
    },
    high: {
      value: high,
      unit: knownUnit?.display || unit || unitCode || '',
      ...(knownUnit ? { system: 'UCUM', code: knownUnit.code } : {}),
    },
    text: raw,
  }];
}

function valueForResult(result: DiagnosticResultItemInput): ObservationValue {
  const numeric =
    typeof result.value === 'number'
      ? result.value
      : String(result.value).trim() !== ''
        ? Number(result.value)
        : Number.NaN;

  if (Number.isFinite(numeric)) {
    const unitCode = result.unitCode?.trim();
    const knownUnit = unitCode ? TerminologyService.lookup('UCUM', unitCode) : null;
    return {
      valueType: 'QUANTITY',
      quantity: {
        value: numeric,
        unit: knownUnit?.display || result.unit || unitCode || '',
        ...(knownUnit ? { system: 'UCUM', code: knownUnit.code } : {}),
      },
    };
  }

  return { valueType: 'STRING', value: String(result.value) };
}

export function buildDiagnosticResultFacts(
  input: BuildDiagnosticResultFactsInput
): { observations: ClinicalObservation[]; report: DiagnosticReport } {
  const observations = input.results.map((result, index): ClinicalObservation => {
    const observationId = `obs_${input.reportId}_${index + 1}`;
    const effectiveAt = result.observedAt || input.issuedAt;

    return {
      observationId,
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.sourceEvidenceId,
      provenance: provenance(input, input.sourceEvidenceId, effectiveAt),
      createdAt: input.issuedAt,
      updatedAt: input.issuedAt,
      version: 1,
      category: input.category === 'RADIOLOGY' ? 'IMAGING' : 'LABORATORY',
      code: concept(result.codingSystem || 'LOCAL', result.code, result.display),
      value: valueForResult(result),
      effectiveAt,
      issuedAt: input.issuedAt,
      interpretation: interpretation(result.abnormalFlag),
      referenceRange: parseReferenceRange(
        result.referenceRange,
        result.unit,
        result.unitCode
      ),
      status: resultStatus(result.status),
      performerIds: [input.actorId],
    };
  });

  const report: DiagnosticReport = {
    diagnosticReportId: input.reportId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.sourceEvidenceId,
    provenance: provenance(input, input.sourceEvidenceId, input.issuedAt),
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
    version: 1,
    orderId: input.orderId,
    code: concept('LOCAL', input.reportCode, input.reportDisplay),
    category: input.category,
    status: input.reportStatus,
    resultObservationIds: observations.map((item) => item.observationId),
    conclusion: input.conclusion,
    issuedAt: input.issuedAt,
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt,
  };

  return { observations, report };
}
