/**
 * CIQP-182 — isolated staging synthetic-fixture population ONLY.
 * Separate from the emulator-only generator, read-only auditor and migration.
 *
 * Default DRY_RUN: reads only the pre-created tenant document and its
 * subcollection metadata. Authentication uses keyless GitHub OIDC and WIF. APPLY: explicitly approved, create-once fixture
 * against the one exact tenant; canonical registration may update only its
 * newly created tenant-scoped idempotency state. No production, no tenant recreation, no delete,
 * no overwrites, no automatic retry or migration.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getApp } from 'firebase-admin/app';
import { execFileSync } from 'node:child_process';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { inspectCiqpSnapshotOutboxEvidence } from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';

const STAGING_PROJECT = 'studio-1130431360-48a05';
const TENANT = 'ciqp-synthetic-hospital0';
const WRITER = 'ciqp182-writer@studio-1130431360-48a05.iam.gserviceaccount.com';
const PATIENT = 'ciqp-fixture-patient-001';
const FIXTURE_VERSION = 'CIQP182_HOSPITAL0_HOSTED_SYNTHETIC_V1';
const METADATA = {
  clinicalUseAllowed: false,
  environment: 'STAGING',
  name: 'CIQP182 Synthetic Hospital 0',
  provenanceStatus: 'PENDING_REVIEW',
  qualificationPurpose: 'CIQP182_PATIENT360',
  syntheticOnly: true,
} as const;

/**
 * Authorize only GitHub OIDC -> Google Workload Identity Federation.
 * No exported service-account private key is accepted. The credential
 * configuration is non-secret, but the token is short-lived and validated by
 * Google against the provider's exact repository/ref/workflow conditions.
 */
export function isCiqp182ReviewedFederatedCredential(env: NodeJS.ProcessEnv): boolean {
  if (env.FIREBASE_PRIVATE_KEY || env.FIREBASE_CLIENT_EMAIL || env.client_email || env.private_key ||
      env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_REPOSITORY !== 'irtizah738/G-HIMS-OS' ||
      env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_WORKFLOW_REF !== 'irtizah738/G-HIMS-OS/.github/workflows/ciqp182-hospital0-create-synthetic-staging.yml@refs/heads/main' ||
      !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
      !env.GOOGLE_APPLICATION_CREDENTIALS ||
      !new RegExp('^projects/[0-9]+/locations/global/workloadIdentityPools/[a-z0-9-]+/providers/[a-z0-9-]+$').test(
        env.CIQP182_HOSPITAL0_WIF_PROVIDER || ''
      )) return false;
  try {
    const credentials = JSON.parse(
      readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
    ) as Record<string, unknown>;
    const expectedAudience = '//iam.googleapis.com/' + env.CIQP182_HOSPITAL0_WIF_PROVIDER;
    const endpoint = String(credentials.service_account_impersonation_url || '');
    return credentials.type === 'external_account' &&
      credentials.audience === expectedAudience &&
      endpoint.startsWith('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/') &&
      decodeURIComponent(endpoint).endsWith('/' + WRITER + ':generateAccessToken') &&
      credentials.subject_token_type === 'urn:ietf:params:oauth:token-type:jwt';
  } catch {
    return false;
  }
}

export type Ciqp182HostedWriteMode = 'DRY_RUN' | 'APPLY';

