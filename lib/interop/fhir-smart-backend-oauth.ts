/**
 * CI-EXT-04 — SMART Backend Services, asymmetric JWT client authentication.
 * No tokens, private keys or client assertions are stored in Firestore.
 *
 * Caller MUST first verify authoritative identity + the registered source.
 * The returned bearer token never leaves server memory and cannot be selected
 * by a browser. This profile intentionally supports system/*.rs scopes ONLY
 * for the three currently qualified read-only FHIR resource types.
 */
import { createHash, createPrivateKey, randomUUID, sign as signJwt } from 'node:crypto';
import type { FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';

export type SmartBackendConfig = {
  mode: 'SMART_BACKEND';
  clientId: string;
  tokenUrl: string;
  keyId: string;
  secretVersion: number;
  credentialRevision: number;
  scopes: string[];
};
export type SmartSecretAccessor = (tenantId: string, sourceId: string, version: number) => Promise<string>;
export type SmartTokenResponse = { access_token: string; token_type: string; expires_in: number; scope?: string };
type CacheRow = { value: string; expiresAt: number };
const ALLOWED_SCOPES = new Set([
  'system/Patient.rs', 'system/Encounter.rs', 'system/Observation.rs',
]);
const cache = new Map<string, CacheRow>();
const inFlight = new Map<string, Promise<string>>();
const MAX_TOKEN_RESPONSE = 16_384;

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
function canonicalHost(urlString: string, hosts: readonly string[], code: string): string {
  let url: URL;
  try { url = new URL(urlString); } catch { throw new Error(code); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || !url.hostname || url.port ||
      !hosts.map(s => s.toLowerCase()).includes(url.hostname.toLowerCase())) {
    throw new Error(code);
  }
  return url.toString();
}
export function checkSmartBackendSource(
  source: FhirSourceRecord,
  tenantId: string,
  sourceId: string,
  options: { allowedTokenHosts: readonly string[]; allowedFhirHosts: readonly string[] }
): SmartBackendConfig {
  if (source.tenantId !== tenantId || source.sourceId !== sourceId ||
      source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED') {
    throw new Error('CI_EXT04_SOURCE_NOT_AUTHORIZED');
  }
  if (source.approvedResourceTypes.some(t => !['Patient','Encounter','Observation'].includes(t))) {
    throw new Error('CI_EXT04_RESOURCE_ALLOWLIST_INVALID');
  }
  canonicalHost(source.baseUrl, options.allowedFhirHosts, 'CI_EXT04_FHIR_ORIGIN_DENIED');
  const config = (source as FhirSourceRecord & { oauth?: SmartBackendConfig }).oauth;
  if (!config || config.mode !== 'SMART_BACKEND' ||
      !/^[A-Za-z0-9:_./-]{3,200}$/.test(config.clientId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(config.keyId) ||
      !Number.isSafeInteger(config.secretVersion) || config.secretVersion < 1 ||
      !Number.isSafeInteger(config.credentialRevision) || config.credentialRevision < 1 ||
      !Array.isArray(config.scopes) || !config.scopes.length ||
      new Set(config.scopes).size !== config.scopes.length ||
      config.scopes.some(s => !ALLOWED_SCOPES.has(s))) {
    throw new Error('CI_EXT04_OAUTH_CONFIGURATION_INVALID');
  }
  canonicalHost(config.tokenUrl, options.allowedTokenHosts, 'CI_EXT04_TOKEN_ORIGIN_DENIED');
  return config;
}

export function makeSmartClientAssertion(args: {
  clientId: string; keyId: string; tokenUrl: string; privateKeyPem: string;
  nowSeconds: number; nonce?: string;
}): string {
  const { clientId, keyId, tokenUrl, privateKeyPem, nowSeconds } = args;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('CI_EXT04_CLOCK_INVALID');
  }
  const nonce = args.nonce || randomUUID();
  const header = { alg: 'RS384', typ: 'JWT', kid: keyId };
  const payload = {
    iss: clientId, sub: clientId, aud: tokenUrl,
    iat: nowSeconds, exp: nowSeconds + 300, jti: nonce,
  };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = encode(header) + '.' + encode(payload);
  let key;
  try { key = createPrivateKey(privateKeyPem); } catch {
    throw new Error('CI_EXT04_PRIVATE_KEY_INVALID');
  }
  if (key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('CI_EXT04_RSA_KEY_INSUFFICIENT');
  }
  const signature = signJwt('RSA-SHA384', Buffer.from(body), key).toString('base64url');
  return body + '.' + signature;
}
export function validateSmartTokenResponse(value: unknown, allowedScopes: readonly string[]): SmartTokenResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CI_EXT04_TOKEN_RESPONSE_INVALID');
  }
  const v = value as Partial<SmartTokenResponse>;
  if (typeof v.access_token !== 'string' || v.access_token.length < 8 ||
      v.access_token.length > 8192 || /[\r\n]/.test(v.access_token) ||
      v.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(v.expires_in) || !Number.isSafeInteger(v.expires_in) ||
      v.expires_in! < 60 || v.expires_in! > 86400) {
    throw new Error('CI_EXT04_TOKEN_RESPONSE_INVALID');
  }
  if (typeof v.scope !== 'string' || !v.scope.trim()) {
    // Without an explicit returned grant we cannot verify allowed rights.
    throw new Error('CI_EXT04_GRANTED_SCOPES_UNVERIFIED');
  }
  const granted = v.scope.split(/\s+/).filter(Boolean);
  if (new Set(granted).size !== granted.length ||
      granted.some(s => !allowedScopes.includes(s)) ||
      allowedScopes.some(s => !granted.includes(s))) {
    throw new Error('CI_EXT04_GRANTED_SCOPES_MISMATCH');
  }
  return v as SmartTokenResponse;
}

