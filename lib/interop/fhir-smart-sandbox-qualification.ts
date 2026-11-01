/**
 * CI-EXT-04: read-only SMART/FHIR R4 sandbox qualification.
 * This protocol checker never fetches patient records and never changes the HIS.
 * It produces only a capability-and-authentication report; no vendor is marked
 * "hospital qualified" by these protocol checks alone.
 */
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { FhirR4Adapter } from '@/lib/interop/fhir-r4-adapter';
import {
  SmartBackendTokenBroker, checkSmartBackendSource,
} from '@/lib/interop/fhir-smart-backend-oauth';

export type FhirSandboxQualification = {
  sourceId: string;
  tenantId: string;
  checkedAt: number;
  oauthCredentialRevision: number;
  smartDiscoveryVerified: boolean;
  fhirR4CapabilityVerified: boolean;
  canReadPatient: boolean;
  canReadEncounter: boolean;
  canReadObservation: boolean;
  qualifiedForPatientData: false;
  qualifiedForProduction: false;
  errors: string[];
};

export async function qualifySmartFhirSandbox(args: {
  source: FhirSourceRecord;
  tenantId: string;
  sourceId: string;
  broker: SmartBackendTokenBroker;
  allowedTokenHosts: readonly string[];
  allowedFhirHosts: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<FhirSandboxQualification> {
  const {
    source, tenantId, sourceId, broker,
    allowedTokenHosts, allowedFhirHosts,
  } = args;
  const oauth = checkSmartBackendSource(source, tenantId, sourceId, {
    allowedTokenHosts, allowedFhirHosts,
  });
  const fetchImpl = args.fetchImpl || fetch;
  const now = args.now || Date.now;
  const result: FhirSandboxQualification = {
    tenantId, sourceId, checkedAt: now(),
    oauthCredentialRevision: oauth.credentialRevision,
    smartDiscoveryVerified: false,
    fhirR4CapabilityVerified: false,
    canReadPatient: false, canReadEncounter: false, canReadObservation: false,
    qualifiedForPatientData: false, qualifiedForProduction: false,
    errors: [],
  };
  // Discovery is rooted in the approved HTTPS FHIR origin and cannot redirect
  // to an arbitrary vendor-hosted or internal URL.
  const url = source.baseUrl.replace(/\/$/, '') + '/.well-known/smart-configuration';
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      result.errors.push('CI_EXT04_SMART_DISCOVERY_HTTP_REJECTED');
      return result;
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 32_768) {
      result.errors.push('CI_EXT04_SMART_DISCOVERY_TOO_LARGE');
      return result;
    }
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      result.errors.push('CI_EXT04_SMART_DISCOVERY_JSON_INVALID'); return result;
    }
    const config = json as Record<string, unknown>;
    const mechanisms = Array.isArray(config.token_endpoint_auth_methods_supported)
      ? config.token_endpoint_auth_methods_supported : [];
    if (config.token_endpoint !== oauth.tokenUrl ||
        !mechanisms.includes('private_key_jwt')) {
      result.errors.push('CI_EXT04_SMART_DISCOVERY_MISMATCH');
      return result;
    }
    result.smartDiscoveryVerified = true;
  } catch {
    result.errors.push('CI_EXT04_SMART_DISCOVERY_UNAVAILABLE');
    return result;
  } finally {
    clearTimeout(handle);
  }

  const adapter = new FhirR4Adapter({
    baseUrl: source.baseUrl,
    state: 'LIVE',
    getAccessToken: () => broker.getAccessToken({
      source, tenantId, sourceId, resourceType: 'Patient',
    }),
    approvedResourceTypes: ['Patient','Encounter','Observation'],
    writableResourceTypes: [],
    fetchImpl,
    timeoutMs: 10000,
    maxReadRetries: 0,
  });
  try {
    const report = await adapter.qualifyApprovedResources([
      { resourceType: 'Patient', read: true },
      { resourceType: 'Encounter', read: true },
      { resourceType: 'Observation', read: true },
    ]);
    result.fhirR4CapabilityVerified = report.valid && report.fhirVersion === '4.0.1';
    const capabilities = new Map(report.resources.map(r => [r.resourceType, r.interactions]));
    result.canReadPatient = capabilities.get('Patient')?.includes('read') ?? false;
    result.canReadEncounter = capabilities.get('Encounter')?.includes('read') ?? false;
    result.canReadObservation = capabilities.get('Observation')?.includes('read') ?? false;
    if (!result.fhirR4CapabilityVerified) {
      result.errors.push('CI_EXT04_FHIR_R4_CAPABILITY_NOT_QUALIFIED');
    }
  } catch {
    result.errors.push('CI_EXT04_FHIR_METADATA_UNAVAILABLE');
  }
  return result;
}
