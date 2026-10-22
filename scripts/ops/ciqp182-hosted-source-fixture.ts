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
import { getApp } from 'firebase-admin/app';
import { getAdminFirestore } from '@/server/firebase/admin';
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
      !env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('CIQP182_HOSTED_SOURCE_SCOPE_DENIED');
  }
  try {
    assertCiqp182SourceKeylessCredential(readCredential(env.GOOGLE_APPLICATION_CREDENTIALS));
  } catch {
    throw new Error('CIQP182_HOSTED_KEYLESS_CREDENTIAL_REQUIRED');
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

export async function runCiqp182HostedSourceFixture(): Promise<void> {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().toLowerCase();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (dirty.trim()) throw new Error('CIQP182_HOSTED_SOURCE_CHECKOUT_DIRTY');
  const mode = assertCiqp182HostedSourceScope(process.env, head);
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
