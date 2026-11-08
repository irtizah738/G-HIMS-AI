/**
 * Synthetic-only source/credential metadata fingerprint for G2 recovery review.
 *
 * NO OAuth token, secret value, network lookup, key material or PHI.
 * This is configuration-integrity binding, NOT vendor authenticity.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { FhirSourceRecord } from './external-fhir-import';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SHA256 = /^[0-9a-f]{64}$/;
function deny(): never {
  throw new Error('FHIR_G2_RECOVERY_CREDENTIAL_BINDING_INVALID');
}
function testGuard(): void {
  if (process.env.NODE_ENV !== 'test' ||
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('FHIR_G2_RECOVERY_BINDING_EMULATOR_ONLY');
  }
}
function strictHttps(value: string): string {
  if (typeof value !== 'string' || value.length > 2048 ||
      !value.startsWith('https://')) deny();
  let url: URL;
  try { url = new URL(value); } catch { deny(); }
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.port || url.hash || url.search ||
      url.toString() !== value ||
      host.endsWith('.') || host.length > 253 ||
      isIP(host) !== 0 || labels.length < 2 ||
      ['localhost','local','internal','lan','home.arpa']
        .some(suffix => host === suffix || host.endsWith('.' + suffix)) ||
      labels.some(label => label.length < 1 || label.length > 63 || !DNS_LABEL.test(label)) ||
      /^[0-9]+$/.test(labels[labels.length - 1])) deny();
  return value;
}

export function syntheticG2RecoveryCredentialBinding(
  source: FhirSourceRecord,
): string {
  testGuard();
  if (!source || !source.oauth || source.oauth.mode !== 'SMART_BACKEND' ||
      typeof source.tenantId !== 'string' ||
      typeof source.facilityId !== 'string' ||
      typeof source.sourceId !== 'string') deny();
  const oauth = source.oauth;
  if (!Number.isSafeInteger(oauth.credentialRevision) ||
      oauth.credentialRevision < 1 ||
      !Number.isSafeInteger(oauth.secretVersion) || oauth.secretVersion < 1 ||
      !oauth.clientId || typeof oauth.clientId !== 'string' ||
      oauth.clientId.length > 256 ||
      !oauth.keyId || typeof oauth.keyId !== 'string' ||
      oauth.keyId.length > 256 ||
      !Array.isArray(oauth.scopes) || !oauth.scopes.length ||
      oauth.scopes.length > 32 ||
      oauth.scopes.some(v => typeof v !== 'string' || !v.length ||
        v.length > 256 || /\s/.test(v)) ||
      new Set(oauth.scopes).size !== oauth.scopes.length) deny();
  const scopeSet = [...oauth.scopes].sort();
  const digest = createHash('sha256').update(JSON.stringify([
    'HELIXIS_G2_RECOVERY_BINDING_V1', source.tenantId,
    source.facilityId, source.sourceId,
    strictHttps(source.baseUrl), oauth.mode,
    oauth.clientId, strictHttps(oauth.tokenUrl),
    oauth.keyId, oauth.secretVersion, oauth.credentialRevision,
    scopeSet,
  ]), 'utf8').digest('hex');
  if (!SHA256.test(digest)) deny();
  return digest;
}
