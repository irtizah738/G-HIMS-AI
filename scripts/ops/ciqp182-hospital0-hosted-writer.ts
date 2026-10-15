/**
 * CIQP-182 — isolated staging synthetic-fixture population ONLY.
 * Separate from the emulator-only generator, read-only auditor and migration.
 *
 * Default DRY_RUN: reads only the pre-created tenant document and its
 * subcollection metadata. APPLY: explicitly approved, create-only operations
 * against the one exact tenant. No production, no tenant recreation, no delete,
 * no overwrites, no automatic retry or migration.
 */
import crypto from 'node:crypto';
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
    !env.GOOGLE_APPLICATION_CREDENTIALS &&
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
    env.FIREBASE_CLIENT_EMAIL === WRITER &&
    env.CIQP182_HOSPITAL0_WRITER_EMAIL === WRITER &&
    typeof env.FIREBASE_PRIVATE_KEY === 'string' &&
    env.FIREBASE_PRIVATE_KEY.includes('BEGIN') &&
    typeof env.CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY === 'string' &&
    Buffer.byteLength(env.CIQP182_HOSPITAL0_EVIDENCE_HMAC_KEY, 'utf8') >= 32;
  if (!valid) throw new Error('CIQP182_HOSPITAL0_STAGING_WRITER_SCOPE_DENIED');

  // A separate CI reviewer must have approved the source and ephemeral write
  // credential. A user declaration alone is not evidence of IAM effectiveness.
  if (mode === 'APPLY' && (
    env.CIQP182_HOSPITAL0_WRITE_ACK !== 'AUTHORIZE_CREATE_ONLY_SYNTHETIC_HOSPITAL0' ||
    env.CIQP182_HOSPITAL0_SOURCE_REVIEWED !== 'REVIEWED_EXACT_SOURCE' ||
    !/^[a-f0-9]{64}$/.test(env.CIQP182_HOSPITAL0_IAM_REVIEW_SHA256 || '') ||
    !/^[a-f0-9]{64}$/.test(env.CIQP182_HOSPITAL0_FIXTURE_REVIEW_SHA256 || '') ||
    env.CIQP182_HOSPITAL0_APPROVED_SHA !== sha
  )) throw new Error('CIQP182_HOSPITAL0_INDEPENDENT_WRITE_APPROVAL_REQUIRED');
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
  if (!db || db.projectId !== STAGING_PROJECT) {
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
  for (const col of collections) {
    const rows = await col.limit(1).get();
    if (!rows.empty) throw new Error('CIQP182_HOSPITAL0_EXISTING_TENANT_ROWS');
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
