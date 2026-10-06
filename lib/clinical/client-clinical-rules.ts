/**
 * G-HIMS client-side clinical intake organizer.
 *
 * This module is deliberately non-diagnostic. It exists only for deterministic
 * organization of facts already supplied by the user/workflow when a UI needs
 * a local preview. It must never synthesize diagnoses, medications, orders,
 * probabilities, billing codes, or treatment plans.
 */

import type { AiOptimizationResult } from '@/lib/types/disease-intake';

export interface ClinicalOptimizationParams {
  templateId?: string;
  diseaseName?: string;
  guidedAnswers?: Record<string, unknown>;
  activeBranch?: { label?: string; nodeIds?: string[] };
  specialtyHistory?: Record<string, unknown>;
  riskSignals?: {
    score?: number;
    overallRisk?: string;
    primaryAlert?: string;
    flags?: string[];
  };
  patientContext?: {
    id?: string;
    name?: string;
    age?: number;
    gender?: string;
    mrn?: string;
    vitals?: {
      heartRate?: number;
      bp?: string;
      spO2?: number;
      temp?: string;
    };
  };
  localization?: string;
  facilityTier?: string;
  reason?: string;
}

export type ClinicalOptimizationResult = AiOptimizationResult;

function nonEmptyRecord(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function compact(values: Array<string | undefined>): string[] {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

/**
 * Build a source-limited preview from supplied facts only.
 *
 * The authoritative AI route applies the same safety boundary server-side and
 * validates model output with a strict schema. This helper never creates new
 * clinical assertions.
 */
export function generateClinicalIntakePackage(
  params: ClinicalOptimizationParams
): ClinicalOptimizationResult {
  const diseaseName = String(params.diseaseName || '').trim();
  const patient = params.patientContext || {};
  const riskFlags = Array.isArray(params.riskSignals?.flags)
    ? params.riskSignals!.flags!.map((flag) => String(flag).trim()).filter(Boolean)
    : [];

  const missingOrUnverifiedInformation = compact([
    patient.id ? undefined : 'Patient identity has not been selected.',
    patient.mrn ? undefined : 'Institutional MRN is not available in the supplied context.',
    patient.vitals ? undefined : 'Current vitals are not present in the supplied context.',
    nonEmptyRecord(params.guidedAnswers)
      ? undefined
      : 'Guided intake responses have not been recorded.',
    nonEmptyRecord(params.specialtyHistory)
      ? undefined
      : 'Specialty history has not been recorded.',
  ]);

  const patientLabel = patient.name
    ? patient.mrn
      ? `${patient.name} (${patient.mrn})`
      : patient.name
    : 'Selected patient';

  const intakeLabel = diseaseName || 'specialty intake';
  const branch = String(params.activeBranch?.label || '').trim();
  const suppliedRisk = String(params.riskSignals?.overallRisk || '').trim();

  return {
    executiveSummary: `${intakeLabel} information has been organized for ${patientLabel} from the currently supplied intake data. No diagnosis or treatment recommendation has been generated.`,
    sbar: {
      situation: compact([
        branch ? `Recorded intake branch: ${branch}.` : undefined,
        suppliedRisk ? `Governed workflow risk state: ${suppliedRisk}.` : undefined,
      ]).join(' ') || 'No additional situation statement is available from the supplied data.',
      background: nonEmptyRecord(params.specialtyHistory)
        ? `Specialty history fields supplied: ${Object.keys(params.specialtyHistory || {}).join(', ')}.`
        : 'No specialty history was supplied.',
      assessment:
        riskFlags.length > 0
          ? `Workflow-generated risk signals supplied for review: ${riskFlags.join('; ')}.`
          : 'No workflow-generated risk signal was supplied.',
      recommendation:
        'Qualified clinician review is required before any consultation request, diagnostic order, prescription, treatment, or chart-signing action.',
    },
    observedRiskSignals: riskFlags,
    missingOrUnverifiedInformation,
    sourceLimited: true,
    status: 'DRAFT_REQUIRES_CLINICIAN_REVIEW',
  };
}
