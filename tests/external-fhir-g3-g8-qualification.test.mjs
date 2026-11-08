import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  G3_G8_REQUIRED_CONTROLS,
  assertGateScope, planSyntheticFencedMigration,
  evaluateG3G8Offline, assessFhirCheckpoint,
  offlineDossierFingerprint,
} from '../lib/clinical/intelligence/external-fhir-g3-g8-qualification.ts';

const scope = Object.freeze({
  tenantId: 'synthetic-tenant', facilityId: 'synthetic-facility',
  sourceId: 'synthetic-epic', environment: 'STAGING_SYNTHETIC',
});
const sha = 'a'.repeat(64);
const at = '2026-11-08T08:00:00Z';
const signoffs = ['ARCHITECTURE','SECURITY','CLINICAL','HOSPITAL_AUTHORITY','RELEASE_MANAGER']
  .map(role => ({ role, signerId: `reviewer-${role}`, tenantId:scope.tenantId,
    facilityId:scope.facilityId, sourceId:scope.sourceId, artifactSha256:sha,
    signedAtUtc:at, independentlyVerified:true }));
const allEvidence = () => Object.entries(G3_G8_REQUIRED_CONTROLS)
  .flatMap(([gate, controls]) => controls.map(control => ({
    gate, control, status:'PASS', scope, artifactSha256:sha,
    artifactRef:`offline://${gate}/${control}`, reviewerId:'independent-test-auditor',
    assessedAtUtc:at,
  })));
function dossier(overrides={}) {
  return {
    scope, evidence:allEvidence(), signoffs,
    gitSha:'b'.repeat(40), imageDigest:'sha256:'+'c'.repeat(64),
    changeRequestId:'SYNTHETIC-CHANGE-1',
    canaryStartUtc:'2026-11-08T08:00:00Z', canaryEndUtc:'2026-11-08T09:00:00Z',
    flags:{ externalFhirImport:false, externalPatient360Promotion:false,
      externalClinicalAiDrafting:false },
    externalG1Status:'BLOCKED', externalG2Status:'SKIPPED_COST',
    ...overrides,
  };
}
const source = { tenantId:scope.tenantId, facilityId:scope.facilityId,
  sourceId:scope.sourceId, status:'ACTIVE', securityReviewStatus:'APPROVED',
  sourceRevision:'rev-17',fixtureOnly:true };
const plan = overrides => planSyntheticFencedMigration({
  scope, source, orchestratorEndToEndPass:true,
  oneOffWriterDisarmed:true, exactSourceRevisionReadback:true,
  twoIndependentReviewerIds:['security-reviewer','clinical-reviewer'], ...overrides,
});
const checkpoint = overrides => assessFhirCheckpoint({
  httpStatus:200, operationReservedBeforeHttp:true, activeFenceAtCommit:true,
  sourceActiveAtCommit:true, verifiedPatientLinkAtCommit:true,
  consentGrantedAtCommit:true, immutableReceiptCommitted:true,
  immutableAuditCommitted:true, heldOutboxCommitted:true,
  availabilityReconciled:true, headCurrent:true,
  reconciliationRequired:false, clinicalResourceEnteredInError:false,
  ...overrides,
});

