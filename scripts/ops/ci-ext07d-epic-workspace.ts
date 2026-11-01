/**
 * CI-EXT-07D — Cloud Shell operator bootstrap for a dedicated synthetic
 * Epic integration tenant/facility.
 *
 * Usage:
 *   bun scripts/ops/ci-ext07d-epic-workspace.ts plan   # read-only
 *   bun scripts/ops/ci-ext07d-epic-workspace.ts create # explicit approval
 *
 * The only writes are THREE atomic create-if-absent Firestore documents:
 * tenant, synthetic facility, and immutable provisioning event. No auth
 * users, permissions, FHIR sources, keys or patient records are touched.
 */
import { execFileSync } from 'node:child_process';
import {
  EPIC_SYNTHETIC_PROJECT_ID as PROJECT,
  epicSyntheticWorkspacePaths,
  epicSyntheticWorkspaceMetadata,
} from '../../lib/interop/fhir-epic-synthetic-tenant';

type FieldValue = { stringValue?: string; booleanValue?: boolean };
type Document = { fields?: Record<string, FieldValue>; name?: string };
const paths = epicSyntheticWorkspacePaths();
const prefix = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function fail(code: string): never {
  throw new Error('CI_EXT07D_' + code);
}
function cli(args: readonly string[]): string {
  try {
    return execFileSync('gcloud', [...args], {
      encoding: 'utf8',
      timeout: 12_000,
      maxBuffer: 8_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fail('GCLOUD_IDENTITY_UNAVAILABLE');
  }
}
function allowedEnvironment(action: string): void {
  const e = process.env;
  if (!['plan', 'create'].includes(action) ||
      e.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      e.HELIXIS_CI_EXT07D_CONFIRM_PROJECT !== PROJECT ||
      e.FIRESTORE_EMULATOR_HOST || e.FIREBASE_AUTH_EMULATOR_HOST ||
      e.GOOGLE_APPLICATION_CREDENTIALS || e.VERCEL ||
      (e.FIREBASE_PROJECT_ID && e.FIREBASE_PROJECT_ID !== PROJECT) ||
      (e.NEXT_PUBLIC_FIREBASE_PROJECT_ID && e.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT) ||
      (e.GCLOUD_PROJECT && e.GCLOUD_PROJECT !== PROJECT) ||
      (e.DEVSHELL_PROJECT_ID && e.DEVSHELL_PROJECT_ID !== PROJECT) ||
      e.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED === 'true' ||
      (e.GHIMS_INTEGRATION_FHIR_R4_STATE &&
        e.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED')) {
    fail('STAGING_ENVIRONMENT_REQUIRED');
  }
  if (action === 'create' &&
      e.HELIXIS_CI_EXT07D_CONFIRM_CREATE !== 'CREATE_SYNTHETIC_EPIC_WORKSPACE') {
    fail('EXPLICIT_CREATE_APPROVAL_REQUIRED');
  }
}

async function request(
  url: string,
  token: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ status: number; result: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method,
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  // Limit even error bodies; never print them because they can contain metadata.
  const data = await response.arrayBuffer();
  if (data.byteLength > 100_000) fail('HTTP_RESPONSE_TOO_LARGE');
  if (response.status === 404 && method === 'GET') {
    return { status: 404, result: null };
  }
  if (!response.ok) fail('FIRESTORE_HTTP_' + response.status);
  try {
    return {
      status: response.status,
      result: data.byteLength ? JSON.parse(Buffer.from(data).toString('utf8')) : {},
    };
  } catch {
    return fail('FIRESTORE_RESPONSE_MALFORMED');
  }
}

function firestoreFields(data: Record<string, string | boolean>): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(data).map(([name, value]) =>
      [name, typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value }],
    ),
  );
}
function field(doc: Document, key: string): string | boolean | undefined {
  const f = doc.fields?.[key];
  return typeof f?.stringValue === 'string' ? f.stringValue :
    typeof f?.booleanValue === 'boolean' ? f.booleanValue : undefined;
}

