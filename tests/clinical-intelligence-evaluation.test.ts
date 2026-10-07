import { describe, expect, test } from 'bun:test';
import { ClinicalIntelligenceClinicalEvaluator } from '@/lib/clinical/intelligence/clinical-evaluation-framework';
import {
  CLINICAL_EVALUATION_PROTOCOL_VERSION,
  CLINICAL_EVALUATION_THRESHOLDS,
  type ClinicalEvaluationDataset,
} from '@/types/clinical-intelligence-evaluation';

function passingDataset(): ClinicalEvaluationDataset {
  return {
    datasetId: 'synthetic-ci-eval-v1',
    cohortType: 'SYNTHETIC',
    caseCount: 100,
    reviewerCount: 3,
    counts: {
      supportedClaims: 990,
      totalFactualClaims: 1000,
      relevantFactsCaptured: 930,
      relevantFactsExpected: 1000,
      criticalFactsCaptured: 98,
      criticalFactsExpected: 100,
      correctSourceLinks: 990,
      totalSourceLinks: 1000,
      temporallyCorrectClaims: 96,
      temporalClaims: 100,
      medicationDiscrepanciesDetected: 96,
      medicationDiscrepanciesExpected: 100,
      criticalSafetyIssuesDetected: 50,
      criticalSafetyIssuesExpected: 50,
      harmfulRecommendations: 0,
      generatedRecommendations: 100,
      unknownStatesCorrectlyRepresented: 96,
      unknownStatesExpected: 100,
      draftsWithMajorCorrection: 5,
      totalDraftsReviewed: 100,
      draftsAcceptedWithMinorOrNoEdit: 85,
      usefulRatingsAtOrAbove4: 85,
      totalUsefulnessRatings: 100,
    },
    timing: {
      baselineChartReviewSeconds: [300, 320, 340],
      assistedChartReviewSeconds: [180, 190, 200],
      baselineDraftSeconds: [240, 260, 280],
      assistedDraftSeconds: [160, 170, 180],
    },
    agreement: {
      adjudicatedItems: 100,
      observedAgreement: 0.9,
      expectedChanceAgreement: 0.5,
    },
  };
}

describe('Clinical Intelligence measurable clinical evaluation framework', () => {
  test('passing cohort satisfies every predefined release criterion', () => {
    const report = ClinicalIntelligenceClinicalEvaluator.evaluate(
      passingDataset()
    );

    expect(report.protocolVersion).toBe(CLINICAL_EVALUATION_PROTOCOL_VERSION);
    expect(report.thresholds).toEqual(CLINICAL_EVALUATION_THRESHOLDS);
    expect(report.fullyEvaluable).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.criteria.every((item) => item.evaluable && item.passed)).toBe(
      true
    );
  });

  test('harmful recommendations and critical misses fail the evaluation gate', () => {
    const dataset = passingDataset();
    dataset.counts.harmfulRecommendations = 1;
    dataset.counts.criticalSafetyIssuesDetected = 49;

    const report = ClinicalIntelligenceClinicalEvaluator.evaluate(dataset);

    expect(report.passed).toBe(false);
    expect(
      report.criteria.find(
        (item) => item.metric === 'harmfulRecommendationRate'
      )?.passed
    ).toBe(false);
    expect(
      report.criteria.find(
        (item) => item.metric === 'criticalSafetyIssueRecall'
      )?.passed
    ).toBe(false);
  });

  test('missing denominators remain explicitly non-evaluable rather than silently passing', () => {
    const dataset = passingDataset();
    dataset.counts.temporalClaims = 0;
    dataset.counts.temporallyCorrectClaims = 0;

    const report = ClinicalIntelligenceClinicalEvaluator.evaluate(dataset);
    const temporal = report.criteria.find(
      (item) => item.metric === 'temporalAttributionAccuracy'
    );

    expect(temporal?.evaluable).toBe(false);
    expect(temporal?.passed).toBe(false);
    expect(report.fullyEvaluable).toBe(false);
    expect(report.passed).toBe(false);
  });

  test('median time reductions and reviewer agreement are computed deterministically', () => {
    const report = ClinicalIntelligenceClinicalEvaluator.evaluate(
      passingDataset()
    );

    expect(report.metrics.medianChartReviewTimeReduction).toBeCloseTo(
      (320 - 190) / 320
    );
    expect(report.metrics.medianDraftTimeReduction).toBeCloseTo(
      (260 - 170) / 260
    );
    expect(report.metrics.interRaterKappa).toBeCloseTo(0.8);
  });

  test('invalid cohort identity fails closed', () => {
    const dataset = passingDataset();
    dataset.datasetId = '';

    expect(() =>
      ClinicalIntelligenceClinicalEvaluator.evaluate(dataset)
    ).toThrow('CI_EVALUATION_DATASET_ID_REQUIRED');
  });
});
