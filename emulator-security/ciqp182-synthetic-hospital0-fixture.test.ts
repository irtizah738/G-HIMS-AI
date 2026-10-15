import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  CIQP182_FIXTURE_TENANT, CIQP182_FIXTURE_PATIENT, CIQP182_FIXTURE_VERSION,
  assertCiqp182EmulatorOnly, seedCiqp182EmulatorFixture,
} from '@/scripts/ops/ciqp182-seed-hospital0-emulator';
import { inspectCiqpHostedStagingReadOnly } from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';
import { inspectCiqpSnapshotOutboxEvidence } from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';
import { fingerprintCiqpImmutableTenant } from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';

describe('CIQP-182 synthetic Hospital0 fixture (disposable Firestore emulator only)', () => {
  test('fail closed before Firebase init for hosted or ambiguous runtime', () => {
    const good: NodeJS.ProcessEnv = {
      GHIMS_RUNTIME_MODE: 'TEST', NODE_ENV: 'test',
      FIREBASE_PROJECT_ID: 'ghims-p4-ci',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    };
    expect(() => assertCiqp182EmulatorOnly(good)).not.toThrow();
    for (const changes of [
      { GHIMS_RUNTIME_MODE: 'STAGING' },
      { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
      { NODE_ENV: 'production' },
      { FIREBASE_PROJECT_ID: 'studio-1130431360-48a05' },
      { FIRESTORE_EMULATOR_HOST: undefined },
      { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
      { VERCEL: '1' },
      { FIREBASE_PRIVATE_KEY: 'must-not-be-present' },
      { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/service-key.json' },
    ]) {
      expect(() => assertCiqp182EmulatorOnly({ ...good, ...changes }))
        .toThrow('CIQP182_FIXTURE_EMULATOR_ONLY_NO_HOSTED_FIRESTORE');
    }
  });

  test('seed produces canonical Patient 360, events, audit, snapshot and outbox lineage', async () => {
    assertCiqp182EmulatorOnly(process.env);
    const result = await seedCiqp182EmulatorFixture();
    expect(result).toMatchObject({
      fixtureVersion: CIQP182_FIXTURE_VERSION,
      registeredPatients: 1, projectionCount: 1,
      snapshotCount: 1, hostedWritesPerformed: false,
    });
    expect(result.eventCount).toBeGreaterThan(0);
    expect(result.outboxCount).toBeGreaterThan(0);
    const db = getAdminFirestore();
    if (!db) throw Error('CIQP182_FIXTURE_EMULATOR_UNAVAILABLE');
    const tenant = db.collection('tenants').doc(CIQP182_FIXTURE_TENANT);
    const tenantDoc = await tenant.get();
    expect(tenantDoc.data()).toMatchObject({
      syntheticOnly: true, clinicalUseAllowed: false,
      provenanceStatus: 'PENDING_REVIEW',
    });
    expect((await tenant.collection('patients').doc(CIQP182_FIXTURE_PATIENT).get()).exists).toBe(true);
    expect((await tenant.collection('audit_logs').get()).size).toBeGreaterThan(0);
    const sha = 'a'.repeat(40);
    const hmac = 'emulator-only-non-secret-key-material-for-tests';
    const report = await inspectCiqpHostedStagingReadOnly(db, {
      projectId: 'ghims-p4-ci', tenantId: CIQP182_FIXTURE_TENANT, expectedSha: sha,
    }, hmac);
    expect(report).toMatchObject({
      gate: 'COHORT_MATCHED_ONLY',
      registeredPatientsObserved: 1,
      cohortCoverage: 'MATCHED',
      missingPatientProjections: 0,
      orphanPatientProjections: 0,
      inspected: 1, failures: 0, truncated: false,
      writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
    });
    expect(report.classificationCounts).toEqual({ CURRENT_POLICY_MATCH: 1 });
    const evidence = await inspectCiqpSnapshotOutboxEvidence(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(evidence).toMatchObject({
      snapshotCount: 1, writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
      duplicateDispatchEvidence: 'REQUIRES_INDEPENDENT_CONSUMER_REHEARSAL',
    });
    expect(evidence.outboxCount).toBeGreaterThan(0);
    const immutable = await fingerprintCiqpImmutableTenant(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(immutable.eventCount).toBe(result.eventCount);
    expect(immutable.outboxCount).toBe(result.outboxCount);
    for (const serialized of [JSON.stringify(result), JSON.stringify(report), JSON.stringify(evidence)]) {
      expect(serialized).not.toContain(CIQP182_FIXTURE_PATIENT);
      expect(serialized).not.toContain(CIQP182_FIXTURE_TENANT);
    }

    // Reproduce the previous 60-second duplicate-seed timeout with a
    // fail-fast preflight and a stable error. No clinical/source row may be
    // overwritten or duplicated when the second call is rejected.
    const duplicateStart = Date.now();
    await expect(seedCiqp182EmulatorFixture())
      .rejects.toThrow('CIQP182_FIXTURE_TENANT_ALREADY_EXISTS');
    expect(Date.now() - duplicateStart).toBeLessThan(10000);
    const afterDuplicate = await fingerprintCiqpImmutableTenant(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(afterDuplicate.eventCount).toBe(immutable.eventCount);
    expect(afterDuplicate.outboxCount).toBe(immutable.outboxCount);
    expect((await tenant.collection('patients').get()).size).toBe(1);
    expect((await tenant.collection('clinicalIntelligenceEvidenceSnapshots').get()).size).toBe(1);
    expect((await tenant.collection('audit_logs').get()).size).toBeGreaterThan(0);

    // Simulate a lost Patient 360 read-model document in the disposable
    // emulator (never hosted). The bounded census must fail closed even
    // though authoritative patient registration remains present.
    await tenant.collection('patient360Projections')
      .doc(CIQP182_FIXTURE_PATIENT).delete();
    const missingProjection = await inspectCiqpHostedStagingReadOnly(db, {
      projectId: 'ghims-p4-ci', tenantId: CIQP182_FIXTURE_TENANT,
      expectedSha: sha,
    }, hmac);
    expect(missingProjection).toMatchObject({
      gate: 'BLOCKED',
      cohortCoverage: 'MISSING_PROJECTIONS',
      registeredPatientsObserved: 1,
      missingPatientProjections: 1,
      orphanPatientProjections: 0,
      writesPerformed: 0,
      releaseAuthorization: 'NOT_GRANTED',
    });

    // Recover exclusively via the authoritative projection service.
    // A recovered projection must pass census/parity inspection without
    // duplicating source clinical events or dispatch outbox records.
    const recoveredProjection = await Patient360ProjectionService.rebuildPatient(
      CIQP182_FIXTURE_TENANT, CIQP182_FIXTURE_PATIENT
    );
    expect(recoveredProjection.timelineReady).toBe(true);
    expect(recoveredProjection.contentHash).toBeTruthy();
    const recoveredReport = await inspectCiqpHostedStagingReadOnly(db, {
      projectId: 'ghims-p4-ci', tenantId: CIQP182_FIXTURE_TENANT,
      expectedSha: sha,
    }, hmac);
    expect(recoveredReport).toMatchObject({
      gate: 'COHORT_MATCHED_ONLY',
      cohortCoverage: 'MATCHED',
      registeredPatientsObserved: 1,
      missingPatientProjections: 0,
      orphanPatientProjections: 0,
      inspected: 1, failures: 0,
      writesPerformed: 0,
      releaseAuthorization: 'NOT_GRANTED',
    });
    expect(recoveredReport.classificationCounts).toEqual({
      CURRENT_POLICY_MATCH: 1,
    });
    const afterRecovery = await fingerprintCiqpImmutableTenant(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(afterRecovery.eventCount).toBe(immutable.eventCount);
    expect(afterRecovery.outboxCount).toBe(immutable.outboxCount);
    for (const serialized of [
      JSON.stringify(missingProjection),
      JSON.stringify(recoveredReport),
    ]) {
      expect(serialized).not.toContain(CIQP182_FIXTURE_PATIENT);
      expect(serialized).not.toContain(CIQP182_FIXTURE_TENANT);
    }

    // M2 multi-domain persistence: these additional source rows exist only in
    // the disposable emulator. They are NOT governed clinical commands and
    // therefore cannot be used to certify role-based clinical writes.
    const patientId = CIQP182_FIXTURE_PATIENT;
    const now = Date.now() + 1000;
    const provenance = (id: string) => ({
      provenanceId: 'ciqp-emulator-' + id,
      tenantId: CIQP182_FIXTURE_TENANT, patientId,
      sourceEvidenceId: id, sourceType: 'SYNTHETIC_TEST',
      recordedBy: 'ciqp-emulator-only', recordedAt: now,
    });
    const facts: Array<[string, string, Record<string, unknown>]> = [
      ['clinicalObservations', 'ciqp-vital-001', {
        observationId: 'ciqp-vital-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT, category: 'VITAL_SIGNS',
        code: { text: 'Heart rate', codings: [{ system: 'LOINC', code: '8867-4' }] },
        value: { valueType: 'QUANTITY', quantity: { value: 82, unit: '/min' } },
        status: 'FINAL', effectiveAt: now, updatedAt: now, version: 1,
        provenance: provenance('ciqp-vital-001'),
      }],
      ['clinicalAllergies', 'ciqp-allergy-001', {
        allergyId: 'ciqp-allergy-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT,
        substance: { text: 'Penicillin', codings: [{ system: 'LOCAL', code: 'PEN' }] },
        category: 'MEDICATION', type: 'ALLERGY', clinicalStatus: 'ACTIVE',
        verificationStatus: 'CONFIRMED', criticality: 'HIGH',
        recordedAt: now, updatedAt: now, version: 1,
        provenance: provenance('ciqp-allergy-001'),
      }],
      ['medicationOrders', 'ciqp-medication-001', {
        medicationOrderId: 'ciqp-medication-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT,
        medication: { text: 'Synthetic prescription', codings: [{ system: 'LOCAL', code: 'SYN' }] },
        status: 'ACTIVE', intent: 'ORDER', dosageText: 'Emulator test only',
        prescribedBy: 'ciqp-emulator-only', authoredAt: now, updatedAt: now, version: 1,
        provenance: provenance('ciqp-medication-001'),
      }],
      ['canonicalDiagnosticOrders', 'ciqp-order-001', {
        diagnosticOrderId: 'ciqp-order-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT,
        service: { text: 'Synthetic blood test', codings: [{ system: 'LOCAL', code: 'TEST' }] },
        orderType: 'LAB', status: 'COMPLETED', priority: 'ROUTINE',
        orderedBy: 'ciqp-emulator-only', orderedAt: now, updatedAt: now, version: 1,
        provenance: provenance('ciqp-order-001'),
      }],
      ['diagnosticReports', 'ciqp-report-001', {
        diagnosticReportId: 'ciqp-report-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT,
        orderId: 'ciqp-order-001',
        code: { text: 'Synthetic blood test' }, category: 'LAB',
        status: 'FINAL', issuedAt: now, resultObservationIds: [],
        updatedAt: now, version: 1,
        provenance: provenance('ciqp-report-001'),
      }],
      ['clinicalDocuments', 'ciqp-document-001', {
        clinicalDocumentId: 'ciqp-document-001', patientId,
        tenantId: CIQP182_FIXTURE_TENANT,
        documentType: 'SOAP', title: 'Emulator-only signed note',
        status: 'FINAL', signedBy: 'ciqp-emulator-only', signedAt: now,
        updatedAt: now, version: 1,
        provenance: provenance('ciqp-document-001'),
      }],
    ];
    const batch = db.batch();
    for (const [collection, id, data] of facts) {
      batch.create(tenant.collection(collection).doc(id), data);
    }
    for (const [i, eventType] of [
      'VITALS_RECORDED', 'CLINICAL_ALLERGY_RECORDED', 'MEDICATION_PRESCRIBED',
      'INVESTIGATION_ORDERED', 'DIAGNOSTIC_RESULT_VERIFIED', 'CLINICAL_NOTE_SIGNED',
    ].entries()) {
      const eventId = 'ciqp-clinical-event-' + String(i + 1);
      const envelope = {
        eventId, eventType, patientId, tenantId: CIQP182_FIXTURE_TENANT,
        aggregateType: 'PATIENT', aggregateId: patientId,
        payload: { patientId }, occurredAt: now + i, recordedAt: now + i,
      };
      batch.create(tenant.collection('events').doc(eventId), envelope);
      batch.create(tenant.collection('audit_logs').doc(eventId), {
        ...envelope, auditId: eventId, immutable: true,
      });
      batch.create(tenant.collection('outbox').doc(eventId), {
        ...envelope, outboxId: eventId, status: 'PENDING', createdAt: now + i,
      });
    }
    await batch.commit();
    const clinicalRebuild = await Patient360ProjectionService.rebuildPatient(
      CIQP182_FIXTURE_TENANT, patientId
    );
    expect(clinicalRebuild.timelineReady).toBe(true);
    const clinicalSnapshot = await tenant.collection('patient360Projections').doc(patientId).get();
    const clinical = clinicalSnapshot.data();
    expect(clinical).toBeDefined();
    expect(clinical?.latestVitals).toEqual([
      expect.objectContaining({ observationId: 'ciqp-vital-001' }),
    ]);
    expect(clinical?.allergies).toEqual([
      expect.objectContaining({ allergyId: 'ciqp-allergy-001', criticality: 'HIGH' }),
    ]);
    expect(clinical?.currentMedications).toEqual([
      expect.objectContaining({ medicationOrderId: 'ciqp-medication-001', status: 'ACTIVE' }),
    ]);
    expect(clinical?.recentDiagnosticOrders).toEqual([
      expect.objectContaining({ diagnosticOrderId: 'ciqp-order-001' }),
    ]);
    expect(clinical?.recentResults).toEqual([
      expect.objectContaining({ diagnosticReportId: 'ciqp-report-001' }),
    ]);
    expect(clinical?.recentDocuments).toEqual([
      expect.objectContaining({
        clinicalDocumentId: 'ciqp-document-001', documentType: 'SOAP',
        status: 'FINAL', signedBy: 'ciqp-emulator-only',
      }),
    ]);
    expect(clinical?.counts).toMatchObject({
      observations: 1, allergies: 1, medicationOrders: 1,
      diagnosticOrders: 1, diagnosticReports: 1, documents: 1,
    });
  });
});
