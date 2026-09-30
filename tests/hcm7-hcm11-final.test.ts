import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildWorkforceAlerts,
  stableHcmFingerprint,
} from '@/lib/hcm/hcm-intelligence-engine';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('HCM-7 through HCM-11 final enterprise completion',()=>{
  test('preserves HCM-2 credential concurrency and privilege gates',async()=>{
    const s=await source('lib/backend/services/hr-workforce-domain-service.ts');
    for(const marker of [
      'CREDENTIAL_NUMBER_ALREADY_REGISTERED',
      'CREDENTIAL_SET_CHANGED_RETRY',
      'PRIVILEGE_SCOPE_OUTSIDE_EMPLOYEE_ASSIGNMENT',
      'ACTIVE_PRIVILEGE_ALREADY_EXISTS',
      'CREDENTIAL_PREREQUISITE_FAILED',
    ]) expect(s).toContain(marker);
  });

  test('preserves HCM-3 roster double-booking fatigue and swap protections',async()=>{
    const s=await source('lib/backend/services/hr-workforce-domain-service.ts');
    for(const marker of [
      'SHIFT_DOUBLE_BOOKING_CONFLICT',
      'FATIGUE_COMPLIANCE_VIOLATION',
      'ROSTER_SCOPE_OUTSIDE_EMPLOYEE_ASSIGNMENT',
      'ROSTER_SWAP_COMPLETED',
      'ROSTER_SWAP_STALE',
      'ROSTER_SWAP_SCOPE_MISMATCH',
    ]) expect(s).toContain(marker);
  });

  test('preserves HCM-4 attendance open-slot and payroll-lock protections',async()=>{
    const s=await source('lib/backend/services/hr-workforce-domain-service.ts');
    for(const marker of [
      'ATTENDANCE_ALREADY_OPEN',
      'ATTENDANCE_SHIFT_MISMATCH',
      'ATTENDANCE_ALREADY_CLOSED',
      'ATTENDANCE_OPEN_SLOT_MISMATCH',
      'ATTENDANCE_CORRECTED',
      'ATTENDANCE_LOCKED_BY_PAYROLL',
    ]) expect(s).toContain(marker);
  });

  test('preserves HCM-5 leave overlap balance and roster-conflict protections',async()=>{
    const s=await source('lib/backend/services/hr-workforce-domain-service.ts');
    for(const marker of [
      'LEAVE_REQUEST_OVERLAP',
      'INSUFFICIENT_LEAVE_BALANCE',
      'LEAVE_ROSTER_CONFLICT',
    ]) expect(s).toContain(marker);
  });

  test('preserves HCM-6 compensation and payroll evidence controls',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    for(const marker of [
      'COMPENSATION_APPROVAL_ALREADY_PENDING',
      'PAYROLL_PERIOD_OVERLAP',
      'PAYROLL_EMPLOYEE_ALREADY_ENROLLED',
      'PAYROLL_COMPENSATION_MISMATCH',
      'COMPENSATION_CHANGED_RETRY',
      'PAYROLL_CALCULATION_INCOMPLETE',
      'PAYROLL_CONTROL_TOTAL_MISMATCH',
      "entityType:'PAYROLL_ATTENDANCE_LOCK'",
    ]) expect(s).toContain(marker);
  });

  test('HCM-7 payroll Finance posting is atomic and maker-checker controlled',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    expect(s).toContain("entityType:'JOURNAL_ENTRY'");
    expect(s).toContain("sourceModule:'PAYROLL'");
    expect(s).toContain('PAYROLL_JOURNAL_UNBALANCED');
    expect(s).toContain('PAYROLL_FINANCE_ACCOUNT_INVALID');
    expect(s).toContain('FINANCE_PERIOD_NOT_POSTABLE');
    expect(s).toContain('HCM_SEGREGATION_OF_DUTIES');
    expect(s).toContain("status:'APPROVED'");
    expect(s).toContain("status:'POSTED'");
    expect(s).not.toContain('payroll will proceed');
  });

  test('HCM-7 deductions require explicit liability account routing',async()=>{
    const schema=await source('lib/backend/commands/command-schema-registry.ts');
    const types=await source('types/hcm-advanced.ts');
    expect(schema).toContain('liabilityAccountCode: nonEmpty.max(40)');
    expect(types).toContain('liabilityAccountCode?: string');
  });

  test('HCM-7 settlement requires treasury and segregation from Finance poster',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    const start=s.indexOf('public static async settlePayrollPeriod');
    const end=s.indexOf('public static async remitPayrollLiability',start);
    const block=s.slice(start,end);
    expect(block).toContain('TREASURY_ACCOUNT_NOT_PAYABLE');
    expect(block).toContain('PAYROLL_SETTLEMENT_CURRENCY_MISMATCH');
    expect(block).toContain('HCM_SEGREGATION_OF_DUTIES');
    expect(block).toContain("status:'PAID'");
  });

  test('HCM-8 statutory liabilities accrue, remit, and expose immutable compliance snapshots',async()=>{
    const s=await source('lib/backend/services/hcm-payroll-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(s).toContain("entityType:'PAYROLL_STATUTORY_LIABILITY'");
    expect(s).toContain('PAYROLL_LIABILITY_REMITTED');
    expect(s).toContain('PAYROLL_REMITTANCE_CURRENCY_MISMATCH');
    expect(s).toContain('PAYROLL_COMPLIANCE_SNAPSHOT_GENERATED');
    expect(s).toContain('stableHcmFingerprint');
    expect(tx).toContain("PAYROLL_STATUTORY_LIABILITY: 'payrollStatutoryLiabilities'");
    expect(tx).toContain("PAYROLL_COMPLIANCE_SNAPSHOT: 'payrollComplianceSnapshots'");
  });

  test('HCM-9 only attendance capture is offline queued',async()=>{
    const edge=await source('lib/hcm/hcm-edge-adapter.ts');
    const clockIn=edge.indexOf('export const recordClockInEdge');
    const correction=edge.indexOf('export const correctAttendanceTimeEdge');
    const payroll=edge.indexOf('export const setCompensationEdge');
    expect(edge.slice(clockIn,correction)).toContain("collection:'attendanceRecords'");
    expect(edge.slice(clockIn,correction)).toContain('enabled:true');
    expect(edge.slice(payroll,clockIn)).not.toContain('offlineQueue');
  });

  test('HCM-10 payroll UI uses governed projections and commands only',async()=>{
    const page=await source('app/[tenantId]/hcm/payroll/page.tsx');
    const consoleUi=await source('components/hcm/governed-payroll-console.tsx');
    const hcmPage=await source('app/[tenantId]/hcm/page.tsx');
    expect(page).toContain('GovernedPayrollConsole');
    expect(page).not.toContain('firebase/services/hcm');
    expect(consoleUi).toContain('createPayrollPeriodEdge');
    expect(consoleUi).toContain('postPayrollPeriodEdge');
    expect(consoleUi).toContain('settlePayrollPeriodEdge');
    expect(consoleUi).toContain('remitPayrollLiabilityEdge');
    expect(consoleUi).not.toContain('firebase/firestore');
    expect(hcmPage).not.toContain("|| 'metro-health'");
  });

  test('HCM-11 fingerprint and alert generation are deterministic and explainable',()=>{
    expect(stableHcmFingerprint({b:2,a:1})).toBe(
      stableHcmFingerprint({a:1,b:2})
    );
    const alerts=buildWorkforceAlerts({
      activeEmployees:10,activeClinicalEmployees:8,credentialRiskCount:1,
      openAttendanceCount:1,overtimeHours30d:100,approvedLeaveDays30d:2,
      payrollGrossMinorUnits:1000,payrollNetMinorUnits:800,payrollVarianceMinorUnits:50,
      fatigueRiskCount:1,understaffedShiftCount:1,
    });
    expect(alerts.some(a=>a.code==='CREDENTIAL_RISK'&&a.severity==='CRITICAL')).toBe(true);
    expect(alerts.some(a=>a.code==='FATIGUE_RISK'&&a.severity==='CRITICAL')).toBe(true);
    expect(alerts.every(a=>a.explanation.length>20)).toBe(true);
  });

  test('HCM-11 intelligence is read-only source projection',async()=>{
    const s=await source('lib/backend/services/hcm-intelligence-domain-service.ts');
    expect(s).toContain("aggregateType:'HCM_INTELLIGENCE_SNAPSHOT'");
    expect(s).not.toContain("entityType:'EMPLOYEE_MASTER'");
    expect(s).not.toContain("entityType:'ATTENDANCE_RECORD'");
    expect(s).not.toContain("entityType:'PAYROLL_PERIOD'");
  });

  test('HCM-7 through HCM-11 commands are routed',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'ApprovePayrollPeriodCommand',
      'PostPayrollPeriodCommand',
      'SettlePayrollPeriodCommand',
      'RemitPayrollLiabilityCommand',
      'GeneratePayrollComplianceSnapshotCommand',
      'GenerateHcmIntelligenceCommand',
    ]) expect(bus).toContain(`case '${command}'`);
  });

  test('new HCM projections are tenant-scoped and server-write-only',async()=>{
    const rules=await source('firestore.rules');
    const hydration=await source('lib/offline/hydration.ts');
    for(const collection of [
      'payrollStatutoryLiabilities',
      'payrollComplianceSnapshots',
      'hcmIntelligenceSnapshots',
    ]){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+260)).toContain('allow write: if false;');
      expect(hydration).toContain(`'${collection}'`);
    }
  });

  test('HCM Finance provisioning is explicit and guarded',async()=>{
    const p=await source('scripts/ops/hcm-provision-controls.ts');
    for(const marker of [
      'GHIMS_ALLOW_HCM_PROVISION',
      'GHIMS_HCM_PROVISION_TENANT',
      'GHIMS_BOOTSTRAP_CONFIRM_PROJECT',
      'GHIMS_ALLOW_PRODUCTION_HCM_PROVISION',
      "code:'2060'","code:'2070'","code:'2080'","code:'6510'","code:'6520'",
    ]) expect(p).toContain(marker);
  });
});
