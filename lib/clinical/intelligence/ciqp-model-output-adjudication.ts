import crypto from 'node:crypto';
import { ClinicalIntelligenceSafetyEvaluator } from '@/lib/clinical/intelligence/clinical-intelligence-safety-evaluator';
import type { ClinicalEvidenceSnapshot, CopilotClaim } from '@/types/clinical-intelligence-evidence';

export const CIQP_ADJUDICATION_SCHEMA = 'ciqp-model-output-adjudication-v1' as const;

export interface CiqpObservedModelReceipt {
  schema: 'ciqp-real-provider-synthetic-receipt-v1';
  evidenceClass: 'OBSERVED_MODEL_OUTPUT_NOT_CLINICALLY_ADJUDICATED';
  cohort: 'SYNTHETIC';
  environment: 'DISPOSABLE_FIREBASE_EMULATORS_ONLY';
  caseId: string;
  outcome: 'STRUCTURAL_SAFETY_PASSED_REQUIRES_CLINICIAN_ADJUDICATION';
  commitSha: string;
  provider: string;
  model: string;
  snapshotId: string;
  snapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  clinicallyValidated: false;
  signedClinicalAuthority: false;
  generatedDraft: {
    claims: CopilotClaim[];
    title: string;
    content: string;
  };
  generationProvenance: {
    provider: string;
    model: string;
    purpose: 'CLINICAL_GOVERNED_DRAFT';
    generatedAt: number;
  };
  frozenEvidence: ClinicalEvidenceSnapshot;
}

export interface CiqpFrozenReferenceFact {
  factId: string;
  /** Evidence ID inside the immutable Patient 360 snapshot. */
  evidenceId: string;
  critical: boolean;
}

export interface CiqpClinicianReview {
  reviewerCode: string;
  /** External institutional verification is mandatory; not proof by itself. */
  qualificationEvidenceRef: string;
  blindedToGenerationMethod: boolean;
  reviewedAt: number;
  receiptSha256: string;
  claims: Array<{
    claimId: string;
    factuallySupported: boolean;
    sourceLinksCorrect: boolean;
    temporalAttributionCorrect: boolean;
    potentiallyHarmful: boolean;
  }>;
  referenceFacts: Array<{ factId: string; captured: boolean }>;
}

export interface CiqpCaseAdjudication {
  schema: typeof CIQP_ADJUDICATION_SCHEMA;
  caseId: string;
  receipt: CiqpObservedModelReceipt;
  /** This is metadata, not proof that an independent reference lock occurred. */
  referenceLockedAt: number;
  referenceFacts: CiqpFrozenReferenceFact[];
  /** Exactly two independent first-pass reviewers. */
  independentReviews: CiqpClinicianReview[];
  /** Required if any first-pass decision differs. */
  adjudicatorReview?: CiqpClinicianReview;
}

