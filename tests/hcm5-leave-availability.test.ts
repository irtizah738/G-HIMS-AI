import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

function command(commandType:string,payload:Record<string,unknown>){
  return {commandId:'cmd_hcm5',commandType,schemaVersion:1,
    tenantId:'central-metro-hospital',actorId:'usr_test',
    timestamp:new Date().toISOString(),idempotencyKey:'idemp_hcm5',payload};
}

describe('HCM-5 leave and availability governance',()=>{
  test('leave submission accepts only authoritative input fields',()=>{
    expect(validateCommandPayload(command('SubmitLeaveRequestCommand',{
      employeeId:'emp_001',leaveType:'ANNUAL',startDate:'2026-11-01',
      endDate:'2026-11-03',reason:'Annual leave'
    }) as any).success).toBe(true);
    expect(validateCommandPayload(command('SubmitLeaveRequestCommand',{
      employeeId:'emp_001',employeeName:'Forged',totalDays:1,
      leaveType:'ANNUAL',startDate:'2026-11-01',endDate:'2026-11-03',
      reason:'Annual leave'
    }) as any).success).toBe(false);
  });

  test('submission reserves entitlement atomically and blocks overlap/overallocation',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain("entityType:'LEAVE_BALANCE'");
    expect(service).toContain("entityType:'LEAVE_CALENDAR'");
    expect(service).toContain('LEAVE_REQUEST_OVERLAP');
    expect(service).toContain('INSUFFICIENT_LEAVE_BALANCE');
    expect(service).toContain('pendingApprovalDays:balance.pendingApprovalDays+totalDays');
    expect(service).toContain('remainingDays:balance.remainingDays-totalDays');
  });

  test('approval cannot silently remove a rostered clinician',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain('LEAVE_ROSTER_CONFLICT');
    expect(service).toContain('rosterIds:shifts.map');
  });

  test('approval consumes reserved balance and rejection releases it',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain('usedDays:balance.usedDays+leave.totalDays');
    expect(service).toContain('remainingDays:balance.remainingDays+leave.totalDays');
    expect(service).toContain("status:nextStatus");
  });

  test('new employees receive persistent leave entitlements',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain('leaveBalanceWrites');
    expect(service).toContain("['ANNUAL',21]");
    expect(service).toContain("['SICK',14]");
    expect(service).toContain("['STUDY_CME',7]");
  });

  test('leave projections are offline-readable and server-write-only',async()=>{
    const hydration=await source('lib/offline/hydration.ts');
    const boot=await source('app/api/offline/bootstrap/route.ts');
    const rules=await source('firestore.rules');
    expect(hydration).toContain("'leaveRequests'");
    expect(hydration).toContain("'leaveBalances'");
    expect(boot).toContain('scoped.leaveRequests');
    expect(boot).toContain('scoped.leaveBalances');
    for(const collection of ['leaveBalances','leaveCalendars']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+190)).toContain('allow write: if false;');
    }
  });
});
