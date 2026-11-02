/**
 * CI-EXT-07D — dedicated Epic developer-sandbox tenant/facility plan.
 *
 * Pure metadata builder. No Firestore/Auth/Secret Manager calls.
 * Existing CIQP and actual-hospital tenants must never be repurposed.
 */
export const EPIC_SYNTHETIC_PROJECT_ID = 'studio-1130431360-48a05';
export const EPIC_SYNTHETIC_TENANT_ID = 'helixis-epic-sandbox';
export const EPIC_SYNTHETIC_FACILITY_ID = 'helixis-epic-test-facility';
export const EPIC_SYNTHETIC_EVENT_ID = 'epic-synthetic-workspace-created-v1';

export function epicSyntheticWorkspacePaths() {
  const root = `tenants/${EPIC_SYNTHETIC_TENANT_ID}`;
  return {
    tenant: root,
    facility: `${root}/facilities/${EPIC_SYNTHETIC_FACILITY_ID}`,
    event: `${root}/fhirProvisioningEvents/${EPIC_SYNTHETIC_EVENT_ID}`,
  };
}

export function epicSyntheticWorkspaceMetadata(args: {
  projectId: string;
  recordedAt: string;
  actorEmail: string;
  changeTicket: string;
}) {
  const { projectId, recordedAt, actorEmail, changeTicket } = args;
  if (projectId !== EPIC_SYNTHETIC_PROJECT_ID ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt) ||
      !Number.isFinite(Date.parse(recordedAt)) ||
      !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(actorEmail) ||
      !/^[A-Za-z0-9._-]{8,128}$/.test(changeTicket)) {
    throw new Error('CI_EXT07D_WORKSPACE_METADATA_INVALID');
  }
  return {
    tenant: {
      tenantId: EPIC_SYNTHETIC_TENANT_ID,
      projectId,
      name: 'Helixis Epic Developer Integration — Synthetic Only',
      status: 'ACTIVE',
      environment: 'STAGING',
      tenantKind: 'INTEGRATION_SANDBOX',
      syntheticOnly: true,
      sandbox: true,
      externalPatientDataAllowed: false,
      clinicalImportsEnabled: false,
      createdAt: recordedAt,
    },
    facility: {
      id: EPIC_SYNTHETIC_FACILITY_ID,
      facilityId: EPIC_SYNTHETIC_FACILITY_ID,
      tenantId: EPIC_SYNTHETIC_TENANT_ID,
      name: 'Helixis Epic Synthetic Test Facility',
      status: 'ACTIVE',
      syntheticOnly: true,
      sandbox: true,
      externalPatientDataAllowed: false,
      clinicalImportsEnabled: false,
      createdAt: recordedAt,
    },
    event: {
      eventType: 'EPIC_SYNTHETIC_WORKSPACE_CREATED',
      eventId: EPIC_SYNTHETIC_EVENT_ID,
      tenantId: EPIC_SYNTHETIC_TENANT_ID,
      facilityId: EPIC_SYNTHETIC_FACILITY_ID,
      projectId,
      actorId: actorEmail,
      changeTicket,
      syntheticOnly: true,
      clinicalImportsEnabled: false,
      recordedAt,
      immutable: true,
    },
  };
}
