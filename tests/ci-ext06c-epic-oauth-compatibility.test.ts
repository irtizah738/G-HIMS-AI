import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import {
  checkSmartBackendSource, SmartBackendTokenBroker,
} from '@/lib/interop/fhir-smart-backend-oauth';
import {
  EPIC_SANDBOX_FHIR_BASE, EPIC_SANDBOX_TOKEN_URL, EPIC_SANDBOX_JWKS_URL,
  validateEpicSandboxGrantedScopes,
} from '@/lib/interop/fhir-epic-sandbox-oauth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const grants = [
  'system/Patient.r',
  'system/Encounter.r',
  'system/Observation.r',
  'system/Observation.r?category=http://terminology.hl7.org/CodeSystem/observation-category|vital-signs',
];
const configuredScopes = ['system/Patient.r', 'system/Encounter.r', 'system/Observation.r'];
const source: FhirSourceRecord = {
  tenantId: 'synthetic-hospital', sourceId: 'epic-nonprod',
  facilityId: 'synthetic-campus', status: 'ACTIVE',
  securityReviewStatus: 'APPROVED',
  baseUrl: EPIC_SANDBOX_FHIR_BASE,
  approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
  oauth: {
    mode: 'SMART_BACKEND',
    vendorProfile: 'EPIC_SANDBOX',
    clientId: 'epic-synthetic-client-id',
    tokenUrl: EPIC_SANDBOX_TOKEN_URL,
    keyId: 'synthetic-epic-key-1',
    secretVersion: 1, credentialRevision: 1,
    scopes: configuredScopes,
  },
};
const hosts = {
  allowedTokenHosts: ['fhir.epic.com'],
  allowedFhirHosts: ['fhir.epic.com'],
};

