/**
 * CIQP-05 read-only legacy Patient 360 inspection (Firestore emulator only).
 *
 * Set GHIMS_RUNTIME_MODE=TEST, FIRESTORE_EMULATOR_HOST, and
 * GHIMS_CIQP_READ_ONLY_ACK=INSPECT_EMULATOR_NO_WRITES, plus
 * GHIMS_CIQP_INSPECT_TENANT_ID. Prints aggregate counts only: no PHI/IDs.
 *
 * This is NOT a migration or a production readiness attestation.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/server/firebase/admin';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { classifyPatient360PolicyInspection, patient360TimelineParity } from '@/lib/clinical/patient360/patient360-policy-inspection';
import type { Patient360Projection } from '@/types/patient360-projection';

const MAX_PATIENTS = 25;
const MAX_RAW_EVENTS = 2000;

export function assertEmulatorInspectionScope(env: NodeJS.ProcessEnv): string {
  if (
    env.GHIMS_RUNTIME_MODE !== 'TEST' ||
    !/^(localhost|127\\.0\\.0\\.1):[0-9]{2,5}$/.test(env.FIRESTORE_EMULATOR_HOST || '') ||
    env.NODE_ENV === 'production' ||
    env.GHIMS_CIQP_READ_ONLY_ACK !== 'INSPECT_EMULATOR_NO_WRITES'
  ) {
    throw new Error('CIQP_INSPECTION_EMULATOR_ONLY');
  }
  const tenant = String(env.GHIMS_CIQP_INSPECT_TENANT_ID || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(tenant)) {
    throw new Error('CIQP_INSPECTION_TENANT_REQUIRED');
  }
  return tenant;
}

async function run() {
  const tenantId = assertEmulatorInspectionScope(process.env);
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_INSPECTION_FIRESTORE_UNAVAILABLE');

  const tenantRef = db.collection('tenants').doc(tenantId);
  const projections = await tenantRef
    .collection('patient360Projections')
    .orderBy(FieldPath.documentId())
    .limit(MAX_PATIENTS + 1)
    .get();
  const documents = projections.docs.slice(0, MAX_PATIENTS);
  const statuses: Record<string, number> = {};
  let failures = 0;

  for (const doc of documents) {
    try {
      const stored = doc.data() as Patient360Projection;
      if (stored.tenantId !== tenantId || stored.patientId !== doc.id) {
        throw new Error('CIQP_INSPECTION_PROJECTION_SCOPE_MISMATCH');
      }
      const [sources, rawEvents] = await Promise.all([
        Patient360ProjectionService.loadSources(tenantId, doc.id),
        // Use the exact four patient-event query scopes employed by the
        // canonical projector: patientId, primaryPatientId,
        // secondaryPatientId and patient aggregateId. Reading only
        // payload.patientId silently misses legacy metadata evidence.
        Patient360ProjectionService.loadPatientEvents(tenantId, doc.id, {
          includeNonClinical: true,
        }),
      ]);

      const canonical = Patient360Projector.project(sources);
      // Published timelines are independently checked against the canonical
      // event rows. A projection hash match alone cannot qualify a chart.
      // Incomplete generations are reported without attempting a read.
      const publishedTimeline = stored.timelineGeneration && !stored.timelineReady
        ? null
        : await Patient360ProjectionService.getTimeline(tenantId, doc.id, 500, stored);
      const status = classifyPatient360PolicyInspection({
        stored,
        canonical: canonical.projection,
        timelineMatches: publishedTimeline === null
          ? undefined
          : patient360TimelineParity(publishedTimeline, canonical.timeline),
        rawEventTypes: rawEvents
          .slice(0, MAX_RAW_EVENTS)
          .map((event) => String(event.eventType || '')),
        exceededEventLimit: rawEvents.length > MAX_RAW_EVENTS,
      });
      statuses[status] = (statuses[status] || 0) + 1;
    } catch {
      // Never print a patient ID, source event payload, document or error stack.
      failures += 1;
    }
  }

  console.log(JSON.stringify({
    operation: 'CIQP_READ_ONLY_EMULATOR_INSPECTION',
    scanned: documents.length,
    truncatedAtMaximum: projections.size > MAX_PATIENTS,
    statusCounts: statuses,
    failures,
    writesPerformed: 0,
    migrationPerformed: false,
    releaseGate: failures > 0 || projections.size > MAX_PATIENTS ||
      Object.keys(statuses).some((status) => status !== 'CURRENT_POLICY_MATCH')
        ? 'BLOCKED'
        : 'READ_ONLY_COHORT_MATCHED',
  }, null, 2));
  // Even a successfully diagnosed legacy mismatch is NOT a safe release.
  const hasUnresolvedRevisions = Object.keys(statuses).some(
    (status) => status !== 'CURRENT_POLICY_MATCH'
  );
  if (failures > 0 || projections.size > MAX_PATIENTS || hasUnresolvedRevisions) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  run().catch(() => {
    console.error('CIQP_INSPECTION_FAILED_CLOSED');
    process.exitCode = 1;
  });
}
