import { describe, expect, test } from 'bun:test';
import { ClinicalIntelligenceSafetyEvaluator as Safety } from '@/lib/clinical/intelligence/clinical-intelligence-safety-evaluator';
import {
  assessCiqpCaseAdjudication, ciqpReceiptSha256, CIQP_ADJUDICATION_SCHEMA,
  type CiqpCaseAdjudication, type CiqpClinicianReview,
  type CiqpObservedModelReceipt,
} from '@/lib/clinical/intelligence/ciqp-model-output-adjudication';
import type { ClinicalEvidenceSnapshot } from '@/types/clinical-intelligence-evidence';

function observed(): CiqpObservedModelReceipt {
  const content = { observations: ['Synthetic observation, no patient identifiers'] };
  const eventIds = ['synthetic-event-1'];
  const evidence = {
    evidenceId: 'evidence-1', tenantId: 'synthetic-tenant', patientId: 'synthetic-patient',
    sourceType: 'OBSERVATION' as const, sourceEntityId: 'synthetic-result-1',
    label: 'Synthetic observation', patient360Revision: 1,
    patient360SourceCheckpoint: 'source-1', sourceEventIds: eventIds,
    sourceEventCount: 1, sourceEventSetHash: Safety.sourceEventSetHash(eventIds),
    provenanceStatus: 'EVENT_VERIFIED' as const, content,
    contentHash: Safety.contentHash(content),
  };
  const snapshot: ClinicalEvidenceSnapshot = {
    snapshotId: 'synthetic-snapshot-1', tenantId: 'synthetic-tenant',
    patientId: 'synthetic-patient', purpose: 'CLINICAL_DRAFT',
    createdAt: 1000, createdBy: 'synthetic-clinician', immutable: true,
    schemaVersion: 2, patient360ProjectionVersion: 2,
    patient360Revision: 1, patient360SourceCheckpoint: 'source-1',
    patient360ContentHash: 'chart-content-1',
    evidenceRefs: [evidence], evidenceCount: 1, sourceEventCount: 1,
    dateRange: {}, limitations: [], snapshotHash: '',
  };
  snapshot.snapshotHash = Safety.snapshotHash(snapshot);
  return {
    schema: 'ciqp-real-provider-synthetic-receipt-v1',
    evidenceClass: 'OBSERVED_MODEL_OUTPUT_NOT_CLINICALLY_ADJUDICATED',
    cohort: 'SYNTHETIC',
    environment: 'DISPOSABLE_FIREBASE_EMULATORS_ONLY',
    caseId: 'synthetic-case-1',
    outcome: 'STRUCTURAL_SAFETY_PASSED_REQUIRES_CLINICIAN_ADJUDICATION',
    commitSha: 'a'.repeat(40),
    provider: 'google-genai', model: 'pinned-synthetic-model',
    snapshotId: snapshot.snapshotId, snapshotHash: snapshot.snapshotHash,
    patient360Revision: 1, patient360SourceCheckpoint: 'source-1',
    clinicallyValidated: false, signedClinicalAuthority: false,
    generationProvenance: {
      provider: 'google-genai', model: 'pinned-synthetic-model',
      purpose: 'CLINICAL_GOVERNED_DRAFT', generatedAt: 2000,
    },
    frozenEvidence: snapshot,
    generatedDraft: {
      title: 'Synthetic generated note', content: 'Synthetic generated material only.',
      claims: [{
        claimId: 'claim-1', text: 'Synthetic attributed result, no medical advice.',
        classification: 'DIRECT_FACT', evidenceRefs: ['evidence-1'],
      }],
    },
  };
}

function reviewer(receipt: CiqpObservedModelReceipt, code: string): CiqpClinicianReview {
  return {
    reviewerCode: code,
    qualificationEvidenceRef: 'institution-credential-' + code,
    blindedToGenerationMethod: true, reviewedAt: 3000,
    receiptSha256: ciqpReceiptSha256(receipt),
    claims: [{
      claimId: 'claim-1',
      factuallySupported: true, sourceLinksCorrect: true,
      temporalAttributionCorrect: true, potentiallyHarmful: false,
    }],
    referenceFacts: [{ factId: 'critical-1', captured: true }],
  };
}

function packageWithReviews(): CiqpCaseAdjudication {
  const receipt = observed();
  return {
    schema: CIQP_ADJUDICATION_SCHEMA, caseId: receipt.caseId,
    receipt, referenceLockedAt: 1000,
    referenceFacts: [{ factId: 'critical-1', evidenceId: 'evidence-1', critical: true }],
    independentReviews: [reviewer(receipt, 'reviewer-a'), reviewer(receipt, 'reviewer-b')],
  };
}

