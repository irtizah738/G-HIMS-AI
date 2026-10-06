import {
  CLINICAL_EVALUATION_PROTOCOL_VERSION,
  CLINICAL_EVALUATION_THRESHOLDS,
  type ClinicalEvaluationCriterionResult,
  type ClinicalEvaluationDataset,
  type ClinicalEvaluationMetrics,
  type ClinicalEvaluationReport,
  type ClinicalEvaluationThresholds,
} from '@/types/clinical-intelligence-evaluation';

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator < 0 || denominator <= 0 || numerator > denominator) return null;
  return numerator / denominator;
}

function median(values: number[]): number | null {
  const valid = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[middle - 1] + valid[middle]) / 2
    : valid[middle];
}

function reduction(baseline: number[], assisted: number[]): number | null {
  const baselineMedian = median(baseline);
  const assistedMedian = median(assisted);
  if (
    baselineMedian === null ||
    assistedMedian === null ||
    baselineMedian <= 0
  ) {
    return null;
  }
  return (baselineMedian - assistedMedian) / baselineMedian;
}

function kappa(
  adjudicatedItems: number,
  observedAgreement: number,
  expectedChanceAgreement: number
): number | null {
  if (
    adjudicatedItems <= 0 ||
    !Number.isFinite(observedAgreement) ||
    !Number.isFinite(expectedChanceAgreement) ||
    observedAgreement < 0 ||
    observedAgreement > 1 ||
    expectedChanceAgreement < 0 ||
    expectedChanceAgreement >= 1
  ) {
    return null;
  }
  return (observedAgreement - expectedChanceAgreement) /
    (1 - expectedChanceAgreement);
}

function criterion(
  metric: keyof ClinicalEvaluationMetrics,
  value: number | null,
  threshold: number,
  direction: 'MIN' | 'MAX'
): ClinicalEvaluationCriterionResult {
  return {
    metric,
    value,
    threshold,
    direction,
    evaluable: value !== null,
    passed:
      value !== null &&
      (direction === 'MIN' ? value >= threshold : value <= threshold),
  };
}

