import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessG1Evidence } from '../scripts/ops/ci-ext14-assess-g1-evidence.mjs';
const ids=[
 'allowed-service-account','denied-service-account','wrong-host',
 'wrong-sni','missing-sni','wrong-port','direct-ip',
 'redirect-cross-host','dns-rebinding','quic-udp443',
 'route-removed','gateway-unavailable','nat-bypass-attempt',
 'cross-source-credentials'
];
function fixture(){
 return {
   schema:'helixis.g1.actual-cloud-run.v1',
   metadata:{
     project:'studio-1130431360-48a05',region:'us-central1',
     sourceVPC:'helixis-g1-disposable-net',testWindowStart:'2026-11-05T06:00:00Z',
     testWindowEnd:'2026-11-05T07:00:00Z',
   },
   safety:{
     syntheticOnly:true,noEpicOAuthOrPHI:true,liveFHIRDisabled:true,
     sourceSealedWorkerUnchanged:true,r24LabUnchanged:true,
     untaggedNatAbsent:true,cleanupVerified:true,
   },
   artifacts:Object.fromEntries([
     'cloudRunConfigSha256','gatewayConfigSha256','gatewayPolicySha256',
     'firewallRoutesSha256','swpTransactionsSha256',
     'flowEvidenceSha256','teardownSha256'
   ].map(k=>[k,'c'.repeat(64)])),
   tests:ids.map(id=>({
     id,observed:id==='allowed-service-account'?'ALLOW':'DENY',
     executedFromActualCloudRun:true,jobExecutionRef:'projects/staging/jobs/synthetic/executions/abc',
     networkOrSwpEvidenceRef:'projects/staging/logs/gateway/synthetic',
     ...(id==='allowed-service-account'?{swpMatchedExactServiceAccount:true}:{}),
     ...(id==='denied-service-account'?{sameNetworkAndRouteAsAllowed:true}:{}),
   })),
 };
}
test('G1 candidate is never a production approval, even if metadata is complete',()=>{
 const a=assessG1Evidence(fixture());
 assert.equal(a.manifestComplete,true);
 assert.equal(a.result,'COMPLETE_CANDIDATE_REQUIRES_INDEPENDENT_REVIEW');
 assert.equal(a.externalGcpEvidenceIndependentlyValidated,false);
 assert.equal(a.productionAuthorization,'NO_GO');
});
test('G1 refuses missing tests and fake positive identity',()=>{
 const f=fixture();
 f.tests=f.tests.filter(x=>x.id!=='denied-service-account');
 f.tests[0].swpMatchedExactServiceAccount=false;
 const result=assessG1Evidence(f);
 assert.equal(result.manifestComplete,false);
 assert.ok(result.errors.includes('TEST_NOT_PRESENT:denied-service-account'));
 assert.ok(result.errors.includes('SA_MATCHING_NOT_ATTESTED'));
});
test('G1 refuses protected VPC and uncertified teardown',()=>{
 const f=fixture();
 f.metadata.sourceVPC='helixis-epic-egress';
 f.safety.cleanupVerified=false;
 const result=assessG1Evidence(f);
 assert.equal(result.manifestComplete,false);
 assert.ok(result.errors.includes('DISPOSABLE_VPC_NOT_PROVEN'));
 assert.ok(result.errors.includes('SAFETY_ATTESTATION_INCOMPLETE'));
});
test('G1 rejects unstructured fields that might carry PHI or credentials',()=>{
 const f=fixture();
 f.tests[4].token='SHOULD_NOT_BE_INCLUDED';
 const result=assessG1Evidence(f);
 assert.equal(result.manifestComplete,false);
 assert.ok(result.errors.includes('UNSTRUCTURED_OR_SENSITIVE_EVIDENCE:missing-sni'));
});