export class SmartBackendTokenBroker {
  constructor(private readonly dependencies: {
    getSecret: SmartSecretAccessor;
    fetchImpl?: typeof fetch;
    now?: () => number;
    allowedTokenHosts: readonly string[];
    allowedFhirHosts: readonly string[];
  }) {}

  async getAccessToken(args: {
    source: FhirSourceRecord; tenantId: string; sourceId: string;
    resourceType: 'Patient' | 'Encounter' | 'Observation';
  }): Promise<string> {
    const { tenantId, sourceId, source, resourceType } = args;
    const config = checkSmartBackendSource(source, tenantId, sourceId, this.dependencies);
    const requiredScope = 'system/' + resourceType + '.rs';
    if (!source.approvedResourceTypes.includes(resourceType) || !config.scopes.includes(requiredScope)) {
      throw new Error('CI_EXT04_RESOURCE_SCOPE_DENIED');
    }
    const fetchImpl = this.dependencies.fetchImpl || fetch;
    const now = this.dependencies.now || Date.now;
    // Credentials and grants are bound to the exact source + configuration
    // revision; no token can cross a tenant, source or key-rotation boundary.
    const cacheKey = sha(JSON.stringify([
      tenantId, sourceId, config.clientId, config.tokenUrl,
      config.keyId, config.secretVersion, config.credentialRevision,
      [...config.scopes].sort(), requiredScope,
    ]));
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now() + 30_000) return cached.value;
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
    const request = (async () => {
      const pem = await this.dependencies.getSecret(tenantId, sourceId, config.secretVersion);
      const assertion = makeSmartClientAssertion({
        clientId: config.clientId, keyId: config.keyId,
        tokenUrl: config.tokenUrl, privateKeyPem: pem,
        nowSeconds: Math.floor(now() / 1000),
      });
      const requestBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: requiredScope,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetchImpl(config.tokenUrl, {
          method: 'POST', redirect: 'error',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Cache-Control': 'no-store',
          },
          body: requestBody,
        });
        if (!response.ok) throw new Error('CI_EXT04_TOKEN_ENDPOINT_REJECTED');
        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > MAX_TOKEN_RESPONSE) {
          throw new Error('CI_EXT04_TOKEN_RESPONSE_TOO_LARGE');
        }
        let payload: unknown;
        try { payload = JSON.parse(body); } catch { throw new Error('CI_EXT04_TOKEN_JSON_INVALID'); }
        const granted = validateSmartTokenResponse(payload, [requiredScope]);
        const expiresAt = now() + granted.expires_in * 1000;
        const ttl = Math.min(60_000, Math.max(0, expiresAt - now() - 60_000));
        if (ttl > 0) cache.set(cacheKey, { value: granted.access_token, expiresAt: now() + ttl });
        return granted.access_token;
      } finally {
        clearTimeout(timeout);
      }
    })();
    inFlight.set(cacheKey, request);
    try { return await request; } finally { inFlight.delete(cacheKey); }
  }
}
