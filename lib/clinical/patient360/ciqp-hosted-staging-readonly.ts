/**
 * CIQP-05: isolated G-HIMS-AI hosted STAGING diagnostic, READ ONLY.
 *
 * This file has no migration/apply operation. The separate emulator migration
 * must never be retargeted at hosted Firestore. Use a staging-project scoped
 * read-only IAM identity; a synthetically named tenant is NOT proof of provenance.
 */
import { createHmac } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { Patient360Projector, type Patient360SourceEvent } from './patient360-projector';
import { Patient360ProjectionService } from './patient360-projection-service';
import {
  classifyPatient360PolicyInspection, patient360TimelineParity,
  type Patient360PolicyInspectionStatus,
} from './patient360-policy-inspection';
import type { Patient360Projection } from '@/types/patient360-projection';

const MAX_PATIENTS = 25;
const MAX_EVENTS_PER_ROUTE = 500;
const MAX_UNIQUE_EVENTS = 500;

export interface CiqpHostedStagingScope {
  projectId: string;
  tenantId: string;
  expectedSha: string;
}

/**
 * Check every named authority BEFORE initializing Firebase or making a query.
 * This cannot prove the dataset is synthetic: a separately authorized operator
 * must attest provenance and provide read-only credentials for this project.
 */
export function assertCiqpHostedStagingReadOnlyScope(
  env: NodeJS.ProcessEnv
): CiqpHostedStagingScope {
  const staging = String(env.GHIMS_FIREBASE_PROJECT_ID_STAGING || '').trim();
  const production = String(env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || '').trim();
  const actual = String(env.FIREBASE_PROJECT_ID || '').trim();
  const tenantId = String(env.GHIMS_CIQP_STAGING_TENANT_ID || '').trim();
  const sha = String(env.GHIMS_CIQP_STAGING_EXPECTED_SHA || '').trim();
  if (
    env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
    Boolean(env.VERCEL) ||
    Boolean(env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) ||
    !staging || !production || staging === production ||
    actual !== staging || staging === 'g-hims-ai' ||
    !/^[a-z][a-z0-9-]{4,62}$/.test(staging) ||
    !/^ciqp-synthetic-[a-z0-9-]{4,64}$/.test(tenantId) ||
    env.GHIMS_CIQP_STAGING_CONFIRM_PROJECT !== staging ||
    env.GHIMS_CIQP_STAGING_CONFIRM_TENANT !== tenantId ||
    env.GHIMS_CIQP_STAGING_DATA_ACK !== 'OPERATOR_ATTESTS_SYNTHETIC_ONLY' ||
    env.GHIMS_CIQP_STAGING_READONLY_ACK !== 'STAGING_READ_ONLY_NO_WRITES' ||
    !/^[a-f0-9]{40}$/i.test(sha) ||
    (Boolean(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) &&
      String(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).trim() !== staging)
  ) {
    throw new Error('CIQP_STAGING_READ_ONLY_SCOPE_DENIED');
  }
  return { projectId: staging, tenantId, expectedSha: sha.toLowerCase() };
}

/**
 * Separate authority for synthetic-only hosted STAGING writes. Environment
 * receipts are assertions, not independently verified sign-offs. An external
 * change review, synthetic provenance, independent restore evidence and
 * a staging-scoped writer identity are mandatory before this can be run.
 */
