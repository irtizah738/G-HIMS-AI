import { createHash } from 'node:crypto';
import type {
  AttendanceRecord,
  CompensationProfileRecord,
  PayrollFrequency,
} from '@/types/hcm-advanced';

function assertMinor(value:number,code:string):void{
  if(!Number.isSafeInteger(value)||value<0) throw new Error(code);
}

export function payrollPeriodsPerYear(frequency:PayrollFrequency):number{
  if(frequency==='MONTHLY') return 12;
  if(frequency==='SEMI_MONTHLY') return 24;
  return 26;
}

export function canonicalPayrollPeriodId(params:{
  tenantId:string;
  facilityId:string;
  startDate:string;
  endDate:string;
}):string{
  return 'prp_'+createHash('sha256')
    .update([
      params.tenantId.trim().toLowerCase(),
      params.facilityId.trim().toLowerCase(),
      params.startDate,
      params.endDate,
    ].join('\u0000'))
    .digest('hex').slice(0,40);
}

export function payrollEmployeeSlotId(periodId:string,employeeId:string):string{
  return 'prs_'+createHash('sha256')
    .update([periodId,employeeId].map(v=>v.trim().toLowerCase()).join('\u0000'))
    .digest('hex').slice(0,40);
}

export function payrollPayslipId(periodId:string,employeeId:string):string{
  return 'pay_'+createHash('sha256')
    .update([periodId,employeeId].map(v=>v.trim().toLowerCase()).join('\u0000'))
    .digest('hex').slice(0,40);
}

export function compensationSlotId(employeeId:string):string{
  return 'cmp_slot_'+createHash('sha256')
    .update(employeeId.trim().toLowerCase())
    .digest('hex').slice(0,40);
}

export function attendanceEvidenceFingerprint(rows:AttendanceRecord[]):string{
  const canonical=rows
    .map(row=>[
      row.attendanceId,row.clockInTime,row.clockOutTime||'',
      row.totalHoursWorked,row.overtimeHours,row.overtimeApproved,
      row.isCorrected,row.updatedAt,
    ])
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function calculatePayrollLine(params:{
  compensation:CompensationProfileRecord;
  attendance:AttendanceRecord[];
}):{
  regularHours:number;
  overtimeHours:number;
  regularPayMinorUnits:number;
  overtimePayMinorUnits:number;
  allowanceMinorUnits:number;
  grossPayMinorUnits:number;
  deductions:Array<{code:string;name:string;amountMinorUnits:number}>;
  totalDeductionsMinorUnits:number;
  netPayMinorUnits:number;
}{
  const c=params.compensation;
  assertMinor(c.annualSalaryMinorUnits,'INVALID_ANNUAL_SALARY');
  assertMinor(c.hourlyRateMinorUnits,'INVALID_HOURLY_RATE');
  assertMinor(c.monthlyAllowanceMinorUnits,'INVALID_ALLOWANCE');
  if(
    !Number.isInteger(c.overtimeMultiplierBasisPoints) ||
    c.overtimeMultiplierBasisPoints<10000 ||
    c.overtimeMultiplierBasisPoints>50000
  ) throw new Error('INVALID_OVERTIME_MULTIPLIER');

  const regularHours=Number(params.attendance.reduce(
    (sum,row)=>sum+Math.max(0,row.totalHoursWorked-(row.overtimeApproved?row.overtimeHours:0)),0
  ).toFixed(2));
  const overtimeHours=Number(params.attendance.reduce(
    (sum,row)=>sum+(row.overtimeApproved?Math.max(0,row.overtimeHours):0),0
  ).toFixed(2));

  let regularPayMinorUnits=0;
  let overtimeBaseRateMinorUnits=c.hourlyRateMinorUnits;
  if(c.payBasis==='SALARIED'){
    const periods=payrollPeriodsPerYear(c.payFrequency);
    regularPayMinorUnits=Math.round(c.annualSalaryMinorUnits/periods);
    overtimeBaseRateMinorUnits=Math.round(c.annualSalaryMinorUnits/2080);
  }else{
    regularPayMinorUnits=Math.round(regularHours*c.hourlyRateMinorUnits);
  }
  const overtimePayMinorUnits=Math.round(
    overtimeHours*overtimeBaseRateMinorUnits*c.overtimeMultiplierBasisPoints/10000
  );
  const allowanceMinorUnits=c.payFrequency==='MONTHLY'
    ? c.monthlyAllowanceMinorUnits
    : Math.round(c.monthlyAllowanceMinorUnits*12/payrollPeriodsPerYear(c.payFrequency));

  for(const amount of [regularPayMinorUnits,overtimePayMinorUnits,allowanceMinorUnits]){
    assertMinor(amount,'PAYROLL_AMOUNT_OVERFLOW');
  }
  const grossPayMinorUnits=regularPayMinorUnits+overtimePayMinorUnits+allowanceMinorUnits;
  assertMinor(grossPayMinorUnits,'PAYROLL_GROSS_OVERFLOW');

  const deductions=c.deductions.map(rule=>{
    if(
      !rule.code.trim()||!rule.name.trim()||
      !Number.isInteger(rule.rateBasisPoints)||rule.rateBasisPoints<0||rule.rateBasisPoints>10000
    ) throw new Error('INVALID_PAYROLL_DEDUCTION_RULE');
    assertMinor(rule.fixedMinorUnits,'INVALID_PAYROLL_DEDUCTION_FIXED_AMOUNT');
    const amountMinorUnits=Math.round(
      grossPayMinorUnits*rule.rateBasisPoints/10000+rule.fixedMinorUnits
    );
    return {code:rule.code,name:rule.name,amountMinorUnits};
  });
  const totalDeductionsMinorUnits=deductions.reduce((sum,row)=>sum+row.amountMinorUnits,0);
  if(totalDeductionsMinorUnits>grossPayMinorUnits) throw new Error('PAYROLL_DEDUCTIONS_EXCEED_GROSS');
  const netPayMinorUnits=grossPayMinorUnits-totalDeductionsMinorUnits;

  return {
    regularHours,overtimeHours,regularPayMinorUnits,overtimePayMinorUnits,
    allowanceMinorUnits,grossPayMinorUnits,deductions,totalDeductionsMinorUnits,
    netPayMinorUnits,
  };
}
