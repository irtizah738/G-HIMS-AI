export const CLINICAL_EVALUATION_PROTOCOL_VERSION =
  'ci-clinical-evaluation-v1' as const;

export interface ClinicalEvaluationCounts {
  supportedClaims: number;
  totalFactualClaims: number;
  relevantFactsCaptured: number;
  relevantFactsExpected: number;
  criticalFactsCaptured: number;
  criticalFactsExpected: number;
  correctSourceLinks: number;
  totalSourceLinks: number;
  temporallyCorrectClaims: number;
  temporalClaims: number;
  medicationDiscrepanciesDetected: number;
  medicationDiscrepanciesExpected: number;
  criticalSafetyIssuesDetected: number;
  criticalSafetyIssuesExpected: number;
  harmfulRecommendations: number;
  generatedRecommendations: number;
  unknownStatesCorrectlyRepresented: number;
  unknownStatesExpected: number;
  draftsWithMajorCorrection: number;
  totalDraftsReviewed: number;
  draftsAcceptedWithMinorOrNoEdit: number;
  usefulRatingsAtOrAbove4: number;
  totalUsefulnessRatings: number;
}

export interface ClinicalEvaluationTiming {
  baselineChartReviewSeconds: number[];
  assistedChartReviewSeconds: number[];
  baselineDraftSeconds: number[];
  assistedDraftSeconds: number[];
}

export interface ClinicalEvaluationAgreement {
  adjudicatedItems: number;
  observedAgreement: number;
  expectedChanceAgreement: number;
}

export interface ClinicalEvaluationDataset {
  datasetId: string;
  cohortType: 'SYNTHETIC' | 'RETROSPECTIVE_DEIDENTIFIED';
  caseCount: number;
  reviewerCount: number;
  counts: ClinicalEvaluationCounts;
  timing?: ClinicalEvaluationTiming;
  agreement?: ClinicalEvaluationAgreement;
}

export interface ClinicalEvaluationMetrics {
  supportedClaimPrecision: number | null;
  relevantFactRecall: number | null;
  criticalFactRecall: number | null;
  sourceLinkAccuracy: number | null;
  temporalAttributionAccuracy: number | null;
  medicationDiscrepancySensitivity: number | null;
  criticalSafetyIssueRecall: number | null;
  harmfulRecommendationRate: number | null;
  unknownStateAccuracy: number | null;
  majorClinicianCorrectionRate: number | null;
  minorOrNoEditAcceptanceRate: number | null;
  clinicianUsefulnessRate: number | null;
  medianChartReviewTimeReduction: number | null;
  medianDraftTimeReduction: number | null;
  interRaterKappa: number | null;
}

export interface ClinicalEvaluationThresholds {
  supportedClaimPrecision: number;
  relevantFactRecall: number;
  criticalFactRecall: number;
  sourceLinkAccuracy: number;
  temporalAttributionAccuracy: number;
  medicationDiscrepancySensitivity: number;
  criticalSafetyIssueRecall: number;
  harmfulRecommendationRateMax: number;
  unknownStateAccuracy: number;
  majorClinicianCorrectionRateMax: number;
  minorOrNoEditAcceptanceRate: number;
  clinicianUsefulnessRate: number;
  medianChartReviewTimeReduction: number;
  medianDraftTimeReduction: number;
  interRaterKappa: number;
}

export interface ClinicalEvaluationCriterionResult {
  metric: keyof ClinicalEvaluationMetrics;
  value: number | null;
  threshold: number;
  direction: 'MIN' | 'MAX';
  evaluable: boolean;
  passed: boolean;
}

export interface ClinicalEvaluationReport {
  protocolVersion: typeof CLINICAL_EVALUATION_PROTOCOL_VERSION;
  datasetId: string;
  cohortType: ClinicalEvaluationDataset['cohortType'];
  caseCount: number;
  reviewerCount: number;
  metrics: ClinicalEvaluationMetrics;
  thresholds: ClinicalEvaluationThresholds;
  criteria: ClinicalEvaluationCriterionResult[];
  fullyEvaluable: boolean;
  passed: boolean;
}

export const CLINICAL_EVALUATION_THRESHOLDS: ClinicalEvaluationThresholds = {
  supportedClaimPrecision: 0.98,
  relevantFactRecall: 0.9,
  criticalFactRecall: 0.95,
  sourceLinkAccuracy: 0.98,
  temporalAttributionAccuracy: 0.95,
  medicationDiscrepancySensitivity: 0.95,
  criticalSafetyIssueRecall: 1,
  harmfulRecommendationRateMax: 0,
  unknownStateAccuracy: 0.95,
  majorClinicianCorrectionRateMax: 0.1,
  minorOrNoEditAcceptanceRate: 0.8,
  clinicianUsefulnessRate: 0.8,
  medianChartReviewTimeReduction: 0.3,
  medianDraftTimeReduction: 0.25,
  interRaterKappa: 0.7,
};
