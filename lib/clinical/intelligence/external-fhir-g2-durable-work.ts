/**
 * G2 synthetic durable work lifecycle (Firestore emulator ONLY).
 *
 * This module is deliberately not a hosted poll runner. It does not issue HTTP
 * requests or authorize resource import/checkpoint/clinical promotion.
 * Work state is a derived index; every mutation atomically appends an immutable
 * work event, audit, and HELD qualification outbox item.
 */
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot, Transaction, DocumentReference } from 'firebase-admin/firestore';
import {
  assertPollWorkManifest, openPollWorkManifest, sealedManifestPayloadEquals,
  type ManifestCipher, type PollWorkManifest, type SealedPollManifest,
} from './external-fhir-poll-manifest-seal';
import type { FhirImportActor } from './external-fhir-import';
import {
  classifyG2OfflinePollResponse, type G2OfflinePollResponse,
} from './external-fhir-g2-offline-outcome';

type G2WorkStatus =
  | 'QUEUED' | 'LEASED' | 'RETRY_WAIT' | 'EVIDENCE_PENDING'
  | 'PAUSED_AUTH' | 'HELD_ABSENCE' | 'QUARANTINED';
type SourceRecord = {
  tenantId?: string; facilityId?: string; sourceId?: string;
  status?: string; securityReviewStatus?: string; syncMode?: string;
  syntheticOnly?: boolean; approvedResourceTypes?: string[];
};
export type G2WorkRecord = Readonly<{
  tenantId: string; facilityId: string; sourceId: string;
  manifestId: string; workId: string; sourceRevision: string; manifestRevision: string;
  status: G2WorkStatus; transitionSequence: number; leaseEpoch: number;
  workerId: string | null; claimId: string | null;
  leaseExpiresAtMs: number; attempts: number; retryNotBeforeMs: number;
  lastOutcomeDigest: string | null; updatedAtMs: number;
}>;
export type G2WorkClaim = Readonly<{
  tenantId: string; sourceId: string; manifestId: string; workId: string;
  workerId: string; claimId: string; leaseEpoch: number; attempts: number;
}>;
export type G2WorkTransition = Readonly<{
  state: G2WorkRecord;
  replay: boolean;
  clinicalAuthority: false;
  checkpointAuthorized: false;
  productionRelease: 'NO_GO';
}>;
type Scope = {
  db: Firestore; actor: FhirImportActor;
  manifest: PollWorkManifest; cipher: ManifestCipher; workId: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;
function sha(x: unknown): string {return createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function fail(code: string): never {throw new Error('FHIR_G2_DURABLE_' + code);}
function guard(): void {
  if (process.env.NODE_ENV !== 'test' ||
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') fail('EMULATOR_ONLY');
}
function revision(s: DocumentSnapshot): string {
  const t=s.updateTime;
  if (!s.exists || !t || !Number.isSafeInteger(t.seconds) ||
      !Number.isSafeInteger(t.nanoseconds)) fail('SERVER_REVISION_REQUIRED');
  return t.seconds + '.' + String(t.nanoseconds).padStart(9,'0');
}
function nowMs(s: DocumentSnapshot): number {
  const t=s.readTime?.toMillis();
  if (!Number.isSafeInteger(t) || !t || t < 1) fail('SERVER_TIME_REQUIRED');
  return t;
}
function identity(args: Scope): void {
  guard();
  assertPollWorkManifest(args.manifest);
  const m=args.manifest;
  if (!m.items.some(item=>item.workId===args.workId) ||
      !args.actor || args.actor.tenantId!==m.tenantId || !args.actor.actorId ||
      !args.actor.facilityIds.includes(m.facilityId) ||
      !args.actor.permissions.includes('FHIR_IMPORT') ||
      !args.actor.permissions.includes('FHIR_POLL_COORDINATE')) fail('SCOPE_DENIED');
}
function refs(args: Scope) {
  const m=args.manifest;
  const root=args.db.collection('tenants').doc(m.tenantId);
  const id='fg2w_'+sha([m.tenantId,m.sourceId,m.manifestId,args.workId]);
  return {
    root,id,
    source:root.collection('fhirSources').doc(m.sourceId),
    manifest:root.collection('fhirPollWorkManifests').doc(m.manifestId),
    state:root.collection('fhirG2SyntheticWorkStates').doc(id),
  };
}
async function verifiedSnapshot(tx: Transaction, args: Scope, r: ReturnType<typeof refs>) {
  const [sourceSnap,manifestSnap,stateSnap] = await tx.getAll(r.source,r.manifest,r.state);
  const m=args.manifest;
  const src=sourceSnap.exists ? sourceSnap.data() as SourceRecord : null;
  const item=m.items.find(item=>item.workId===args.workId);
  if (!src || src.tenantId!==m.tenantId || src.sourceId!==m.sourceId ||
      src.facilityId!==m.facilityId || src.status!=='ACTIVE' ||
      src.securityReviewStatus!=='APPROVED' || src.syncMode!=='FENCED' ||
      src.syntheticOnly!==true || !item ||
      !src.approvedResourceTypes?.includes(item.resourceType) ||
      revision(sourceSnap)!==m.sourceRevision) fail('SOURCE_REVOKED_OR_REVISED');
  if (!manifestSnap.exists) fail('SEALED_MANIFEST_REQUIRED');
  const stored=openPollWorkManifest(
    manifestSnap.data() as SealedPollManifest,args.cipher,m,
  );
  if (!sealedManifestPayloadEquals(m,stored)) fail('SEALED_MANIFEST_CHANGED');
  return {stateSnap,now:nowMs(sourceSnap),manifestRevision:revision(manifestSnap)};
}
function validateState(value: unknown, args: Scope, manifestRevision: string): G2WorkRecord {
  if (!value || typeof value!=='object' || Array.isArray(value)) fail('STATE_CORRUPT');
  const s=value as G2WorkRecord,m=args.manifest;
  if (s.tenantId!==m.tenantId || s.facilityId!==m.facilityId ||
      s.sourceId!==m.sourceId || s.manifestId!==m.manifestId ||
      s.workId!==args.workId || s.sourceRevision!==m.sourceRevision ||
      s.manifestRevision!==manifestRevision ||
      !['QUEUED','LEASED','RETRY_WAIT','EVIDENCE_PENDING',
        'PAUSED_AUTH','HELD_ABSENCE','QUARANTINED'].includes(s.status) ||
      !Number.isSafeInteger(s.transitionSequence) || s.transitionSequence < 1 ||
      !Number.isSafeInteger(s.leaseEpoch) || s.leaseEpoch < 0 ||
      !Number.isSafeInteger(s.attempts) || s.attempts < 0 || s.attempts > MAX_ATTEMPTS ||
      !Number.isSafeInteger(s.leaseExpiresAtMs) ||
      !Number.isSafeInteger(s.retryNotBeforeMs) ||
      !Number.isSafeInteger(s.updatedAtMs)) fail('STATE_CORRUPT');
  return s;
}
function emit(tx: Transaction, r: ReturnType<typeof refs>, actor: FhirImportActor,
  state: G2WorkRecord, transition: string, now: number): void {
  const eventId='fg2e_'+sha([r.id,state.transitionSequence]);
  const common={
    tenantId:state.tenantId,sourceId:state.sourceId,facilityId:state.facilityId,
    manifestId:state.manifestId,workId:state.workId,
    sourceRevision:state.sourceRevision,manifestRevision:state.manifestRevision,
    transitionSequence:state.transitionSequence,leaseEpoch:state.leaseEpoch,
    status:state.status,transition,recordedAtMs:now,eventId,
    immutable:true,clinicalAuthority:false,
  };
  tx.create(r.root.collection('fhirG2SyntheticWorkEvents').doc(eventId),{
    ...common,eventType:'FHIR_G2_SYNTHETIC_WORK_'+transition,
  });
  tx.create(r.root.collection('auditLogs').doc('fau_'+eventId),{
    ...common,actorId:actor.actorId,action:'FHIR_G2_SYNTHETIC_WORK_'+transition,
  });
  tx.create(r.root.collection('fhirG2SyntheticWorkOutbox').doc('fg2o_'+eventId),{
    ...common,status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION',
  });
}
function response(state:G2WorkRecord,replay=false):G2WorkTransition {
  return {state,replay,clinicalAuthority:false,checkpointAuthorized:false,productionRelease:'NO_GO'};
}
function validClaim(f:G2WorkClaim,args:Scope):void {
  const m=args.manifest;
  if (!f || f.tenantId!==m.tenantId || f.sourceId!==m.sourceId ||
      f.manifestId!==m.manifestId || f.workId!==args.workId ||
      !UUID.test(f.workerId) || !UUID.test(f.claimId) ||
      !Number.isSafeInteger(f.leaseEpoch) || f.leaseEpoch<1 ||
      !Number.isSafeInteger(f.attempts) || f.attempts<1) fail('CLAIM_INVALID');
}

/** Enqueue a work ID authenticated against the SEALED manifest in one transaction. */
export async function enqueueSyntheticG2Work(args:Scope):Promise<G2WorkTransition> {
  identity(args);
  const r=refs(args);
  return args.db.runTransaction(async tx=>{
    const {stateSnap,now,manifestRevision}=await verifiedSnapshot(tx,args,r);
    if(stateSnap.exists){
      const s=validateState(stateSnap.data(),args,manifestRevision);
      return response(s,true);
    }
    const m=args.manifest;
    const state:G2WorkRecord={
      tenantId:m.tenantId,sourceId:m.sourceId,facilityId:m.facilityId,
      manifestId:m.manifestId,workId:args.workId,sourceRevision:m.sourceRevision,
      manifestRevision,status:'QUEUED',transitionSequence:1,leaseEpoch:0,
      workerId:null,claimId:null,leaseExpiresAtMs:0,attempts:0,
      retryNotBeforeMs:0,lastOutcomeDigest:null,updatedAtMs:now,
    };
    tx.create(r.state,state);
    emit(tx,r,args.actor,state,'ENQUEUED',now);
    return response(state);
  });
}

/**
 * Acquire only a queued/retry-ready work item. Expired ownership can be
 * superseded by a NEW claim; same worker+claim cannot resurrect expiry.
 */
export async function claimSyntheticG2Work(args:Scope & {
  workerId:string;claimId:string;ttlMs:number;
}):Promise<G2WorkTransition> {
  identity(args);
  if (!UUID.test(args.workerId) || !UUID.test(args.claimId) ||
      !Number.isSafeInteger(args.ttlMs) ||
      args.ttlMs < 5_000 || args.ttlMs > 300_000) fail('CLAIM_INVALID');
  const r=refs(args);
  return args.db.runTransaction(async tx=>{
    const {stateSnap,now,manifestRevision}=await verifiedSnapshot(tx,args,r);
    if(!stateSnap.exists) fail('WORK_NOT_ENQUEUED');
    const old=validateState(stateSnap.data(),args,manifestRevision);
    if(old.status==='LEASED' && old.leaseExpiresAtMs>now){
      if(old.workerId===args.workerId && old.claimId===args.claimId)
        return response(old,true);
      fail('WORK_ALREADY_LEASED');
    }
    if(old.status==='LEASED' && old.workerId===args.workerId &&
       old.claimId===args.claimId) fail('EXPIRED_CLAIM_REPLAY');
    if(old.status==='RETRY_WAIT' && old.retryNotBeforeMs>now) fail('RETRY_NOT_DUE');
    if(!['QUEUED','RETRY_WAIT','LEASED'].includes(old.status)) fail('WORK_HELD_FOR_REVIEW');
    if(old.attempts>=MAX_ATTEMPTS) fail('ATTEMPT_LIMIT_REACHED');
    const next:G2WorkRecord={
      ...old,status:'LEASED',transitionSequence:old.transitionSequence+1,
      leaseEpoch:old.leaseEpoch+1,workerId:args.workerId,claimId:args.claimId,
      leaseExpiresAtMs:now+args.ttlMs,attempts:old.attempts+1,
      retryNotBeforeMs:0,updatedAtMs:now,
    };
    if(!Number.isSafeInteger(next.leaseEpoch)||!Number.isSafeInteger(next.transitionSequence))
      fail('SEQUENCE_OVERFLOW');
    tx.update(r.state,next);
    emit(tx,r,args.actor,next,'CLAIMED',now);
    return response(next);
  });
}

/**
 * Persist classification after a synthetic response. This action never
 * checkpoints or completes work, even for HTTP 200. Retried attempts require
 * an independently acquired new claim with increased leaseEpoch.
 */
export async function settleSyntheticG2Work(args:Scope & {
  claim:G2WorkClaim;httpStatus:number;retryAfterSeconds?:number|null;
}):Promise<G2WorkTransition> {
  identity(args);
  validClaim(args.claim,args);
  const r=refs(args);
  return args.db.runTransaction(async tx=>{
    const {stateSnap,now,manifestRevision}=await verifiedSnapshot(tx,args,r);
    if(!stateSnap.exists) fail('WORK_NOT_ENQUEUED');
    const old=validateState(stateSnap.data(),args,manifestRevision);
    const claimed=old.leaseEpoch===args.claim.leaseEpoch &&
      old.workerId===args.claim.workerId && old.claimId===args.claim.claimId &&
      old.attempts===args.claim.attempts;
    if(!claimed) fail('STALE_WORK_CLAIM');
    const input:G2OfflinePollResponse={
      tenantId:old.tenantId,sourceId:old.sourceId,workId:old.workId,
      attempt:old.attempts,httpStatus:args.httpStatus,
      retryAfterSeconds:args.retryAfterSeconds,
    };
    const decision=classifyG2OfflinePollResponse(input);
    const digest=sha([input.httpStatus,input.retryAfterSeconds??null,decision.action]);
    if(old.status!=='LEASED'){
      if(old.lastOutcomeDigest===digest)return response(old,true);
      fail('OUTCOME_REPLAY_CONFLICT');
    }
    if(old.leaseExpiresAtMs<=now) fail('STALE_WORK_CLAIM');
    const map:Record<string,G2WorkStatus>={
      VERIFY_IMMUTABLE_RECEIPT:'EVIDENCE_PENDING',
      PAUSE_SOURCE_FOR_AUTH_REVIEW:'PAUSED_AUTH',
      HOLD_ABSENCE_FOR_RECONCILIATION:'HELD_ABSENCE',
      REJECT_UNEXPECTED_REDIRECT:'QUARANTINED',
      RETRY_BOUNDED:'RETRY_WAIT',
      HOLD_RATE_LIMIT_FOR_REVIEW:'QUARANTINED',
      QUARANTINE_FOR_REVIEW:'QUARANTINED',
    };
    const next:G2WorkRecord={
      ...old,status:map[decision.action],transitionSequence:old.transitionSequence+1,
      leaseExpiresAtMs:0,
      retryNotBeforeMs:decision.retryDelayMs===null?0:now+decision.retryDelayMs,
      lastOutcomeDigest:digest,updatedAtMs:now,
    };
    if(!Number.isSafeInteger(next.transitionSequence) ||
       !Number.isSafeInteger(next.retryNotBeforeMs))fail('SEQUENCE_OVERFLOW');
    tx.update(r.state,next);
    emit(tx,r,args.actor,next,'OUTCOME_'+decision.action,now);
    return response(next);
  });
}
