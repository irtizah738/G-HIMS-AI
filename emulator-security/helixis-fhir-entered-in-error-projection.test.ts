/**
 * Synthetic-only Firestore qualification: FHIR entered-in-error corrections
 * must never leak into external Patient 360 as current clinical evidence.
 * Requires the isolated Firestore emulator; no live data or external HIS.
 */
import { expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  fhirImportHeadId,
  fhirPatientLinkId,
  ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';

test('FHIR entered-in-error correction suppresses evidence without erasing history', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_EMULATOR_ISOLATION_REQUIRED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_EMULATOR_ADMIN_UNAVAILABLE');

  const tenantId = 'fhir-void-' + crypto.randomUUID().slice(0, 10);
  const patientId = 'helixis-p1';
  const sourceId = 'ehr-synthetic';
  const facilityId = 'synthetic-site';
  const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
  const root = db.collection('tenants').doc(tenantId);
  const actor = {
    actorId: 'synthetic-operator',
    tenantId,
    roles: [] as string[],
    permissions: ['FHIR_IMPORT'],
    facilityIds: [facilityId],
  };
  const headRef = root.collection('fhirResourceHeads')
    .doc(fhirImportHeadId(sourceId, 'Observation', 'creatinine-1'));

  const observation = (versionId: string, lastUpdated: string,
    status: 'final' | 'entered-in-error', value: number) => ({
    resourceType: 'Observation' as const,
    id: 'creatinine-1',
    meta: { versionId, lastUpdated },
    subject: { reference: 'Patient/external-p1' },
    status,
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'mg/dL', unit: 'mg/dL' },
    effectiveDateTime: '2026-10-20T09:00:00Z',
  });

  try {
    await Promise.all([
      root.collection('patients').doc(patientId)
        .set({ tenantId, status: 'ACTIVE' }),
      root.collection('fhirSources').doc(sourceId).set({
        tenantId, sourceId, facilityId, baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      }),
      root.collection('fhirPatientLinks')
        .doc(fhirPatientLinkId(sourceId, 'external-p1')).set({
          tenantId, sourceId, facilityId, externalPatientId: 'external-p1',
          patientId, matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
          verifiedBy: 'synthetic-clinical-reviewer',
        }),
    ]);

    const initial = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v1', '2026-10-20T09:00:00Z', 'final', 1.2),
    });
    expect(initial.status).toBe('CURRENT');
    const first = await rebuildExternalPatient360({ db, tenantId, patientId, actor });
    expect(first.projection.status).toBe('EVIDENCE_ONLY');
    expect(first.projection.facts).toHaveLength(1);

    const correction = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v2', '2026-10-21T09:00:00Z', 'entered-in-error', 1.2),
    });
    expect(correction.status).toBe('CURRENT');
    expect((await headRef.get()).get('receiptId')).toBe(correction.receiptId);

    const held = await rebuildExternalPatient360({ db, tenantId, patientId, actor });
    expect(held.projection.revision).toBe(2);
    expect(held.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(held.projection.facts).toEqual([]);
    expect(held.projection.reconciliationIssues).toContain(
      'SOURCE_RESOURCE_ENTERED_IN_ERROR:' + headRef.id,
    );
    expect((await rebuildExternalPatient360({ db, tenantId, patientId, actor })).unchanged)
      .toBe(true);

    // Immutable evidence is retained and no HELD outbox is released.
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('fhirImportEvents').get()).size).toBe(2);
    const outbox = await root.collection('fhirImportOutbox').get();
    expect(outbox.size).toBe(2);
    for (const doc of outbox.docs) expect(doc.get('status')).toBe('HELD');
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);

    const restored = await ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v3', '2026-10-22T09:00:00Z', 'final', 1.4),
    });
    expect(restored.status).toBe('CURRENT');
    const third = await rebuildExternalPatient360({ db, tenantId, patientId, actor });
    expect(third.projection.revision).toBe(3);
    expect(third.projection.status).toBe('EVIDENCE_ONLY');
    expect(third.projection.facts).toHaveLength(1);
    expect(third.projection.facts[0].sourceVersionId).toBe('v3');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(3);
    expect((await root.collection('externalPatient360Revisions').get()).size).toBe(3);
  } finally {
    await db.recursiveDelete(root);
  }
}, 30000);