test('G3: never permit LIVE FENCED migration even with purported pass evidence', () => {
  const r = plan({scope:{...scope,environment:'LIVE'}});
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.blockers.includes('STAGING_SYNTHETIC_ONLY'));
  assert.equal(r.mutationExecuted,false);
  assert.equal(r.proposedPatch,null);
});
test('G3: source identity, status, and existing FENCED setting must match', () => {
  for (const s of [
    {...source,tenantId:'other-tenant'},
    {...source,status:'SUSPENDED'},
    {...source,securityReviewStatus:'REVOKED'},
    {...source,syncMode:'FENCED'},
    {...source,fixtureOnly:false},
  ]) assert.equal(plan({source:s}).status,'BLOCKED');
});
test('G3: completed orchestrator, disarmed legacy importer, revision and dual review required', () => {
  for (const o of [
    {orchestratorEndToEndPass:false}, {oneOffWriterDisarmed:false},
    {exactSourceRevisionReadback:false},
    {twoIndependentReviewerIds:['same','same']},
  ]) assert.equal(plan(o).status,'BLOCKED');
});
test('G3: qualified synthetic migration yields proposed patch, never performs mutation', () => {
  const r=plan();
  assert.equal(r.status,'PLAN_READY_NO_MUTATION');
  assert.deepEqual(r.proposedPatch,{syncMode:'FENCED'});
  assert.equal(r.mutationExecuted,false);
});
test('G4: source-specific scope validation rejects tenant/path injection', () => {
  assert.throws(()=>assertGateScope({...scope,sourceId:'../another-source'}),/SCOPE_INVALID/);
  assert.throws(()=>assertGateScope({...scope,tenantId:''}),/SCOPE_INVALID/);
});
test('G5: HTTP 200 alone never checkpoints', () => {
  const r=checkpoint({immutableReceiptCommitted:false});
  assert.equal(r.checkpointAllowed,false);
  assert.ok(r.blockers.includes('RECEIPT_NOT_COMMITTED'));
});
test('G5: crash after receipt before held outbox and audit does not checkpoint', () => {
  const r=checkpoint({immutableAuditCommitted:false,heldOutboxCommitted:false});
  assert.equal(r.checkpointAllowed,false);
  assert.ok(r.blockers.includes('AUDIT_NOT_COMMITTED'));
});
test('G5: stale epoch, missing reservation, suspended source and revoked consent fail closed', () => {
  for(const o of [
    {activeFenceAtCommit:false}, {operationReservedBeforeHttp:false},
    {sourceActiveAtCommit:false}, {consentGrantedAtCommit:false},
    {verifiedPatientLinkAtCommit:false},
  ]) assert.equal(checkpoint(o).checkpointAllowed,false);
});
test('G5: 401/403 block authority; 429/5xx retry, 404/410 remain held', () => {
  for(const status of [401,403]) assert.equal(checkpoint({httpStatus:status}).disposition,'BLOCKED_AUTHORITY');
  for(const status of [429,500,503]) assert.equal(checkpoint({httpStatus:status}).disposition,'RETRY_LATER');
  for(const status of [404,410]) assert.equal(checkpoint({httpStatus:status}).disposition,'HELD_RECONCILIATION');
});
test('G5/G6: reconciliation and erroneous versions never checkpoint',()=>{
  for(const o of [{headCurrent:false},{availabilityReconciled:false},
    {reconciliationRequired:true},{clinicalResourceEnteredInError:true}]) {
    assert.equal(checkpoint(o).checkpointAllowed,false);
  }
});
test('G5: only durable current 200 with all authority gates can be considered for checkpoint',()=>{
  const r=checkpoint();
  assert.equal(r.checkpointAllowed,true);
  assert.equal(r.disposition,'CHECKPOINT_CANDIDATE');
});
test('G3–G8: missing evidence and all billable skipped gates remain blocked',()=>{
  const d=dossier({evidence:[]});
  const r=evaluateG3G8Offline(d);
  assert.equal(r.productionDecision,'NO_GO');
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.gates.length,6);
  assert.ok(r.blockers.some(s=>s.includes('G3:SOURCE_BASELINE_FINGERPRINT:MISSING')));
});
test('G7: forged PASS without independently identifiable evidence cannot pass gate',()=>{
  const e=allEvidence(); e[0]={...e[0],artifactSha256:null};
  const r=evaluateG3G8Offline(dossier({evidence:e}));
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.blockers.some(s=>s.includes('UNVERIFIABLE_EVIDENCE')));
});
test('G8: duplicate evidence, mismatched source scope and duplicate reviewer cannot pass',()=>{
  const e=allEvidence();
  e[0]={...e[0],scope:{...scope,sourceId:'other'}};
  e.push(e[1]);
  const s=signoffs.map(x=>x.role==='SECURITY'?{...x,signerId:'reviewer-CLINICAL'}:x);
  const r=evaluateG3G8Offline(dossier({evidence:e,signoffs:s}));
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.blockers.some(x=>x.includes('DUPLICATE_EVIDENCE')));
  assert.ok(r.blockers.includes('CLINICAL_SECURITY_HOSPITAL_REVIEW_NOT_INDEPENDENT'));
});
test('G8: enabled flags cannot pass offline readiness even with all evidence',()=>{
  const r=evaluateG3G8Offline(dossier({
    flags:{externalFhirImport:true,externalPatient360Promotion:false,
      externalClinicalAiDrafting:false}, externalG1Status:'PASS',externalG2Status:'PASS',
  }));
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.blockers.includes('FLAGS_NOT_DISABLED'));
});
test('G8: even complete signed evidence produces NO_GO, never local production authority',()=>{
  const r=evaluateG3G8Offline(dossier({externalG1Status:'PASS',externalG2Status:'PASS'}));
  assert.equal(r.status,'OFFLINE_REVIEW_CANDIDATE');
  assert.ok(r.gates.every(x=>x.status==='OFFLINE_EVIDENCE_COMPLETE'));
  assert.equal(r.productionDecision,'NO_GO');
  assert.match(r.evidenceFingerprint,/^[a-f0-9]{64}$/);
});
test('deterministic evidence fingerprint is independent of object key insertion order',()=>{
  const a=dossier(), b={...dossier()};
  assert.equal(offlineDossierFingerprint(a),offlineDossierFingerprint(b));
  assert.notEqual(offlineDossierFingerprint(a),offlineDossierFingerprint({...a,changeRequestId:randomUUID()}));
});