export function assertCiqp182HostedWriterScope(
  env: NodeJS.ProcessEnv,
  checkedOutSha: string
): Ciqp182HostedWriteMode {
  const mode = String(env.CIQP182_HOSPITAL0_WRITE_MODE || 'DRY_RUN');
  const sha = String(env.CIQP182_HOSPITAL0_SOURCE_SHA || '');
  const valid =
    (mode === 'DRY_RUN' || mode === 'APPLY') &&
    env.GHIMS_RUNTIME_MODE === 'STAGING' &&
    env.NODE_ENV !== 'production' &&
    !env.VERCEL && !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST &&
    isCiqp182ReviewedFederatedCredential(env) &&
    env.FIREBASE_PROJECT_ID === STAGING_PROJECT &&
    env.GHIMS_FIREBASE_PROJECT_ID_STAGING === STAGING_PROJECT &&
    env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION === 'g-hims-ai' &&
    env.FIRESTORE_DATABASE_ID === '(default)' &&
    (!env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === STAGING_PROJECT) &&
    env.GHIMS_CIQP_STAGING_TENANT_ID === TENANT &&
    env.CIQP182_HOSPITAL0_CONFIRM_PROJECT === STAGING_PROJECT &&
    env.CIQP182_HOSPITAL0_CONFIRM_TENANT === TENANT &&
    /^[0-9a-f]{40}$/.test(sha) && sha === checkedOutSha.trim().toLowerCase() &&
    env.CIQP182_HOSPITAL0_WRITER_EMAIL === WRITER &&
    typeof env.CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY === 'string' &&
    Buffer.byteLength(env.CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY, 'utf8') >= 32;
  if (!valid) throw new Error('CIQP182_HOSPITAL0_STAGING_WRITER_SCOPE_DENIED');

  // The owner recorded a limited synthetic-staging exception on G-HIMS AI
  // PR #203, issue comment 6193952944. This is NOT an independent review.
  // The IAM/fixture digests identify actual retained owner-reviewed evidence:
  // do not create dummy hashes or infer approval from a matching token.
  // APPLY is additionally subject to a separately authorized successful
  // live DRY_RUN and revocation of the temporary writer grant afterward.
  if (mode === 'APPLY' && (
    env.CIQP182_HOSPITAL0_WRITE_ACK !== 'AUTHORIZE_CREATE_ONLY_SYNTHETIC_HOSPITAL0' ||
    env.CIQP182_HOSPITAL0_SOURCE_REVIEWED !==
      'OWNER_EXCEPTION_SYNTHETIC_STAGING_ONLY' ||
    env.CIQP182_HOSPITAL0_OWNER_EXCEPTION_REF !==
      'https://github.com/irtizah738/G-HIMS-AI/pull/203#issuecomment-6193952944' ||
    !/^[a-f0-9]{64}$/.test(env.CIQP182_HOSPITAL0_IAM_REVIEW_SHA256 || '') ||
    !/^[a-f0-9]{64}$/.test(env.CIQP182_HOSPITAL0_FIXTURE_REVIEW_SHA256 || '') ||
    env.CIQP182_HOSPITAL0_APPROVED_SHA !== sha
  )) throw new Error('CIQP182_HOSPITAL0_OWNER_EXCEPTION_EVIDENCE_REQUIRED');
  return mode as Ciqp182HostedWriteMode;
}

export function matchesCiqp182HostedTenantMetadata(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const doc = data as Record<string, unknown>;
  const keys = Object.keys(METADATA).sort();
  return JSON.stringify(Object.keys(doc).sort()) === JSON.stringify(keys) &&
    keys.every(key => doc[key] === METADATA[key as keyof typeof METADATA]);
}

