import { describe, expect, test } from 'bun:test';
import { IdempotencyService } from '@/lib/backend/idempotency/idempotency-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { CommandContext } from '@/lib/backend/types';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { OutboxDispatcher } from '@/lib/backend/outbox/dispatcher';
import { ProjectionWorkers } from '@/lib/backend/projections/projection-workers';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function context(tenantId: string): CommandContext {
  return {
    actorId: 'test-doctor',
    tenantId,
    roles: ['DOCTOR'],
    permissions: ['CLINICAL_WRITE'],
    clinicalPrivileges: ['ORDER_DIAGNOSTICS', 'SIGN_CLINICAL_NOTES'],
    correlationId: unique('corr'),
    requestId: unique('req'),
  };
}

describe('G-HIMS P1 durable command infrastructure', () => {
  test('idempotency uses deterministic SHA-256 request hashes', () => {
    const a = IdempotencyService.computeHash('CreateEncounterCommand', {
      patientId: 'pat-1',
      priority: 'ROUTINE',
    });
    const b = IdempotencyService.computeHash('CreateEncounterCommand', {
      priority: 'ROUTINE',
      patientId: 'pat-1',
    });

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test('durable idempotency reservation detects in-flight replay and conflicting reuse', async () => {
    const tenantId = unique('tenant');
    const key = unique('idem');
    const payload = { patientId: 'pat-1', encounterType: 'OPD' };

    const first = await IdempotencyService.acquireExecution(
      tenantId,
      key,
      'CreateEncounterCommand',
      payload,
      unique('cmd')
    );
    expect(first.status).toBe('NEW');

    const replay = await IdempotencyService.acquireExecution(
      tenantId,
      key,
      'CreateEncounterCommand',
      payload,
      unique('cmd')
    );
    expect(replay.status).toBe('IN_PROGRESS');

    const conflict = await IdempotencyService.acquireExecution(
      tenantId,
      key,
      'CreateEncounterCommand',
      { patientId: 'different-patient', encounterType: 'EMERGENCY' },
      unique('cmd')
    );
    expect(conflict.status).toBe('CONFLICT');
  });

  test('domain state, event, audit, outbox and idempotency completion commit together', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const entityId = unique('enc');
    const payload = { patientId: 'pat-atomic', encounterType: 'OPD' };

    const reservation = await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload,
      commandId
    );
    expect(reservation.status).toBe('NEW');

    const tx = await TransactionManager.executeAtomicWrite(
      context(tenantId),
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER',
        entityId,
        eventType: 'EncounterCreatedEvent',
        domainState: {
          id: entityId,
          patientId: 'pat-atomic',
          status: 'IN_PROGRESS',
          currentStage: 'REGISTRATION',
        },
        eventPayload: payload,
      }
    );

    const tenantRef = db.collection('tenants').doc(tenantId);
    const [state, event, audit, outbox, idem] = await Promise.all([
      tenantRef.collection('encounters').doc(entityId).get(),
      tenantRef.collection('events').doc(tx.event.eventId).get(),
      tenantRef.collection('audit_logs').doc(tx.audit.auditId).get(),
      tenantRef.collection('outbox').doc(tx.outbox.outboxId).get(),
      tenantRef.collection('idempotency').doc(
        IdempotencyService.getDocumentId(idempotencyKey)
      ).get(),
    ]);

    expect(state.exists).toBe(true);
    expect(event.exists).toBe(true);
    expect(audit.exists).toBe(true);
    expect(outbox.exists).toBe(true);
    expect(idem.exists).toBe(true);
    expect(idem.data()?.status).toBe('COMPLETED');
    expect(idem.data()?.result?.eventId).toBe(tx.event.eventId);

    const replay = await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload,
      unique('cmd')
    );
    expect(replay.status).toBe('CACHED');
    expect(replay.record?.result?.entityId).toBe(entityId);
  });

  test('transaction failure leaves no partial domain state', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const entityId = unique('enc');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const eventPayload = { patientId: 'pat-rollback' };

    const reservation = await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'EncounterCreatedEvent',
      eventPayload,
      commandId
    );
    expect(reservation.status).toBe('NEW');

    await expect(
      TransactionManager.executeAtomicMutation({
        tenantId,
        actorId: 'test-doctor',
        actorRole: 'DOCTOR',
        aggregateType: 'ENCOUNTER',
        aggregateId: entityId,
        eventType: 'EncounterCreatedEvent',
        eventPayload,
        domainState: { id: entityId, patientId: 'pat-rollback' },
        additionalStateWrites: [
          {
            entityType: 'UNMAPPED_TEST_ENTITY',
            entityId: 'bad-state',
            domainState: { unsafe: true },
          },
        ],
        commandId,
        idempotencyKey,
        correlationId: unique('corr'),
      })
    ).rejects.toThrow('UNMAPPED_DOMAIN_ENTITY_TYPE');

    const state = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounters')
      .doc(entityId)
      .get();

    expect(state.exists).toBe(false);
  });



  test('patient registration is atomically idempotent across replay', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const phone = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;

    const input = {
      tenantId,
      commandId,
      idempotencyKey,
      fullName: 'Replay Safe Patient',
      gender: 'female' as const,
      dateOfBirth: '1990-01-01',
      identifiers: [{ type: 'PHONE' as const, value: phone, issuer: 'P1 Test' }],
      contactPhone: phone,
      address: 'P1 Test Address',
      encounterType: 'OPD' as const,
      department: 'General OPD',
      priority: 'ROUTINE' as const,
      chiefComplaint: 'P1 registration replay test',
      actorId: 'test-registrar',
      actorRole: 'RECEPTIONIST',
      actorName: 'Test Registrar',
      bloodGroup: 'O+',
      allergies: [],
      chronicConditions: [],
    };

    const first = await registerPatientAndEncounter(input);
    const replay = await registerPatientAndEncounter({
      ...input,
      commandId: unique('retry_cmd'),
    });

    expect(replay.patient.id).toBe(first.patient.id);
    expect(replay.patient.mrn).toBe(first.patient.mrn);
    expect(replay.encounter.id).toBe(first.encounter.id);

    const patientSnapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('patients')
      .where('contactPhone', '==', phone)
      .get();

    expect(patientSnapshot.size).toBe(1);

    const idem = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('idempotency')
      .doc(IdempotencyService.getDocumentId(idempotencyKey))
      .get();

    expect(idem.data()?.status).toBe('COMPLETED');
    expect(idem.data()?.result?.data?.patient?.id).toBe(first.patient.id);

    const queueBefore = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('opd_queue')
      .doc(first.queueToken.id)
      .get();

    expect(queueBefore.exists).toBe(true);
    expect(queueBefore.data()?.status).toBe('waiting');

    const called = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'UpdateOpdQueueStatusCommand',
      schemaVersion: 1,
      payload: {
        tokenId: first.queueToken.id,
        targetStatus: 'in_consultation',
      },
    });
    expect(called.success).toBe(true);

    const completed = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'UpdateOpdQueueStatusCommand',
      schemaVersion: 1,
      payload: {
        tokenId: first.queueToken.id,
        targetStatus: 'completed',
      },
    });
    expect(completed.success).toBe(true);

    const queueAfter = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('opd_queue')
      .doc(first.queueToken.id)
      .get();
    expect(queueAfter.data()?.status).toBe('completed');
  });


  test('RecordVitalsCommand persists final encounter evidence through the command bus', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const encounterId = unique('enc');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('encounters').doc(encounterId).set({
      encounterId,
      tenantId,
      patientId,
      status: 'ACTIVE',
      currentStage: 'TRIAGE',
    });

    const result = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'RecordVitalsCommand',
      schemaVersion: 1,
      payload: {
        encounterId,
        patientId,
        heartRate: 82,
        bloodPressure: '118/76',
        temperature: 36.8,
        respiratoryRate: 16,
        oxygenSaturation: 99,
      },
    });

    expect(result.success).toBe(true);
    expect(result.entityId).toBeTruthy();

    const evidence = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounterEvidence')
      .doc(result.entityId!)
      .get();

    expect(evidence.exists).toBe(true);
    expect(evidence.data()?.evidenceType).toBe('VITALS');
    expect(evidence.data()?.status).toBe('FINAL');
  });

  test('SignClinicalNoteCommand persists clinician-accepted final evidence', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const encounterId = unique('enc');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('encounters').doc(encounterId).set({
      encounterId,
      tenantId,
      patientId,
      status: 'ACTIVE',
      currentStage: 'CONSULTATION',
    });

    const result = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'SignClinicalNoteCommand',
      schemaVersion: 1,
      payload: {
        encounterId,
        patientId,
        category: 'SOAP',
        content: 'Patient reviewed. Assessment and plan documented by clinician.',
        acceptedStructuredData: {
          chiefComplaint: 'Follow-up',
        },
      },
    });

    expect(result.success).toBe(true);

    const evidence = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounterEvidence')
      .doc(result.entityId!)
      .get();

    expect(evidence.exists).toBe(true);
    expect(evidence.data()?.evidenceType).toBe('SIGNED_CLINICAL_NOTE');
    expect(evidence.data()?.status).toBe('FINAL');
    expect(evidence.data()?.signedBy).toBe('test-doctor');
  });

  test('durable transaction rejects commits without an idempotency reservation', async () => {
    const tenantId = unique('tenant');
    const entityId = unique('enc');

    await expect(
      TransactionManager.executeAtomicWrite(
        context(tenantId),
        unique('cmd'),
        unique('idem'),
        {
          entityType: 'ENCOUNTER',
          entityId,
          eventType: 'EncounterCreatedEvent',
          domainState: { id: entityId, status: 'IN_PROGRESS' },
          eventPayload: { patientId: 'pat-no-reservation' },
        }
      )
    ).rejects.toThrow('IDEMPOTENCY_RESERVATION_MISSING');
  });

  test('outbox claim is exclusive across concurrent workers', async () => {
    const tenantId = unique('tenant');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const payload = { patientId: 'pat-outbox', encounterType: 'OPD' };

    await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload,
      commandId
    );

    const tx = await TransactionManager.executeAtomicWrite(
      context(tenantId),
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER',
        entityId: unique('enc'),
        eventType: 'EncounterCreatedEvent',
        domainState: { status: 'IN_PROGRESS' },
        eventPayload: payload,
      }
    );

    const [claimA, claimB] = await Promise.all([
      TransactionManager.claimOutbox(tenantId, tx.outbox.outboxId),
      TransactionManager.claimOutbox(tenantId, tx.outbox.outboxId),
    ]);

    const successfulClaims = [claimA, claimB].filter(Boolean);
    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]?.status).toBe('PROCESSING');
    expect(successfulClaims[0]?.attempts).toBe(1);

    await TransactionManager.updateOutbox(tenantId, tx.outbox.outboxId, {
      status: 'PUBLISHED',
      publishedAt: Date.now(),
    });

    const secondClaim = await TransactionManager.claimOutbox(
      tenantId,
      tx.outbox.outboxId
    );
    expect(secondClaim).toBeNull();
  });

  test('expired PROCESSING outbox lease can be reclaimed after worker crash', async () => {
    const tenantId = unique('tenant');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const payload = { patientId: 'pat-outbox-recovery', encounterType: 'OPD' };

    await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload,
      commandId
    );

    const tx = await TransactionManager.executeAtomicWrite(
      context(tenantId),
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER',
        entityId: unique('enc'),
        eventType: 'EncounterCreatedEvent',
        domainState: { status: 'IN_PROGRESS' },
        eventPayload: payload,
      }
    );

    const firstClaim = await TransactionManager.claimOutbox(tenantId, tx.outbox.outboxId);
    expect(firstClaim?.status).toBe('PROCESSING');
    expect(firstClaim?.leaseExpiresAt).toBeGreaterThan(Date.now());

    await TransactionManager.updateOutbox(tenantId, tx.outbox.outboxId, {
      status: 'PROCESSING',
      leaseExpiresAt: Date.now() - 1,
    });

    const reclaimed = await TransactionManager.claimOutbox(tenantId, tx.outbox.outboxId);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe('PROCESSING');
    expect(reclaimed?.attempts).toBe(2);
    expect(reclaimed?.leaseExpiresAt).toBeGreaterThan(Date.now());
  });

  test('outbox is published only after durable projection checkpoint and read models commit', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const encounterId = unique('enc');
    const patientId = unique('pat');
    const commandId = unique('cmd');
    const idempotencyKey = unique('idem');
    const payload = {
      encounterId,
      patientId,
      encounterType: 'OPD',
      chiefComplaint: 'Projection durability test',
      priority: 'ROUTINE',
    };

    await IdempotencyService.acquireExecution(
      tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload,
      commandId
    );

    const tx = await TransactionManager.executeAtomicWrite(
      context(tenantId),
      commandId,
      idempotencyKey,
      {
        entityType: 'ENCOUNTER',
        entityId: encounterId,
        eventType: 'ENCOUNTER_CREATED',
        domainState: {
          encounterId,
          tenantId,
          patientId,
          status: 'ACTIVE',
          currentStage: 'TRIAGE',
        },
        eventPayload: payload,
      }
    );

    const relay = await OutboxDispatcher.relayPendingOutbox(tenantId);
    expect(relay.dispatchedCount).toBe(1);

    const tenantRef = db.collection('tenants').doc(tenantId);
    const [outbox, checkpoint, timeline, queue] = await Promise.all([
      tenantRef.collection('outbox').doc(tx.outbox.outboxId).get(),
      tenantRef.collection('projectionCheckpoints').doc(tx.event.eventId).get(),
      tenantRef.collection('timelineProjections').doc(tx.event.eventId).get(),
      tenantRef.collection('clinicalQueues').doc(encounterId).get(),
    ]);

    expect(outbox.data()?.status).toBe('PUBLISHED');
    expect(checkpoint.exists).toBe(true);
    expect(timeline.exists).toBe(true);
    expect(timeline.data()?.patientId).toBe(patientId);
    expect(queue.exists).toBe(true);
    expect(queue.data()?.stage).toBe('TRIAGE');
  });

  test('projection checkpoint prevents duplicate financial projection application', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const eventId = unique('evt');
    const event = {
      eventId,
      tenantId,
      eventType: 'JOURNAL_ENTRY_POSTED',
      payload: { totalAmountMinorUnits: 12500 },
    };

    await ProjectionWorkers.consumeEvent(event);
    await ProjectionWorkers.consumeEvent(event);

    const balance = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('generalLedgerProjections')
      .doc('universal-journal-balance')
      .get();

    expect(balance.exists).toBe(true);
    expect(balance.data()?.totalDebits).toBe(12500);
    expect(balance.data()?.totalCredits).toBe(12500);

    const checkpoints = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('projectionCheckpoints')
      .where('eventId', '==', eventId)
      .get();

    expect(checkpoints.size).toBe(1);
  });

  test('AdmitPatientToBedCommand atomically commits bed occupancy and patient active-bed state', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const bedId = unique('bed');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('beds').doc(bedId).set({
      id: bedId,
      bedNumber: 'IPD-101',
      ward: 'General',
      room: '101',
      status: 'available',
    });
    await db.collection('tenants').doc(tenantId).collection('patients').doc(patientId).set({
      id: patientId,
      mrn: 'MRN-IPD-001',
      fullName: 'P1 Inpatient',
      dateOfBirth: '1985-01-01',
      age: 41,
      gender: 'Female',
      bloodGroup: 'O+',
      contactNumber: '+10000000000',
      email: '',
      address: 'P1 Test',
      emergencyContact: { name: 'Test', relationship: 'Other', phone: '+10000000001' },
      allergies: [],
      chronicConditions: [],
      encounters: [],
      registeredAt: '2026-01-01',
    });

    const clinicalContext: CommandContext = {
      ...context(tenantId),
      clinicalPrivileges: ['ADMIT_INPATIENT', 'DISCHARGE_INPATIENT'],
    };

    const result = await CommandBus.dispatch(clinicalContext, {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'AdmitPatientToBedCommand',
      schemaVersion: 1,
      payload: {
        bedId,
        patientId,
        assignedDoctor: 'Dr Test',
        assignedNurse: 'Nurse Test',
      },
    });

    expect(result.success).toBe(true);

    const [bed, patient] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('beds').doc(bedId).get(),
      db.collection('tenants').doc(tenantId).collection('patients').doc(patientId).get(),
    ]);

    expect(bed.data()?.status).toBe('occupied');
    expect(bed.data()?.patientId).toBe(patientId);
    expect(patient.data()?.activeBedId).toBe(bedId);

    const event = await db.collection('tenants').doc(tenantId).collection('events').doc(result.eventId!).get();
    expect(event.exists).toBe(true);
    expect(event.data()?.eventType).toBe('PATIENT_ADMITTED_TO_BED');
  });

  test('DischargePatientFromBedCommand is idempotent and clears bed/patient census state once', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const bedId = unique('bed');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('beds').doc(bedId).set({
      id: bedId,
      bedNumber: 'IPD-202',
      ward: 'General',
      room: '202',
      status: 'occupied',
      patientId,
      patientName: 'P1 Discharge',
      admissionDate: '2026-09-20',
    });
    await db.collection('tenants').doc(tenantId).collection('patients').doc(patientId).set({
      id: patientId,
      mrn: 'MRN-IPD-002',
      fullName: 'P1 Discharge',
      dateOfBirth: '1980-01-01',
      age: 46,
      gender: 'Male',
      bloodGroup: 'A+',
      contactNumber: '+10000000002',
      email: '',
      address: 'P1 Test',
      emergencyContact: { name: 'Test', relationship: 'Other', phone: '+10000000003' },
      allergies: [],
      chronicConditions: [],
      activeBedId: bedId,
      encounters: [],
      registeredAt: '2026-01-01',
    });

    const clinicalContext: CommandContext = {
      ...context(tenantId),
      clinicalPrivileges: ['ADMIT_INPATIENT', 'DISCHARGE_INPATIENT'],
    };
    const idempotencyKey = unique('idem');

    const first = await CommandBus.dispatch(clinicalContext, {
      commandId: unique('cmd'),
      idempotencyKey,
      tenantId,
      commandType: 'DischargePatientFromBedCommand',
      schemaVersion: 1,
      payload: {
        bedId,
        notes: 'Clinical discharge completed.',
        disposition: 'Home',
      },
    });
    expect(first.success).toBe(true);

    const replay = await CommandBus.dispatch(clinicalContext, {
      commandId: unique('cmd'),
      idempotencyKey,
      tenantId,
      commandType: 'DischargePatientFromBedCommand',
      schemaVersion: 1,
      payload: {
        bedId,
        notes: 'Clinical discharge completed.',
        disposition: 'Home',
      },
    });

    expect(replay.success).toBe(true);
    expect(replay.replayedFromCache).toBe(true);

    const [bed, patient] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('beds').doc(bedId).get(),
      db.collection('tenants').doc(tenantId).collection('patients').doc(patientId).get(),
    ]);

    expect(bed.data()?.status).toBe('cleaning');
    expect(bed.data()?.patientId).toBeUndefined();
    expect(patient.data()?.activeBedId).toBeUndefined();

    const eventSnapshot = await db.collection('tenants').doc(tenantId).collection('events')
      .where('aggregateId', '==', bedId)
      .where('eventType', '==', 'PATIENT_DISCHARGED_FROM_BED')
      .get();
    expect(eventSnapshot.size).toBe(1);
  });


  test('signed clinical note creates server-owned Revenue Integrity candidates but no charge', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const encounterId = unique('enc');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('encounters').doc(encounterId).set({
      id: encounterId,
      tenantId,
      patientId,
      status: 'IN_PROGRESS',
      currentStageId: 'CONSULTATION',
    });

    const result = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'SignClinicalNoteCommand',
      schemaVersion: 1,
      payload: {
        encounterId,
        patientId,
        category: 'SOAP',
        content: 'Procedure documented and explicitly accepted by the signing clinician.',
        acceptedStructuredData: {
          billingCodes: [
            { code: 'CPT-99214', description: 'Established patient follow-up', fee: 95 },
          ],
        },
      },
    });

    expect(result.success).toBe(true);

    const findings = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('billingMismatches')
      .where('sourceEvidenceId', '==', result.entityId)
      .get();

    expect(findings.size).toBe(1);
    const finding = findings.docs[0].data();
    expect(finding.status).toBe('PENDING_REVIEW');
    expect(finding.estimatedRecoverableAmountMinorUnits).toBe(9500);

    const charges = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounterCharges')
      .where('sourceFindingId', '==', findings.docs[0].id)
      .get();

    expect(charges.size).toBe(0);
  });

  test('authorized revenue-cycle reconciliation atomically creates one encounter charge and is replay-safe', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const findingId = unique('ri');
    const encounterId = unique('enc');
    const patientId = unique('pat');

    await db.collection('tenants').doc(tenantId).collection('billingMismatches').doc(findingId).set({
      id: findingId,
      tenantId,
      patientId,
      encounterId,
      sourceEvidenceId: unique('evidence'),
      documentedItem: 'Missing procedural charge',
      category: 'Procedure',
      suggestedCode: 'CPT-99214',
      estimatedRecoverableAmountMinorUnits: 9500,
      currency: 'USD',
      status: 'PENDING_REVIEW',
      evidenceSnippet: 'Signed clinician evidence',
      createdAt: Date.now(),
      createdBy: 'test-doctor',
    });

    const billingContext: CommandContext = {
      ...context(tenantId),
      actorId: 'test-billing',
      roles: ['BILLING_STAFF'],
      permissions: ['BILLING_WRITE'],
      clinicalPrivileges: [],
    };
    const idempotencyKey = unique('idem');
    const commandId = unique('cmd');

    const first = await CommandBus.dispatch(billingContext, {
      commandId,
      idempotencyKey,
      tenantId,
      commandType: 'ReconcileRevenueIntegrityFindingCommand',
      schemaVersion: 1,
      payload: { findingId },
    });

    expect(first.success).toBe(true);

    const updatedFinding = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('billingMismatches')
      .doc(findingId)
      .get();

    expect(updatedFinding.data()?.status).toBe('RECONCILED');
    const chargeId = updatedFinding.data()?.chargeId;
    expect(typeof chargeId).toBe('string');

    const charge = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounterCharges')
      .doc(chargeId)
      .get();

    expect(charge.exists).toBe(true);
    expect(charge.data()?.netAmountMinorUnits).toBe(9500);
    expect(charge.data()?.status).toBe('PENDING_INVOICE');

    const replay = await CommandBus.dispatch(billingContext, {
      commandId: unique('cmd'),
      idempotencyKey,
      tenantId,
      commandType: 'ReconcileRevenueIntegrityFindingCommand',
      schemaVersion: 1,
      payload: { findingId },
    });

    expect(replay.success).toBe(true);
    expect(replay.replayedFromCache).toBe(true);

    const chargeMatches = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('encounterCharges')
      .where('sourceFindingId', '==', findingId)
      .get();

    expect(chargeMatches.size).toBe(1);
  });

  test('clinician without billing authority cannot reconcile Revenue Integrity findings', async () => {
    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore emulator Admin connection unavailable');

    const tenantId = unique('tenant');
    const findingId = unique('ri');

    await db.collection('tenants').doc(tenantId).collection('billingMismatches').doc(findingId).set({
      id: findingId,
      tenantId,
      patientId: unique('pat'),
      encounterId: unique('enc'),
      sourceEvidenceId: unique('evidence'),
      documentedItem: 'Candidate charge',
      category: 'Procedure',
      suggestedCode: 'CPT-99214',
      estimatedRecoverableAmountMinorUnits: 9500,
      currency: 'USD',
      status: 'PENDING_REVIEW',
      evidenceSnippet: 'Signed evidence',
      createdAt: Date.now(),
      createdBy: 'test-doctor',
    });

    const result = await CommandBus.dispatch(context(tenantId), {
      commandId: unique('cmd'),
      idempotencyKey: unique('idem'),
      tenantId,
      commandType: 'ReconcileRevenueIntegrityFindingCommand',
      schemaVersion: 1,
      payload: { findingId },
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INSUFFICIENT_ROLE');

    const finding = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('billingMismatches')
      .doc(findingId)
      .get();

    expect(finding.data()?.status).toBe('PENDING_REVIEW');
  });

});
