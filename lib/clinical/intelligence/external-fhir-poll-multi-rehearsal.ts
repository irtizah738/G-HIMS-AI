/**
 * Stage F: read-only bounded multi-page recovery transaction and append-only
 * rehearsal evidence. No source/lease/head/manifest or clinical mutations.
 * LIVE/hosted operation is impossible by construction.
 */
import { createHash } from 'node:crypto';
import type { Firestore, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { openPollWorkManifest, type ManifestCipher, type SealedPollManifest } from './external-fhir-poll-manifest-seal';
import {
  assertStageFEmulatorOnly, assertStageFMultiRecoveryEvidence,
  stageFAnchorFingerprint, type EmulatorOnlyStageFRecoverySigner,
  type StageFMultiAnchor, type StageFReview, type StageFStepEvidence,
} from './external-fhir-poll-multi-recovery';
import { fhirImportHeadId, fhirPatientLinkId, type FhirImportActor } from './external-fhir-import';
import { assertStageGCursorContinuity, stageGCertificateFingerprint,
  type StageGCursorAttestation,
} from './external-fhir-poll-vendor-cursor';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function sha(v: unknown): string { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function revision(s:DocumentSnapshot):string {
  const at=s.updateTime;
  if (!s.exists || !at || !Number.isSafeInteger(at.seconds) ||
      !Number.isSafeInteger(at.nanoseconds)) throw new Error('FHIR_POLL_F_DOCUMENT_REVISION_MISSING');
  return `${at.seconds}.${String(at.nanoseconds).padStart(9,'0')}`;
}
function record(s:DocumentSnapshot):Record<string,unknown>|null {
  return s.exists ? (s.data() as Record<string,unknown>) : null;
}
export async function rehearseSyntheticMultiPageRecovery(args: {
  db:Firestore;
  actor:FhirImportActor;
  cipher:ManifestCipher;
  anchor:StageFMultiAnchor;
  signer:EmulatorOnlyStageFRecoverySigner;
  reviews:readonly StageFReview[];
  rehearsalId:string;
  /** Optional Stage G detached cursor attestation (LOCAL TEST-ONLY). */
  stageG?:StageGCursorAttestation;
  /** Synthetic pre-commit abort: must leave no rehearsal, event, audit, outbox. */
  afterValidationBeforeCommit?:()=>Promise<void>;
}):Promise<{status:'REHEARSAL_ONLY';fingerprint:string;replay:boolean}> {
  assertStageFEmulatorOnly();
  const a=args.anchor;
  args.signer.verify(a);
  const actor=args.actor;
  if (!actor || !ID.test(actor.tenantId) || !ID.test(actor.actorId) ||
      actor.tenantId!==a.tenantId || !actor.facilityIds.includes(a.facilityId) ||
      !['FHIR_IMPORT','FHIR_POLL_COORDINATE','FHIR_MIGRATION_REHEARSE']
        .every(p=>actor.permissions.includes(p)) ||
      !UUID.test(args.rehearsalId) ||
      !Array.isArray(args.reviews) ||
      args.reviews.some(r=>r.reviewerId===actor.actorId)) {
    throw new Error('FHIR_POLL_F_ACTOR_OR_SCOPE_DENIED');
  }
  const reviewers=[...args.reviews].sort((x,y)=>x.role.localeCompare(y.role));
  const anchorFingerprint=stageFAnchorFingerprint(a);
  const cursorWitnessFingerprint=args.stageG?
    stageGCertificateFingerprint(args.stageG.certificate):null;
  const fingerprint=sha(args.stageG?
    ['STAGE_F_SYNTHETIC_MULTI_REHEARSAL_WITH_STAGE_G_V1',
      a.tenantId,a.sourceId,anchorFingerprint,args.rehearsalId,actor.actorId,
      reviewers,cursorWitnessFingerprint]:
    ['STAGE_F_SYNTHETIC_MULTI_REHEARSAL_V1',
      a.tenantId,a.sourceId,anchorFingerprint,args.rehearsalId,actor.actorId,reviewers]);
  const root=args.db.collection('tenants').doc(a.tenantId);
  const sourceRef=root.collection('fhirSources').doc(a.sourceId);
  const leaseRef=root.collection('fhirSourcePollLeases').doc(a.sourceId);
  const pageRefs=a.pages.map(p=>root.collection('fhirPollWorkManifests').doc(p.manifestId));
  const pageEvidenceRefs=a.pages.flatMap(p=>{
    const id='fpme_'+p.manifestId;
    return [root.collection('fhirPollManifestEvents').doc(id),
      root.collection('auditLogs').doc('fpa_'+id),
      root.collection('fhirPollManifestOutbox').doc('fpmo_'+id)];
  });
  const stepRefs=a.steps.map(step=>{
    const suffix=step.receiptId.slice(4);
    // Resource head is derived only after authenticated ciphertext decryption.
    return {
      reservation:root.collection('fhirSourcePollEvents').doc(step.reservationEventId),
      checkpoint:root.collection('fhirSourcePollEvents').doc(step.checkpointEventId),
      cpAudit:root.collection('auditLogs').doc('fau_'+step.checkpointEventId),
      cpOutbox:root.collection('fhirSourcePollOutbox').doc('fso_'+step.checkpointEventId),
      receipt:root.collection('fhirImportedVersions').doc(step.receiptId),
      importEvent:root.collection('fhirImportEvents').doc('fev_'+suffix),
      importAudit:root.collection('auditLogs').doc('fau_'+suffix),
      importOutbox:root.collection('fhirImportOutbox').doc('fob_'+suffix),
    };
  });
  const abandonedRefs=a.abandonedReservations.map(r=>root.collection('fhirSourcePollEvents').doc(r.reservationEventId));
  const rehearsalRef=root.collection('fhirPollMultiRecoveryRehearsals').doc(args.rehearsalId);
  const eventId='fmre_'+sha([a.tenantId,a.sourceId,args.rehearsalId]);
  const eventRef=root.collection('fhirPollMultiRecoveryEvents').doc(eventId);
  const auditRef=root.collection('auditLogs').doc('fau_'+eventId);
  const outboxRef=root.collection('fhirPollMultiRecoveryOutbox').doc('fmro_'+eventId);
  return args.db.runTransaction(async tx=>{
    // Every read occurs within ONE transaction before a single write.
    const refs:DocumentReference[]=[sourceRef,leaseRef,...pageRefs,...pageEvidenceRefs,
      ...stepRefs.flatMap(r=>[r.reservation,r.checkpoint,r.cpAudit,r.cpOutbox,
        r.receipt,r.importEvent,r.importAudit,r.importOutbox]),
      ...abandonedRefs,rehearsalRef,eventRef,auditRef,outboxRef];
    const snapshots=await tx.getAll(...refs);
    let k=0;
    const source=snapshots[k++],lease=snapshots[k++];
    const sealedSnaps=snapshots.slice(k,k+=pageRefs.length);
    const pageEvidenceSnaps=snapshots.slice(k,k+=pageEvidenceRefs.length);
    const stepBase=snapshots.slice(k,k+=stepRefs.length*8);
    const abandonedSnaps=snapshots.slice(k,k+=abandonedRefs.length);
    const existing=snapshots.slice(k,k+=4);
    if (!source.exists || !lease.exists || sealedSnaps.some(s=>!s.exists)) {
      throw new Error('FHIR_POLL_F_SOURCE_LEASE_OR_PAGE_MISSING');
    }
    const pages=sealedSnaps.map((snapshot,index)=>({
      manifest:openPollWorkManifest(snapshot.data() as SealedPollManifest,args.cipher,{
        tenantId:a.tenantId,sourceId:a.sourceId,facilityId:a.facilityId,
        manifestId:a.pages[index].manifestId,sourceRevision:a.sourceRevision,
      }),
      manifestRevision:revision(snapshot),sealed:record(snapshot),
      manifestEvent:record(pageEvidenceSnaps[index*3]),
      manifestAudit:record(pageEvidenceSnaps[index*3+1]),
      manifestOutbox:record(pageEvidenceSnaps[index*3+2]),
    }));
    const headRefs:DocumentReference[]=[];
    const availRefs:DocumentReference[]=[];
    const linkRefs:DocumentReference[]=[];
    const patientRefs:DocumentReference[]=[];
    // Derive reference ids from the imported immutable evidence and decrypted
    // work items, NEVER from raw user input.
    for(let i=0;i<a.steps.length;i++) {
      const step=a.steps[i];
      const page=pages.find(p=>p.manifest.manifestId===step.manifestId);
      const item=page?.manifest.items[step.index];
      if (!item) throw new Error('FHIR_POLL_F_STEP_PAGE_ITEM_MISSING');
      const headId=fhirImportHeadId(a.sourceId,item.resourceType,item.resourceId);
      const receiptSnap=stepBase[i*8+4];
      const provenance=receiptSnap.get('provenance') as {mappedByVerifiedLink?:unknown}|undefined;
      const linkId=provenance?.mappedByVerifiedLink;
      const patientId=receiptSnap.get('patientId');
      if (typeof linkId!=='string' || !/^fpl_[a-f0-9]{64}$/.test(linkId) ||
          typeof patientId!=='string' || !ID.test(patientId)) {
        throw new Error('FHIR_POLL_F_LINK_OR_PATIENT_ID_MISSING');
      }
      headRefs.push(root.collection('fhirResourceHeads').doc(headId));
      availRefs.push(root.collection('fhirAvailabilityStates').doc(headId));
      linkRefs.push(root.collection('fhirPatientLinks').doc(linkId));
      patientRefs.push(root.collection('patients').doc(patientId));
    }
    // Multiple items may map to the same patient/link. Deduplicate BatchGet
    // references so returned snapshots are unambiguous across SDK/emulator
    // implementations that coalesce identical document paths.
    const relatedRefs=[...new Map(
      [...headRefs,...availRefs,...linkRefs,...patientRefs]
        .map(ref=>[ref.path,ref] as const),
    ).values()];
    const related=await tx.getAll(...relatedRefs);
    const byPath=new Map(relatedRefs.map((ref,i)=>[ref.path,related[i]] as const));
    const take=(ref:DocumentReference):DocumentSnapshot=>{
      const snap=byPath.get(ref.path);
      if(!snap) throw new Error('FHIR_POLL_F_RELATED_SNAPSHOT_MISSING');
      return snap;
    };
    const steps:StageFStepEvidence[]=a.steps.map((step,i)=>{
      const off=i*8;
      const linkSnap=take(linkRefs[i]);
      const rawLink=record(linkSnap);
      if (rawLink && typeof rawLink.externalPatientId==='string' &&
          fhirPatientLinkId(a.sourceId,rawLink.externalPatientId)!==linkSnap.id) {
        throw new Error('FHIR_POLL_F_LINK_DERIVATION_INVALID');
      }
      return {
        reservation:record(stepBase[off]),checkpoint:record(stepBase[off+1]),
        checkpointAudit:record(stepBase[off+2]),checkpointOutbox:record(stepBase[off+3]),
        receipt:record(stepBase[off+4]),importEvent:record(stepBase[off+5]),
        importAudit:record(stepBase[off+6]),importOutbox:record(stepBase[off+7]),
        head:record(take(headRefs[i])),availability:record(take(availRefs[i])),
        link:rawLink?{...rawLink,_documentId:linkSnap.id}:null,
        patient:record(take(patientRefs[i])),
      };
    });
    const verifiedEvidence={
      anchor:a,sourceRevision:revision(source),source:record(source),lease:record(lease),
      pages,steps,abandonedReservations:abandonedSnaps.map(record),reviews:reviewers,
    };
    assertStageFMultiRecoveryEvidence(verifiedEvidence);
    // The detached witness is read only AFTER every Stage F clinical receipt,
    // consent, lease and immutable audit has been reverified in THIS same
    // Firestore transaction, but BEFORE any evidence write.  It is not a
    // distributed commit with the separate file: this remains synthetic.
    if(args.stageG) {
      const head=await args.stageG.detachedWitness.readHead();
      assertStageGCursorContinuity({evidence:verifiedEvidence,
        certificate:args.stageG.certificate,
        verifier:args.stageG.verifier,cursorTags:args.stageG.cursorTags,
        responseNextCursors:args.stageG.responseNextCursors,
        trustedHead:head,trustedStageFAnchorFingerprint:anchorFingerprint,
        nowMs:Date.now()});
    }
    await args.afterValidationBeforeCommit?.();
    const [old,oldEvent,oldAudit,oldOutbox]=existing;
    if (existing.some(s=>s.exists)) {
      if (existing.some(s=>!s.exists) ||
          old.get('fingerprint')!==fingerprint ||
          oldEvent.get('fingerprint')!==fingerprint ||
          oldAudit.get('fingerprint')!==fingerprint ||
          oldOutbox.get('fingerprint')!==fingerprint ||
          oldOutbox.get('status')!=='HELD') {
        throw new Error('FHIR_POLL_F_REPLAY_CONFLICT');
      }
      return {status:'REHEARSAL_ONLY' as const,fingerprint,replay:true};
    }
    const common={schemaVersion:1,tenantId:a.tenantId,sourceId:a.sourceId,
      facilityId:a.facilityId,rehearsalId:args.rehearsalId,
      anchorFingerprint,fingerprint,pageCount:a.pages.length,workCount:a.steps.length,
      startCheckpointSequence:a.startCheckpointSequence,
      endCheckpointSequence:a.endCheckpointSequence,
      issuedSequence:a.issuedSequence,clinicalAuthority:false,
      immutable:true,dryRunOnly:true,productionAuthorization:'NO_GO',
      ...(cursorWitnessFingerprint?{
        vendorCursorWitnessFingerprint:cursorWitnessFingerprint,
        vendorCursorQualification:'LOCAL_SYNTHETIC_WITNESS_ONLY',
        vendorCursorWitnessSequence:args.stageG!.certificate.sequence,
      }:{}),
    };
    tx.create(rehearsalRef,{...common,status:'RECORDED_REHEARSAL_ONLY',
      reviewerIds:reviewers.map(r=>r.reviewerId)});
    tx.create(eventRef,{...common,eventId,eventType:'FHIR_SYNTHETIC_MULTI_PAGE_RECOVERY_REHEARSED'});
    tx.create(auditRef,{...common,eventId,actorId:actor.actorId,
      action:'FHIR_SYNTHETIC_MULTI_PAGE_RECOVERY_REHEARSED'});
    tx.create(outboxRef,{...common,eventId,status:'HELD',
      destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'});
    return {status:'REHEARSAL_ONLY' as const,fingerprint,replay:false};
  });
}
