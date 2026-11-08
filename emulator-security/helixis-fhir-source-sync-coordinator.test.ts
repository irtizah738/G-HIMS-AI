/**
 * CI-EXT-11 — isolated transactional source poll fencing qualification.
 * NEVER run against a live GCP project or hospital data.
 */
import { test, expect } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  fhirPatientLinkId, ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';
import {
  acquireSourcePollLease, reserveSourcePollOperation, renewSourcePollLease,
  checkpointSourcePollLease, releaseSourcePollLease,
} from '@/lib/clinical/intelligence/external-fhir-sync-coordinator';
import { recordFhirHistoryObservation } from '@/lib/clinical/intelligence/external-fhir-history';
import { reconcileFhirReadAvailability } from '@/lib/clinical/intelligence/external-fhir-availability';

const digest = (message: string) =>
  createHash('sha256').update(message).digest('hex');
const sourceId = 'his-fenced';
const patientId = 'synthetic-p1';
const facilityId = 'synthetic-facility';
const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
const resourceType = 'Observation' as const;
const resourceId = 'lab-a';
const t1 = '2026-10-20T08:00:00Z';
const t2 = '2026-10-21T08:00:00Z';
function observation(versionId: string, updated: string, value: number) {
  return {
    resourceType, id: resourceId, status: 'final',
    meta: { versionId, lastUpdated: updated },
    subject: { reference: 'Patient/external-p1' },
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    valueQuantity: { value, unit: 'mg/dL', system: 'http://unitsofmeasure.org' },
  };
}
const v1 = observation('v1', t1, 1.1);
const v2 = observation('v2', t2, 1.2);
function history(resource: ReturnType<typeof observation>) {
  return { resourceType: 'Bundle', type: 'history',
    entry: [{ request: { method: 'PUT', url: 'Observation/lab-a' }, resource }],
  };
}
test('CI-EXT-11: leases, fencing epochs, global ordering, atomic checkpoints and takeover', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_SYNC_EMULATOR_ISOLATION_REQUIRED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_SYNC_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId = 'fhir-sync-' + randomUUID().slice(0, 10);
  const root = db.collection('tenants').doc(tenantId);
  const actor = {
    actorId: 'synthetic-integrator', tenantId, roles: [] as string[],
    permissions: ['FHIR_IMPORT', 'FHIR_POLL_COORDINATE'],
    facilityIds: [facilityId],
  };
  const leaseRef = root.collection('fhirSourcePollLeases').doc(sourceId);
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
      root.collection('fhirSources').doc(sourceId).set({
        tenantId, sourceId, facilityId, baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
        syncMode: 'FENCED', syntheticOnly: true,
      }),
      root.collection('fhirPatientLinks')
        .doc(fhirPatientLinkId(sourceId, 'external-p1')).set({
          tenantId, sourceId, facilityId, externalPatientId: 'external-p1',
          patientId, matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
        }),
    ]);
    const workerA = randomUUID();
    const claimA = randomUUID();
    const claimed = await acquireSourcePollLease({
      db, actor, sourceId, workerId: workerA, claimId: claimA, ttlMs: 60_000,
    });
    expect(claimed.fence.epoch).toBe(1);
    expect(claimed.replay).toBe(false);
    const replayClaim = await acquireSourcePollLease({
      db, actor, sourceId, workerId: workerA, claimId: claimA, ttlMs: 60_000,
    });
    expect(replayClaim.replay).toBe(true);
    await expect(acquireSourcePollLease({
      db, actor, sourceId, workerId: randomUUID(),
      claimId: randomUUID(), ttlMs: 60_000,
    })).rejects.toThrow('FHIR_SYNC_ALREADY_LEASED');

    await expect(ingestExternalFhirResource({
      db, actor, sourceId, resource: v1,
    })).rejects.toThrow('FHIR_SYNC_FENCE_REQUIRED');
    const imported = await ingestExternalFhirResource({
      db, actor, sourceId, resource: v1, syncFence: claimed.fence,
    });
    expect(imported.status).toBe('CURRENT');

    const op1 = await reserveSourcePollOperation({
      db, actor, fence: claimed.fence, workId: 'history-older',
    });
    const op2 = await reserveSourcePollOperation({
      db, actor, fence: claimed.fence, workId: 'history-newer',
    });
    expect(op2.operationSequence).toBe(op1.operationSequence + 1);
    const observationArgs = {
      db, actor, sourceId, resourceType, resourceId,
      expectedHeadReceiptId: imported.receiptId, bundle: history(v1),
    };
    const newer = await recordFhirHistoryObservation({
      ...observationArgs, syncFence: op2,
      probeId: randomUUID(), probeStartedAt: 1_600_000_000_000,
    });
    expect(newer.status).toBe('WINDOW_ANCHORED');
    // Earlier operation arrived later with a higher wall-clock value.
    // FENCED mode must use operation sequence, NOT that timestamp.
    const old = await recordFhirHistoryObservation({
      ...observationArgs, syncFence: op1,
      probeId: randomUUID(), probeStartedAt: 1_700_000_000_000,
    });
    expect(old.status).toBe('STALE_IGNORED');
    expect((await root.collection('fhirHistoryStates')
      .doc('fhd_' + digest(JSON.stringify([sourceId, resourceType, resourceId]))).get())
      .get('lastOperationSequence')).toBe(op2.operationSequence);

    // A production runtime cannot use the legacy checkpoint even with an emulator.
    const savedMode = process.env.GHIMS_RUNTIME_MODE;
    try {
      process.env.GHIMS_RUNTIME_MODE = 'PRODUCTION';
      await expect(checkpointSourcePollLease({
        db, actor, fence: claimed.fence, sequence: 1,
        workId: 'history-newer', digest: digest('v1-validated'),
      })).rejects.toThrow('FHIR_SYNC_LEGACY_CHECKPOINT_TEST_ONLY');
    } finally {
      if (savedMode === undefined) delete process.env.GHIMS_RUNTIME_MODE;
      else process.env.GHIMS_RUNTIME_MODE = savedMode;
    }

    // The legacy checkpoint API must not accept an otherwise authorized LIVE source.
    await root.collection('fhirSources').doc(sourceId).update({syntheticOnly: false});
    await expect(checkpointSourcePollLease({
      db, actor, fence: claimed.fence, sequence: 1,
      workId: 'history-newer', digest: digest('v1-validated'),
    })).rejects.toThrow('FHIR_SYNC_LEGACY_CHECKPOINT_SYNTHETIC_SOURCE_REQUIRED');
    await root.collection('fhirSources').doc(sourceId).update({syntheticOnly: true});

    const checkpoint = await checkpointSourcePollLease({
      db, actor, fence: claimed.fence, sequence: 1,
      workId: 'history-newer', digest: digest('v1-validated'),
    });
    expect(checkpoint.checkpointSequence).toBe(1);
    expect(checkpoint.replay).toBe(false);
    expect((await checkpointSourcePollLease({
      db, actor, fence: claimed.fence, sequence: 1,
      workId: 'history-newer', digest: digest('v1-validated'),
    })).replay).toBe(true);
    await expect(checkpointSourcePollLease({
      db, actor, fence: claimed.fence, sequence: 3,
      workId: 'skipped', digest: digest('not-committed'),
    })).rejects.toThrow('FHIR_SYNC_CHECKPOINT_OUT_OF_ORDER');
    await renewSourcePollLease({
      db, actor, fence: claimed.fence, ttlMs: 60_000,
    });

    const op3 = await reserveSourcePollOperation({
      db, actor, fence: claimed.fence, workId: 'read-unavailable',
    });
    const unavailable = await reconcileFhirReadAvailability({
      db, actor, sourceId, resourceType, resourceId,
      expectedHeadReceiptId: imported.receiptId,
      syncFence: op3, probeId: randomUUID(),
      probeStartedAt: 1_600_000_000_000,
      httpStatus: 404,
    });
    expect(unavailable.status).toBe('SUSPECTED_ABSENCE');

    const op4 = await reserveSourcePollOperation({
      db, actor, fence: claimed.fence, workId: 'read-recovered',
    });
    const recovered = await reconcileFhirReadAvailability({
      db, actor, sourceId, resourceType, resourceId,
      expectedHeadReceiptId: imported.receiptId,
      syncFence: op4, probeId: randomUUID(),
      probeStartedAt: 1_500_000_000_000, httpStatus: 200,
    });
    expect(recovered.status).toBe('AVAILABLE_CONFIRMED');
    expect((await root.collection('fhirAvailabilityStates')
      .doc('fhd_' + digest(JSON.stringify([sourceId, resourceType, resourceId]))).get())
      .get('lastOperationSequence')).toBe(op4.operationSequence);

    await releaseSourcePollLease({ db, actor, fence: claimed.fence });
    const workerB = randomUUID();
    const acquiredB = await acquireSourcePollLease({
      db, actor, sourceId, workerId: workerB,
      claimId: randomUUID(), ttlMs: 60_000,
    });
    expect(acquiredB.fence.epoch).toBe(2);
    expect(acquiredB.checkpointSequence).toBe(1);
    await expect(ingestExternalFhirResource({
      db, actor, sourceId, resource: v2,
      syncFence: claimed.fence,
    })).rejects.toThrow('FHIR_SYNC_FENCE_STALE_OR_EXPIRED');
    const importedB = await ingestExternalFhirResource({
      db, actor, sourceId, resource: v2,
      syncFence: acquiredB.fence,
    });
    expect(importedB.status).toBe('CURRENT');
    const opB = await reserveSourcePollOperation({
      db, actor, fence: acquiredB.fence, workId: 'v2-history',
    });
    expect(opB.operationSequence).toBe(op4.operationSequence + 1);
    expect((await recordFhirHistoryObservation({
      db, actor, sourceId, resourceType, resourceId,
      expectedHeadReceiptId: importedB.receiptId,
      syncFence: opB, probeId: randomUUID(), probeStartedAt: 1_400_000_000_000,
      bundle: history(v2),
    })).status).toBe('WINDOW_ANCHORED');

    await checkpointSourcePollLease({
      db, actor, fence: acquiredB.fence, sequence: 2,
      workId: 'v2-history', digest: digest('v2-validated'),
    });
    // Emulator-only fault injection; real expiration happens by server readTime.
    await leaseRef.update({ expiresAtMs: 0 });
    await expect(checkpointSourcePollLease({
      db, actor, fence: acquiredB.fence, sequence: 3,
      workId: 'expired', digest: digest('no-commit'),
    })).rejects.toThrow('FHIR_SYNC_FENCE_STALE_OR_EXPIRED');
    const acquiredC = await acquireSourcePollLease({
      db, actor, sourceId, workerId: randomUUID(),
      claimId: randomUUID(), ttlMs: 60_000,
    });
    expect(acquiredC.fence.epoch).toBe(3);
    expect(acquiredC.checkpointSequence).toBe(2);
    const resumed = await checkpointSourcePollLease({
      db, actor, fence: acquiredC.fence, sequence: 3,
      workId: 'resume-after-crash', digest: digest('replayed-safe'),
    });
    expect(resumed.checkpointSequence).toBe(3);
    expect((await leaseRef.get()).get('checkpointWorkId')).toBe('resume-after-crash');

    const audit = await root.collection('fhirSourcePollEvents').get();
    expect(audit.size > 0).toBe(true);
    for (const doc of (await root.collection('fhirSourcePollOutbox').get()).docs) {
      expect(doc.get('status')).toBe('HELD');
    }
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);
