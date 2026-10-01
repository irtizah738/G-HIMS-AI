import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { ResourceCapacityDomainService } from '@/lib/backend/services/resource-capacity-domain-service';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { BaseCommand, CommandContext } from '@/lib/backend/types';
import type { Bed } from '@/lib/types/ghims';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const tenantId = 'fac2-test-tenant';

const facilitiesContext: CommandContext = {
  actorId: 'fac2-admin',
  tenantId,
  roles: ['FACILITIES_ADMIN'],
  permissions: ['ALL_FACILITIES'],
  clinicalPrivileges: [],
  facilityIds: ['fac_central'],
  correlationId: 'fac2-corr',
  requestId: 'fac2-req',
};

function command(
  commandType: string,
  commandId: string,
  payload: Record<string, unknown>,
  context: CommandContext = facilitiesContext
): BaseCommand {
  return {
    commandId,
    idempotencyKey: `${commandId}-idem`,
    commandType,
    schemaVersion: 1,
    tenantId: context.tenantId,
    actorId: context.actorId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

async function createRoom(
  suffix: string,
  capacity = 2
): Promise<string> {
  const result = await CommandBus.dispatch(
    facilitiesContext,
    command('RegisterRoomCommand', `fac2-room-${suffix}`, {
      roomNumber: `ICU-${suffix}`,
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      building: 'Critical Care Pavilion',
      floor: 'Floor 2',
      departmentId: 'dept_icu',
      departmentName: 'Intensive Care Unit (ICU)',
      roomType: 'icu',
      capacity,
      currentOccupancy: 0,
      status: 'AVAILABLE',
      features: ['Medical gases'],
    })
  );
  expect(result.success).toBe(true);
  expect(result.entityId).toBeTruthy();
  return String(result.entityId);
}

function registerBedPayload(
  roomId: string,
  bedNumber: string
): Record<string, unknown> {
  return {
    bedNumber,
    facilityId: 'fac_central',
    facilityName: 'client supplied facility name',
    departmentId: 'dept_icu',
    departmentName: 'client supplied department name',
    roomId,
    ward: 'ICU',
    bedType: 'ICU',
    capabilities: ['oxygen', 'central-monitoring'],
    notes: 'FAC-2 governed bed',
  };
}

describe('FAC-2 authoritative bed & space capacity', () => {
  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
    ResourceCapacityDomainService.resetForTesting();
    ResourceCapacityDomainService.seedTestFixtures(tenantId);
  });

  test('bed commands reject client-owned occupancy and ungoverned reservation state', () => {
    const invalidRegistration = validateCommandPayload(
      command('RegisterBedCommand', 'fac2-schema-bed', {
        ...registerBedPayload('rm_003', 'ICU-01-A'),
        status: 'occupied',
        patientId: 'patient-forged',
      })
    );
    expect(invalidRegistration.success).toBe(false);

    const invalidStatus = validateCommandPayload(
      command('UpdateBedStatusCommand', 'fac2-schema-status', {
        bedId: 'bed-any',
        status: 'reserved',
      })
    );
    expect(invalidStatus.success).toBe(false);
  });

  test('registration derives physical topology from the authoritative room', async () => {
    const roomId = await createRoom('02', 2);
    const result = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-bed-register',
        registerBedPayload(roomId, 'ICU-02-A')
      )
    );

    expect(result.success).toBe(true);
    const bed = result.data as Bed;
    expect(bed.id.startsWith('bed_')).toBe(true);
    expect(bed.status).toBe('available');
    expect(bed.lifecycleState).toBe('IN_SERVICE');
    expect(bed.facilityId).toBe('fac_central');
    expect(bed.facilityName).toBe('Central Metro Hospital');
    expect(bed.departmentName).toBe('Intensive Care Unit (ICU)');
    expect(bed.roomId).toBe(roomId);
    expect(bed.room).toBe('ICU-02');
    expect(bed.patientId).toBeUndefined();
    expect(bed.currentEncounterId).toBeUndefined();

    const room = ResourceCapacityDomainService.getRooms()
      .find((row) => row.roomId === roomId);
    expect(room?.bedIds).toContain(bed.id);
  });

  test('duplicate bed physical identities are rejected atomically', async () => {
    const roomId = await createRoom('03', 2);
    const first = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-bed-identity-a',
        registerBedPayload(roomId, 'ICU-03-A')
      )
    );
    expect(first.success).toBe(true);

    const duplicate = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-bed-identity-b',
        registerBedPayload(roomId, 'ICU-03-A')
      )
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.code).toBe('BED_IDENTITY_ALREADY_REGISTERED');
  });

  test('registered beds cannot exceed authoritative room capacity', async () => {
    const first = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-capacity-a',
        registerBedPayload('rm_003', 'ICU-CAP-A')
      )
    );
    expect(first.success).toBe(true);

    const overflow = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-capacity-b',
        registerBedPayload('rm_003', 'ICU-CAP-B')
      )
    );
    expect(overflow.success).toBe(false);
    expect(overflow.error?.code).toBe('ROOM_BED_CAPACITY_EXCEEDED');
  });

  test('facility scope is enforced before bed identity mutation', async () => {
    const foreignContext: CommandContext = {
      ...facilitiesContext,
      actorId: 'fac2-other-facility-admin',
      facilityIds: ['fac_other'],
      correlationId: 'fac2-foreign-corr',
      requestId: 'fac2-foreign-req',
    };
    const result = await CommandBus.dispatch(
      foreignContext,
      command(
        'RegisterBedCommand',
        'fac2-foreign-bed',
        registerBedPayload('rm_003', 'ICU-FOREIGN-A'),
        foreignContext
      )
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FACILITY_SCOPE_MISMATCH');
  });

  test('operational readiness is facilities-owned but cannot override clinical occupancy', async () => {
    const registration = await CommandBus.dispatch(
      facilitiesContext,
      command(
        'RegisterBedCommand',
        'fac2-readiness-bed',
        registerBedPayload('rm_003', 'ICU-READY-A')
      )
    );
    expect(registration.success).toBe(true);
    const bed = registration.data as Bed;

    const maintenance = await CommandBus.dispatch(
      facilitiesContext,
      command('UpdateBedStatusCommand', 'fac2-readiness-maint', {
        bedId: bed.id,
        status: 'maintenance',
        notes: 'Preventive inspection',
      })
    );
    expect(maintenance.success).toBe(true);
    expect((maintenance.data as { bed: Bed }).bed.status).toBe('maintenance');
    expect((maintenance.data as { bed: Bed }).bed.lifecycleState).toBe('MAINTENANCE');

    const ready = await CommandBus.dispatch(
      facilitiesContext,
      command('UpdateBedStatusCommand', 'fac2-readiness-ready', {
        bedId: bed.id,
        status: 'available',
        notes: 'Inspection complete',
      })
    );
    expect(ready.success).toBe(true);

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'HOSPITAL_BED',
      bed.id,
      {
        ...(ready.data as { bed: Bed }).bed,
        status: 'occupied',
        patientId: 'patient-1',
        currentPatientId: 'patient-1',
        currentEncounterId: 'enc-ipd-1',
      }
    );

    const unsafe = await CommandBus.dispatch(
      facilitiesContext,
      command('UpdateBedStatusCommand', 'fac2-readiness-unsafe', {
        bedId: bed.id,
        status: 'available',
      })
    );
    expect(unsafe.success).toBe(false);
    expect(unsafe.error?.code).toBe('BED_OCCUPIED');
  });

  test('bed authority remains separated from clinical care-transition authority', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    expect(bus).toContain(
      "case 'RegisterBedCommand':\n          result = await ResourceCapacityDomainService.registerBed"
    );
    expect(bus).toContain(
      "case 'UpdateBedStatusCommand':\n          result = await ResourceCapacityDomainService.updateBedOperationalStatus"
    );
    expect(bus).toContain("'CARE_TRANSITION_COMMAND_REQUIRED'");
    expect(bus).not.toContain('InpatientBedDomainService.updateStatus');
  });

  test('bed read models hydrate offline while identity authority stays server-only', async () => {
    const [rules, hydration, edge] = await Promise.all([
      source('firestore.rules'),
      source('lib/offline/hydration.ts'),
      source('lib/facilities/facilities-edge-adapter.ts'),
    ]);

    const bedRule = rules.slice(
      rules.indexOf('match /beds/{bedId}'),
      rules.indexOf('match /telehealthSessions/{sessionId}')
    );
    expect(bedRule).toContain('canReadClinical(tenantId)');
    expect(bedRule).toContain('canReadFacilities(tenantId)');
    expect(bedRule).toContain('allow write: if false;');

    const identityRule = rules.slice(
      rules.indexOf('match /bedIdentities/{id}'),
      rules.indexOf('// Workforce/resource read models.')
    );
    expect(identityRule).toContain('allow read, write: if false;');

    expect(hydration).toContain("'beds'");
    expect(edge).toContain('beds: (snapshot.collections.beds || [])');
    expect(edge).toContain("'RegisterBedCommand'");
    expect(edge).toContain("'UpdateBedStatusCommand'");
  });

  test('capacity allocation is transactionally coupled to room and bed identity', async () => {
    const service = await source(
      'lib/backend/services/resource-capacity-domain-service.ts'
    );
    expect(service).toContain('executeAtomicReadModifyMutation');
    expect(service).toContain("entityType: 'HOSPITAL_ROOM'");
    expect(service).toContain("entityType: 'BED_IDENTITY'");
    expect(service).toContain('ROOM_BED_CAPACITY_EXCEEDED');
    expect(service).toContain("eventType: 'BED_REGISTERED'");
    expect(service).toContain("eventType: 'BED_OPERATIONAL_STATUS_CHANGED'");
  });
});
