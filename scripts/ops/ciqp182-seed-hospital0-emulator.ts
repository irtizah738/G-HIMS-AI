/**
 * CIQP-182 synthetic Patient 360 fixture: FIRESTORE EMULATOR ONLY.
 *
 * The hosted staging tenant ciqp-synthetic-hospital0 was created separately
 * by its operator. This fixture deliberately has no hosted provisioner.
 * Never retarget this script to hosted Firestore, production, or DEMO.
 */
import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';

export const CIQP182_FIXTURE_TENANT = 'ciqp-synthetic-hospital0';
export const CIQP182_FIXTURE_PATIENT = 'ciqp-fixture-patient-001';
export const CIQP182_FIXTURE_VERSION = 'CIQP182_HOSPITAL0_EMULATOR_V1';

export function assertCiqp182EmulatorOnly(env: NodeJS.ProcessEnv): void {
  if (env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      env.NODE_ENV === 'production' ||
      Boolean(env.VERCEL) ||
      env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      !/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(env.FIRESTORE_EMULATOR_HOST || '') ||
      Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) ||
      Boolean(env.FIREBASE_PRIVATE_KEY)) {
    throw new Error('CIQP182_FIXTURE_EMULATOR_ONLY_NO_HOSTED_FIRESTORE');
  }
}

/**
 * Generates synthetic canonical registration, event, audit, outbox and
 * revision-fenced Patient 360 timeline using the real application services.
 * Creates a single immutable synthetic evidence snapshot for lineage testing.
 * Outputs no patient profiles or identifiers. No automatic hosted apply.
 */
export async function seedCiqp182EmulatorFixture(): Promise<{
  fixtureVersion: typeof CIQP182_FIXTURE_VERSION;
  registeredPatients: 1;
  projectionCount: 1;
  eventCount: number;
  outboxCount: number;
  snapshotCount: 1;
  hostedWritesPerformed: false;
}> {
  assertCiqp182EmulatorOnly(process.env);
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP182_FIXTURE_EMULATOR_UNAVAILABLE');
  const tenant = db.collection('tenants').doc(CIQP182_FIXTURE_TENANT);
  // Never overwrite an existing tenant or source row, even in the emulator.
  await tenant.create({
    name: 'CIQP182 Synthetic Hospital 0',
    environment: 'STAGING',
    syntheticOnly: true,
    clinicalUseAllowed: false,
    provenanceStatus: 'PENDING_REVIEW',
    qualificationPurpose: 'CIQP182_PATIENT360',
    fixtureVersion: CIQP182_FIXTURE_VERSION,
  });
  const registration = await registerPatientAndEncounter({
    tenantId: CIQP182_FIXTURE_TENANT,
    patientId: CIQP182_FIXTURE_PATIENT,
    commandId: 'ciqp182-synthetic-register-' + crypto.randomUUID(),
    idempotencyKey: 'ciqp182-synthetic-idempotency-' + crypto.randomUUID(),
    fullName: 'Synthetic Patient Zero One',
    gender: 'other',
    dateOfBirth: '1981-01-01',
    identifiers: [{ type: 'CNIC', value: '99999000111', issuer: 'SYNTHETIC_FIXTURE' }],
    contactPhone: '+920000000000',
    address: 'Synthetic fixture, emulator only',
    encounterType: 'OPD',
    facilityId: 'ciqp-synthetic-facility',
    departmentId: 'general-medicine',
    actorId: 'ciqp-synthetic-receptionist',
    actorRole: 'RECEPTIONIST',
    actorName: 'Synthetic Receptionist',
  });
  if (!registration.success) throw new Error('CIQP182_FIXTURE_REGISTRATION_FAILED');
  const projection = await Patient360ProjectionService.rebuildPatient(
    CIQP182_FIXTURE_TENANT, CIQP182_FIXTURE_PATIENT
  );
  if (!projection.timelineReady || !projection.contentHash) {
    throw new Error('CIQP182_FIXTURE_TIMELINE_NOT_READY');
  }
  const snapshotId = 'ciqp182-synthetic-snapshot-001';
  await tenant.collection('clinicalIntelligenceEvidenceSnapshots').doc(snapshotId).create({
    snapshotId,
    tenantId: CIQP182_FIXTURE_TENANT,
    patientId: CIQP182_FIXTURE_PATIENT,
    immutable: true,
    snapshotHash: crypto.createHash('sha256')
      .update(projection.contentHash).digest('hex'),
    patient360SourceCheckpoint: projection.sourceCheckpoint,
    evidenceRefs: [{ sourceEventIds: [projection.eventCheckpoint?.eventId || 'registration'] }],
    source: 'CIQP182_EMULATOR_ONLY',
    syntheticOnly: true,
    fixtureVersion: CIQP182_FIXTURE_VERSION,
  });
  const [events, outbox, snapshots] = await Promise.all([
    tenant.collection('events').get(),
    tenant.collection('outbox').get(),
    tenant.collection('clinicalIntelligenceEvidenceSnapshots').get(),
  ]);
  if (events.empty || outbox.empty || snapshots.size !== 1) {
    throw new Error('CIQP182_FIXTURE_EVIDENCE_INCOMPLETE');
  }
  return {
    fixtureVersion: CIQP182_FIXTURE_VERSION,
    registeredPatients: 1,
    projectionCount: 1,
    eventCount: events.size,
    outboxCount: outbox.size,
    snapshotCount: 1,
    hostedWritesPerformed: false,
  };
}
