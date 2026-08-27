import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  runTransaction,
  writeBatch,
  where,
  orderBy,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from '../config';
import { handleFirestoreError, OperationType } from '../errors';
import {
  StaffMember,
  ClinicalCredential,
  RosterShift,
  ShiftSwapRequest,
  OvertimeRule,
  PayrollPeriod,
  Payslip,
  ShiftValidationResult,
} from '@/types/hcm';
import {
  DEFAULT_OVERTIME_RULE,
  calculateShiftDurationHours,
  validateShiftAssignment,
  calculateShiftOvertime,
  calculateStatutoryDeductions,
} from '@/lib/hcm/roster-engine';
import { postJournalEntry } from './erp-finance';
import { JournalLine } from '@/types/erp-finance';

// ============================================================================
// 1. STAFF MANAGEMENT SERVICE
// ============================================================================

export async function getStaffMembers(tenantId: string): Promise<StaffMember[]> {
  const path = `tenants/${tenantId}/staff`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'staff'), orderBy('lastName', 'asc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialStaff(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as StaffMember);
    }
    return snapshot.docs.map((d) => d.data() as StaffMember);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToStaffMembers(
  tenantId: string,
  onUpdate: (staff: StaffMember[]) => void,
  onError?: (err: Error) => void
) {
  const path = `tenants/${tenantId}/staff`;
  const q = query(collection(db, 'tenants', tenantId, 'staff'), orderBy('lastName', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        seedInitialStaff(tenantId).catch(console.error);
      }
      const staff = snapshot.docs.map((d) => d.data() as StaffMember);
      onUpdate(staff);
    },
    (error) => {
      console.error('Staff subscription error:', error);
      if (onError) onError(error);
    }
  );
}

