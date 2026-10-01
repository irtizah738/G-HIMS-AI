import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { ResourceCapacityDomainService } from '@/lib/backend/services/resource-capacity-domain-service';
import type { BaseCommand, CommandContext } from '@/lib/backend/types';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

const adminContext:CommandContext={
  actorId:'fac-admin',
  tenantId:'fac1-test-tenant',
  roles:['FACILITIES_ADMIN'],
  permissions:['ALL_FACILITIES'],
  clinicalPrivileges:[],
  facilityIds:['fac-a'],
  correlationId:'fac1-corr',
  requestId:'fac1-req',
};

function registerCommand(params:{
  commandId:string;
  idempotencyKey:string;
  resourceNumber:string;
  serialNumber:string;
  assetTagNumber:string;
  facilityId?:string;
}):BaseCommand{
  return {
    commandId:params.commandId,
    idempotencyKey:params.idempotencyKey,
    commandType:'RegisterResourceCommand',
    schemaVersion:1,
    tenantId:adminContext.tenantId,
    actorId:adminContext.actorId,
    timestamp:new Date().toISOString(),
    payload:{
      resourceNumber:params.resourceNumber,
      resourceType:'MEDICAL_DEVICE',
      name:'Infusion Pump',
      facilityId:params.facilityId||'fac-a',
      facilityName:'Facility A',
      departmentId:'icu',
      departmentName:'ICU',
      ownerDepartmentId:'icu',
      ownerDepartmentName:'ICU',
      location:{building:'Main',floor:'2',roomNumber:'ICU-2'},
      status:'AVAILABLE',
      manufacturer:'Acme',
      model:'Pump X',
      serialNumber:params.serialNumber,
      assetTagNumber:params.assetTagNumber,
      calibrationRequired:true,
      calibrationStatus:'VALID',
      acquisitionDate:'2026-01-01',
      lifecycleState:'IN_SERVICE',
    },
  };
}

