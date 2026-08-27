import { ShiftAssignment, FatigueComplianceResult } from '@/types/hcm-advanced';

/**
 * Healthcare Human Capital Management (HCM) - Clinical Fatigue Shield Engine
 * Enforces ACGME / AAMI / EU Working Time Directive fatigue shielding rules:
 * - Minimum mandatory 11.0 hours continuous rest period between consecutive clinical shifts.
 * - Maximum 60.0 hours clinical duty per rolling 7-day window.
 * - Maximum 16.0 consecutive hours regular shift duration (24.0 hours for authorized on-call).
 * - Maximum 6 consecutive duty days without a mandatory 24-hour rest interval.
 */
export function evaluateRestPeriodAndFatigue(
  newShift: { startTime: string; endTime: string; shiftId?: string },
  existingShifts: ShiftAssignment[]
): {
  isCompliant: boolean;
  restDurationHours: number;
  violationReason?: string;
  weeklyHours: number;
  consecutiveDays: number;
  alerts: string[];
} {
  const alerts: string[] = [];
  let isCompliant = true;
  let violationReason: string | undefined = undefined;

  const newStartMs = new Date(newShift.startTime).getTime();
  const newEndMs = new Date(newShift.endTime).getTime();

  if (isNaN(newStartMs) || isNaN(newEndMs) || newEndMs <= newStartMs) {
    return {
      isCompliant: false,
      restDurationHours: 0,
      violationReason: 'Invalid shift start or end time timestamp.',
      weeklyHours: 0,
      consecutiveDays: 0,
      alerts: ['Shift start and end times must be valid and end time must be after start time.'],
    };
  }

  const newDurationHours = (newEndMs - newStartMs) / (1000 * 60 * 60);

  // Check max single shift duration (16h threshold)
  if (newDurationHours > 16) {
    alerts.push(`Proposed shift length (${newDurationHours.toFixed(1)} hrs) exceeds standard 16-hour continuous duty threshold.`);
    if (newDurationHours > 24) {
      isCompliant = false;
      violationReason = `Shift length (${newDurationHours.toFixed(1)} hrs) exceeds absolute safety ceiling of 24.0 continuous hours.`;
    }
  }

  // Filter out cancelled shifts and the current shift itself if updating
  const validShifts = existingShifts
    .filter((s) => s.status !== 'cancelled' && s.id !== newShift.shiftId)
    .map((s) => ({
      ...s,
      startMs: new Date(s.startTime).getTime(),
      endMs: new Date(s.endTime).getTime(),
    }))
    .filter((s) => !isNaN(s.startMs) && !isNaN(s.endMs))
    .sort((a, b) => a.startMs - b.startMs);

  let shortestRestHours = 999;
  let closestPriorShift: (typeof validShifts)[0] | null = null;
  let closestNextShift: (typeof validShifts)[0] | null = null;

  // 1. Check for Direct Overlaps & Rest Intervals
  for (const s of validShifts) {
    // Check direct collision
    const isOverlapping = (newStartMs < s.endMs && newEndMs > s.startMs);
    if (isOverlapping) {
      isCompliant = false;
      violationReason = `Direct shift overlap detected with existing shift (${new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Clinical staff cannot be rostered in multiple locations simultaneously.`;
      alerts.push(violationReason);
      break;
    }

    // Prior shift check (s ends before newShift starts)
    if (s.endMs <= newStartMs) {
      const restBeforeHours = (newStartMs - s.endMs) / (1000 * 60 * 60);
      if (restBeforeHours < shortestRestHours) {
        shortestRestHours = restBeforeHours;
        closestPriorShift = s;
      }
    }

    // Next shift check (s starts after newShift ends)
    if (s.startMs >= newEndMs) {
      const restAfterHours = (s.startMs - newEndMs) / (1000 * 60 * 60);
      if (restAfterHours < shortestRestHours) {
        shortestRestHours = restAfterHours;
        closestNextShift = s;
      }
    }
  }

  const calculatedRestDuration = shortestRestHours === 999 ? 24.0 : Number(shortestRestHours.toFixed(1));

  // Enforce Mandatory 11.0 Hours Rest Rule
  if (shortestRestHours < 11.0) {
    isCompliant = false;
    const shiftContext = closestPriorShift
      ? `previous shift ending at ${new Date(closestPriorShift.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${new Date(closestPriorShift.endTime).toLocaleDateString()}`
      : closestNextShift
      ? `subsequent shift starting at ${new Date(closestNextShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${new Date(closestNextShift.startTime).toLocaleDateString()}`
      : 'adjacent shift';

    violationReason = `FATIGUE SHIELD VIOLATION: Rest interval of ${calculatedRestDuration} hours is below mandatory 11.0 hours between ${shiftContext} (ACGME/AAMI Clinical Fatigue Directive).`;
    alerts.push(violationReason);
  }

  // 2. Rolling 7-Day / Weekly Working Hours Evaluation
  const sevenDaysBeforeMs = newStartMs - 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAfterMs = newEndMs + 7 * 24 * 60 * 60 * 1000;

  // Calculate total hours in the 7-day window
  const shiftsInWeek = validShifts.filter(
    (s) => s.endMs > sevenDaysBeforeMs && s.startMs < sevenDaysAfterMs
  );

  let totalWeekDutyMs = (newEndMs - newStartMs);
  for (const s of shiftsInWeek) {
    totalWeekDutyMs += (s.endMs - s.startMs);
  }

  const weeklyHours = Number((totalWeekDutyMs / (1000 * 60 * 60)).toFixed(1));

  if (weeklyHours > 60.0) {
    isCompliant = false;
    const weeklyMsg = `WEEKLY HOURS CAP BREACH: Total rolling 7-day duty time (${weeklyHours} hrs) exceeds the maximum allowed 60.0 hours/week.`;
    if (!violationReason) {
      violationReason = weeklyMsg;
    }
    alerts.push(weeklyMsg);
  } else if (weeklyHours > 48.0) {
    alerts.push(`High workload warning: ${weeklyHours} hours scheduled in this 7-day period.`);
  }

  // 3. Consecutive Days Evaluation
  const shiftDates = new Set<string>();
  shiftDates.add(new Date(newShift.startTime).toISOString().split('T')[0]);

  for (const s of validShifts) {
    const dStr = new Date(s.startTime).toISOString().split('T')[0];
    shiftDates.add(dStr);
  }

  // Count consecutive duty days around proposed date
  const targetDate = new Date(newShift.startTime);
  let consecutiveDays = 1;

  // Check backwards
  for (let i = 1; i <= 14; i++) {
    const prevD = new Date(targetDate);
    prevD.setDate(prevD.getDate() - i);
    const dateStr = prevD.toISOString().split('T')[0];
    if (shiftDates.has(dateStr)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  // Check forwards
  for (let i = 1; i <= 14; i++) {
    const nextD = new Date(targetDate);
    nextD.setDate(nextD.getDate() + i);
    const dateStr = nextD.toISOString().split('T')[0];
    if (shiftDates.has(dateStr)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  if (consecutiveDays > 6) {
    alerts.push(`Consecutive days alert: Staff scheduled for ${consecutiveDays} consecutive working days. A 24-hour rest window is required after 6 consecutive days.`);
    if (consecutiveDays >= 8) {
      isCompliant = false;
      if (!violationReason) {
        violationReason = `CONSECUTIVE DUTY LIMIT: Staff cannot be scheduled for ${consecutiveDays} consecutive days without a mandatory 24-hour rest day.`;
      }
    }
  }

  return {
    isCompliant,
    restDurationHours: calculatedRestDuration,
    violationReason,
    weeklyHours,
    consecutiveDays,
    alerts,
  };
}