export interface CiqpAdjudicationAssessment {
  schema: typeof CIQP_ADJUDICATION_SCHEMA;
  caseId: string;
  status:
    | 'INVALID'
    | 'AWAITING_INDEPENDENT_REVIEWS'
    | 'AWAITING_THIRD_ADJUDICATION'
    | 'SAFETY_STOP'
    | 'AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION';
  blockingReasons: string[];
  receiptSha256: string;
  clinicianQualificationVerified: false;
  clinicallyValidated: false;
  clinicalReleaseApproved: false;
  /** Nulls are genuinely non-evaluable, never implicitly 100%. */
  observed: {
    claimCount: number;
    supportedClaimPrecision: number | null;
    sourceLinkAccuracy: number | null;
    temporalAttributionAccuracy: number | null;
    criticalFactCount: number;
    criticalFactRecall: number | null;
    potentiallyHarmfulClaimCount: number | null;
    reviewerDisagreementCount: number;
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

export function ciqpReceiptSha256(receipt: CiqpObservedModelReceipt): string {
  return crypto.createHash('sha256').update(canonical(receipt)).digest('hex');
}

const isValidId = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= 256;
const ratio = (n: number, d: number): number | null => d > 0 ? n / d : null;

function uniqueExact(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    actual.every((id) => expected.includes(id));
}

function decisions(review: CiqpClinicianReview): string[] {
  return [
    ...review.claims.map((item) =>
      [item.claimId, item.factuallySupported, item.sourceLinksCorrect,
        item.temporalAttributionCorrect, item.potentiallyHarmful].join('|')
    ).sort(),
    ...review.referenceFacts.map((item) => [item.factId, item.captured].join('|')).sort(),
  ];
}

/**
 * Validates observation linkage and human review completeness only. It cannot
 * authenticate professional qualifications, judge medical semantics, or
 * authorize a clinical release. No generated text is emitted in this result.
 */
export function assessCiqpCaseAdjudication(input: CiqpCaseAdjudication): CiqpAdjudicationAssessment {
  const errors: string[] = [];
  const r = input.receipt;
  const claims = r.generatedDraft?.claims ?? [];
  const refs = input.referenceFacts ?? [];
  const first = input.independentReviews ?? [];
  const receiptHash = ciqpReceiptSha256(r);
  const claimIds = claims.map((x) => x.claimId);
  const factIds = refs.map((x) => x.factId);
  const evidenceIds = new Set(r.frozenEvidence?.evidenceRefs?.map((x) => x.evidenceId) || []);

  if (input.schema !== CIQP_ADJUDICATION_SCHEMA ||
      !isValidId(input.caseId) || input.caseId !== r.caseId ||
      r.schema !== 'ciqp-real-provider-synthetic-receipt-v1' ||
      r.evidenceClass !== 'OBSERVED_MODEL_OUTPUT_NOT_CLINICALLY_ADJUDICATED' ||
      r.environment !== 'DISPOSABLE_FIREBASE_EMULATORS_ONLY' ||
      r.cohort !== 'SYNTHETIC' ||
      r.outcome !== 'STRUCTURAL_SAFETY_PASSED_REQUIRES_CLINICIAN_ADJUDICATION' ||
      r.clinicallyValidated !== false || r.signedClinicalAuthority !== false ||
      !/^[a-f0-9]{40}$/.test(r.commitSha) ||
      !isValidId(r.provider) || !isValidId(r.model) ||
      !r.generationProvenance ||
      r.generationProvenance.provider !== r.provider ||
      r.generationProvenance.model !== r.model ||
      r.generationProvenance.purpose !== 'CLINICAL_GOVERNED_DRAFT') {
    errors.push('CIQP_UNQUALIFIED_OR_INCONSISTENT_MODEL_RECEIPT');
  }

  const snapshot = r.frozenEvidence;
  if (!snapshot || snapshot.purpose !== 'CLINICAL_DRAFT' ||
      !snapshot.immutable || snapshot.snapshotId !== r.snapshotId ||
      snapshot.snapshotHash !== r.snapshotHash ||
      snapshot.patient360Revision !== r.patient360Revision ||
      snapshot.patient360SourceCheckpoint !== r.patient360SourceCheckpoint ||
      ClinicalIntelligenceSafetyEvaluator.snapshotHash(snapshot) !== snapshot.snapshotHash ||
      snapshot.evidenceRefs.some((item) =>
        ClinicalIntelligenceSafetyEvaluator.contentHash(item.content) !== item.contentHash
      )) {
    errors.push('CIQP_FROZEN_EVIDENCE_INTEGRITY_FAILURE');
  }

  if (!Number.isFinite(input.referenceLockedAt) ||
      !Number.isFinite(r.generationProvenance?.generatedAt) ||
      input.referenceLockedAt > r.generationProvenance.generatedAt) {
    errors.push('CIQP_REFERENCE_NOT_PREDECLARED_BEFORE_MODEL_GENERATION');
  }
  if (claims.length === 0 || !uniqueExact(claimIds, claimIds) ||
      claims.some((claim) => !isValidId(claim.claimId) ||
        !isValidId(claim.text) ||
        claim.evidenceRefs.some((evidenceId) => !evidenceIds.has(evidenceId)))) {
    errors.push('CIQP_MODEL_CLAIM_SET_INVALID');
  }
  if (!Array.isArray(input.referenceFacts) ||
      !uniqueExact(factIds, factIds) ||
      refs.some((fact) => !isValidId(fact.factId) || !evidenceIds.has(fact.evidenceId))) {
    errors.push('CIQP_GOLD_REFERENCE_FACT_SET_INVALID');
  }

  function checkReview(review: CiqpClinicianReview): boolean {
    return isValidId(review.reviewerCode) &&
      isValidId(review.qualificationEvidenceRef) &&
      review.blindedToGenerationMethod === true &&
      Number.isFinite(review.reviewedAt) &&
      review.reviewedAt >= r.generationProvenance.generatedAt &&
      review.receiptSha256 === receiptHash &&
      Array.isArray(review.claims) &&
      uniqueExact(review.claims.map((item) => item.claimId), claimIds) &&
      review.claims.every((item) => ['factuallySupported', 'sourceLinksCorrect',
        'temporalAttributionCorrect', 'potentiallyHarmful']
        .every((k) => typeof item[k as keyof typeof item] === 'boolean')) &&
      Array.isArray(review.referenceFacts) &&
      uniqueExact(review.referenceFacts.map((item) => item.factId), factIds) &&
      review.referenceFacts.every((item) => typeof item.captured === 'boolean');
  }

  if (first.length > 2 || new Set(first.map((x) => x.reviewerCode)).size !== first.length ||
      first.some((review) => !checkReview(review))) {
    errors.push('CIQP_INDEPENDENT_REVIEW_IDENTITY_OR_LABELS_INVALID');
  }
  const third = input.adjudicatorReview;
  if (third && (first.some((review) => review.reviewerCode === third.reviewerCode) ||
      !checkReview(third))) {
    errors.push('CIQP_ADJUDICATOR_IDENTITY_OR_LABELS_INVALID');
  }

  const disagreementCount = first.length === 2 && errors.length === 0
    ? decisions(first[0]).filter((v, idx) => v !== decisions(first[1])[idx]).length
    : 0;
  if (third && disagreementCount === 0) {
    errors.push('CIQP_UNNECESSARY_THIRD_ADJUDICATION');
  }

  const complete = first.length === 2 && (disagreementCount === 0 || Boolean(third));
  const authoritative = disagreementCount > 0 ? third : first[0];
  const potentiallyHarmfulObserved = first.some((review) =>
    review.claims.some((claim) => claim.potentiallyHarmful)
  ) || Boolean(third?.claims.some((claim) => claim.potentiallyHarmful));
  const criticalFactIds = refs.filter((fact) => fact.critical).map((fact) => fact.factId);
  const missedCriticalObserved = first.some((review) =>
    review.referenceFacts.some((fact) => criticalFactIds.includes(fact.factId) && !fact.captured)
  ) || Boolean(third?.referenceFacts.some((fact) =>
    criticalFactIds.includes(fact.factId) && !fact.captured
  ));

  const canCalculate = errors.length === 0 && complete && Boolean(authoritative);
  const labels = canCalculate ? authoritative!.claims : [];
  const facts = canCalculate ? authoritative!.referenceFacts : [];
  const stop = potentiallyHarmfulObserved || missedCriticalObserved;
  const status: CiqpAdjudicationAssessment['status'] =
    errors.length > 0 ? 'INVALID' :
    first.length < 2 ? 'AWAITING_INDEPENDENT_REVIEWS' :
    stop ? 'SAFETY_STOP' :
    disagreementCount > 0 && !third ? 'AWAITING_THIRD_ADJUDICATION' :
    'AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION';

  return {
    schema: CIQP_ADJUDICATION_SCHEMA,
    caseId: input.caseId,
    status,
    blockingReasons: [
      ...errors,
      ...(first.length < 2 ? ['CIQP_TWO_INDEPENDENT_CLINICIAN_REVIEWS_REQUIRED'] : []),
      ...(disagreementCount > 0 && !third ? ['CIQP_THIRD_ADJUDICATION_REQUIRED'] : []),
      ...(potentiallyHarmfulObserved ? ['CIQP_POTENTIALLY_HARMFUL_OUTPUT_STOP'] : []),
      ...(missedCriticalObserved ? ['CIQP_MISSED_CRITICAL_FACT_STOP'] : []),
      'CIQP_EXTERNAL_REVIEWER_CREDENTIAL_AND_INSTITUTIONAL_ATTESTATION_REQUIRED',
    ],
    receiptSha256: receiptHash,
    clinicianQualificationVerified: false,
    clinicallyValidated: false,
    clinicalReleaseApproved: false,
    observed: {
      claimCount: claims.length,
      supportedClaimPrecision: canCalculate
        ? ratio(labels.filter((x) => x.factuallySupported).length, labels.length) : null,
      sourceLinkAccuracy: canCalculate
        ? ratio(labels.filter((x) => x.sourceLinksCorrect).length, labels.length) : null,
      temporalAttributionAccuracy: canCalculate
        ? ratio(labels.filter((x) => x.temporalAttributionCorrect).length, labels.length) : null,
      criticalFactCount: criticalFactIds.length,
      criticalFactRecall: canCalculate
        ? ratio(facts.filter((x) => criticalFactIds.includes(x.factId) && x.captured).length,
          criticalFactIds.length) : null,
      potentiallyHarmfulClaimCount: canCalculate
        ? labels.filter((x) => x.potentiallyHarmful).length : null,
      reviewerDisagreementCount: disagreementCount,
    },
  };
}