export function assertCiqpHostedStagingSyntheticApplyScope(
  env: NodeJS.ProcessEnv
): CiqpHostedStagingScope {
  const scope = assertCiqpHostedStagingReadOnlyScope(env);
  if (
    env.GHIMS_CIQP_STAGING_APPLY_ACK !== 'APPROVED_SYNTHETIC_STAGING_CAS_ONLY' ||
    env.GHIMS_CIQP_STAGING_APPLY_CONFIRM_PROJECT !== scope.projectId ||
    env.GHIMS_CIQP_STAGING_APPLY_CONFIRM_TENANT !== scope.tenantId ||
    env.GHIMS_CIQP_STAGING_APPLY_CONFIRM_SHA?.toLowerCase() !== scope.expectedSha ||
    !/^CIQP-182-[A-Z0-9-]{8,80}$/.test(env.GHIMS_CIQP_STAGING_CHANGE_TICKET || '') ||
    !/^RESTORE-[A-Z0-9-]{8,80}$/.test(env.GHIMS_CIQP_STAGING_RESTORE_TICKET || '') ||
    !/^[a-zA-Z0-9_.@-]{6,100}$/.test(env.GHIMS_CIQP_STAGING_OPERATOR_ID || '') ||
    !/^[a-f0-9]{64}$/i.test(env.GHIMS_CIQP_STAGING_SYNTHETIC_ATTESTATION_SHA256 || '')
  ) {
    throw new Error('CIQP_STAGING_SYNTHETIC_APPLY_NOT_AUTHORIZED');
  }
  return scope;
}

export function assertCiqpStagingCheckout(
  expectedSha: string, actualSha: string, gitPorcelain: string
): void {
  if (
    !/^[a-f0-9]{40}$/i.test(expectedSha) ||
    actualSha.trim().toLowerCase() !== expectedSha.toLowerCase() ||
    gitPorcelain.trim() !== ''
  ) {
    throw new Error('CIQP_STAGING_SOURCE_CHECKOUT_NOT_FROZEN');
  }
}

/** No PHI, patient IDs, source rows, per-patient hashes or error messages. */
export interface CiqpStagingReadOnlyReport {
  operation: 'CIQP_HOSTED_STAGING_READ_ONLY';
  expectedSourceSha: string;
  cohort: 'BOUNDED_OPERATOR_ATTESTED_SYNTHETIC';
  inspected: number;
  truncated: boolean;
  failures: number;
  classificationCounts: Partial<Record<Patient360PolicyInspectionStatus, number>>;
  aggregateHmac: string;
  writesPerformed: 0;
  migrationPerformed: false;
  provenance: 'OPERATOR_DECLARED_NOT_INDEPENDENTLY_VERIFIED';
  gate: 'COHORT_MATCHED_ONLY' | 'REVIEW_REQUIRED' | 'BLOCKED';
  releaseAuthorization: 'NOT_GRANTED';
}

function eventRelatesToPatient(event: Patient360SourceEvent, patientId: string): boolean {
  const p = event.payload || {};
  return p.patientId === patientId || p.primaryPatientId === patientId ||
    p.secondaryPatientId === patientId ||
    (['PATIENT', 'PATIENT_MPI'].includes(String(event.aggregateType || '').toUpperCase()) &&
      event.aggregateId === patientId);
}

/** Separate from the emulator-only canonical raw-event API; deliberately reads
 * hosted *staging* with a capped, read-only query and never returns identifiers
 * outside this process.
 */
export async function loadStagingRawPatientEvents(
  db: Firestore, scope: CiqpHostedStagingScope, patientId: string
): Promise<Patient360SourceEvent[]> {
  const events = db.collection('tenants').doc(scope.tenantId).collection('events');
  const routes = ['payload.patientId', 'payload.primaryPatientId',
    'payload.secondaryPatientId', 'aggregateId'] as const;
  const byId = new Map<string, Patient360SourceEvent>();
  for (const route of routes) {
    const snap = await events.where(route, '==', patientId)
      .limit(MAX_EVENTS_PER_ROUTE + 1).get();
    if (snap.size > MAX_EVENTS_PER_ROUTE) throw new Error('CIQP_STAGING_EVENT_ROUTE_TRUNCATED');
    for (const doc of snap.docs) {
      const event = doc.data() as Patient360SourceEvent & { tenantId?: string };
      if (!event.eventId || event.tenantId !== scope.tenantId ||
          !eventRelatesToPatient(event, patientId)) {
        throw new Error('CIQP_STAGING_RAW_EVENT_SCOPE_INVALID');
      }
      const prior = byId.get(event.eventId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(event)) {
        throw new Error('CIQP_STAGING_DUPLICATE_EVENT_ID');
      }
      byId.set(event.eventId, event);
      if (byId.size > MAX_UNIQUE_EVENTS) {
        throw new Error('CIQP_STAGING_EVENT_COHORT_LIMIT');
      }
    }
  }
  return [...byId.values()];
}

