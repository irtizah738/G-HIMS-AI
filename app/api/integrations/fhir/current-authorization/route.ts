/**
 * CI-EXT-16: explicit read-only current authorization assessment.
 * Returns a refusal/reason, NEVER FHIR payload or clinical-use permission.
 */
import {NextRequest,NextResponse} from 'next/server';
import {deriveAuthoritativeContext} from '@/lib/backend/security/authoritative-context';
import {getAdminFirestore} from '@/server/firebase/admin';
import {assertIntegrationLive} from '@/lib/interop/integration-state';
import {readExternalClinicalEvidence} from
  '@/lib/clinical/intelligence/external-clinical-evidence-reader';

export const runtime='nodejs';
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const REVIEW_ID=/^ecr_[a-f0-9]{64}$/;
const HEADERS={'Cache-Control':'no-store, private'};
function isRecord(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==='object'&&!Array.isArray(x);
}
function responseError(error:unknown):NextResponse{
  const message=error instanceof Error?error.message.split(':')[0]:'';
  const code=/^CI_EXT(?:03|16)_[A-Z0-9_]+$/.test(message)?
    message:'CI_EXT16_ASSESSMENT_UNAVAILABLE';
  let status=503;
  if(/(REQUEST_INVALID|SCOPE_INVALID|REVIEW_ID_INVALID|REQUEST_TOO_LARGE)/.test(code))
    status=400;
  else if(/(AUTH|PERMISSION|TENANT_ACCESS|FACILITY_ACCESS|SOURCE_REVOKED|CONSENT_REVOKED|NOT_ENABLED|NOT_QUALIFIED)/.test(code))
    status=403;
  else if(/(STALE|CHECKPOINT|RECONCILIATION|SOURCE_|HISTORY_|PROJECTION_|PATIENT_LINK|RECEIPT|SCOPE_OR_VERSION)/.test(code))
    status=409;
  return NextResponse.json({success:false,code},{status,headers:HEADERS});
}

/** Mode and permission gates run before the audited clinical context lookup. */
export async function POST(req:NextRequest):Promise<NextResponse>{
  try{
    if(!['TEST','STAGING'].includes(
      String(process.env.GHIMS_RUNTIME_MODE||'').trim().toUpperCase()))
      throw new Error('CI_EXT16_PRODUCTION_NOT_QUALIFIED');
    if(process.env.GHIMS_CI_EXTERNAL_CURRENT_AUTH_EVALUATOR_ENABLED!=='true')
      throw new Error('CI_EXT16_NOT_ENABLED');
    assertIntegrationLive('FHIR_R4');
    const contentLength=req.headers.get('content-length');
    if(contentLength!==null&&(!/^\d+$/.test(contentLength)||Number(contentLength)>4096))
      throw new Error('CI_EXT16_REQUEST_TOO_LARGE');
    const raw=await req.text();
    if(Buffer.byteLength(raw,'utf8')>4096)
      throw new Error('CI_EXT16_REQUEST_TOO_LARGE');
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{
      throw new Error('CI_EXT16_REQUEST_INVALID');
    }
    if(!isRecord(parsed)||Object.keys(parsed).sort().join(',')!==
      'patientId,reviewId,tenantId')
      throw new Error('CI_EXT16_REQUEST_INVALID');
    const tenantId=parsed.tenantId,patientId=parsed.patientId,reviewId=parsed.reviewId;
    if(typeof tenantId!=='string'||!ID.test(tenantId)||
       tenantId==='.'||tenantId==='..'||
       typeof patientId!=='string'||!ID.test(patientId)||
       patientId==='.'||patientId==='..'||
       typeof reviewId!=='string'||!REVIEW_ID.test(reviewId))
      throw new Error('CI_EXT16_SCOPE_INVALID');
    const {context}=await deriveAuthoritativeContext(req,tenantId);
    const db=getAdminFirestore();
    if(!db)throw new Error('CI_EXT16_FIRESTORE_UNAVAILABLE');
    const result=await readExternalClinicalEvidence({
      db,tenantId:context.tenantId,patientId,
      actor:{
        tenantId:context.tenantId,actorId:context.actorId,
        roles:context.roles,permissions:context.permissions,
        facilityIds:context.facilityIds||[],
      },
      evaluateReviewId:reviewId,
    });
    if(!result.currentAuthorization)
      throw new Error('CI_EXT16_ASSESSMENT_UNAVAILABLE');
    return NextResponse.json({
      success:true,currentAuthorization:result.currentAuthorization,
      evidenceOnly:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
      externalClinicalRelease:'NO_GO',
    },{status:200,headers:HEADERS});
  }catch(error){return responseError(error);}
}
