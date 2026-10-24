/**
 * Clinical evaluation mathematics only. Not a diagnosis, approved clinical
 * accuracy study, or proof of professional reviewer credentials.
 *
 * The engine does not accept generated "gold labels". Only independently
 * adjudicated clinical judgments qualify as reference outcomes; indeterminate
 * cases remain explicitly reported, never silently counted as true negatives.
 */
import crypto from 'node:crypto';

export type RenalReference = 'YES' | 'NO' | 'INSUFFICIENT_EVIDENCE';

export interface RenalCaseOutcome {
  caseId: string;
  primaryA: RenalReference | null;
  primaryB: RenalReference | null;
  adjudicated: RenalReference | null;
  predictedFlag: boolean | null;
  sourceEvidenceValid: boolean | null;
  factualClaimSupported: boolean | null;
  criticalHarm: boolean;
}

export interface RenalNumericalMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
  ci95: [number, number] | null;
}

export interface RenalEvaluationSummary {
  status: 'DRAFT_NOT_CLINICALLY_APPROVED';
  caseCount: number;
  lockedReferenceCount: number;
  missingReference: number;
  indeterminateReference: number;
  noPrediction: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  sensitivity: RenalNumericalMetric;
  specificity: RenalNumericalMetric;
  missedDeterioration: RenalNumericalMetric;
  falseAlert: RenalNumericalMetric;
  factualAccuracy: RenalNumericalMetric;
  evidenceAccuracy: RenalNumericalMetric;
  interReviewerRawAgreement: RenalNumericalMetric;
  interReviewerKappa: number | null;
  criticalHarmCount: number;
  stopRequired: boolean;
  sourceFingerprint: string;
  limitations: string[];
}

function metric(numerator: number, denominator: number): RenalNumericalMetric {
  if (denominator === 0) return { numerator, denominator, rate: null, ci95: null };
  const p = numerator / denominator;
  const z = 1.959963984540054;
  const z2 = z*z;
  const center = (p + z2/(2*denominator)) / (1+z2/denominator);
  const half = z * Math.sqrt(p*(1-p)/denominator + z2/(4*denominator*denominator)) /
    (1+z2/denominator);
  return { numerator, denominator, rate: p,
    ci95: [Math.max(0, center-half), Math.min(1, center+half)] };
}

export function summarizeBlindedRenalStudy(
  cases: RenalCaseOutcome[],
  expectedCaseIds: string[]
): RenalEvaluationSummary {
  if (expectedCaseIds.length !== 120 || new Set(expectedCaseIds).size !== 120 ||
      cases.length !== expectedCaseIds.length ||
      new Set(cases.map(c => c.caseId)).size !== cases.length ||
      cases.some(c => !expectedCaseIds.includes(c.caseId))) {
    throw new Error('CIQP_RENAL_EVALUATION_LOCKED_COHORT_REQUIRED');
  }
  const ordered = [...cases].sort((a,b)=>a.caseId.localeCompare(b.caseId));
  if (ordered.some(c => c.adjudicated && (!c.primaryA || !c.primaryB))) {
    throw new Error('CIQP_RENAL_ADJUDICATION_WITHOUT_BOTH_PRIMARY_LOCKS');
  }
  if (ordered.some(c =>
    !['YES','NO','INSUFFICIENT_EVIDENCE',null].includes(c.primaryA) ||
    !['YES','NO','INSUFFICIENT_EVIDENCE',null].includes(c.primaryB) ||
    !['YES','NO','INSUFFICIENT_EVIDENCE',null].includes(c.adjudicated) ||
    ![true,false,null].includes(c.predictedFlag))) {
    throw new Error('CIQP_RENAL_EVALUATION_INVALID_LABEL');
  }

  const evaluable = ordered.filter(c =>
    (c.adjudicated === 'YES' || c.adjudicated === 'NO') &&
    c.predictedFlag !== null);
  const tp = evaluable.filter(c => c.adjudicated==='YES' && c.predictedFlag===true).length;
  const fn = evaluable.filter(c => c.adjudicated==='YES' && c.predictedFlag===false).length;
  const tn = evaluable.filter(c => c.adjudicated==='NO' && c.predictedFlag===false).length;
  const fp = evaluable.filter(c => c.adjudicated==='NO' && c.predictedFlag===true).length;

  // Agreement uses only the original blinded submissions, never the
  // third adjudicator. The indeterminate category is a legitimate class.
  const both = ordered.filter(c => c.primaryA !== null && c.primaryB !== null);
  const agreements = both.filter(c=>c.primaryA===c.primaryB).length;
  const labels: RenalReference[] = ['YES','NO','INSUFFICIENT_EVIDENCE'];
  const pe = both.length ? labels.reduce((sum,label) =>
    sum + both.filter(c=>c.primaryA===label).length *
    both.filter(c=>c.primaryB===label).length /
    (both.length*both.length), 0) : null;
  const po = both.length ? agreements/both.length : null;
  const kappa = pe===null || po===null || pe===1
    ? null : (po-pe)/(1-pe);

  const factual = ordered.filter(c=>c.factualClaimSupported!==null);
  const evidence = ordered.filter(c=>c.sourceEvidenceValid!==null);
  const fatal = ordered.filter(c=>c.criticalHarm).length;
  const missingReference = ordered.filter(c=>c.adjudicated===null).length;
  const indeterminateReference = ordered.filter(c=>c.adjudicated==='INSUFFICIENT_EVIDENCE').length;
  const noPrediction = ordered.filter(c=>c.predictedFlag===null).length;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');

  return {
    status: 'DRAFT_NOT_CLINICALLY_APPROVED',
    caseCount: ordered.length,
    lockedReferenceCount: 120-missingReference,
    missingReference, indeterminateReference, noPrediction,
    confusion: {tp,fp,tn,fn},
    sensitivity: metric(tp,tp+fn),
    specificity: metric(tn,tn+fp),
    missedDeterioration: metric(fn,tp+fn),
    falseAlert: metric(fp,tn+fp),
    factualAccuracy: metric(factual.filter(c=>c.factualClaimSupported===true).length,factual.length),
    evidenceAccuracy: metric(evidence.filter(c=>c.sourceEvidenceValid===true).length,evidence.length),
    interReviewerRawAgreement: metric(agreements,both.length),
    interReviewerKappa: kappa,
    criticalHarmCount: fatal,
    stopRequired: fatal>0 || fn>0,
    sourceFingerprint: fingerprint,
    limitations: [
      'Draft engineering summary only; no clinician approval, licence verification or institutional release authorization.',
      'Synthetic enriched cohort is not representative of a hospital patient population.',
      'Unknown or missing clinician labels and model results are excluded from confusion counts and reported separately.',
      'A missing prediction is not equivalent to an actual negative test.',
      'Factual and source scores require independent evidence adjudication; empty denominators remain null.',
      'No clinical release threshold may be selected after unblinding. Critical misses require investigation.',
    ],
  };
}