export class ClinicalIntelligenceClinicalEvaluator {
  public static evaluate(
    dataset: ClinicalEvaluationDataset,
    thresholds: ClinicalEvaluationThresholds = CLINICAL_EVALUATION_THRESHOLDS
  ): ClinicalEvaluationReport {
    if (!dataset.datasetId.trim()) {
      throw new Error('CI_EVALUATION_DATASET_ID_REQUIRED');
    }
    if (!Number.isInteger(dataset.caseCount) || dataset.caseCount <= 0) {
      throw new Error('CI_EVALUATION_CASE_COUNT_REQUIRED');
    }
    if (!Number.isInteger(dataset.reviewerCount) || dataset.reviewerCount <= 0) {
      throw new Error('CI_EVALUATION_REVIEWER_COUNT_REQUIRED');
    }

    const counts = dataset.counts;
    const timing = dataset.timing;
    const agreement = dataset.agreement;

    const metrics: ClinicalEvaluationMetrics = {
      supportedClaimPrecision: ratio(
        counts.supportedClaims,
        counts.totalFactualClaims
      ),
      relevantFactRecall: ratio(
        counts.relevantFactsCaptured,
        counts.relevantFactsExpected
      ),
      criticalFactRecall: ratio(
        counts.criticalFactsCaptured,
        counts.criticalFactsExpected
      ),
      sourceLinkAccuracy: ratio(
        counts.correctSourceLinks,
        counts.totalSourceLinks
      ),
      temporalAttributionAccuracy: ratio(
        counts.temporallyCorrectClaims,
        counts.temporalClaims
      ),
      medicationDiscrepancySensitivity: ratio(
        counts.medicationDiscrepanciesDetected,
        counts.medicationDiscrepanciesExpected
      ),
      criticalSafetyIssueRecall: ratio(
        counts.criticalSafetyIssuesDetected,
        counts.criticalSafetyIssuesExpected
      ),
      harmfulRecommendationRate: ratio(
        counts.harmfulRecommendations,
        counts.generatedRecommendations
      ),
      unknownStateAccuracy: ratio(
        counts.unknownStatesCorrectlyRepresented,
        counts.unknownStatesExpected
      ),
      majorClinicianCorrectionRate: ratio(
        counts.draftsWithMajorCorrection,
        counts.totalDraftsReviewed
      ),
      minorOrNoEditAcceptanceRate: ratio(
        counts.draftsAcceptedWithMinorOrNoEdit,
        counts.totalDraftsReviewed
      ),
      clinicianUsefulnessRate: ratio(
        counts.usefulRatingsAtOrAbove4,
        counts.totalUsefulnessRatings
      ),
      medianChartReviewTimeReduction: timing
        ? reduction(
            timing.baselineChartReviewSeconds,
            timing.assistedChartReviewSeconds
          )
        : null,
      medianDraftTimeReduction: timing
        ? reduction(timing.baselineDraftSeconds, timing.assistedDraftSeconds)
        : null,
      interRaterKappa: agreement
        ? kappa(
            agreement.adjudicatedItems,
            agreement.observedAgreement,
            agreement.expectedChanceAgreement
          )
        : null,
    };

    const criteria: ClinicalEvaluationCriterionResult[] = [
      criterion('supportedClaimPrecision', metrics.supportedClaimPrecision, thresholds.supportedClaimPrecision, 'MIN'),
      criterion('relevantFactRecall', metrics.relevantFactRecall, thresholds.relevantFactRecall, 'MIN'),
      criterion('criticalFactRecall', metrics.criticalFactRecall, thresholds.criticalFactRecall, 'MIN'),
      criterion('sourceLinkAccuracy', metrics.sourceLinkAccuracy, thresholds.sourceLinkAccuracy, 'MIN'),
      criterion('temporalAttributionAccuracy', metrics.temporalAttributionAccuracy, thresholds.temporalAttributionAccuracy, 'MIN'),
      criterion('medicationDiscrepancySensitivity', metrics.medicationDiscrepancySensitivity, thresholds.medicationDiscrepancySensitivity, 'MIN'),
      criterion('criticalSafetyIssueRecall', metrics.criticalSafetyIssueRecall, thresholds.criticalSafetyIssueRecall, 'MIN'),
      criterion('harmfulRecommendationRate', metrics.harmfulRecommendationRate, thresholds.harmfulRecommendationRateMax, 'MAX'),
      criterion('unknownStateAccuracy', metrics.unknownStateAccuracy, thresholds.unknownStateAccuracy, 'MIN'),
      criterion('majorClinicianCorrectionRate', metrics.majorClinicianCorrectionRate, thresholds.majorClinicianCorrectionRateMax, 'MAX'),
      criterion('minorOrNoEditAcceptanceRate', metrics.minorOrNoEditAcceptanceRate, thresholds.minorOrNoEditAcceptanceRate, 'MIN'),
      criterion('clinicianUsefulnessRate', metrics.clinicianUsefulnessRate, thresholds.clinicianUsefulnessRate, 'MIN'),
      criterion('medianChartReviewTimeReduction', metrics.medianChartReviewTimeReduction, thresholds.medianChartReviewTimeReduction, 'MIN'),
      criterion('medianDraftTimeReduction', metrics.medianDraftTimeReduction, thresholds.medianDraftTimeReduction, 'MIN'),
      criterion('interRaterKappa', metrics.interRaterKappa, thresholds.interRaterKappa, 'MIN'),
    ];

    const fullyEvaluable = criteria.every((item) => item.evaluable);

    return {
      protocolVersion: CLINICAL_EVALUATION_PROTOCOL_VERSION,
      datasetId: dataset.datasetId,
      cohortType: dataset.cohortType,
      caseCount: dataset.caseCount,
      reviewerCount: dataset.reviewerCount,
      metrics,
      thresholds,
      criteria,
      fullyEvaluable,
      passed: fullyEvaluable && criteria.every((item) => item.passed),
    };
  }
}
