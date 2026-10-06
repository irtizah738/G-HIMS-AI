import { beforeEach, describe, expect, test } from 'bun:test';
import { EncounterDomainService } from '@/lib/backend/services/encounter-domain-service';
import {
  TransactionManager,
  type AtomicMutationParams,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext } from '@/lib/backend/types';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

process.env.GHIMS_RUNTIME_MODE = 'TEST';
process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE = 'TEST';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function doctorContext(tenantId: string): CommandContext {
  return {
    actorId: 'doctor-rp20',
    tenantId,
    roles: ['DOCTOR'],
    permissions: [],
    facilityIds: ['P7H0'],
    departmentIds: ['General Medicine'],
    clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
    correlationId: 'corr-rp20',
    requestId: 'req-rp20',
  };
}

function seedClosableEncounter(
  tenantId: string,
  suffix: string,
  options: {
    queuePatientId?: string;
    reconciliationSequence?: number;
    encounterSequence?: number;
  } = {}
) {
  const patientId = `patient-${suffix}`;
  const encounterId = `enc-${suffix}`;
  const queueTokenId = `opd_${encounterId}`;
  const reconciliationId = `opd_billrec_${encounterId}`;
  const encounterSequence = options.encounterSequence ?? 4;
  const reconciliationSequence =
    options.reconciliationSequence ?? encounterSequence;

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'PATIENT_MPI',
    patientId,
    {
      id: patientId,
      tenantId,
      mrn: `MRN-${suffix}`,
      fullName: 'RP20 Synthetic Patient',
      status: 'ACTIVE',
      activeEncounterId: encounterId,
      activeCareContexts: {
        activeOpdEncounterIds: [encounterId],
      },
      createdAt: 1,
      updatedAt: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'ENCOUNTER',
    encounterId,
    {
      id: encounterId,
      encounterId,
      tenantId,
      patientId,
      encounterType: 'OPD',
      type: 'OPD',
      status: 'ACTIVE',
      currentStage: 'DISCHARGE_OR_REFERRAL',
      clinicalState: 'DISPOSITION',
      operationalState: 'IN_SERVICE',
      financialClearanceState: 'FINAL_BILLING_CLEARED',
      resourceAssignmentState: 'ASSIGNED',
      billingReconciliationId: reconciliationId,
      billingReconciliationState: 'CLEARED',
      billingMutationSequence: encounterSequence,
      createdAt: 1,
      updatedAt: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'OPD_BILLING_RECONCILIATION',
    reconciliationId,
    {
      reconciliationId,
      tenantId,
      encounterId,
      patientId,
      status: 'CLEARED',
      billingMutationSequence: reconciliationSequence,
      reconciledBy: 'cashier-rp20',
      reconciledAt: 2,
      schemaVersion: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'OPD_QUEUE_TOKEN',
    queueTokenId,
    {
      id: queueTokenId,
      tokenId: queueTokenId,
      tenantId,
      encounterId,
      patientId: options.queuePatientId || patientId,
      patientName: 'RP20 Synthetic Patient',
      tokenNumber: 'RP20-001',
      department: 'General Medicine',
      priority: 'routine',
      status: 'in_consultation',
      createdAt: 1,
      updatedAt: 1,
    }
  );

  return {
    patientId,
    encounterId,
    queueTokenId,
    reconciliationId,
  };
}

describe('OPD-RP20/RP21 E2E and failure injection qualification', () => {
  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
  });

  test('RP20 staging fixtures are synthetic-only and production refusing', async () => {
    const fixture = await source(
      'scripts/ops/opd-rp20-provision-staging-fixtures.ts'
    );

    expect(fixture).toContain("runtime !== 'STAGING'");
    expect(fixture).toContain('OPD_RP20_REFUSES_PRODUCTION_PROJECT');
    expect(fixture).toContain('tenant.syntheticOnly !== true');
    expect(fixture).toContain('GHIMS_OPD_RP20_CONFIRM_PROJECT');
    expect(fixture).toContain('syntheticQualificationRecord: true');
    expect(fixture).toContain("'opd-consultation-standard'");
    expect(fixture).toContain("'LAB-RP20-CBC'");
    expect(fixture).toContain("'P7-PARA-500'");
  });

  test('final disposition atomically closes encounter patient context and active queue token', async () => {
    const tenantId = 'tenant-rp20-happy';
    const fixture = seedClosableEncounter(tenantId, 'happy');

    const result = await EncounterDomainService.commitDisposition(
      doctorContext(tenantId),
      'cmd-rp20-happy',
      'idem-rp20-happy',
      {
        encounterId: fixture.encounterId,
        dispositionType: 'DISCHARGE_HOME',
        patientInstructions: 'Synthetic qualification instruction.',
        warningSignsRedFlags: 'Synthetic qualification warning.',
      }
    );

    expect(result.success).toBe(true);

    const encounter = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      fixture.encounterId
    );
    const patient = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'PATIENT_MPI',
      fixture.patientId
    );
    const queue = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'OPD_QUEUE_TOKEN',
      fixture.queueTokenId
    );

    expect(encounter?.status).toBe('COMPLETED');
    expect(encounter?.currentStage).toBe('COMPLETED');
    expect(queue?.status).toBe('completed');
    expect(patient?.activeEncounterId).not.toBe(fixture.encounterId);
  });

  test('queue lineage failure leaves encounter patient and queue unchanged', async () => {
    const tenantId = 'tenant-rp21-queue-lineage';
    const fixture = seedClosableEncounter(tenantId, 'queue-lineage', {
      queuePatientId: 'different-patient',
    });

    const beforeEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        fixture.encounterId
      );
    const beforePatient =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'PATIENT_MPI',
        fixture.patientId
      );
    const beforeQueue =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        fixture.queueTokenId
      );

    const result = await EncounterDomainService.commitDisposition(
      doctorContext(tenantId),
      'cmd-rp21-queue-lineage',
      'idem-rp21-queue-lineage',
      {
        encounterId: fixture.encounterId,
        dispositionType: 'DISCHARGE_HOME',
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('OPD_QUEUE_LINEAGE_MISSING');

    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        fixture.encounterId
      )
    ).toEqual(beforeEncounter);
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'PATIENT_MPI',
        fixture.patientId
      )
    ).toEqual(beforePatient);
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        fixture.queueTokenId
      )
    ).toEqual(beforeQueue);
  });

  test('stale billing reconciliation fails before terminal mutation', async () => {
    const tenantId = 'tenant-rp21-stale-billing';
    const fixture = seedClosableEncounter(tenantId, 'stale-billing', {
      encounterSequence: 8,
      reconciliationSequence: 7,
    });

    const result = await EncounterDomainService.commitDisposition(
      doctorContext(tenantId),
      'cmd-rp21-stale-billing',
      'idem-rp21-stale-billing',
      {
        encounterId: fixture.encounterId,
        dispositionType: 'DISCHARGE_HOME',
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(
      'OPD_FINAL_BILLING_RECONCILIATION_REQUIRED'
    );

    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        fixture.encounterId
      )?.status
    ).toBe('ACTIVE');
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        fixture.queueTokenId
      )?.status
    ).toBe('in_consultation');
  });

  test('ephemeral optimistic conflict produces no partial aggregate or outbox commit', async () => {
    const tenantId = 'tenant-rp21-atomic-conflict';

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      'enc-conflict',
      {
        encounterId: 'enc-conflict',
        tenantId,
        status: 'ACTIVE',
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'OPD_QUEUE_TOKEN',
      'queue-conflict',
      {
        id: 'queue-conflict',
        tenantId,
        encounterId: 'enc-conflict',
        status: 'in_consultation',
      }
    );

    const beforeEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        'enc-conflict'
      );
    const beforeQueue =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        'queue-conflict'
      );
    const beforeEvents = await TransactionManager.getEvents(tenantId);
    const beforeAudits = await TransactionManager.getAudits(tenantId);
    const beforeOutbox = await TransactionManager.getPendingOutbox(tenantId);

    const params: AtomicMutationParams = {
      tenantId,
      actorId: 'doctor-rp21',
      actorRole: 'DOCTOR',
      aggregateType: 'ENCOUNTER',
      aggregateId: 'enc-conflict',
      eventType: 'RP21_FAILURE_INJECTION',
      eventPayload: { encounterId: 'enc-conflict' },
      auditAction: 'RP21_FAILURE_INJECTION',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: 'enc-conflict',
      idempotencyKey: 'idem-rp21-conflict',
      commandId: 'cmd-rp21-conflict',
      domainState: {
        ...beforeEncounter,
        status: 'COMPLETED',
      },
      additionalStateWrites: [
        {
          entityType: 'OPD_QUEUE_TOKEN',
          entityId: 'queue-conflict',
          domainState: {
            ...beforeQueue,
            status: 'completed',
          },
          expectedServerVersion: Number(beforeQueue?._serverVersion || 0) + 1,
        },
      ],
    };

    await expect(
      TransactionManager.executeAtomicMutation(params)
    ).rejects.toThrow('DOMAIN_STATE_VERSION_CONFLICT');

    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        'enc-conflict'
      )
    ).toEqual(beforeEncounter);
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        'queue-conflict'
      )
    ).toEqual(beforeQueue);
    expect(await TransactionManager.getEvents(tenantId)).toEqual(
      beforeEvents
    );
    expect(await TransactionManager.getAudits(tenantId)).toEqual(
      beforeAudits
    );
    expect(await TransactionManager.getPendingOutbox(tenantId)).toEqual(
      beforeOutbox
    );
  });

  test('ephemeral read-modify conflict also leaves every state and evidence store unchanged', async () => {
    const tenantId = 'tenant-rp21-read-modify';

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      'enc-read-modify',
      {
        encounterId: 'enc-read-modify',
        tenantId,
        status: 'ACTIVE',
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'OPD_QUEUE_TOKEN',
      'queue-read-modify',
      {
        id: 'queue-read-modify',
        tenantId,
        encounterId: 'enc-read-modify',
        status: 'in_consultation',
      }
    );

    const beforeEncounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        'enc-read-modify'
      );
    const beforeQueue =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        'queue-read-modify'
      );
    const beforeEvents = await TransactionManager.getEvents(tenantId);
    const beforeAudits = await TransactionManager.getAudits(tenantId);
    const beforeOutbox = await TransactionManager.getPendingOutbox(tenantId);

    await expect(
      TransactionManager.executeAtomicReadModifyMutation({
        tenantId,
        actorId: 'doctor-rp21',
        actorRole: 'DOCTOR',
        aggregateType: 'ENCOUNTER',
        aggregateId: 'enc-read-modify',
        eventType: 'RP21_READ_MODIFY_FAILURE_INJECTION',
        auditAction: 'RP21_READ_MODIFY_FAILURE_INJECTION',
        auditResourceType: 'ENCOUNTER',
        auditResourceId: 'enc-read-modify',
        idempotencyKey: 'idem-rp21-read-modify',
        commandId: 'cmd-rp21-read-modify',
        readTargets: [
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: 'enc-read-modify',
            required: true,
          },
          {
            key: 'queue',
            entityType: 'OPD_QUEUE_TOKEN',
            entityId: 'queue-read-modify',
            required: true,
          },
        ],
        prepare: (current) => ({
          domainState: {
            ...(current.encounter || {}),
            status: 'COMPLETED',
          },
          additionalStateWrites: [
            {
              entityType: 'OPD_QUEUE_TOKEN',
              entityId: 'queue-read-modify',
              domainState: {
                ...(current.queue || {}),
                status: 'completed',
              },
              expectedServerVersion:
                Number(current.queue?._serverVersion || 0) + 1,
            },
          ],
          eventPayload: { encounterId: 'enc-read-modify' },
        }),
      })
    ).rejects.toThrow('DOMAIN_STATE_VERSION_CONFLICT');

    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        'enc-read-modify'
      )
    ).toEqual(beforeEncounter);
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_QUEUE_TOKEN',
        'queue-read-modify'
      )
    ).toEqual(beforeQueue);
    expect(await TransactionManager.getEvents(tenantId)).toEqual(
      beforeEvents
    );
    expect(await TransactionManager.getAudits(tenantId)).toEqual(
      beforeAudits
    );
    expect(await TransactionManager.getPendingOutbox(tenantId)).toEqual(
      beforeOutbox
    );
  });

  test('OPD UI retains fail-closed server errors across critical workflow boundaries', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    for (const invariant of [
      'OPD service start was rejected by the authoritative payment/workflow gate.',
      'Clinical workflow runtime blocked transition from triage to consultation.',
      'Clinical workflow runtime blocked transition from consultation to diagnostics.',
      'Final OPD billing reconciliation failed.',
      'Workflow runtime blocked disposition after billing reconciliation.',
    ]) {
      expect(workspace).toContain(invariant);
    }

    expect(workspace).toContain(
      "requireOnlineOpdAuthority('final disposition and care transition')"
    );
    expect(workspace).toContain(
      "requireOnlineOpdAuthority('final billing reconciliation')"
    );
  });

  test('RP20 queue closure participates in the same disposition transaction', async () => {
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );

    const start = encounter.indexOf(
      'public static async commitDisposition'
    );
    const end = encounter.indexOf(
      'public static async advanceStage',
      start
    );
    const block = encounter.slice(start, end);

    expect(block).toContain("entityType: 'OPD_QUEUE_TOKEN'");
    expect(block).toContain('expectedServerVersion: Number(');
    expect(block).toContain("status: 'completed'");
    expect(block).toContain("'OPD_QUEUE_LINEAGE_MISSING'");
  });
});
