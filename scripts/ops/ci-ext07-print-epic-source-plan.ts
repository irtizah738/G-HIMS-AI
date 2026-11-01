/**
 * CI-EXT-07 operator-only, non-mutating source registration plan.
 * Run from staging Cloud Shell with GHIMS_RUNTIME_MODE=STAGING.
 * No Admin SDK, Secret Manager or network calls are performed here.
 */
import {
  EPIC_SANDBOX_CLIENT_ID, EPIC_SANDBOX_KID,
  EPIC_STAGING_PROJECT_ID, planEpicSandboxSourceProvision,
} from '../../lib/interop/fhir-epic-source-provision';

const projectId = process.env.HELIXIS_CI_EXT07_CONFIRM_PROJECT ?? '';
if (process.env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
    projectId !== EPIC_STAGING_PROJECT_ID ||
    process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED === 'true') {
  throw new Error('CI_EXT07_DISABLED_OR_ENVIRONMENT_INVALID');
}
const plan = planEpicSandboxSourceProvision({
  projectId,
  tenantId: process.env.HELIXIS_CI_EXT07_TENANT_ID ?? '',
  sourceId: process.env.HELIXIS_CI_EXT07_SOURCE_ID ?? '',
  facilityId: process.env.HELIXIS_CI_EXT07_FACILITY_ID ?? '',
  clientId: EPIC_SANDBOX_CLIENT_ID,
  keyId: EPIC_SANDBOX_KID,
});
process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
