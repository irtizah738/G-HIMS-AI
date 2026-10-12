/**
 * CIQP-05 / issue #182. A deliberately emulator-only qualification harness for
 * migrating legacy Patient 360 revision cursors polluted by unsigned AI events.
 *
 * Not a production migration utility: no hosted Firebase authority is granted.
 * Full canonical source collections and four patient event routes are read
 * within the same Firestore transaction as the projection CAS. A changed source
 * rejects migration, and only previously evidenced AI metadata counts may
 * lower an event cursor. The immutable event store is NEVER mutated.
 */
import crypto from 'node:crypto';
import type { Transaction, DocumentData, CollectionReference } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { isPatient360ClinicalSourceEvent } from './clinical-source-event-policy';
import { Patient360Projector, type Patient360ProjectionSources, type Patient360SourceEvent } from './patient360-projector';
import { Patient360ProjectionService } from './patient360-projection-service';
import type { Patient360Projection, Patient360TimelineItem } from '@/types/patient360-projection';
import type { PatientClinicalKnowledgeStatus } from '@/types/clinical-canonical';

export const PATIENT360_CLINICAL_POLICY_EPOCH = 2;
const MAX_SOURCE_ROWS = 500;
const MAX_TOTAL_ROWS = 1250;

export function assertEmulatorPolicyMigrationScope(env: NodeJS.ProcessEnv, tenantId: string): void {
  if (env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      env.NODE_ENV === 'production' ||
      !/^(localhost|127\\.0\\.0\\.1):[0-9]{2,5}$/.test(env.FIRESTORE_EMULATOR_HOST || '') ||
      env.GHIMS_CIQP_MIGRATION_ACK !== 'SYNTHETIC_EMULATOR_POLICY_MIGRATION_ONLY' ||
      env.GHIMS_CIQP_MIGRATION_TENANT_ID !== tenantId ||
      !/^[a-zA-Z0-9_-]{4,100}$/.test(tenantId)) {
    throw new Error('CIQP_POLICY_MIGRATION_EMULATOR_ONLY');
  }
}

function relatesToPatient(event: Patient360SourceEvent, patientId: string): boolean {
  return String(event.payload?.patientId || '') === patientId ||
    (String(event.aggregateType || '').toUpperCase().includes('PATIENT') &&
      String(event.aggregateId || '') === patientId);
}
function rawCursor(event: Patient360SourceEvent): number {
  return Number(event.recordedAt || event.occurredAt || 0);
}
function isCorroboratedLegacy(
  stored: Patient360Projection, canonical: Patient360Projection,
  raw: readonly Patient360SourceEvent[], patientId: string
): boolean {
  if (stored.tenantId !== canonical.tenantId || stored.patientId !== patientId ||
      Number(stored.projectionPolicyEpoch || 0) >= PATIENT360_CLINICAL_POLICY_EPOCH ||
      (stored.timelineGeneration && !stored.timelineReady) ||
      stored.revision <= canonical.revision) return false;
  const related = raw.filter(event => relatesToPatient(event, patientId));
  const clinical = related.filter(isPatient360ClinicalSourceEvent);
  const excluded = related.filter(event => !isPatient360ClinicalSourceEvent(event));
  if (!excluded.length || clinical.length !== canonical.revision ||
      related.length !== stored.revision) return false;
  const latest = [...related].sort((a, b) => rawCursor(b) - rawCursor(a) ||
    b.eventId.localeCompare(a.eventId))[0];
  return Boolean(latest && stored.eventCheckpoint?.eventId === latest.eventId &&
    Number(stored.eventCheckpoint.recordedAt) === rawCursor(latest) &&
    stored.sourceCheckpoint === `${rawCursor(latest)}:${latest.eventId}`);
}

type MigrationResult =
  | 'MIGRATED' | 'RESUMED' | 'ALREADY_CURRENT'
  | 'BLOCKED_UNCORROBORATED' | 'BLOCKED_SOURCE_CHANGED' | 'BLOCKED_CONCURRENT_WRITER';

/** Only exposes aggregate outcome; caller must not log patient details. */
export interface Patient360PolicyMigrationOutcome {
  status: MigrationResult;
  previousRevision?: number;
  currentRevision?: number;
  timelineRows?: number;
}

