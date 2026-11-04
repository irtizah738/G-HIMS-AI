/**
 * CI-EXT-10: synthetic, isolated, Admin SDK Firestore qualification.
 * Requires ghims-p4-ci emulator; refuses any real project.
 */
import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  fhirPatientLinkId, fhirImportHeadId, ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';
import {
  assessFhirHistoryWindow, recordFhirHistoryObservation,
} from '@/lib/clinical/intelligence/external-fhir-history';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';
import { readExternalClinicalEvidence } from '@/lib/clinical/intelligence/external-clinical-evidence-reader';

const type = 'Observation' as const;
const sourceId = 'synthetic-his';
const facilityId = 'site-1';
const patientId = 'helixis-p1';
const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
function observation(versionId: string, modified: string, value: number, id = 'lab-a') {
  return {
    resourceType: type, id, meta: { versionId, lastUpdated: modified },
    subject: { reference: 'Patient/source-p1' }, status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'mg/dL' },
  };
}
const v1 = observation('opaque-alpha', '2026-10-20T09:00:00Z', 1.2);
const v2 = observation('opaque-omega', '2026-10-21T09:00:00Z', 1.3);
const v3 = observation('opaque-restored', '2026-10-23T09:00:00Z', 1.4);
function history(resources: Array<ReturnType<typeof observation>>, options?: {
  next?: boolean; deletionAt?: string;
}) {
  const entries: Array<Record<string, unknown>> = [];
  if (options?.deletionAt) {
    entries.push({
      request: { method: 'DELETE', url: 'Observation/lab-a' },
      response: { lastModified: options.deletionAt },
    });
  }
  for (const resource of resources) {
    entries.push({ resource, request: { method: 'PUT', url: 'Observation/lab-a' } });
  }
  return {
    resourceType: 'Bundle', type: 'history',
    entry: entries,
    link: options?.next ? [{ relation: 'next', url: 'https://synthetic-his.example.test/next' }] : [],
  };
}

