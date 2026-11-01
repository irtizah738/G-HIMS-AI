/**
 * Real Firestore transaction tests. Run ONLY against the isolated emulator:
 * firebase emulators:exec --project ghims-p4-ci --only firestore
 *   "bun test emulator-security/helixis-external-fhir-import.test.ts"
 */
import { expect, test } from 'bun:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  fhirPatientLinkId, fhirImportHeadId, ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';

const endpoint = 'https://synthetic-his.example.test/fhir/R4';
function observation(versionId: string, lastUpdated: string, value: number) {
  return {
    resourceType: 'Observation', id: 'lab-1001',
    meta: { versionId, lastUpdated },
    subject: { reference: 'Patient/his-patient-01' },
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
    valueQuantity: { value, unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL' },
  };
}
test('external FHIR import: atomic versions, audit, idempotency, revocation and isolation', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FHIR_EMULATOR_REQUIRED: refusing to run transaction qualification on a real project');
  }
  const app = initializeApp({ projectId: 'ghims-p4-ci' }, 'fhir-import-' + crypto.randomUUID());
  const db = getFirestore(app);
  const tenantId = 'fhir-synthetic-' + crypto.randomUUID().slice(0, 8);
  const actor = {
    actorId: 'synthetic-integrator',
    tenantId,
    roles: [] as string[],
    permissions: ['FHIR_IMPORT'],
    facilityIds: ['facility-1'],
  };
  const root = db.collection('tenants').doc(tenantId);
  const sourceId = 'his-a';
  const source = root.collection('fhirSources').doc(sourceId);
  const link = root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId, 'his-patient-01'));
  const head = root.collection('fhirResourceHeads').doc(fhirImportHeadId(sourceId, 'Observation', 'lab-1001'));
  try {
    await Promise.all([
      root.collection('patients').doc('helixis-p1').set({ tenantId, status: 'ACTIVE' }),
      root.collection('patients').doc('helixis-p2').set({ tenantId, status: 'ACTIVE' }),
      source.set({
        tenantId, sourceId, facilityId: 'facility-1', baseUrl: endpoint,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      }),
      link.set({
        tenantId, sourceId, externalPatientId: 'his-patient-01',
        patientId: 'helixis-p1', facilityId: 'facility-1',
        matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
        verifiedBy: 'synthetic-reviewer',
      }),
    ]);
    const first = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('v-1', '2026-10-20T09:00:00Z', 1.2),
    });
    expect(first.replay).toBe(false);
    expect(first.status).toBe('CURRENT');
    expect(first.patientId).toBe('helixis-p1');
    const firstReplay = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('v-1', '2026-10-20T09:00:00Z', 1.2),
    });
    expect(firstReplay.replay).toBe(true);
    expect(firstReplay.receiptId).toBe(first.receiptId);
    const firstEvent = await root.collection('fhirImportEvents').doc(first.eventId).get();
    const firstReceipt = await root.collection('fhirImportedVersions').doc(first.receiptId).get();
    expect(firstEvent.exists).toBe(true);
    expect(firstReceipt.get('immutable')).toBe(true);
    expect(firstEvent.get('provenance.sourceVersionId')).toBe('v-1');
    expect((await root.collection('fhirImportEvents').get()).size).toBe(1);
    expect((await root.collection('fhirImportOutbox').get()).docs[0].get('status')).toBe('HELD');
    expect((await root.collection('auditLogs').get()).size).toBe(1);

    // Same FHIR logical-id/version cannot silently change clinical content.
    await expect(ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('v-1', '2026-10-20T09:00:00Z', 9.9),
    })).rejects.toThrow('FHIR_IMPORT_REPLAY_PAYLOAD_OR_IDENTITY_CONFLICT');
    expect((await root.collection('fhirImportEvents').get()).size).toBe(1);

    const second = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('opaque-z', '2026-10-21T09:00:00Z', 1.7),
    });
    expect(second.status).toBe('CURRENT');
    expect((await head.get()).get('sourceVersionId')).toBe('opaque-z');

    const older = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('opaque-old', '2026-10-19T09:00:00Z', 1.0),
    });
    expect(older.status).toBe('HISTORICAL');
    expect((await head.get()).get('sourceVersionId')).toBe('opaque-z');

    const tie = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: endpoint,
      resource: observation('opaque-tie', '2026-10-21T09:00:00Z', 2.1),
    });
    expect(tie.status).toBe('RECONCILIATION_REQUIRED');
    expect((await head.get()).get('sourceVersionId')).toBe('opaque-z');
    expect((await root.collection('fhirImportOutbox').doc('fob_' + tie.receiptId.slice(4)).get()).get('status')).toBe('HELD');

    await expect(ingestExternalFhirResource({
      db, actor: { ...actor, tenantId: 'other-tenant' }, sourceId,
      resource: observation('v-cross', '2026-10-23T09:00:00Z', 2.4),
    })).rejects.toThrow('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');
    await expect(ingestExternalFhirResource({
      db, actor: { ...actor, permissions: [] }, sourceId,
      resource: observation('v-permission', '2026-10-23T09:00:00Z', 2.4),
    })).rejects.toThrow('FHIR_IMPORT_PERMISSION_DENIED');
    await expect(ingestExternalFhirResource({
      db, actor: { ...actor, facilityIds: [] }, sourceId,
      resource: observation('v-facility', '2026-10-23T09:00:00Z', 2.4),
    })).rejects.toThrow('FHIR_IMPORT_FACILITY_ACCESS_DENIED');

    await link.update({ consentStatus: 'WITHDRAWN' });
    await expect(ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v-consent', '2026-10-23T09:00:00Z', 2.4),
    })).rejects.toThrow('FHIR_IMPORT_PATIENT_LINK_UNVERIFIED_OR_CONSENT_WITHDRAWN');
    await link.update({ consentStatus: 'GRANTED', patientId: 'helixis-p2' });
    await expect(ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v-relinked', '2026-10-24T09:00:00Z', 2.7),
    })).rejects.toThrow('FHIR_IMPORT_RESOURCE_PATIENT_RELINK_REQUIRES_RECONCILIATION');
    await link.update({ patientId: 'helixis-p1' });
    await source.update({ status: 'REVOKED' });
    await expect(ingestExternalFhirResource({
      db, actor, sourceId,
      resource: observation('v-revoked', '2026-10-25T09:00:00Z', 2.7),
    })).rejects.toThrow('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');

    // Failed transaction creates no partial event/audit/outbox.
    expect((await root.collection('fhirImportEvents').get()).size).toBe(4);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(4);
    expect((await root.collection('auditLogs').get()).size).toBe(4);
    expect((await root.collection('fhirImportOutbox').get()).size).toBe(4);
  } finally {
    await db.recursiveDelete(root);
    await deleteApp(app);
  }
}, 120000);
