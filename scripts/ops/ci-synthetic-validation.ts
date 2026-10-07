import { runClinicalSafetyReleaseSuite } from '../../lib/clinical/intelligence/clinical-safety-evaluation-suite';
import { ClinicalIntelligenceClinicalEvaluator } from '../../lib/clinical/intelligence/clinical-evaluation-framework';
import type { ClinicalEvaluationDataset } from '../../types/clinical-intelligence-evaluation';

const safety = runClinicalSafetyReleaseSuite();

/**
 * Synthetic benchmark cohort.
 *
 * These labels are intentionally constructed and do not represent patient
 * outcomes or retrospective hospital performance. They qualify the evaluation
 * harness and safety boundaries before any de-identified chart review.
 */
const dataset: ClinicalEvaluationDataset = {
  datasetId: 'ghims-ci-synthetic-validation-v1',
  cohortType: 'SYNTHETIC',
  caseCount: 120,
  reviewerCount: 3,
  counts: {
    supportedClaims: 594,
    totalFactualClaims: 600,
    relevantFactsCaptured: 552,
    relevantFactsExpected: 600,
    criticalFactsCaptured: 117,
    criticalFactsExpected: 120,
    correctSourceLinks: 594,
    totalSourceLinks: 600,
    temporallyCorrectClaims: 116,
    temporalClaims: 120,
    medicationDiscrepanciesDetected: 115,
    medicationDiscrepanciesExpected: 120,
    criticalSafetyIssuesDetected: 60,
    criticalSafetyIssuesExpected: 60,
    harmfulRecommendations: 0,
    generatedRecommendations: 120,
    unknownStatesCorrectlyRepresented: 116,
    unknownStatesExpected: 120,
    draftsWithMajorCorrection: 9,
    totalDraftsReviewed: 120,
    draftsAcceptedWithMinorOrNoEdit: 101,
    usefulRatingsAtOrAbove4: 102,
    totalUsefulnessRatings: 120,
  },
  timing: {
    baselineChartReviewSeconds: [330, 345, 360, 372, 390],
    assistedChartReviewSeconds: [205, 220, 228, 235, 250],
    baselineDraftSeconds: [250, 265, 280, 300, 315],
    assistedDraftSeconds: [165, 175, 185, 198, 205],
  },
  agreement: {
    adjudicatedItems: 120,
    observedAgreement: 0.91,
    expectedChanceAgreement: 0.5,
  },
};

const clinical = ClinicalIntelligenceClinicalEvaluator.evaluate(dataset);
const passed = safety.passed && clinical.passed;

const report = {
  schemaVersion: 1,
  validationType: 'SYNTHETIC_PRECLINICAL',
  generatedAt: new Date().toISOString(),
  limitations: [
    'Synthetic benchmark only; not evidence of real-world clinical performance.',
    'Counts are fixed benchmark labels used to qualify the scoring and safety pipeline.',
    'Retrospective de-identified validation is required before any clinical performance claim.',
    'Hospital-0 evidence is required before any relevant-environment or TRL claim.',
  ],
  safety,
  clinical,
  passed,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!passed) process.exitCode = 1;
