import {describe,expect,test} from 'bun:test';
import {
  assertInstitutionalEvidenceDossier,
  verifyInstitutionalEvidence,institutionalEvidenceDigest,
} from '@/lib/clinical/intelligence/external-institutional-verification';
import {verifyTrustDistributionManifest} from
  '@/lib/clinical/intelligence/external-trust-distribution';
import {
  syntheticInstitutionalVerifierBundle,
  syntheticDistributionBundle,
} from './support/ci-ext24-institutional-fixtures';
import {syntheticTrustLifecycle} from './support/ci-ext22-trust-anchor-fixtures';

const NOW=1794200000000;
function setup(){
  const f=syntheticTrustLifecycle('tenant-c24',NOW);
  const evidence=syntheticInstitutionalVerifierBundle({
    tenantId:f.tenantId,facilityId:f.facilityId,issuerId:f.issuerId,
    stewards:f.stewards,now:NOW,
  });
  const verify=(override:Partial<Parameters<typeof verifyInstitutionalEvidence>[0]>={})=>
    verifyInstitutionalEvidence({
      dossier:evidence.dossier,
      endorsements:evidence.endorsements,
      independentVerifierPins:evidence.independentVerifierPins,
      tenantId:f.tenantId,facilityId:f.facilityId,
      issuerId:f.issuerId,now:NOW,...override,
    });
  const distribution=syntheticDistributionBundle({
    tenantId:f.tenantId,facilityId:f.facilityId,issuerId:f.issuerId,
    pin:f.issuerPin(0,1),rootEventId:'hte_valid',
    rootEventHash:'a'.repeat(64),rootRevision:1,
    dossierId:'ivc_valid',dossierDigest:institutionalEvidenceDigest(evidence.dossier),
    now:NOW,
  });
  const verifyHandoff=(override:Partial<
    Parameters<typeof verifyTrustDistributionManifest>[0]>={})=>
    verifyTrustDistributionManifest({
      manifest:distribution.manifest,
      signatures:distribution.signatures,
      independentlyPinnedSigners:distribution.independentDistributionPins,
      tenantId:f.tenantId,facilityId:f.facilityId,issuerId:f.issuerId,
      now:NOW,minimumNextSequence:1,...override,
    });
  return {f,evidence,distribution,verify,verifyHandoff};
}
describe('CI-EXT-24 independent institutional identity contracts',()=>{
  test('all five independent signed assertions qualify non-promoting',()=>{
    const t=setup();
    expect(t.verify()).toEqual({
      valid:true,
      reasonCode:'CI_EXT24_INDEPENDENT_ASSERTIONS_SYNTHETIC_NON_PROMOTING',
      dossierDigest:institutionalEvidenceDigest(t.evidence.dossier),
      institutionalIdentityCommissioned:false,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
  });
  test('self-declared institution, missing quorum, duplicate role and swapped verifier deny',()=>{
    const t=setup();
    expect(t.verify({endorsements:t.evidence.endorsements.slice(0,4)}).valid)
      .toBe(false);
    const swapped=[...t.evidence.endorsements];
    swapped[1]={...swapped[0]};
    expect(t.verify({endorsements:swapped}).valid).toBe(false);
    const impersonation=t.evidence.independentVerifierPins.map((p,i)=>
      i===0?{...p,verifierId:t.f.issuerId}:p);
    expect(t.verify({independentVerifierPins:impersonation}).valid).toBe(false);
    expect(t.verify({tenantId:'another-tenant'}).valid).toBe(false);
    expect(t.verify({facilityId:'another-facility'}).valid).toBe(false);
  });
  test('modified evidence, revoked verifier and expired dossier deny',()=>{
    const t=setup();
    const changed={...t.evidence.dossier,
      sourceAgreementEvidenceDigest:'0'.repeat(64)};
    expect(t.verify({dossier:changed}).valid).toBe(false);
    const expired=t.evidence.independentVerifierPins.map((p,i)=>
      i===1?{...p,status:'REVOKED' as const}:p);
    expect(t.verify({independentVerifierPins:expired}).valid).toBe(false);
    expect(t.verify({now:t.evidence.dossier.validUntil}).valid).toBe(false);
    expect(()=>assertInstitutionalEvidenceDossier({
      ...t.evidence.dossier,rawPatientIdentifiers:['p1'],
    })).toThrow('CI_EXT24_DOSSIER_SCHEMA_INVALID');
    expect(()=>assertInstitutionalEvidenceDossier({
      ...t.evidence.dossier,
      stewards:[t.evidence.dossier.stewards[0],
        t.evidence.dossier.stewards[0],t.evidence.dossier.stewards[0]],
    })).toThrow('CI_EXT24_DOSSIER_FIELDS_INVALID');
  });
  test('external assertions cannot promote to commissioned hospital identity',()=>{
    const t=setup(),r=t.verify();
    expect(r.valid).toBe(true);
    expect(r.institutionalIdentityCommissioned).toBe(false);
    expect(r.clinicalUseAuthorized).toBe(false);
  });
});
describe('CI-EXT-24 signed trust handoff contract',()=>{
  test('independently signed current-key manifest is always HELD',()=>{
    const t=setup();
    expect(t.verifyHandoff()).toEqual({
      valid:true,reasonCode:'CI_EXT24_SIGNED_QUARANTINED_HANDOFF',
      manifestDigest:expect.any(String),
      delivered:false,clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
  });
  test('rollback, expiry, modified pin, cross-tenant and forged signature deny',()=>{
    const t=setup();
    expect(t.verifyHandoff({minimumNextSequence:2}).valid).toBe(false);
    expect(t.verifyHandoff({now:t.distribution.manifest.validUntil}).valid)
      .toBe(false);
    expect(t.verifyHandoff({tenantId:'wrong-tenant'}).valid).toBe(false);
    const bad={...t.distribution.manifest,anchorRevision:2};
    expect(t.verifyHandoff({manifest:bad}).valid).toBe(false);
    const badSigner=t.distribution.independentDistributionPins.map((p,i)=>
      i===0?{...p,status:'REVOKED' as const}:p);
    expect(t.verifyHandoff({independentlyPinnedSigners:badSigner}).valid)
      .toBe(false);
    const signatures=[...t.distribution.signatures];
    signatures[0]={...signatures[0],signatureBase64Url:'A'.repeat(86)};
    expect(t.verifyHandoff({signatures}).valid).toBe(false);
  });
  test('delivery mode or unrecognized fields cannot imply authority',()=>{
    const t=setup();
    expect(t.verifyHandoff({manifest:{
      ...t.distribution.manifest,deliveryMode:'PUBLISHED',
    }}).valid).toBe(false);
    expect(t.verifyHandoff({manifest:{
      ...t.distribution.manifest,aiDraftingEligible:true,
    }}).valid).toBe(false);
    expect(t.verifyHandoff({signatures:t.distribution.signatures.slice(0,1)})
      .valid).toBe(false);
  });
});
