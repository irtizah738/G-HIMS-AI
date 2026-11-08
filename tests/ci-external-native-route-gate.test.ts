import {describe,expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  evaluateNativeClinicalRouteGate,
  guardNativeClinicalIntelligenceRoute,
} from '@/lib/clinical/intelligence/clinical-context-route-gate';

const NATIVE_ROUTES = [
  'drafts',
  'encounter-preparation',
  'evidence-snapshots',
  'longitudinal-summary',
  'medication-reconciliation',
  'trends',
] as const;

describe('Clinical Intelligence external-HIS native-route fail-closed interlock',()=>{
  test('unconfigured and explicitly NATIVE are the only native-authorized states',()=>{
    expect(evaluateNativeClinicalRouteGate({})).toEqual({allowed:true});
    expect(evaluateNativeClinicalRouteGate({
      GHIMS_CI_CONTEXT_SOURCE:'native',
    })).toEqual({allowed:true});
    expect(guardNativeClinicalIntelligenceRoute({})).toBeNull();
  });

  test('EXTERNAL mode rejects native clinical context before any clinical read',async()=>{
    for(const mode of ['EXTERNAL','external','  External  ']){
      const result=evaluateNativeClinicalRouteGate({GHIMS_CI_CONTEXT_SOURCE:mode});
      expect(result).toEqual({
        allowed:false,
        status:409,
        code:'CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED',
      });
      const response=guardNativeClinicalIntelligenceRoute({
        GHIMS_CI_CONTEXT_SOURCE:mode,
      });
      expect(response).not.toBeNull();
      expect(response!.status).toBe(409);
      expect(response!.headers.get('Cache-Control')).toContain('no-store');
      expect(await response!.json()).toEqual({
        success:false,
        error:{code:'CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED'},
      });
    }
  });

  test('invalid source configuration fails closed; never defaults to native',async()=>{
    for(const mode of ['INVALID','HYBRID','EXTERNAL,NATIVE','false']){
      const res=evaluateNativeClinicalRouteGate({GHIMS_CI_CONTEXT_SOURCE:mode});
      expect(res).toEqual({
        allowed:false,status:503,
        code:'CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID',
      });
      const response=guardNativeClinicalIntelligenceRoute({
        GHIMS_CI_CONTEXT_SOURCE:mode,
      });
      expect(response!.status).toBe(503);
      expect((await response!.json()).error.code).toBe(
        'CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID',
      );
    }
  });

  test('responses are evidence-free and do not return patient/tenant identifiers',async()=>{
    const response=guardNativeClinicalIntelligenceRoute({
      GHIMS_CI_CONTEXT_SOURCE:'EXTERNAL',
    });
    const body=JSON.stringify(await response!.json());
    expect(body).not.toContain('tenantId');
    expect(body).not.toContain('patientId');
    expect(body).not.toContain('sourceId');
    expect(body).not.toContain('projection');
    expect(body).not.toContain('accessToken');
  });

  test('all six native CI API routes block POST and GET before patient/chart access',async()=>{
    for(const name of NATIVE_ROUTES){
      const path=resolve(process.cwd(),'app/api/clinical/intelligence',name,'route.ts');
      const source=await readFile(path,'utf8');
      expect(source).toContain(
        "from '@/lib/clinical/intelligence/clinical-context-route-gate'",
      );
      const handlers=source.split(
        /export async function (?:POST|GET)\(req: NextRequest\) \{/,
      ).slice(1);
      const expected=name==='evidence-snapshots'?1:2;
      expect(handlers).toHaveLength(expected);
      for(const handler of handlers){
        const gateAt=handler.indexOf('guardNativeClinicalIntelligenceRoute()');
        const returnAt=handler.indexOf('if (sourceGate) return sourceGate;');
        expect(gateAt).toBeGreaterThan(-1);
        expect(returnAt).toBeGreaterThan(gateAt);
        expect(gateAt).toBeLessThan(110);
        // No sensitive operation can precede this fail-closed gate.
        const before=handler.slice(0,gateAt);
        for(const operation of [
          'req.json()', 'req.text()', 'DomainStateRepository',
          'Patient360ProjectionService','ClinicalEvidenceService',
          'deriveAuthoritativeContext','observeClinicalIntelligenceOperation',
        ]){
          expect(before).not.toContain(operation);
        }
      }
    }
  });

  test('explicitly permissioned FHIR evidence-only API is not made native',async()=>{
    const path=resolve(process.cwd(),'app/api/integrations/fhir/evidence/route.ts');
    const source=await readFile(path,'utf8');
    expect(source).toContain('readExternalClinicalEvidence');
    expect(source).toContain('evidenceOnly: true');
    expect(source).toContain('aiDraftingEligible: false');
    expect(source).not.toContain('guardNativeClinicalIntelligenceRoute');
  });
});