test('CI-EXT-10: source history anchors, deletion review and head/consent fences', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_HISTORY_EMULATOR_ISOLATION_REQUIRED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_HISTORY_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId = 'history-' + randomUUID().slice(0, 10);
  const root = db.collection('tenants').doc(tenantId);
  const actor = { actorId: 'synthetic-operator', tenantId,
    roles: [] as string[], permissions: ['FHIR_IMPORT', 'FHIR_EVIDENCE_REVIEW'],
    facilityIds: [facilityId] };
  const headId = fhirImportHeadId(sourceId, type, 'lab-a');
  const headRef = root.collection('fhirResourceHeads').doc(headId);
  const stateRef = root.collection('fhirHistoryStates').doc(headId);
  const linkRef = root.collection('fhirPatientLinks').doc(
    fhirPatientLinkId(sourceId, 'source-p1'));
  const startedAt = Date.now();
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
      root.collection('fhirSources').doc(sourceId).set({
        tenantId, sourceId, facilityId, baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      }),
      linkRef.set({
        tenantId, sourceId, facilityId, patientId, externalPatientId: 'source-p1',
        matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
        verifiedBy: 'synthetic-reviewer',
      }),
    ]);
    await ingestExternalFhirResource({ db, actor, sourceId, resource: v1 });
    const latest = await ingestExternalFhirResource({ db, actor, sourceId, resource: v2 });
    expect(latest.status).toBe('CURRENT');
    const args = { db, actor, sourceId, resourceType: type, resourceId: 'lab-a',
      expectedHeadReceiptId: latest.receiptId, expectedBaseUrl: baseUrl,
      probeId: randomUUID(), probeStartedAt: startedAt, bundle: history([v2,v1], { next: true }) };

    const anchored = await recordFhirHistoryObservation(args);
    expect(anchored.status).toBe('WINDOW_ANCHORED');
    expect(anchored.reasons).toEqual([]);
    expect((await stateRef.get()).get('status')).toBe('WINDOW_ANCHORED');
    expect((await headRef.get()).get('receiptId')).toBe(latest.receiptId);
    const raw = await root.collection('fhirHistoryEvents').doc(anchored.assessmentId).get();
    expect(raw.get('immutable')).toBe(true);
    expect(raw.get('paginated')).toBe(true);
    expect(raw.get('bundle')).toBe(undefined);
    expect((await recordFhirHistoryObservation(args)).replay).toBe(true);
    expect((await root.collection('fhirHistoryEvents').get()).size).toBe(1);

    const p1 = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(p1.projection.status).toBe('EVIDENCE_ONLY');
    expect(p1.projection.facts.length).toBe(1);
    expect((await readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .facts.length).toBe(1);

    await expect(recordFhirHistoryObservation({
      ...args, bundle: history([v2,v1]),
    })).rejects.toThrow('FHIR_HISTORY_REPLAY_CONFLICT');
    await expect(recordFhirHistoryObservation({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 1,
      bundle: history([v1,v2]),
    })).rejects.toThrow('FHIR_HISTORY_NOT_NEWEST_FIRST');

    const staleDelete = await recordFhirHistoryObservation({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt - 1,
      bundle: history([v2,v1], { deletionAt: '2026-10-22T09:00:00Z' }),
    });
    expect(staleDelete.status).toBe('STALE_IGNORED');
    expect((await stateRef.get()).get('status')).toBe('WINDOW_ANCHORED');
    expect((await root.collection('fhirReconciliationCases').get()).empty).toBe(true);

    const deleted = await recordFhirHistoryObservation({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 10,
      bundle: history([v2,v1], { deletionAt: '2026-10-22T09:00:00Z' }),
    });
    expect(deleted.status).toBe('REVIEW_REQUIRED');
    expect(deleted.reasons).toContain('HISTORY_DELETE_ENTRY_OBSERVED');
    expect((await stateRef.get()).get('status')).toBe('REVIEW_REQUIRED');
    expect((await root.collection('fhirReconciliationCases').get()).size).toBe(1);
    await expect(readExternalClinicalEvidence({ db, actor, tenantId, patientId }))
      .rejects.toThrow('CI_EXT03_UNRESOLVED_RECONCILIATION');
    const quarantined = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(quarantined.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(quarantined.projection.facts).toEqual([]);
    expect(quarantined.projection.reconciliationIssues).toContain(
      'SOURCE_HISTORY_REQUIRES_RECONCILIATION:' + headId);

    const later = await ingestExternalFhirResource({ db, actor, sourceId, resource: v3 });
    expect(later.status).toBe('CURRENT');
    const advanced = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(advanced.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(advanced.projection.facts).toEqual([]);
    await expect(recordFhirHistoryObservation({
      ...args, probeId: randomUUID(), probeStartedAt: startedAt + 11,
      bundle: history([v3,v2,v1]),
    })).rejects.toThrow('FHIR_HISTORY_HEAD_CHANGED');
    const verified = await recordFhirHistoryObservation({
      ...args, expectedHeadReceiptId: later.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 20,
      bundle: history([v3,v2,v1]),
    });
    expect(verified.status).toBe('WINDOW_ANCHORED');
    expect((await stateRef.get()).get('headReceiptId')).toBe(later.receiptId);
    const stillHeld = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(stillHeld.projection.status).toBe('RECONCILIATION_REQUIRED');
    // A reviewed history window cannot silently close an earlier open deletion case.
    expect((await root.collection('fhirReconciliationCases').get()).docs[0].get('status')).toBe('OPEN');
    expect((await headRef.get()).get('receiptId')).toBe(later.receiptId);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(3);
    for (const item of (await root.collection('fhirHistoryOutbox').get()).docs) {
      expect(item.get('status')).toBe('HELD');
    }
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);

    await linkRef.update({ consentStatus: 'WITHDRAWN' });
    await expect(recordFhirHistoryObservation({
      ...args, expectedHeadReceiptId: later.receiptId,
      probeId: randomUUID(), probeStartedAt: startedAt + 30,
      bundle: history([v3,v2,v1]),
    })).rejects.toThrow('FHIR_HISTORY_LINK_OR_CONSENT_INVALID');
    await expect(recordFhirHistoryObservation({
      ...args, actor: { ...actor, tenantId: 'other-tenant' },
      probeId: randomUUID(), probeStartedAt: startedAt + 31,
    })).rejects.toThrow('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);

test('CI-EXT-10: opaque revision ordering and concurrent FHIR imports', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_HISTORY_EMULATOR_ISOLATION_REQUIRED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_HISTORY_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId = 'history-race-' + randomUUID().slice(0, 10);
  const root = db.collection('tenants').doc(tenantId);
  const actor = { actorId: 'synthetic-operator', tenantId,
    roles: [] as string[], permissions: ['FHIR_IMPORT'], facilityIds: [facilityId] };
  const older = observation('zzzz', '2026-10-25T09:00:00Z', 1.5, 'lab-b');
  const newer = observation('aaaa', '2026-10-26T09:00:00Z', 1.6, 'lab-b');
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
      root.collection('fhirSources').doc(sourceId).set({
        tenantId, sourceId, facilityId, baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      }),
      root.collection('fhirPatientLinks')
        .doc(fhirPatientLinkId(sourceId, 'source-p1')).set({
          tenantId, sourceId, patientId, facilityId,
          externalPatientId: 'source-p1',
          matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
        }),
    ]);
    const outcomes = await Promise.all([
      ingestExternalFhirResource({ db, actor, sourceId, resource: newer }),
      ingestExternalFhirResource({ db, actor, sourceId, resource: older }),
    ]);
    expect(outcomes.length).toBe(2);
    const headId = fhirImportHeadId(sourceId, type, 'lab-b');
    const head = await root.collection('fhirResourceHeads').doc(headId).get();
    expect(head.get('sourceVersionId')).toBe('aaaa');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('fhirImportEvents').get()).size).toBe(2);
    const assessed = assessFhirHistoryWindow({
      resourceType: 'Bundle', type: 'history',
      entry: [newer, older].map(r => ({ resource: r, request: { method: 'PUT', url: 'Observation/lab-b' } })),
    }, type, 'lab-b', { sourceVersionId: 'aaaa', sourceLastUpdatedAt: Date.parse('2026-10-26T09:00:00Z') });
    expect(assessed.status).toBe('WINDOW_ANCHORED');
    expect(assessed.reasons).toEqual([]);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);
