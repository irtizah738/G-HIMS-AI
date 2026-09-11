export type StaffRole = 'doctor' | 'nurse' | 'pharmacy' | 'lab' | 'admin';

export type EmploymentType = 'full_time' | 'part_time' | 'locum' | 'contract';

export type StaffActiveStatus = 'active' | 'on_leave' | 'suspended' | 'terminated';

export type CredentialVerificationStatus = 'verified' | 'pending' | 'expired';

export type ShiftType = 'morning' | 'evening' | 'night' | 'on_call' | 'custom';

export type ShiftStatus = 'scheduled' | 'in_progress' | 'completed' | 'swapped' | 'absent';

export type PayrollPeriodStatus = 'open' | 'processing' | 'approved' | 'paid';

export type PayslipPaymentStatus = 'pending' | 'disbursed';

export interface StaffMember {
  id: string;
  tenantId: string;
  userId?: string; // Optional linked user account
  staffNumber: string; // e.g. "EMP-4012"
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone?: string;
  departmentId: string;
  departmentName: string;
  primaryRole: StaffRole;
  employmentType: EmploymentType;
  hourlyRate: number;
  baseSalary: number; // Annual base salary or annualized equivalent
  activeStatus: StaffActiveStatus;
  specialty?: string;
  hireDate?: string;
  assignedWards?: string[];
  maxWeeklyHours?: number; // Defaults to 40
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalCredential {
  id: string;
  tenantId: string;
  staffId: string;
  staffName?: string;
  staffRole?: StaffRole;
  title: string; // e.g., 'Medical License (MD)', 'BLS/ACLS Certification', 'DEA Registration', 'Registered Nurse (RN)'
  licenseNumber: string;
  issuingBody: string; // e.g., 'State Medical Board', 'American Heart Association', 'DEA'
  issueDate: string; // YYYY-MM-DD
  expirationDate: string; // YYYY-MM-DD
  verificationStatus: CredentialVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  documentUrl?: string;
  notes?: string;
  isMandatoryForPractice?: boolean; // If true, scheduling is blocked when expired
  createdAt: string;
  updatedAt: string;
}

export interface RosterShift {
  id: string;
  tenantId: string;
  shiftNumber: string; // e.g., "SH-2026-0815-01"
  staffId: string;
  staffName: string;
  staffRole: StaffRole;
  departmentId: string;
  departmentName: string;
  wardId: string;
  wardName: string;
  shiftType: ShiftType;
  date: string; // YYYY-MM-DD
  scheduledStartTime: string; // ISO or YYYY-MM-DDTHH:mm
  scheduledEndTime: string; // ISO or YYYY-MM-DDTHH:mm
  actualStartTime?: string;
  actualEndTime?: string;
  breakDuration: number; // in minutes (e.g. 30, 45, 60)
  totalHours: number; // Net working hours after breaks
  status: ShiftStatus;
  isOvertime?: boolean;
  overtimeHours?: number;
  swapRequestId?: string;
  notes?: string;
  conflictFlags?: string[]; // Overlap, expired credential, rest-period violation
  createdAt: string;
  updatedAt: string;
}

export interface ShiftSwapRequest {
  id: string;
  tenantId: string;
  requestingStaffId: string;
  requestingStaffName: string;
  requestingShiftId: string;
  requestingShiftDate: string;
  targetStaffId: string;
  targetStaffName: string;
  targetShiftId?: string;
  targetShiftDate?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OvertimeRule {
  id: string;
  tenantId: string;
  ruleName: string;
  weeklyThresholdHours: number; // e.g. 40
  dailyThresholdHours: number; // e.g. 8
  overtimeMultiplier: number; // e.g. 1.5x
  holidayMultiplier: number; // e.g. 2.0x
  nightDifferentialMultiplier?: number; // e.g. 1.15x
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollPeriod {
  id: string;
  tenantId: string;
  periodNumber: string; // e.g. "PR-2026-08"
  periodName: string; // e.g. "August 2026 Monthly Payroll"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  paymentDate: string; // YYYY-MM-DD
  status: PayrollPeriodStatus;
  totalGross: number;
  totalGrossPay?: number;
  totalOvertime: number;
  totalDeductions: number;
  totalNetPay: number;
  staffCount: number;
  payslipCount: number;
  journalEntryId?: string;
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatutoryDeductionBreakdown {
  taxWithholding: number; // Federal & State Income Tax
  socialSecurity: number; // FICA 6.2%
  medicare: number; // Medicare 1.45%
  healthInsurance: number; // Healthcare plan deduction
  totalDeductions: number;
}

export interface Payslip {
  id: string;
  tenantId: string;
  payslipNumber: string; // e.g. "PS-2026-08-001"
  periodId: string;
  payrollPeriodId?: string;
  periodName: string;
  staffId: string;
  employeeId?: string;
  staffName: string;
  staffRole: StaffRole;
  department: string;
  departmentName?: string;
  employmentType: EmploymentType;
  regularHours: number;
  overtimeHours: number;
  hourlyRate: number;
  basePay: number;
  regularPay?: number;
  overtimePay: number;
  shiftDifferentials?: number;
  grossPay: number;
  taxDeduction?: number;
  statutoryDeductions: StatutoryDeductionBreakdown;
  totalDeductions?: number;
  netPayAmount: number;
  netPay?: number;
  paymentStatus: PayslipPaymentStatus;
  disbursedAt?: string;
  disbursedBy?: string;
  paymentMethod?: 'direct_deposit' | 'check' | 'wire';
  createdAt: string;
  updatedAt: string;
}

export interface ShiftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  blockReasons: string[];
}

export interface RestPeriodRuleConfig {
  enabled: boolean;
  minRestHours: number; // e.g. 11 hours standard hospital safety policy
  flagSeverity: 'critical' | 'warning'; // critical blocks scheduling, warning adds alert
  enforceAcrossConsecutiveDays: boolean;
  allowSupervisorOverride: boolean;
  maxWeeklyHours?: number;
  enforceRestPeriodRule?: boolean;
  blockSchedulingOnViolation?: boolean;
}

export interface CredentialExpiryAlert {
  id: string;
  tenantId: string;
  credentialId: string;
  credentialTitle: string;
  licenseNumber: string;
  staffId: string;
  staffName: string;
  staffRole: StaffRole;
  departmentName: string;
  expirationDate: string; // YYYY-MM-DD
  daysUntilExpiration: number; // e.g. 45 days
  urgency?: 'critical' | 'high' | 'moderate';
  thresholdDays: number; // 60 days
  recipientRole: string; // 'Credentialing Director'
  recipientEmail: string; // 'credentialing.director@metrohealth.org'
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'ACKNOWLEDGED' | 'queued' | 'sent' | 'delivered' | 'acknowledged';
  emailSubject: string;
  emailBodyHtml: string;
  triggeredAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}
