/**
 * CIQP-182 isolated G-HIMS-AI synthetic hosted Patient360 fixture.
 *
 * Creates a single fictional patient using canonical registration, projection
 * and evidence-snapshot services. Never migrate existing clinical revisions.
 * No permission to deploy, touch G-HIMS-OS staging or access production.
 *
 * Default DRY_RUN: source tenant metadata + subcollection census ONLY.
 * APPLY requires independently retained approvals, exact SHA, keyless
 * impersonation and create-once execution claim. Failure is NOT retried.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getApp, type Credential } from 'firebase-admin/app';
import {
  getAdminFirestore, activateCiqp182SyntheticHostedSourceCredential,
  activateCiqp182SyntheticHostedSourceFirestore,
} from '@/server/firebase/admin';
import { ciqp182HostedSourceFirestoreClient } from './ciqp182-hosted-firestore-client';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { inspectCiqpSnapshotOutboxEvidence } from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';
import { fingerprintCiqpImmutableTenant } from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';
import { inspectCiqpHostedStagingReadOnly } from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';

export const CIQP182_SOURCE_PROJECT = 'ciqp-ghims-source-20261022';
export const CIQP182_RESTORE_PROJECT = 'ciqp-ghims-restore-20261022';
export const CIQP182_TENANT = 'ciqp-synthetic-hospital0';
export const CIQP182_WRITER = 'ciqp182-synthetic-writer@' + CIQP182_SOURCE_PROJECT + '.iam.gserviceaccount.com';
const PATIENT = 'ciqp-fixture-patient-001';
const FIXTURE_VERSION = 'CIQP182_HOSTED_GHIMS_AI_SYNTHETIC_V1';
const EXPECTED_METADATA = {
  name: 'CIQP182 Synthetic Hospital 0',
  environment: 'STAGING',
  syntheticOnly: true,
  clinicalUseAllowed: false,
  provenanceStatus: 'PENDING_REVIEW',
  qualificationPurpose: 'CIQP182_PATIENT360',
};
type Mode = 'DRY_RUN' | 'APPLY';
type CredentialJson = Record<string, unknown>;

export function matchesCiqp182SourceTenant(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  const expected = EXPECTED_METADATA as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  return JSON.stringify(Object.keys(document).sort()) === JSON.stringify(keys) &&
    keys.every(key => document[key] === expected[key]);
}

/** No service-account JSON key or unrestricted user credential is admissible. */
export function assertCiqp182SourceKeylessCredential(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
  }
  const cfg = value as CredentialJson;
  const url = String(cfg.service_account_impersonation_url || '');
  const expectedUrl = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
    CIQP182_WRITER + ':generateAccessToken';
  let decoded = '';
  try { decoded = decodeURIComponent(url); } catch {
    throw new Error('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
  }
  const src = cfg.source_credentials;
  if (cfg.type !== 'impersonated_service_account' ||
      decoded !== expectedUrl ||
      !src || typeof src !== 'object' || Array.isArray(src) ||
      (src as CredentialJson).type !== 'authorized_user' ||
      Object.hasOwn(cfg, 'private_key') ||
      Object.hasOwn(cfg, 'client_email')) {
    throw new Error('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
  }
}

export function assertCiqp182HostedSourceScope(
  env: NodeJS.ProcessEnv, exactHead: string,
  readCredential: (path: string) => unknown = path => JSON.parse(readFileSync(path, 'utf8'))
): Mode {
  const mode = String(env.CIQP182_HOSTED_SOURCE_MODE || 'DRY_RUN');
  const authMode = String(env.CIQP182_HOSTED_SOURCE_AUTH_MODE || 'ADC');
  // The same short-lived source identity can power either mode, but the
  // hosted APPLY path needs the additional independent approvals below.
  const cliReadOnly = authMode === 'GCLOUD_IMPERSONATION';
  const cliApply = authMode === 'GCLOUD_IMPERSONATION_APPLY';
  const supportedCredential = cliReadOnly
    ? mode === 'DRY_RUN' && !env.GOOGLE_APPLICATION_CREDENTIALS
    : cliApply
      ? mode === 'APPLY' && !env.GOOGLE_APPLICATION_CREDENTIALS
      : authMode === 'ADC' && Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
  // Identity checks happen before reading credential file or initializing SDK.
  if (!['DRY_RUN', 'APPLY'].includes(mode) ||
      env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.NODE_ENV === 'production' ||
      Boolean(env.VERCEL) || Boolean(env.GITHUB_ACTIONS) ||
      Boolean(env.FIRESTORE_EMULATOR_HOST) || Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) ||
      Boolean(env.FIREBASE_PRIVATE_KEY) || Boolean(env.FIREBASE_CLIENT_EMAIL) ||
      Boolean(env.private_key) || Boolean(env.client_email) ||
      env.FIREBASE_PROJECT_ID !== CIQP182_SOURCE_PROJECT ||
      env.FIRESTORE_DATABASE_ID !== '(default)' ||
      env.GHIMS_FIREBASE_PROJECT_ID_STAGING !== CIQP182_SOURCE_PROJECT ||
      env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION !== 'g-hims-ai' ||
      (Boolean(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) &&
        env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== CIQP182_SOURCE_PROJECT) ||
      env.GHIMS_CIQP_STAGING_TENANT_ID !== CIQP182_TENANT ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_PROJECT !== CIQP182_SOURCE_PROJECT ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_TENANT !== CIQP182_TENANT ||
      env.CIQP182_HOSTED_SOURCE_WRITER_EMAIL !== CIQP182_WRITER ||
      env.CIQP182_HOSTED_SOURCE_SYNTHETIC_ACK !== 'FICTIONAL_DATA_ONLY' ||
      !/^[0-9a-f]{40}$/i.test(exactHead) ||
      env.CIQP182_HOSTED_SOURCE_EXPECTED_SHA !== exactHead ||
      !supportedCredential) {
    throw new Error('CIQP182_HOSTED_SOURCE_SCOPE_DENIED');
  }
  if (!cliReadOnly && !cliApply) {
    try {
      assertCiqp182SourceKeylessCredential(readCredential(env.GOOGLE_APPLICATION_CREDENTIALS!));
    } catch {
      throw new Error('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
    }
  }

  if (mode === 'APPLY' && (
      env.CIQP182_HOSTED_SOURCE_APPLY_ACK !== 'CREATE_ONE_SYNTHETIC_PATIENT_ONCE' ||
      env.CIQP182_HOSTED_SOURCE_APPLY_CONFIRM_SHA !== exactHead ||
      !/^CIQP-182-[A-Z0-9-]{8,60}$/.test(env.CIQP182_HOSTED_SOURCE_CHANGE_TICKET || '') ||
      !/^[a-zA-Z0-9_.@-]{6,100}$/.test(env.CIQP182_HOSTED_SOURCE_OPERATOR_ID || '') ||
      !/^[0-9a-f]{64}$/i.test(env.CIQP182_HOSTED_SOURCE_IAM_RECEIPT_SHA256 || '') ||
      !/^[0-9a-f]{64}$/i.test(env.CIQP182_HOSTED_SOURCE_PROVENANCE_SHA256 || '') ||
      Buffer.byteLength(env.CIQP182_HOSTED_SOURCE_EVIDENCE_HMAC_KEY || '', 'utf8') < 32
  )) throw new Error('CIQP182_HOSTED_SOURCE_APPLY_APPROVAL_MISSING');

  // Tokens, digest strings and user acknowledgements are not independent
  // evidence. Operators must verify source/IAM receipts out of band.
  return mode as Mode;
}

/**
 * Cloud Shell's gcloud identity uses existing CLI authentication to issue a
 * SHORT-LIVED impersonated token. This path deliberately has no persisted ADC
 * refresh token, Firebase SDK initialization, exports, imports or document writes.
 */
export function matchesCiqp182HostedRestTenant(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = (value as Record<string, unknown>).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
  const expected: Record<string, unknown> = {
    name: { stringValue: 'CIQP182 Synthetic Hospital 0' },
    environment: { stringValue: 'STAGING' },
    syntheticOnly: { booleanValue: true },
    clinicalUseAllowed: { booleanValue: false },
    provenanceStatus: { stringValue: 'PENDING_REVIEW' },
    qualificationPurpose: { stringValue: 'CIQP182_PATIENT360' },
  };
  const actual = fields as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(keys) &&
    keys.every(key => JSON.stringify(actual[key]) === JSON.stringify(expected[key]));
}

export function isCiqp182EmptyCollectionInventory(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return Object.keys(result).every(
      key => key === 'collectionIds' || key === 'nextPageToken') &&
    (!Object.hasOwn(result, 'collectionIds') ||
      (Array.isArray(result.collectionIds) && result.collectionIds.length === 0)) &&
    (!Object.hasOwn(result, 'nextPageToken') || result.nextPageToken === '');
}

/**
 * Mint ONLY a short-lived token for the exact synthetic-source identity.
 * No refresh tokens, private keys or access tokens are persisted or logged.
 */
export function mintCiqp182HostedSourceToken(): string {
  const token = execFileSync('gcloud', [
    'auth', 'print-access-token',
    '--impersonate-service-account=' + CIQP182_WRITER,
    '--project=' + CIQP182_SOURCE_PROJECT,
    '--billing-project=' + CIQP182_SOURCE_PROJECT,
    '--lifetime=900',
    '--quiet',
  ], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!token || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new Error('CIQP182_HOSTED_SOURCE_IMPERSONATION_FAILED');
  }
  return token;
}

/** Firebase Admin Credential; token always comes from the exact CLI identity. */
export function ciqp182HostedSourceGcloudCredential(): Credential {
  return {
    async getAccessToken() {
      return {
        access_token: mintCiqp182HostedSourceToken(),
        expires_in: 900,
      };
    },
  };
}

async function inspectCiqp182HostedSourceViaGcloud(
  emitReport = true, enforceRestoreDeny = false
): Promise<void> {
  const token = mintCiqp182HostedSourceToken();
  const resource = 'projects/' + CIQP182_SOURCE_PROJECT +
    '/databases/(default)/documents/tenants/' + CIQP182_TENANT;
  const endpoint = 'https://firestore.googleapis.com/v1/projects/' +
    CIQP182_SOURCE_PROJECT + '/databases/%28default%29/documents/tenants/' +
    CIQP182_TENANT;
  const headers = {
    Authorization: 'Bearer ' + token,
    'x-goog-user-project': CIQP182_SOURCE_PROJECT,
  };
  const metadata = await fetch(endpoint, {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (metadata.status !== 200) throw new Error('CIQP182_HOSTED_SOURCE_READ_DENIED');
  const document: unknown = await metadata.json();
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      (document as Record<string, unknown>).name !== resource ||
      !matchesCiqp182HostedRestTenant(document)) {
    throw new Error('CIQP182_HOSTED_SOURCE_TENANT_METADATA_INVALID');
  }
  const inventory = await fetch(endpoint + ':listCollectionIds', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageSize: 100 }),
  });
  if (inventory.status !== 200) {
    throw new Error('CIQP182_HOSTED_SOURCE_COLLECTION_SCAN_DENIED');
  }
  const collections: unknown = await inventory.json();
  if (!isCiqp182EmptyCollectionInventory(collections)) {
    throw new Error('CIQP182_HOSTED_SOURCE_NOT_EMPTY_NO_RETRY');
  }
  if (enforceRestoreDeny) {
    const denied = await fetch(
      'https://firestore.googleapis.com/v1/projects/' +
      CIQP182_RESTORE_PROJECT +
      '/databases/%28default%29/documents:listCollectionIds', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageSize: 100 }),
      }
    );
    if (denied.status !== 403) {
      throw new Error('CIQP182_HOSTED_RESTORE_WRITER_ISOLATION_FAILED');
    }
  }
  if (!emitReport) return;
  console.log(JSON.stringify({
    action: 'CIQP182_HOSTED_SOURCE_DRY_RUN',
    sourceTenantMetadata: 'MATCHED',
    nestedCollections: 0,
    writesPerformed: 0,
    releaseAuthorization: 'NOT_GRANTED',
    authentication: 'KEYLESS_GCLOUD_IMPERSONATION_NO_ADC',
  }));
}

