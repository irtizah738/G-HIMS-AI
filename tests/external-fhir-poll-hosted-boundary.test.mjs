import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign,randomBytes} from 'node:crypto';
import {
  inspectStageHOfflineBoundary,stageHSigningBytes,stageHPageProofsDigest,
} from '../lib/clinical/intelligence/external-fhir-poll-hosted-boundary.ts';
import {
  EmulatorOnlyStageGWitnessIssuer,EmulatorOnlyStageGWitnessVerifier,
  stageGCertificateFingerprint,
} from '../lib/clinical/intelligence/external-fhir-poll-vendor-cursor.ts';
const env=['NODE_ENV','GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
  'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE'];
const prior=Object.fromEntries(env.map(x=>[x,process.env[x]]));
const values=['test','TEST','ghims-p4-ci','127.0.0.1:8080','false','DISABLED'];
env.forEach((k,i)=>process.env[k]=values[i]);
after(()=>env.forEach(k=>prior[k]===undefined?delete process.env[k]:process.env[k]=prior[k]));
const NOW=1794135555123;
const CHALLENGE='a'.repeat(64);
const REV='1794135521.123456789';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pem=k=>k.export({type:'spki',format:'pem'});
const keys=()=>generateKeyPairSync('ed25519');
function make(){
  const root=keys(),clockKeys=keys(),witnessKeys=keys(),vendorKeys=keys(),stageGKeys=keys();
  const scope={tenantId:'stage-h-tenant',sourceId:'stage-h-his',facilityId:'stage-h-facility',
    sourceRevision:REV,configuredVendorEndpoint:'https://fhir.example.test/r4'};
  const stageFAnchorFingerprint='a'.repeat(64);
  const stageGIssuer=new EmulatorOnlyStageGWitnessIssuer(stageGKeys.privateKey);
  const stageGVerifier=new EmulatorOnlyStageGWitnessVerifier(stageGKeys.publicKey);
  const witnessId=randomUUID(),m1=randomUUID(),m2=randomUUID(),cursorTag='b'.repeat(64);
  const certificate=stageGIssuer.sign({schemaVersion:1,
    kind:'SYNTHETIC_VENDOR_CURSOR_CHAIN_LOCAL_WITNESS',witnessId,sequence:3,
    previousFingerprint:'c'.repeat(64),issuedAtMs:NOW-10_000,expiresAtMs:NOW+90_000,
    tenantId:scope.tenantId,sourceId:scope.sourceId,facilityId:scope.facilityId,
    sourceRevision:scope.sourceRevision,stageFAnchorFingerprint,
    pages:[{manifestId:m1,manifestRevision:REV,startCheckpointSequence:0,endCheckpointSequence:2,
      requestCursorTag:null,nextCursorTag:cursorTag,completedEvidenceDigest:'d'.repeat(64)},
      {manifestId:m2,manifestRevision:REV,startCheckpointSequence:2,endCheckpointSequence:4,
        requestCursorTag:cursorTag,nextCursorTag:null,completedEvidenceDigest:'e'.repeat(64)}],
  });
  const certificateFingerprint=stageGCertificateFingerprint(certificate);
  const head={witnessId,sequence:3,certificateFingerprint,previousFingerprint:certificate.previousFingerprint};
  const settings={timeMs:NOW,clockSequence:10,witnessIssuedMs:NOW-1000,vendorIssuedMs:NOW-1000,
    clockKeyId:'clock-v1',witnessKeyId:'witness-v1',vendorKeyId:'vendor-v1',
    clockSignatureKey:clockKeys.privateKey,witnessSignatureKey:witnessKeys.privateKey,
    vendorSignatureKey:vendorKeys.privateKey, clockChallenge:CHALLENGE,witnessChallenge:CHALLENGE,
    vendorChallenge:CHALLENGE, clockKind:'SYNTHETIC_CLOCK_ATTESTATION',
    witnessKind:'SYNTHETIC_REMOTE_WITNESS_HEAD',vendorKind:'SYNTHETIC_VENDOR_ORIGIN_ADAPTER',
    witnessScope:scope,vendorScope:scope,witnessHead:head,
    vendorFingerprint:certificateFingerprint,
    pageProofsDigest:stageHPageProofsDigest(certificate.pages),
    vendorOrigin:'TEST_SIGNED_FIXTURE_ONLY',
  };
  const entries=[
    {keyId:'clock-v1',purpose:'CLOCK',publicKeyPem:pem(clockKeys.publicKey),
      notBeforeMs:NOW-100000,notAfterMs:NOW+400000,revoked:false},
    {keyId:'witness-v1',purpose:'WITNESS',publicKeyPem:pem(witnessKeys.publicKey),
      notBeforeMs:NOW-100000,notAfterMs:NOW+400000,revoked:false},
    {keyId:'vendor-v1',purpose:'VENDOR_SIMULATOR',publicKeyPem:pem(vendorKeys.publicKey),
      notBeforeMs:NOW-100000,notAfterMs:NOW+400000,revoked:false},
  ];
  const registry={schemaVersion:1,revision:3,issuedAtMs:NOW-60_000,
    expiresAtMs:NOW+400_000,keys:entries,rootSignatureHex:''};
  const resign=()=>{
    const {rootSignatureHex:_,...body}=registry;
    registry.rootSignatureHex=sign(null,stageHSigningBytes('REGISTRY',body),root.privateKey).toString('hex');
  };
  resign();
  const envelope=(purpose,payload,keyId,privateKey)=>({payload,keyId,
    signatureHex:sign(null,stageHSigningBytes(purpose,payload),privateKey).toString('hex')});
  const args={scope,certificate,stageGVerifier,trustedStageFAnchorFingerprint:stageFAnchorFingerprint,
    rootPublicKeyPem:pem(root.publicKey),registry,
    floors:{registryRevision:3,clockSequence:9,lastTrustedTimeMs:NOW-2000,witnessSequence:3},
    newChallenge:()=>CHALLENGE,
    clock:{sample:async challenge=>envelope('CLOCK',{schemaVersion:1,kind:settings.clockKind,
      challenge:settings.clockChallenge,sequence:settings.clockSequence,observedAtMs:settings.timeMs},
      settings.clockKeyId,settings.clockSignatureKey)},
    witness:{readCurrentHead:async ({challenge,scope})=>envelope('WITNESS',{
      schemaVersion:1,kind:settings.witnessKind,challenge:settings.witnessChallenge,
      issuedAtMs:settings.witnessIssuedMs,scope:settings.witnessScope,head:settings.witnessHead},
      settings.witnessKeyId,settings.witnessSignatureKey)},
    vendor:{inspect:async ({challenge,scope,certificateFingerprint})=>envelope('VENDOR_SIMULATOR',{
      schemaVersion:1,kind:settings.vendorKind,challenge:settings.vendorChallenge,
      issuedAtMs:settings.vendorIssuedMs,scope:settings.vendorScope,
      stageGCertificateFingerprint:settings.vendorFingerprint,
      pageProofsDigest:settings.pageProofsDigest,sourceMode:settings.vendorOrigin},
      settings.vendorKeyId,settings.vendorSignatureKey)},
  };
  return {args,settings,resign,keys:{root,clockKeys,witnessKeys,vendorKeys,stageGKeys},
    registry,entries,scope,head};
}
const qualify=f=>inspectStageHOfflineBoundary(f.args);
function rejects(label,change,pattern=/FHIR_POLL_H_|FHIR_POLL_G_/){
  test('Stage H rejects '+label,async()=>{const f=make();change(f);await assert.rejects(qualify(f),pattern);});
}
test('Stage H: three independently signed, scoped attestations bind Stage G certificate',async()=>{
  const f=make(),out=await qualify(f);
  assert.equal(out.status,'LOCAL_INTEGRATION_CONTRACT_VALIDATED');
  assert.equal(out.productionRelease,'NO_GO');
  assert.equal(out.vendorOrigin,'TEST_FIXTURE_ONLY_NOT_VENDOR_AUTHENTICATED');
  assert.equal(out.witnessAuthority,'LOCAL_ADAPTER_ONLY_NOT_HOSTED');
  assert.equal(out.stageGCertificateFingerprint,f.head.certificateFingerprint);
  assert.match(out.evidenceFingerprint,/^[0-9a-f]{64}$/);
});
test('Stage H: an actual random challenge is generated in the verifier',async()=>{
  const f=make();delete f.args.newChallenge;
  f.args.clock.sample=async challenge=>{f.settings.clockChallenge=challenge;
    f.settings.witnessChallenge=challenge;f.settings.vendorChallenge=challenge;
    assert.match(challenge,/^[0-9a-f]{64}$/);return makeEnvelope(f,'CLOCK',{
      schemaVersion:1,kind:'SYNTHETIC_CLOCK_ATTESTATION',challenge,sequence:10,observedAtMs:NOW});};
  assert.equal((await qualify(f)).productionRelease,'NO_GO');
});
function makeEnvelope(f,purpose,payload){
 const lookup={CLOCK:['clockKeyId','clockSignatureKey'],WITNESS:['witnessKeyId','witnessSignatureKey'],
    VENDOR_SIMULATOR:['vendorKeyId','vendorSignatureKey']};
 const [keyField,privateField]=lookup[purpose];return {payload,keyId:f.settings[keyField],
  signatureHex:sign(null,stageHSigningBytes(purpose,payload),f.settings[privateField]).toString('hex')};
}
rejects('registry unsigned or tampered',f=>f.registry.keys[0].revoked=true,/REGISTRY_SIGNATURE/);
rejects('registry signature forged',f=>f.registry.rootSignatureHex='0'.repeat(128),/REGISTRY_SIGNATURE/);
rejects('registry signed by wrong trust root',f=>f.args.rootPublicKeyPem=pem(keys().publicKey),/REGISTRY_SIGNATURE/);
rejects('registry revision rollback despite valid root signature',f=>{f.registry.revision=2;f.resign();},/REGISTRY_SIGNATURE/);
rejects('registry expired',f=>{f.registry.expiresAtMs=NOW;f.resign();},/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('registry issued in future',f=>{f.registry.issuedAtMs=NOW+1;f.resign();},/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('registry window too long',f=>{f.registry.expiresAtMs=f.registry.issuedAtMs+86_400_001;f.resign();},/REGISTRY_SIGNATURE/);
rejects('registry duplicate key ID',f=>{f.registry.keys.push({...f.registry.keys[0]});f.resign();},/KEY_REGISTRY_ENTRY/);
rejects('registry missing vendor simulator purpose',f=>{f.registry.keys[2].purpose='WITNESS';f.resign();},/KEY_PURPOSE_MISSING/);
rejects('registry uses non-Ed25519 key',f=>{f.registry.keys[2].publicKeyPem='not a key';f.resign();},/KEY_REGISTRY_ENTRY/);
rejects('registry extra field',f=>{f.registry.newField='surprise';f.resign();},/REGISTRY_SIGNATURE/);
rejects('wrong source tenant',f=>f.args.scope={...f.scope,tenantId:'another'},/STAGE_G_SCOPE_CHANGED/);
rejects('wrong source facility',f=>f.args.scope={...f.scope,facilityId:'another'},/STAGE_G_SCOPE_CHANGED/);
rejects('wrong source revision',f=>f.args.scope={...f.scope,sourceRevision:'1794135521.999999999'},/STAGE_G_SCOPE_CHANGED/);
rejects('wrong pinned Stage F anchor',f=>f.args.trustedStageFAnchorFingerprint='f'.repeat(64),/STAGE_G_SCOPE_CHANGED/);
rejects('untrusted Stage G signature',f=>f.args.stageGVerifier=new EmulatorOnlyStageGWitnessVerifier(keys().publicKey),/FHIR_POLL_G_SIGNATURE_INVALID/);
rejects('endpoint is not HTTPS',f=>f.args.scope={...f.scope,configuredVendorEndpoint:'http://example.test'},/SCOPE_OR_FLOOR/);
rejects('endpoint contains credentials',f=>f.args.scope={...f.scope,configuredVendorEndpoint:'https://user:pw@example.test/r4'},/SCOPE_OR_FLOOR/);
rejects('endpoint silently changes in witness proof',f=>f.settings.witnessScope={...f.scope,configuredVendorEndpoint:'https://other.example.test/r4'},/REMOTE_WITNESS_MISMATCH/);
rejects('endpoint silently changes in vendor proof',f=>f.settings.vendorScope={...f.scope,configuredVendorEndpoint:'https://other.example.test/r4'},/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('zero challenge',f=>f.args.newChallenge=()=>'0'.repeat(64),/CHALLENGE_INVALID/);
rejects('short challenge',f=>f.args.newChallenge=()=>'ab',/CHALLENGE_INVALID/);
rejects('clock replayed challenge',f=>f.settings.clockChallenge='b'.repeat(64),/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock stale sequence',f=>f.settings.clockSequence=9,/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock future/backward wall time against persisted floor',f=>f.settings.timeMs=NOW-3000,/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock before certificate issuance',f=>f.settings.timeMs=f.args.certificate.issuedAtMs-1,/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock after certificate expiry',f=>f.settings.timeMs=f.args.certificate.expiresAtMs,/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock missing proof',f=>f.args.clock.sample=async()=>null,/CLOCK_SEQUENCE_OR_WINDOW/);
rejects('clock signed by wrong key',f=>f.settings.clockSignatureKey=keys().privateKey,/PROOF_SIGNATURE_INVALID/);
rejects('clock signed using witness key purpose',f=>{f.settings.clockKeyId='witness-v1';f.settings.clockSignatureKey=f.keys.witnessKeys.privateKey;},/SIGNING_KEY_INACTIVE/);
rejects('clock key revoked',f=>{f.entries[0].revoked=true;f.resign();},/SIGNING_KEY_INACTIVE/);
rejects('clock key retired',f=>{f.entries[0].notAfterMs=NOW;f.resign();},/SIGNING_KEY_INACTIVE/);
rejects('witness replayed challenge',f=>f.settings.witnessChallenge='b'.repeat(64),/REMOTE_WITNESS_MISMATCH/);
rejects('witness missing proof',f=>f.args.witness.readCurrentHead=async()=>null,/REMOTE_WITNESS_MISMATCH/);
rejects('witness changed head fingerprint',f=>f.settings.witnessHead={...f.head,certificateFingerprint:'0'.repeat(64)},/REMOTE_WITNESS_MISMATCH/);
rejects('witness wrong head sequence',f=>f.settings.witnessHead={...f.head,sequence:4},/REMOTE_WITNESS_MISMATCH/);
rejects('witness low sequence floor',f=>f.args.floors={...f.args.floors,witnessSequence:4},/REMOTE_WITNESS_MISMATCH/);
rejects('witness forged previous fingerprint',f=>f.settings.witnessHead={...f.head,previousFingerprint:'0'.repeat(64)},/REMOTE_WITNESS_MISMATCH/);
rejects('witness missing head',f=>f.settings.witnessHead=null,/REMOTE_WITNESS_MISMATCH/);
rejects('witness stale issue time',f=>f.settings.witnessIssuedMs=NOW-120_001,/SIGNING_KEY_INACTIVE/);
rejects('witness time in future',f=>f.settings.witnessIssuedMs=NOW+1,/SIGNING_KEY_INACTIVE/);
rejects('witness forged signature',f=>f.settings.witnessSignatureKey=keys().privateKey,/PROOF_SIGNATURE_INVALID/);
rejects('witness revoked key',f=>{f.entries[1].revoked=true;f.resign();},/SIGNING_KEY_INACTIVE/);
rejects('witness retired key',f=>{f.entries[1].notAfterMs=NOW;f.resign();},/SIGNING_KEY_INACTIVE/);
rejects('vendor replayed challenge',f=>f.settings.vendorChallenge='b'.repeat(64),/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('vendor changes origin mode to live claimed',f=>f.settings.vendorOrigin='LIVE_VENDOR_SIGNED',/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('vendor substitutes proof from other cursor chain',f=>f.settings.pageProofsDigest='0'.repeat(64),/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('vendor substitutes other Stage G certificate',f=>f.settings.vendorFingerprint='0'.repeat(64),/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('vendor proof without signature',f=>f.args.vendor.inspect=async()=>null,/VENDOR_PROVENANCE_NOT_BOUND/);
rejects('vendor forged signature',f=>f.settings.vendorSignatureKey=keys().privateKey,/PROOF_SIGNATURE_INVALID/);
rejects('vendor proof stale',f=>f.settings.vendorIssuedMs=NOW-120_001,/SIGNING_KEY_INACTIVE/);
rejects('vendor proof in future',f=>f.settings.vendorIssuedMs=NOW+1,/SIGNING_KEY_INACTIVE/);
rejects('vendor key revoked',f=>{f.entries[2].revoked=true;f.resign();},/SIGNING_KEY_INACTIVE/);
rejects('vendor retired key',f=>{f.entries[2].notAfterMs=NOW;f.resign();},/SIGNING_KEY_INACTIVE/);
test('Stage H: signed key rotation accepts new active key after retiring old key',async()=>{
 const f=make();const newKeys=keys();
 f.entries[0].notAfterMs=NOW;
 f.entries.push({keyId:'clock-v2',purpose:'CLOCK',publicKeyPem:pem(newKeys.publicKey),
   notBeforeMs:NOW-300,notAfterMs:NOW+400000,revoked:false});
 f.registry.revision=4;f.args.floors={...f.args.floors,registryRevision:4};
 f.settings.clockKeyId='clock-v2';f.settings.clockSignatureKey=newKeys.privateKey;
 f.resign();assert.equal((await qualify(f)).registryRevision,4);
});
test('Stage H: old key is denied after rotation even for backdated proof',async()=>{
 const f=make();const newKeys=keys();
 f.entries[0].notAfterMs=NOW;f.entries.push({keyId:'clock-v2',purpose:'CLOCK',publicKeyPem:pem(newKeys.publicKey),
 notBeforeMs:NOW-300,notAfterMs:NOW+400000,revoked:false});
 f.registry.revision=4;f.args.floors={...f.args.floors,registryRevision:4};f.resign();
 await assert.rejects(qualify(f),/SIGNING_KEY_INACTIVE/);
});
test('Stage H: no hosted KMS or vendor authenticity is claimed',async()=>{
 const f=make(),r=await qualify(f);assert.equal(r.productionRelease,'NO_GO');
 assert.ok(!JSON.stringify(r).includes('READY_FOR_PRODUCTION'));
 assert.ok(!JSON.stringify(r).includes('KMS_QUALIFIED'));
});
test('Stage H: stageG testimony cannot be downgraded by removing certificate',async()=>{
 const f=make();f.args.certificate=null;await assert.rejects(qualify(f));
});
test('Stage H: issuer/signer cannot be invoked outside TEST',()=>{
 const was=process.env.GHIMS_RUNTIME_MODE;process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
 try{assert.throws(()=>stageHSigningBytes('CLOCK',{test:true}),/TEST_ONLY/);}
 finally{process.env.GHIMS_RUNTIME_MODE=was;}
});
test('Stage H: verifier refuses missing emulator even if the project id is correct',async()=>{
 const f=make(),was=process.env.FIRESTORE_EMULATOR_HOST;
 delete process.env.FIRESTORE_EMULATOR_HOST;
 try{await assert.rejects(qualify(f),/TEST_ONLY/);}
 finally{process.env.FIRESTORE_EMULATOR_HOST=was;}
});
