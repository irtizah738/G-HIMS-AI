import { describe, expect, test } from 'bun:test';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { assertPublicSandboxEgress, publicSandboxAddress } from '@/lib/interop/fhir-sandbox-egress';
import { probeVendorFhirSandbox, validateVendorFixtureManifest,
  type VendorFixtureManifest } from '@/lib/interop/fhir-vendor-sandbox-probe';

const now=1_800_000_000_000;
const source:FhirSourceRecord={
  tenantId:'synthetic-site',sourceId:'vendor-his',facilityId:'site-a',
  baseUrl:'https://fhir.vendor.example.test/r4',
  status:'ACTIVE',securityReviewStatus:'APPROVED',
  approvedResourceTypes:['Patient','Encounter','Observation'],
  oauth:{mode:'SMART_BACKEND',clientId:'helixis-vendor-client',
    tokenUrl:'https://auth.vendor.example.test/token',keyId:'key-a',
    credentialRevision:1,secretVersion:1,
    scopes:['system/Patient.rs','system/Encounter.rs','system/Observation.rs']},
};
const manifest:VendorFixtureManifest={
  tenantId:source.tenantId,sourceId:source.sourceId,facilityId:source.facilityId,
  manifestRevision:1,status:'APPROVED',syntheticOnly:true,
  credentialRevision:1,fhirBaseUrl:source.baseUrl,
  tokenUrl:source.oauth!.tokenUrl,approvedBy:'vendor-operator',
  vendorAuthorizationId:'vendor-authorized-2026',
  approvedAt:now-1000,expiresAt:now+86_400_000,
  fixtures:{
    patientId:'synthetic-p1',encounterId:'synthetic-e1',
    observationId:'synthetic-o1',
    observationCodeSystem:'http://loinc.org',
    observationCode:'2160-0',
  },
};
const hosts={
  allowedTokenHosts:['auth.vendor.example.test'],
  allowedFhirHosts:['fhir.vendor.example.test'],
};
const broker={
  async getAccessToken(args:{resourceType:string}){
    if(!['Patient','Encounter','Observation'].includes(args.resourceType))
      throw Error('INVALID_SCOPE');
    return 'synthetic-bearer-token';
  },
} as never;
const makeResource=(type:string,version='v1')=>({
  resourceType:type,
  id:type==='Patient'?'synthetic-p1':type==='Encounter'?'synthetic-e1':'synthetic-o1',
  meta:{versionId:version,lastUpdated:'2026-10-31T09:00:00Z'},
  ...(type==='Patient'?{}:{
    subject:{reference:'Patient/synthetic-p1'},
  }),
  ...(type==='Observation'?{code:{coding:[{system:'http://loinc.org',code:'2160-0'}]}}:{}),
});
function vendorFetch(overrides:{
  wrongPatient?:boolean;mutateReplay?:boolean;oversized?:boolean;
}={}):{fetchImpl:typeof fetch;calls:string[]}{
  const calls:string[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push(url);
    if(init?.method!=='GET'||init.redirect!=='error'||
       init.headers===undefined||!url.startsWith(source.baseUrl+'/')){
      throw Error('UNSAFE_VENDOR_REQUEST');
    }
    const kind=url.includes('/Patient/')?'Patient':
      url.includes('/Encounter/')?'Encounter':'Observation';
    const data=makeResource(kind,
      overrides.mutateReplay&&kind==='Observation'&&calls.length===4?'v2':'v1');
    if(overrides.wrongPatient&&kind==='Encounter')
      (data as {subject?:{reference:string}}).subject={reference:'Patient/another-patient'};
    return new Response(overrides.oversized?'X'.repeat(140_000):JSON.stringify(data),{
      status:200,headers:{'content-type':'application/fhir+json'},
    });
  };
  return {calls,fetchImpl};
}
describe('CI-EXT-06 vendor FHIR synthetic-only qualification',()=>{
  test('valid fixture probe observes exact patient links, stable versions, never approves clinical use',async()=>{
    const {fetchImpl,calls}=vendorFetch();
    const report=await probeVendorFhirSandbox({
      ...hosts,source,tenantId:source.tenantId,sourceId:source.sourceId,
      manifest,broker,fetchImpl,now:()=>now,
    });
    expect(report.outcome).toBe('OBSERVED_PENDING_INDEPENDENT_REVIEW');
    expect(report.errors).toEqual([]);
    expect(report.checks.patientRead).toBe(true);
    expect(report.checks.stableReplay).toBe(true);
    expect(report.qualifiedForPatientData).toBe(false);
    expect(report.qualifiedForProduction).toBe(false);
    expect(typeof report.evidenceHash).toBe('string');
    expect(calls).toEqual([
      source.baseUrl+'/Patient/synthetic-p1',
      source.baseUrl+'/Encounter/synthetic-e1',
      source.baseUrl+'/Observation/synthetic-o1',
      source.baseUrl+'/Observation/synthetic-o1',
    ]);
    expect(JSON.stringify(report).includes('valueQuantity')).toBe(false);
  });
  test('cross-patient reference blocks qualification and avoids replay read',async()=>{
    const {fetchImpl,calls}=vendorFetch({wrongPatient:true});
    const r=await probeVendorFhirSandbox({
      ...hosts,source,manifest,broker,
      tenantId:source.tenantId,sourceId:source.sourceId,
      fetchImpl,now:()=>now,
    });
    expect(r.outcome).toBe('FAILED');
    expect(r.checks.encounterPatientReference).toBe(false);
    expect(r.evidenceHash).toBe(null);
    expect(calls.length).toBe(3);
  });
  test('a changing version during replay is a failure, not an approved state',async()=>{
    const {fetchImpl}=vendorFetch({mutateReplay:true});
    const r=await probeVendorFhirSandbox({
      ...hosts,source,manifest,broker,
      tenantId:source.tenantId,sourceId:source.sourceId,
      fetchImpl,now:()=>now,
    });
    expect(r.outcome).toBe('FAILED');
    expect(r.errors).toContain('CI_EXT06_SOURCE_VERSION_CHANGED_DURING_PROBE');
  });
  test('oversized payload is rejected without returning the remote content',async()=>{
    const {fetchImpl}=vendorFetch({oversized:true});
    const r=await probeVendorFhirSandbox({
      ...hosts,source,manifest,broker,
      tenantId:source.tenantId,sourceId:source.sourceId,
      fetchImpl,now:()=>now,
    });
    expect(r.outcome).toBe('FAILED');
    expect(r.errors).toContain('CI_EXT06_RESPONSE_TOO_LARGE');
    expect(r.evidenceHash).toBe(null);
  });
  test('mismatched tenant, revoked manifest or rotated credentials block before HTTP',async()=>{
    const {fetchImpl,calls}=vendorFetch();
    await expect(probeVendorFhirSandbox({
      ...hosts,source,manifest,broker,
      tenantId:'another-hospital',sourceId:source.sourceId,
      fetchImpl,now:()=>now,
    })).rejects.toThrow('CI_EXT04_SOURCE_NOT_AUTHORIZED');
    expect(()=>validateVendorFixtureManifest(
      source,{...manifest,status:'REVOKED'},now,
    )).toThrow('CI_EXT06_MANIFEST_NOT_AUTHORIZED');
    expect(()=>validateVendorFixtureManifest(
      source,{...manifest,credentialRevision:2},now,
    )).toThrow('CI_EXT06_MANIFEST_NOT_AUTHORIZED');
    expect(calls.length).toBe(0);
  });
  test('egress blocks private, metadata, documentation and mixed DNS addresses',async()=>{
    expect(publicSandboxAddress('8.8.8.8')).toBe(true);
    expect(publicSandboxAddress('10.0.0.1')).toBe(false);
    expect(publicSandboxAddress('169.254.169.254')).toBe(false);
    expect(publicSandboxAddress('127.0.0.1')).toBe(false);
    expect(publicSandboxAddress('192.0.2.1')).toBe(false);
    expect(publicSandboxAddress('::1')).toBe(false);
    const good=()=>[{address:'8.8.8.8',family:4}];
    await assertPublicSandboxEgress({
      url:source.baseUrl,allowedHosts:hosts.allowedFhirHosts,
      resolve:async()=>good(),
    });
    await expect(assertPublicSandboxEgress({
      url:source.baseUrl,allowedHosts:hosts.allowedFhirHosts,
      resolve:async()=>[...good(),{address:'10.0.1.1',family:4}],
    })).rejects.toThrow('CI_EXT06_EGRESS_ADDRESS_DENIED');
    await expect(assertPublicSandboxEgress({
      url:'https://localhost/fhir',allowedHosts:['localhost'],
      resolve:async()=>good(),
    })).rejects.toThrow('CI_EXT06_EGRESS_ORIGIN_DENIED');
    await expect(assertPublicSandboxEgress({
      url:'https://unapproved.example/fhir',allowedHosts:hosts.allowedFhirHosts,
      resolve:async()=>good(),
    })).rejects.toThrow('CI_EXT06_EGRESS_ORIGIN_DENIED');
  });
});
