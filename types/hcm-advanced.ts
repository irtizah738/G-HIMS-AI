/**
 * G-HIMS Master Human Capital & Workforce Management Types
 * Definitive schemas for Employee Master, Credentials, Privileges, Rostering,
 * Attendance, Leave, Positions, Training Compliance & Operational Integrations.
 */

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'TEMPORARY'
  | 'CONSULTANT'
  | 'LOCUM'
  | 'INTERN'
  | 'VOLUNTEER'
  | 'VISITING_CLINICIAN'
  | 'AGENCY_WORKER';

export type EmploymentStatus =
  | 'APPLICANT'
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'ON_LEAVE'
  | 'SUSPENDED'
  | 'NOTICE_PERIOD'
  | 'TERMINATED'
  | 'RETIRED'
  | 'INACTIVE';

export type DepartmentType =
  | 'CLINICAL'
  | 'NURSING'
  | 'LABORATORY'
  | 'RADIOLOGY'
  | 'PHARMACY'
  | 'FINANCE'
  | 'HR'
  | 'ADMINISTRATION'
  | 'IT'
  | 'FACILITIES'
  | 'EMERGENCY'
  | 'SURGERY'
  | 'ICU'
  | 'OPD';

export type ClinicalCredentialType =
  | 'MEDICAL_LICENSE'
  | 'NURSING_BOARD'
  | 'PHARMACY_LICENSE'
  | 'PROFESSIONAL_REGISTRATION'
  | 'SPECIALTY_BOARD'
  | 'BLS_ACLS'
  | 'DEA_REGISTRATION'
  | 'HOSPITAL_CREDENTIAL'
  | 'FELLOWSHIP_CERTIFICATE';

export type CredentialVerificationStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'REVOKED';

export type ClinicalPrivilegeType =
  | 'CONSULT_OPD'
  | 'PRESCRIBE_MEDICATION'
  | 'PERFORM_GENERAL_SURGERY'
  | 'PERFORM_CARDIOTHORACIC_SURGERY'
  | 'ADMINISTER_ANESTHESIA'
  | 'ORDER_HIGH_COMPLEXITY_LAB'
  | 'APPROVE_LAB_RESULTS'
  | 'INTERPRET_RADIOLOGY_CT_MRI'
  | 'SIGN_DEATH_CERTIFICATE'
  | 'PERFORM_INVASIVE_PROCEDURES'
  | 'SIGN_SOAP_CLINICAL_NOTE';

export type PrivilegeStatus =
  | 'REQUESTED'
  | 'UNDER_REVIEW'
  | 'GRANTED'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REVOKED';

export type ShiftType = 'MORNING' | 'EVENING' | 'NIGHT' | 'ON_CALL' | 'SPLIT' | 'CUSTOM';

export type RosterShiftStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'SWAPPED';

export type AttendanceSource =
  | 'BIOMETRIC_SCANNER'
  | 'KIOSK_TERMINAL'
  | 'MOBILE_GPS'
  | 'WEB_PORTAL'
  | 'SUPERVISOR_OVERRIDE'
  | 'HL7_ACCESS_CARD';

export type AttendanceStatus =
  | 'ON_TIME'
  | 'LATE_ARRIVAL'
  | 'EARLY_DEPARTURE'
  | 'OVERTIME'
  | 'ABSENT'
  | 'SHIFT_MISMATCH'
  | 'CORRECTED';

export type LeaveType =
  | 'ANNUAL'
  | 'SICK'
  | 'EMERGENCY'
  | 'MATERNITY_PATERNITY'
  | 'UNPAID'
  | 'STUDY_CME'
  | 'COMPENSATORY';

export type LeaveStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'TAKEN';

export type TrainingComplianceStatus = 'COMPLIANT' | 'EXPIRING_SOON' | 'NON_COMPLIANT';

// ============================================================================
// 1. ORGANIZATIONAL STRUCTURE
// ============================================================================

export interface OrganizationUnit {
  tenantId: string;
  facilityId: string;
  facilityName: string;
  campusId: string;
  campusName: string;
  buildingId: string;
  buildingName: string;
  departmentId: string;
  departmentName: string;
  unitId?: string;
  unitName?: string;
  teamId?: string;
  teamName?: string;
}

export interface HospitalDepartment {
  departmentId: string;
  code: string; // e.g. "CARD-01", "ER-TRIAGE"
  name: string;
  type: DepartmentType;
  facilityId: string;
  parentDepartmentId?: string;
  managerEmployeeId?: string;
  managerName?: string;
  costCenterId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RESTRUCTURING';
  operatingHours: {
    is24Hours: boolean;
    openTime?: string;
    closeTime?: string;
  };
  headcountBudget: number;
  currentHeadcount: number;
}

