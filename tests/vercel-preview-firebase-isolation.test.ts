import {describe,expect,test} from 'bun:test';
import {assertVercelDeploymentFirebaseIsolation} from
  '@/lib/runtime/vercel-deployment-isolation';
import {readFileSync} from 'node:fs';

const allowed:NodeJS.ProcessEnv={
  VERCEL_ENV:'preview',
  GHIMS_RUNTIME_MODE:'STAGING',
  GHIMS_FIREBASE_PROJECT_ID_STAGING:'ghims-ai-qualification-only',
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION:'g-hims-ai',
  FIREBASE_CLIENT_EMAIL:'qualification@ghims-ai-qualification-only.iam.gserviceaccount.com',
};
function assert(config:NodeJS.ProcessEnv,actual='ghims-ai-qualification-only'){
  assertVercelDeploymentFirebaseIsolation({...allowed,...config},actual);
}
describe('Official G-HIMS-AI Vercel Preview production isolation',()=>{
  test('accepts only separate, explicitly scoped staging identity',()=>{
    expect(()=>assert({})).not.toThrow();
    expect(()=>assert({FIREBASE_CLIENT_EMAIL:''})).not.toThrow();
  });
  test('refuses exact observed preview -> production Firebase project collision',()=>{
    expect(()=>assert({
      GHIMS_FIREBASE_PROJECT_ID_STAGING:'g-hims-ai',
      FIREBASE_CLIENT_EMAIL:'admin@g-hims-ai.iam.gserviceaccount.com',
    },'g-hims-ai')).toThrow('VERCEL_PREVIEW_PRODUCTION_FIREBASE_BLOCKED');
    expect(()=>assert({GHIMS_RUNTIME_MODE:'PRODUCTION'},'g-hims-ai'))
      .toThrow('VERCEL_PREVIEW_PRODUCTION_FIREBASE_BLOCKED');
  });
  test('refuses production credential reuse even with separate project IDs',()=>{
    expect(()=>assert({FIREBASE_CLIENT_EMAIL:'production@g-hims-ai.iam.gserviceaccount.com'}))
      .toThrow('VERCEL_PREVIEW_ADMIN_IDENTITY_NOT_STAGING');
  });
  test.each([
    [{GHIMS_FIREBASE_PROJECT_ID_PRODUCTION:''},'ghims-ai-qualification-only'],
    [{GHIMS_RUNTIME_MODE:'TEST'},'ghims-ai-qualification-only'],
    [{GHIMS_FIREBASE_PROJECT_ID_STAGING:''},'ghims-ai-qualification-only'],
    [{},'unexpected-project'],
  ] as const)('fail closed on missing comparator, mode or project mismatch', (change,actual)=>{
    expect(()=>assert(change,actual)).toThrow();
  });
  test('Vercel production requires explicit matching production environment',()=>{
    const prod:NodeJS.ProcessEnv={...allowed,VERCEL_ENV:'production',
      GHIMS_RUNTIME_MODE:'PRODUCTION'};
    expect(()=>assertVercelDeploymentFirebaseIsolation(prod,'g-hims-ai')).not.toThrow();
    expect(()=>assertVercelDeploymentFirebaseIsolation(prod,'ghims-ai-qualification-only'))
      .toThrow('VERCEL_PRODUCTION_FIREBASE_ISOLATION_NOT_VERIFIED');
    expect(()=>assertVercelDeploymentFirebaseIsolation({
      ...prod,GHIMS_RUNTIME_MODE:'STAGING'},'g-hims-ai'))
      .toThrow('VERCEL_PRODUCTION_FIREBASE_ISOLATION_NOT_VERIFIED');
  });
  test('guard is invoked before Admin initialization and contains no network or writes',()=>{
    const contract=readFileSync('lib/runtime/environment-contract.ts','utf8');
    const admin=readFileSync('server/firebase/admin.ts','utf8');
    const guard=readFileSync('lib/runtime/vercel-deployment-isolation.ts','utf8');
    expect(contract).toContain('assertVercelDeploymentFirebaseIsolation(process.env, actualProjectId)');
    expect(admin).toContain('assertServerFirebaseProjectIsolation(projectId)');
    expect(admin.indexOf('assertServerFirebaseProjectIsolation(projectId)'))
      .toBeLessThan(admin.indexOf('const existingApps = getApps()'));
    expect(guard).not.toContain('firebase-admin');
    expect(guard).not.toContain('fetch(');
    expect(guard).not.toContain('setDoc(');
  });
});
