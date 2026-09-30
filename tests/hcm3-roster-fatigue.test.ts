import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

function command(commandType:string,payload:Record<string,unknown>){
  return {
    commandId:'cmd_hcm3_test',
    commandType,
    schemaVersion:1,
    tenantId:'central-metro-hospital',
    actorId:'usr_test',
    timestamp:new Date().toISOString(),
    idempotencyKey:'idemp_hcm3_test',
    payload,
  };
}

describe('HCM-3 governed rostering and fatigue safety',()=>{
  test('shift command accepts only client-owned scheduling fields',()=>{
    const payload={
      facilityId:'fac_central',
      facilityName:'Central',
      departmentId:'dept_icu',
      departmentName:'ICU',
      employeeId:'emp_003',
      date:'2026-10-01',
      shiftId:'night',
      shiftName:'NIGHT',
      startTime:'2026-10-01T20:00:00.000Z',
      endTime:'2026-10-02T08:00:00.000Z',
      notes:'ICU',
    };
    expect(validateCommandPayload(command('AssignShiftCommand',payload) as any).success).toBe(true);
    expect(validateCommandPayload(command('AssignShiftCommand',{
      ...payload,tenantId:'evil',durationHours:1,isOvertime:false,employeeName:'Forged'
    }) as any).success).toBe(false);
  });

  test('assignment is atomic against employee, credential revision and monthly timeline',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain("entityType:'ROSTER_TIMELINE'");
    expect(service).toContain('CREDENTIAL_SET_CHANGED_RETRY');
    expect(service).toContain('SHIFT_DOUBLE_BOOKING_CONFLICT');
    expect(service).toContain('FATIGUE_COMPLIANCE_VIOLATION');
    expect(service).toContain('ROSTER_SCOPE_OUTSIDE_EMPLOYEE_ASSIGNMENT');
    expect(service).toContain("isOvertime:durationHours>8");
    expect(tx).toContain("ROSTER_TIMELINE: 'rosterTimelines'");
  });

  test('fatigue validation protects both before and after target shift',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain('const restBefore=startMs-existingEnd');
    expect(service).toContain('const restAfter=existingStart-endMs');
    expect(service).toContain('(restBefore>0&&restBefore<minRestMs)');
    expect(service).toContain('(restAfter>0&&restAfter<minRestMs)');
  });

  test('shift cancellation is a state transition, never a hard delete',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const bus=await source('lib/backend/commands/command-bus.ts');
    expect(service).toContain('SHIFT_CANCELLED');
    expect(service).toContain("status:'CANCELLED'");
    expect(bus).toContain("case 'CancelShiftCommand'");
  });

  test('shift swaps are atomic and re-run assignment, credential and fatigue controls',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const bus=await source('lib/backend/commands/command-bus.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain('ROSTER_SWAP_COMPLETED');
    expect(service).toContain('ROSTER_SWAP_STALE');
    expect(service).toContain('ROSTER_SWAP_SCOPE_MISMATCH');
    expect(service).toContain('CREDENTIAL_SET_CHANGED_RETRY');
    expect(service).toContain('FATIGUE_COMPLIANCE_VIOLATION');
    expect(bus).toContain("case 'ExecuteRosterSwapCommand'");
    expect(tx).toContain("ROSTER_SWAP: 'rosterSwaps'");
  });

  test('roster UI has no legacy Firestore mutation authority or demo tenant fallback',async()=>{
    const ui=await source('app/[tenantId]/hcm/roster/page.tsx');
    const edge=await source('lib/hcm/hcm-edge-adapter.ts');
    expect(ui).not.toContain("from '@/lib/firebase/services/hcm'");
    expect(ui).not.toContain("|| 'metro-health'");
    expect(ui).not.toContain('createRosterShift(');
    expect(ui).not.toContain('deleteRosterShift(');
    expect(ui).not.toContain('swapShifts(');
    expect(ui).not.toContain('seedInitialRosterAndShifts(');
    expect(ui).toContain('assignShiftEdge');
    expect(ui).toContain('cancelShiftEdge');
    expect(ui).toContain('executeRosterSwapEdge');
    expect(ui).toContain('loadLocalRoster');
    expect(ui).toContain('hydrateRoster');
    expect(edge).toContain("'AssignShiftCommand'");
    expect(edge).toContain("'CancelShiftCommand'");
    expect(edge).toContain("'ExecuteRosterSwapCommand'");
  });

  test('offline roster projection is scoped but coordination records stay server-only',async()=>{
    const boot=await source('app/api/offline/bootstrap/route.ts');
    const hydration=await source('lib/offline/hydration.ts');
    const rules=await source('firestore.rules');
    expect(boot).toContain("'rosterAssignments'");
    expect(boot).toContain('scoped.rosterAssignments');
    expect(hydration).toContain("'rosterAssignments'");
    for(const collection of ['rosterTimelines','rosterSwaps']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+180)).toContain('allow read, write: if false;');
    }
  });

  test('ephemeral transaction mode persists authoritative domain state for multi-command tests',async()=>{
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(tx).toContain('inMemoryDomainState');
    expect(tx).toContain('seedEphemeralStateForTesting');
    expect(tx).toContain('getEphemeralState');
    expect(tx).toContain('setEphemeralState');
  });
});
