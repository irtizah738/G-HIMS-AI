/**
 * CI-EXT-07 — read-only provisioning plan for one Epic developer sandbox source.
 *
 * The planner makes NO Firebase, Secret Manager, IAM or Epic mutations.
 * The source stays SUSPENDED + PENDING until independently qualified.
 * This exact sandbox client/key MUST NOT be repurposed for production.
 */
import { smartSecretResource } from './fhir-smart-secret-manager';

export const EPIC_STAGING_PROJECT_ID = 'studio-1130431360-48a05';
export const EPIC_SANDBOX_CLIENT_ID = 'e2943759-3601-4d72-998a-c29c2bf1a07f';
export const EPIC_SANDBOX_KID = 'helixis-epic-sandbox-v1-ec114bb777b7cd2a';
export const EPIC_SANDBOX_SPKI_SHA256 =
  'ec114bb777b7cd2aeda2e27be9c7d5eec771cdfc290ed62c5b783406fd599d2f';
export const EPIC_SANDBOX_SOURCE_SECRET = 'helixis-epic-sandbox-rs384';
export const EPIC_SANDBOX_FHIR_BASE =
  'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/';
export const EPIC_SANDBOX_TOKEN_URL =
  'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';

export type EpicSandboxSourceProvisionArgs = {
  projectId: string;
  tenantId: string;
  sourceId: string;
  facilityId: string;
  clientId: string;
  keyId: string;
};

const ID = /^[A-Za-z0-9._-]{1,128}$/;
const validId = (value: string) =>
  typeof value === 'string' && ID.test(value) && value !== '.' && value !== '..';

/**
 * This is an operator-reviewable metadata proposal, NOT an onboarding
 * approval. Don't store keys, bearer tokens, patient IDs, or source data.
 */
export function planEpicSandboxSourceProvision(args: EpicSandboxSourceProvisionArgs) {
  if (args.projectId !== EPIC_STAGING_PROJECT_ID ||
      ![args.tenantId, args.sourceId, args.facilityId].every(validId)) {
    throw new Error('CI_EXT07_STAGING_SCOPE_INVALID');
  }
  if (args.clientId !== EPIC_SANDBOX_CLIENT_ID ||
      args.keyId !== EPIC_SANDBOX_KID) {
    throw new Error('CI_EXT07_EPIC_REGISTRATION_MISMATCH');
  }
  const resource = smartSecretResource({
    projectId: args.projectId,
    tenantId: args.tenantId,
    sourceId: args.sourceId,
    version: 1,
  });
  return {
    stage: 'PREPARED_NOT_PROVISIONED' as const,
    projectId: args.projectId,
    secretResource: resource,
    sourceKeyFingerprintSha256: EPIC_SANDBOX_SPKI_SHA256,
    sourceDocumentPath: `tenants/${args.tenantId}/fhirSources/${args.sourceId}`,
    sourceMetadata: {
      tenantId: args.tenantId,
      sourceId: args.sourceId,
      facilityId: args.facilityId,
      baseUrl: EPIC_SANDBOX_FHIR_BASE,
      status: 'SUSPENDED' as const,
      securityReviewStatus: 'PENDING' as const,
      approvedResourceTypes: ['Patient', 'Encounter', 'Observation'] as const,
      oauth: {
        mode: 'SMART_BACKEND' as const,
        vendorProfile: 'EPIC_SANDBOX' as const,
        clientId: args.clientId,
        tokenUrl: EPIC_SANDBOX_TOKEN_URL,
        keyId: args.keyId,
        secretVersion: 1,
        credentialRevision: 1,
        // No .s rights assumed. Reconcile exact fresh Epic grants separately.
        scopes: ['system/Patient.r', 'system/Encounter.r', 'system/Observation.r'] as const,
      },
    },
    gates: {
      keyFingerprintMatch: 'REQUIRED' as const,
      sourceSpecificSecret: 'REQUIRED' as const,
      sourceOnlyRuntimeIam: 'REQUIRED' as const,
      networkEgressProxy: 'REQUIRED' as const,
      hospitalSiteApproval: 'REQUIRED' as const,
      importFeatureEnabled: false as const,
    },
  };
}
