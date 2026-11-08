/** Offline-only CI runner: compile and execute all pinned FHIR emulator suites.
 * Never use cloud credentials or a non-synthetic Firestore project. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const suites = Object.freeze([
  'helixis-external-fhir-import',
  'helixis-external-clinician-review',
  'helixis-external-patient360',
  'helixis-fhir-entered-in-error-projection',
  'helixis-fhir-availability-reconciliation',
  'helixis-fhir-history-integrity',
  'helixis-fhir-source-sync-coordinator',
  'helixis-fhir-synthetic-poll-runner',
  'helixis-fhir-persistent-manifest',
  'helixis-fhir-migration-rehearsal',
  'helixis-fhir-multi-page-recovery',
  'helixis-fhir-g2-durable-work',
]);
const required = {
  NODE_ENV: 'test', GHIMS_RUNTIME_MODE: 'TEST', FIREBASE_PROJECT_ID: 'ghims-p4-ci',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
};
for (const [key,value] of Object.entries(required)) {
  if (process.env[key] !== value) throw new Error('CI_EMULATOR_ENV_GUARD_' + key);
}
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_PRIVATE_KEY','FIREBASE_CLIENT_EMAIL',
                   'CLOUDSDK_CORE_PROJECT','GCLOUD_PROJECT']) {
  const value = process.env[key];
  if (value && !(key==='GCLOUD_PROJECT' && value==='ghims-p4-ci')) {
    throw new Error('CI_EMULATOR_CREDENTIAL_GUARD_'+key);
  }
}
const root=resolve(process.cwd());
if (!existsSync(join(root,'firestore.rules')) || !existsSync(join(root,'firebase.json'))) {
  throw new Error('CI_EMULATOR_REPO_ROOT_REQUIRED');
}
const outputDir=join(root,'.tmp','fhir-node');
mkdirSync(outputDir,{recursive:true});
const generated=[];
const compiled=[];
function run(exe,args){
  const result=spawnSync(exe,args,{cwd:root,stdio:'inherit',env:process.env,shell:false});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error('CI_EMULATOR_COMMAND_FAILED_'+exe+'_'+result.status);
}
try {
  for(const name of suites){
    const input=join(root,'emulator-security',name+'.test.ts');
    if(!existsSync(input)) throw new Error('CI_EMULATOR_SOURCE_MISSING_'+name);
    const transformed=join(root,'emulator-security',name+'.node.test.ts');
    if(existsSync(transformed)) throw new Error('CI_EMULATOR_TEMP_COLLISION_'+name);
    const contents=readFileSync(input,'utf8');
    if(!contents.includes("from 'bun:test'")) throw new Error('CI_EMULATOR_TEST_IMPORT_CONTRACT_'+name);
    writeFileSync(transformed,contents.replaceAll("from 'bun:test'","from './helixis-node-test-compat'"),{flag:'wx'});
    generated.push(transformed);
    const dest=join(outputDir,name+'.node.test.js');
    rmSync(dest,{force:true});
    run('bun',['build',transformed,'--target=node','--format=cjs','--packages=external','--outfile='+dest]);
    if(!existsSync(dest)) throw new Error('CI_EMULATOR_BUNDLE_MISSING_'+name);
    compiled.push(dest);
  }
  if(suites.length!==12 || compiled.length!==suites.length) throw new Error('CI_EMULATOR_SUITE_INCOMPLETE');
  console.info('CI_EMULATOR_COMPILED_SUITES='+compiled.length);
  const testCommand='node --test '+compiled.map(p=>JSON.stringify(p)).join(' ');
  run('firebase',['emulators:exec','--project','ghims-p4-ci','--only','firestore',testCommand]);
  console.info('CI_EMULATOR_QUALIFICATION=PASS_LOCAL_ONLY');
  console.info('PRODUCTION_RELEASE=NO_GO');
} finally {
  for(const file of generated) rmSync(file,{force:true});
}
