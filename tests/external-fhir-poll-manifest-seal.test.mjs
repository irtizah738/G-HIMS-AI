/** Local cryptographic contract tests. No Firebase SDK, sockets or HTTP. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const prior = {};
for (const k of ['GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
    'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE']) prior[k] = process.env[k];
Object.assign(process.env, {
  GHIMS_RUNTIME_MODE: 'TEST', FIREBASE_PROJECT_ID: 'ghims-p4-ci',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
});
const {
  assertPollWorkManifest, sealPollWorkManifest, openPollWorkManifest,
  sealedManifestPayloadEquals, EmulatorOnlyAesGcmCipher,
} = await import('../lib/clinical/intelligence/external-fhir-poll-manifest-seal.ts');

function fixture() {
  return {
    manifestId: randomUUID(), tenantId: 'synthetic-tenant',
    facilityId: 'synthetic-facility', sourceId: 'synthetic-source',
    sourceRevision: '1794135521.100000123',
    startCheckpointSequence: 42,
    items: [
      { workId: randomUUID(), resourceType: 'Observation',
        resourceId: 'observation-sealed-secret', expectedVersionId: 'v1' },
      { workId: randomUUID(), resourceType: 'Encounter',
        resourceId: 'encounter-sealed-secret', expectedVersionId: 'version-v2' },
    ],
    vendorCursor: 'FHIR_NEXT_VENDOR_SECRET_CURSOR_CANNOT_LEAK',
  };
}
function cipher() { return new EmulatorOnlyAesGcmCipher(randomBytes(32), 'local-test-key-v1'); }
function open(doc, c, scope = doc) { return openPollWorkManifest(doc, c, scope); }
function changed(m, patch) { return { ...m, ...patch }; }

await test('Stage C: authentic manifest round-trip, opaque versions, exact cursor', () => {
  const m = fixture(), c = cipher(), d = sealPollWorkManifest(m, c);
  assert.deepEqual(open(d, c), m);
});
await test('Stage C: ciphertext never stores cursor/resource identifiers in plaintext fields', () => {
  const m = fixture(), c = cipher(), d = sealPollWorkManifest(m, c);
  for (const secret of ['FHIR_NEXT_VENDOR_SECRET_CURSOR_CANNOT_LEAK',
      'observation-sealed-secret', 'encounter-sealed-secret', 'version-v2']) {
    assert.ok(!JSON.stringify(d).includes(secret));
  }
  assert.deepEqual(Object.keys(d).sort(), [
    'clinicalAuthority','facilityId','immutable','manifestId','payload',
    'schemaVersion','sourceId','sourceRevision','status','tenantId'].sort());
});
await test('Stage C: random nonce per encryption, deterministic recovered content', () => {
  const m=fixture(), c=cipher(), a=sealPollWorkManifest(m,c), b=sealPollWorkManifest(m,c);
  assert.notEqual(a.payload.nonceHex,b.payload.nonceHex);
  assert.notEqual(a.payload.ciphertextBase64,b.payload.ciphertextBase64);
  assert.deepEqual(open(a,c),open(b,c));
});
await test('Stage C: exact same scope and payload is a valid idempotent replay', () => {
  const m=fixture(), c=cipher();
  assert.equal(sealedManifestPayloadEquals(m,open(sealPollWorkManifest(m,c),c)),true);
});
await test('Stage C: cursor change under same manifest ID is a conflict', () => {
  const m=fixture();
  assert.equal(sealedManifestPayloadEquals(m,changed(m,{vendorCursor:'different'})),false);
});
await test('Stage C: item change under same manifest ID is a conflict', () => {
  const m=fixture();
  assert.equal(sealedManifestPayloadEquals(m,changed(m,{items:[m.items[0]]})),false);
});
await test('Stage C: checkpoint change under same manifest ID is a conflict', () => {
  const m=fixture();
  assert.equal(sealedManifestPayloadEquals(m,changed(m,{startCheckpointSequence:43})),false);
});
await test('Stage C: null vendor cursor is round-trippable', () => {
  const m=changed(fixture(),{vendorCursor:null}),c=cipher();
  assert.deepEqual(open(sealPollWorkManifest(m,c),c),m);
});
await test('Stage C: bounded 12-item manifest is accepted', () => {
  const m=changed(fixture(),{items:Array.from({length:12},(_,i)=>({
    workId:randomUUID(),resourceType:'Patient',resourceId:`p${i}`,expectedVersionId:'1'}))});
  assertPollWorkManifest(m);
});

const bad = [
  ['tenant traversal',{tenantId:'../prod'}],
  ['tenant empty',{tenantId:''}],
  ['source traversal',{sourceId:'../../other'}],
  ['facility slash',{facilityId:'facility/child'}],
  ['manifest nonuuid',{manifestId:'not-a-uuid'}],
  ['source revision invalid',{sourceRevision:'1'}],
  ['source revision tampered',{sourceRevision:'1794135521.123'}],
  ['checkpoint negative',{startCheckpointSequence:-1}],
  ['checkpoint fraction',{startCheckpointSequence:1.5}],
  ['checkpoint unsafe',{startCheckpointSequence:Number.MAX_SAFE_INTEGER}],
  ['empty items',{items:[]}],
  ['too many items',{items:Array.from({length:13},(_,i)=>({
    workId:randomUUID(),resourceType:'Patient',resourceId:`p${i}`,expectedVersionId:'v1'}))}],
  ['unknown type',{items:[{...fixture().items[0],resourceType:'MedicationRequest'}]}],
  ['resource traversal',{items:[{...fixture().items[0],resourceId:'../../Patient/any'}]}],
  ['version slash',{items:[{...fixture().items[0],expectedVersionId:'v/2'}]}],
  ['invalid work UUID',{items:[{...fixture().items[0],workId:'secret'}]}],
  ['empty cursor',{vendorCursor:''}],
  ['oversized cursor',{vendorCursor:'z'.repeat(4097)}],
  ['undefined cursor',{vendorCursor:undefined}],
  ['invalid unicode-sized cursor',{vendorCursor:'🙂'.repeat(1025)}],
];
for (const [name, patch] of bad) {
  await test(`Stage C: rejects ${name}`, () => {
    assert.throws(()=>assertPollWorkManifest(changed(fixture(),patch)));
  });
}
await test('Stage C: duplicate UUID work IDs cannot be replayed as different items', () => {
  const m=fixture();
  assert.throws(()=>assertPollWorkManifest(changed(m,{items:[m.items[0],m.items[0]]})));
});

const alteredContext = [
 ['tenant',{tenantId:'some-other-tenant'}],
 ['facility',{facilityId:'some-other-facility'}],
 ['source',{sourceId:'some-other-source'}],
 ['manifest',{manifestId:randomUUID()}],
 ['revision',{sourceRevision:'1794135521.100000124'}],
];
for (const [name, patch] of alteredContext) {
  await test(`Stage C: rejects wrong ${name} associated-data binding`, () => {
    const m=fixture(),c=cipher(),d=sealPollWorkManifest(m,c);
    assert.throws(()=>open(d,c,changed(m,patch)),/SCOPE_OR_REVISION_MISMATCH/);
  });
}
const tamper = [
  ['ciphertext',d=>({...d,payload:{...d.payload,ciphertextBase64:'AAAA'}})],
  ['nonce',d=>({...d,payload:{...d.payload,nonceHex:'a'.repeat(24)}})],
  ['tag',d=>({...d,payload:{...d.payload,tagHex:'f'.repeat(32)}})],
  ['key id',d=>({...d,payload:{...d.payload,keyId:'other-key'}})],
  ['cipher suite',d=>({...d,payload:{...d.payload,suite:'AES_CBC'}})],
  ['unauthorized status',d=>({...d,status:'UNSEALED'})],
  ['authority escalation',d=>({...d,clinicalAuthority:true})],
  ['mutability escalation',d=>({...d,immutable:false})],
];
for(const [name,fn] of tamper) {
  await test(`Stage C: rejects tampered ${name}`,()=>{
    const m=fixture(),c=cipher(),d=sealPollWorkManifest(m,c);
    assert.throws(()=>open(fn(d),c));
  });
}
await test('Stage C: wrong encryption key cannot decrypt',()=>{
  const m=fixture(), d=sealPollWorkManifest(m,cipher());
  assert.throws(()=>open(d,cipher()),/AUTHENTICATION_FAILED/);
});
await test('Stage C: rejects 128-bit and empty test cipher keys',()=>{
  assert.throws(()=>new EmulatorOnlyAesGcmCipher(randomBytes(16)));
  assert.throws(()=>new EmulatorOnlyAesGcmCipher(new Uint8Array(0)));
});
for (const [name,key,value] of [
  ['LIVE runtime','GHIMS_RUNTIME_MODE','PRODUCTION'],
  ['wrong project','FIREBASE_PROJECT_ID','g-hims-ai'],
  ['missing emulator','FIRESTORE_EMULATOR_HOST',undefined],
  ['import enabled','GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','true'],
  ['live FHIR','GHIMS_INTEGRATION_FHIR_R4_STATE','LIVE'],
]) {
  await test(`Stage C: cipher fails closed with ${name}`,()=>{
    const before=process.env[key];
    try {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
      assert.throws(()=>new EmulatorOnlyAesGcmCipher(randomBytes(32)),/EMULATOR_ONLY/);
    }finally {if(before===undefined)delete process.env[key];else process.env[key]=before;}
  });
}
for (const [k,v] of Object.entries(prior)) {
  if (v === undefined) delete process.env[k]; else process.env[k]=v;
}
