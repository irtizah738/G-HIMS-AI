import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { smartSecretResource } from '@/lib/interop/fhir-smart-secret-manager';
import {
  planEpicSandboxSourceProvision,
  EPIC_SANDBOX_CLIENT_ID,
  EPIC_SANDBOX_KID,
  EPIC_SANDBOX_SPKI_SHA256,
  EPIC_STAGING_PROJECT_ID,
} from '@/lib/interop/fhir-epic-source-provision';

const base = {
  projectId: EPIC_STAGING_PROJECT_ID,
  tenantId: 'synthetic-hospital-a',
  sourceId: 'epic-sandbox-a',
  facilityId: 'synthetic-campus-a',
  clientId: EPIC_SANDBOX_CLIENT_ID,
  keyId: EPIC_SANDBOX_KID,
};

describe('CI-EXT-07 governed Epic key/source staging plan', () => {
  test('is deterministic, tenant-scoped, source-scoped and disabled', () => {
    const p = planEpicSandboxSourceProvision(base);
    expect(planEpicSandboxSourceProvision(base)).toEqual(p);
    expect(p.stage).toBe('PREPARED_NOT_PROVISIONED');
    expect(p.sourceDocumentPath).toBe(
      'tenants/synthetic-hospital-a/fhirSources/epic-sandbox-a');
    expect(p.secretResource).toBe(smartSecretResource({
      projectId: base.projectId, tenantId: base.tenantId, sourceId: base.sourceId,
      version: 1,
    }));
    expect(p.sourceKeyFingerprintSha256).toBe(EPIC_SANDBOX_SPKI_SHA256);
    expect(p.sourceMetadata.status).toBe('SUSPENDED');
    expect(p.sourceMetadata.securityReviewStatus).toBe('PENDING');
    expect(p.sourceMetadata.oauth.vendorProfile).toBe('EPIC_SANDBOX');
    expect(p.sourceMetadata.oauth.scopes).toEqual([
      'system/Patient.r', 'system/Encounter.r', 'system/Observation.r',
    ]);
    expect(p.sourceMetadata.siteApprovalId).toBeUndefined();
    expect(p.gates.importFeatureEnabled).toBe(false);
    expect(JSON.stringify(p)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(p)).not.toContain('access_token');
  });

  test('distinct tenant/source gets a distinct key; facility alone never changes key', () => {
    const a = planEpicSandboxSourceProvision(base);
    expect(planEpicSandboxSourceProvision({...base, tenantId:'synthetic-hospital-b'}).secretResource)
      .not.toBe(a.secretResource);
    expect(planEpicSandboxSourceProvision({...base, sourceId:'epic-sandbox-b'}).secretResource)
      .not.toBe(a.secretResource);
    expect(planEpicSandboxSourceProvision({...base, facilityId:'synthetic-campus-b'}).secretResource)
      .toBe(a.secretResource);
  });

  test('cannot target production, another Epic registration or invalid identities', () => {
    const invalid = [
      {...base, projectId:'g-hims-ai'},
      {...base, projectId:'ghims-prod'},
      {...base, clientId:'c844ab82-67ff-4546-942a-1559844fcfbc'},
      {...base, keyId:'unapproved-key'},
      {...base, tenantId:'../different'},
      {...base, tenantId:'..'},
      {...base, sourceId:''},
      {...base, sourceId:'other/source'},
      {...base, facilityId:'.'},
    ];
    for (const candidate of invalid) {
      expect(() => planEpicSandboxSourceProvision(candidate)).toThrow();
    }
  });

  test('operator shell is fail-closed and fingerprint pin matches planner', () => {
    const shell = readFileSync('scripts/ops/ci-ext07-epic-key-copy.sh','utf8');
    expect(shell).toContain('set -Eeuo pipefail');
    expect(shell).toContain('GHIMS_RUNTIME_MODE');
    expect(shell).toContain('HELIXIS_CI_EXT07_CONFIRM_COPY');
    expect(shell).toContain('SOURCE_PUBLIC_KEY_MATCH=PASS');
    expect(shell).toContain(EPIC_SANDBOX_SPKI_SHA256);
    expect(shell).not.toContain('set -x');
    expect(shell).not.toContain('add-iam-policy-binding');
    expect(shell).not.toContain('firestore documents create');
  });
});
