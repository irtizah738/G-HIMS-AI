import {
  RosterShift,
  StaffMember,
  ClinicalCredential,
  OvertimeRule,
  ShiftValidationResult,
  StatutoryDeductionBreakdown,
} from '@/types/hcm';

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
  }
): ShiftValidationResult {
  const minRestHours = options?.minRestHours ?? 11;
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

  // 3. Check Overlapping Shifts & Rest Period for this staff member
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
    if (sEnd <= candidateStart) {
      const restHours = (candidateStart - sEnd) / (1000 * 60 * 60);
      if (restHours < minRestHours) {
        warnings.push(
          `Rest period violation: Only ${restHours.toFixed(1)}h rest after shift ${shift.shiftNumber} (minimum recommended: ${minRestHours}h).`
        );
      }
    }

    // Check Minimum Rest Period (Candidate shift -> Next shift)
    if (candidateEnd <= sStart) {
      const restHours = (sStart - candidateEnd) / (1000 * 60 * 60);
      if (restHours < minRestHours) {
        warnings.push(
          `Rest period violation: Only ${restHours.toFixed(1)}h rest before upcoming shift ${shift.shiftNumber} (minimum recommended: ${minRestHours}h).`
        );
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