const CLINICAL_COLLECTIONS = {
  encounters: 'encounters',
  conditions: 'clinicalConditions',
  allergies: 'clinicalAllergies',
  medicationOrders: 'medicationOrders',
  observations: 'clinicalObservations',
  diagnosticOrders: 'canonicalDiagnosticOrders',
  diagnosticReports: 'diagnosticReports',
  procedures: 'clinicalProcedures',
  carePlans: 'carePlans',
  documents: 'clinicalDocuments',
  diseaseIntakeArtifacts: 'diseaseIntakeArtifacts',
} as const;

async function readCanonicalInTransaction(
  tx: Transaction,
  tenantRef: FirebaseFirestore.DocumentReference,
  patientId: string
): Promise<{ sources: Patient360ProjectionSources; raw: Patient360SourceEvent[] }> {
  // All transaction reads occur before any writes. Bounded queries fail
  // rather than silently losing late rows or old clinical facts.
  const patientSnap = await tx.get(tenantRef.collection('patients').doc(patientId));
  if (!patientSnap.exists) throw new Error('CIQP_MIGRATION_PATIENT_NOT_FOUND');

  let readRows = 0;
  const read = async (collection: CollectionReference<DocumentData>, field: string) => {
    const result = await tx.get(collection.where(field, '==', patientId).limit(MAX_SOURCE_ROWS + 1));
    if (result.size > MAX_SOURCE_ROWS) throw new Error('CIQP_MIGRATION_SOURCE_LIMIT');
    readRows += result.size;
    if (readRows > MAX_TOTAL_ROWS) throw new Error('CIQP_MIGRATION_TOTAL_SOURCE_LIMIT');
    return result.docs.map(doc => doc.data());
  };

  const clinical: Record<string, unknown[]> = {};
  for (const [key, collectionName] of Object.entries(CLINICAL_COLLECTIONS)) {
    clinical[key] = await read(tenantRef.collection(collectionName), 'patientId');
  }
  const knowledge = await read(tenantRef.collection('patientClinicalKnowledgeStatus'), 'patientId');
  if (knowledge.length > 3) throw new Error('CIQP_MIGRATION_KNOWLEDGE_AMBIGUOUS');
  const status: PatientClinicalKnowledgeStatus = {
    tenantId: tenantRef.id, patientId,
    allergyStatus: 'NOT_ASSESSED', medicationStatus: 'NOT_ASSESSED',
    problemListStatus: 'NOT_ASSESSED', updatedAt: 0,
  };
  for (const item of knowledge as Array<Record<string, any>>) {
    if (typeof item.reviewedAt !== 'number') throw new Error('CIQP_MIGRATION_KNOWLEDGE_INVALID');
    status.updatedAt = Math.max(status.updatedAt, item.reviewedAt);
    if (item.domain === 'ALLERGIES') {
      status.allergyStatus = item.status;
      status.lastAllergyReviewAt = item.reviewedAt;
    } else if (item.domain === 'MEDICATIONS') {
      status.medicationStatus = item.status;
      status.lastMedicationReconciliationAt = item.reviewedAt;
    } else if (item.domain === 'PROBLEM_LIST') {
      status.problemListStatus = item.status;
      status.lastProblemListReviewAt = item.reviewedAt;
    } else throw new Error('CIQP_MIGRATION_KNOWLEDGE_INVALID');
  }
  const eventsRef = tenantRef.collection('events');
  const eventFields = ['payload.patientId', 'payload.primaryPatientId',
    'payload.secondaryPatientId', 'aggregateId'];
  const byId = new Map<string, Patient360SourceEvent>();
  for (const field of eventFields) {
    for (const event of await read(eventsRef, field) as Patient360SourceEvent[]) {
      if (!event.eventId) throw new Error('CIQP_MIGRATION_EVENT_ID_REQUIRED');
      byId.set(event.eventId, event);
    }
  }
  const raw = [...byId.values()];
  const sources = {
    tenantId: tenantRef.id,
    patient: { id: patientId, patientId, ...(patientSnap.data() || {}) },
    ...clinical,
    events: raw.filter(isPatient360ClinicalSourceEvent),
    knowledgeStatus: status,
  } as unknown as Patient360ProjectionSources;
  return { sources, raw };
}

