import {describe,expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {evaluateCiRc1IsolatedPreflight} from '@/scripts/ops/ci-rc1-isolated-preflight';

const SHA='7'.repeat(40);
const env:NodeJS.ProcessEnv={
  VERCEL_ENV:'preview',
  VERCEL_GIT_COMMIT_SHA:SHA,
  GHIMS_CI_RC1_EXPECTED_SHA:SHA,
  GHIMS_CI_RC1_DATA_CLASS:'FABRICATED_SYNTHETIC_ONLY',
  GHIMS_CI_RC1_OPERATION:'READ_ONLY_DEMONSTRATION',
  GHIMS_CI_RC1_SOURCE_REPOSITORY:'irtizah738/G-HIMS-AI',
  GHIMS_RUNTIME_MODE:'STAGING',
  NEXT_PUBLIC_GHIMS_RUNTIME_MODE:'STAGING',
  FIREBASE_PROJECT_ID:'ghims-ai-synthetic-stage',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID:'ghims-ai-synthetic-stage',
  GHIMS_FIREBASE_PROJECT_ID_STAGING:'ghims-ai-synthetic-stage',
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING:'ghims-ai-synthetic-stage',
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION:'g-hims-ai',
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION:'g-hims-ai',
  FIRESTORE_DATABASE_ID:'(default)',
  NEXT_PUBLIC_FIRESTORE_DATABASE_ID:'(default)',
  NEXT_PUBLIC_FIREBASE_API_KEY:'FAKE_ONLY',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'ghims-ai-synthetic-stage.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_APP_ID:'FAKE_ONLY',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:'FAKE_ONLY',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:'ghims-ai-synthetic-stage.firebasestorage.app',
  FIREBASE_CLIENT_EMAIL:'reader@ghims-ai-synthetic-stage.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:'FAKE_NONFUNCTIONAL_KEY',
  GHIMS_INTEGRATION_AI_STATE:'DISABLED',
  GHIMS_INTEGRATION_HL7_STATE:'DISABLED',
  GHIMS_INTEGRATION_FHIR_R4_STATE:'DISABLED',
  GHIMS_INTEGRATION_DICOMWEB_STATE:'DISABLED',
  GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE:'DISABLED',
  GHIMS_INTEGRATION_EDI_X12_STATE:'DISABLED',
};
const check=(override:NodeJS.ProcessEnv={})=>
  evaluateCiRc1IsolatedPreflight({...env,...override});

describe('G-HIMS-AI controlled Clinical Intelligence RC1',()=>{
  test('isolated synthetic config remains an unapproved CANDIDATE, not clinical release',()=>{
    const r=check();
    expect(r.status).toBe('CONFIGURATION_CANDIDATE_ONLY');
    expect(r.blockerCodes).toEqual([]);
    expect(r.sourceCommit).toBe('MATCHED_UNATTESTED');
    expect(r.qualifiedForRealCare).toBe(false);
    expect(r.qualifiedForProductionDeployment).toBe(false);
    expect(r.operatorApproval).toBe('REQUIRED');
    expect(r.clinicalApproval).toBe('REQUIRED');
    expect(r.writes).toBe(0);
    expect(r.externalCalls).toBe(0);
  });
  test.each([
    [{FIREBASE_PROJECT_ID:'g-hims-ai'},'STAGING_ACTIVE_FIREBASE_PROJECT_MISMATCH'],
    [{GHIMS_FIREBASE_PROJECT_ID_STAGING:'g-hims-ai'},'STAGING_PRODUCTION_PROJECT_COLLISION'],
    [{FIREBASE_CLIENT_EMAIL:'admin@g-hims-ai.iam.gserviceaccount.com'},'STAGING_ADMIN_IDENTITY_NOT_PROJECT_SCOPED'],
    [{GHIMS_CI_RC1_EXPECTED_SHA:'2'.repeat(40)},'CI_RC1_EXACT_DEPLOYED_SHA_REQUIRED'],
    [{VERCEL_ENV:'production'},'CI_RC1_PROTECTED_PREVIEW_REQUIRED'],
    [{VERCEL_ENV:''},'CI_RC1_PROTECTED_PREVIEW_REQUIRED'],
    [{GHIMS_CI_RC1_DATA_CLASS:'REAL_PATIENT'},'CI_RC1_FABRICATED_SYNTHETIC_DATA_ONLY'],
    [{GHIMS_CI_RC1_OPERATION:'LIVE_CLINICAL'},'CI_RC1_READ_ONLY_DEMONSTRATION_ONLY'],
    [{GHIMS_CI_RC1_SOURCE_REPOSITORY:'irtizah738/G-HIMS-OS'},'CI_RC1_OFFICIAL_SOURCE_REQUIRED'],
    [{GHIMS_INTEGRATION_AI_STATE:'ENABLED'},'CI_RC1_LIVE_AI_NOT_AUTHORIZED'],
    [{FIREBASE_PRIVATE_KEY:''},'STAGING_REQUIRED_CONFIGURATION_MISSING'],
  ] as Array<[NodeJS.ProcessEnv,string]>)
  ('rejects wrong source/target, unsafe data and missing evidence %#',(override,code)=>{
    const r=check(override);
    expect(r.status).toBe('BLOCKED');
    expect(r.blockerCodes).toContain(code);
  });
  test('never logs project IDs, credentials, MRNs, clinical contents or signs off',()=>{
    const r=check({FIREBASE_CLIENT_EMAIL:'prod@g-hims-ai.iam.gserviceaccount.com'});
    const report=JSON.stringify(r);
    for(const value of [
      'prod@g-hims-ai.iam.gserviceaccount.com','FAKE_NONFUNCTIONAL_KEY',
      'g-hims-ai','ghims-ai-synthetic-stage',
    ]) expect(report).not.toContain(value);
    const code=readFileSync('scripts/ops/ci-rc1-isolated-preflight.ts','utf8');
    expect(code).not.toContain('firebase-admin');
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('setDoc(');
    expect(code).not.toContain('runTransaction(');
    expect(code).toContain('qualifiedForRealCare: false');
    expect(code).toContain('qualifiedForProductionDeployment: false');
  });
});
