/**
 * CIQP #182 bounded, tenant-scoped, synthetic Firestore-emulator qualification.
 * Never runs against a hosted Firebase project. No identifiers/PHI in output.
 *
 * GHIMS_RUNTIME_MODE=TEST FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 * GHIMS_CIQP_MIGRATION_TENANT_ID=<synthetic-tenant>
 * GHIMS_CIQP_MIGRATION_ACK=SYNTHETIC_EMULATOR_POLICY_MIGRATION_ONLY
 * GHIMS_CIQP_MIGRATION_MODE=DRY_RUN|APPLY_SYNTHETIC
 */
import { FieldPath } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/server/firebase/admin';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { classifyPatient360PolicyInspection, patient360TimelineParity } from '@/lib/clinical/patient360/patient360-policy-inspection';
import {
  assertEmulatorPolicyMigrationScope, migratePatient360LegacyPolicyEmulator,
} from '@/lib/clinical/patient360/ciqp-policy-migration';
import type { Patient360Projection } from '@/types/patient360-projection';

export async function runCiqpEmulatorMigrationCohort(): Promise<{
  mode: string; scanned: number; statuses: Record<string, number>;
  writesAllowed: boolean; releaseQualification: 'EMULATOR_ONLY_NOT_APPROVED';
}> {
  const tenantId = String(process.env.GHIMS_CIQP_MIGRATION_TENANT_ID || '');
  assertEmulatorPolicyMigrationScope(process.env, tenantId);
  const mode = String(process.env.GHIMS_CIQP_MIGRATION_MODE || 'DRY_RUN');
  if (!['DRY_RUN', 'APPLY_SYNTHETIC'].includes(mode)) {
    throw new Error('CIQP_MIGRATION_MODE_INVALID');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_MIGRATION_EMULATOR_UNAVAILABLE');
  const tenant = db.collection('tenants').doc(tenantId);
  const snap = await tenant.collection('patient360Projections')
    .orderBy(FieldPath.documentId()).limit(26).get();
  if (snap.size > 25) throw new Error('CIQP_MIGRATION_COHORT_LIMIT');
  const statuses: Record<string, number> = {};
  let blocked = false;
  for (const doc of snap.docs) {
    try {
      const stored = doc.data() as Patient360Projection;
      if (stored.tenantId !== tenantId || stored.patientId !== doc.id) {
        throw new Error('CIQP_MIGRATION_SCOPE_MISMATCH');
      }
      if (mode === 'DRY_RUN') {
        const [canonicalSources, raw] = await Promise.all([
          Patient360ProjectionService.loadSources(tenantId, doc.id),
          Patient360ProjectionService.loadPatientEvents(tenantId, doc.id, { includeNonClinical: true }),
        ]);
        const computed = Patient360Projector.project(canonicalSources);
        const published = stored.timelineGeneration && !stored.timelineReady
          ? null
          : await Patient360ProjectionService.getTimeline(tenantId, doc.id, 500, stored);
        const result = classifyPatient360PolicyInspection({
          stored, canonical: computed.projection,
          timelineMatches: published === null
            ? undefined
            : patient360TimelineParity(published, computed.timeline),
          rawEventTypes: raw.map(event => event.eventType),
          exceededEventLimit: raw.length > 500,
        });
        statuses[result] = (statuses[result] || 0) + 1;
        if (result !== 'CURRENT_POLICY_MATCH' &&
            result !== 'LEGACY_NONAUTHORITATIVE_EVENT_CANDIDATE') blocked = true;
      } else {
        const result = await migratePatient360LegacyPolicyEmulator(tenantId, doc.id);
        statuses[result.status] = (statuses[result.status] || 0) + 1;
        if (!['MIGRATED', 'RESUMED', 'ALREADY_CURRENT'].includes(result.status)) blocked = true;
      }
    } catch {
      // The script must not output patient IDs, snapshots, payloads or stack traces.
      statuses.FAILED_CLOSED = (statuses.FAILED_CLOSED || 0) + 1;
      blocked = true;
    }
  }
  const response = {
    mode, scanned: snap.size, statuses,
    writesAllowed: mode === 'APPLY_SYNTHETIC',
    releaseQualification: 'EMULATOR_ONLY_NOT_APPROVED' as const,
  };
  console.log(JSON.stringify(response, null, 2));
  if (blocked) process.exitCode = 1;
  return response;
}

if (import.meta.main) {
  runCiqpEmulatorMigrationCohort().catch(() => {
    console.error('CIQP_MIGRATION_FAILED_CLOSED_NO_IDENTIFIERS');
    process.exitCode = 1;
  });
}
