import { describe, expect, test } from 'bun:test';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { OutboxDispatcher } from '@/lib/backend/outbox/dispatcher';
import { ProjectionWorkers } from '@/lib/backend/projections/projection-workers';
import { ProjectionRecoveryService } from '@/lib/backend/recovery/projection-recovery-service';
import type { CommandContext } from '@/lib/backend/types';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function command(
  tenantId: string,
  commandType: string,
  payload: Record<string, unknown>,
  idempotencyKey = unique('idem')
) {
  return {
    commandId: unique('cmd'),
    idempotencyKey,
    tenantId,
    commandType,
    payload,
    schemaVersion: 1,
  };
}

function clinicalContext(tenantId: string): CommandContext {
  return {
    actorId: 'p4-doctor',
    tenantId,
    roles: ['DOCTOR'],
    permissions: ['CLINICAL_WRITE'],
    clinicalPrivileges: [
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'PRESCRIBE',
      'SIGN_CLINICAL_NOTES',
    ],
    correlationId: unique('corr'),
    requestId: unique('req'),
  };
}

function financeContext(tenantId: string): CommandContext {
  return {
    actorId: 'p4-accountant',
    tenantId,
    roles: ['ACCOUNTANT'],
    permissions: ['FINANCE_WRITE'],
    correlationId: unique('corr'),
    requestId: unique('req'),
  };
}

