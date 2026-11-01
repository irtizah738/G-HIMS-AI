import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import {
  assertJwksId, publicFhirJwks, toPublicRsaJwk,
  type PublicFhirJwksRecord,
} from '@/lib/interop/fhir-public-jwks';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const kid = 'synthetic-epic-rs384-2026';
const publicJwk = toPublicRsaJwk(pem, kid);
const now = 1_800_000_000_000;
const record: PublicFhirJwksRecord = {
  environment: 'STAGING', status: 'PUBLISHED',
  revision: 1, publishedAt: now - 60_000, expiresAt: now + 86400_000,
  publisherActorId: 'staging-publisher',
  reviewerActorId: 'independent-security-reviewer',
  keys: [publicJwk],
};

describe('CI-EXT-06B vendor JKU public key publication', () => {
  test('exports only the signing public key, compatible with private key', () => {
    expect(publicJwk.kty).toBe('RSA');
    expect(publicJwk.alg).toBe('RS384');
    expect(publicJwk.kid).toBe(kid);
    expect(publicJwk.use).toBe('sig');
    expect(Object.keys(publicJwk).sort()).toEqual(['alg','e','kid','kty','n','use']);
    expect(createPublicKey({key: publicJwk,format:'jwk'}).export({
      format:'der',type:'spki',
    })).toEqual(publicKey.export({format:'der',type:'spki'}));
    expect(JSON.stringify(publicJwk).includes('PRIVATE KEY')).toBe(false);
    expect(JSON.stringify(publicJwk).includes(pem)).toBe(false);
  });
  test('published JKU requires independent reviewer and valid environment', () => {
    const result=publicFhirJwks(record,'STAGING',now);
    expect(result.keys).toEqual([publicJwk]);
    expect(Object.keys(result)).toEqual(['keys']);
    expect(() => publicFhirJwks(record,'PRODUCTION',now))
      .toThrow('CI_EXT06B_JWKS_UNPUBLISHED');
    expect(() => publicFhirJwks({
      ...record, reviewerActorId: record.publisherActorId,
    },'STAGING',now)).toThrow('CI_EXT06B_JWKS_UNPUBLISHED');
    expect(() => publicFhirJwks({
      ...record, status: 'REVOKED',
    },'STAGING',now)).toThrow('CI_EXT06B_JWKS_UNPUBLISHED');
    expect(() => publicFhirJwks(record,'STAGING',now+86400_000))
      .toThrow('CI_EXT06B_JWKS_UNPUBLISHED');
  });
  test('never returns private JWK parameters or extra fields from registry', () => {
    expect(() => publicFhirJwks({
      ...record, keys:[{...publicJwk,d:'SENSITIVE_NOT_PUBLIC'}],
    },'STAGING',now)).toThrow('CI_EXT06B_INVALID_OR_PRIVATE_KEY');
    expect(() => publicFhirJwks({
      ...record, keys:[publicJwk,publicJwk],
    },'STAGING',now)).toThrow('CI_EXT06B_INVALID_OR_PRIVATE_KEY');
    expect(() => publicFhirJwks({
      ...record, keys:[{...publicJwk,n:'abcd'}],
    },'STAGING',now)).toThrow();
  });
  test('rejects weak public key and untrusted identifier paths', () => {
    const weak=generateKeyPairSync('rsa',{modulusLength:1024});
    expect(() => toPublicRsaJwk(weak.publicKey.export({
      format:'pem',type:'spki',
    }).toString(),'weak-key')).toThrow('CI_EXT06B_RSA_KEY_INSUFFICIENT');
    expect(() => assertJwksId('..')).toThrow('CI_EXT06B_JWKS_ID_INVALID');
    expect(() => assertJwksId('../source')).toThrow('CI_EXT06B_JWKS_ID_INVALID');
    expect(assertJwksId('ss6xewY2VniKUot_D5OkG4')).toBe('ss6xewY2VniKUot_D5OkG4');
  });
});
