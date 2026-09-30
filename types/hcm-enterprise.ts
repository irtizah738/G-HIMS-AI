export interface PayrollStatutoryLiabilityRecord {
  liabilityId: string;
  tenantId: string;
  periodId: string;
  code: string;
  name: string;
  liabilityAccountCode: string;
  currency: string;
  amountMinorUnits: number;
  status: 'ACCRUED' | 'REMITTED';
  createdAt: string;
  remittedAt?: string;
  remittanceJournalId?: string;
  remittanceReference?: string;
}

export interface PayrollComplianceSnapshotRecord {
  snapshotId: string;
  tenantId: string;
  asOf: string;
  currency: string;
  accruedLiabilityMinorUnits: number;
  remittedLiabilityMinorUnits: number;
  openLiabilityCount: number;
  remittedLiabilityCount: number;
  generatedAt: string;
  generatedBy: string;
  inputFingerprint: string;
}

export interface HcmWorkforceIntelligenceSnapshot {
  snapshotId: string;
  tenantId: string;
  asOf: string;
  lookbackDays: number;
  facilityId?: string;
  generatedAt: string;
  generatedBy: string;
  inputFingerprint: string;
  metrics: {
    activeEmployees: number;
    activeClinicalEmployees: number;
    credentialRiskCount: number;
    openAttendanceCount: number;
    overtimeHours30d: number;
    approvedLeaveDays30d: number;
    payrollGrossMinorUnits: number;
    payrollNetMinorUnits: number;
    payrollVarianceMinorUnits: number;
    fatigueRiskCount: number;
    understaffedShiftCount: number;
  };
  alerts: Array<{
    code:
      | 'CREDENTIAL_RISK'
      | 'OPEN_ATTENDANCE'
      | 'OVERTIME_RISK'
      | 'PAYROLL_VARIANCE'
      | 'FATIGUE_RISK'
      | 'STAFFING_GAP';
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    value: number;
    explanation: string;
  }>;
}
