import {describe,expect,test} from 'bun:test';
import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import {
  syntheticSignedAuthorityRows,
} from './support/ci-ext21-signed-fixtures';
import {
  installEmulatorHospitalTrustStewards,verifyCurrentSignedAuthorityRecord,
} from '@/lib/clinical/intelligence/external-signed-authority-consumer';

const NOW=1794200000000;
const TENANT='synthetic-ci21-tenant';
type Row=Record<string,unknown>;
function fixture(){
  const evidenceId='evidence-clinician-v1';
  const facilityId='hospital-a';
  const records=new Map<string,Row>();
  const signed=syntheticSignedAuthorityRows({
    tenantId:TENANT,facilityId,kind:'CLINICIAN',
    recordId:evidenceId,now:NOW,
    record:{
      schemaVersion:1,tenantId:TENANT,kind:'CLINICIAN',
      targetId:'clinician-a',facilityId,
      evidenceId,status:'VERIFIED',
      identityAssurance:'HOSPITAL_VERIFIED',
      licenseVerified:true,siteApprovalId:null,
      evidenceHash:'a'.repeat(64),
      verifiedByActorId:'separate-license-verifier',
      verifiedAt:NOW-1000,validFrom:NOW-60_000,
      validUntil:NOW+60_000,revokedAt:null,
    },
  });
  const put=(collection:string,id:string,value:Row)=>{
    records.set(collection+'/'+id,value);
  };
  put('externalClinicalIssuerAttestations',signed.attestationId,
    signed.attestation);
  put('externalClinicalIssuerEnrollmentCommands',signed.attestationId,
    signed.journal);
  put('externalClinicalIssuerOutbox',signed.attestationId,signed.outbox);
  put('externalClinicalHospitalTrustHeads',
    signed.pin.issuerId,signed.root.head);
  put('externalClinicalHospitalTrustEvents',
    signed.root.eventId,signed.root.event);
  const tenant={
    collection:(collection:string)=>({
      doc:(id:string)=>({path:collection+'/'+id}),
    }),
  } as unknown as DocumentReference;
  const snapshot=(ref:{path:string})=>{
    const row=records.get(ref.path);
    return {exists:row!==undefined,get:(f:string)=>row?.[f],
      data:()=>row};
  };
  const tx=({
    get:async(ref:{path:string})=>snapshot(ref),
    getAll:async(...refs:{path:string}[])=>refs.map(snapshot),
  }) as unknown as Transaction;
  const verify=(record:Row|undefined=signed.record,
    time=NOW)=>verifyCurrentSignedAuthorityRecord({
    tx,tenant,tenantId:TENANT,facilityId,
    kind:'CLINICIAN',recordId:evidenceId,record,now:time,
  });
  return {signed,records,verify};
}
describe('CI-EXT-21 signed current hospital authority consumption',()=>{
  test('valid signature and pinned trust authorize ONLY non-promoting test prequalification',async()=>{
    expect(await fixture().verify()).toEqual({
      valid:true,reasonCode:'CI_EXT21_SIGNED_AUTHORITY_NON_PROMOTING',
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
  });
  test('unsigned legacy and spoofed immutable flags are denied',async()=>{
    const f=fixture();
    const unsigned={...f.signed.record};
    delete unsigned.issuerAttestationId;
    expect((await f.verify(unsigned)).reasonCode)
      .toBe('CI_EXT21_UNSIGNED_LEGACY_RECORD');
    expect((await f.verify({...f.signed.record,
      issuerClaimDigest:'0'.repeat(64)})).reasonCode)
      .toBe('CI_EXT21_SIGNED_RECORD_LINEAGE_INVALID');
    expect((await f.verify({...f.signed.record,
      clinicalUseAuthorized:true})).reasonCode)
      .toBe('CI_EXT21_UNSIGNED_LEGACY_RECORD');
  });
  test('deleted attestation, forged signature, missing journal and outbox all deny',async()=>{
    const f=fixture();
    f.records.delete('externalClinicalIssuerAttestations/'+
      f.signed.attestationId);
    expect((await f.verify()).reasonCode)
      .toBe('CI_EXT21_SIGNED_ATTESTATION_MISSING');
    const g=fixture();
    g.records.set('externalClinicalIssuerAttestations/'+g.signed.attestationId,{
      ...g.signed.attestation,signatureBase64Url:'A'.repeat(86),
    });
    expect((await g.verify()).reasonCode)
      .toBe('CI_EXT21_CI_EXT20_SIGNATURE_INVALID');
    const h=fixture();
    h.records.delete('externalClinicalIssuerOutbox/'+h.signed.attestationId);
    expect((await h.verify()).reasonCode)
      .toBe('CI_EXT21_SIGNED_ATTESTATION_MISSING');
    const i=fixture();
    i.records.set('externalClinicalIssuerEnrollmentCommands/'+i.signed.attestationId,{
      ...i.signed.journal,recordId:'wrong-record',
    });
    expect((await i.verify()).reasonCode)
      .toBe('CI_EXT21_SIGNED_RECORD_LINEAGE_INVALID');
  });
  test('revoked root, superseded credential revision and expiry deny',async()=>{
    const f=fixture();
    f.records.set('externalClinicalHospitalTrustHeads/'+f.signed.pin.issuerId,{
      ...f.signed.root.head,status:'REVOKED',currentPin:null,
    });
    expect((await f.verify()).reasonCode)
      .toBe('CI_EXT23_CI_EXT22_ROOT_REVOKED_OR_SCOPE_INVALID');
    const g=fixture();
    expect((await g.verify({
      ...g.signed.record,issuerKeyRevision:2,
    })).reasonCode).toBe('CI_EXT23_KEY_SUPERSEDED_OR_MISMATCH');
    const h=fixture();
    expect((await h.verify(h.signed.record,NOW+60_001)).valid).toBe(false);
  });
  test('CI-EXT-23 requires event-backed root, current independent signer and exact scoped key',async()=>{
    const f=fixture();
    f.records.delete('externalClinicalHospitalTrustHeads/'+
      f.signed.pin.issuerId);
    expect((await f.verify()).reasonCode)
      .toBe('CI_EXT23_CI_EXT22_ROOT_MISSING');
    const g=fixture();
    g.records.set('externalClinicalHospitalTrustEvents/'+g.signed.root.eventId,{
      ...g.signed.root.event,eventHash:'0'.repeat(64),
    });
    expect((await g.verify()).reasonCode)
      .toBe('CI_EXT23_CI_EXT22_ROOT_EVENT_TAMPERED');
    const h=fixture();
    installEmulatorHospitalTrustStewards(
      h.signed.root.stewards.map(s=>
        s.role==='SECURITY_TRUSTEE'?{...s,status:'REVOKED' as const}:s));
    expect((await h.verify()).reasonCode)
      .toBe('CI_EXT23_CI_EXT22_STEWARD_QUORUM_NOT_CURRENT');
    const i=fixture();
    expect((await i.verify({...i.signed.record,
      issuerKeyId:'unrecognized-key'})).reasonCode)
      .toBe('CI_EXT23_KEY_SUPERSEDED_OR_MISMATCH');
  });
});
