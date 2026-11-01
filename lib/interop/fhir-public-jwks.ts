/**
 * CI-EXT-06B — public (non-secret) JWK Set projection.
 *
 * Epic's backend client registry needs a stable public JKU. The source of
 * signing private keys remains source-scoped Google Secret Manager; this
 * code accepts and serves ONLY the public RSA JWK parameters.
 *
 * No service or endpoint here can create or register a private key.
 */
import { createPublicKey } from 'node:crypto';

export type PublicRsaJwk = {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS384';
  kid: string;
  n: string;
  e: string;
};
export type PublicFhirJwksRecord = {
  environment: 'STAGING' | 'PRODUCTION';
  status: 'PUBLISHED' | 'REVOKED';
  revision: number;
  publishedAt: number;
  expiresAt: number;
  publisherActorId: string;
  reviewerActorId: string;
  keys: PublicRsaJwk[];
};
const OPAQUE = /^[A-Za-z0-9_-]{24,64}$/;
const KID = /^[A-Za-z0-9._-]{1,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PUBLIC_FIELDS = ['alg', 'e', 'kid', 'kty', 'n', 'use'];

export function assertJwksId(id: string): string {
  if (!OPAQUE.test(id)) throw new Error('CI_EXT06B_JWKS_ID_INVALID');
  return id;
}
export function toPublicRsaJwk(privateKeyPem: string, kid: string): PublicRsaJwk {
  if (!KID.test(kid)) throw new Error('CI_EXT06B_KID_INVALID');
  let parsed: ReturnType<typeof createPublicKey>;
  try { parsed = createPublicKey(privateKeyPem); } catch {
    // This helper accepts public PEM for safe deployment manifest generation,
    // but actual operator key extraction must occur in the approved IAM runtime.
    throw new Error('CI_EXT06B_PUBLIC_KEY_INVALID');
  }
  if (parsed.asymmetricKeyType !== 'rsa' ||
      (parsed.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('CI_EXT06B_RSA_KEY_INSUFFICIENT');
  }
  const publicPart = parsed.export({ format: 'jwk' }) as JsonWebKey;
  if (!publicPart.n || !publicPart.e) throw new Error('CI_EXT06B_PUBLIC_KEY_INVALID');
  return { kty: 'RSA', use: 'sig', alg: 'RS384', kid,
    n: publicPart.n, e: publicPart.e };
}
/** Fails closed if a published object includes private JWK parameters. */
export function publicFhirJwks(
  record: unknown,
  environment: 'STAGING' | 'PRODUCTION',
  now: number
): { keys: PublicRsaJwk[] } {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('CI_EXT06B_JWKS_UNPUBLISHED');
  }
  const row = record as Partial<PublicFhirJwksRecord>;
  if (row.status !== 'PUBLISHED' || row.environment !== environment ||
      !Number.isSafeInteger(row.revision) || (row.revision || 0) < 1 ||
      !Number.isFinite(row.publishedAt) || !Number.isFinite(row.expiresAt) ||
      now < row.publishedAt! || now >= row.expiresAt! ||
      !KID.test(row.publisherActorId || '') ||
      !KID.test(row.reviewerActorId || '') ||
      row.publisherActorId === row.reviewerActorId ||
      !Array.isArray(row.keys) || row.keys.length < 1 || row.keys.length > 2) {
    throw new Error('CI_EXT06B_JWKS_UNPUBLISHED');
  }
  const ids = new Set<string>();
  for (const jwk of row.keys) {
    if (!jwk || typeof jwk !== 'object' ||
        Object.keys(jwk).sort().join(',') !== PUBLIC_FIELDS.join(',') ||
        jwk.kty !== 'RSA' || jwk.use !== 'sig' || jwk.alg !== 'RS384' ||
        !KID.test(jwk.kid) || ids.has(jwk.kid) ||
        !BASE64URL.test(jwk.n) || !BASE64URL.test(jwk.e)) {
      throw new Error('CI_EXT06B_INVALID_OR_PRIVATE_KEY');
    }
    let pub;
    try { pub = createPublicKey({key: jwk as JsonWebKey,format:'jwk'}); }
    catch { throw new Error('CI_EXT06B_PUBLIC_KEY_INVALID'); }
    if (pub.asymmetricKeyType !== 'rsa' ||
        (pub.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
      throw new Error('CI_EXT06B_RSA_KEY_INSUFFICIENT');
    }
    ids.add(jwk.kid);
  }
  return { keys: row.keys.map(k => ({
    kty: k.kty, use: k.use, alg: k.alg, kid: k.kid, n: k.n, e: k.e,
  })) };
}