describe('FAC-1 authoritative facility & biomedical resource foundation',()=>{
  beforeEach(()=>{
    ResourceCapacityDomainService.resetForTesting();
    ResourceCapacityDomainService.seedTestFixtures(adminContext.tenantId);
  });

  test('resource commands have strict server-side schemas',()=>{
    const invalid=validateCommandPayload({
      commandId:'bad',
      idempotencyKey:'bad',
      commandType:'RegisterResourceCommand',
      schemaVersion:1,
      tenantId:'t',
      actorId:'a',
      timestamp:new Date().toISOString(),
      payload:{name:'missing everything else'},
    });
    expect(invalid.success).toBe(false);

    const reservation=validateCommandPayload({
      commandId:'resv',
      idempotencyKey:'resv',
      commandType:'ReserveResourceCommand',
      schemaVersion:1,
      tenantId:'t',
      actorId:'a',
      timestamp:new Date().toISOString(),
      payload:{
        resourceId:'r',resourceName:'R',resourceType:'MEDICAL_DEVICE',
        facilityId:'f',departmentId:'d',
        startTime:'2026-10-01T10:00:00Z',endTime:'2026-10-01T11:00:00Z',
        purpose:'SURGICAL_PROCEDURE',requesterName:'Clinician',priority:'ROUTINE'
      },
    });
    expect(reservation.success).toBe(true);
  });

  test('duplicate physical identities are rejected atomically',async()=>{
    const first=await CommandBus.dispatch(
      adminContext,
      registerCommand({
        commandId:'fac1-reg-1',
        idempotencyKey:'fac1-idem-1',
        resourceNumber:'RES-FAC1-001',
        serialNumber:'SERIAL-FAC1-UNIQUE',
        assetTagNumber:'TAG-FAC1-001',
      })
    );
    expect(first.success).toBe(true);

    const duplicate=await CommandBus.dispatch(
      adminContext,
      registerCommand({
        commandId:'fac1-reg-2',
        idempotencyKey:'fac1-idem-2',
        resourceNumber:'RES-FAC1-002',
        serialNumber:'SERIAL-FAC1-UNIQUE',
        assetTagNumber:'TAG-FAC1-002',
      })
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.code).toBe('RESOURCE_IDENTITY_ALREADY_REGISTERED');
  });

  test('facility scope is enforced server-side',async()=>{
    const result=await CommandBus.dispatch(
      adminContext,
      registerCommand({
        commandId:'fac1-scope',
        idempotencyKey:'fac1-scope-idem',
        resourceNumber:'RES-FAC1-SCOPE',
        serialNumber:'SERIAL-FAC1-SCOPE',
        assetTagNumber:'TAG-FAC1-SCOPE',
        facilityId:'fac-b',
      })
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FACILITY_SCOPE_MISMATCH');
  });

  test('maintenance completion cannot bypass calibration lockout',async()=>{
    const create:BaseCommand={
      commandId:'fac1-wo-create',
      idempotencyKey:'fac1-wo-create-idem',
      commandType:'CreateMaintenanceWorkOrderCommand',
      schemaVersion:1,
      tenantId:adminContext.tenantId,
      actorId:adminContext.actorId,
      timestamp:new Date().toISOString(),
      payload:{
        resourceId:'res_003',
        resourceName:'Hamilton-G5 Intensive Care Mechanical Ventilator',
        maintenanceType:'CORRECTIVE',
        priority:'HIGH',
        issueDescription:'Corrective maintenance after calibration failure.',
        reportedByName:'Facilities Admin',
      },
    };
    const created=await CommandBus.dispatch(
      {...adminContext,facilityIds:['fac_central']},
      create
    );
    expect(created.success).toBe(true);

    const completed=await CommandBus.dispatch(
      {...adminContext,roles:['BIOMEDICAL_ENGINEER'],facilityIds:['fac_central']},
      {
        commandId:'fac1-wo-complete',
        idempotencyKey:'fac1-wo-complete-idem',
        commandType:'CompleteMaintenanceWorkOrderCommand',
        schemaVersion:1,
        tenantId:adminContext.tenantId,
        actorId:'biomed-1',
        timestamp:new Date().toISOString(),
        payload:{
          workOrderId:created.entityId,
          resolutionSummary:'Mechanical issue corrected.',
          totalCost:0,
          downtimeHours:1,
        },
      }
    );
    expect(completed.success).toBe(true);
    const resource=ResourceCapacityDomainService.getResources()
      .find(row=>row.resourceId==='res_003');
    expect(resource?.calibrationStatus).toBe('CALIBRATION_REQUIRED');
    expect(resource?.status).toBe('OUT_OF_SERVICE');
  });

  test('concurrent reservations cannot both commit for the same resource window',async()=>{
    const today=new Date().toISOString().split('T')[0];
    const make=(suffix:string):BaseCommand=>({
      commandId:`fac1-concurrent-${suffix}`,
      idempotencyKey:`fac1-concurrent-idem-${suffix}`,
      commandType:'ReserveResourceCommand',
      schemaVersion:1,
      tenantId:adminContext.tenantId,
      actorId:adminContext.actorId,
      timestamp:new Date().toISOString(),
      payload:{
        resourceId:'res_002',
        resourceName:'client supplied name is not authoritative',
        resourceType:'SURGICAL_EQUIPMENT',
        facilityId:'fac_central',
        departmentId:'dept_surgery',
        startTime:`${today}T09:00:00Z`,
        endTime:`${today}T10:00:00Z`,
        purpose:'SURGICAL_PROCEDURE',
        requesterName:'Facilities Admin',
        priority:'ROUTINE',
      },
    });

    const scoped={...adminContext,facilityIds:['fac_central']};
    const [a,b]=await Promise.all([
      CommandBus.dispatch(scoped,make('a')),
      CommandBus.dispatch(scoped,make('b')),
    ]);

    expect([a.success,b.success].filter(Boolean)).toHaveLength(1);
    const loser=a.success?b:a;
    expect([
      'DOUBLE_BOOKING_CONFLICT',
      'RESERVATION_CONCURRENCY_RETRY_REQUIRED',
    ]).toContain(loser.error?.code);

    const committed=ResourceCapacityDomainService.getReservations()
      .filter((row)=>row.resourceId==='res_002'&&row.startTime===`${today}T09:00:00Z`);
    expect(committed).toHaveLength(1);
    expect(committed[0]?.resourceName).toBe(
      'Stryker 1688 AIM 4K Endoscopy Tower System'
    );
    expect(committed[0]?.requesterActorId).toBe(adminContext.actorId);
  });

  test('production initialization cannot inject demo facility state',async()=>{
    const service=await source('lib/backend/services/resource-capacity-domain-service.ts');
    const view=await source('components/views/resource-capacity-view.tsx');

    const initStart=service.indexOf('public static ensureInitialized');
    const seedStart=service.indexOf('public static seedTestFixtures');
    const initBlock=service.slice(initStart,seedStart);
    expect(initBlock).not.toContain('sampleResources');
    expect(initBlock).not.toContain('Central Metro Hospital');
    expect(service).toContain('TEST_FIXTURE_SEED_FORBIDDEN_OUTSIDE_TESTS');

    expect(view).not.toContain("resourceId: 'res_001'");
    expect(view).not.toContain("roomId: 'rm_001'");
    expect(view).toContain('loadLocalFacilitiesProjection');
    expect(view).toContain('hydrateFacilitiesProjection');
    expect(view).toContain('browser-generated PASS certification is disabled');
  });

  test('facilities read models are server-write-only and offline hydrated',async()=>{
    const rules=await source('firestore.rules');
    const hydration=await source('lib/offline/hydration.ts');

    expect(rules).toContain('function canReadFacilities');
    for(const collection of [
      'resources','rooms','resourceReservations','maintenanceWorkOrders','calibrationRecords'
    ]){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      const block=rules.slice(start,start+260);
      expect(block).toContain('canReadFacilities');
      expect(block).toContain('allow write: if false;');
      expect(hydration).toContain(`'${collection}'`);
    }
    for(const identity of ['resourceIdentities','roomIdentities']){
      const start=rules.indexOf(`match /${identity}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+180)).toContain('allow read, write: if false;');
    }
  });

  test('registration IDs are deterministic and identity reservations are transactional',async()=>{
    const service=await source('lib/backend/services/resource-capacity-domain-service.ts');
    expect(service).toContain("deterministicId('res', context.tenantId, commandId)");
    expect(service).toContain("deterministicId('room', context.tenantId, commandId)");
    expect(service).toContain('executeAtomicReadModifyMutation');
    expect(service).toContain("entityType: 'RESOURCE_IDENTITY'");
    expect(service).toContain("entityType: 'ROOM_IDENTITY'");
  });
});