async function publishMigrationTimeline(
  tenantId: string, patientId: string,
  projection: Patient360Projection, timeline: Patient360TimelineItem[]
): Promise<boolean> {
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_MIGRATION_FIRESTORE_UNAVAILABLE');
  const tenantRef = db.collection('tenants').doc(tenantId);
  const ref = tenantRef.collection('patient360Projections').doc(patientId);
  const ledger = tenantRef.collection('patient360ProjectionPolicyMigrations').doc(patientId);
  const stillOwned = (current?: Patient360Projection) => Boolean(current &&
    current.tenantId === tenantId && current.patientId === patientId &&
    current.projectionPolicyEpoch === PATIENT360_CLINICAL_POLICY_EPOCH &&
    current.policyMigrationId === projection.policyMigrationId &&
    current.contentHash === projection.contentHash &&
    current.sourceFingerprint === projection.sourceFingerprint &&
    current.sourceCheckpoint === projection.sourceCheckpoint &&
    current.timelineGeneration === projection.contentHash);

  for (let offset = 0; offset < timeline.length; offset += 300) {
    const slice = timeline.slice(offset, offset + 300);
    const accepted = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!stillOwned(snap.data() as Patient360Projection | undefined)) return false;
      for (const row of slice) {
        if (row.tenantId !== tenantId || row.patientId !== patientId) {
          throw new Error('CIQP_MIGRATION_TIMELINE_SCOPE_MISMATCH');
        }
        tx.set(tenantRef.collection('patient360Timeline')
          .doc(`${patientId}__${projection.contentHash}__${row.eventId}`),
          sanitizeForFirestore({ ...row, timelineGeneration: projection.contentHash }));
      }
      return true;
    });
    if (!accepted) return false;
  }
  return db.runTransaction(async tx => {
    const [snap, ledgerSnap] = await Promise.all([tx.get(ref), tx.get(ledger)]);
    if (!stillOwned(snap.data() as Patient360Projection | undefined) ||
        ledgerSnap.data()?.migrationId !== projection.policyMigrationId) return false;
    tx.update(ref, { timelineReady: true });
    tx.update(ledger, { status: 'PUBLISHED', publishedAt: Date.now() });
    return true;
  });
}

/**
 * On synthetic emulator data only: policy-epoch CAS, immutable legacy
 * evidence ledger and resumable generation publication. An intervening
 * signed event or any other canonical fact invalidates the preflight hash.
 * Never authorize production by changing the environment variables alone.
 */
