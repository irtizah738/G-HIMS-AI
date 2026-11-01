/**
 * CI-EXT-07 — read-only identification of a verified synthetic staging tenant.
 *
 * This operator utility never enumerates patients or clinical collections,
 * never obtains private keys, and never mutates Firestore or Secret Manager.
 * Uses the user's active gcloud identity; token is never printed.
 */
import { execFileSync } from 'node:child_process';
import { EPIC_STAGING_PROJECT_ID } from '../../lib/interop/fhir-epic-source-provision';

const ID = /^[A-Za-z0-9._-]{1,128}$/;
const tenantId = (process.env.HELIXIS_CI_EXT07_TENANT_ID ?? '').trim();
const project = EPIC_STAGING_PROJECT_ID;
function fail(code: string): never {
  throw new Error('CI_EXT07_' + code);
}
function gcloud(args: string[]): string {
  try {
    return execFileSync('gcloud', args, {
      encoding: 'utf8', timeout: 12_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10_000,
    }).trim();
  } catch {
    return fail('GCLOUD_AUTH_UNAVAILABLE');
  }
}
async function getJson(
  path: string,
  token: string,
  fieldPaths: readonly string[],
): Promise<Record<string, unknown>> {
  const endpoint = new URL(
    'https://firestore.googleapis.com/v1/projects/' +
    project + '/databases/(default)/documents/' + path
  );
  for (const field of fieldPaths) endpoint.searchParams.append('mask.fieldPaths', field);
  const response = await fetch(endpoint, {
    method: 'GET', redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) fail('FIRESTORE_METADATA_READ_DENIED');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 80_000) fail('METADATA_RESPONSE_TOO_LARGE');
  try {
    const decoded = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return fail('FIRESTORE_METADATA_MALFORMED');
    }
    return decoded as Record<string, unknown>;
  } catch {
    return fail('FIRESTORE_METADATA_MALFORMED');
  }
}
function fieldsOf(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
  const fields = (doc as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return fields as Record<string, unknown>;
}
function stringField(fields: Record<string, unknown>, key: string): string {
  const field = fields[key];
  const value = (field as { stringValue?: unknown } | null)?.stringValue;
  return typeof value === 'string' ? value : '';
}
function boolField(fields: Record<string, unknown>, key: string): boolean {
  const field = fields[key];
  return (field as { booleanValue?: unknown } | null)?.booleanValue === true;
}
function documentId(doc: unknown): string {
  const name = (doc as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') return '';
  const id = name.substring(name.lastIndexOf('/') + 1);
  return ID.test(id) && id !== '.' && id !== '..' ? id : '';
}

async function main(): Promise<void> {
  if (process.env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      process.env.HELIXIS_CI_EXT07_CONFIRM_PROJECT !== project ||
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.VERCEL ||
      !ID.test(tenantId) || tenantId === '.' || tenantId === '..' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED === 'true') {
    fail('READONLY_ENVIRONMENT_INVALID');
  }
  if (gcloud(['config', 'get-value', 'project']) !== project) {
    fail('GCLOUD_PROJECT_MISMATCH');
  }
  const token = gcloud(['auth', 'print-access-token']);
  if (!token || token.length < 16) fail('GCLOUD_AUTH_UNAVAILABLE');

  const tenantPath = 'tenants/' + encodeURIComponent(tenantId);
  const tenant = await getJson(tenantPath, token,
    ['tenantId', 'syntheticOnly', 'status']);
  const tenantFields = fieldsOf(tenant);
  const isSynthetic = boolField(tenantFields, 'syntheticOnly');
  console.log('CI_EXT07_TENANT_ID=' + tenantId);
  console.log('CI_EXT07_TENANT_SYNTHETIC_ONLY=' + (isSynthetic ? 'YES' : 'NO'));
  // A project labelled synthetic is not sufficient. The explicit tenant
  // marker must be present before any source registration.
  if (!isSynthetic) {
    console.log('CI_EXT07_ENROLLMENT=BLOCKED_TENANT_NOT_VERIFIED_SYNTHETIC');
    return;
  }

  const urlPath = tenantPath + '/facilities';
  const endpoint = new URL(
    'https://firestore.googleapis.com/v1/projects/' +
    project + '/databases/(default)/documents/' + urlPath
  );
  endpoint.searchParams.set('pageSize', '100');
  for (const f of ['tenantId','syntheticOnly','sandbox','status']) {
    endpoint.searchParams.append('mask.fieldPaths', f);
  }
  const response = await fetch(endpoint, {
    method: 'GET', redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) fail('FACILITY_METADATA_READ_DENIED');
  const body = await response.arrayBuffer();
  if (body.byteLength > 120_000) fail('FACILITY_METADATA_TOO_LARGE');
  let json: { documents?: unknown; nextPageToken?: unknown };
  try {
    json = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch { return fail('FACILITY_METADATA_INVALID'); }
  if (!Array.isArray(json.documents)) {
    console.log('CI_EXT07_ELIGIBLE_FACILITIES=NONE');
    return;
  }
  let count = 0;
  for (const doc of json.documents) {
    const fs = fieldsOf(doc);
    const id = documentId(doc);
    if (id && stringField(fs, 'tenantId') === tenantId &&
        (boolField(fs,'syntheticOnly') || boolField(fs,'sandbox'))) {
      console.log('CI_EXT07_ELIGIBLE_FACILITY_ID=' + id);
      count++;
    }
  }
  console.log('CI_EXT07_ELIGIBLE_FACILITY_COUNT=' + count);
  console.log('CI_EXT07_FACILITY_SCAN_COMPLETE=' +
    (json.nextPageToken ? 'NO' : 'YES'));
  console.log('CI_EXT07_ENROLLMENT=' +
    (count > 0 && !json.nextPageToken ? 'METADATA_ELIGIBLE_REVIEW_REQUIRED' :
      'BLOCKED_OR_INCOMPLETE'));
}

main().catch(error => {
  const code = error instanceof Error && /^CI_EXT07_[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'CI_EXT07_METADATA_READ_FAILED';
  console.error(code);
  process.exitCode = 1;
});
