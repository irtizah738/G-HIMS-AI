export type ClinicalLicenseType =
  | 'MedicalLicense'
  | 'NursingBoard'
  | 'DEASchedule'
  | 'BLS_ACLS';

export type CredentialStatus = 'active' | 'expiring_soon' | 'expired';

export interface StaffCredential {
  id: string;
  tenantId: string;
  staffId: string;
  staffName?: string;
  licenseType: ClinicalLicenseType;
  licenseNumber: string;
  expirationDate: string; // YYYY-MM-DD
  status: CredentialStatus;
  issuingBody?: string;
  issueDate?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  documentUrl?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftAssignment {
  id: string;
  tenantId: string;
  staffId: string;
  staffName: string;
  role: string; // e.g. 'Physician', 'Surgeon', 'Registered Nurse', 'Anesthesiologist', 'Pharmacist'
  departmentId: string;
  departmentName?: string;
  wardId: string;
  wardName?: string;
  startTime: string; // ISO 8601 string, e.g. "2026-08-18T07:00:00Z"
  endTime: string; // ISO 8601 string, e.g. "2026-08-18T19:00:00Z"
  breakDurationMins: number; // e.g. 60
  status?: 'scheduled' | 'in_progress' | 'completed' | 'swapped' | 'cancelled';
  shiftType?: 'morning' | 'evening' | 'night' | 'on_call' | 'custom';
  notes?: string;
  isOvertime?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FatigueComplianceResult {
  isCompliant: boolean;
  restDurationHours: number;
  violationReason?: string;
  weeklyHours: number;
  consecutiveDays: number;
  alerts: string[];
}

export interface CredentialLockoutResult {
  isEligible: boolean;
  lockReason?: string;
  expiringCredentials: StaffCredential[];
  expiredCredentials: StaffCredential[];
}
