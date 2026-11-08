/**
 * Clinical review input policy, intentionally separate from the FHIR evidence
 * reader. A review is a historical acknowledgement/concern, NOT a grant to
 * draft, reconcile, or promote externally imported clinical facts.
 */
import {createHash} from 'node:crypto';
import type {FhirImportActor} from './external-fhir-import';

export type ExternalReviewDisposition =
  | 'SOURCE_EVIDENCE_REVIEWED'
  | 'CLINICAL_CONCERN_RECORDED';

export type ExternalReviewFactRef = Readonly<{
  evidenceReceiptId:string;
  sourceVersionId:string;
  resourceHash:string;
}>;

export type ExternalClinicianReviewInput = Readonly<{
  idempotencyKey:string;
  expectedProjectionRevision:number;
  expectedProjectionContentHash:string;
  expectedSourceCheckpoint:string;
  expectedFacts:readonly ExternalReviewFactRef[];
  disposition:ExternalReviewDisposition;
}>;

const HEX=/^[a-f0-9]{64}$/;
const IDENTIFIER=/^[A-Za-z0-9._-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function deny(code:string):never{throw new Error('CI_EXT15_'+code);}
function exactKeys(value:unknown,keys:readonly string[]):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const actual=Object.keys(value).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&
    actual.every((key,i)=>key===expected[i]);
}
export function assertExternalClinicianReviewAuthority(actor:FhirImportActor):void{
  const roles=new Set((actor.roles||[]).map(x=>x.toUpperCase()));
  const permissions=new Set((actor.permissions||[]).map(x=>x.toUpperCase()));
  if(!roles.has('DOCTOR')&&!roles.has('CONSULTANT')&&!roles.has('ATTENDING_PHYSICIAN'))
    deny('CLINICIAN_ROLE_REQUIRED');
  if(!permissions.has('FHIR_CLINICAL_EVIDENCE_REVIEW')||
     !permissions.has('FHIR_EVIDENCE_REVIEW'))
    deny('EXPLICIT_REVIEW_PERMISSION_REQUIRED');
  if(!IDENTIFIER.test(actor.actorId||'')||actor.actorId==='.'||actor.actorId==='..')
    deny('ACTOR_INVALID');
}
export function assertExternalClinicianReviewInput(
  value:unknown,
):asserts value is ExternalClinicianReviewInput {
  if(!exactKeys(value,[
    'idempotencyKey','expectedProjectionRevision','expectedProjectionContentHash',
    'expectedSourceCheckpoint','expectedFacts','disposition',
  ]))deny('REQUEST_INVALID');
  const v=value as ExternalClinicianReviewInput;
  if(!UUID.test(v.idempotencyKey)||
     !Number.isSafeInteger(v.expectedProjectionRevision)||v.expectedProjectionRevision<1||
     !HEX.test(v.expectedProjectionContentHash)||!HEX.test(v.expectedSourceCheckpoint)||
     !['SOURCE_EVIDENCE_REVIEWED','CLINICAL_CONCERN_RECORDED'].includes(v.disposition)||
     !Array.isArray(v.expectedFacts)||v.expectedFacts.length<1||
     v.expectedFacts.length>64||
     v.expectedFacts.some(row=>
       !exactKeys(row,['evidenceReceiptId','sourceVersionId','resourceHash'])||
       !IDENTIFIER.test(row.evidenceReceiptId)||!IDENTIFIER.test(row.sourceVersionId)||
       !HEX.test(row.resourceHash))||
     new Set(v.expectedFacts.map(x=>x.evidenceReceiptId)).size!==v.expectedFacts.length
  )deny('REQUEST_INVALID');
}
export function externalReviewFactDigest(
  refs:readonly ExternalReviewFactRef[],
):string {
  if(!Array.isArray(refs)||refs.length<1||refs.length>64)
    deny('FACT_REFERENCES_INVALID');
  const sorted=[...refs].sort((a,b)=>a.evidenceReceiptId.localeCompare(b.evidenceReceiptId));
  return createHash('sha256').update(JSON.stringify(
    ['HELIXIS_EXTERNAL_CLINICAL_EVIDENCE_REVIEW_FACTS_V1',sorted],
  )).digest('hex');
}
export function externalClinicianReviewId(
  tenantId:string,patientId:string,actorId:string,idempotencyKey:string,
):string {
  if(![tenantId,patientId,actorId].every(x=>IDENTIFIER.test(x)&&x!=='.'&&x!=='..')||
     !UUID.test(idempotencyKey))deny('REVIEW_SCOPE_INVALID');
  const digest=createHash('sha256').update(JSON.stringify(
    ['HELIXIS_CI_EXT15_CLINICAL_REVIEW_V1',
      tenantId,patientId,actorId,idempotencyKey.toLowerCase()],
  )).digest('hex');
  return 'ecr_'+digest;
}
