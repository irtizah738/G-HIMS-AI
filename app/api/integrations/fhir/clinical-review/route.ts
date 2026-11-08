import {NextRequest,NextResponse} from 'next/server';
import {deriveAuthoritativeContext} from '@/lib/backend/security/authoritative-context';
import {getAdminFirestore} from '@/server/firebase/admin';
import {assertIntegrationLive} from '@/lib/interop/integration-state';
import {readExternalClinicalEvidence} from '@/lib/clinical/intelligence/external-clinical-evidence-reader';
import type {ExternalClinicianReviewInput} from '@/lib/clinical/intelligence/external-clinician-review-policy';

export const runtime='nodejs';

const SCOPE=/^[A-Za-z0-9._-]{1,128}$/;
const NO_STORE={'Cache-Control':'no-store, private'};
function codeFrom(error:unknown):string{
  const text=error instanceof Error?error.message.split(':')[0]:'';
  return /^(CI_EXT03|CI_EXT15)_[A-Z0-9_]+$/.test(text)?
    text:'CI_EXT15_REVIEW_UNAVAILABLE';
}
function statusFor(code:string):number{
  if(/REQUEST_INVALID|SCOPE_INVALID|REQUEST_TOO_LARGE/.test(code))return 400;
  if(/PRODUCTION_NOT_QUALIFIED|NOT_ENABLED|AUTH|TENANT|FACILITY|PERMISSION|ROLE|SOURCE_REVOKED|CONSENT|INDEPENDENT_CLINICIAN|INTEGRATION_NOT_LIVE/.test(code))
    return 403;
  if(/STALE|CONFLICT|PROJECTION|RECONCILIATION|CHECKPOINT|SOURCE_|HISTORY_|AVAILABILITY|EVIDENCE_|PATIENT_LINK|RECEIPT/.test(code))
    return 409;
  return 503;
}

/**
 * Record a clinician's review of an already verified external FHIR snapshot.
 * No client actor, source URL, bearer token, override, patient mapping or
 * clinical-use authorization is accepted. Default OFF and production blocked.
 */
export async function POST(req:NextRequest){
  try{
    if(!['TEST','STAGING'].includes(
      String(process.env.GHIMS_RUNTIME_MODE||'').trim().toUpperCase()))
      throw new Error('CI_EXT15_PRODUCTION_NOT_QUALIFIED');
    if(process.env.GHIMS_CI_EXTERNAL_CLINICAL_REVIEW_ENABLED!=='true')
      throw new Error('CI_EXT15_REVIEW_NOT_ENABLED');
    assertIntegrationLive('FHIR_R4');
    const declared=req.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>12_288))
      throw new Error('CI_EXT15_REQUEST_TOO_LARGE');
    const raw=await req.text();
    if(Buffer.byteLength(raw,'utf8')>12_288)
      throw new Error('CI_EXT15_REQUEST_TOO_LARGE');
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{
      throw new Error('CI_EXT15_REQUEST_INVALID');
    }
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      throw new Error('CI_EXT15_REQUEST_INVALID');
    const body=parsed as Record<string,unknown>;
    if(Object.keys(body).sort().join(',')!=='patientId,review,tenantId')
      throw new Error('CI_EXT15_REQUEST_INVALID');
    const tenantId=typeof body.tenantId==='string'?body.tenantId.trim():'';
    const patientId=typeof body.patientId==='string'?body.patientId.trim():'';
    if(!SCOPE.test(tenantId)||tenantId==='.'||tenantId==='..'||
       !SCOPE.test(patientId)||patientId==='.'||patientId==='..')
      throw new Error('CI_EXT15_SCOPE_INVALID');
    const {context}=await deriveAuthoritativeContext(req,tenantId);
    const db=getAdminFirestore();
    if(!db)throw new Error('CI_EXT15_FIRESTORE_UNAVAILABLE');
    const result=await readExternalClinicalEvidence({
      db,tenantId:context.tenantId,patientId,
      actor:{
        tenantId:context.tenantId,actorId:context.actorId,
        roles:context.roles,permissions:context.permissions,
        facilityIds:context.facilityIds||[],
      },
      review:body.review as ExternalClinicianReviewInput,
    });
    if(!result.review)throw new Error('CI_EXT15_REVIEW_NOT_RECORDED');
    return NextResponse.json(
      {success:true,review:result.review,evidenceOnly:true,
        clinicalUseAuthorized:false,aiDraftingEligible:false},
      {status:result.review.replay?200:201,headers:NO_STORE},
    );
  }catch(error){
    const code=codeFrom(error);
    return NextResponse.json(
      {success:false,code},
      {status:statusFor(code),headers:NO_STORE},
    );
  }
}
