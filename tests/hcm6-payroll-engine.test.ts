import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  calculatePayrollLine,
  payrollPeriodsPerYear,
} from '@/lib/hcm/payroll-engine';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('HCM-6 governed compensation and payroll engine',()=>{
  test('pay frequency math is explicit and deterministic',()=>{
    expect(payrollPeriodsPerYear('MONTHLY')).toBe(12);
    expect(payrollPeriodsPerYear('SEMI_MONTHLY')).toBe(24);
    expect(payrollPeriodsPerYear('BI_WEEKLY')).toBe(26);
  });

  test('minor-unit payroll calculation pays only approved overtime',()=>{
    const calc=calculatePayrollLine({
      compensation:{
        compensationId:'c',tenantId:'t',employeeId:'e',payBasis:'HOURLY',
        payFrequency:'MONTHLY',currency:'USD',annualSalaryMinorUnits:0,
        hourlyRateMinorUnits:1000,overtimeMultiplierBasisPoints:15000,
        monthlyAllowanceMinorUnits:5000,deductions:[
          {code:'TAX',name:'Tax',rateBasisPoints:1000,fixedMinorUnits:0}
        ],
        effectiveFrom:'2026-01-01',status:'ACTIVE',createdBy:'u',createdAt:''
      },
      attendance:[
        {attendanceId:'a1',totalHoursWorked:10,overtimeHours:2,overtimeApproved:true,updatedAt:'1'} as any,
        {attendanceId:'a2',totalHoursWorked:9,overtimeHours:1,overtimeApproved:false,updatedAt:'2'} as any,
      ]
    });
    expect(calc.regularHours).toBe(17);
    expect(calc.overtimeHours).toBe(2);
    expect(calc.regularPayMinorUnits).toBe(17000);
    expect(calc.overtimePayMinorUnits).toBe(3000);
    expect(calc.allowanceMinorUnits).toBe(5000);
    expect(calc.grossPayMinorUnits).toBe(25000);
    expect(calc.totalDeductionsMinorUnits).toBe(2500);
    expect(calc.netPayMinorUnits).toBe(22500);
  });

  test('compensation revisions are maker-checker and versioned by active slot',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    expect(s).toContain('COMPENSATION_APPROVAL_ALREADY_PENDING');
    expect(s).toContain('HCM_SEGREGATION_OF_DUTIES');
    expect(s).toContain("status:'SUPERSEDED'");
    expect(s).toContain('revision:Number(currentSlot.revision||0)+1');
  });

  test('payroll periods reject overlap and employee enrollment is one deterministic slot',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    expect(s).toContain('PAYROLL_PERIOD_OVERLAP');
    expect(s).toContain('PAYROLL_EMPLOYEE_ALREADY_ENROLLED');
    expect(s).toContain('payrollEmployeeSlotId');
    expect(s).toContain('PAYROLL_COMPENSATION_MISMATCH');
  });

  test('employee calculation re-reads compensation and attendance evidence atomically',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    expect(s).toContain('COMPENSATION_CHANGED_RETRY');
    expect(s).toContain('attendanceTargets');
    expect(s).toContain('attendanceEvidenceFingerprint');
    expect(s).toContain("entityType:'PAYROLL_ATTENDANCE_LOCK'");
    expect(s).toContain('calculatedCount:currentPeriod.calculatedCount+1');
  });

  test('historical attendance cannot be mutated after payroll calculation',async()=>{
    const workforce=await source('lib/backend/services/hr-workforce-domain-service.ts');
    expect(workforce).toContain('ATTENDANCE_LOCKED_BY_PAYROLL');
    expect(workforce).toContain("entityType:'PAYROLL_ATTENDANCE_LOCK'");
  });

  test('finalization requires complete employee counts and gross control total',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    expect(s).toContain('PAYROLL_CALCULATION_INCOMPLETE');
    expect(s).toContain('PAYROLL_CONTROL_TOTAL_MISMATCH');
    expect(s).toContain("status:'CALCULATED'");
  });

  test('legacy browser payroll is not authoritative to the new engine',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'SetCompensationCommand','ReviewCompensationCommand',
      'CreatePayrollPeriodCommand','EnrollPayrollEmployeeCommand',
      'CalculatePayrollEmployeeCommand','FinalizePayrollPeriodCommand'
    ]) expect(bus).toContain(`case '${command}'`);
    const rules=await source('firestore.rules');
    for(const collection of ['compensationProfiles','payrollPeriods','payrollEmployeeSlots','payrollPayslips']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+220)).toContain('allow write: if false;');
    }
  });
});
