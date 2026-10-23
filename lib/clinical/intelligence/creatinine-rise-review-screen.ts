import type {
  ClinicalTrendMetric,
  ClinicalTrendPoint,
  ClinicalTrendReviewSignal,
} from '@/types/clinical-trend-intelligence';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_48H_MS = 48 * HOUR_MS;
const WINDOW_7D_MS = 7 * DAY_MS;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// These are screening-only numerical criteria derived from the published
// KDIGO AKI definition. Institutional clinical review and approval are
// required before any deployment or protocol-based escalation.
// https://www.nice.org.uk/guidance/ng148/chapter/Recommendations
const SEVEN_DAY_RATIO = 1.5;
const FORTY_EIGHT_HOUR_DELTA_MG_DL = 0.3;

function eligible(point: ClinicalTrendPoint): boolean {
  return Number.isFinite(point.effectiveAt) &&
    Number.isFinite(point.value) &&
    point.value > 0 &&
    ['FINAL', 'AMENDED', 'CORRECTED'].includes(point.status.toUpperCase()) &&
    point.unitKey.toLowerCase() === 'ucum:mg/dl';
}

function isSerumCreatinine(metric: ClinicalTrendMetric): boolean {
  return metric.code === '2160-0' &&
    /^(loinc|https?:\/\/loinc\.org)$/i.test(metric.codeSystem.trim()) &&
    metric.unitKey?.toLowerCase() === 'ucum:mg/dl';
}

/**
 * Deterministic, source-cited numerical screening — never an AKI diagnosis,
 * clinical stage assignment, treatment instruction, or autonomous action.
 *
 * The earlier reading is only a candidate comparator, NOT a verified baseline.
 * No signal is emitted for ambiguous units, conflicting times, stale latest
 * data, nonfinal observations, or missing coded clinical identity.
 */
export function screenCreatinineRiseForReview(
  metric: ClinicalTrendMetric,
  snapshotCreatedAt: number
): ClinicalTrendReviewSignal[] {
  if (
    !isSerumCreatinine(metric) ||
    metric.status !== 'COMPUTED' ||
    !Number.isFinite(snapshotCreatedAt) ||
    metric.points.length < 2 ||
    !metric.points.every(eligible)
  ) {
    return [];
  }

  const ordered = [...metric.points].sort(
    (a, b) => a.effectiveAt - b.effectiveAt
  );
  const latest = ordered[ordered.length - 1];
  if (
    latest.effectiveAt > snapshotCreatedAt + MAX_FUTURE_SKEW_MS ||
    snapshotCreatedAt - latest.effectiveAt > WINDOW_7D_MS
  ) {
    return [];
  }

  const candidates = ordered.slice(0, -1).flatMap((prior) => {
    const elapsed = latest.effectiveAt - prior.effectiveAt;
    if (elapsed <= 0 || elapsed > WINDOW_7D_MS) return [];
    const ratio = latest.value / prior.value;
    const deltaMgDl = latest.value - prior.value;
    const ratioCriterion = ratio >= SEVEN_DAY_RATIO;
    // Use rounded microunits to avoid floating-point boundary errors at 0.3.
    const absoluteCriterion =
      elapsed <= WINDOW_48H_MS &&
      Math.round(deltaMgDl * 1000) >= 300;

    if (!ratioCriterion && !absoluteCriterion) return [];
    return [{
      prior,
      elapsed,
      ratio,
      criterion: ratioCriterion
        ? 'RATIO_WITHIN_7_DAYS' as const
        : 'ABSOLUTE_RISE_WITHIN_48_HOURS' as const,
    }];
  });
  if (candidates.length === 0) return [];

  // Largest qualifying relative change wins; the candidate is not assumed
  // to be the patient's true pre-illness baseline.
  candidates.sort((a, b) =>
    b.ratio - a.ratio ||
    a.prior.effectiveAt - b.prior.effectiveAt
  );
  const selected = candidates[0];
  const ratio = Number(selected.ratio.toFixed(2));
  const elapsedHours = Number((selected.elapsed / HOUR_MS).toFixed(1));
  const earlierValue = selected.prior.value;
  const latestValue = latest.value;

  return [{
    code: 'POTENTIAL_ACUTE_CREATININE_RISE',
    status: 'CLINICAL_REVIEW_REQUIRED_POLICY_UNAPPROVED',
    criterion: selected.criterion,
    evidenceRefs: Array.from(
      new Set([selected.prior.evidenceId, latest.evidenceId])
    ),
    earlierValue,
    latestValue,
    unit: 'mg/dL',
    ratio,
    elapsedHours,
    warning:
      'Potentially significant serum creatinine increase: ' +
      earlierValue + ' to ' + latestValue + ' mg/dL (' + ratio +
      'x over ' + elapsedHours +
      ' hours). Verify the earlier value as a clinically valid baseline, ' +
      'review measurement timing and reliability, kidney history, and urine ' +
      'output. A qualified clinician must evaluate possible acute kidney ' +
      'injury. This is a screening signal only; no diagnosis, stage, ' +
      'treatment or urgency tier is assigned. Escalation policy requires ' +
      'institutional clinical approval.',
    clinicalApprovalRequired: true,
    diagnosisEstablished: false,
    treatmentAuthorized: false,
  }];
}
