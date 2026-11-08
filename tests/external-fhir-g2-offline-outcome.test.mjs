import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { classifyG2OfflinePollResponse } from '../lib/clinical/intelligence/external-fhir-g2-offline-outcome.ts';

const vars = [
  'NODE_ENV','GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
  'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE',
];
const before = Object.fromEntries(vars.map(key => [key,process.env[key]]));
Object.assign(process.env,{
  NODE_ENV:'test',GHIMS_RUNTIME_MODE:'TEST',FIREBASE_PROJECT_ID:'ghims-p4-ci',
  FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED:'false',
  GHIMS_INTEGRATION_FHIR_R4_STATE:'DISABLED',
});
after(() => vars.forEach(key =>
  before[key] === undefined ? delete process.env[key] : process.env[key] = before[key]));
const fixture = (httpStatus, extra={}) => ({
  tenantId:'tenant-a',sourceId:'his-a',workId:'work-01',attempt:1,httpStatus,...extra,
});
function assertNeverAuthorizes(response) {
  const result=classifyG2OfflinePollResponse(response);
  assert.equal(result.checkpointAuthorized,false);
  assert.equal(result.clinicalAuthority,false);
  assert.equal(result.deletionAuthorized,false);
  assert.equal(result.sourceMigrationAuthorized,false);
  assert.equal(result.productionRelease,'NO_GO');
  return result;
}

test('G2: successful HTTP response requires separate immutable evidence transaction', () => {
  const d=assertNeverAuthorizes(fixture(200));
  assert.equal(d.action,'VERIFY_IMMUTABLE_RECEIPT');
  assert.equal(d.retryDelayMs,null);
});
for (const httpStatus of [401,403]) {
  test('G2: credential or authorization failure '+httpStatus+' pauses source', () => {
    assert.equal(assertNeverAuthorizes(fixture(httpStatus)).action,'PAUSE_SOURCE_FOR_AUTH_REVIEW');
  });
}
for (const httpStatus of [404,410]) {
  test('G2: missing source resource '+httpStatus+' cannot silently delete clinical evidence', () => {
    assert.equal(assertNeverAuthorizes(fixture(httpStatus)).action,'HOLD_ABSENCE_FOR_RECONCILIATION');
  });
}
for (const httpStatus of [301,302,307,308]) {
  test('G2: redirect '+httpStatus+' is rejected without token forwarding', () => {
    assert.equal(assertNeverAuthorizes(fixture(httpStatus)).action,'REJECT_UNEXPECTED_REDIRECT');
  });
}
for (const httpStatus of [408,425,429,500,502,503,504]) {
  test('G2: transient response '+httpStatus+' remains bounded and deterministic', () => {
    const input=fixture(httpStatus,{attempt:2});
    const a=assertNeverAuthorizes(input),b=assertNeverAuthorizes(input);
    assert.equal(a.action,'RETRY_BOUNDED');
    assert.equal(a.retryDelayMs,b.retryDelayMs);
    assert.ok(a.retryDelayMs>=2_000 && a.retryDelayMs<=60_000);
    assert.equal(assertNeverAuthorizes({...input,attempt:5}).action,'QUARANTINE_FOR_REVIEW');
  });
}
test('G2: vendor Retry-After is honored when safe', () => {
  const d=assertNeverAuthorizes(fixture(429,{retryAfterSeconds:30}));
  assert.equal(d.action,'RETRY_BOUNDED');
  assert.ok(d.retryDelayMs>=30_000);
});
test('G2: vendor Retry-After must never be shortened to bounded retry', () => {
  for (const seconds of [61,3600,3601]) {
    const d=assertNeverAuthorizes(fixture(429,{retryAfterSeconds:seconds}));
    assert.equal(d.action,'HOLD_RATE_LIMIT_FOR_REVIEW');
    assert.equal(d.retryDelayMs,null);
  }
});
for (const httpStatus of [204,304,400,409,412,422,499,501]) {
  test('G2: ambiguous response '+httpStatus+' is quarantined rather than checkpointed', () => {
    assert.equal(assertNeverAuthorizes(fixture(httpStatus)).action,'QUARANTINE_FOR_REVIEW');
  });
}
test('G2: invalid scope, attempt, status and Retry-After fail closed', () => {
  const bad=[
    {...fixture(200),tenantId:'../tenant'},
    {...fixture(200),workId:''},
    {...fixture(200),attempt:0},
    {...fixture(200),attempt:6},
    {...fixture(200),attempt:1.5},
    fixture(600),
    fixture(99),
    fixture(429,{retryAfterSeconds:-1}),
    fixture(429,{retryAfterSeconds:1.5}),
  ];
  for (const item of bad) {
    assert.throws(()=>classifyG2OfflinePollResponse(item),/FHIR_G2_OFFLINE_RESPONSE_INVALID/);
  }
});
test('G2: production, absent emulator, and enabled integration are rejected', () => {
  for (const [name, value] of [
    ['GHIMS_RUNTIME_MODE','PRODUCTION'],
    ['FIRESTORE_EMULATOR_HOST',''],
    ['GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','true'],
    ['GHIMS_INTEGRATION_FHIR_R4_STATE','LIVE'],
  ]) {
    const old=process.env[name];
    try {
      process.env[name]=value;
      assert.throws(()=>classifyG2OfflinePollResponse(fixture(200)),/FHIR_G2_OFFLINE_TEST_ONLY/);
    } finally { process.env[name]=old; }
  }
});
