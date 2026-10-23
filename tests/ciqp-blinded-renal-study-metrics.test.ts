import { describe, expect, test } from 'bun:test';
import {
  summarizeBlindedRenalStudy,
  type RenalCaseOutcome,
} from '@/lib/clinical/validation/blinded-renal-study-metrics';

const ids = Array.from({length:120}, (_,i) => 'SYNREN-'+i.toString(16).toUpperCase().padStart(12,'0'));
const empty = (): RenalCaseOutcome[] => ids.map(caseId=>({
  caseId, primaryA:null, primaryB:null, adjudicated:null,
  predictedFlag:null, sourceEvidenceValid:null,
  factualClaimSupported:null, criticalHarm:false,
}));

describe('CIQP blinded renal 120-case scoring, no clinical release by metrics', () => {
  test('zero adjudications yield all null rates, with all 120 missing', () => {
    const report = summarizeBlindedRenalStudy(empty(),ids);
    expect(report.status).toBe('DRAFT_NOT_CLINICALLY_APPROVED');
    expect(report.caseCount).toBe(120);
    expect(report.missingReference).toBe(120);
    expect(report.lockedReferenceCount).toBe(0);
    expect(report.noPrediction).toBe(120);
    expect(report.sensitivity.rate).toBeNull();
    expect(report.specificity.rate).toBeNull();
    expect(report.interReviewerKappa).toBeNull();
    expect(report.stopRequired).toBe(false);
  });

  test('counts false negatives and false alerts without conflating excluded values', () => {
    const cases = empty();
    Object.assign(cases[0],{primaryA:'YES',primaryB:'YES',adjudicated:'YES',predictedFlag:true});
    Object.assign(cases[1],{primaryA:'YES',primaryB:'NO',adjudicated:'YES',predictedFlag:false});
    Object.assign(cases[2],{primaryA:'NO',primaryB:'NO',adjudicated:'NO',predictedFlag:false});
    Object.assign(cases[3],{primaryA:'NO',primaryB:'NO',adjudicated:'NO',predictedFlag:true});
    Object.assign(cases[4],{primaryA:'YES',primaryB:'YES',adjudicated:'INSUFFICIENT_EVIDENCE',predictedFlag:true});
    Object.assign(cases[5],{primaryA:'YES',primaryB:'YES',adjudicated:'YES',predictedFlag:null});
    const r=summarizeBlindedRenalStudy(cases,ids);
    expect(r.confusion).toEqual({tp:1,fn:1,tn:1,fp:1});
    expect(r.sensitivity.rate).toBe(0.5);
    expect(r.specificity.rate).toBe(0.5);
    expect(r.falseAlert.rate).toBe(0.5);
    expect(r.missedDeterioration.rate).toBe(0.5);
    expect(r.stopRequired).toBe(true);
    expect(r.noPrediction).toBe(115);
    expect(r.indeterminateReference).toBe(1);
    expect(r.missingReference).toBe(114);
    expect(r.sensitivity.ci95?.[0]).toBeGreaterThanOrEqual(0);
    expect(r.sensitivity.ci95?.[1]).toBeLessThanOrEqual(1);
  });

  test('does not count missing or indeterminate as true negative', () => {
    const cases=empty();
    Object.assign(cases[0],{primaryA:'INSUFFICIENT_EVIDENCE',primaryB:'INSUFFICIENT_EVIDENCE',
      adjudicated:'INSUFFICIENT_EVIDENCE',predictedFlag:false});
    const r=summarizeBlindedRenalStudy(cases,ids);
    expect(r.confusion.tn).toBe(0);
    expect(r.specificity.denominator).toBe(0);
    expect(r.specificity.rate).toBeNull();
  });

  test('Cohen kappa excludes adjudication and uses both independently locked reviews', () => {
    const cases=empty();
    Object.assign(cases[0],{primaryA:'YES',primaryB:'YES',adjudicated:'YES',predictedFlag:true});
    Object.assign(cases[1],{primaryA:'NO',primaryB:'NO',adjudicated:'NO',predictedFlag:false});
    const r=summarizeBlindedRenalStudy(cases,ids);
    expect(r.interReviewerRawAgreement.rate).toBe(1);
    expect(r.interReviewerKappa).toBe(1);
  });

  test('rejects missing or duplicate cohort identities', () => {
    expect(()=>summarizeBlindedRenalStudy(empty().slice(1),ids)).toThrow('CIQP_RENAL_EVALUATION_LOCKED_COHORT_REQUIRED');
    expect(()=>summarizeBlindedRenalStudy([...empty().slice(1),empty()[0]],ids.slice(1).concat(ids[1]))).toThrow();
  });

  test('refuses adjudication without independent primary reviews', () => {
    const cases=empty();
    cases[0].adjudicated='YES';
    expect(()=>summarizeBlindedRenalStudy(cases,ids)).toThrow('CIQP_RENAL_ADJUDICATION_WITHOUT_BOTH_PRIMARY_LOCKS');
  });

  test('factual/source accuracy are measured only from independently assessed fields', () => {
    const cases=empty();
    cases[0].factualClaimSupported=true;
    cases[0].sourceEvidenceValid=false;
    cases[1].factualClaimSupported=false;
    cases[1].sourceEvidenceValid=true;
    const r=summarizeBlindedRenalStudy(cases,ids);
    expect(r.factualAccuracy.numerator).toBe(1);
    expect(r.factualAccuracy.denominator).toBe(2);
    expect(r.evidenceAccuracy.numerator).toBe(1);
    expect(r.evidenceAccuracy.denominator).toBe(2);
    expect(r.sensitivity.rate).toBeNull();
  });

  test('any critical harm triggers stop even if aggregate score seems good', () => {
    const cases=empty();
    cases[20].criticalHarm=true;
    const r=summarizeBlindedRenalStudy(cases,ids);
    expect(r.criticalHarmCount).toBe(1);
    expect(r.stopRequired).toBe(true);
  });
});
