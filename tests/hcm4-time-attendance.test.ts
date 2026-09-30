import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

function command(commandType:string,payload:Record<string,unknown>){
  return {
    commandId:'cmd_hcm4_test',
    commandType,
    schemaVersion:1,
    tenantId:'central-metro-hospital',
    actorId:'usr_test',
    timestamp:new Date().toISOString(),
    idempotencyKey:'idemp_hcm4_test',
    payload,
  };
}

describe('HCM-4 governed time and attendance',()=>{
  test('clock-in schema rejects client-forged employee identity/scope fields',()=>{
    expect(validateCommandPayload(command('RecordClockInCommand',{
      employeeId:'emp_003',
      source:'BIOMETRIC_SCANNER',
      scheduledShiftId:'rst_01',
    }) as any).success).toBe(true);

    expect(validateCommandPayload(command('RecordClockInCommand',{
      employeeId:'emp_003',
      employeeName:'Forged',
      facilityId:'evil_facility',
      departmentId:'evil_department',
      source:'BIOMETRIC_SCANNER',
    }) as any).success).toBe(false);
  });

  test('clock-in uses a deterministic atomic open-slot guard',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain('attendanceOpenSlotId');
    expect(service).toContain("entityType:'ATTENDANCE_OPEN_SLOT'");
    expect(service).toContain('ATTENDANCE_ALREADY_OPEN');
    expect(service).toContain('ATTENDANCE_SHIFT_MISMATCH');
    expect(tx).toContain("ATTENDANCE_OPEN_SLOT: 'attendanceOpenSlots'");
  });

  test('clock-out derives working hours and overtime on the server',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(service).toContain('const hoursWorked=(outMs-inMs)/3_600_000');
    expect(service).toContain('const overtimeHours=Math.max(0,hoursWorked-8)');
    expect(service).toContain('ATTENDANCE_ALREADY_CLOSED');
    expect(service).toContain('ATTENDANCE_OPEN_SLOT_MISMATCH');
    expect(service).toContain("status:'CLOSED'");
  });

  test('attendance corrections create immutable evidence plus a derived corrected projection',async()=>{
    const service=await source('lib/backend/services/hr-workforce-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain("aggregateType:'ATTENDANCE_CORRECTION'");
    expect(service).toContain("eventType:'ATTENDANCE_CORRECTED'");
    expect(service).toContain("entityType:'ATTENDANCE_RECORD'");
    expect(service).toContain('previousClockInTime');
    expect(service).toContain('originalClockInTime');
    expect(tx).toContain("ATTENDANCE_CORRECTION: 'attendanceCorrections'");
  });

  test('attendance command contracts are strict and correction requires a reason',()=>{
    expect(validateCommandPayload(command('RecordClockOutCommand',{
      attendanceId:'att_1',
    }) as any).success).toBe(true);
    expect(validateCommandPayload(command('CorrectAttendanceTimeCommand',{
      attendanceId:'att_1',
      newClockInTime:'2026-10-01T08:00:00.000Z',
      reason:'Biometric device clock drift confirmed by supervisor',
    }) as any).success).toBe(true);
    expect(validateCommandPayload(command('CorrectAttendanceTimeCommand',{
      attendanceId:'att_1',
      newClockInTime:'2026-10-01T08:00:00.000Z',
    }) as any).success).toBe(false);
  });

  test('safe attendance projection is offline-readable but coordination slots are not',async()=>{
    const boot=await source('app/api/offline/bootstrap/route.ts');
    const hydration=await source('lib/offline/hydration.ts');
    const rules=await source('firestore.rules');
    expect(boot).toContain("'attendanceRecords'");
    expect(boot).toContain('scoped.attendanceRecords');
    expect(hydration).toContain("'attendanceRecords'");
    const slot=rules.indexOf('match /attendanceOpenSlots/{id}');
    expect(slot).toBeGreaterThan(-1);
    expect(rules.slice(slot,slot+160)).toContain('allow read, write: if false;');
    const correction=rules.indexOf('match /attendanceCorrections/{id}');
    expect(correction).toBeGreaterThan(-1);
    expect(rules.slice(correction,correction+220)).toContain('allow write: if false;');
  });

  test('attendance edge adapter uses governed command client',async()=>{
    const edge=await source('lib/hcm/hcm-edge-adapter.ts');
    expect(edge).toContain("'RecordClockInCommand'");
    expect(edge).toContain("'RecordClockOutCommand'");
    expect(edge).toContain("'CorrectAttendanceTimeCommand'");
    expect(edge).toContain('executeActiveTenantCommand');
  });
});
