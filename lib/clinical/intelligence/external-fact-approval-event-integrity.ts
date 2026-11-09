/** Recomputable CI-EXT-17 event/head integrity (hash chain, not a KMS signature). */
import {createHash} from 'node:crypto';
import type {ApprovalEventPayload} from './external-fact-approval-events';
type Row=Record<string,unknown>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
function validId(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function realTimestamp(n:unknown):n is number{
  return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
}
function canonical(value:unknown):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const row=value as Row;
  return '{'+Object.keys(row).sort().map(k=>JSON.stringify(k)+':'+canonical(row[k])).join(',')+'}';
}
function digest(value:unknown):string{
  return createHash('sha256').update(canonical(value),'utf8').digest('hex');
}
export function approvalEventHash(payload:ApprovalEventPayload):string{
  return digest(['HELIXIS_EXTERNAL_FACT_APPROVAL_EVENT_V1',payload]);
}
export function verifyApprovalEventHead(
  head:Row,event:Row,eventId:string,
):boolean{
  if(!validId(eventId)||event.eventId!==eventId||
    event.immutable!==true||event.clinicalUseAuthorized!==false||
    event.aiDraftingEligible!==false||!event.payload||
    typeof event.payload!=='object'||Array.isArray(event.payload)||
    typeof event.eventHash!=='string'||!HEX.test(event.eventHash))
    return false;
  const payload=event.payload as ApprovalEventPayload;
  if(event.eventHash!==approvalEventHash(payload)||
    head.approvalEventId!==eventId||head.eventHash!==event.eventHash||
    head.schemaVersion!==payload.schemaVersion||
    head.tenantId!==payload.tenantId||head.patientId!==payload.patientId||
    head.reviewId!==payload.reviewId||head.headId!==payload.headId||
    head.evidenceReceiptId!==payload.evidenceReceiptId||
    head.sourceVersionId!==payload.sourceVersionId||
    head.resourceHash!==payload.resourceHash||head.sourceId!==payload.sourceId||
    head.facilityId!==payload.facilityId||
    head.factualDigest!==payload.factualDigest||
    head.authorityFenceHash!==payload.authorityFenceHash||
    head.status!==payload.status||head.revision!==payload.revision||
    head.approvedByActorId!==payload.approvedByActorId||
    head.reviewerActorId!==payload.reviewerActorId||
    head.reviewerCredentialRevision!==payload.reviewerCredentialRevision||
    head.approverCredentialRevision!==payload.approverCredentialRevision||
    head.siteAuthorityRevision!==payload.siteAuthorityRevision||
    head.validFrom!==payload.validFrom||head.validUntil!==payload.validUntil||
    head.revokedAt!==payload.revokedAt||
    head.previousEventId!==payload.previousEventId||
    head.previousEventHash!==payload.previousEventHash||
    head.clinicalUseAuthorized!==false||head.aiDraftingEligible!==false||
    head.evidenceOnly!==true||head.immutableSourceEvent!==true)
    return false;
  if(payload.eventType==='EXTERNAL_FACT_APPROVAL_ISSUED')
    return payload.status==='APPROVED'&&payload.revision===1&&
      payload.previousEventId===null&&payload.previousEventHash===null&&
      payload.reasonCode===null&&payload.revokedAt===null;
  return payload.eventType==='EXTERNAL_FACT_APPROVAL_REVOKED'&&
    payload.status==='REVOKED'&&payload.revision>1&&
    validId(payload.previousEventId)&&typeof payload.previousEventHash==='string'&&
    HEX.test(payload.previousEventHash)&&realTimestamp(payload.revokedAt)&&
    typeof payload.reasonCode==='string';
}