export async function addStaffMember(
  tenantId: string,
  staffData: Omit<StaffMember, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
): Promise<StaffMember> {
  const path = `tenants/${tenantId}/staff`;
  try {
    const staffRef = doc(collection(db, 'tenants', tenantId, 'staff'));
    const now = new Date().toISOString();
    const newStaff: StaffMember = {
      ...staffData,
      id: staffRef.id,
      tenantId,
      fullName: `${staffData.firstName} ${staffData.lastName}`,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(staffRef, newStaff);
    return newStaff;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStaffMember(
  tenantId: string,
  staffId: string,
  updates: Partial<StaffMember>
): Promise<void> {
  const path = `tenants/${tenantId}/staff/${staffId}`;
  try {
    const staffRef = doc(db, 'tenants', tenantId, 'staff', staffId);
    const now = new Date().toISOString();
    const cleanUpdates = {
      ...updates,
      updatedAt: now,
    };
    if (updates.firstName || updates.lastName) {
      const snap = await getDoc(staffRef);
      if (snap.exists()) {
        const current = snap.data() as StaffMember;
        const fName = updates.firstName ?? current.firstName;
        const lName = updates.lastName ?? current.lastName;
        cleanUpdates.fullName = `${fName} ${lName}`;
      }
    }
    await updateDoc(staffRef, cleanUpdates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 2. CLINICAL CREDENTIALS SERVICE
// ============================================================================

export async function getStaffCredentials(
  tenantId: string,
  staffId?: string
): Promise<ClinicalCredential[]> {
  const path = `tenants/${tenantId}/credentials`;
  try {
    let q = query(
      collection(db, 'tenants', tenantId, 'credentials'),
      orderBy('expirationDate', 'asc')
    );
    if (staffId) {
      q = query(
        collection(db, 'tenants', tenantId, 'credentials'),
        where('staffId', '==', staffId),
        orderBy('expirationDate', 'asc')
      );
    }
    const snapshot = await getDocs(q);
    if (snapshot.empty && !staffId) {
      await seedInitialCredentials(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as ClinicalCredential);
    }
    return snapshot.docs.map((d) => d.data() as ClinicalCredential);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToStaffCredentials(
  tenantId: string,
  onUpdate: (credentials: ClinicalCredential[]) => void,
  staffId?: string
) {
  let q = query(
    collection(db, 'tenants', tenantId, 'credentials'),
    orderBy('expirationDate', 'asc')
  );
  if (staffId) {
    q = query(
      collection(db, 'tenants', tenantId, 'credentials'),
      where('staffId', '==', staffId),
      orderBy('expirationDate', 'asc')
    );
  }

  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty && !staffId) {
      seedInitialCredentials(tenantId).catch(console.error);
    }
    const creds = snapshot.docs.map((d) => d.data() as ClinicalCredential);
    onUpdate(creds);
  });
}

export async function addStaffCredential(
  tenantId: string,
  credentialData: Omit<ClinicalCredential, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
): Promise<ClinicalCredential> {
  const path = `tenants/${tenantId}/credentials`;
  try {
    const credRef = doc(collection(db, 'tenants', tenantId, 'credentials'));
    const now = new Date().toISOString();
    const newCred: ClinicalCredential = {
      ...credentialData,
      id: credRef.id,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(credRef, cleanFirestoreData(newCred));
    return newCred;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStaffCredentials(
  tenantId: string,
  credentialId: string,
  updates: Partial<ClinicalCredential>
): Promise<void> {
  const path = `tenants/${tenantId}/credentials/${credentialId}`;
  try {
    const credRef = doc(db, 'tenants', tenantId, 'credentials', credentialId);
    await updateDoc(credRef, cleanFirestoreData({
      ...updates,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function verifyCredential(
  tenantId: string,
  credentialId: string,
  verifiedBy: string
): Promise<void> {
  const path = `tenants/${tenantId}/credentials/${credentialId}`;
  try {
    const credRef = doc(db, 'tenants', tenantId, 'credentials', credentialId);
    await updateDoc(credRef, {
      verificationStatus: 'verified',
      verifiedBy,
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 3. CLINICAL ROSTERING & SHIFT SERVICE
// ============================================================================

export async function getRosterShifts(
  tenantId: string,
  startDate?: string,
  endDate?: string
): Promise<RosterShift[]> {
  const path = `tenants/${tenantId}/shifts`;
  try {
    let q = query(collection(db, 'tenants', tenantId, 'shifts'), orderBy('scheduledStartTime', 'asc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialRosterAndShifts(tenantId);
      const seeded = await getDocs(q);
      return filterShiftsByDate(seeded.docs.map((d) => d.data() as RosterShift), startDate, endDate);
    }
    const shifts = snapshot.docs.map((d) => d.data() as RosterShift);
    return filterShiftsByDate(shifts, startDate, endDate);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

function filterShiftsByDate(shifts: RosterShift[], startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return shifts;
  return shifts.filter((s) => {
    const shiftDate = s.date || s.scheduledStartTime.split('T')[0];
    if (startDate && shiftDate < startDate) return false;
    if (endDate && shiftDate > endDate) return false;
    return true;
  });
}

export function subscribeToRosterShifts(
  tenantId: string,
  onUpdate: (shifts: RosterShift[]) => void
) {
  const q = query(
    collection(db, 'tenants', tenantId, 'shifts'),
    orderBy('scheduledStartTime', 'asc')
  );
  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      seedInitialRosterAndShifts(tenantId).catch(console.error);
    }
    const shifts = snapshot.docs.map((d) => d.data() as RosterShift);
    onUpdate(shifts);
  });
}

export async function createRosterShift(
  tenantId: string,
  shiftData: Omit<RosterShift, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'totalHours' | 'conflictFlags'>
): Promise<{ shift: RosterShift; validation: ShiftValidationResult }> {
  const path = `tenants/${tenantId}/shifts`;
  try {
    // 1. Fetch staff, credentials, and existing shifts for validation
    const [existingShifts, credentials, staffMembers] = await Promise.all([
      getRosterShifts(tenantId),
      getStaffCredentials(tenantId, shiftData.staffId),
      getStaffMembers(tenantId),
    ]);

    const staffMember = staffMembers.find((s) => s.id === shiftData.staffId);
    const totalHours = calculateShiftDurationHours(
      shiftData.scheduledStartTime,
      shiftData.scheduledEndTime,
      shiftData.breakDuration
    );

    // 2. Validate Assignment Rules
    const validation = validateShiftAssignment(
      {
        staffId: shiftData.staffId,
        scheduledStartTime: shiftData.scheduledStartTime,
        scheduledEndTime: shiftData.scheduledEndTime,
        date: shiftData.date,
      },
      existingShifts,
      credentials,
      staffMember
    );

    if (!validation.valid && validation.blockReasons.length > 0) {
      throw new Error(`Shift creation blocked: ${validation.blockReasons.join('; ')}`);
    }

    const shiftRef = doc(collection(db, 'tenants', tenantId, 'shifts'));
    const now = new Date().toISOString();
    const newShift: RosterShift = {
      ...shiftData,
      id: shiftRef.id,
      tenantId,
      totalHours,
      conflictFlags: validation.warnings,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(shiftRef, newShift);
    return { shift: newShift, validation };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRosterShift(
  tenantId: string,
  shiftId: string,
  updates: Partial<RosterShift>
): Promise<void> {
  const path = `tenants/${tenantId}/shifts/${shiftId}`;
  try {
    const shiftRef = doc(db, 'tenants', tenantId, 'shifts', shiftId);
    const snap = await getDoc(shiftRef);
    if (!snap.exists()) throw new Error('Shift not found');
    const existing = snap.data() as RosterShift;

    const mergedStart = updates.scheduledStartTime || existing.scheduledStartTime;
    const mergedEnd = updates.scheduledEndTime || existing.scheduledEndTime;
    const mergedBreak = updates.breakDuration !== undefined ? updates.breakDuration : existing.breakDuration;
    const totalHours = calculateShiftDurationHours(mergedStart, mergedEnd, mergedBreak);

    await updateDoc(shiftRef, {
      ...updates,
      totalHours,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteRosterShift(tenantId: string, shiftId: string): Promise<void> {
  const path = `tenants/${tenantId}/shifts/${shiftId}`;
  try {
    await deleteDoc(doc(db, 'tenants', tenantId, 'shifts', shiftId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function swapShifts(
  tenantId: string,
  params: {
    requestingShiftId: string;
    targetShiftId: string;
    requestingStaffId: string;
    targetStaffId: string;
    reason?: string;
    reviewer?: string;
  }
): Promise<void> {
  const path = `tenants/${tenantId}/shifts`;
  try {
    await runTransaction(db, async (transaction) => {
      const reqShiftRef = doc(db, 'tenants', tenantId, 'shifts', params.requestingShiftId);
      const tarShiftRef = doc(db, 'tenants', tenantId, 'shifts', params.targetShiftId);
      const reqStaffRef = doc(db, 'tenants', tenantId, 'staff', params.requestingStaffId);
      const tarStaffRef = doc(db, 'tenants', tenantId, 'staff', params.targetStaffId);

      const [reqShiftSnap, tarShiftSnap, reqStaffSnap, tarStaffSnap] = await Promise.all([
        transaction.get(reqShiftRef),
        transaction.get(tarShiftRef),
        transaction.get(reqStaffRef),
        transaction.get(tarStaffRef),
      ]);

      if (!reqShiftSnap.exists() || !tarShiftSnap.exists()) {
        throw new Error('One or both shifts do not exist for swap.');
      }
      if (!reqStaffSnap.exists() || !tarStaffSnap.exists()) {
        throw new Error('One or both staff profiles not found.');
      }

      const reqShift = reqShiftSnap.data() as RosterShift;
      const tarShift = tarShiftSnap.data() as RosterShift;
      const reqStaff = reqStaffSnap.data() as StaffMember;
      const tarStaff = tarStaffSnap.data() as StaffMember;

      // Swap Staff IDs and Names
      const now = new Date().toISOString();

      transaction.update(reqShiftRef, {
        staffId: tarStaff.id,
        staffName: tarStaff.fullName,
        staffRole: tarStaff.primaryRole,
        notes: `Swapped with ${reqStaff.fullName}. Reason: ${params.reason || 'Mutual peer swap'}`,
        updatedAt: now,
      });

      transaction.update(tarShiftRef, {
        staffId: reqStaff.id,
        staffName: reqStaff.fullName,
        staffRole: reqStaff.primaryRole,
        notes: `Swapped with ${tarStaff.fullName}. Reason: ${params.reason || 'Mutual peer swap'}`,
        updatedAt: now,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function requestShiftSwap(
  tenantId: string,
  reqData: Omit<ShiftSwapRequest, 'id' | 'tenantId' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<ShiftSwapRequest> {
  const path = `tenants/${tenantId}/shiftSwaps`;
  try {
    const swapRef = doc(collection(db, 'tenants', tenantId, 'shiftSwaps'));
    const now = new Date().toISOString();
    const newSwap: ShiftSwapRequest = {
      ...reqData,
      id: swapRef.id,
      tenantId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(swapRef, newSwap);
    return newSwap;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getShiftSwapRequests(tenantId: string): Promise<ShiftSwapRequest[]> {
  const path = `tenants/${tenantId}/shiftSwaps`;
  try {
    const q = query(
      collection(db, 'tenants', tenantId, 'shiftSwaps'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as ShiftSwapRequest);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 4. OVERTIME RULES & HCM SETTINGS
// ============================================================================

export async function getOvertimeRules(tenantId: string): Promise<OvertimeRule[]> {
  const path = `tenants/${tenantId}/overtimeRules`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'overtimeRules'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await saveOvertimeRule(tenantId, DEFAULT_OVERTIME_RULE);
      return [DEFAULT_OVERTIME_RULE];
    }
    return snapshot.docs.map((d) => d.data() as OvertimeRule);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getDefaultOvertimeRule(tenantId: string): Promise<OvertimeRule> {
  const rules = await getOvertimeRules(tenantId);
  return rules.find((r) => r.isDefault) || rules[0] || DEFAULT_OVERTIME_RULE;
}

export async function saveOvertimeRule(
  tenantId: string,
  ruleData: Partial<OvertimeRule>
): Promise<OvertimeRule> {
  const path = `tenants/${tenantId}/overtimeRules`;
  try {
    const ruleId = ruleData.id || 'rule-standard-hospital';
    const ruleRef = doc(db, 'tenants', tenantId, 'overtimeRules', ruleId);
    const now = new Date().toISOString();
    const rule: OvertimeRule = {
      ...DEFAULT_OVERTIME_RULE,
      ...ruleData,
      id: ruleId,
      tenantId,
      updatedAt: now,
    };
    await setDoc(ruleRef, rule, { merge: true });
    return rule;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// ============================================================================
// 5. HEALTHCARE PAYROLL & PAYSLIP PROCESSING SERVICE
// ============================================================================

export async function getPayrollPeriods(tenantId: string): Promise<PayrollPeriod[]> {
  const path = `tenants/${tenantId}/payrollPeriods`;
  try {
    const q = query(
      collection(db, 'tenants', tenantId, 'payrollPeriods'),
      orderBy('startDate', 'desc')
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialPayrollPeriod(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as PayrollPeriod);
    }
    return snapshot.docs.map((d) => d.data() as PayrollPeriod);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToPayrollPeriods(
  tenantId: string,
  onUpdate: (periods: PayrollPeriod[]) => void
) {
  const q = query(
    collection(db, 'tenants', tenantId, 'payrollPeriods'),
    orderBy('startDate', 'desc')
  );
  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      seedInitialPayrollPeriod(tenantId).catch(console.error);
    }
    const periods = snapshot.docs.map((d) => d.data() as PayrollPeriod);
    onUpdate(periods);
  });
}

export async function createPayrollPeriod(
  tenantId: string,
  periodData: Omit<PayrollPeriod, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'totalGross' | 'totalOvertime' | 'totalDeductions' | 'totalNetPay' | 'staffCount' | 'payslipCount'>
): Promise<PayrollPeriod> {
  const path = `tenants/${tenantId}/payrollPeriods`;
  try {
    const periodRef = doc(collection(db, 'tenants', tenantId, 'payrollPeriods'));
    const now = new Date().toISOString();
    const newPeriod: PayrollPeriod = {
      ...periodData,
      id: periodRef.id,
      tenantId,
      status: periodData.status || 'open',
      totalGross: 0,
      totalOvertime: 0,
      totalDeductions: 0,
      totalNetPay: 0,
      staffCount: 0,
      payslipCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(periodRef, newPeriod);
    return newPeriod;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getPayslips(tenantId: string, periodId?: string): Promise<Payslip[]> {
  const path = `tenants/${tenantId}/payslips`;
  try {
    let q = query(collection(db, 'tenants', tenantId, 'payslips'), orderBy('payslipNumber', 'asc'));
    if (periodId) {
      q = query(
        collection(db, 'tenants', tenantId, 'payslips'),
        where('periodId', '==', periodId),
        orderBy('payslipNumber', 'asc')
      );
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as Payslip);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToPayslips(
  tenantId: string,
  param2?: string | ((payslips: Payslip[]) => void),
  param3?: (payslips: Payslip[]) => void
) {
  let periodId: string | undefined;
  let onUpdate: (payslips: Payslip[]) => void;

  if (typeof param2 === 'function') {
    onUpdate = param2;
    periodId = undefined;
  } else {
    periodId = param2;
    onUpdate = param3 || (() => {});
  }

  let q = query(collection(db, 'tenants', tenantId, 'payslips'), orderBy('payslipNumber', 'asc'));
  if (periodId && periodId !== 'all') {
    q = query(
      collection(db, 'tenants', tenantId, 'payslips'),
      where('periodId', '==', periodId),
      orderBy('payslipNumber', 'asc')
    );
  }
  return onSnapshot(q, (snapshot) => {
    const payslips = snapshot.docs.map((d) => d.data() as Payslip);
    onUpdate(payslips);
  });
}

/**
 * Aggregates verified shift hours, calculates regular/overtime wages,
 * builds Payslip records under `/tenants/{tenantId}/payslips`, updates
 * PayrollPeriod, and automatically posts a summary labor expense Journal Entry to GL.
 */
export async function generatePayrollRun(
  tenantId: string,
  periodOrParams: string | { periodName: string; startDate: string; endDate: string; paymentDate: string },
  processedBy: string = 'Director of Payroll & Compensation'
): Promise<string> {
  let periodId: string;
  let period: PayrollPeriod;

  if (typeof periodOrParams === 'string') {
    periodId = periodOrParams;
    const periodRef = doc(db, 'tenants', tenantId, 'payrollPeriods', periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) {
      throw new Error(`Payroll period "${periodId}" not found.`);
    }
    period = periodSnap.data() as PayrollPeriod;
  } else {
    const periodRef = doc(collection(db, 'tenants', tenantId, 'payrollPeriods'));
    periodId = periodRef.id;
    const count = Math.floor(100 + Math.random() * 900);
    const now = new Date().toISOString();
    period = {
      id: periodId,
      tenantId,
      periodNumber: `PR-${periodOrParams.startDate.substring(0, 7)}-${count}`,
      periodName: periodOrParams.periodName,
      startDate: periodOrParams.startDate,
      endDate: periodOrParams.endDate,
      paymentDate: periodOrParams.paymentDate,
      status: 'open',
      totalGross: 0,
      totalGrossPay: 0,
      totalOvertime: 0,
      totalDeductions: 0,
      totalNetPay: 0,
      staffCount: 0,
      payslipCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(periodRef, period);
  }

  const path = `tenants/${tenantId}/payrollPeriods/${periodId}`;
  try {
    // 2. Fetch Staff, Shifts in Period, and Overtime Rules
    const [staffList, allShifts, otRule] = await Promise.all([
      getStaffMembers(tenantId),
      getRosterShifts(tenantId, period.startDate, period.endDate),
      getDefaultOvertimeRule(tenantId),
    ]);

    // 3. Compute Payslip for each active staff member
    let periodTotalGross = 0;
    let periodTotalOvertime = 0;
    let periodTotalDeductions = 0;
    let periodTotalNetPay = 0;

    // Accumulators for General Ledger labor classification
    let glDoctorWages = 0;
    let glNurseWages = 0;
    let glPharmacyLabWages = 0;
    let glAdminWages = 0;

    const payslipsToCreate: Payslip[] = [];
    const now = new Date().toISOString();

    let seq = 1;
    for (const staff of staffList) {
      if (staff.activeStatus === 'terminated') continue;

      const staffShifts = allShifts.filter((s) => s.staffId === staff.id);
      const payCalc = calculateShiftOvertime(staffShifts, staff, otRule);

      let basePay = payCalc.basePay;
      let regularHours = payCalc.regularHours;
      if (staff.employmentType === 'full_time' && basePay === 0 && staff.baseSalary > 0) {
        basePay = Math.round((staff.baseSalary / 12) * 100) / 100;
        regularHours = 160;
      }

      const grossPay = Math.round((basePay + payCalc.overtimePay) * 100) / 100;
      if (grossPay <= 0) continue;

      const deductions = calculateStatutoryDeductions(grossPay, staff.employmentType);
      const netPay = Math.round((grossPay - deductions.totalDeductions) * 100) / 100;

      const payslipRef = doc(collection(db, 'tenants', tenantId, 'payslips'));
      const payslipNumber = `PS-${period.periodNumber || 'PR'}-${String(seq).padStart(3, '0')}`;

      const payslip: Payslip = {
        id: payslipRef.id,
        tenantId,
        payslipNumber,
        periodId: period.id,
        payrollPeriodId: period.id,
        periodName: period.periodName,
        staffId: staff.id,
        staffName: staff.fullName,
        staffRole: staff.primaryRole,
        department: staff.departmentName,
        departmentName: staff.departmentName,
        employmentType: staff.employmentType,
        regularHours,
        overtimeHours: payCalc.overtimeHours,
        hourlyRate: staff.hourlyRate,
        basePay,
        regularPay: basePay,
        overtimePay: payCalc.overtimePay,
        grossPay,
        taxDeduction: deductions.taxWithholding,
        statutoryDeductions: deductions,
        totalDeductions: deductions.totalDeductions,
        netPayAmount: netPay,
        netPay,
        paymentStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      payslipsToCreate.push(payslip);

      periodTotalGross += grossPay;
      periodTotalOvertime += payCalc.overtimePay;
      periodTotalDeductions += deductions.totalDeductions;
      periodTotalNetPay += netPay;

      if (staff.primaryRole === 'doctor') {
        glDoctorWages += grossPay;
      } else if (staff.primaryRole === 'nurse') {
        glNurseWages += grossPay;
      } else if (staff.primaryRole === 'pharmacy' || staff.primaryRole === 'lab') {
        glPharmacyLabWages += grossPay;
      } else {
        glAdminWages += grossPay;
      }

      seq++;
    }

    // 4. Batch Write Payslips
    const batch = writeBatch(db);
    payslipsToCreate.forEach((p) => {
      const pRef = doc(db, 'tenants', tenantId, 'payslips', p.id);
      batch.set(pRef, p);
    });

    // 5. Post General Ledger Journal Entry for Labor Expense
    let createdJeId: string | undefined;
    try {
      const glPostingLines: JournalLine[] = [];

      if (glDoctorWages > 0) {
        glPostingLines.push({
          id: `line-doc-${period.id}`,
          accountCode: '6010',
          accountName: 'Physician & Clinical Staff Salaries',
          description: `Gross payroll physician compensation - ${period.periodName}`,
          debit: Math.round(glDoctorWages * 100) / 100,
          credit: 0,
        });
      }

      if (glNurseWages > 0) {
        glPostingLines.push({
          id: `line-nurse-${period.id}`,
          accountCode: '6020',
          accountName: 'Nursing & Care Staff Salaries',
          description: `Gross payroll nursing compensation - ${period.periodName}`,
          debit: Math.round(glNurseWages * 100) / 100,
          credit: 0,
        });
      }

      const nonDoctorNurse = glPharmacyLabWages + glAdminWages;
      if (nonDoctorNurse > 0) {
        glPostingLines.push({
          id: `line-allied-${period.id}`,
          accountCode: '6020',
          accountName: 'Allied Health & Admin Salaries',
          description: `Gross payroll allied & admin compensation - ${period.periodName}`,
          debit: Math.round(nonDoctorNurse * 100) / 100,
          credit: 0,
        });
      }

      // Credit Accrued Payroll & Statutory Withholdings (Liabilities)
      const totalDebitSum = glPostingLines.reduce((sum, l) => sum + l.debit, 0);
      glPostingLines.push({
        id: `line-accrued-${period.id}`,
        accountCode: '2030',
        accountName: 'Accrued Payroll & Statutory Withholdings',
        description: `Accrued net wages & tax withholdings payable - ${period.periodName}`,
        debit: 0,
        credit: Math.round(totalDebitSum * 100) / 100,
      });

      const journalEntry = await postJournalEntry(tenantId, {
        postingDate: period.endDate || new Date().toISOString().split('T')[0],
        referenceNumber: `PR-${period.periodNumber}`,
        description: `Automated labor cost & payroll accrual posting for ${period.periodName}`,
        sourceModule: 'payroll',
        lines: glPostingLines,
        postedBy: processedBy,
      });

      createdJeId = journalEntry.id;
    } catch (glError) {
      console.warn('GL Journal entry posting warning (payroll will proceed):', glError);
    }

    // 6. Update Payroll Period
    const periodRef = doc(db, 'tenants', tenantId, 'payrollPeriods', periodId);
    const updatedPeriod: PayrollPeriod = {
      ...period,
      status: 'approved',
      totalGross: Math.round(periodTotalGross * 100) / 100,
      totalGrossPay: Math.round(periodTotalGross * 100) / 100,
      totalOvertime: Math.round(periodTotalOvertime * 100) / 100,
      totalDeductions: Math.round(periodTotalDeductions * 100) / 100,
      totalNetPay: Math.round(periodTotalNetPay * 100) / 100,
      staffCount: payslipsToCreate.length,
      payslipCount: payslipsToCreate.length,
      journalEntryId: createdJeId,
      processedBy,
      processedAt: now,
      updatedAt: now,
    };

    batch.update(periodRef, {
      status: 'approved',
      totalGross: updatedPeriod.totalGross,
      totalGrossPay: updatedPeriod.totalGross,
      totalOvertime: updatedPeriod.totalOvertime,
      totalDeductions: updatedPeriod.totalDeductions,
      totalNetPay: updatedPeriod.totalNetPay,
      staffCount: updatedPeriod.staffCount,
      payslipCount: updatedPeriod.payslipCount,
      journalEntryId: createdJeId || null,
      processedBy,
      processedAt: now,
      updatedAt: now,
    });

    await batch.commit();

    return periodId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }
}

export async function disbursePayslips(
  tenantId: string,
  periodId: string,
  disbursedBy: string = 'Treasury & Disbursement Officer'
): Promise<void> {
  const path = `tenants/${tenantId}/payrollPeriods/${periodId}`;
  try {
    const payslips = await getPayslips(tenantId, periodId);
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    payslips.forEach((p) => {
      const pRef = doc(db, 'tenants', tenantId, 'payslips', p.id);
      batch.update(pRef, {
        paymentStatus: 'disbursed',
        disbursedAt: now,
        disbursedBy,
        paymentMethod: 'direct_deposit',
        updatedAt: now,
      });
    });

    const periodRef = doc(db, 'tenants', tenantId, 'payrollPeriods', periodId);
    batch.update(periodRef, {
      status: 'paid',
      updatedAt: now,
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 6. INITIAL SEEDING HELPERS
// ============================================================================

export async function seedInitialStaff(tenantId: string): Promise<void> {
  const defaultStaff: Omit<StaffMember, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>[] = [
    {
      staffNumber: 'EMP-1001',
      firstName: 'Sarah',
      lastName: 'Chen',
      fullName: 'Dr. Sarah Chen, MD',
      email: 's.chen@metrohealth.org',
      phone: '+1 (555) 234-5678',
      departmentId: 'dept-emergency',
      departmentName: 'Emergency & Trauma (ED)',
      primaryRole: 'doctor',
      employmentType: 'full_time',
      hourlyRate: 145.0,
      baseSalary: 285000,
      activeStatus: 'active',
      specialty: 'Emergency Medicine & Critical Care',
      assignedWards: ['Emergency Bay A', 'Trauma Resus 1'],
    },
    {
      staffNumber: 'EMP-1002',
      firstName: 'Marcus',
      lastName: 'Vance',
      fullName: 'Dr. Marcus Vance, MD, FACS',
      email: 'm.vance@metrohealth.org',
      phone: '+1 (555) 345-6789',
      departmentId: 'dept-surgery',
      departmentName: 'General & Trauma Surgery',
      primaryRole: 'doctor',
      employmentType: 'full_time',
      hourlyRate: 175.0,
      baseSalary: 340000,
      activeStatus: 'active',
      specialty: 'Trauma & Laparoscopic Surgery',
      assignedWards: ['OR Suite 1', 'OR Suite 2'],
    },
    {
      staffNumber: 'EMP-2001',
      firstName: 'Elena',
      lastName: 'Rostova',
      fullName: 'Elena Rostova, BSN, RN, CCRN',
      email: 'e.rostova@metrohealth.org',
      phone: '+1 (555) 456-7890',
      departmentId: 'dept-icu',
      departmentName: 'Intensive Care Unit (ICU)',
      primaryRole: 'nurse',
      employmentType: 'full_time',
      hourlyRate: 52.0,
      baseSalary: 104000,
      activeStatus: 'active',
      specialty: 'Charge Nurse & Critical Care',
      assignedWards: ['ICU Pod A', 'ICU Pod B'],
    },
    {
      staffNumber: 'EMP-2002',
      firstName: 'David',
      lastName: 'Kim',
      fullName: 'David Kim, BSN, RN',
      email: 'd.kim@metrohealth.org',
      phone: '+1 (555) 567-8901',
      departmentId: 'dept-medsurg',
      departmentName: 'General Medical Ward',
      primaryRole: 'nurse',
      employmentType: 'full_time',
      hourlyRate: 46.5,
      baseSalary: 93000,
      activeStatus: 'active',
      specialty: 'Medical-Surgical Nursing',
      assignedWards: ['Ward 3 East', 'Ward 3 West'],
    },
    {
      staffNumber: 'EMP-2003',
      firstName: 'Aaliyah',
      lastName: 'Johnson',
      fullName: 'Aaliyah Johnson, RN',
      email: 'a.johnson@metrohealth.org',
      phone: '+1 (555) 678-9012',
      departmentId: 'dept-emergency',
      departmentName: 'Emergency & Trauma (ED)',
      primaryRole: 'nurse',
      employmentType: 'full_time',
      hourlyRate: 48.0,
      baseSalary: 96000,
      activeStatus: 'active',
      specialty: 'Triage & Rapid Response',
      assignedWards: ['Emergency Bay B', 'Triage Station 1'],
    },
    {
      staffNumber: 'EMP-3001',
      firstName: 'Robert',
      lastName: 'Patel',
      fullName: 'Robert Patel, PharmD, BCPS',
      email: 'r.patel@metrohealth.org',
      phone: '+1 (555) 789-0123',
      departmentId: 'dept-pharmacy',
      departmentName: 'Central Inpatient Pharmacy',
      primaryRole: 'pharmacy',
      employmentType: 'full_time',
      hourlyRate: 68.0,
      baseSalary: 136000,
      activeStatus: 'active',
      specialty: 'Clinical Pharmacokinetics',
      assignedWards: ['Inpatient Pharmacy Suite'],
    },
    {
      staffNumber: 'EMP-4001',
      firstName: 'Maria',
      lastName: 'Santos',
      fullName: 'Maria Santos, MLS (ASCP)',
      email: 'm.santos@metrohealth.org',
      phone: '+1 (555) 890-1234',
      departmentId: 'dept-lab',
      departmentName: 'Clinical Pathology & Diagnostics',
      primaryRole: 'lab',
      employmentType: 'full_time',
      hourlyRate: 42.0,
      baseSalary: 84000,
      activeStatus: 'active',
      specialty: 'Hematology & Blood Bank Transfusion',
      assignedWards: ['Main Diagnostic Lab'],
    },
    {
      staffNumber: 'EMP-5001',
      firstName: 'Thomas',
      lastName: 'Wright',
      fullName: 'Thomas Wright, MHA',
      email: 't.wright@metrohealth.org',
      phone: '+1 (555) 901-2345',
      departmentId: 'dept-admin',
      departmentName: 'Hospital Administration & Operations',
      primaryRole: 'admin',
      employmentType: 'full_time',
      hourlyRate: 58.0,
      baseSalary: 116000,
      activeStatus: 'active',
      specialty: 'Clinical Operations Director',
      assignedWards: ['Executive Suite'],
    },
  ];

  const now = new Date().toISOString();
  for (const staff of defaultStaff) {
    const staffRef = doc(collection(db, 'tenants', tenantId, 'staff'));
    await setDoc(staffRef, {
      ...staff,
      id: staffRef.id,
      tenantId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function seedInitialCredentials(tenantId: string): Promise<void> {
  const staff = await getStaffMembers(tenantId);
  const now = new Date();
  const currentIso = now.toISOString();

  // Generate credentials with varied expiration dates to demonstrate active, expiring, and expired states
  const credsToSeed: Omit<ClinicalCredential, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>[] = [];

  staff.forEach((s) => {
    if (s.primaryRole === 'doctor') {
      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'State Medical License (MD)',
        licenseNumber: `MED-${Math.floor(100000 + Math.random() * 900000)}`,
        issuingBody: 'State Medical Board',
        issueDate: '2023-01-15',
        expirationDate: '2027-01-15',
        verificationStatus: 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Chief Medical Officer',
        verifiedAt: currentIso,
      });

      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'DEA Federal Controlled Substance Registration',
        licenseNumber: `DEA-AB${Math.floor(1000000 + Math.random() * 9000000)}`,
        issuingBody: 'Drug Enforcement Administration (DEA)',
        issueDate: '2024-03-01',
        expirationDate: '2026-09-01', // Expiring soon (approx 2 weeks from current mock date)
        verificationStatus: 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Credentialing Committee',
        verifiedAt: currentIso,
      });

      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'Advanced Trauma Life Support (ATLS/ACLS)',
        licenseNumber: `ACLS-${Math.floor(10000 + Math.random() * 90000)}`,
        issuingBody: 'American College of Surgeons / AHA',
        issueDate: '2024-06-10',
        expirationDate: '2028-06-10',
        verificationStatus: 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Clinical Education Director',
        verifiedAt: currentIso,
      });
    } else if (s.primaryRole === 'nurse') {
      const isExpiring = s.staffNumber === 'EMP-2003';
      const isExpired = s.staffNumber === 'EMP-2002' ? false : false;

      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'Registered Nurse License (RN)',
        licenseNumber: `RN-${Math.floor(100000 + Math.random() * 900000)}`,
        issuingBody: 'State Board of Registered Nursing',
        issueDate: '2023-05-12',
        expirationDate: isExpiring ? '2026-08-28' : '2027-05-12',
        verificationStatus: isExpiring ? 'verified' : 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Director of Nursing',
        verifiedAt: currentIso,
      });

      const credItem: Omit<ClinicalCredential, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> = {
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'Basic & Advanced Cardiac Life Support (BLS/ACLS)',
        licenseNumber: `BLS-${Math.floor(10000 + Math.random() * 90000)}`,
        issuingBody: 'American Heart Association (AHA)',
        issueDate: '2024-02-01',
        expirationDate: '2026-02-01', // Expired credential example
        verificationStatus: s.staffNumber === 'EMP-2002' ? 'expired' : 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Clinical Education Director',
        verifiedAt: currentIso,
      };
      if (s.staffNumber === 'EMP-2002') {
        credItem.notes = 'Recertification course scheduled for next Friday';
      }
      credsToSeed.push(credItem);
    } else if (s.primaryRole === 'pharmacy') {
      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'Registered Pharmacist License (RPh)',
        licenseNumber: `RPH-${Math.floor(100000 + Math.random() * 900000)}`,
        issuingBody: 'State Board of Pharmacy',
        issueDate: '2022-09-01',
        expirationDate: '2027-09-01',
        verificationStatus: 'verified',
        isMandatoryForPractice: true,
        verifiedBy: 'Pharmacy Director',
        verifiedAt: currentIso,
      });
    } else if (s.primaryRole === 'lab') {
      credsToSeed.push({
        staffId: s.id,
        staffName: s.fullName,
        staffRole: s.primaryRole,
        title: 'Medical Laboratory Scientist (ASCP)',
        licenseNumber: `MLS-${Math.floor(100000 + Math.random() * 900000)}`,
        issuingBody: 'American Society for Clinical Pathology',
        issueDate: '2023-11-15',
        expirationDate: '2026-11-15',
        verificationStatus: 'pending',
        isMandatoryForPractice: true,
        notes: 'Renewal submitted; awaiting state verification seal',
      });
    }
  });

  for (const cred of credsToSeed) {
    const credRef = doc(collection(db, 'tenants', tenantId, 'credentials'));
    await setDoc(credRef, cleanFirestoreData({
      ...cred,
      id: credRef.id,
      tenantId,
      createdAt: currentIso,
      updatedAt: currentIso,
    }));
  }
}

export async function seedInitialRosterAndShifts(tenantId: string): Promise<void> {
  const staff = await getStaffMembers(tenantId);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();

  const shiftsToSeed: Omit<RosterShift, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>[] = [];

  // Generate shifts for the current 7-day period
  for (let offset = -3; offset <= 4; offset++) {
    const d = new Date(year, month, todayDate + offset);
    const dateStr = d.toISOString().split('T')[0];

    // Morning Shifts (07:00 - 15:30)
    const doctor1 = staff.find((s) => s.primaryRole === 'doctor');
    const nurse1 = staff.find((s) => s.primaryRole === 'nurse');

    if (doctor1) {
      shiftsToSeed.push({
        shiftNumber: `SH-${dateStr}-M1`,
        staffId: doctor1.id,
        staffName: doctor1.fullName,
        staffRole: doctor1.primaryRole,
        departmentId: doctor1.departmentId,
        departmentName: doctor1.departmentName,
        wardId: 'ward-ed-1',
        wardName: 'Emergency Bay A',
        shiftType: 'morning',
        date: dateStr,
        scheduledStartTime: `${dateStr}T07:00:00`,
        scheduledEndTime: `${dateStr}T15:30:00`,
        breakDuration: 30,
        totalHours: 8.0,
        status: offset < 0 ? 'completed' : offset === 0 ? 'in_progress' : 'scheduled',
      });
    }

    if (nurse1) {
      shiftsToSeed.push({
        shiftNumber: `SH-${dateStr}-M2`,
        staffId: nurse1.id,
        staffName: nurse1.fullName,
        staffRole: nurse1.primaryRole,
        departmentId: nurse1.departmentId,
        departmentName: nurse1.departmentName,
        wardId: 'ward-icu-1',
        wardName: 'ICU Pod A',
        shiftType: 'morning',
        date: dateStr,
        scheduledStartTime: `${dateStr}T07:00:00`,
        scheduledEndTime: `${dateStr}T19:30:00`,
        breakDuration: 45,
        totalHours: 11.75,
        status: offset < 0 ? 'completed' : offset === 0 ? 'in_progress' : 'scheduled',
      });
    }

    // Evening Shifts (15:00 - 23:30)
    const doctor2 = staff.find((s) => s.staffNumber === 'EMP-1002');
    const nurse2 = staff.find((s) => s.staffNumber === 'EMP-2003');

    if (doctor2 && Math.abs(offset) % 2 === 0) {
      shiftsToSeed.push({
        shiftNumber: `SH-${dateStr}-E1`,
        staffId: doctor2.id,
        staffName: doctor2.fullName,
        staffRole: doctor2.primaryRole,
        departmentId: doctor2.departmentId,
        departmentName: doctor2.departmentName,
        wardId: 'ward-or-1',
        wardName: 'OR Suite 1',
        shiftType: 'evening',
        date: dateStr,
        scheduledStartTime: `${dateStr}T15:00:00`,
        scheduledEndTime: `${dateStr}T23:30:00`,
        breakDuration: 30,
        totalHours: 8.0,
        status: offset < 0 ? 'completed' : 'scheduled',
      });
    }

    if (nurse2) {
      shiftsToSeed.push({
        shiftNumber: `SH-${dateStr}-E2`,
        staffId: nurse2.id,
        staffName: nurse2.fullName,
        staffRole: nurse2.primaryRole,
        departmentId: nurse2.departmentId,
        departmentName: nurse2.departmentName,
        wardId: 'ward-ed-2',
        wardName: 'Emergency Bay B',
        shiftType: 'evening',
        date: dateStr,
        scheduledStartTime: `${dateStr}T15:00:00`,
        scheduledEndTime: `${dateStr}T23:30:00`,
        breakDuration: 30,
        totalHours: 8.0,
        status: offset < 0 ? 'completed' : 'scheduled',
      });
    }

    // Night Shift (23:00 - 07:30)
    const nurse3 = staff.find((s) => s.staffNumber === 'EMP-2002');
    if (nurse3 && offset >= -1) {
      shiftsToSeed.push({
        shiftNumber: `SH-${dateStr}-N1`,
        staffId: nurse3.id,
        staffName: nurse3.fullName,
        staffRole: nurse3.primaryRole,
        departmentId: nurse3.departmentId,
        departmentName: nurse3.departmentName,
        wardId: 'ward-medsurg-1',
        wardName: 'Ward 3 East',
        shiftType: 'night',
        date: dateStr,
        scheduledStartTime: `${dateStr}T23:00:00`,
        scheduledEndTime: `${dateStr}T07:30:00`,
        breakDuration: 30,
        totalHours: 8.0,
        status: offset < 0 ? 'completed' : 'scheduled',
      });
    }
  }

  const nowIso = new Date().toISOString();
  for (const shift of shiftsToSeed) {
    const shiftRef = doc(collection(db, 'tenants', tenantId, 'shifts'));
    await setDoc(shiftRef, {
      ...shift,
      id: shiftRef.id,
      tenantId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
}

export async function seedInitialPayrollPeriod(tenantId: string): Promise<void> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');

  const period: Omit<PayrollPeriod, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> = {
    periodNumber: `PR-${y}-${m}`,
    periodName: `August ${y} Monthly Clinical Payroll`,
    startDate: `${y}-${m}-01`,
    endDate: `${y}-${m}-31`,
    paymentDate: `${y}-${m}-31`,
    status: 'open',
    totalGross: 0,
    totalOvertime: 0,
    totalDeductions: 0,
    totalNetPay: 0,
    staffCount: 0,
    payslipCount: 0,
  };

  const periodRef = doc(collection(db, 'tenants', tenantId, 'payrollPeriods'));
  const nowIso = new Date().toISOString();
  await setDoc(periodRef, {
    ...period,
    id: periodRef.id,
    tenantId,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}