export async function migratePatient360LegacyPolicyEmulator(
  tenantId: string, patientId: string,
  hooks: { beforeTransaction?: () => Promise<void>; afterCommit?: () => Promise<void> } = {}
): Promise<Patient360PolicyMigrationOutcome> {
  assertEmulatorPolicyMigrationScope(process.env, tenantId);
  if (!/^[a-zA-Z0-9_-]{4,120}$/.test(patientId)) {
    throw new Error('CIQP_MIGRATION_INVALID_PATIENT_ID');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_MIGRATION_FIRESTORE_UNAVAILABLE');
  const tenantRef = db.collection('tenants').doc(tenantId);
  const projectionRef = tenantRef.collection('patient360Projections').doc(patientId);
  const ledgerRef = tenantRef.collection('patient360ProjectionPolicyMigrations').doc(patientId);
  const storedSnap = await projectionRef.get();
  if (!storedSnap.exists) return { status: 'BLOCKED_UNCORROBORATED' };
  const stored = storedSnap.data() as Patient360Projection;

  const [source, raw] = await Promise.all([
    Patient360ProjectionService.loadSources(tenantId, patientId),
    Patient360ProjectionService.loadPatientEvents(tenantId, patientId, { includeNonClinical: true }),
  ]);
  const preflight = Patient360Projector.project(source);
  const current = preflight.projection;

  if (stored.projectionPolicyEpoch === PATIENT360_CLINICAL_POLICY_EPOCH &&
      stored.contentHash === current.contentHash &&
      stored.sourceFingerprint === current.sourceFingerprint &&
      stored.sourceCheckpoint === current.sourceCheckpoint) {
    if (stored.timelineReady) return {
      status: 'ALREADY_CURRENT', previousRevision: stored.revision,
      currentRevision: current.revision, timelineRows: preflight.timeline.length,
    };
    // An interrupted transaction already stored the migration ledger.
    const ledgerSnap = await ledgerRef.get();
    if (!stored.policyMigrationId ||
        ledgerSnap.data()?.migrationId !== stored.policyMigrationId) {
      return { status: 'BLOCKED_UNCORROBORATED' };
    }
    const published = await publishMigrationTimeline(tenantId, patientId, stored, preflight.timeline);
    return { status: published ? 'RESUMED' : 'BLOCKED_CONCURRENT_WRITER',
      previousRevision: ledgerSnap.data()?.previousRevision,
      currentRevision: current.revision, timelineRows: published ? preflight.timeline.length : 0 };
  }

  if (!isCorroboratedLegacy(stored, current, raw, patientId)) {
    return { status: 'BLOCKED_UNCORROBORATED' };
  }
  if (hooks.beforeTransaction) await hooks.beforeTransaction();
  const migrationId = crypto.createHash('sha256').update(
    [tenantId, patientId, stored.contentHash, current.contentHash].join('|')
  ).digest('hex');
  const result = await db.runTransaction(async tx => {
    const activeSnap = await tx.get(projectionRef);
    const previousLedger = await tx.get(ledgerRef);
    const active = activeSnap.data() as Patient360Projection | undefined;
    if (!active || active.contentHash !== stored.contentHash ||
        active.sourceFingerprint !== stored.sourceFingerprint ||
        active.sourceCheckpoint !== stored.sourceCheckpoint ||
        active.revision !== stored.revision ||
        active.projectionPolicyEpoch !== stored.projectionPolicyEpoch ||
        active.timelineGeneration !== stored.timelineGeneration ||
        active.timelineReady !== stored.timelineReady || previousLedger.exists) {
      return 'BLOCKED_CONCURRENT_WRITER' as const;
    }

    const snapshot = await readCanonicalInTransaction(tx, tenantRef, patientId);
    const recomputed = Patient360Projector.project(snapshot.sources).projection;
    if (recomputed.contentHash !== current.contentHash ||
        recomputed.sourceFingerprint !== current.sourceFingerprint ||
        recomputed.sourceCheckpoint !== current.sourceCheckpoint ||
        !isCorroboratedLegacy(stored, recomputed, snapshot.raw, patientId)) {
      return 'BLOCKED_SOURCE_CHANGED' as const;
    }

    tx.create(ledgerRef, {
      migrationId, policyEpoch: PATIENT360_CLINICAL_POLICY_EPOCH,
      tenantId, patientId, status: 'PUBLISHING',
      priorRevision: stored.revision, priorSourceCheckpoint: stored.sourceCheckpoint,
      priorSourceFingerprint: stored.sourceFingerprint,
      priorContentHash: stored.contentHash,
      priorTimelineGeneration: stored.timelineGeneration || null,
      newRevision: current.revision, newSourceCheckpoint: current.sourceCheckpoint,
      newSourceFingerprint: current.sourceFingerprint, newContentHash: current.contentHash,
      createdAt: Date.now(),
    });
    tx.set(projectionRef, sanitizeForFirestore({
      ...current,
      projectionPolicyEpoch: PATIENT360_CLINICAL_POLICY_EPOCH,
      policyMigrationId: migrationId,
      timelineGeneration: current.contentHash,
      timelineReady: false,
    }));
    return 'APPLIED' as const;
  });

  if (result !== 'APPLIED') return { status: result };
  if (hooks.afterCommit) await hooks.afterCommit();
  const published = await publishMigrationTimeline(tenantId, patientId, {
    ...current, policyMigrationId: migrationId, projectionPolicyEpoch: PATIENT360_CLINICAL_POLICY_EPOCH,
  }, preflight.timeline);
  return { status: published ? 'MIGRATED' : 'BLOCKED_CONCURRENT_WRITER',
    previousRevision: stored.revision, currentRevision: current.revision,
    timelineRows: published ? preflight.timeline.length : 0 };
}