describe('G-HIMS P4 release-candidate Firestore recovery journey', () => {
  test('synthetic patient journey survives outbox crash and deterministic projection rebuild', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant_p4');
    const patientId = unique('pat');
    const cnic = String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 9));
    const tenantRef = db.collection('tenants').doc(tenantId);

    const registration = await registerPatientAndEncounter({
      tenantId,
      commandId: unique('cmd_register'),
      idempotencyKey: unique('idem_register'),
      patientId,
      fullName: 'P4 Synthetic Patient',
      gender: 'other',
      dateOfBirth: '1990-01-01',
      identifiers: [{ type: 'CNIC', value: cnic }],
      contactPhone: '+920000000000',
      address: 'Synthetic test address',
      encounterType: 'OPD',
      department: 'General Medicine',
      priority: 'ROUTINE',
      chiefComplaint: 'Synthetic release-candidate journey',
      assignedDoctor: 'p4-doctor',
      actorId: 'p4-reception',
      actorRole: 'RECEPTIONIST',
      actorName: 'P4 Reception',
    });

    const encounterId = registration.encounter.id;
    const clinician = clinicalContext(tenantId);

    const vitals = await CommandBus.dispatch(
      clinician,
      command(tenantId, 'RecordVitalsCommand', {
        encounterId,
        patientId,
        heartRate: 78,
        bloodPressure: '118/76',
        temperature: 36.8,
        respiratoryRate: 16,
        oxygenSaturation: 98,
      })
    );
    expect(vitals.success).toBe(true);

    const note = await CommandBus.dispatch(
      clinician,
      command(tenantId, 'SignClinicalNoteCommand', {
        encounterId,
        patientId,
        category: 'SOAP',
        content:
          'Synthetic patient assessed. Stable vitals. Lab investigation and medication plan documented.',
        acceptedStructuredData: {
          billingCodes: [
            {
              code: 'P4-SVC-001',
              description: 'Synthetic consultation service',
              fee: 25,
            },
          ],
        },
      })
    );
    expect(note.success).toBe(true);

    const lab = await CommandBus.dispatch(
      clinician,
      command(tenantId, 'PlaceDiagnosticOrderCommand', {
        encounterId,
        patientId,
        orderType: 'LAB',
        catalogCode: 'CBC',
        orderName: 'Complete Blood Count',
        priority: 'ROUTINE',
        clinicalIndication: 'Synthetic release-candidate validation',
        estimatedCostMinorUnits: 1500,
      })
    );
    expect(lab.success).toBe(true);

    const prescriptionKey = unique('idem_rx');
    const prescriptionCommand = command(
      tenantId,
      'PrescribeMedicationCommand',
      {
        encounterId,
        patientId,
        drugCode: 'PARA500',
        drugName: 'Paracetamol 500mg',
        dosage: '500 mg',
        route: 'PO',
        frequency: 'TID PRN',
        durationDays: 3,
        instructions: 'Synthetic journey only',
      },
      prescriptionKey
    );
    const prescription = await CommandBus.dispatch(
      clinician,
      prescriptionCommand
    );
    expect(prescription.success).toBe(true);

    const prescriptionReplay = await CommandBus.dispatch(clinician, {
      ...prescriptionCommand,
      commandId: unique('cmd_rx_replay'),
    });
    expect(prescriptionReplay.success).toBe(true);
    expect(prescriptionReplay.replayedFromCache).toBe(true);
    expect(prescriptionReplay.entityId).toBe(prescription.entityId);

    const now = Date.now();
    const journal = await CommandBus.dispatch(
      financeContext(tenantId),
      command(tenantId, 'PostJournalCommand', {
        fiscalYear: 2026,
        postingPeriod: 9,
        documentDate: now,
        postingDate: now,
        referenceDocumentId: encounterId,
        documentHeader: 'P4 synthetic encounter financial posting',
        currency: 'PKR',
        lines: [
          {
            glAccountId: '1100-AR-CASH',
            glAccountName: 'Cash / Receivable',
            debitMinorUnits: 4000,
            creditMinorUnits: 0,
            lineDescription: 'Synthetic patient service debit',
          },
          {
            glAccountId: '4100-CLINICAL-REV',
            glAccountName: 'Clinical Service Revenue',
            debitMinorUnits: 0,
            creditMinorUnits: 4000,
            lineDescription: 'Synthetic patient service revenue',
          },
        ],
      })
    );
    expect(journal.success).toBe(true);

    // Simulate a worker crash after claiming the lab outbox record.
    expect(lab.outboxId).toBeTruthy();
    await tenantRef.collection('outbox').doc(String(lab.outboxId)).set(
      {
        status: 'PROCESSING',
        attempts: 1,
        processingStartedAt: Date.now() - 120_000,
        leaseExpiresAt: Date.now() - 1,
      },
      { merge: true }
    );

    const relay = await OutboxDispatcher.relayPendingOutbox(tenantId);
    expect(relay.failedCount).toBe(0);
    expect(relay.deadLetterCount).toBe(0);
    expect(relay.dispatchedCount).toBeGreaterThanOrEqual(6);

    const [events, audits, outboxSnapshot] = await Promise.all([
      TransactionManager.getEvents(tenantId),
      TransactionManager.getAudits(tenantId),
      tenantRef.collection('outbox').get(),
    ]);

    expect(events.length).toBe(6);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(6);
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'PATIENT_REGISTERED',
        'VITALS_RECORDED',
        'CLINICAL_NOTE_SIGNED',
        'INVESTIGATION_ORDERED',
        'MEDICATION_PRESCRIBED',
        'JOURNAL_ENTRY_POSTED',
      ])
    );
    expect(audits.length).toBeGreaterThanOrEqual(6);
    expect(outboxSnapshot.size).toBe(6);
    for (const document of outboxSnapshot.docs) {
      expect(document.data().status).toBe('PUBLISHED');
    }

    const [queue, timeline, ledger, registrationEvent] = await Promise.all([
      tenantRef.collection('clinicalQueues').doc(encounterId).get(),
      tenantRef.collection('timelineProjections').get(),
      tenantRef
        .collection('generalLedgerProjections')
        .doc('universal-journal-balance')
        .get(),
      tenantRef
        .collection('events')
        .where('eventType', '==', 'PATIENT_REGISTERED')
        .get(),
    ]);

    expect(registrationEvent.size).toBe(1);
    expect(queue.data()?.stage).toBe('REGISTRATION');
    expect(timeline.size).toBe(2);
    expect(ledger.data()?.totalDebits).toBe(4000);
    expect(ledger.data()?.totalCredits).toBe(4000);

    const previousAllow = process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD;
    const previousConfirm = process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT;
    process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD = 'true';
    process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT = tenantId;

    try {
      const firstRebuild =
        await ProjectionRecoveryService.rebuildTenantInIsolatedEnvironment(
          tenantId
        );
      const secondRebuild =
        await ProjectionRecoveryService.rebuildTenantInIsolatedEnvironment(
          tenantId
        );

      expect(firstRebuild.eventCount).toBe(6);
      expect(firstRebuild.checkpointCount).toBe(6);
      expect(secondRebuild.eventCount).toBe(6);
      expect(secondRebuild.checkpointCount).toBe(6);
      expect(secondRebuild.eventStreamSha256).toBe(
        firstRebuild.eventStreamSha256
      );
      expect(secondRebuild.projectionSha256).toBe(
        firstRebuild.projectionSha256
      );
    } finally {
      if (previousAllow === undefined) {
        delete process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD;
      } else {
        process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD = previousAllow;
      }
      if (previousConfirm === undefined) {
        delete process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT;
      } else {
        process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT = previousConfirm;
      }
    }

    const [patientAfter, encounterAfter, orderAfter, prescriptionAfter, journalAfter] =
      await Promise.all([
        tenantRef.collection('patients').doc(patientId).get(),
        tenantRef.collection('encounters').doc(encounterId).get(),
        tenantRef.collection('orders').doc(String(lab.entityId)).get(),
        tenantRef
          .collection('prescriptions')
          .doc(String(prescription.entityId))
          .get(),
        tenantRef.collection('journalEntries').doc(String(journal.entityId)).get(),
      ]);

    expect(patientAfter.exists).toBe(true);
    expect(encounterAfter.exists).toBe(true);
    expect(orderAfter.exists).toBe(true);
    expect(prescriptionAfter.exists).toBe(true);
    expect(journalAfter.exists).toBe(true);
  });

  test('cross-tenant rebuild validation leaves existing projection data untouched', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant_guard');
    const sentinelRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('clinicalQueues')
      .doc('sentinel');

    await sentinelRef.set({
      encounterId: 'sentinel',
      tenantId,
      stage: 'SAFE',
      lastEventId: 'evt-sentinel',
    });

    await expect(
      ProjectionWorkers.rebuildProjections(
        [
          {
            eventId: 'evt-a',
            tenantId,
            eventType: 'ENCOUNTER_CREATED',
            payload: { patientId: 'pat-a', encounterId: 'enc-a' },
            occurredAt: 1,
          },
          {
            eventId: 'evt-b',
            tenantId: unique('other_tenant'),
            eventType: 'ENCOUNTER_CREATED',
            payload: { patientId: 'pat-b', encounterId: 'enc-b' },
            occurredAt: 2,
          },
        ],
        { expectedTenantId: tenantId, allowDestructive: true }
      )
    ).rejects.toThrow(/PROJECTION_REBUILD_TENANT_SCOPE_INVALID/);

    expect((await sentinelRef.get()).exists).toBe(true);
    expect((await sentinelRef.get()).data()?.stage).toBe('SAFE');
  });

  test('projection recovery refuses an in-place production run before Firestore mutation', async () => {
    const previousMode = process.env.GHIMS_RUNTIME_MODE;
    const previousAllow = process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD;
    const previousConfirm = process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT;
    const tenantId = unique('tenant_prod_guard');

    process.env.GHIMS_RUNTIME_MODE = 'PRODUCTION';
    process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD = 'true';
    process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT = tenantId;

    try {
      await expect(
        ProjectionRecoveryService.rebuildTenantInIsolatedEnvironment(tenantId)
      ).rejects.toThrow(/PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION/);
    } finally {
      if (previousMode === undefined) delete process.env.GHIMS_RUNTIME_MODE;
      else process.env.GHIMS_RUNTIME_MODE = previousMode;

      if (previousAllow === undefined) {
        delete process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD;
      } else {
        process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD = previousAllow;
      }

      if (previousConfirm === undefined) {
        delete process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT;
      } else {
        process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT = previousConfirm;
      }
    }
  });
});
