/**
 * G2 synthetic-only recovery: one independently approved, new sealed manifest.
 * Does not run FHIR HTTP, claim work, authorize imports or checkpoint clinical
 * data. Every write is transactional and permanently auditable.
 */
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import {
  assertPollWorkManifest, openPollWorkManifest, sealedManifestPayloadEquals,
  sealPollWorkManifest, type ManifestCipher, type PollWorkManifest,
  type SealedPollManifest,
} from './external-fhir-poll-manifest-seal';
import type { FhirImportActor, FhirSourceRecord } from './external-fhir-import';
import { fhirPatientLinkId } from './external-fhir-import';
import {siteApprovalDocId,validateFhirSiteApproval,type FhirSiteApproval}
  from '@/lib/interop/fhir-site-approval';
import type { G2WorkRecord } from './external-fhir-g2-durable-work';

type Scope = Readonly<{
  db:Firestore; actor:FhirImportActor; cipher:ManifestCipher;
  oldManifest:PollWorkManifest; oldWorkId:string; reviewId:string;
  freshManifest:Omit<PollWorkManifest,'sourceRevision'>;
  expectedSourceRevision:string; expectedCredentialRevision:number;
  externalPatientId:string;
}>;
export type G2FreshManifestRecoveryResult = Readonly<{
  newManifestId:string; newWorkId:string; sourceRevision:string;
  credentialRevision:number; replay:boolean;
  clinicalAuthority:false; checkpointAuthorized:false;
  importAuthorized:false; productionRelease:'NO_GO';
}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9._-]{1,64}$/;
const REVISION=/^[1-9][0-9]{0,11}\.[0-9]{9}$/;
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex');
function deny(code:string):never{throw new Error('FHIR_G2_FRESH_RECOVERY_'+code);}
function revision(s:DocumentSnapshot):string{
  const t=s.updateTime;
  if(!s.exists||!t||!Number.isSafeInteger(t.seconds)||
     !Number.isSafeInteger(t.nanoseconds))deny('SERVER_SOURCE_REVISION_REQUIRED');
  return t.seconds+'.'+String(t.nanoseconds).padStart(9,'0');
}
function timeMs(s:DocumentSnapshot):number{
  const n=s.readTime?.toMillis();
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1)deny('SERVER_CLOCK_REQUIRED');
  return n;
}
function validateInput(x:Scope):void{
  if(process.env.NODE_ENV!=='test'||process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED!=='false'||
     process.env.GHIMS_INTEGRATION_FHIR_R4_STATE!=='DISABLED')deny('EMULATOR_ONLY');
  assertPollWorkManifest(x.oldManifest);
  assertPollWorkManifest({...x.freshManifest,sourceRevision:'1000000000.000000000'});
  const old=x.oldManifest,fresh=x.freshManifest;
  if(!UUID.test(x.reviewId)||!REVISION.test(x.expectedSourceRevision)||
     !Number.isSafeInteger(x.expectedCredentialRevision)||
     x.expectedCredentialRevision<1||!ID.test(x.externalPatientId)||
     x.externalPatientId==='.'||x.externalPatientId==='..'||
     old.tenantId!==fresh.tenantId||old.facilityId!==fresh.facilityId||
     old.sourceId!==fresh.sourceId||old.manifestId===fresh.manifestId||
     !old.items.some(v=>v.workId===x.oldWorkId)||
     fresh.items.length!==1||fresh.vendorCursor!==null||
     fresh.items[0].workId===x.oldWorkId||
     old.items.some(v=>v.workId===fresh.items[0].workId)||
     !old.items.some(v=>v.workId===x.oldWorkId &&
       v.resourceType===fresh.items[0].resourceType &&
       v.resourceId===fresh.items[0].resourceId)||
     !Number.isSafeInteger(fresh.startCheckpointSequence)||
     !x.actor||x.actor.tenantId!==old.tenantId||
     !Array.isArray(x.actor.facilityIds)||
     !x.actor.facilityIds.includes(old.facilityId)||
     !ID.test(x.actor.actorId)||
     !Array.isArray(x.actor.permissions)||
     !['FHIR_IMPORT','FHIR_POLL_COORDINATE','FHIR_POLL_RECOVERY']
       .every(p=>x.actor.permissions.includes(p)))deny('SCOPE_OR_MANIFEST_INVALID');
}
function reviewed(record:Record<string,unknown>|undefined,role:'SECURITY'|'CLINICAL',
  old:G2WorkRecord,reviewId:string,transitionSequence:number):string{
  if(!record||record.reviewId!==reviewId||record.role!==role||
     record.tenantId!==old.tenantId||record.facilityId!==old.facilityId||
     record.sourceId!==old.sourceId||record.manifestId!==old.manifestId||
     record.workId!==old.workId||record.sourceRevision!==old.sourceRevision||
     record.manifestRevision!==old.manifestRevision||
     record.transitionSequence!==transitionSequence||
     record.leaseEpoch!==old.leaseEpoch||
     !['PAUSED_AUTH','HELD_ABSENCE','QUARANTINED'].includes(String(record.heldStatus))||
     record.reason!=='REQUIRES_NEW_MANIFEST'||record.immutable!==true||
     record.clinicalAuthority!==false||record.eventType!=='FHIR_G2_HELD_REVIEW_RECORDED'||
     typeof record.reviewerId!=='string'||!ID.test(record.reviewerId))deny('REVIEW_PROOF_INVALID');
  return record.reviewerId;
}
function result(m:PollWorkManifest,revisionNumber:number,replay:boolean):G2FreshManifestRecoveryResult{
  return {newManifestId:m.manifestId,newWorkId:m.items[0].workId,
    sourceRevision:m.sourceRevision,credentialRevision:revisionNumber,replay,
    clinicalAuthority:false,checkpointAuthorized:false,importAuthorized:false,
    productionRelease:'NO_GO'};
}
export async function recoverSyntheticG2FreshManifest(
  args:Scope,
):Promise<G2FreshManifestRecoveryResult>{
  validateInput(args);
  const old=args.oldManifest,fresh=args.freshManifest;
  const root=args.db.collection('tenants').doc(old.tenantId);
  const oldStateId='fg2w_'+sha([old.tenantId,old.sourceId,old.manifestId,args.oldWorkId]);
  const recoveryId='fg2fr_'+sha([oldStateId,args.reviewId]);
  const newManifestRef=root.collection('fhirPollWorkManifests').doc(fresh.manifestId);
  const sourceRef=root.collection('fhirSources').doc(old.sourceId);
  const reviewId=(role:string)=>'fg2r_'+sha([oldStateId,args.reviewId,role]);
  return args.db.runTransaction(async tx=>{
    const [sourceSnap,oldManifestSnap,oldStateSnap,securitySnap,clinicalSnap,
      recoverySnap,newManifestSnap,sourceLeaseSnap]=await tx.getAll(
      sourceRef,
      root.collection('fhirPollWorkManifests').doc(old.manifestId),
      root.collection('fhirG2SyntheticWorkStates').doc(oldStateId),
      root.collection('fhirG2SyntheticWorkReviews').doc(reviewId('SECURITY')),
      root.collection('fhirG2SyntheticWorkReviews').doc(reviewId('CLINICAL')),
      root.collection('fhirG2SyntheticFreshRecoveries').doc(recoveryId),
      newManifestRef,
      root.collection('fhirSourcePollLeases').doc(old.sourceId),
    );
    // The supersession event ID depends on the persisted transition sequence.
    // It is read after state verification and BEFORE any write.
    const now=timeMs(sourceSnap);
    const source=sourceSnap.data() as FhirSourceRecord|undefined;
    if(!source||source.tenantId!==old.tenantId||
       source.facilityId!==old.facilityId||source.sourceId!==old.sourceId||
       source.status!=='ACTIVE'||source.securityReviewStatus!=='APPROVED'||
       source.syncMode!=='FENCED'||source.syntheticOnly!==true||
       !source.approvedResourceTypes?.includes(fresh.items[0].resourceType)||
       source.oauth?.mode!=='SMART_BACKEND'||
       source.oauth.credentialRevision!==args.expectedCredentialRevision||
       !Number.isSafeInteger(source.oauth.secretVersion)||
       source.oauth.secretVersion<1||
       revision(sourceSnap)!==args.expectedSourceRevision||
       revision(sourceSnap)===old.sourceRevision)deny('SOURCE_OR_CREDENTIAL_REVISION_INVALID');
    if(!oldManifestSnap.exists||revision(oldManifestSnap)!==
       (oldStateSnap.data() as G2WorkRecord|undefined)?.manifestRevision)deny('OLD_MANIFEST_REVISED');
    const opened=openPollWorkManifest(
      oldManifestSnap.data() as SealedPollManifest,args.cipher,old);
    if(!sealedManifestPayloadEquals(opened,old))deny('OLD_MANIFEST_CHANGED');
    const oldState=oldStateSnap.data() as G2WorkRecord|undefined;
    if(!oldState||oldState.status!=='REVIEWED_SUPERSEDED'||
       oldState.lastReviewId!==args.reviewId||
       oldState.tenantId!==old.tenantId||oldState.facilityId!==old.facilityId||
       oldState.sourceId!==old.sourceId||oldState.manifestId!==old.manifestId||
       oldState.workId!==args.oldWorkId||
       oldState.manifestRevision!==revision(oldManifestSnap)||
       oldState.sourceRevision!==old.sourceRevision||
       !Number.isSafeInteger(oldState.transitionSequence)||
       oldState.transitionSequence<2)deny('OLD_WORK_NOT_GOVERNED_SUPERSEDED');
    const reviewerA=reviewed(securitySnap.data(),'SECURITY',oldState,
      args.reviewId,oldState.transitionSequence-1);
    const reviewerB=reviewed(clinicalSnap.data(),'CLINICAL',oldState,
      args.reviewId,oldState.transitionSequence-1);
    if(reviewerA===reviewerB||reviewerA===args.actor.actorId||
       reviewerB===args.actor.actorId)deny('INDEPENDENT_REVIEWERS_REQUIRED');
    const supersedeId='fg2e_'+sha([oldStateId,oldState.transitionSequence]);
    const superseded=(await tx.get(root.collection('fhirG2SyntheticWorkEvents')
      .doc(supersedeId))).data();
    if(!superseded||superseded.transition!=='REVIEWED_SUPERSEDED'||
       superseded.eventId!==supersedeId||superseded.immutable!==true||
       superseded.governanceReviewId!==args.reviewId||
       superseded.workId!==args.oldWorkId||
       superseded.manifestId!==old.manifestId||
       superseded.transitionSequence!==oldState.transitionSequence||
       superseded.status!=='REVIEWED_SUPERSEDED')deny('SUPERSESSION_EVENT_INVALID');
    const approvalId=siteApprovalDocId(source);
    const linkId=fhirPatientLinkId(old.sourceId,args.externalPatientId);
    const [approvalSnap,linkSnap,superAudit,superOutbox,
      securityAudit,clinicalAudit,securityOutbox,clinicalOutbox]=await tx.getAll(
      root.collection('fhirSiteApprovals').doc(approvalId),
      root.collection('fhirPatientLinks').doc(linkId),
      root.collection('auditLogs').doc('fau_'+supersedeId),
      root.collection('fhirG2SyntheticWorkOutbox').doc('fg2o_'+supersedeId),
      root.collection('auditLogs').doc('fau_'+reviewId('SECURITY')),
      root.collection('auditLogs').doc('fau_'+reviewId('CLINICAL')),
      root.collection('fhirG2SyntheticWorkOutbox').doc('fg2o_'+reviewId('SECURITY')),
      root.collection('fhirG2SyntheticWorkOutbox').doc('fg2o_'+reviewId('CLINICAL')),
    );
    for(const [role,reviewer,audit,outbox] of [
      ['SECURITY',reviewerA,securityAudit.data(),securityOutbox.data()],
      ['CLINICAL',reviewerB,clinicalAudit.data(),clinicalOutbox.data()],
    ] as const){
      if(!audit||audit.action!=='FHIR_G2_HELD_REVIEW_RECORDED'||
         audit.actorId!==reviewer||audit.reviewId!==args.reviewId||
         audit.role!==role||audit.immutable!==true||
         audit.tenantId!==old.tenantId||audit.sourceId!==old.sourceId||
         audit.transitionSequence!==oldState.transitionSequence-1||
         !outbox||outbox.reviewId!==args.reviewId||
         outbox.role!==role||outbox.reviewerId!==reviewer||
         outbox.status!=='HELD'||outbox.immutable!==true||
         outbox.tenantId!==old.tenantId||outbox.sourceId!==old.sourceId||
         outbox.destination!=='CI_EXTERNAL_CONTEXT_QUALIFICATION')
         deny('REVIEW_AUDIT_INCOMPLETE');
    }
    validateFhirSiteApproval(source,(approvalSnap.data() as FhirSiteApproval|undefined)??null,
      fresh.items[0].resourceType,now);
    const a=superAudit.data(),o=superOutbox.data();
    if(!a||a.action!=='FHIR_G2_SYNTHETIC_WORK_REVIEWED_SUPERSEDED'||
       a.eventId!==supersedeId||a.immutable!==true||a.tenantId!==old.tenantId||
       !o||o.eventId!==supersedeId||o.status!=='HELD'||
       o.immutable!==true||o.tenantId!==old.tenantId||
       o.destination!=='CI_EXTERNAL_CONTEXT_QUALIFICATION')
      deny('SUPERSESSION_AUDIT_INCOMPLETE');
    const link=linkSnap.data();
    if(!link||link.tenantId!==old.tenantId||link.facilityId!==old.facilityId||
       link.sourceId!==old.sourceId||link.externalPatientId!==args.externalPatientId||
       link.matchStatus!=='VERIFIED'||link.consentStatus!=='GRANTED'||
       typeof link.patientId!=='string'||!ID.test(link.patientId))
      deny('PATIENT_LINK_OR_CONSENT_REVOKED');
    const patientSnap=await tx.get(root.collection('patients').doc(link.patientId));
    const patient=patientSnap.data();
    if(!patient||patient.tenantId!==old.tenantId||
       patient.status!=='ACTIVE'||patient.mergedIntoPatientId)
      deny('CANONICAL_PATIENT_INVALID');
    const checkpoint=sourceLeaseSnap.data();
    const lastSequence=checkpoint
      ? checkpoint.checkpointSequence : 0;
    if((checkpoint && (checkpoint.tenantId!==old.tenantId||
        checkpoint.sourceId!==old.sourceId||
        checkpoint.facilityId!==old.facilityId||
        !Number.isSafeInteger(lastSequence)||lastSequence<0||
        (checkpoint.status==='ACTIVE'&&checkpoint.expiresAtMs>now))) ||
       fresh.startCheckpointSequence!==lastSequence)
      deny('CHECKPOINT_SEQUENCE_OR_ACTIVE_LEASE');
    const next:PollWorkManifest={...fresh,sourceRevision:revision(sourceSnap)};
    if(recoverySnap.exists){
      const existing=recoverySnap.data();
      if(!newManifestSnap.exists||
         existing?.newManifestId!==fresh.manifestId||
         existing?.newWorkId!==fresh.items[0].workId||
         existing?.sourceRevision!==next.sourceRevision||
         existing?.credentialRevision!==args.expectedCredentialRevision||
         existing?.oldManifestId!==old.manifestId||
         existing?.oldWorkId!==args.oldWorkId||
         existing?.reviewId!==args.reviewId||
         existing?.externalPatientLinkId!==linkId)
         deny('RECOVERY_REPLAY_CONFLICT');
      const decoded=openPollWorkManifest(
        newManifestSnap.data() as SealedPollManifest,args.cipher,next);
      if(!sealedManifestPayloadEquals(decoded,next))deny('RECOVERY_REPLAY_CONFLICT');
      return result(next,args.expectedCredentialRevision,true);
    }
    if(newManifestSnap.exists)deny('NEW_MANIFEST_ALREADY_EXISTS');
    const sealed=sealPollWorkManifest(next,args.cipher);
    const eventId='fpme_'+next.manifestId;
    const metadata={
      tenantId:next.tenantId,facilityId:next.facilityId,sourceId:next.sourceId,
      manifestId:next.manifestId,sourceRevision:next.sourceRevision,
      credentialRevision:args.expectedCredentialRevision,
      reviewId:args.reviewId,oldManifestId:old.manifestId,
      oldWorkId:args.oldWorkId,newWorkId:next.items[0].workId,
      externalPatientLinkId:linkId,
      recordedAtMs:now,clinicalAuthority:false,immutable:true,
    };
    tx.create(newManifestRef,{...sealed,createdAtMs:now,createdBy:args.actor.actorId});
    tx.create(root.collection('fhirPollManifestEvents').doc(eventId),{
      ...metadata,eventId,eventType:'FHIR_POLL_MANIFEST_SEALED',
    });
    tx.create(root.collection('auditLogs').doc('fpa_'+eventId),{
      ...metadata,eventId,actorId:args.actor.actorId,action:'FHIR_POLL_MANIFEST_SEALED',
    });
    tx.create(root.collection('fhirPollManifestOutbox').doc('fpmo_'+eventId),{
      ...metadata,eventId,status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    tx.create(root.collection('fhirG2SyntheticFreshRecoveries').doc(recoveryId),{
      ...metadata,recoveryId,eventType:'FHIR_G2_FRESH_MANIFEST_RECOVERY_APPROVED',
    });
    tx.create(root.collection('fhirG2SyntheticRecoveryEvents').doc('fg2re_'+recoveryId),{
      ...metadata,recoveryId,eventType:'FHIR_G2_FRESH_MANIFEST_RECOVERY_CREATED',
    });
    tx.create(root.collection('auditLogs').doc('fau_'+recoveryId),{
      ...metadata,recoveryId,actorId:args.actor.actorId,
      action:'FHIR_G2_FRESH_MANIFEST_RECOVERY_CREATED',
    });
    tx.create(root.collection('fhirG2SyntheticWorkOutbox').doc('fg2o_'+recoveryId),{
      ...metadata,recoveryId,status:'HELD',
      destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    return result(next,args.expectedCredentialRevision,false);
  });
}
