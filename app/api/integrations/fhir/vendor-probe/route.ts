/**
 * CI-EXT-06: staging-only read-only vendor sandbox probe.
 *
 * No request-supplied fixtures, URLs, OAuth credentials, tokens or FHIR data.
 * This endpoint produces an immutable OBSERVED/FAILED technical trace, never
 * a clinical PASS or the fhirSyntheticQualifications record used by CI-EXT-05.
 */
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { checkSmartBackendSource, SmartBackendTokenBroker } from '@/lib/interop/fhir-smart-backend-oauth';
import { createGcpFhirPrivateKeyAccessor } from '@/lib/interop/fhir-smart-secret-manager';
import { assertPublicSandboxEgress } from '@/lib/interop/fhir-sandbox-egress';
import { probeVendorFhirSandbox, validateVendorFixtureManifest,
  type VendorFixtureManifest } from '@/lib/interop/fhir-vendor-sandbox-probe';

export const runtime='nodejs';
const ID=/^[A-Za-z0-9._-]{1,64}$/;
function digest(value:unknown):string {
  const canonical=(v:unknown):string=>{
    if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    const o=v as Record<string,unknown>;
    return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export async function POST(req:NextRequest) {
  try {
    if(process.env.GHIMS_RUNTIME_MODE!=='STAGING'||
       process.env.GHIMS_INTEGRATION_FHIR_R4_STATE!=='INTEGRATION_READY'||
       getServerIntegrationState('FHIR_R4')!=='INTEGRATION_READY'||
       process.env.GHIMS_CI_FHIR_AUTH_MODE!=='SMART_BACKEND'||
       process.env.GHIMS_CI_VENDOR_SANDBOX_PROBE_ENABLED!=='true'){
      throw new Error('CI_EXT06_PROBE_DISABLED');
    }
    const raw=await req.text();
    if(Buffer.byteLength(raw)>1024)throw new Error('CI_EXT06_REQUEST_TOO_LARGE');
    const input=JSON.parse(raw) as Record<string,unknown>;
    if(Object.keys(input).sort().join(',')!=='sourceId,tenantId') {
      throw new Error('CI_EXT06_REQUEST_FIELDS_DENIED');
    }
    const tenantId=String(input.tenantId||'').trim().toLowerCase();
    const sourceId=String(input.sourceId||'').trim();
    if(!ID.test(tenantId)||!ID.test(sourceId)||tenantId==='..'||sourceId==='..'){
      throw new Error('CI_EXT06_REQUEST_INVALID');
    }
    const {context}=await deriveAuthoritativeContext(req,tenantId);
    if(!context.permissions.includes('FHIR_VENDOR_SANDBOX_PROBE')){
      throw new Error('CI_EXT06_PERMISSION_DENIED');
    }
    const db=getAdminFirestore();
    if(!db)throw new Error('CI_EXT06_FIRESTORE_UNAVAILABLE');
    const root=db.collection('tenants').doc(context.tenantId);
    const sourceRef=root.collection('fhirSources').doc(sourceId);
    const manifestRef=root.collection('fhirSyntheticFixtureManifests').doc(sourceId);
    const [sourceSnap,manifestSnap]=await db.getAll(sourceRef,manifestRef);
    if(!sourceSnap.exists||!manifestSnap.exists)
      throw new Error('CI_EXT06_SOURCE_OR_MANIFEST_DENIED');
    const source=sourceSnap.data() as FhirSourceRecord;
    const manifest=manifestSnap.data() as VendorFixtureManifest;
    if(!context.facilityIds?.includes(source.facilityId)){
      throw new Error('CI_EXT06_FACILITY_DENIED');
    }
    const allowedTokenHosts=(process.env.GHIMS_CI_FHIR_OAUTH_ALLOWED_TOKEN_HOSTS||'')
      .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    const allowedFhirHosts=(process.env.GHIMS_CI_FHIR_OAUTH_ALLOWED_FHIR_HOSTS||'')
      .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    checkSmartBackendSource(source,context.tenantId,sourceId,{
      allowedTokenHosts,allowedFhirHosts,
    });
    validateVendorFixtureManifest(source,manifest,Date.now());
    await assertPublicSandboxEgress({url:source.baseUrl,allowedHosts:allowedFhirHosts});
    await assertPublicSandboxEgress({url:source.oauth!.tokenUrl,allowedHosts:allowedTokenHosts});
    const broker=new SmartBackendTokenBroker({
      allowedTokenHosts,allowedFhirHosts,
      getSecret:createGcpFhirPrivateKeyAccessor({
        projectId:process.env.GHIMS_CI_FHIR_SECRET_PROJECT_ID||'',
      }),
    });
    const report=await probeVendorFhirSandbox({
      source,tenantId:context.tenantId,sourceId,manifest,broker,
      allowedTokenHosts,allowedFhirHosts,
    });
    const evidenceId='fvp_'+randomUUID();
    const sourceHash=digest(source),manifestHash=digest(manifest);
    // If an operator revokes a fixture manifest, rotates credentials or
    // suspends a source while the remote read runs, do not accept this probe.
    await db.runTransaction(async tx=>{
      const [s,m]=await tx.getAll(sourceRef,manifestRef);
      if(!s.exists||!m.exists||digest(s.data())!==sourceHash||
         digest(m.data())!==manifestHash){
        throw new Error('CI_EXT06_SOURCE_OR_FIXTURE_CHANGED');
      }
      validateVendorFixtureManifest(s.data() as FhirSourceRecord,
        m.data() as VendorFixtureManifest,Date.now());
      tx.create(root.collection('fhirVendorProbes').doc(evidenceId),{
        evidenceId,tenantId:context.tenantId,sourceId,
        facilityId:source.facilityId,actorId:context.actorId,
        manifestRevision:manifest.manifestRevision,
        credentialRevision:source.oauth!.credentialRevision,
        outcome:report.outcome,checks:report.checks,
        evidenceHash:report.evidenceHash,errors:report.errors,
        checkedAt:report.checkedAt,recordedAt:Date.now(),
        qualifiedForPatientData:false,qualifiedForProduction:false,
        independentReviewRequired:true,immutable:true,
      });
    });
    return NextResponse.json({
      success:true,evidenceId,...report,independentReviewRequired:true,
    },{headers:{'Cache-Control':'no-store, private'}});
  }catch(err){
    const code=err instanceof Error?err.message:'';
    const status=/DENIED|DISABLED|PERMISSION/.test(code)?403:
      /INVALID|FIELDS|TOO_LARGE/.test(code)?422:
      /CHANGED/.test(code)?409:503;
    return NextResponse.json({
      success:false,
      code:code.startsWith('CI_EXT06_')?code:'CI_EXT06_PROBE_UNAVAILABLE',
    },{status,headers:{'Cache-Control':'no-store'}});
  }
}
