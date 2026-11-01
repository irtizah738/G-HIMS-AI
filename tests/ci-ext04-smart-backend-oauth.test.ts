import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify as verifyJwt } from 'node:crypto';
import {
  checkSmartBackendSource,
  makeSmartClientAssertion,
  SmartBackendTokenBroker,
  validateSmartTokenResponse,
} from '@/lib/interop/fhir-smart-backend-oauth';
import { smartSecretResource } from '@/lib/interop/fhir-smart-secret-manager';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const source: FhirSourceRecord = {
  tenantId: 'hospital-a', sourceId: 'ehr-one',
  facilityId: 'facility-1',
  baseUrl: 'https://fhir.sandbox.example.test/r4',
  status: 'ACTIVE', securityReviewStatus: 'APPROVED',
  approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
  oauth: {
    mode: 'SMART_BACKEND',
    clientId: 'helixis-backend-hospital-a',
    tokenUrl: 'https://auth.sandbox.example.test/oauth/token',
    keyId: 'key-2026-1',
    secretVersion: 2,
    credentialRevision: 1,
    scopes: ['system/Patient.rs', 'system/Encounter.rs', 'system/Observation.rs'],
  },
};
const allowedHosts = {
  allowedFhirHosts: ['fhir.sandbox.example.test'],
  allowedTokenHosts: ['auth.sandbox.example.test'],
};
describe('CI-EXT-04 asymmetric tenant-scoped SMART Backend OAuth', () => {
  test('signs RS384 one-time assertion with exact audience and verified key', () => {
    const assertion = makeSmartClientAssertion({
      clientId: source.oauth!.clientId, tokenUrl: source.oauth!.tokenUrl,
      keyId: source.oauth!.keyId, privateKeyPem: pem,
      nowSeconds: 1_800_000_000, nonce: 'one-time-assertion-1',
    });
    const [a, b, signature] = assertion.split('.');
    expect(verifyJwt('RSA-SHA384', Buffer.from(a + '.' + b), publicKey,
      Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(a, 'base64url').toString()).alg).toBe('RS384');
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    expect(payload.aud).toBe(source.oauth!.tokenUrl);
    expect(payload.iss).toBe(source.oauth!.clientId);
    expect(payload.sub).toBe(source.oauth!.clientId);
    expect(payload.exp - payload.iat).toBe(300);
    expect(payload.jti).toBe('one-time-assertion-1');
  });
  test('fails closed for unapproved origins, source mismatch and wildcard scope', () => {
    expect(checkSmartBackendSource(source, 'hospital-a', 'ehr-one', allowedHosts).mode)
      .toBe('SMART_BACKEND');
    expect(() => checkSmartBackendSource(source, 'hospital-b', 'ehr-one', allowedHosts))
      .toThrow('CI_EXT04_SOURCE_NOT_AUTHORIZED');
    expect(() => checkSmartBackendSource({ ...source, baseUrl: 'https://evil.example.test/fhir' },
      'hospital-a', 'ehr-one', allowedHosts)).toThrow('CI_EXT04_FHIR_ORIGIN_DENIED');
    expect(() => checkSmartBackendSource({ ...source, oauth: { ...source.oauth!,
      tokenUrl: 'http://127.0.0.1/oauth/token' } },
      'hospital-a', 'ehr-one', allowedHosts)).toThrow('CI_EXT04_TOKEN_ORIGIN_DENIED');
    expect(() => checkSmartBackendSource({ ...source, oauth: { ...source.oauth!,
      scopes: ['system/*.rs'] } },
      'hospital-a', 'ehr-one', allowedHosts)).toThrow('CI_EXT04_OAUTH_CONFIGURATION_INVALID');
    expect(() => checkSmartBackendSource({ ...source, oauth: { ...source.oauth!,
      scopes: ['system/Observation.rs', 'system/Observation.rs'] } },
      'hospital-a', 'ehr-one', allowedHosts)).toThrow('CI_EXT04_OAUTH_CONFIGURATION_INVALID');
  });
  test('rejects token privilege widening and absent returned scope', () => {
    const token = { access_token: 'synthetic-secret-token', token_type: 'Bearer',
      expires_in: 600, scope: 'system/Observation.rs' };
    expect(validateSmartTokenResponse(token, ['system/Observation.rs']).scope).toBe('system/Observation.rs');
    expect(() => validateSmartTokenResponse({ ...token, scope: 'system/*.rs' },
      ['system/Observation.rs'])).toThrow('CI_EXT04_GRANTED_SCOPES_MISMATCH');
    expect(() => validateSmartTokenResponse({ ...token, scope: undefined },
      ['system/Observation.rs'])).toThrow('CI_EXT04_GRANTED_SCOPES_UNVERIFIED');
  });
  test('deterministic, tenant-isolated Secret Manager lookup disallows arbitrary resource names', () => {
    const a=smartSecretResource({
      projectId: 'helixis-synthetic-ci', tenantId: 'hospital-a', sourceId: 'ehr-one', version: 2,
    });
    const b=smartSecretResource({
      projectId: 'helixis-synthetic-ci', tenantId: 'hospital-b', sourceId: 'ehr-one', version: 2,
    });
    expect(a === b).toBe(false);
    expect(a.startsWith('projects/helixis-synthetic-ci/secrets/helixis-fhir-')).toBe(true);
    expect(() => smartSecretResource({
      projectId: 'helixis-synthetic-ci', tenantId: '..', sourceId: 'ehr-one', version: 2,
    })).toThrow('CI_EXT04_SECRET_SCOPE_INVALID');
  });
  test('requests only resource-granted scope and never reuses a rotated credential', async () => {
    const calls: Array<{ scope: string; tokenUrl: string; authAssertion: string }> = [];
    const secretRequests: Array<string> = [];
    const now = () => 1_800_000_000_000;
    const broker = new SmartBackendTokenBroker({
      ...allowedHosts, now,
      getSecret: async (tenant, id, version) => {
        secretRequests.push(tenant + '/' + id + '/' + version);
        return pem;
      },
      fetchImpl: async (input, init) => {
        const body = new URLSearchParams(String(init?.body || ''));
        calls.push({
          scope: body.get('scope') || '',
          tokenUrl: String(input),
          authAssertion: body.get('client_assertion') || '',
        });
        if (init?.redirect !== 'error' || body.get('grant_type') !== 'client_credentials') {
          throw new Error('UNSAFE_OAUTH_REQUEST');
        }
        return new Response(JSON.stringify({
          access_token: 'synthetic-token-' + calls.length,
          token_type: 'Bearer', expires_in: 600, scope: body.get('scope'),
        }), { status: 200 });
      },
    });
    const args = {
      source, tenantId: source.tenantId, sourceId: source.sourceId,
      resourceType: 'Observation' as const,
    };
    const first = await broker.getAccessToken(args);
    const second = await broker.getAccessToken(args);
    expect(first).toBe(second);
    expect(calls.length).toBe(1);
    expect(calls[0].scope).toBe('system/Observation.rs');
    expect(calls[0].tokenUrl).toBe(source.oauth!.tokenUrl);
    expect(secretRequests).toEqual(['hospital-a/ehr-one/2']);
    const rotated = await broker.getAccessToken({
      ...args, source: { ...source, oauth: {
        ...source.oauth!, secretVersion: 3, credentialRevision: 2,
      } },
    });
    expect(rotated === first).toBe(false);
    expect(calls.length).toBe(2);
    expect(secretRequests).toEqual(['hospital-a/ehr-one/2','hospital-a/ehr-one/3']);
    await expect(broker.getAccessToken({ ...args, resourceType: 'DiagnosticReport' as 'Observation' }))
      .rejects.toThrow('CI_EXT04_RESOURCE_SCOPE_DENIED');
  });
});
