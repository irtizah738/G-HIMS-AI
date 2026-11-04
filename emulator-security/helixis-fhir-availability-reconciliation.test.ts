/**
 * CI-EXT-09 synthetic-only qualification. Never contacts an external HIS.
 * Requires the isolated ghims-p4-ci Firestore emulator.
 */
import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  fhirImportHeadId, fhirPatientLinkId, ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';
import { reconcileFhirReadAvailability } from '@/lib/clinical/intelligence/external-fhir-availability';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';
import { readExternalClinicalEvidence } from '@/lib/clinical/intelligence/external-clinical-evidence-reader';

function observation(versionId: string, updated: string, value: number) {
  return {
    resourceType: 'Observation', id: 'creatinine-1',
    meta: { versionId, lastUpdated: updated },
    status: 'final', subject: { reference: 'Patient/source-p1' },
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'mg/dL' },
  };
}

test('CI-EXT-09: 404/410 quarantine, replay, stale response and verified recovery', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_EMULATOR_ISOLATION_REQUIRED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId = 'fhir-absence-' + randomUUID().slice(0, 10);
  const patientId = 'patient-1';
  const sourceId = 'source-1';
  const facilityId = 'site-1';
  const baseUrl = 'https://synthetic-only.example.test/fhir/R4';
  const root = db.collection('tenants').doc(tenantId);
  const actor = { actorId: 'integrator-1', tenantId, roles: [] as string[],
    permissions: ['FHIR_IMPORT', 'FHIR_EVIDENCE_REVIEW'], facilityIds: [facilityId] };
  const resourceType = 'Observation' as const;
  const resourceId = 'creatinine-1';
  const headId = fhirImportHeadId(sourceId, resourceType, resourceId);
  const headRef = root.collection('fhirResourceHeads').doc(headId);
  const stateRef = root.collection('fhirAvailabilityStates').doc(headId);
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
      root.collection('fhirSources').doc(sourceId).set({
        tenantId, sourceId, facilityId, baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient','Encounter','Observation'],
      }),
      root.collection('fhirPatientLinks')
        .doc(fhirPatientLinkId(sourceId, 'source-p1')).set({
          tenantId, sourceId, facilityId, externalPatientId: 'source-p1',
          patientId, matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
          verifiedBy: 'synthetic-reviewer',
        }),
    ]);
    const v1 = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v1', '2026-10-20T09:00:00Z', 1.2),
    });
    expect(v1.status).toBe('CURRENT');
    const first = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(first.projection.status).toBe('EVIDENCE_ONLY');
    expect(first.projection.facts.length).toBe(1);
    const firstRead = await readExternalClinicalEvidence({ db, actor, tenantId, patientId });
    expect(firstRead.facts.length).toBe(1);

    const startedAt = Date.now();
    const probeId = randomUUID();
    const args = {
      db, actor, sourceId, resourceType, resourceId,
      expectedHeadReceiptId: v1.receiptId, probeId, probeStartedAt: startedAt,
      expectedBaseUrl: baseUrl,
    };
    const absent = await reconcileFhirReadAvailability({ ...args, httpStatus: 404 });
    expect(absent.status).toBe('SUSPECTED_ABSENCE');
    expect(absent.replay).toBe(false);
    expect((await stateRef.get()).get('status')).toBe('SUSPECTED_ABSENCE');
    expect((await headRef.get()).get('receiptId')).toBe(v1.receiptId);
    await expect(readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .rejects.toThrow('CI_EXT03_UNRESOLVED_RECONCILIATION');

    const held = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(held.projection.revision).toBe(2);
    expect(held.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(held.projection.facts).toEqual([]);
    expect(held.projection.reconciliationIssues).toContain(
      'SOURCE_RETRIEVAL_UNVERIFIED:' + headId,
    );
    const replay = await reconcileFhirReadAvailability({ ...args, httpStatus: 404 });
    expect(replay.replay).toBe(true);
    expect((await root.collection('fhirAvailabilityEvents').get()).size).toBe(1);
    await expect(reconcileFhirReadAvailability({
      ...args, httpStatus: 410,
    })).rejects.toThrow('FHIR_ABSENCE_REPLAY_CONFLICT');

    const gone = await reconcileFhirReadAvailability({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 10,
      httpStatus: 410,
    });
    expect(gone.status).toBe('SUSPECTED_ABSENCE');
    expect((await stateRef.get()).get('episode')).toBe(1);
    expect((await root.collection('fhirReconciliationCases').get()).size).toBe(1);

    const staleRecovery = await reconcileFhirReadAvailability({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 9,
      httpStatus: 200,
    });
    expect(staleRecovery.status).toBe('STALE_IGNORED');
    expect((await stateRef.get()).get('status')).toBe('SUSPECTED_ABSENCE');

    const v2 = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v2', '2026-10-21T09:00:00Z', 1.3),
    });
    expect(v2.status).toBe('CURRENT');
    await expect(reconcileFhirReadAvailability({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 20,
      httpStatus: 404,
    })).rejects.toThrow('FHIR_ABSENCE_HEAD_CHANGED_OR_MISSING');

    const recovered = await reconcileFhirReadAvailability({
      ...args, expectedHeadReceiptId: v2.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 30,
      httpStatus: 200,
    });
    expect(recovered.status).toBe('AVAILABLE_CONFIRMED');
    expect((await stateRef.get()).get('status')).toBe('AVAILABLE_CONFIRMED');
    const cases = await root.collection('fhirReconciliationCases').get();
    expect(cases.docs[0].get('status')).toBe('RESOLVED');
    // Old quarantine projection stays blocked until an explicit rebuild.
    await expect(readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .rejects.toThrow('CI_EXT03_RECONCILIATION_OR_POLICY_BLOCK');
    const rebuilt = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(rebuilt.projection.revision).toBe(3);
    expect(rebuilt.projection.status).toBe('EVIDENCE_ONLY');
    expect(rebuilt.projection.facts.length).toBe(1);
    expect(rebuilt.projection.facts[0].sourceVersionId).toBe('v2');
    expect((await readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .facts.length).toBe(1);

    const late404 = await reconcileFhirReadAvailability({
      ...args, expectedHeadReceiptId: v2.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 25,
      httpStatus: 404,
    });
    expect(late404.status).toBe('STALE_IGNORED');
    expect((await stateRef.get()).get('status')).toBe('AVAILABLE_CONFIRMED');
    expect((await root.collection('fhirReconciliationCases').get()).size).toBe(1);
    const outbox = await root.collection('fhirAvailabilityOutbox').get();
    for (const row of outbox.docs) expect(row.get('status')).toBe('HELD');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);

    // A new head imported through an internal backfill is not automatically
    // treated as a recovered source read until a fresh 200 is witnessed.
    const v3 = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v3', '2026-10-22T09:00:00Z', 1.4),
    });
    expect(v3.status).toBe('CURRENT');
    const unreverified = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(unreverified.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(unreverified.projection.facts).toEqual([]);
    expect(unreverified.projection.reconciliationIssues).toContain(
      'SOURCE_NEW_HEAD_NOT_REVERIFIED:' + headId,
    );
    const confirmed = await reconcileFhirReadAvailability({
      ...args, expectedHeadReceiptId: v3.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 40,
      httpStatus: 200,
    });
    expect(confirmed.status).toBe('AVAILABLE_CONFIRMED');
    expect((await stateRef.get()).get('sourceReceiptId')).toBe(v3.receiptId);
    const afterConfirm = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(afterConfirm.projection.status).toBe('EVIDENCE_ONLY');
    expect(afterConfirm.projection.facts[0].sourceVersionId).toBe('v3');
    expect((await readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .facts.length).toBe(1);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(3);

    await root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId, 'source-p1'))
      .update({ consentStatus: 'WITHDRAWN' });
    await expect(reconcileFhirReadAvailability({
      ...args, expectedHeadReceiptId: v2.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 50, httpStatus: 410,
    })).rejects.toThrow('FHIR_ABSENCE_LINK_OR_CONSENT_INVALID');
    await expect(reconcileFhirReadAvailability({
      ...args, actor: { ...actor, tenantId: 'different-tenant' },
      probeId: randomUUID(), probeStartedAt: startedAt + 60, httpStatus: 410,
    })).rejects.toThrow();
  } finally {
    await db.recursiveDelete(root);
  }
}, 30000);