async function run(): Promise<void> {
  // Every approval check runs before any Firebase client initialisation.
  const head = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (dirty) throw new Error('CIQP182_HOSPITAL0_CHECKOUT_DIRTY');
  const mode = assertCiqp182HostedWriterScope(process.env, head);
  const db = getAdminFirestore();
  if (!db || getApp().options.projectId !== STAGING_PROJECT) {
    throw new Error('CIQP182_HOSPITAL0_FIRESTORE_PROJECT_NOT_CONFIRMED');
  }
  const tenant = db.collection('tenants').doc(TENANT);
  const existing = await tenant.get();
  if (!existing.exists || !matchesCiqp182HostedTenantMetadata(existing.data())) {
    throw new Error('CIQP182_HOSPITAL0_TENANT_METADATA_CHANGED_OR_MISSING');
  }
  // This is not a "reseed". Reject ANY existing tenant collection to avoid
  // overwriting, merging, or interfering with previously generated evidence.
  const collections = await tenant.listCollections();
  // Fail closed even if an existing collection currently has zero documents:
  // nested orphaned subcollections or prior partial setup require review.
  if (collections.length !== 0) {
    throw new Error('CIQP182_HOSPITAL0_EXISTING_TENANT_ROWS');
  }
  if (mode === 'DRY_RUN') {
    process.stdout.write(JSON.stringify({
      action: 'CIQP182_HOSPITAL0_STAGING_PREFLIGHT',
      candidateSha: head, qualifiedTenantMetadata: true,
      tenantCollectionsWithRows: 0, mode, writesPerformed: 0,
      releaseAuthorization: 'NOT_GRANTED',
    }) + '\n');
    return;
  }

  // No other tenant paths are accepted and no existing rows are overwritten.
  // A partial failure is preserved for independent review; reruns fail closed.
  const registered = await registerPatientAndEncounter({
    tenantId: TENANT,
    patientId: PATIENT,
    commandId: 'ciqp182-staging-register-' + crypto.randomUUID(),
    idempotencyKey: 'ciqp182-staging-idempotency-' + crypto.randomUUID(),
    fullName: 'Synthetic Patient Zero One',
    gender: 'other',
    dateOfBirth: '1981-01-01',
    identifiers: [{ type: 'CNIC', value: '99999000111', issuer: 'SYNTHETIC_FIXTURE' }],
    contactPhone: '+920000000000',
    address: 'Synthetic fixture, not a real hospital',
    encounterType: 'OPD',
    facilityId: 'ciqp-synthetic-facility',
    departmentId: 'general-medicine',
    actorId: 'ciqp-synthetic-receptionist',
    actorRole: 'RECEPTIONIST',
    actorName: 'Synthetic Receptionist',
  });
  if (!registered.success) throw new Error('CIQP182_HOSPITAL0_REGISTRATION_FAILED');
  const projection = await Patient360ProjectionService.rebuildPatient(TENANT, PATIENT);
  if (!projection.timelineReady || !projection.contentHash) {
    throw new Error('CIQP182_HOSPITAL0_TIMELINE_NOT_READY');
  }
  const snapshotId = 'ciqp182-synthetic-snapshot-001';
  await tenant.collection('clinicalIntelligenceEvidenceSnapshots').doc(snapshotId).create({
    snapshotId, tenantId: TENANT, patientId: PATIENT,
    immutable: true,
    snapshotHash: crypto.createHash('sha256').update(projection.contentHash).digest('hex'),
    patient360SourceCheckpoint: projection.sourceCheckpoint,
    evidenceRefs: [{ sourceEventIds: [projection.eventCheckpoint?.eventId || 'registration'] }],
    source: 'CIQP182_AUTHORIZED_SYNTHETIC_STAGING',
    syntheticOnly: true, fixtureVersion: FIXTURE_VERSION,
  });
  const audit = await inspectCiqpSnapshotOutboxEvidence(
    db, TENANT, process.env.CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY!
  );
  if (audit.snapshotCount !== 1 || audit.outboxCount < 1 || audit.writesPerformed !== 0) {
    throw new Error('CIQP182_HOSPITAL0_EVIDENCE_PARITY_BLOCKED');
  }
  // Do not print synthetic identities, names, document paths, credentials
  // or unreviewed clinical data. Counts are not a migration approval.
  process.stdout.write(JSON.stringify({
    action: 'CIQP182_HOSPITAL0_SYNTHETIC_CREATED',
    candidateSha: head, fixtureVersion: FIXTURE_VERSION,
    fictionalPatientsCreated: 1, patient360ProjectionCreated: 1,
    evidenceSnapshotsCreated: audit.snapshotCount, outboxRows: audit.outboxCount,
    provenanceStatus: 'PENDING_INDEPENDENT_REVIEW',
    releaseAuthorization: 'NOT_GRANTED',
    productionWritesPerformed: 0,
  }) + '\n');
}

if (import.meta.main) {
  run().catch(() => {
    // Deliberately hides Firestore exception details and all data identifiers.
    console.error('CIQP182_HOSPITAL0_STAGING_WRITER_BLOCKED_REVIEW_REQUIRED');
    process.exitCode = 1;
  });
}