export interface PositionDefinition {
  positionId: string;
  title: string;
  departmentId: string;
  departmentName: string;
  jobCode: string;
  gradeLevel: string; // e.g. "L7-Specialist", "N4-ChargeNurse"
  requiredSkills: string[];
  requiredCredentials: ClinicalCredentialType[];
  requiredPrivileges: ClinicalPrivilegeType[];
  minimumExperienceYears: number;
  salaryRange: {
    min: number;
    max: number;
    currency: string;
  };
  status: 'ACTIVE' | 'OBSOLETE';
}

export interface JobDefinition {
  jobDefinitionId: string;
  title: string;
  responsibilities: string[];
  requiredSkills: string[];
  requiredCredentials: ClinicalCredentialType[];
  requiredTrainingCourses: string[];
  requiredEducation: string;
  minimumExperienceMonths: number;
  permittedDepartmentTypes: DepartmentType[];
}

// ============================================================================
// 2. EMPLOYEE MASTER & LIFECYCLE
// ============================================================================

export interface EmployeeMaster {
  employeeId: string;
  employeeNumber: string; // e.g. "EMP-2026-0814"
  userId?: string; // Linked Firebase Auth UID. Server-managed identity link only.
  tenantId: string;
  facilityIds: string[];
  primaryFacilityId: string;
  departmentIds: string[];
  primaryDepartmentId: string;
  primaryDepartmentName: string;
  positionId: string;
  positionTitle: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  hireDate: string; // YYYY-MM-DD
  terminationDate?: string;
  managerId?: string;
  managerName?: string;
  supervisorId?: string;
  currentAssignmentId?: string;
  personalInfo: {
    legalFirstName: string;
    legalLastName: string;
    preferredName?: string;
    dateOfBirth: string;
    nationalIdNumber?: string;
    gender: 'FEMALE' | 'MALE' | 'NON_BINARY' | 'UNDISCLOSED';
    contactEmail: string;
    contactPhone: string;
    emergencyContact: {
      name: string;
      relationship: string;
      phone: string;
    };
    residentialAddress: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
    photoUrl?: string;
  };
  specialty?: string;
  subSpecialties?: string[];
  onboardingStage?: 'OFFER_ACCEPTED' | 'DOCUMENT_SUBMISSION' | 'CREDENTIAL_VERIFICATION' | 'TRAINING_ASSIGNED' | 'ACTIVE';
  offboardingStage?: 'RESIGNED' | 'NOTICE_PERIOD' | 'ACCESS_REVOKED' | 'ASSETS_RETURNED' | 'SETTLEMENT_COMPLETED' | 'ARCHIVED';
  credentialRevision?: number;
  compensation?: {
    baseSalary?: number;
    hourlyRate?: number;
    currency?: string;
    paySchedule?: 'BIWEEKLY' | 'MONTHLY' | 'WEEKLY';
  };
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export interface EmployeeAssignmentHistory {
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  facilityId: string;
  facilityName: string;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionTitle: string;
  managerId?: string;
  startDate: string;
  endDate?: string;
  transferReason?: string;
  status: 'ACTIVE' | 'CONCLUDED' | 'CANCELLED';
  createdAt: string;
}

// ============================================================================
// 3. CREDENTIALS & CLINICAL PRIVILEGES
// ============================================================================

export interface EmployeeCredential {
  credentialId: string;
  employeeId: string;
  employeeName: string;
  credentialType: ClinicalCredentialType;
  title: string;
  issuingAuthority: string;
  credentialNumber: string;
  issueDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  verificationStatus: CredentialVerificationStatus;
  verifiedByActorId?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  documentReference?: string;
  documentHash?: string;
  notes?: string;
  isMandatoryForPractice: boolean;
  submittedByActorId?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalPrivilege {
  privilegeId: string;
  employeeId: string;
  employeeName: string;
  privilegeType: ClinicalPrivilegeType;
  specialty: string;
  facilityId: string;
  facilityName: string;
  departmentId: string;
  departmentName: string;
  effectiveFrom: string;
  effectiveUntil: string;
  status: PrivilegeStatus;
  grantedByActorId: string;
  grantedByName?: string;
  reviewedAt?: string;
  restrictionNotes?: string;
  statusReason?: string;
  statusChangedByActorId?: string;
  statusChangedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 4. SKILLS, TRAINING & COMPLIANCE
// ============================================================================

export interface EmployeeSkill {
  skillId: string;
  employeeId: string;
  skillName: string;
  proficiencyLevel: 'NOVICE' | 'COMPETENT' | 'PROFICIENT' | 'EXPERT' | 'MASTER';
  verifiedByActorId?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  expiryDate?: string;
  evidenceReference?: string;
}

export interface TrainingCourse {
  courseId: string;
  code: string;
  title: string;
  category: 'INFECTION_CONTROL' | 'EMERGENCY_RESPONSE' | 'MEDICATION_SAFETY' | 'ACLS_BLS' | 'RADIATION_SAFETY' | 'HIPAA_DATA_SECURITY' | 'EHR_SYSTEM';
  isMandatory: boolean;
  validityMonths: number;
  requiredForRoles: string[];
}

export interface EmployeeTrainingRecord {
  trainingId: string;
  employeeId: string;
  employeeName: string;
  courseId: string;
  courseTitle: string;
  completionDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  scorePercentage?: number;
  trainerName: string;
  certificateNumber?: string;
  certificateReference?: string;
  complianceStatus: TrainingComplianceStatus;
  createdAt: string;
}

// ============================================================================
// 5. SHIFTS, ROSTERING & GAP DETECTION
// ============================================================================

export interface ShiftDefinition {
  shiftId: string;
  shiftCode: string; // e.g. "M-0715", "N-2307"
  name: string;
  startTime: string; // "07:00"
  endTime: string; // "15:30" (supports overnight e.g. "23:00" to "07:00")
  durationHours: number;
  breakDurationMinutes: number;
  facilityId: string;
  departmentId: string;
  isOvernight: boolean;
  breakPolicy: 'PAID' | 'UNPAID' | 'FLEXIBLE';
  status: 'ACTIVE' | 'INACTIVE';
}

export interface StaffingRequirement {
  requirementId: string;
  facilityId: string;
  departmentId: string;
  departmentName: string;
  shiftId: string;
  shiftName: string;
  date: string; // YYYY-MM-DD
  requiredDoctors: number;
  requiredSpecialists: number;
  requiredNurses: number;
  requiredTechnicians: number;
  requiredPharmacists: number;
  requiredSkills: string[];
  requiredPrivileges: ClinicalPrivilegeType[];
}

export interface StaffingGapAnalysis {
  departmentId: string;
  departmentName: string;
  shiftId: string;
  shiftName: string;
  date: string;
  requiredCount: number;
  scheduledCount: number;
  presentCount: number;
  gapCount: number;
  status: 'UNDERSTAFFED' | 'FULLY_STAFFED' | 'OVERSTAFFED';
  missingSpecialties: string[];
  fatigueAlerts: string[];
  credentialAlerts: string[];
}

export interface RosterTimelineEntry {
  rosterId: string;
  startTime: string;
  endTime: string;
  status: RosterShiftStatus;
}

export interface RosterTimelineBucket {
  timelineId: string;
  tenantId: string;
  employeeId: string;
  monthKey: string; // YYYY-MM
  shifts: RosterTimelineEntry[];
  updatedAt: string;
}

export interface RosterShiftEntry {
  rosterId: string;
  tenantId: string;
  facilityId: string;
  facilityName: string;
  departmentId: string;
  departmentName: string;
  employeeId: string;
  employeeName: string;
  positionTitle: string;
  date: string; // YYYY-MM-DD
  shiftId: string;
  shiftName: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  durationHours: number;
  status: RosterShiftStatus;
  isOvertime: boolean;
  overtimeHours?: number;
  publishedAt?: string;
  publishedBy?: string;
  conflictFlags?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RosterSwapRecord {
  swapId: string;
  tenantId: string;
  shiftAId: string;
  shiftBId: string;
  employeeAId: string;
  employeeBId: string;
  reason: string;
  executedBy: string;
  executedAt: string;
  status: 'COMPLETED';
}

// ============================================================================
// 6. ATTENDANCE, TIME TRACKING & CORRECTIONS
// ============================================================================

export interface AttendanceOpenSlot {
  slotId: string;
  tenantId: string;
  employeeId: string;
  attendanceId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string;
}

export interface AttendanceCorrectionRecord {
  correctionId: string;
  tenantId: string;
  attendanceId: string;
  employeeId: string;
  previousClockInTime: string;
  previousClockOutTime?: string;
  newClockInTime: string;
  newClockOutTime?: string;
  reason: string;
  correctedByActorId: string;
  correctedAt: string;
}

export interface AttendanceRecord {
  attendanceId: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  facilityId: string;
  departmentId: string;
  date: string; // YYYY-MM-DD
  scheduledShiftId?: string;
  scheduledShiftName?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  clockInTime: string; // ISO 8601
  clockOutTime?: string; // ISO 8601
  breakStartTime?: string;
  breakEndTime?: string;
  totalHoursWorked: number;
  overtimeHours: number;
  overtimeApproved: boolean;
  overtimeApprovedBy?: string;
  source: AttendanceSource;
  deviceIdentifier?: string;
  status: AttendanceStatus;
  originalClockInTime?: string;
  originalClockOutTime?: string;
  isCorrected: boolean;
  correctionHistory?: Array<{
    correctionId: string;
    correctedByActorId: string;
    correctedByName: string;
    correctedAt: string;
    previousClockIn: string;
    newClockIn: string;
    reason: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 7. LEAVE MANAGEMENT & BALANCES
// ============================================================================

export interface LeaveCalendarEntry {
  leaveId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
}

export interface LeaveCalendarBucket {
  calendarId: string;
  tenantId: string;
  employeeId: string;
  year: number;
  entries: LeaveCalendarEntry[];
  updatedAt: string;
}

export interface LeaveRequest {
  leaveId: string;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewedByActorId?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  coveringEmployeeId?: string;
  coveringEmployeeName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeLeaveBalance {
  employeeId: string;
  leaveType: LeaveType;
  year: number;
  annualEntitlement: number;
  accruedDays: number;
  usedDays: number;
  pendingApprovalDays: number;
  remainingDays: number;
  lastUpdated: string;
}

// ============================================================================
// 8. COMPENSATION & ERP PAYROLL INTEGRATION
// ============================================================================

export interface CompensationStructure {
  compensationId: string;
  employeeId: string;
  baseSalaryAnnual: number;
  hourlyRate: number;
  currency: string;
  effectiveDate: string; // YYYY-MM-DD
  payFrequency: 'BI_WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
  allowances: Array<{
    type: 'ON_CALL' | 'SHIFT_DIFFERENTIAL' | 'HAZARD_PAY' | 'SPECIALIST_STIPEND' | 'HOUSING';
    amount: number;
    frequency: 'PER_SHIFT' | 'MONTHLY' | 'ANNUAL';
  }>;
  statutoryDeductions: Array<{
    name: string;
    ratePercentage: number;
    fixedAmount?: number;
  }>;
  version: number;
  createdAt: string;
}

export type CompensationPayBasis = 'SALARIED' | 'HOURLY';
export type PayrollFrequency = 'MONTHLY' | 'SEMI_MONTHLY' | 'BI_WEEKLY';

export interface CompensationProfileRecord {
  compensationId: string;
  tenantId: string;
  employeeId: string;
  payBasis: CompensationPayBasis;
  payFrequency: PayrollFrequency;
  currency: string;
  annualSalaryMinorUnits: number;
  hourlyRateMinorUnits: number;
  overtimeMultiplierBasisPoints: number;
  monthlyAllowanceMinorUnits: number;
  deductions: Array<{
    code: string;
    name: string;
    rateBasisPoints: number;
    fixedMinorUnits: number;
  }>;
  effectiveFrom: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUPERSEDED';
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface CompensationSlotRecord {
  slotId: string;
  tenantId: string;
  employeeId: string;
  activeCompensationId?: string;
  pendingCompensationId?: string;
  revision: number;
  updatedAt: string;
}

export interface PayrollPeriodRecord {
  periodId: string;
  tenantId: string;
  facilityId: string;
  periodNumber: string;
  periodName: string;
  payFrequency: PayrollFrequency;
  startDate: string;
  endDate: string;
  paymentDate: string;
  currency: string;
  status: 'OPEN' | 'CALCULATING' | 'CALCULATED' | 'POSTED' | 'PAID' | 'VOID';
  enrolledCount: number;
  calculatedCount: number;
  totalRegularMinorUnits: number;
  totalOvertimeMinorUnits: number;
  totalAllowanceMinorUnits: number;
  totalGrossMinorUnits: number;
  totalDeductionsMinorUnits: number;
  totalNetMinorUnits: number;
  expenseByCostCenterMinorUnits: Record<string, number>;
  financeJournalId?: string;
  settlementJournalId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollCalendarEntry {
  periodId: string;
  startDate: string;
  endDate: string;
  status: PayrollPeriodRecord['status'];
}

export interface PayrollCalendarBucket {
  calendarId: string;
  tenantId: string;
  facilityId: string;
  year: number;
  entries: PayrollCalendarEntry[];
  updatedAt: string;
}

export interface PayrollAttendanceLockRecord {
  lockId: string;
  tenantId: string;
  employeeId: string;
  lockedThroughDate: string;
  periodId: string;
  updatedAt: string;
}

export interface PayrollEmployeeSlotRecord {
  slotId: string;
  tenantId: string;
  periodId: string;
  employeeId: string;
  compensationId: string;
  compensationRevision: number;
  status: 'PENDING' | 'CALCULATED' | 'EXCLUDED';
  payslipId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollPayslipRecord {
  payslipId: string;
  tenantId: string;
  periodId: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  currency: string;
  regularHours: number;
  overtimeHours: number;
  regularPayMinorUnits: number;
  overtimePayMinorUnits: number;
  allowanceMinorUnits: number;
  grossPayMinorUnits: number;
  deductions: Array<{
    code: string;
    name: string;
    amountMinorUnits: number;
  }>;
  totalDeductionsMinorUnits: number;
  netPayMinorUnits: number;
  attendanceFingerprint: string;
  calculatedAt: string;
  calculatedBy: string;
}

export interface PayrollExportPayload {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  totalEmployees: number;
  lineItems: Array<{
    employeeId: string;
    employeeNumber: string;
    employeeName: string;
    departmentId: string;
    baseSalaryPeriod: number;
    regularHoursWorked: number;
    overtimeHoursWorked: number;
    overtimePay: number;
    allowancesTotal: number;
    deductionsTotal: number;
    grossPay: number;
    netPay: number;
  }>;
  totalGrossPayMinorUnits: number;
  totalNetPayMinorUnits: number;
  glPostingAccountId: string;
}

// ============================================================================
// 9. PERFORMANCE & DISCIPLINARY MANAGEMENT
// ============================================================================

export interface PerformanceReview {
  reviewId: string;
  employeeId: string;
  employeeName: string;
  departmentId: string;
  reviewPeriod: string; // e.g. "2026-H1", "Annual-2026"
  reviewerActorId: string;
  reviewerName: string;
  overallRating: number; // 1 to 5
  clinicalCompetenceRating: number;
  patientSatisfactionRating: number;
  complianceRating: number;
  strengths: string;
  developmentGoals: string;
  status: 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'FINALIZED_IMMUTABLE';
  finalizedAt?: string;
  createdAt: string;
}

export interface DisciplinaryRecord {
  recordId: string;
  employeeId: string;
  employeeName: string;
  incidentDate: string;
  incidentType: 'POLICY_VIOLATION' | 'CLINICAL_NEGLIGENCE' | 'ATTENDANCE_BREACH' | 'CODE_OF_CONDUCT';
  severity: 'VERBAL_WARNING' | 'WRITTEN_WARNING' | 'SUSPENSION' | 'TERMINATION_ESCALATION';
  investigatorActorId: string;
  investigatorName: string;
  findings: string;
  actionTaken: string;
  appealStatus?: 'NONE' | 'APPEALED' | 'UPHELD' | 'DISMISSED';
  isConfidential: boolean;
  createdAt: string;
}

// ============================================================================
// 10. CREDENTIAL LOCKOUT & COMPLIANCE GUARD
// ============================================================================

export type ClinicalLicenseType =
  | 'MedicalLicense'
  | 'NursingBoard'
  | 'DEASchedule'
  | 'BLS_ACLS'
  | 'SpecialtyBoard'
  | 'PharmacyLicense'
  | string;

export interface StaffCredential {
  id: string;
  staffId: string;
  tenantId?: string;
  staffName?: string;
  staffRole?: string;
  title?: string;
  licenseType: ClinicalLicenseType;
  licenseNumber: string;
  issuingBody?: string;
  issueDate?: string;
  expirationDate: string;
  verificationStatus?: 'verified' | 'pending' | 'expired';
  status?: 'active' | 'expired' | 'suspended' | 'pending';
  documentUrl?: string;
  notes?: string;
  isMandatoryForPractice?: boolean;
  createdAt?: string;
}

export interface CredentialLockoutResult {
  isEligible: boolean;
  lockReason?: string;
  expiringCredentials: StaffCredential[];
  expiredCredentials: StaffCredential[];
}

export interface ShiftAssignment {
  id: string;
  startTime: string;
  endTime: string;
  status?: string;
  staffId?: string;
  staffName?: string;
  departmentId?: string;
  shiftType?: string;
  [key: string]: any;
}

export interface FatigueComplianceResult {
  isCompliant: boolean;
  restDurationHours: number;
  violationReason?: string;
  weeklyHours: number;
  consecutiveDays: number;
  alerts: string[];
}
