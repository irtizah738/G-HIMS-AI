import { StaffCredential, CredentialLockoutResult, ClinicalLicenseType } from '@/types/hcm-advanced';

export const MANDATORY_CLINICAL_CREDENTIALS: Record<string, ClinicalLicenseType[]> = {
  Doctor: ['MedicalLicense', 'DEASchedule', 'BLS_ACLS'],
  Physician: ['MedicalLicense', 'DEASchedule', 'BLS_ACLS'],
  Surgeon: ['MedicalLicense', 'DEASchedule', 'BLS_ACLS'],
  Anesthesiologist: ['MedicalLicense', 'DEASchedule', 'BLS_ACLS'],
  Nurse: ['NursingBoard', 'BLS_ACLS'],
  'Registered Nurse': ['NursingBoard', 'BLS_ACLS'],
  'Scrub Nurse': ['NursingBoard', 'BLS_ACLS'],
  Pharmacist: ['MedicalLicense'],
};

/**
 * Healthcare HCM Credential Guard & Clinical Lockout System
 * Cross-references scheduled shift date against staff clinical licenses and certifications.
 * If any mandatory clinical license or certification has expired or expires on or before
 * the shift date, returns a hard lockout prohibiting shift assignment.
 */
export function verifyStaffCredentialLockout(
  staffId: string,
  credentials: StaffCredential[],
  shiftDate: string, // YYYY-MM-DD or ISO string
  staffRole?: string
): {
  isEligible: boolean;
  lockReason?: string;
  expiringCredentials: StaffCredential[];
  expiredCredentials: StaffCredential[];
} {
  const targetDateStr = shiftDate.includes('T') ? shiftDate.split('T')[0] : shiftDate;
  const shiftTimestamp = new Date(`${targetDateStr}T23:59:59Z`).getTime();

  const staffCreds = credentials.filter((c) => c.staffId === staffId);

  const expiredCredentials: StaffCredential[] = [];
  const expiringCredentials: StaffCredential[] = [];

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const cred of staffCreds) {
    if (!cred.expirationDate) continue;

    const credExpTimestamp = new Date(`${cred.expirationDate}T00:00:00Z`).getTime();

    // Check if expired on or before the shift date
    if (credExpTimestamp <= shiftTimestamp || cred.status === 'expired') {
      expiredCredentials.push(cred);
    } else if (credExpTimestamp - shiftTimestamp <= thirtyDaysMs) {
      expiringCredentials.push(cred);
    }
  }

  // If there are no credentials found at all for clinical staff, check if mandatory
  if (staffCreds.length === 0 && staffRole && MANDATORY_CLINICAL_CREDENTIALS[staffRole]) {
    return {
      isEligible: false,
      lockReason: `MANDATORY CREDENTIAL LOCKOUT: No verified clinical credentials found for ${staffRole} (ID: ${staffId}). Medical licensing or board certification required before roster assignment.`,
      expiringCredentials: [],
      expiredCredentials: [],
    };
  }

  // Hard lockout if any credential expired on or before the shift date
  if (expiredCredentials.length > 0) {
    const expiredList = expiredCredentials
      .map((c) => `${c.licenseType} (#${c.licenseNumber}, expired ${c.expirationDate})`)
      .join('; ');

    return {
      isEligible: false,
      lockReason: `CREDENTIAL LOCKOUT ACTIVE: Staff member has expired clinical credentials on shift date (${targetDateStr}): ${expiredList}. Practice prohibited by hospital compliance.`,
      expiringCredentials,
      expiredCredentials,
    };
  }

  return {
    isEligible: true,
    expiringCredentials,
    expiredCredentials: [],
  };
}
