/**
 * Blocks native-authoritative Clinical Intelligence API routes when Helixis is
 * configured to use an external hospital HIS. External evidence is available
 * through its own explicit permissioned, EVIDENCE_ONLY API, never through the
 * native Patient360 clinical snapshot/draft pathways.
 *
 * This is a deployment safety interlock, NOT a qualified external adapter.
 * A process-wide environment flag is insufficient for future mixed-mode
 * multi-tenant deployments: before enabling those, replace this with a
 * transactionally enforced per-tenant source-authority policy.
 */
import {NextResponse} from 'next/server';
import {resolveClinicalContextSource} from './clinical-context-port';

export type NativeClinicalRouteGateResult =
  | {allowed:true}
  | {allowed:false;status:409|503;code:
      'CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED' |
      'CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID'};

/**
 * Pure, deterministic policy. Missing flag preserves the current native HIS
 * default; unknown or external values never infer a native fallback.
 */
export function evaluateNativeClinicalRouteGate(
  env:Record<string,string|undefined> = process.env,
):NativeClinicalRouteGateResult{
  try{
    if(resolveClinicalContextSource(env)==='NATIVE')return {allowed:true};
    return {
      allowed:false,status:409,
      code:'CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED',
    };
  }catch{
    return {
      allowed:false,status:503,
      code:'CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID',
    };
  }
}

/**
 * Invoke at entry for native CI routes BEFORE any patient/chart lookup,
 * projection rebuild, draft access, event reading or AI invocation.
 * Never exposes patient data, tenant identifiers, source URLs or PHI.
 */
export function guardNativeClinicalIntelligenceRoute(
  env:Record<string,string|undefined> = process.env,
):NextResponse | null{
  const result=evaluateNativeClinicalRouteGate(env);
  if(result.allowed)return null;
  return NextResponse.json(
    {success:false,error:{code:result.code}},
    {status:result.status,headers:{'Cache-Control':'no-store, private'}},
  );
}
