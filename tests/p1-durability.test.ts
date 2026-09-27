import { describe, expect, test } from 'bun:test';
import { IdempotencyService } from '@/lib/backend/idempotency/idempotency-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { CommandContext } from '@/lib/backend/types';
import { getAdminFirestore } from '@/server/firebase/admin';

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function context(tenantId: string): CommandContext {
  return {
    actorId: 'test-doctor',
    tenantId,
    roles: ['DOCTOR'],
    permissions: ['CLINICAL_WRITE'],
    clinicalPrivileges: ['ORDER_DIAGNOSTICS'],
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

    await expect(
      TransactionManager.executeAtomicMutation({
        tenantId,
        actorId: 'test-doctor',
        actorRole: 'DOCTOR',
        aggregateType: 'ENCOUNTER',
        aggregateId: entityId,
        eventType: 'EncounterCreatedEvent',
        eventPayload: { patientId: 'pat-rollback' },
        domainState: { id: entityId, patientId: 'pat-rollback' },
        additionalStateWrites: [
          {
            entityType: 'UNMAPPED_TEST_ENTITY',
            entityId: 'bad-state',
            domainState: { unsafe: true },
          },
        ],
        commandId: unique('cmd'),
        idempotencyKey: unique('idem'),
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
});