describe('CIQP real model-output adjudication integrity (synthetic test fixtures)', () => {
  test('complete two-reviewer case remains unverified, never clinically validated', () => {
    const result = assessCiqpCaseAdjudication(packageWithReviews());
    expect(result.status).toBe('AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION');
    expect(result.blockingReasons).toContain(
      'CIQP_EXTERNAL_REVIEWER_CREDENTIAL_AND_INSTITUTIONAL_ATTESTATION_REQUIRED'
    );
    expect(result.clinicallyValidated).toBe(false);
    expect(result.clinicianQualificationVerified).toBe(false);
    expect(result.clinicalReleaseApproved).toBe(false);
    expect(result.observed.supportedClaimPrecision).toBe(1);
    expect(result.observed.criticalFactRecall).toBe(1);
  });

  test('missing or unblinded clinician review is never considered completed', () => {
    const one = packageWithReviews();
    one.independentReviews.pop();
    const result = assessCiqpCaseAdjudication(one);
    expect(result.status).toBe('AWAITING_INDEPENDENT_REVIEWS');
    expect(result.observed.supportedClaimPrecision).toBeNull();
    one.independentReviews[0].blindedToGenerationMethod = false;
    const bad = assessCiqpCaseAdjudication(one);
    expect(bad.status).toBe('INVALID');
  });

  test('disagreements require a third independent adjudicator', () => {
    const input = packageWithReviews();
    input.independentReviews[1].claims[0].factuallySupported = false;
    const pending = assessCiqpCaseAdjudication(input);
    expect(pending.status).toBe('AWAITING_THIRD_ADJUDICATION');
    expect(pending.observed.supportedClaimPrecision).toBeNull();
    input.adjudicatorReview = reviewer(input.receipt, 'reviewer-c');
    const completed = assessCiqpCaseAdjudication(input);
    expect(completed.status).toBe('AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION');
    expect(completed.observed.reviewerDisagreementCount).toBe(1);
    expect(completed.observed.supportedClaimPrecision).toBe(1);
    input.adjudicatorReview.reviewerCode = 'reviewer-a';
    expect(assessCiqpCaseAdjudication(input).status).toBe('INVALID');
  });

  test('any harmfulness or missed critical fact triggers a safety stop', () => {
    const harmful = packageWithReviews();
    harmful.independentReviews[0].claims[0].potentiallyHarmful = true;
    expect(assessCiqpCaseAdjudication(harmful).status).toBe('SAFETY_STOP');
    const missed = packageWithReviews();
    missed.independentReviews[1].referenceFacts[0].captured = false;
    expect(assessCiqpCaseAdjudication(missed).status).toBe('SAFETY_STOP');
    expect(assessCiqpCaseAdjudication(missed).blockingReasons)
      .toContain('CIQP_MISSED_CRITICAL_FACT_STOP');
  });

  test('snapshot hash, reviewer receipt hash, frozen reference and citations fail closed', () => {
    const altered = packageWithReviews();
    altered.receipt.frozenEvidence.evidenceRefs[0].content = { tampered: true };
    expect(assessCiqpCaseAdjudication(altered).status).toBe('INVALID');
    const staleReceipt = packageWithReviews();
    staleReceipt.independentReviews[1].receiptSha256 = '0'.repeat(64);
    expect(assessCiqpCaseAdjudication(staleReceipt).status).toBe('INVALID');
    const lateReference = packageWithReviews();
    lateReference.referenceLockedAt = 4000;
    expect(assessCiqpCaseAdjudication(lateReference).status).toBe('INVALID');
    const unsupportedCitation = packageWithReviews();
    unsupportedCitation.receipt.generatedDraft.claims[0].evidenceRefs = ['other-patient-ref'];
    expect(assessCiqpCaseAdjudication(unsupportedCitation).status).toBe('INVALID');
  });

  test('unreviewed claims and duplicated reviewer codes fail closed', () => {
    const missingClaim = packageWithReviews();
    missingClaim.independentReviews[1].claims = [];
    expect(assessCiqpCaseAdjudication(missingClaim).status).toBe('INVALID');
    const duplicateReviewer = packageWithReviews();
    duplicateReviewer.independentReviews[1].reviewerCode = 'reviewer-a';
    expect(assessCiqpCaseAdjudication(duplicateReviewer).status).toBe('INVALID');
  });

  test('missing critical denominator is non-evaluable and never implicitly 100%', () => {
    const input = packageWithReviews();
    input.referenceFacts = [];
    input.independentReviews.forEach((review) => { review.referenceFacts = []; });
    const result = assessCiqpCaseAdjudication(input);
    expect(result.status).toBe('AWAITING_EXTERNAL_INSTITUTIONAL_VERIFICATION');
    expect(result.observed.criticalFactRecall).toBeNull();
  });
});
