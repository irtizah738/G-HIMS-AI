/**
 * CI-EXT-14 offline G1 evidence candidate checker. No cloud permissions.
 *
 * This verifies a *submitted manifest's completeness and consistency*;
 * it NEVER reports that cloud enforcement passed. All references MUST
 * be independently checked against signed GCP evidence by reviewers.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9./:_-]{8,400}$/;
const PROBES = Object.freeze([
  'allowed-service-account', 'denied-service-account',
  'wrong-host', 'wrong-sni', 'missing-sni', 'wrong-port',
  'direct-ip', 'redirect-cross-host', 'dns-rebinding',
  'quic-udp443', 'route-removed', 'gateway-unavailable',
  'nat-bypass-attempt', 'cross-source-credentials',
]);
const ALLOW = 'allowed-service-account';
export function assessG1Evidence(candidate) {
  const errors=[];
  const obj=x => x && typeof x==='object' && !Array.isArray(x)?x:{};
  const root=obj(candidate);
  const meta=obj(root.metadata), safety=obj(root.safety), refs=obj(root.artifacts);
  if(root.schema!=='helixis.g1.actual-cloud-run.v1')errors.push('SCHEMA_INVALID');
  if(meta.project!=='studio-1130431360-48a05' ||
     meta.region!=='us-central1' ||
     meta.sourceVPC==='helixis-epic-egress' ||
     meta.sourceVPC==='helixis-ci-gateway-net' ||
     typeof meta.sourceVPC!=='string' ||
     !/^helixis-g1-[a-z0-9-]{5,40}$/.test(meta.sourceVPC)) {
    errors.push('DISPOSABLE_VPC_NOT_PROVEN');
  }
  if(meta.testWindowStart && meta.testWindowEnd &&
     Date.parse(meta.testWindowEnd) <= Date.parse(meta.testWindowStart)) {
    errors.push('TEST_WINDOW_INVALID');
  }
  const safe=safety.syntheticOnly===true &&
    safety.noEpicOAuthOrPHI===true &&
    safety.liveFHIRDisabled===true &&
    safety.sourceSealedWorkerUnchanged===true &&
    safety.r24LabUnchanged===true &&
    safety.untaggedNatAbsent===true &&
    safety.cleanupVerified===true;
  if(!safe)errors.push('SAFETY_ATTESTATION_INCOMPLETE');
  const artifactKeys=[
    'cloudRunConfigSha256','gatewayConfigSha256','gatewayPolicySha256',
    'firewallRoutesSha256','swpTransactionsSha256',
    'flowEvidenceSha256','teardownSha256',
  ];
  for(const key of artifactKeys)if(!SHA.test(String(refs[key]||'')))
    errors.push('ARTIFACT_HASH_MISSING:'+key);
  if(!Array.isArray(root.tests))errors.push('TESTS_MISSING');
  const tests=Array.isArray(root.tests)?root.tests:[];
  if(tests.length!==PROBES.length)errors.push('TEST_COUNT_INVALID');
  const seen=new Set();
  for(const rowInput of tests){
    const row=obj(rowInput), id=row.id;
    if(!PROBES.includes(id)||seen.has(id)){
      errors.push('UNKNOWN_OR_DUPLICATE_TEST');continue;
    }
    seen.add(id);
    if(row.observed!==((id===ALLOW)?'ALLOW':'DENY')) {
      errors.push('WRONG_OBSERVED_RESULT:'+id);
    }
    if(row.executedFromActualCloudRun!==true)errors.push('NOT_ACTUAL_CLOUD_RUN:'+id);
    if(!REF.test(String(row.jobExecutionRef||'')))errors.push('MISSING_JOB_REFERENCE:'+id);
    if(!REF.test(String(row.networkOrSwpEvidenceRef||'')))
      errors.push('MISSING_NETWORK_EVIDENCE:'+id);
    if(id===ALLOW && row.swpMatchedExactServiceAccount!==true)
      errors.push('SA_MATCHING_NOT_ATTESTED');
    if(id==='denied-service-account' &&
       row.sameNetworkAndRouteAsAllowed!==true) {
      errors.push('NEGATIVE_IDENTITY_NOT_COMPARABLE');
    }
    if(row.explanation || row.rawLog || row.token || row.patientId) {
      // Never accept unstructured text/possibly PHI in a shared evidence file.
      errors.push('UNSTRUCTURED_OR_SENSITIVE_EVIDENCE:'+id);
    }
  }
  for(const id of PROBES)if(!seen.has(id))errors.push('TEST_NOT_PRESENT:'+id);
  return {
    schema:'helixis.g1.evidence-assessment.v1',
    manifestComplete:errors.length===0,
    errors,
    externalGcpEvidenceIndependentlyValidated:false,
    productionAuthorization:'NO_GO',
    result:errors.length===0
      ? 'COMPLETE_CANDIDATE_REQUIRES_INDEPENDENT_REVIEW'
      : 'INCOMPLETE_DO_NOT_APPROVE',
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3)throw new Error('ONE_FILE_REQUIRED');
    const doc=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const out=assessG1Evidence(doc);
    process.stdout.write(JSON.stringify(out,null,2)+'\n');
    if(!out.manifestComplete)process.exitCode=1;
  }catch{
    process.stderr.write('G1_EVIDENCE_INVALID\n');
    process.exitCode=2;
  }
}
