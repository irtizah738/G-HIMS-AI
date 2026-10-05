import { ClinicalIntelligenceSafetyEvaluator } from '@/lib/clinical/intelligence/clinical-intelligence-safety-evaluator';
import type { ClinicalSafetyEvaluation } from '@/types/clinical-intelligence-safety';
import type { ClinicalEvidenceSnapshot, CopilotClaim } from '@/types/clinical-intelligence-evidence';
import type { ClinicalLongitudinalSummary } from '@/types/clinical-longitudinal-summary';
import type { ClinicalEncounterPreparationBrief } from '@/types/clinical-encounter-preparation';
import type { ClinicalTrendIntelligenceArtifact } from '@/types/clinical-trend-intelligence';
import type { MedicationReconciliationCopilotArtifact } from '@/types/medication-reconciliation-copilot';
import type {
  ClinicalDraftRevision,
  GovernedClinicalDraft,
} from '@/types/clinical-draft';

export interface ClinicalSafetyCurrentChart {
  patient360Revision: number;
  patient360SourceCheckpoint: string;
}

function currentArgs(current: ClinicalSafetyCurrentChart) {
  return {
    currentPatient360Revision: current.patient360Revision,
    currentPatient360SourceCheckpoint: current.patient360SourceCheckpoint,
  };
}

export class ClinicalIntelligenceSafetyAdapters {
  public static evaluateLongitudinal(
    artifact: ClinicalLongitudinalSummary,
    snapshot: ClinicalEvidenceSnapshot,
    current: ClinicalSafetyCurrentChart
  ): ClinicalSafetyEvaluation {
    const claims: CopilotClaim[] = artifact.sections.flatMap((section) =>
      section.claims.map((claim) => ({
        claimId: claim.claimId,
        text: claim.text,
        classification: claim.classification,
        evidenceRefs: claim.evidenceRefs,
        confidence: claim.confidence,
      }))
    );

    return ClinicalIntelligenceSafetyEvaluator.evaluate({
      tenantId: artifact.tenantId,
      patientId: artifact.patientId,
      purpose: 'LONGITUDINAL_SUMMARY',
      snapshot,
      claims,
      renderedText: artifact.sections.flatMap((section) => [
        section.title,
        ...section.claims.map((claim) => claim.text),
      ]),
      ...currentArgs(current),
    });
  }

  public static evaluateEncounterPreparation(
    artifact: ClinicalEncounterPreparationBrief,
    snapshot: ClinicalEvidenceSnapshot,
    current: ClinicalSafetyCurrentChart
  ): ClinicalSafetyEvaluation {
    const claims: CopilotClaim[] = artifact.sections.flatMap((section) =>
      section.claims.map((claim) => ({
        claimId: claim.claimId,
        text: claim.text,
        classification: claim.classification,
        evidenceRefs: claim.evidenceRefs,
        confidence: claim.confidence,
      }))
    );

    return ClinicalIntelligenceSafetyEvaluator.evaluate({
      tenantId: artifact.tenantId,
      patientId: artifact.patientId,
      purpose: 'ENCOUNTER_PREP',
      snapshot,
      claims,
      renderedText: artifact.sections.flatMap((section) => [
        section.title,
        ...section.claims.map((claim) => claim.text),
      ]),
      ...currentArgs(current),
    });
  }

  public static evaluateTrends(
    artifact: ClinicalTrendIntelligenceArtifact,
    snapshot: ClinicalEvidenceSnapshot,
    current: ClinicalSafetyCurrentChart
  ): ClinicalSafetyEvaluation {
    const claims = artifact.metrics
      .map((metric) => metric.explanation)
      .filter((claim): claim is CopilotClaim => Boolean(claim));

    return ClinicalIntelligenceSafetyEvaluator.evaluate({
      tenantId: artifact.tenantId,
      patientId: artifact.patientId,
      purpose: 'TREND_EXPLANATION',
      snapshot,
      claims,
      renderedText: claims.map((claim) => claim.text),
      ...currentArgs(current),
    });
  }

  public static evaluateMedicationReconciliation(
    artifact: MedicationReconciliationCopilotArtifact,
    snapshot: ClinicalEvidenceSnapshot,
    current: ClinicalSafetyCurrentChart
  ): ClinicalSafetyEvaluation {
    const claims: CopilotClaim[] = artifact.findings.map((finding) => ({
      claimId: finding.findingId,
      text: `${finding.title}: ${finding.description}`,
      classification: finding.classification,
      evidenceRefs: finding.evidenceRefs,
    }));

    return ClinicalIntelligenceSafetyEvaluator.evaluate({
      tenantId: artifact.tenantId,
      patientId: artifact.patientId,
      purpose: 'MEDICATION_RECONCILIATION',
      snapshot,
      claims,
      renderedText: claims.map((claim) => claim.text),
      ...currentArgs(current),
    });
  }

  public static evaluateGovernedDraft(
    draft: GovernedClinicalDraft,
    revision: ClinicalDraftRevision,
    snapshot: ClinicalEvidenceSnapshot,
    current: ClinicalSafetyCurrentChart
  ): ClinicalSafetyEvaluation {
    return ClinicalIntelligenceSafetyEvaluator.evaluate({
      tenantId: draft.tenantId,
      patientId: draft.patientId,
      purpose: 'CLINICAL_DRAFT',
      snapshot,
      claims: revision.claims,
      renderedText: [
        revision.title,
        revision.content,
        ...(revision.sections || []).flatMap((section) => [
          section.heading,
          section.text,
        ]),
      ],
      generationProvenance: draft.generationProvenance,
      ...currentArgs(current),
    });
  }
}
