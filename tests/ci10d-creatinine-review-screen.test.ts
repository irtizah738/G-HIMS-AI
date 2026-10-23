import { describe, expect, test } from 'bun:test';
import { screenCreatinineRiseForReview } from '@/lib/clinical/intelligence/creatinine-rise-review-screen';
import { ClinicalTrendIntelligenceService } from '@/lib/clinical/intelligence/clinical-trend-intelligence-service';
import type { ClinicalTrendMetric, ClinicalTrendPoint } from '@/types/clinical-trend-intelligence';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
} from '@/types/clinical-intelligence-evidence';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 23, 12);
const DAY_ZERO = NOW - 6 * DAY;

function point(id: string, value: number, effectiveAt: number): ClinicalTrendPoint {
  return {
    observationId: 'obs-' + id,
    evidenceId: id,
    effectiveAt,
    value,
    unit: 'mg/dL',
    unitKey: 'UCUM:mg/dl',
    status: 'FINAL',
    abnormal: false,
  };
}

function metric(
  points: ClinicalTrendPoint[],
  overrides: Partial<ClinicalTrendMetric> = {}
): ClinicalTrendMetric {
  return {
    metricKey: 'LOINC:2160-0',
    codeSystem: 'LOINC',
    code: '2160-0',
    display: 'Serum creatinine',
    unit: 'mg/dL',
    unitKey: 'UCUM:mg/dl',
    status: 'COMPUTED',
    direction: 'INCREASING',
    points,
    pointCount: points.length,
    abnormalPointCount: 0,
    evidenceRefs: points.map((item) => item.evidenceId),
    exclusions: [],
    caveats: [],
    ...overrides,
  };
}

function observation(id: string, value: number, effectiveAt: number): ClinicalEvidenceRef {
  return {
    evidenceId: id,
    tenantId: 'synthetic-renal-tenant',
    patientId: 'synthetic-renal-patient',
    sourceType: 'OBSERVATION_HISTORY',
    sourceEntityId: 'obs-' + id,
    label: 'Serum creatinine',
    status: 'FINAL',
    occurredAt: effectiveAt,
    recordedAt: effectiveAt + 1000,
    patient360Revision: 1,
    patient360SourceCheckpoint: 'synthetic-source-checkpoint',
    sourceEventIds: ['evt-' + id],
    sourceEventCount: 1,
    sourceEventSetHash: 'synthetic-hash-' + id,
    provenanceStatus: 'EVENT_VERIFIED',
    content: {
      observationId: 'obs-' + id,
      patientId: 'synthetic-renal-patient',
      effectiveAt,
      status: 'FINAL',
      code: {
        text: 'Serum creatinine',
        codings: [{ system: 'LOINC', code: '2160-0', display: 'Serum creatinine' }],
      },
      value: {
        valueType: 'QUANTITY',
        quantity: { value, unit: 'mg/dL', system: 'UCUM', code: 'mg/dL' },
      },
    },
    contentHash: 'synthetic-content-hash-' + id,
  };
}