export async function runCiqp182HostedSourceFixture(): Promise<void> {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().toLowerCase();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (dirty.trim()) throw new Error('CIQP182_HOSTED_SOURCE_CHECKOUT_DIRTY');
  const mode = assertCiqp182HostedSourceScope(process.env, head);
  if (mode === 'DRY_RUN' &&
      process.env.CIQP182_HOSTED_SOURCE_AUTH_MODE === 'GCLOUD_IMPERSONATION') {
    await inspectCiqp182HostedSourceViaGcloud();
    return;
  }
  if (mode === 'APPLY' &&
      process.env.CIQP182_HOSTED_SOURCE_AUTH_MODE === 'GCLOUD_IMPERSONATION_APPLY') {
    // The independent approval gate ran above, before any SDK initialization.
    // Check current source data and restore denial without mutating either.
    await inspectCiqp182HostedSourceViaGcloud(false, true);
    activateCiqp182SyntheticHostedSourceCredential(
      ciqp182HostedSourceGcloudCredential()
    );
    activateCiqp182SyntheticHostedSourceFirestore(
      ciqp182HostedSourceFirestoreClient()
    );
  }
  const db = getAdminFirestore();
  if (!db || getApp().options.projectId !== CIQP182_SOURCE_PROJECT) {
    throw new Error('CIQP182_HOSTED_SOURCE_PROJECT_UNVERIFIED');
  }
  const tenant = db.collection('tenants').doc(CIQP182_TENANT);
  const existing = await tenant.get();
  if (!existing.exists || !matchesCiqp182SourceTenant(existing.data())) {
    throw new Error('CIQP182_HOSTED_SOURCE_TENANT_METADATA_INVALID');
  }
  const collections = await tenant.listCollections();
  if (collections.length !== 0) {
    throw new Error('CIQP182_HOSTED_SOURCE_NOT_EMPTY_NO_RETRY');
  }
  if (mode === 'DRY_RUN') {
    console.log(JSON.stringify({
      action: 'CIQP182_HOSTED_SOURCE_DRY_RUN',
      sourceTenantMetadata: 'MATCHED',
      nestedCollections: 0,
      writesPerformed: 0,
      releaseAuthorization: 'NOT_GRANTED',
    }));
    return;
  }

  // Atomic create-only claim prevents concurrent and repeated APPLY.
  // An interrupted attempt remains blocked for independent investigation.
  await tenant.collection('ciqpQualificationRuns').doc('one-time-20261022').create({
    fixtureVersion: FIXTURE_VERSION,
    exactHead: head,
    syntheticOnly: true,
    state: 'STARTED_NO_AUTO_RETRY',
    createdAt: Date.now(),
  });
  const registered = await registerPatientAndEncounter({
    tenantId: CIQP182_TENANT,
    patientId: PATIENT,
    commandId: 'ciqp182-hosted-register-' + randomUUID(),
    idempotencyKey: 'ciqp182-hosted-' + randomUUID(),
    fullName: 'Synthetic Patient Zero One',
    gender: 'other',
    dateOfBirth: '1981-01-01',
    identifiers: [{ type: 'CNIC', value: '99999000111', issuer: 'SYNTHETIC_FIXTURE' }],
    contactPhone: '+920000000000',
    address: 'Fictional synthetic fixture, never a clinical location',
    encounterType: 'OPD',
    facilityId: 'ciqp-synthetic-facility',
    departmentId: 'general-medicine',
    actorId: 'ciqp-synthetic-receptionist',
    actorRole: 'RECEPTIONIST',
    actorName: 'Synthetic Receptionist',
  });
  if (!registered.success) throw new Error('CIQP182_HOSTED_SOURCE_REGISTRATION_FAILED');

  const projection = await Patient360ProjectionService.rebuildPatient(CIQP182_TENANT, PATIENT);
  if (!projection.timelineReady || !projection.contentHash) {
    throw new Error('CIQP182_HOSTED_SOURCE_PROJECTION_FAILED');
  }
  await tenant.collection('clinicalIntelligenceEvidenceSnapshots')
    .doc('ciqp182-synthetic-snapshot-001').create({
      snapshotId: 'ciqp182-synthetic-snapshot-001',
      tenantId: CIQP182_TENANT, patientId: PATIENT,
      immutable: true, syntheticOnly: true, fixtureVersion: FIXTURE_VERSION,
      snapshotHash: createHash('sha256').update(projection.contentHash).digest('hex'),
      patient360SourceCheckpoint: projection.sourceCheckpoint,
      evidenceRefs: [{
        sourceEventIds: [projection.eventCheckpoint?.eventId || 'registration'],
      }],
      source: 'CIQP182_GHIMS_AI_HOSTED_SYNTHETIC_ONLY',
    });

  const hmacKey = process.env.CIQP182_HOSTED_SOURCE_EVIDENCE_HMAC_KEY!;
  const [immutable, lineage, scan] = await Promise.all([
    fingerprintCiqpImmutableTenant(db, CIQP182_TENANT, hmacKey),
    inspectCiqpSnapshotOutboxEvidence(db, CIQP182_TENANT, hmacKey),
    inspectCiqpHostedStagingReadOnly(db, {
      projectId: CIQP182_SOURCE_PROJECT, tenantId: CIQP182_TENANT,
      expectedSha: head,
    }, hmacKey),
  ]);
  if (lineage.snapshotCount !== 1 ||
      immutable.eventCount < 1 || immutable.outboxCount < 1 ||
      lineage.outboxCount !== immutable.outboxCount ||
      scan.gate !== 'COHORT_MATCHED_ONLY' ||
      scan.cohortCoverage !== 'MATCHED' ||
      scan.inspected !== 1 || scan.failures !== 0) {
    throw new Error('CIQP182_HOSTED_SOURCE_EVIDENCE_FAIL_CLOSED');
  }
  console.log(JSON.stringify({
    action: 'CIQP182_HOSTED_SOURCE_FIXTURE_CREATED',
    fictionalPatientsCreated: 1, patient360ProjectionCount: 1,
    immutableEvents: immutable.eventCount, outboxRows: immutable.outboxCount,
    evidenceSnapshots: lineage.snapshotCount,
    provenanceStatus: 'PENDING_INDEPENDENT_REVIEW',
    restoreQualification: 'NOT_PERFORMED',
    releaseAuthorization: 'NOT_GRANTED',
  }));
}

if (import.meta.main) {
  runCiqp182HostedSourceFixture().catch(() => {
    // Never print Firestore SDK exceptions, patient identifiers or credentials.
    console.error('CIQP182_HOSTED_SOURCE_FIXTURE_STOP_REVIEW_REQUIRED');
    process.exitCode = 1;
  });
}