describe('CI-EXT-06C: Epic synthetic sandbox OAuth compatibility', () => {
  test('requires an explicit profile, exact Epic origins and source allowlists', () => {
    expect(checkSmartBackendSource(
      source, 'synthetic-hospital', 'epic-nonprod', hosts
    ).vendorProfile).toBe('EPIC_SANDBOX');

    expect(() => checkSmartBackendSource(
      {...source, baseUrl:'https://fhir.epic.com/other-fhir'},
      source.tenantId, source.sourceId, hosts
    )).toThrow('CI_EXT06C_EPIC_SANDBOX_CONFIG_DENIED');

    expect(() => checkSmartBackendSource(
      {...source, oauth:{...source.oauth!,tokenUrl:'https://fhir.epic.com/other-token'}},
      source.tenantId, source.sourceId, hosts
    )).toThrow('CI_EXT06C_EPIC_SANDBOX_CONFIG_DENIED');

    expect(() => checkSmartBackendSource(
      {...source, oauth:{...source.oauth!,scopes:['system/*.rs']}},
      source.tenantId, source.sourceId, hosts
    )).toThrow('CI_EXT04_OAUTH_CONFIGURATION_INVALID');

    expect(() => checkSmartBackendSource(
      {...source, oauth:{...source.oauth!,scopes:['system/Observation.w']}},
      source.tenantId, source.sourceId, hosts
    )).toThrow('CI_EXT04_OAUTH_CONFIGURATION_INVALID');

    expect(() => checkSmartBackendSource(
      {...source, oauth:{...source.oauth!,vendorProfile:undefined}},
      source.tenantId, source.sourceId, hosts
    )).toThrow('CI_EXT04_OAUTH_CONFIGURATION_INVALID');

    expect(() => checkSmartBackendSource(
      source, 'different-tenant', source.sourceId, hosts
    )).toThrow('CI_EXT04_SOURCE_NOT_AUTHORIZED');
  });

  test('grants Epic read by ID without interpreting it as search', () => {
    const token = { access_token: 'synthetic-bearer-not-real', token_type: 'Bearer',
      expires_in: 600, scope: grants.join(' ') };
    expect(validateEpicSandboxGrantedScopes(token, configuredScopes, 'Observation'))
      .toEqual(grants);
    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: 'system/Observation.s' }, configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');

    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: 'system/Observation.r?category=http://terminology.hl7.org/CodeSystem/observation-category|vital-signs' },
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_REQUIRED_READ_SCOPE_MISSING');

    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: 'system/Patient.r system/Observation.r system/MedicationRequest.r' },
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');

    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: 'system/Patient.r system/Observation.r system/Observation.w' },
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');

    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: 'system/Observation.r system/Observation.r' },
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');

    expect(() => validateEpicSandboxGrantedScopes(
      { ...token, scope: undefined },
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT04_GRANTED_SCOPES_UNVERIFIED');

    expect(() => validateEpicSandboxGrantedScopes(
      {...token,scope:'system/Observation.r?category=https://malicious.test|vital-signs system/Observation.r'},
      configuredScopes, 'Observation'
    )).toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');
  });

  test('sends private-key JWT with pinned JKU; accepts only explicitly approved returned grants', async () => {
    let callCount = 0;
    const calledSecret: string[] = [];
    const broker = new SmartBackendTokenBroker({
      ...hosts, now: () => 1_800_000_000_000,
      getSecret: async (tenant, id, version) => {
        calledSecret.push(tenant + '/' + id + '/' + version);
        return pem;
      },
      fetchImpl: async (input, init) => {
        callCount++;
        expect(String(input)).toBe(EPIC_SANDBOX_TOKEN_URL);
        expect(init?.redirect).toBe('error');
        const body = new URLSearchParams(String(init?.body));
        expect(body.has('scope')).toBe(false);
        expect(body.get('grant_type')).toBe('client_credentials');
        const assertion = body.get('client_assertion')!;
        const [h, p, s] = assertion.split('.');
        const header = JSON.parse(Buffer.from(h, 'base64url').toString());
        const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
        expect(header).toEqual({alg:'RS384',typ:'JWT',kid:'synthetic-epic-key-1',jku:EPIC_SANDBOX_JWKS_URL});
        expect(payload.iss).toBe(source.oauth!.clientId);
        expect(payload.aud).toBe(source.oauth!.tokenUrl);
        expect(verify('RSA-SHA384',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')))
          .toBe(true);
        return new Response(JSON.stringify({
          access_token: 'synthetic-token-' + callCount,
          token_type: 'Bearer', expires_in: 600,
          scope: grants.join(' '),
        }), { status: 200 });
      },
    });

    const args = { source, tenantId: source.tenantId, sourceId: source.sourceId,
      resourceType: 'Observation' as const };
    const one = await broker.getAccessToken(args);
    const two = await broker.getAccessToken(args);
    expect(one).toBe(two);
    expect(callCount).toBe(1);
    expect(calledSecret).toEqual(['synthetic-hospital/epic-nonprod/1']);
    const rotated = await broker.getAccessToken({...args,
      source:{...source, oauth:{...source.oauth!, secretVersion:2,credentialRevision:2}}
    });
    expect(rotated).not.toBe(one);
    expect(callCount).toBe(2);
    expect(calledSecret[1]).toBe('synthetic-hospital/epic-nonprod/2');
  });

  test('fails closed on unapproved extra search scope issued by Epic', async () => {
    const broker = new SmartBackendTokenBroker({
      ...hosts, getSecret: async () => pem,
      fetchImpl: async () => new Response(JSON.stringify({
        access_token: 'synthetic-token-extra-rights',
        token_type: 'Bearer', expires_in: 600,
        scope: 'system/Observation.r system/Observation.s',
      }), { status: 200 }),
    });
    await expect(broker.getAccessToken({
      source, tenantId:source.tenantId,sourceId:source.sourceId,
      resourceType:'Observation',
    })).rejects.toThrow('CI_EXT06C_UNAPPROVED_EPIC_SCOPE');
  });
});
