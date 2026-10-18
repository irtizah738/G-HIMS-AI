/**
 * G-HIMS-AI Release Candidate 1: PURE configuration preflight.
 *
 * No network, Firebase Admin, clinical access, write or deployment happens
 * here. Valid configuration permits a separate protected synthetic Preview
 * rehearsal only; it does NOT authorize data access or clinical use.
 */
import { evaluateStagingConfiguration } from './staging-preflight';

export type Rc1Preflight = {
  operation: 'GHIMS_AI_CI_RC1_ISOLATED_PREFLIGHT';
  status: 'BLOCKED' | 'CONFIGURATION_CANDIDATE_ONLY';
  blockerCodes: string[];
  missingKeys: string[];
  qualifiedForRealCare: false;
  qualifiedForProductionDeployment: false;
  operatorApproval: 'REQUIRED';
  clinicalApproval: 'REQUIRED';
  sourceCommit: 'UNVERIFIED' | 'MATCHED_UNATTESTED';
  externalCalls: 0;
  writes: 0;
};

export function evaluateCiRc1IsolatedPreflight(env: NodeJS.ProcessEnv): Rc1Preflight {
  const base = evaluateStagingConfiguration(env);
  const blockers = new Set(base.blockerCodes);
  const requiredSha = String(env.GHIMS_CI_RC1_EXPECTED_SHA ?? '').trim();
  const actualSha = String(env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  const shaMatching =
    /^[a-f0-9]{40}$/.test(requiredSha) && actualSha === requiredSha;
  if (!shaMatching) blockers.add('CI_RC1_EXACT_DEPLOYED_SHA_REQUIRED');

  // RC1 is a private, synthetic-only demonstration. Real integration or
  // clinical authority remains disabled until independently qualified.
  if (String(env.GHIMS_CI_RC1_DATA_CLASS ?? '').trim() !==
      'FABRICATED_SYNTHETIC_ONLY') {
    blockers.add('CI_RC1_FABRICATED_SYNTHETIC_DATA_ONLY');
  }
  if (String(env.GHIMS_CI_RC1_OPERATION ?? '').trim() !==
      'READ_ONLY_DEMONSTRATION') {
    blockers.add('CI_RC1_READ_ONLY_DEMONSTRATION_ONLY');
  }

  if (String(env.GHIMS_INTEGRATION_AI_STATE ?? '').trim() !== 'DISABLED') {
    blockers.add('CI_RC1_LIVE_AI_NOT_AUTHORIZED');
  }

  // Explicitly do not count a successful G-HIMS-OS workflow as evidence
  // that the separate official G-HIMS-AI source has been qualified.
  if (String(env.GHIMS_CI_RC1_SOURCE_REPOSITORY ?? '').trim() !==
      'irtizah738/G-HIMS-AI') {
    blockers.add('CI_RC1_OFFICIAL_SOURCE_REQUIRED');
  }
  return {
    operation: 'GHIMS_AI_CI_RC1_ISOLATED_PREFLIGHT',
    status: blockers.size ? 'BLOCKED' : 'CONFIGURATION_CANDIDATE_ONLY',
    blockerCodes: [...blockers].sort(),
    missingKeys: base.missingKeys,
    qualifiedForRealCare: false,
    qualifiedForProductionDeployment: false,
    operatorApproval: 'REQUIRED',
    clinicalApproval: 'REQUIRED',
    sourceCommit: shaMatching ? 'MATCHED_UNATTESTED' : 'UNVERIFIED',
    externalCalls: 0,
    writes: 0,
  };
}

if (import.meta.main) {
  const report = evaluateCiRc1IsolatedPreflight(process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'BLOCKED') process.exitCode = 1;
}
