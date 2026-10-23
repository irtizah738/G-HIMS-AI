/**
 * Offline research analysis only — NOT institutional approval or clinical
 * validation certification. Requires locked input-file digests and three
 * independent, fully completed clinician assessment sheets. Never reads PHI
 * or Firestore. No model calls, no clinical write access.
 *
 * Usage:
 * bun scripts/ops/ciqp-score-locked-blinded-cohort.ts <locked-input-manifest.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { summarizeBlindedRenalStudy, type RenalReference } from
  '@/lib/clinical/validation/blinded-renal-study-metrics';

interface ReviewRow {
  case_id: string;
  reference_actionable_deterioration: RenalReference | null;
  source_ids_supporting_judgment: string[];
  reasoning_summary: string | null;
  reviewed_at: string | null;
}
interface ReviewerSheet {
  case_file_sha256: string;
  reviewer_code: string;
  credentials_verified: boolean;
  clinical_policy_signed: boolean;
  review_results: ReviewRow[];
}
interface ModelRow {
  case_id: string;
  predicted_flag: boolean | null;
  source_evidence_valid: boolean | null;
  factual_claim_supported: boolean | null;
  critical_harm: boolean;
}
interface LockedReportManifest {
  status: 'EXTERNALLY_AUTHORIZED_FOR_BLINDED_ANALYSIS';
  cohort_file: string;
  cohort_sha256: string;
  reviewer_a_file: string;
  reviewer_a_sha256: string;
  reviewer_b_file: string;
  reviewer_b_sha256: string;
  adjudicator_file: string;
  adjudicator_sha256: string;
  sealed_predictions_file: string;
  sealed_predictions_sha256: string;
  protocol_approval_reference: string;
  institutional_governance_reference: string;
  reviewer_credential_verification_reference: string;
  original_reviewer_blinding_confirmed: true;
  adjudication_locked_before_predictions_unblinded: true;
}
const EXPECTED_COHORT_SHA = '116596dd531f549873cf026cb0e61209f96554954ca622f53ef3b7fb3adcca9d';

async function readExact(path: string, digest: string): Promise<string> {
  // No remote links, no network IO and no unsafe device paths.
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..') ||
      path.startsWith('/')) throw new Error('CIQP_ANALYSIS_LOCAL_PATH_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('CIQP_ANALYSIS_SHA256_INVALID');
  const bytes = await readFile(path);
  if (bytes.length > 5_000_000 ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw new Error('CIQP_ANALYSIS_LOCKED_INPUT_HASH_MISMATCH');
  }
  return bytes.toString('utf8');
}

function requireReview(
  sheet: ReviewerSheet,
  role: 'Reviewer_A' | 'Reviewer_B' | 'Adjudicator_C',
  caseIds: Set<string>
): Map<string, RenalReference> {
  if (sheet.reviewer_code !== role ||
      sheet.case_file_sha256 !== EXPECTED_COHORT_SHA ||
      sheet.credentials_verified !== true ||
      sheet.clinical_policy_signed !== true ||
      !Array.isArray(sheet.review_results) ||
      sheet.review_results.length !== 120) {
    throw new Error('CIQP_ANALYSIS_CLINICIAN_ATTESTATIONS_OR_COHORT_NOT_LOCKED');
  }
  const labels=new Map<string,RenalReference>();
  for(const row of sheet.review_results) {
    if(!caseIds.has(row.case_id) || labels.has(row.case_id) ||
       !['YES','NO','INSUFFICIENT_EVIDENCE'].includes(String(row.reference_actionable_deterioration)) ||
       !Array.isArray(row.source_ids_supporting_judgment) ||
       typeof row.reasoning_summary !== 'string' ||
       row.reasoning_summary.trim().length < 20 ||
       !row.reviewed_at || !Number.isFinite(Date.parse(row.reviewed_at))) {
      throw new Error('CIQP_ANALYSIS_CLINICAL_RATING_INCOMPLETE');
    }
    labels.set(row.case_id,row.reference_actionable_deterioration!);
  }
  return labels;
}

async function main() {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.GHIMS_INTEGRATION_AI_STATE !== 'DISABLED') {
    throw new Error('CIQP_ANALYSIS_REQUIRES_TEST_WITH_AI_DISABLED');
  }
  const manifestPath=process.argv[2];
  if (!manifestPath || !/^[A-Za-z0-9_./-]+$/.test(manifestPath) ||
      manifestPath.includes('..') || manifestPath.startsWith('/')) {
    throw new Error('CIQP_ANALYSIS_LOCKED_MANIFEST_REQUIRED');
  }
  const lock=JSON.parse(await readFile(manifestPath,'utf8')) as LockedReportManifest;
  if (lock.status !== 'EXTERNALLY_AUTHORIZED_FOR_BLINDED_ANALYSIS' ||
      lock.cohort_sha256 !== EXPECTED_COHORT_SHA ||
      lock.original_reviewer_blinding_confirmed !== true ||
      lock.adjudication_locked_before_predictions_unblinded !== true ||
      !String(lock.protocol_approval_reference||'').trim() ||
      !String(lock.institutional_governance_reference||'').trim() ||
      !String(lock.reviewer_credential_verification_reference||'').trim()) {
    throw new Error('CIQP_ANALYSIS_EXTERNAL_APPROVAL_REFERENCES_REQUIRED');
  }

  const cohort=(await readExact(lock.cohort_file,lock.cohort_sha256))
    .trimEnd().split('\n').map(s=>JSON.parse(s) as {case_id:string});
  const ids=cohort.map(c=>c.case_id);
  const caseIds=new Set(ids);
  if(ids.length!==120 || caseIds.size!==120) throw new Error('CIQP_ANALYSIS_120_COHORT_REQUIRED');

  const a=requireReview(JSON.parse(await readExact(lock.reviewer_a_file,lock.reviewer_a_sha256)),
    'Reviewer_A',caseIds);
  const b=requireReview(JSON.parse(await readExact(lock.reviewer_b_file,lock.reviewer_b_sha256)),
    'Reviewer_B',caseIds);
  const c=requireReview(JSON.parse(await readExact(lock.adjudicator_file,lock.adjudicator_sha256)),
    'Adjudicator_C',caseIds);

  const pred=JSON.parse(await readExact(lock.sealed_predictions_file,lock.sealed_predictions_sha256))
    as ModelRow[];
  if(!Array.isArray(pred)||pred.length!==120 ||
     pred.some(p=>!caseIds.has(p.case_id) ||
     ![true,false,null].includes(p.predicted_flag) ||
     ![true,false,null].includes(p.source_evidence_valid) ||
     ![true,false,null].includes(p.factual_claim_supported) ||
     typeof p.critical_harm!=='boolean')) throw new Error('CIQP_ANALYSIS_PREDICTIONS_INVALID');
  const predMap=new Map(pred.map(p=>[p.case_id,p]));
  if(predMap.size!==120) throw new Error('CIQP_ANALYSIS_DUPLICATE_PREDICTION');

  const report=summarizeBlindedRenalStudy(ids.map(id=>({
    caseId:id,primaryA:a.get(id)!,primaryB:b.get(id)!,
    adjudicated:c.get(id)!,
    predictedFlag:predMap.get(id)!.predicted_flag,
    sourceEvidenceValid:predMap.get(id)!.source_evidence_valid,
    factualClaimSupported:predMap.get(id)!.factual_claim_supported,
    criticalHarm:predMap.get(id)!.critical_harm,
  })),ids);

  const record={
    ...report, externalReferencesPresent: true,
    approvalsVerifiedIndependently: false,
    clinicalReleaseAuthorized: false,
    outputPurpose: 'ENGINEERING_DRAFT_FOR_INDEPENDENT_CLINICAL_AUDIT',
    referenceHashes: {
      cohort:lock.cohort_sha256,primaryA:lock.reviewer_a_sha256,
      primaryB:lock.reviewer_b_sha256,adjudicator:lock.adjudicator_sha256,
      sealedPredictions:lock.sealed_predictions_sha256,
    },
  };
  const outputPath='tmp/ghims-ciqp/locked-renal-evaluation-draft.json';
  await writeFile(outputPath,JSON.stringify(record,null,2)+'\n');
  console.log('CIQP_120_DRAFT_EVALUATION_REPORT=' + outputPath);
  console.log('CLINICAL_SIGNOFF_VERIFIED=NO');
  console.log('PRODUCTION_RELEASE_AUTHORIZATION=NOT_GRANTED');
}

if(import.meta.main) await main();