async function confirmEmpty(token: string): Promise<'EMPTY'> {
  // Explicit GETs catch document collisions. listCollectionIds also guards
  // against resurrecting a tenant with orphaned subcollections.
  for (const path of [paths.tenant, paths.facility, paths.event]) {
    const row = await request(prefix + '/' + path, token, 'GET');
    if (row.result) fail('EXISTING_WORKSPACE_REQUIRES_REVIEW');
  }
  const listed = await request(prefix + '/' + paths.tenant + ':listCollectionIds',
    token, 'POST', { pageSize: 100 });
  if (Array.isArray(listed.result?.collectionIds) &&
      listed.result.collectionIds.length > 0) {
    fail('ORPHANED_TENANT_SUBCOLLECTIONS');
  }
  if (typeof listed.result?.nextPageToken === 'string' &&
      listed.result.nextPageToken.length) {
    fail('SUBCOLLECTION_SCAN_INCOMPLETE');
  }
  return 'EMPTY';
}
async function verifyCreated(token: string): Promise<void> {
  const [tenant, facility, event] = await Promise.all([
    request(prefix + '/' + paths.tenant, token, 'GET'),
    request(prefix + '/' + paths.facility, token, 'GET'),
    request(prefix + '/' + paths.event, token, 'GET'),
  ]);
  const t = tenant.result as Document | null;
  const f = facility.result as Document | null;
  const a = event.result as Document | null;
  if (!t || !f || !a ||
      field(t, 'syntheticOnly') !== true ||
      field(t, 'tenantKind') !== 'INTEGRATION_SANDBOX' ||
      field(t, 'clinicalImportsEnabled') !== false ||
      field(f, 'syntheticOnly') !== true ||
      field(f, 'status') !== 'ACTIVE' ||
      field(f, 'clinicalImportsEnabled') !== false ||
      field(a, 'immutable') !== true ||
      field(a, 'eventType') !== 'EPIC_SYNTHETIC_WORKSPACE_CREATED') {
    fail('POSTCREATE_VERIFICATION_FAILED');
  }
}

async function main(): Promise<void> {
  const action = (process.argv[2] ?? 'plan').trim();
  allowedEnvironment(action);
  if (cli(['config','get-value','project']) !== PROJECT) {
    fail('GCLOUD_PROJECT_MISMATCH');
  }
  const actor = cli(['config','get-value','account']);
  if (!actor || actor === '(unset)' || actor.includes('gserviceaccount.com')) {
    fail('HUMAN_OPERATOR_IDENTITY_REQUIRED');
  }
  const impersonated = cli(['config','get-value','auth/impersonate_service_account']);
  if (impersonated && impersonated !== '(unset)') {
    fail('IMPERSONATION_DISABLED_FOR_BOOTSTRAP');
  }
  const token = cli(['auth','print-access-token']);
  if (token.length < 16) fail('GCLOUD_TOKEN_MISSING');
  await confirmEmpty(token);
  console.log('CI_EXT07D_PROJECT=' + PROJECT);
  console.log('CI_EXT07D_TENANT=' + paths.tenant);
  console.log('CI_EXT07D_FACILITY=' + paths.facility);
  console.log('CI_EXT07D_COLLISIONS=NONE');
  if (action === 'plan') {
    console.log('CI_EXT07D_MODE=PLAN_ONLY');
    console.log('CI_EXT07D_FIRESTORE_WRITES=0');
    return;
  }
  const changeTicket = process.env.HELIXIS_CI_EXT07D_CHANGE_TICKET ?? '';
  const metadata = epicSyntheticWorkspaceMetadata({
    projectId: PROJECT,
    recordedAt: new Date().toISOString(),
    actorEmail: actor,
    changeTicket,
  });
  const documents: Array<readonly [string, Record<string, string | boolean>]> = [
    [paths.tenant, metadata.tenant],
    [paths.facility, metadata.facility],
    [paths.event, metadata.event],
  ];
  const writes = documents.map(([path, data]) => ({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/${path}`,
      fields: firestoreFields(data),
    },
    currentDocument: { exists: false },
  }));
  // ONE atomic commit. A concurrent operator or collision aborts all writes.
  const committed = await request(prefix + ':commit', token, 'POST', { writes });
  if (!Array.isArray(committed.result?.writeResults) ||
      committed.result.writeResults.length !== 3) {
    fail('COMMIT_RESULT_UNVERIFIED');
  }
  await verifyCreated(token);
  console.log('CI_EXT07D_WORKSPACE_CREATED=PASS');
  console.log('CI_EXT07D_ATOMIC_DOCUMENTS=3');
  console.log('CI_EXT07D_FHIR_SOURCE=NOT_CREATED');
  console.log('CI_EXT07D_IMPORT_ENABLED=NO');
}

main().catch(error => {
  // No raw REST, credentials or patient content printed.
  const code = error instanceof Error && /^CI_EXT07D_[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'CI_EXT07D_UNAVAILABLE';
  console.error(code);
  process.exitCode = 1;
});
