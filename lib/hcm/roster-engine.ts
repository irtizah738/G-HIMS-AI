import {
  RosterShift,
  StaffMember,
  ClinicalCredential,
  OvertimeRule,
  ShiftValidationResult,
  StatutoryDeductionBreakdown,
  RestPeriodRuleConfig,
} from '@/types/hcm';

export const DEFAULT_REST_PERIOD_RULE: RestPeriodRuleConfig = {
  enabled: true,
  enforceRestPeriodRule: true,
  blockSchedulingOnViolation: true,
  minRestHours: 11, // Standard Hospital Safety Protocol (11-hour mandatory gap between consecutive shifts)
  maxWeeklyHours: 60,
  flagSeverity: 'critical',
  enforceAcrossConsecutiveDays: true,
  allowSupervisorOverride: true,
};

export const DEFAULT_OVERTIME_RULE: OvertimeRule = {
  id: 'rule-standard-hospital',
  tenantId: 'default',
  ruleName: 'Standard Hospital FLSA Tier 1 (40hr / 8hr)',
  weeklyThresholdHours: 40,
  dailyThresholdHours: 8,
  overtimeMultiplier: 1.5,
  holidayMultiplier: 2.0,
  nightDifferentialMultiplier: 1.15,
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Calculates net working hours between start and end timestamps, deducting break time.
 */
export function calculateShiftDurationHours(
  scheduledStartTime: string,
  scheduledEndTime: string,
  breakDurationMinutes: number = 0
): number {
  try {
    const start = new Date(scheduledStartTime).getTime();
    const end = new Date(scheduledEndTime).getTime();

    if (isNaN(start) || isNaN(end) || end <= start) {
      return 0;
    }

    const diffMinutes = (end - start) / (1000 * 60);
    const netMinutes = Math.max(0, diffMinutes - (breakDurationMinutes || 0));
    return Math.round((netMinutes / 60) * 100) / 100;
  } catch {
    return 0;
  }
}

/**
 * Evaluates shift assignment against clinical credential expiration,
 * overlapping assignments, and mandatory minimum rest period rules (e.g. 11h).
 */
export function validateShiftAssignment(
  candidateShift: {
    staffId: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
    date: string;
    shiftId?: string;
  },
  existingShifts: RosterShift[],
  staffCredentials: ClinicalCredential[],
  staffMember?: StaffMember,
  options?: {
    minRestHours?: number; // Hospital safety standard: 11 hours
    maxWeeklyHours?: number; // Clinical exhaustion cap: 60 hours
    restPeriodRule?: RestPeriodRuleConfig;
  }
): ShiftValidationResult {
  const restConfig = options?.restPeriodRule ?? DEFAULT_REST_PERIOD_RULE;
  const minRestHours = options?.minRestHours ?? restConfig.minRestHours ?? 11;
  const isRestRuleEnabled = restConfig.enabled !== false;
  const maxWeeklyHours = options?.maxWeeklyHours ?? 60;

  const errors: string[] = [];
  const warnings: string[] = [];
  const blockReasons: string[] = [];

  const candidateStart = new Date(candidateShift.scheduledStartTime).getTime();
  const candidateEnd = new Date(candidateShift.scheduledEndTime).getTime();
  const shiftDate = candidateShift.date || candidateShift.scheduledStartTime.split('T')[0];

  if (isNaN(candidateStart) || isNaN(candidateEnd)) {
    errors.push('Invalid shift start or end timestamp.');
    return { valid: false, errors, warnings, blockReasons: errors };
  }

  if (candidateEnd <= candidateStart) {
    errors.push('Shift end time must be strictly after start time.');
    return { valid: false, errors, warnings, blockReasons: errors };
  }

  // 1. Check Staff Active Status
  if (staffMember) {
    if (staffMember.activeStatus === 'suspended') {
      blockReasons.push(`Staff member ${staffMember.fullName} is currently suspended.`);
    } else if (staffMember.activeStatus === 'terminated') {
      blockReasons.push(`Staff member ${staffMember.fullName} is terminated.`);
    } else if (staffMember.activeStatus === 'on_leave') {
      warnings.push(`Staff member ${staffMember.fullName} is marked on leave during this period.`);
    }
  }

  // 2. Check Clinical Credentials & License Expirations
  const relevantCredentials = staffCredentials.filter(
    (c) => c.staffId === candidateShift.staffId
  );

  for (const cred of relevantCredentials) {
    const isExpiredByStatus = cred.verificationStatus === 'expired';
    const isExpiredByDate = cred.expirationDate && cred.expirationDate <= shiftDate;

    if (isExpiredByStatus || isExpiredByDate) {
      const msg = `Mandatory credential "${cred.title}" (${cred.licenseNumber}) expired on ${cred.expirationDate}. Clinical assignment blocked.`;
      blockReasons.push(msg);
      errors.push(msg);
    } else if (cred.verificationStatus === 'pending') {
      warnings.push(`Credential "${cred.title}" is pending supervisor verification.`);
    } else if (cred.expirationDate) {
      // Check if expiring within 30 days of shift
      const expTime = new Date(cred.expirationDate).getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (expTime - candidateStart < thirtyDays && expTime > candidateStart) {
        warnings.push(
          `Credential "${cred.title}" will expire soon on ${cred.expirationDate}.`
        );
      }
    }
  }

  // 3. Check Overlapping Shifts & Consecutive Rest Period Rule (11h gap) for this staff member
  const otherShifts = existingShifts.filter(
    (s) =>
      s.staffId === candidateShift.staffId &&
      s.id !== candidateShift.shiftId &&
      s.status !== 'swapped' &&
      s.status !== 'absent'
  );

  for (const shift of otherShifts) {
    const sStart = new Date(shift.scheduledStartTime).getTime();
    const sEnd = new Date(shift.scheduledEndTime).getTime();

    // Check Direct Overlap: (StartA < EndB) and (EndA > StartB)
    if (candidateStart < sEnd && candidateEnd > sStart) {
      const overlapMsg = `Direct shift overlap: conflicts with existing shift ${shift.shiftNumber} (${shift.shiftType} in ${shift.wardName || shift.departmentName}).`;
      blockReasons.push(overlapMsg);
      errors.push(overlapMsg);
    }

    // Check Minimum Rest Period (Previous shift -> candidate shift)
    if (isRestRuleEnabled && sEnd <= candidateStart) {
      const restHours = (candidateStart - sEnd) / (1000 * 60 * 60);
      if (restHours < minRestHours) {
        const violationMsg = `Rest-Period Rule Violation: Only ${restHours.toFixed(1)}h rest gap after shift ${shift.shiftNumber || shift.shiftType} (minimum mandatory: ${minRestHours}h). Fatigue safety risk.`;
        if (restConfig.flagSeverity === 'critical') {
          blockReasons.push(violationMsg);
          errors.push(violationMsg);
        } else {
          warnings.push(violationMsg);
        }
      }
    }

    // Check Minimum Rest Period (Candidate shift -> Next shift)
    if (isRestRuleEnabled && candidateEnd <= sStart) {
      const restHours = (sStart - candidateEnd) / (1000 * 60 * 60);
      if (restHours < minRestHours) {
        const violationMsg = `Rest-Period Rule Violation: Only ${restHours.toFixed(1)}h rest gap before shift ${shift.shiftNumber || shift.shiftType} (minimum mandatory: ${minRestHours}h). Fatigue safety risk.`;
        if (restConfig.flagSeverity === 'critical') {
          blockReasons.push(violationMsg);
          errors.push(violationMsg);
        } else {
          warnings.push(violationMsg);
        }
      }
    }
  }

  // 4. Check Weekly Hours Threshold (Exhaustion Cap)
  const shiftWeekStart = getMondayOfWeek(new Date(candidateShift.scheduledStartTime));
  const shiftWeekEnd = new Date(shiftWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const weeklyShifts = otherShifts.filter((s) => {
    const time = new Date(s.scheduledStartTime).getTime();
    return time >= shiftWeekStart.getTime() && time < shiftWeekEnd.getTime();
  });

  const existingWeeklyHours = weeklyShifts.reduce((sum, s) => sum + (s.totalHours || 0), 0);
  const thisShiftHours = calculateShiftDurationHours(
    candidateShift.scheduledStartTime,
    candidateShift.scheduledEndTime
  );
  const totalProjectedWeeklyHours = existingWeeklyHours + thisShiftHours;

  if (totalProjectedWeeklyHours > maxWeeklyHours) {
    warnings.push(
      `Weekly clinical exhaustion alert: Total scheduled hours for week (${totalProjectedWeeklyHours.toFixed(1)}h) exceeds safety ceiling of ${maxWeeklyHours}h.`
    );
  } else if (totalProjectedWeeklyHours > 40) {
    warnings.push(
      `Overtime warning: Shift will trigger overtime (${(totalProjectedWeeklyHours - 40).toFixed(1)}h weekly OT).`
    );
  }

  return {
    valid: blockReasons.length === 0 && errors.length === 0,
    errors,
    warnings,
    blockReasons,
  };
}

/**
 * Checks a specific roster shift in the matrix for conflict flags,
 * including the 11h Rest-Period Rule, overlapping shifts, and expired credentials.
 */
export function evaluateRosterShiftConflicts(
  shift: RosterShift,
  allShifts: RosterShift[],
  credentials: ClinicalCredential[],
  staffMember?: StaffMember,
  restPeriodRule: RestPeriodRuleConfig = DEFAULT_REST_PERIOD_RULE
): {
  hasConflict: boolean;
  hasCriticalError: boolean;
  hasWarning: boolean;
  isRestPeriodViolation: boolean;
  hasRestPeriodViolation: boolean;
  hasExpiredCredential: boolean;
  hasOverlap: boolean;
  restGapHours?: number;
  conflictDetails: string[];
  reasons: string[];
  severity: 'none' | 'warning' | 'critical';
} {
  const conflictDetails: string[] = [];
  let isRestPeriodViolation = false;
  let hasExpiredCredential = false;
  let hasOverlap = false;
  let minGapFound: number | undefined = undefined;
  let hasCriticalError = false;
  let hasWarning = false;

  const shiftStart = new Date(shift.scheduledStartTime).getTime();
  const shiftEnd = new Date(shift.scheduledEndTime).getTime();
  const shiftDate = shift.date || shift.scheduledStartTime.split('T')[0];

  // 1. Credentials Check
  const staffCreds = credentials.filter((c) => c.staffId === shift.staffId);
  for (const cred of staffCreds) {
    if (cred.verificationStatus === 'expired' || (cred.expirationDate && cred.expirationDate <= shiftDate)) {
      hasCriticalError = true;
      hasExpiredCredential = true;
      conflictDetails.push(`Expired License: ${cred.title} (${cred.licenseNumber}) expired ${cred.expirationDate}`);
    }
  }

  // 2. Overlap & Rest-Period Gap Check with other shifts of same staff member
  const otherStaffShifts = allShifts.filter(
    (s) => s.staffId === shift.staffId && s.id !== shift.id && s.status !== 'swapped' && s.status !== 'absent'
  );

  const minRestHours = restPeriodRule.minRestHours ?? 11;
  const isRestEnabled = restPeriodRule.enabled !== false;

  for (const other of otherStaffShifts) {
    const oStart = new Date(other.scheduledStartTime).getTime();
    const oEnd = new Date(other.scheduledEndTime).getTime();

    // Overlap
    if (shiftStart < oEnd && shiftEnd > oStart) {
      hasCriticalError = true;
      hasOverlap = true;
      conflictDetails.push(`Direct Shift Overlap with ${other.shiftType} shift (${other.scheduledStartTime.split('T')[1]?.substring(0, 5)} - ${other.scheduledEndTime.split('T')[1]?.substring(0, 5)})`);
    }

    // Preceding shift -> this shift
    if (isRestEnabled && oEnd <= shiftStart) {
      const gapHours = (shiftStart - oEnd) / (1000 * 60 * 60);
      if (gapHours < minRestHours) {
        isRestPeriodViolation = true;
        minGapFound = minGapFound !== undefined ? Math.min(minGapFound, gapHours) : gapHours;
        const msg = `Rest-Period Violation: Only ${gapHours.toFixed(1)}h rest gap after previous ${other.shiftType} shift (mandatory: ${minRestHours}h)`;
        if (restPeriodRule.flagSeverity === 'critical') {
          hasCriticalError = true;
        } else {
          hasWarning = true;
        }
        conflictDetails.push(msg);
      }
    }

    // This shift -> succeeding shift
    if (isRestEnabled && shiftEnd <= oStart) {
      const gapHours = (oStart - shiftEnd) / (1000 * 60 * 60);
      if (gapHours < minRestHours) {
        isRestPeriodViolation = true;
        minGapFound = minGapFound !== undefined ? Math.min(minGapFound, gapHours) : gapHours;
        const msg = `Rest-Period Violation: Only ${gapHours.toFixed(1)}h rest gap before next ${other.shiftType} shift (mandatory: ${minRestHours}h)`;
        if (restPeriodRule.flagSeverity === 'critical') {
          hasCriticalError = true;
        } else {
          hasWarning = true;
        }
        conflictDetails.push(msg);
      }
    }
  }

  // Also include any static conflictFlags already recorded on shift
  if (shift.conflictFlags && shift.conflictFlags.length > 0) {
    shift.conflictFlags.forEach((cf) => {
      if (!conflictDetails.includes(cf)) {
        conflictDetails.push(cf);
        if (cf.toLowerCase().includes('rest') || cf.toLowerCase().includes('violation')) {
          isRestPeriodViolation = true;
        }
        if (cf.toLowerCase().includes('overlap')) {
          hasOverlap = true;
        }
        if (cf.toLowerCase().includes('credential') || cf.toLowerCase().includes('license') || cf.toLowerCase().includes('expired')) {
          hasExpiredCredential = true;
        }
        hasWarning = true;
      }
    });
  }

  const hasConflict = hasCriticalError || hasWarning || conflictDetails.length > 0;
  const severity = hasCriticalError ? 'critical' : hasWarning ? 'warning' : 'none';

  const uniqueDetails = Array.from(new Set(conflictDetails));

  return {
    hasConflict,
    hasCriticalError,
    hasWarning,
    isRestPeriodViolation,
    hasRestPeriodViolation: isRestPeriodViolation,
    hasExpiredCredential,
    hasOverlap,
    restGapHours: minGapFound,
    conflictDetails: uniqueDetails,
    reasons: uniqueDetails,
    severity,
  };
}

/**
 * Calculates regular and overtime hours for a staff member over a set of shifts.
 */
export function calculateShiftOvertime(
  shifts: RosterShift[],
  staff: StaffMember,
  rule: OvertimeRule = DEFAULT_OVERTIME_RULE
): {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  holidayHours: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
} {
  const hourlyRate = staff.hourlyRate > 0 ? staff.hourlyRate : 45.0;
  const overtimeRate = hourlyRate * (rule.overtimeMultiplier || 1.5);
  const holidayRate = hourlyRate * (rule.holidayMultiplier || 2.0);

  // Group shifts by day (YYYY-MM-DD)
  const dailyHoursMap = new Map<string, number>();
  let totalHours = 0;
  let holidayHours = 0;

  shifts.forEach((shift) => {
    if (shift.status === 'absent' || shift.status === 'swapped') return;
    const hours = shift.totalHours || calculateShiftDurationHours(
      shift.scheduledStartTime,
      shift.scheduledEndTime,
      shift.breakDuration
    );

    const dayKey = shift.date || shift.scheduledStartTime.split('T')[0];
    dailyHoursMap.set(dayKey, (dailyHoursMap.get(dayKey) || 0) + hours);
    totalHours += hours;
  });

  // Calculate daily overtime
  let dailyOvertimeSum = 0;
  dailyHoursMap.forEach((dayTotal) => {
    if (dayTotal > rule.dailyThresholdHours) {
      dailyOvertimeSum += dayTotal - rule.dailyThresholdHours;
    }
  });

  // Calculate weekly overtime
  const weeklyOvertime = Math.max(0, totalHours - rule.weeklyThresholdHours);

  // Overtime hours is the maximum between weekly overtime and accumulated daily overtime (FLSA standard)
  const overtimeHours = Math.max(weeklyOvertime, dailyOvertimeSum);
  const regularHours = Math.max(0, totalHours - overtimeHours);

  const basePay = Math.round(regularHours * hourlyRate * 100) / 100;
  const overtimePay = Math.round(overtimeHours * overtimeRate * 100) / 100;
  const grossPay = Math.round((basePay + overtimePay) * 100) / 100;

  return {
    totalHours: Math.round(totalHours * 100) / 100,
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    holidayHours,
    basePay,
    overtimePay,
    grossPay,
  };
}

/**
 * Computes statutory payroll deductions (Tax Withholding, Social Security, Medicare, Healthcare).
 */
export function calculateStatutoryDeductions(
  grossPay: number,
  employmentType: StaffMember['employmentType'] = 'full_time'
): StatutoryDeductionBreakdown {
  if (grossPay <= 0) {
    return {
      taxWithholding: 0,
      socialSecurity: 0,
      medicare: 0,
      healthInsurance: 0,
      totalDeductions: 0,
    };
  }

  // If contractor/locum 1099, statutory payroll taxes may not be withheld
  if (employmentType === 'contract') {
    return {
      taxWithholding: 0,
      socialSecurity: 0,
      medicare: 0,
      healthInsurance: 0,
      totalDeductions: 0,
    };
  }

  // Progressive Tax Estimate (~14.5%)
  const taxWithholding = Math.round(grossPay * 0.145 * 100) / 100;

  // FICA Social Security (6.2%)
  const socialSecurity = Math.round(grossPay * 0.062 * 100) / 100;

  // Medicare (1.45%)
  const medicare = Math.round(grossPay * 0.0145 * 100) / 100;

  // Employer Sponsored Healthcare Benefit (Fixed $125/paycheck for full-time, $65 for part-time)
  const healthInsurance = employmentType === 'full_time' ? 125.0 : 65.0;

  const totalDeductions =
    Math.round((taxWithholding + socialSecurity + medicare + healthInsurance) * 100) / 100;

  return {
    taxWithholding,
    socialSecurity,
    medicare,
    healthInsurance,
    totalDeductions,
  };
}

/**
 * Returns Monday 00:00:00 for the week containing the given date.
 */
function getMondayOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
