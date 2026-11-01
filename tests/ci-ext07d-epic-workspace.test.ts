import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  EPIC_SYNTHETIC_PROJECT_ID,
  EPIC_SYNTHETIC_TENANT_ID,
  EPIC_SYNTHETIC_FACILITY_ID,
  EPIC_SYNTHETIC_EVENT_ID,
  epicSyntheticWorkspaceMetadata,
  epicSyntheticWorkspacePaths,
} from '@/lib/interop/fhir-epic-synthetic-tenant';

const args = {
  projectId: EPIC_SYNTHETIC_PROJECT_ID,
  recordedAt: '2026-11-01T08:00:00.000Z',
  actorEmail: 'synthetic-operator@example.invalid',
  changeTicket: 'EPIC-BOOTSTRAP-0001',
};

describe('CI-EXT-07D isolated synthetic Epic workspace', () => {
  test('pinned paths and synthetic-only tenant/facility are not clinical environments', () => {
    const paths = epicSyntheticWorkspacePaths();
    expect(EPIC_SYNTHETIC_TENANT_ID).toBe('helixis-epic-sandbox');
    expect(EPIC_SYNTHETIC_FACILITY_ID).toBe('helixis-epic-test-facility');
    expect(paths).toEqual({
      tenant: 'tenants/helixis-epic-sandbox',
      facility: 'tenants/helixis-epic-sandbox/facilities/helixis-epic-test-facility',
      event: 'tenants/helixis-epic-sandbox/fhirProvisioningEvents/' + EPIC_SYNTHETIC_EVENT_ID,
    });
    const d = epicSyntheticWorkspaceMetadata(args);
    expect(d.tenant.tenantId).toBe(EPIC_SYNTHETIC_TENANT_ID);
    expect(d.tenant.syntheticOnly).toBe(true);
    expect(d.tenant.sandbox).toBe(true);
    expect(d.tenant.environment).toBe('STAGING');
    expect(d.tenant.tenantKind).toBe('INTEGRATION_SANDBOX');
    expect(d.tenant.externalPatientDataAllowed).toBe(false);
    expect(d.tenant.clinicalImportsEnabled).toBe(false);
    expect(d.facility.syntheticOnly).toBe(true);
    expect(d.facility.sandbox).toBe(true);
    expect(d.facility.tenantId).toBe(d.tenant.tenantId);
    expect(d.facility.status).toBe('ACTIVE');
    expect(d.event.immutable).toBe(true);
    expect(d.event.actorId).toBe(args.actorEmail);
    expect(d.event.changeTicket).toBe(args.changeTicket);
  });

  test('wrong project, missing actor, malformed ticket and invalid timestamps fail', () => {
    expect(() => epicSyntheticWorkspaceMetadata({
      ...args, projectId: 'g-hims-ai'
    })).toThrow('CI_EXT07D_WORKSPACE_METADATA_INVALID');
    expect(() => epicSyntheticWorkspaceMetadata({
      ...args, actorEmail: ''
    })).toThrow('CI_EXT07D_WORKSPACE_METADATA_INVALID');
    expect(() => epicSyntheticWorkspaceMetadata({
      ...args, changeTicket: ''
    })).toThrow('CI_EXT07D_WORKSPACE_METADATA_INVALID');
    expect(() => epicSyntheticWorkspaceMetadata({
      ...args, recordedAt: 'today'
    })).toThrow('CI_EXT07D_WORKSPACE_METADATA_INVALID');
  });

  test('operator script is guarded, read-only by default and uses atomic create-only commit', () => {
    const code = readFileSync('scripts/ops/ci-ext07d-epic-workspace.ts', 'utf8');
    expect(code).toContain("process.argv[2] ?? 'plan'");
    expect(code).toContain("e.GHIMS_RUNTIME_MODE !== 'STAGING'");
    expect(code).toContain('HELIXIS_CI_EXT07D_CONFIRM_CREATE');
    expect(code).toContain("currentDocument: { exists: false }");
    expect(code).toContain("prefix + ':commit'");
    expect(code).toContain(':listCollectionIds');
    expect(code).toContain('await confirmEmpty(token)');
    expect(code).not.toContain('recursiveDelete');
    expect(code).not.toContain('setCustomUserClaims');
    expect(code).not.toContain('add-iam-policy-binding');
    expect(code).not.toContain('access_token');
  });
});
