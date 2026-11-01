/**
 * CI-EXT-05: staging-only governed FHIR site acceptance.
 *
 * The body selects an existing registered source and existing qualification
 * receipts; clients cannot submit fabricated evidence or approval identities.
 * This endpoint never changes integration activation environment flags.
 */
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import { activateFhirSiteRequest, requestFhirSiteReview,
  reviewFhirSiteRequest, suspendFhirSite } from '@/lib/interop/fhir-site-onboarding';
import type { FhirImportActor } from '@/lib/clinical/intelligence/external-fhir-import';

export const runtime='nodejs';
const SAFE=/^[A-Za-z0-9._-]{1,128}$/;
export async function POST(req:NextRequest) {
  try {
    if (process.env.GHIMS_CI_FHIR_SITE_ONBOARDING_ENABLED!=='true' ||
        process.env.GHIMS_RUNTIME_MODE!=='STAGING' ||
        getServerIntegrationState('FHIR_R4')!=='INTEGRATION_READY') {
      throw new Error('CI_EXT05_SITE_ONBOARDING_DISABLED');
    }
    const raw=await req.text();
    if(Buffer.byteLength(raw)>4096)
      return NextResponse.json({success:false,code:'CI_EXT05_BODY_TOO_LARGE'},{status:413});
    const body=JSON.parse(raw) as Record<string,unknown>;
    const tenantId=String(body.tenantId||'').trim().toLowerCase();
    if(!SAFE.test(tenantId))throw new Error('CI_EXT05_TENANT_INVALID');
    const {context}=await deriveAuthoritativeContext(req,tenantId);
    const db=getAdminFirestore();
    if(!db)throw new Error('CI_EXT05_FIRESTORE_UNAVAILABLE');
    const actor:FhirImportActor={
      tenantId:context.tenantId,actorId:context.actorId,
      roles:context.roles,permissions:context.permissions,
      facilityIds:context.facilityIds||[],
    };
    const action=String(body.action||'');
    let result:Record<string,unknown>;
    switch(action){
      case 'REQUEST':
        result=await requestFhirSiteReview({
          db,actor,
          sourceId:String(body.sourceId||''),
          protocolQualificationId:String(body.protocolQualificationId||''),
          syntheticEvidenceId:String(body.syntheticEvidenceId||''),
          resourceTypes:Array.isArray(body.resourceTypes)?body.resourceTypes as Array<'Patient'|'Encounter'|'Observation'>:[],
        });
        break;
      case 'CLINICAL_REVIEW':
      case 'SECURITY_REVIEW':
        result=await reviewFhirSiteRequest({
          db,actor,requestId:String(body.requestId||''),
          kind:action==='CLINICAL_REVIEW'?'CLINICAL':'SECURITY',
          rationale:String(body.rationale||''),
        });
        break;
      case 'ACTIVATE_APPROVAL':
        result=await activateFhirSiteRequest({
          db,actor,requestId:String(body.requestId||''),
        });
        break;
      case 'SUSPEND_SOURCE':
        result=await suspendFhirSite({
          db,actor,sourceId:String(body.sourceId||''),
          reason:String(body.reason||''),
        });
        break;
      default:
        throw new Error('CI_EXT05_ACTION_UNSUPPORTED');
    }
    return NextResponse.json({
      success:true,...result,
      fhirIntegrationEnabled:false,
      productionQualified:false,
    },{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    const code=error instanceof Error?error.message:'CI_EXT05_UNAVAILABLE';
    const status=/DENIED|DISABLED|PERMISSION|INDEPENDENCE/.test(code)?403:
      /INVALID|UNSUPPORTED|BODY_TOO_LARGE/.test(code)?422:
      /STALE|EVIDENCE|REPLAY|ALREADY|REQUIRED|QUALIFIED/.test(code)?409:503;
    return NextResponse.json({
      success:false,code:code.startsWith('CI_EXT05_')?code:'CI_EXT05_UNAVAILABLE',
    },{status,headers:{'Cache-Control':'no-store'}});
  }
}
