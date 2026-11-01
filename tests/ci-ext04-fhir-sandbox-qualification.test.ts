import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { SmartBackendTokenBroker } from '@/lib/interop/fhir-smart-backend-oauth';
import { qualifySmartFhirSandbox } from '@/lib/interop/fhir-smart-sandbox-qualification';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const source: FhirSourceRecord = {
  tenantId: 'synthetic-hospital', sourceId: 'synthetic-ehr', facilityId: 'facility-1',
  baseUrl: 'https://sandbox.fhir.example.test/r4',
  status: 'ACTIVE', securityReviewStatus: 'APPROVED',
  approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
  oauth: {
    mode: 'SMART_BACKEND',
    clientId: 'helixis-sandbox-client',
    tokenUrl: 'https://sandbox.auth.example.test/token',
    keyId: 'key1', secretVersion: 1, credentialRevision: 1,
    scopes: ['system/Patient.rs', 'system/Encounter.rs', 'system/Observation.rs'],
  },
};
const hosts = {
  allowedFhirHosts: ['sandbox.fhir.example.test'],
  allowedTokenHosts: ['sandbox.auth.example.test'],
};

describe('CI-EXT-04 read-only sandbox qualification', () => {
  test('valid SMART discovery, JWT token exchange, R4 capabilities without fetching patients', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const path = String(url);
      seen.push(path);
      if (init?.redirect !== 'error') throw Error('REDIRECT_GUARD_ABSENT');
      if (path.endsWith('/.well-known/smart-configuration')) {
        return new Response(JSON.stringify({
          token_endpoint: source.oauth!.tokenUrl,
          token_endpoint_auth_methods_supported: ['private_key_jwt'],
        }), { status: 200 });
      }
      if (path === source.oauth!.tokenUrl) {
        const body = new URLSearchParams(String(init?.body));
        return new Response(JSON.stringify({
          access_token: 'synthetic-sandbox-access-token',
          token_type: 'Bearer', expires_in: 600, scope: body.get('scope'),
        }), { status: 200 });
      }
      if (path.endsWith('/metadata')) {
        return new Response(JSON.stringify({
          resourceType: 'CapabilityStatement',
          fhirVersion: '4.0.1',
          rest: [{
            mode: 'server',
            resource: ['Patient','Encounter','Observation'].map(type => ({
              type, interaction: [{ code: 'read' },{code: 'search-type'}],
            })),
          }],
        }), { status: 200 });
      }
      throw Error('UNEXPECTED_READ_OR_PATIENT_ACCESS');
    };
    const broker = new SmartBackendTokenBroker({
      ...hosts, fetchImpl,
      getSecret: async () => privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    });
    const q = await qualifySmartFhirSandbox({
      ...hosts, source, sourceId: source.sourceId, tenantId: source.tenantId,
      broker, fetchImpl, now: () => 1_800_000_000_000,
    });
    expect(q.smartDiscoveryVerified).toBe(true);
    expect(q.fhirR4CapabilityVerified).toBe(true);
    expect(q.canReadPatient).toBe(true);
    expect(q.canReadObservation).toBe(true);
    expect(q.errors).toEqual([]);
    expect(q.qualifiedForPatientData).toBe(false);
    expect(q.qualifiedForProduction).toBe(false);
    expect(seen).toEqual([
      source.baseUrl + '/.well-known/smart-configuration',
      source.oauth!.tokenUrl,
      source.baseUrl + '/metadata',
    ]);
  });
  test('discovery mismatch fails without token or metadata traffic', async () => {
    let requests=0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return new Response(JSON.stringify({
        token_endpoint: 'https://malicious.example.test/token',
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      }), { status: 200 });
    };
    const broker = new SmartBackendTokenBroker({ ...hosts,
      getSecret: async () => { throw Error('SECRET_ACCESS_MUST_NOT_OCCUR'); },
    });
    const q = await qualifySmartFhirSandbox({
      ...hosts, broker, source, tenantId: source.tenantId, sourceId: source.sourceId,
      fetchImpl,
    });
    expect(q.errors).toContain('CI_EXT04_SMART_DISCOVERY_MISMATCH');
    expect(q.qualifiedForProduction).toBe(false);
    expect(requests).toBe(1);
  });
});