/**
 * Never calls Firestore setters, transactions, projection rebuilds, or hosted
 * migration. A project-restricted read-only IAM identity provides a second
 * independent no-write boundary.
 */
export async function inspectCiqpHostedStagingReadOnly(
  db: Firestore, scope: CiqpHostedStagingScope, hmacKey: string
): Promise<CiqpStagingReadOnlyReport> {
  if (Buffer.byteLength(hmacKey, 'utf8') < 32) {
    throw new Error('CIQP_STAGING_HMAC_KEY_REQUIRED');
  }
  const tenant = db.collection('tenants').doc(scope.tenantId);
  const snapshot = await tenant.collection('patient360Projections')
    .orderBy(FieldPath.documentId()).limit(MAX_PATIENTS + 1).get();
  // Fail closed: a zero-row cohort and a partial inventory are not evidence.
  const truncated = snapshot.size > MAX_PATIENTS;
  const digest = createHmac('sha256', hmacKey);
  digest.update(scope.expectedSha);
  const counts: Partial<Record<Patient360PolicyInspectionStatus, number>> = {};
  let failures = 0;
  if (!truncated) {
    for (const document of snapshot.docs) {
      const patientId = document.id;
      try {
        const stored = document.data() as Patient360Projection;
        if (stored.tenantId !== scope.tenantId || stored.patientId !== patientId) {
          throw new Error('CIQP_STAGING_PROJECTION_SCOPE_INVALID');
        }
        const [sources, raw] = await Promise.all([
          Patient360ProjectionService.loadSources(scope.tenantId, patientId),
          loadStagingRawPatientEvents(db, scope, patientId),
        ]);
        const canonical = Patient360Projector.project(sources);
        // A pending generation is blocked; never pretend its old rows are ready.
        const timelineMatches = stored.timelineGeneration && !stored.timelineReady
          ? undefined
          : patient360TimelineParity(
            await Patient360ProjectionService.getTimeline(
              scope.tenantId, patientId, 500, stored
            ),
            canonical.timeline
          );
        const status = classifyPatient360PolicyInspection({
          stored, canonical: canonical.projection, timelineMatches,
          rawEventTypes: raw.map(event => String(event.eventType || '')),
          exceededEventLimit: raw.length > MAX_UNIQUE_EVENTS,
        });
        counts[status] = (counts[status] || 0) + 1;
        digest.update(JSON.stringify([
          patientId, status, stored.revision, stored.sourceCheckpoint,
          stored.sourceFingerprint, stored.contentHash,
          canonical.projection.revision, canonical.projection.sourceCheckpoint,
          canonical.projection.sourceFingerprint, canonical.projection.contentHash,
        ]));
      } catch {
        // Errors may contain patient IDs or sensitive data: no details in output.
        failures += 1;
        digest.update('FAILED_CLOSED');
      }
    }
  }
  const inspected = truncated ? 0 : snapshot.size;
  const hasUnresolved = Object.keys(counts).some(key => key !== 'CURRENT_POLICY_MATCH');
  return {
    operation: 'CIQP_HOSTED_STAGING_READ_ONLY',
    expectedSourceSha: scope.expectedSha,
    cohort: 'BOUNDED_OPERATOR_ATTESTED_SYNTHETIC',
    inspected, truncated, failures,
    classificationCounts: counts,
    aggregateHmac: digest.digest('hex'),
    writesPerformed: 0,
    migrationPerformed: false,
    provenance: 'OPERATOR_DECLARED_NOT_INDEPENDENTLY_VERIFIED',
    gate: truncated || inspected === 0 || failures > 0
      ? 'BLOCKED' : hasUnresolved ? 'REVIEW_REQUIRED' : 'COHORT_MATCHED_ONLY',
    releaseAuthorization: 'NOT_GRANTED',
  };
}