describe('CI-10D provisional renal review screen (NOT clinical approval)', () => {
  test('flags 0.9 to 2.1 mg/dL within five days with provenance and no stage', () => {
    const m = metric([
      point('cr-0', 0.9, NOW - 5 * DAY),
      point('cr-1', 1.2, NOW - 3 * DAY),
      point('cr-2', 2.1, NOW),
    ]);
    const signals = screenCreatinineRiseForReview(m, NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: 'POTENTIAL_ACUTE_CREATININE_RISE',
      criterion: 'RATIO_WITHIN_7_DAYS',
      earlierValue: 0.9,
      latestValue: 2.1,
      ratio: 2.33,
      evidenceRefs: ['cr-0', 'cr-2'],
      clinicalApprovalRequired: true,
      diagnosisEstablished: false,
      treatmentAuthorized: false,
    });
    expect(signals[0].warning).toContain('baseline');
    expect(signals[0].warning).toContain('qualified clinician');
    expect(signals[0].warning).toContain('not a confirmed');
  });

  test('flags the separate 0.3 mg/dL within 48h criterion without automatic diagnosis', () => {
    const signals = screenCreatinineRiseForReview(
      metric([point('cr-a', 1.0, NOW - DAY), point('cr-b', 1.3, NOW)]),
      NOW
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].criterion).toBe('ABSOLUTE_RISE_WITHIN_48_HOURS');
  });

  test('does not apply a 48h delta criterion over 3 days or small 7d ratio', () => {
    expect(screenCreatinineRiseForReview(
      metric([point('cr-a', 1, NOW - 3 * DAY), point('cr-b', 1.3, NOW)]),
      NOW
    )).toEqual([]);
  });

  test('does not compare readings more than 7d apart', () => {
    expect(screenCreatinineRiseForReview(
      metric([point('old', 0.9, NOW - 8 * DAY), point('new', 2.1, NOW)]),
      NOW
    )).toEqual([]);
  });

  test('does not signal for a stale latest observation', () => {
    expect(screenCreatinineRiseForReview(
      metric([point('old', 0.9, NOW - 11 * DAY), point('new', 2.1, NOW - 8 * DAY)]),
      NOW
    )).toEqual([]);
  });

  test('does not use free-text, uncoded or non-serum creatinine as a proxy', () => {
    const pts = [point('a', 0.9, NOW - DAY), point('b', 2.1, NOW)];
    expect(screenCreatinineRiseForReview(
      metric(pts, { code: '9999-9' }), NOW
    )).toEqual([]);
    expect(screenCreatinineRiseForReview(
      metric(pts, { codeSystem: 'LOCAL' }), NOW
    )).toEqual([]);
  });

  test('blocks mixed units, conflicting times, and nonfinal records', () => {
    const pts = [point('a', 0.9, NOW - DAY), point('b', 2.1, NOW)];
    expect(screenCreatinineRiseForReview(
      metric(pts, { status: 'MIXED_UNITS' }), NOW
    )).toEqual([]);
    expect(screenCreatinineRiseForReview(
      metric(pts, { status: 'CONFLICTING_SAME_TIME' }), NOW
    )).toEqual([]);
    expect(screenCreatinineRiseForReview(
      metric(pts.map((p) => ({ ...p, unitKey: 'UCUM:umol/l' })), {}),
      NOW
    )).toEqual([]);
    expect(screenCreatinineRiseForReview(
      metric([{ ...pts[0], status: 'PRELIMINARY' }, pts[1]]), NOW
    )).toEqual([]);
  });

  test('does not produce a warning for a falling creatinine value', () => {
    expect(screenCreatinineRiseForReview(
      metric([point('a', 2.1, NOW - DAY), point('b', 0.9, NOW)]),
      NOW
    )).toEqual([]);
  });

  test('integrates into immutable clinical-trend artifact and visible warnings', () => {
    const refs = [
      observation('cr-early', 0.9, NOW - 5 * DAY),
      observation('cr-middle', 1.2, NOW - 3 * DAY),
      observation('cr-recent', 2.1, NOW),
    ];
    const snapshot: ClinicalEvidenceSnapshot = {
      snapshotId: 'synthetic-renal-snapshot',
      tenantId: 'synthetic-renal-tenant',
      patientId: 'synthetic-renal-patient',
      purpose: 'TREND_EXPLANATION',
      createdAt: NOW,
      createdBy: 'synthetic-clinician',
      immutable: true,
      schemaVersion: 2,
      patient360ProjectionVersion: 1,
      patient360Revision: 1,
      patient360SourceCheckpoint: 'synthetic-source-checkpoint',
      patient360ContentHash: 'synthetic-projection-hash',
      evidenceRefs: refs,
      evidenceCount: refs.length,
      sourceEventCount: refs.length,
      coverage: { observations: { status: 'COMPLETE', recordCount: refs.length } },
      dateRange: { from: refs[0].occurredAt, to: refs[2].occurredAt },
      snapshotHash: 'synthetic-snapshot-hash',
      limitations: ['Synthetic-only evaluation; no clinical approval.'],
    };
    const artifact = ClinicalTrendIntelligenceService.build(snapshot, 'synthetic-clinician', NOW);
    expect(artifact.policyVersion).toBe('ci10d-clinical-trend-v2');
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.reviewSignals).toHaveLength(1);
    expect(artifact.reviewSignals[0].evidenceRefs).toEqual(['cr-early', 'cr-recent']);
    expect(artifact.warnings).toContain(artifact.reviewSignals[0].warning);
    expect(artifact.safety.autonomousDiagnosisAllowed).toBe(false);
    expect(artifact.safety.autonomousTreatmentAllowed).toBe(false);
    expect(artifact.safety.directClinicalMutationAllowed).toBe(false);
  });
});
