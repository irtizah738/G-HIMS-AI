/**
 * G-HIMS Master HR & Workforce Management Domain Service
 * Production-grade hospital workforce management with server-authoritative validation,
 * credential verification, privilege gates, rostering, attendance, leave & audit.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import {
  EmployeeMaster,
  EmployeeCredential,
  ClinicalPrivilege,
  RosterShiftEntry,
  StaffingGapAnalysis,
  AttendanceRecord,
  LeaveRequest,
  EmployeeLeaveBalance,
  CompensationStructure,
  PerformanceReview,
  DisciplinaryRecord,
  EmployeeTrainingRecord,
} from '@/types/hcm-advanced';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

export class HrWorkforceDomainService {
  // In-memory CQRS cache stores for instant simulation and persistence sync
  private static employees: Map<string, EmployeeMaster> = new Map();
  private static credentials: Map<string, EmployeeCredential> = new Map();
  private static privileges: Map<string, ClinicalPrivilege> = new Map();
  private static shifts: Map<string, RosterShiftEntry> = new Map();
  private static attendanceRecords: Map<string, AttendanceRecord> = new Map();
  private static leaveRequests: Map<string, LeaveRequest> = new Map();
  private static leaveBalances: Map<string, EmployeeLeaveBalance[]> = new Map();
  private static compensationRecords: Map<string, CompensationStructure> = new Map();
  private static performanceReviews: Map<string, PerformanceReview> = new Map();
  private static disciplinaryRecords: Map<string, DisciplinaryRecord> = new Map();
  private static trainingRecords: Map<string, EmployeeTrainingRecord[]> = new Map();

  private static async loadEmployee(
    tenantId: string,
    employeeId: string
  ): Promise<EmployeeMaster | null> {
    const cached = this.employees.get(employeeId);
    if (cached) return cached;
    const persisted = await DomainStateRepository.getById<EmployeeMaster>(
      tenantId,
      'employees',
      employeeId
    );
    if (persisted) this.employees.set(employeeId, persisted);
    return persisted;
  }

  private static async loadCredential(
    tenantId: string,
    credentialId: string
  ): Promise<EmployeeCredential | null> {
    const cached = this.credentials.get(credentialId);
    if (cached) return cached;
    const persisted = await DomainStateRepository.getById<EmployeeCredential>(
      tenantId,
      'clinicalCredentials',
      credentialId
    );
    if (persisted) this.credentials.set(credentialId, persisted);
    return persisted;
  }

  private static async loadAttendance(
    tenantId: string,
    attendanceId: string
  ): Promise<AttendanceRecord | null> {
    const cached = this.attendanceRecords.get(attendanceId);
    if (cached) return cached;
    const persisted = await DomainStateRepository.getById<AttendanceRecord>(
      tenantId,
      'attendanceRecords',
      attendanceId
    );
    if (persisted) this.attendanceRecords.set(attendanceId, persisted);
    return persisted;
  }

  private static async loadLeave(
    tenantId: string,
    leaveId: string
  ): Promise<LeaveRequest | null> {
    const cached = this.leaveRequests.get(leaveId);
    if (cached) return cached;
    const persisted = await DomainStateRepository.getById<LeaveRequest>(
      tenantId,
      'leaveRequests',
      leaveId
    );
    if (persisted) this.leaveRequests.set(leaveId, persisted);
    return persisted;
  }

  private static async hydrateClinicalEligibility(
    tenantId: string,
    employeeId: string
  ): Promise<void> {
    const [credentials, privileges] = await Promise.all([
      DomainStateRepository.queryEqual<EmployeeCredential>(
        tenantId,
        'clinicalCredentials',
        'employeeId',
        employeeId
      ),
      DomainStateRepository.queryEqual<ClinicalPrivilege>(
        tenantId,
        'clinicalPrivileges',
        'employeeId',
        employeeId
      ),
    ]);

    for (const credential of credentials) {
      this.credentials.set(credential.credentialId, credential);
    }
    for (const privilege of privileges) {
      this.privileges.set(privilege.privilegeId, privilege);
    }
  }

  private static async loadShiftsForEmployee(
    tenantId: string,
    employeeId: string
  ): Promise<RosterShiftEntry[]> {
    const byId = new Map<string, RosterShiftEntry>();

    for (const shift of this.shifts.values()) {
      if (shift.employeeId === employeeId) byId.set(shift.rosterId, shift);
    }

    const persisted = await DomainStateRepository.queryEqual<RosterShiftEntry>(
      tenantId,
      'rosterAssignments',
      'employeeId',
      employeeId
    );

    for (const shift of persisted) {
      this.shifts.set(shift.rosterId, shift);
      byId.set(shift.rosterId, shift);
    }

    return Array.from(byId.values());
  }

  // ============================================================================
  // 1. EMPLOYEE MASTER & LIFECYCLE
  // ============================================================================

  public static async createEmployee(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<EmployeeMaster, 'employeeId' | 'employeeNumber' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'SYSTEM_ADMIN', 'MEDICAL_DIRECTOR', 'HOSPITAL_EXECUTIVE'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'HR Admin authority required.' },
      };
    }

    const employeeId = `emp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const employeeNumber = `EMP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const employee: EmployeeMaster = {
      ...payload,
      employeeId,
      employeeNumber,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };

    this.employees.set(employeeId, employee);

    // Seed default leave balance
    this.seedDefaultLeaveBalances(employeeId);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_MASTER',
      entityId: employeeId,
      eventType: 'EMPLOYEE_CREATED',
      domainState: employee,
      eventPayload: {
        employeeId,
        employeeNumber,
        fullName: `${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName}`,
        departmentId: employee.primaryDepartmentId,
        positionTitle: employee.positionTitle,
        employmentType: employee.employmentType,
        employmentStatus: employee.employmentStatus,
      },
      auditReason: `Hired/Created employee ${employeeNumber} (${employee.personalInfo.legalFirstName} ${employee.personalInfo.legalLastName})`,
      outboxTopic: 'g-hims-workforce-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: employeeId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: employee,
    };
  }

  public static async updateEmployeeStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      newStatus: EmployeeMaster['employmentStatus'];
      reason: string;
    }
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'SYSTEM_ADMIN', 'MEDICAL_DIRECTOR'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Unauthorized.' },
      };
    }

    const employee = await this.loadEmployee(context.tenantId, payload.employeeId);
    if (!employee) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'EMPLOYEE_NOT_FOUND', message: `Employee ${payload.employeeId} does not exist.` },
      };
    }

    const previousStatus = employee.employmentStatus;
    employee.employmentStatus = payload.newStatus;
    employee.updatedAt = new Date().toISOString();
    this.employees.set(payload.employeeId, employee);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_MASTER',
      entityId: payload.employeeId,
      eventType: 'EMPLOYEE_STATUS_TRANSITIONED',
      domainState: employee,
      eventPayload: {
        employeeId: payload.employeeId,
        previousStatus,
        newStatus: payload.newStatus,
        reason: payload.reason,
      },
      auditReason: `Status of ${employee.employeeNumber} changed from ${previousStatus} to ${payload.newStatus}: ${payload.reason}`,
      outboxTopic: 'g-hims-workforce-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.employeeId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: employee,
    };
  }

  public static async transferEmployee(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      toDepartmentId: string;
      toDepartmentName: string;
      toPositionId: string;
      toPositionTitle: string;
      reason: string;
      effectiveDate: string;
    }
  ): Promise<CommandResult<EmployeeMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'SYSTEM_ADMIN', 'MEDICAL_DIRECTOR', 'HOSPITAL_EXECUTIVE'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'HR Admin authority required.' },
      };
    }

    const employee = await this.loadEmployee(context.tenantId, payload.employeeId);
    if (!employee) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'EMPLOYEE_NOT_FOUND', message: `Employee ${payload.employeeId} does not exist.` },
      };
    }

    const previousDept = { id: employee.primaryDepartmentId, name: employee.primaryDepartmentName };
    const previousPosition = { id: employee.positionId, title: employee.positionTitle };

    employee.primaryDepartmentId = payload.toDepartmentId;
    employee.primaryDepartmentName = payload.toDepartmentName;
    if (!employee.departmentIds.includes(payload.toDepartmentId)) {
      employee.departmentIds.push(payload.toDepartmentId);
    }
    employee.positionId = payload.toPositionId;
    employee.positionTitle = payload.toPositionTitle;
    employee.updatedAt = new Date().toISOString();

    this.employees.set(payload.employeeId, employee);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_MASTER',
      entityId: payload.employeeId,
      eventType: 'EMPLOYEE_TRANSFERRED',
      domainState: employee,
      eventPayload: {
        employeeId: payload.employeeId,
        previousDept,
        newDept: { id: payload.toDepartmentId, name: payload.toDepartmentName },
        previousPosition,
        newPosition: { id: payload.toPositionId, title: payload.toPositionTitle },
        reason: payload.reason,
        effectiveDate: payload.effectiveDate,
      },
      auditReason: `Employee ${employee.employeeNumber} transferred from ${previousDept.name} to ${payload.toDepartmentName}: ${payload.reason}`,
      outboxTopic: 'g-hims-workforce-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.employeeId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: employee,
    };
  }

  // ============================================================================
  // 2. CREDENTIALS & CLINICAL PRIVILEGES (With Auto-Lockout)
  // ============================================================================

  public static async submitCredential(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<EmployeeCredential, 'credentialId' | 'verificationStatus' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<EmployeeCredential>> {
    const credentialId = `crd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const credential: EmployeeCredential = {
      ...payload,
      credentialId,
      verificationStatus: 'UNDER_REVIEW',
      createdAt: now,
      updatedAt: now,
    };

    this.credentials.set(credentialId, credential);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_CREDENTIAL',
      entityId: credentialId,
      eventType: 'CREDENTIAL_SUBMITTED',
      domainState: credential,
      eventPayload: {
        credentialId,
        employeeId: payload.employeeId,
        credentialType: payload.credentialType,
        credentialNumber: payload.credentialNumber,
        expiryDate: payload.expiryDate,
      },
      auditReason: `Credential ${payload.title} (${payload.credentialNumber}) submitted for employee ${payload.employeeId}`,
      outboxTopic: 'g-hims-credential-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: credentialId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: credential,
    };
  }

  public static async verifyCredential(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      credentialId: string;
      status: 'VERIFIED' | 'REJECTED';
      notes?: string;
    }
  ): Promise<CommandResult<EmployeeCredential>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['MEDICAL_DIRECTOR', 'HR_ADMIN', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Medical Director authority required to verify credentials.' },
      };
    }

    const credential = await this.loadCredential(context.tenantId, payload.credentialId);
    if (!credential) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'CREDENTIAL_NOT_FOUND', message: `Credential ${payload.credentialId} not found.` },
      };
    }

    const now = new Date().toISOString();
    credential.verificationStatus = payload.status;
    credential.verifiedByActorId = context.actorId;
    credential.verifiedByName = 'Medical Director Office';
    credential.verifiedAt = now;
    credential.notes = payload.notes || credential.notes;
    credential.updatedAt = now;

    this.credentials.set(payload.credentialId, credential);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'EMPLOYEE_CREDENTIAL',
      entityId: payload.credentialId,
      eventType: payload.status === 'VERIFIED' ? 'CREDENTIAL_VERIFIED' : 'CREDENTIAL_REJECTED',
      domainState: credential,
      eventPayload: {
        credentialId: payload.credentialId,
        employeeId: credential.employeeId,
        verificationStatus: payload.status,
        verifiedBy: context.actorId,
      },
      auditReason: `Credential ${credential.title} set to ${payload.status} by ${context.actorId}`,
      outboxTopic: 'g-hims-credential-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.credentialId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: credential,
    };
  }

  /**
   * Enforces automated clinical practice lockout if mandatory credentials have expired.
   */
  public static checkClinicalEligibility(employeeId: string): {
    isEligible: boolean;
    reason?: string;
    expiredCredentials: EmployeeCredential[];
    activePrivileges: ClinicalPrivilege[];
  } {
    const today = new Date().toISOString().split('T')[0];
    const employeeCreds = Array.from(this.credentials.values()).filter(
      (c) => c.employeeId === employeeId
    );

    const expiredOrInvalidMandatory = employeeCreds.filter(
      (c) =>
        c.isMandatoryForPractice &&
        (c.verificationStatus !== 'VERIFIED' || (c.expiryDate && c.expiryDate < today))
    );

    const employeePrivileges = Array.from(this.privileges.values()).filter(
      (p) => p.employeeId === employeeId && p.status === 'GRANTED' && p.effectiveUntil >= today
    );

    if (expiredOrInvalidMandatory.length > 0) {
      return {
        isEligible: false,
        reason: `CLINICAL PRACTICE LOCKOUT: ${expiredOrInvalidMandatory.length} mandatory license(s) expired or unverified (${expiredOrInvalidMandatory.map((c) => c.title).join(', ')}).`,
        expiredCredentials: expiredOrInvalidMandatory,
        activePrivileges: [],
      };
    }

    return {
      isEligible: true,
      expiredCredentials: [],
      activePrivileges: employeePrivileges,
    };
  }

  public static async grantClinicalPrivilege(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<ClinicalPrivilege, 'privilegeId' | 'status' | 'grantedByActorId' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<ClinicalPrivilege>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['MEDICAL_DIRECTOR', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Medical Director authority required to grant clinical privileges.' },
      };
    }

    // Verify practitioner has active medical license
    await this.hydrateClinicalEligibility(context.tenantId, payload.employeeId);
    const eligibility = this.checkClinicalEligibility(payload.employeeId);
    if (!eligibility.isEligible) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'CREDENTIAL_PREREQUISITE_FAILED', message: eligibility.reason || 'Practice prerequisite failed.' },
      };
    }

    const privilegeId = `prv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const privilege: ClinicalPrivilege = {
      ...payload,
      privilegeId,
      status: 'GRANTED',
      grantedByActorId: context.actorId,
      grantedByName: 'Medical Board & Credentialing Committee',
      createdAt: now,
      updatedAt: now,
    };

    this.privileges.set(privilegeId, privilege);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'CLINICAL_PRIVILEGE',
      entityId: privilegeId,
      eventType: 'CLINICAL_PRIVILEGE_GRANTED',
      domainState: privilege,
      eventPayload: {
        privilegeId,
        employeeId: payload.employeeId,
        privilegeType: payload.privilegeType,
        effectiveFrom: payload.effectiveFrom,
        effectiveUntil: payload.effectiveUntil,
      },
      auditReason: `Granted privilege ${payload.privilegeType} to employee ${payload.employeeId}`,
      outboxTopic: 'g-hims-privilege-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: privilegeId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: privilege,
    };
  }

  // ============================================================================
  // 3. ROSTERING, SHIFTS & GAP DETECTION (With Fatigue Compliance)
  // ============================================================================

  public static async assignShift(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<RosterShiftEntry, 'rosterId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<RosterShiftEntry>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'NURSE_MANAGER', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Department Head / Nurse Manager role required.' },
      };
    }

    // Check credential lockout for clinical shifts
    await this.hydrateClinicalEligibility(context.tenantId, payload.employeeId);
    const eligibility = this.checkClinicalEligibility(payload.employeeId);
    if (!eligibility.isEligible) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CLINICAL_CREDENTIAL_EXPIRED',
          message: `Cannot assign clinical shift: ${eligibility.reason}`,
        },
      };
    }

    // Fatigue compliance: Check for rest period violation (< 10 hours rest between consecutive shifts)
    const existingEmployeeShifts = (await this.loadShiftsForEmployee(
      context.tenantId,
      payload.employeeId
    )).filter((shift) => shift.status !== 'CANCELLED');

    const proposedStart = new Date(payload.startTime).getTime();
    const minRestMs = 10 * 60 * 60 * 1000; // 10 hours

    for (const existing of existingEmployeeShifts) {
      const existingEnd = new Date(existing.endTime).getTime();
      const existingStart = new Date(existing.startTime).getTime();

      // Double-booking check
      if (
        (proposedStart >= existingStart && proposedStart < existingEnd) ||
        (new Date(payload.endTime).getTime() > existingStart && new Date(payload.endTime).getTime() <= existingEnd)
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'SHIFT_DOUBLE_BOOKING_CONFLICT',
            message: `Staff member ${payload.employeeName} is already rostered for shift ${existing.shiftName} (${existing.startTime} - ${existing.endTime}).`,
          },
        };
      }

      // Rest period check
      const restGap = proposedStart - existingEnd;
      if (restGap > 0 && restGap < minRestMs) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'FATIGUE_COMPLIANCE_VIOLATION',
            message: `Mandatory rest violation: Only ${(restGap / (1000 * 60 * 60)).toFixed(1)}h rest between shifts. Minimum required is 10 hours.`,
          },
        };
      }
    }

    const rosterId = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const shiftEntry: RosterShiftEntry = {
      ...payload,
      rosterId,
      status: 'PUBLISHED',
      createdAt: now,
      updatedAt: now,
    };

    this.shifts.set(rosterId, shiftEntry);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ROSTER_SHIFT',
      entityId: rosterId,
      eventType: 'SHIFT_ASSIGNED',
      domainState: shiftEntry,
      eventPayload: {
        rosterId,
        employeeId: payload.employeeId,
        departmentId: payload.departmentId,
        date: payload.date,
        shiftName: payload.shiftName,
        startTime: payload.startTime,
        endTime: payload.endTime,
      },
      auditReason: `Assigned ${payload.shiftName} shift to ${payload.employeeName} on ${payload.date}`,
      outboxTopic: 'g-hims-roster-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: rosterId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: shiftEntry,
    };
  }

  public static calculateStaffingGaps(
    departmentId: string,
    departmentName: string,
    date: string,
    requiredCount: number,
    requiredSpecialties: string[] = []
  ): StaffingGapAnalysis {
    const scheduled = Array.from(this.shifts.values()).filter(
      (s) => s.departmentId === departmentId && s.date === date && s.status !== 'CANCELLED'
    );

    const scheduledCount = scheduled.length;
    const gapCount = requiredCount - scheduledCount;

    let status: StaffingGapAnalysis['status'] = 'FULLY_STAFFED';
    if (gapCount > 0) status = 'UNDERSTAFFED';
    else if (gapCount < 0) status = 'OVERSTAFFED';

    return {
      departmentId,
      departmentName,
      shiftId: 'ALL_SHIFTS',
      shiftName: 'Daily Coverage',
      date,
      requiredCount,
      scheduledCount,
      presentCount: scheduledCount,
      gapCount: Math.max(0, gapCount),
      status,
      missingSpecialties: gapCount > 0 ? requiredSpecialties : [],
      fatigueAlerts: [],
      credentialAlerts: [],
    };
  }

  // ============================================================================
  // 4. ATTENDANCE & TIME TRACKING (Immutable + Correction Audit)
  // ============================================================================

  public static async recordClockIn(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      employeeId: string;
      employeeName: string;
      facilityId: string;
      departmentId: string;
      source: AttendanceRecord['source'];
      deviceIdentifier?: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const attendanceId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const attendance: AttendanceRecord = {
      attendanceId,
      tenantId: context.tenantId,
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      facilityId: payload.facilityId,
      departmentId: payload.departmentId,
      date: today,
      clockInTime: now,
      totalHoursWorked: 0,
      overtimeHours: 0,
      overtimeApproved: false,
      source: payload.source,
      deviceIdentifier: payload.deviceIdentifier,
      status: 'ON_TIME',
      isCorrected: false,
      createdAt: now,
      updatedAt: now,
    };

    this.attendanceRecords.set(attendanceId, attendance);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: attendanceId,
      eventType: 'EMPLOYEE_CLOCKED_IN',
      domainState: attendance,
      eventPayload: {
        attendanceId,
        employeeId: payload.employeeId,
        clockInTime: now,
        source: payload.source,
      },
      auditReason: `Employee ${payload.employeeName} clocked in via ${payload.source}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: attendance,
    };
  }

  public static async recordClockOut(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      attendanceId: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const attendance = await this.loadAttendance(context.tenantId, payload.attendanceId);
    if (!attendance) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RECORD_NOT_FOUND', message: 'Attendance record not found.' },
      };
    }

    const now = new Date().toISOString();
    const clockInMs = new Date(attendance.clockInTime).getTime();
    const clockOutMs = new Date(now).getTime();
    const hoursWorked = Math.max(0, (clockOutMs - clockInMs) / (1000 * 60 * 60));
    const overtimeHours = Math.max(0, hoursWorked - 8.0);

    attendance.clockOutTime = now;
    attendance.totalHoursWorked = Number(hoursWorked.toFixed(2));
    attendance.overtimeHours = Number(overtimeHours.toFixed(2));
    attendance.updatedAt = now;

    this.attendanceRecords.set(payload.attendanceId, attendance);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: payload.attendanceId,
      eventType: 'EMPLOYEE_CLOCKED_OUT',
      domainState: attendance,
      eventPayload: {
        attendanceId: payload.attendanceId,
        employeeId: attendance.employeeId,
        clockOutTime: now,
        totalHoursWorked: attendance.totalHoursWorked,
        overtimeHours: attendance.overtimeHours,
      },
      auditReason: `Employee ${attendance.employeeName} clocked out. Total hours: ${attendance.totalHoursWorked}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: attendance,
    };
  }

  public static async correctAttendanceTime(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      attendanceId: string;
      newClockInTime: string;
      newClockOutTime?: string;
      reason: string;
    }
  ): Promise<CommandResult<AttendanceRecord>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'SUPERVISOR', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Supervisor / HR authorization required for time corrections.' },
      };
    }

    const record = await this.loadAttendance(context.tenantId, payload.attendanceId);
    if (!record) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RECORD_NOT_FOUND', message: 'Attendance record not found.' },
      };
    }

    const previousClockIn = record.clockInTime;
    const correctionId = `cor_${Date.now()}`;
    const now = new Date().toISOString();

    if (!record.originalClockInTime) {
      record.originalClockInTime = record.clockInTime;
    }
    if (!record.originalClockOutTime && record.clockOutTime) {
      record.originalClockOutTime = record.clockOutTime;
    }

    record.clockInTime = payload.newClockInTime;
    if (payload.newClockOutTime) {
      record.clockOutTime = payload.newClockOutTime;
      const inMs = new Date(payload.newClockInTime).getTime();
      const outMs = new Date(payload.newClockOutTime).getTime();
      record.totalHoursWorked = Number(Math.max(0, (outMs - inMs) / (1000 * 60 * 60)).toFixed(2));
      record.overtimeHours = Number(Math.max(0, record.totalHoursWorked - 8).toFixed(2));
    }

    record.isCorrected = true;
    record.status = 'CORRECTED';
    record.updatedAt = now;

    if (!record.correctionHistory) record.correctionHistory = [];
    record.correctionHistory.push({
      correctionId,
      correctedByActorId: context.actorId,
      correctedByName: 'Supervisor / HR Admin',
      correctedAt: now,
      previousClockIn,
      newClockIn: payload.newClockInTime,
      reason: payload.reason,
    });

    this.attendanceRecords.set(payload.attendanceId, record);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ATTENDANCE_RECORD',
      entityId: payload.attendanceId,
      eventType: 'ATTENDANCE_CORRECTED',
      domainState: record,
      eventPayload: {
        attendanceId: payload.attendanceId,
        previousClockIn,
        newClockIn: payload.newClockInTime,
        reason: payload.reason,
        correctedBy: context.actorId,
      },
      auditReason: `Attendance correction: ${payload.reason}`,
      outboxTopic: 'g-hims-attendance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.attendanceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: record,
    };
  }

  // ============================================================================
  // 5. LEAVE MANAGEMENT & BALANCES
  // ============================================================================

  public static async submitLeaveRequest(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<LeaveRequest, 'leaveId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<LeaveRequest>> {
    const leaveId = `lve_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const leave: LeaveRequest = {
      ...payload,
      leaveId,
      status: 'SUBMITTED',
      createdAt: now,
      updatedAt: now,
    };

    this.leaveRequests.set(leaveId, leave);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'LEAVE_REQUEST',
      entityId: leaveId,
      eventType: 'LEAVE_REQUESTED',
      domainState: leave,
      eventPayload: {
        leaveId,
        employeeId: payload.employeeId,
        leaveType: payload.leaveType,
        startDate: payload.startDate,
        endDate: payload.endDate,
        totalDays: payload.totalDays,
      },
      auditReason: `Leave requested by ${payload.employeeName} (${payload.leaveType}, ${payload.totalDays} days)`,
      outboxTopic: 'g-hims-leave-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: leaveId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: leave,
    };
  }

  public static async approveLeaveRequest(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      leaveId: string;
      approved: boolean;
      rejectionReason?: string;
    }
  ): Promise<CommandResult<LeaveRequest>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['HR_ADMIN', 'DEPARTMENT_HEAD', 'MEDICAL_DIRECTOR', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Department Head or HR approval authority required.' },
      };
    }

    const leave = await this.loadLeave(context.tenantId, payload.leaveId);
    if (!leave) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' },
      };
    }

    const now = new Date().toISOString();
    leave.status = payload.approved ? 'APPROVED' : 'REJECTED';
    leave.reviewedByActorId = context.actorId;
    leave.reviewedByName = 'Department Head / HR';
    leave.reviewedAt = now;
    if (!payload.approved && payload.rejectionReason) {
      leave.rejectionReason = payload.rejectionReason;
    }
    leave.updatedAt = now;

    this.leaveRequests.set(payload.leaveId, leave);

    // Deduct leave balance if approved
    if (payload.approved) {
      const balances = this.leaveBalances.get(leave.employeeId) || [];
      const balance = balances.find((b) => b.leaveType === leave.leaveType);
      if (balance) {
        balance.usedDays += leave.totalDays;
        balance.remainingDays = Math.max(0, balance.annualEntitlement - balance.usedDays);
        balance.lastUpdated = now;
      }
    }

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'LEAVE_REQUEST',
      entityId: payload.leaveId,
      eventType: payload.approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      domainState: leave,
      eventPayload: {
        leaveId: payload.leaveId,
        employeeId: leave.employeeId,
        approved: payload.approved,
        rejectionReason: payload.rejectionReason,
      },
      auditReason: `Leave ${payload.leaveId} was ${leave.status} by ${context.actorId}`,
      outboxTopic: 'g-hims-leave-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.leaveId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: leave,
    };
  }

  // ============================================================================
  // 6. SEED & HELPER UTILITIES
  // ============================================================================

  private static seedDefaultLeaveBalances(employeeId: string) {
    const year = new Date().getFullYear();
    const now = new Date().toISOString();
    const defaultBalances: EmployeeLeaveBalance[] = [
      {
        employeeId,
        leaveType: 'ANNUAL',
        year,
        annualEntitlement: 21,
        accruedDays: 21,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 21,
        lastUpdated: now,
      },
      {
        employeeId,
        leaveType: 'SICK',
        year,
        annualEntitlement: 14,
        accruedDays: 14,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 14,
        lastUpdated: now,
      },
      {
        employeeId,
        leaveType: 'STUDY_CME',
        year,
        annualEntitlement: 7,
        accruedDays: 7,
        usedDays: 0,
        pendingApprovalDays: 0,
        remainingDays: 7,
        lastUpdated: now,
      },
    ];
    this.leaveBalances.set(employeeId, defaultBalances);
  }

  public static ensureInitialized(): void {
    if (this.employees.size > 0) return;

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const sampleEmployees: EmployeeMaster[] = [
      {
        employeeId: 'emp_001',
        employeeNumber: 'EMP-2026-0814',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_cardiology', 'dept_general_medicine'],
        primaryDepartmentId: 'dept_cardiology',
        primaryDepartmentName: 'Cardiology',
        positionId: 'pos_attending_cardio',
        positionTitle: 'Attending Cardiologist',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2021-03-15',
        personalInfo: {
          legalFirstName: 'Sarah',
          legalLastName: 'Jenkins',
          dateOfBirth: '1984-06-12',
          gender: 'FEMALE',
          contactEmail: 's.jenkins@centralmetro.health',
          contactPhone: '+1-555-019-2831',
          emergencyContact: { name: 'Mark Jenkins', relationship: 'Spouse', phone: '+1-555-019-2832' },
          residentialAddress: { street: '42 Medical Center Blvd', city: 'Metro City', state: 'NY', postalCode: '10001', country: 'USA' },
        },
        compensation: { baseSalary: 32000000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        employeeId: 'emp_002',
        employeeNumber: 'EMP-2026-0922',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_surgery', 'dept_orthopedics'],
        primaryDepartmentId: 'dept_surgery',
        primaryDepartmentName: 'Surgical Theaters',
        positionId: 'pos_chief_surgeon',
        positionTitle: 'Chief Orthopedic Surgeon',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2018-09-01',
        personalInfo: {
          legalFirstName: 'Robert',
          legalLastName: 'Hayes',
          dateOfBirth: '1976-11-23',
          gender: 'MALE',
          contactEmail: 'r.hayes@centralmetro.health',
          contactPhone: '+1-555-018-4920',
          emergencyContact: { name: 'Claire Hayes', relationship: 'Spouse', phone: '+1-555-018-4921' },
          residentialAddress: { street: '18 Highland Park', city: 'Metro City', state: 'NY', postalCode: '10002', country: 'USA' },
        },
        compensation: { baseSalary: 45000000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        employeeId: 'emp_003',
        employeeNumber: 'EMP-2026-1105',
        tenantId: 'tenant_default',
        facilityIds: ['fac_central'],
        primaryFacilityId: 'fac_central',
        departmentIds: ['dept_icu'],
        primaryDepartmentId: 'dept_icu',
        primaryDepartmentName: 'Intensive Care Unit (ICU)',
        positionId: 'pos_charge_nurse',
        positionTitle: 'ICU Charge Nurse',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        hireDate: '2022-01-10',
        personalInfo: {
          legalFirstName: 'Elena',
          legalLastName: 'Rostova',
          dateOfBirth: '1990-04-18',
          gender: 'FEMALE',
          contactEmail: 'e.rostova@centralmetro.health',
          contactPhone: '+1-555-017-3819',
          emergencyContact: { name: 'Anna Rostova', relationship: 'Sister', phone: '+1-555-017-3820' },
          residentialAddress: { street: '74 Elmwood Avenue', city: 'Metro City', state: 'NY', postalCode: '10003', country: 'USA' },
        },
        compensation: { baseSalary: 11500000, currency: 'USD', paySchedule: 'MONTHLY' },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleEmployees.forEach((emp) => {
      this.employees.set(emp.employeeId, emp);
      this.seedDefaultLeaveBalances(emp.employeeId);
    });

    // Sample Credentials
    const sampleCreds: EmployeeCredential[] = [
      {
        credentialId: 'crd_001',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        credentialType: 'MEDICAL_LICENSE',
        title: 'State Medical Board License - Physician & Surgeon',
        issuingAuthority: 'New York State Medical Board',
        credentialNumber: 'MED-NY-849204',
        issueDate: '2020-01-15',
        expiryDate: '2028-01-15',
        verificationStatus: 'VERIFIED',
        verifiedByActorId: 'usr_medical_director',
        verifiedByName: 'Dr. Arthur Campbell, MD (Medical Director)',
        verifiedAt: '2020-01-20T00:00:00Z',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        credentialId: 'crd_002',
        employeeId: 'emp_002',
        employeeName: 'Dr. Robert Hayes',
        credentialType: 'SPECIALTY_BOARD',
        title: 'American Board of Orthopaedic Surgery (ABOS) Diplomate',
        issuingAuthority: 'American Board of Orthopaedic Surgery',
        credentialNumber: 'ABOS-73921',
        issueDate: '2019-06-10',
        expiryDate: '2029-06-10',
        verificationStatus: 'VERIFIED',
        verifiedByActorId: 'usr_medical_director',
        verifiedByName: 'Dr. Arthur Campbell, MD (Medical Director)',
        verifiedAt: '2019-06-15T00:00:00Z',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        credentialId: 'crd_003',
        employeeId: 'emp_003',
        employeeName: 'Elena Rostova',
        credentialType: 'BLS_ACLS',
        title: 'Advanced Cardiovascular Life Support (ACLS)',
        issuingAuthority: 'American Heart Association',
        credentialNumber: 'AHA-ACLS-99120',
        issueDate: '2024-02-01',
        expiryDate: '2026-02-01',
        verificationStatus: 'VERIFIED',
        isMandatoryForPractice: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleCreds.forEach((c) => this.credentials.set(c.credentialId, c));

    // Sample Privileges
    const samplePrivs: ClinicalPrivilege[] = [
      {
        privilegeId: 'prv_001',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        privilegeType: 'CONSULT_OPD',
        specialty: 'Cardiology',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_cardiology',
        departmentName: 'Cardiology',
        status: 'GRANTED',
        effectiveFrom: '2021-03-15',
        effectiveUntil: '2028-03-15',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
      {
        privilegeId: 'prv_002',
        employeeId: 'emp_001',
        employeeName: 'Dr. Sarah Jenkins',
        privilegeType: 'PRESCRIBE_MEDICATION',
        specialty: 'Cardiology',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_cardiology',
        departmentName: 'Cardiology',
        status: 'GRANTED',
        effectiveFrom: '2021-03-15',
        effectiveUntil: '2028-03-15',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
      {
        privilegeId: 'prv_003',
        employeeId: 'emp_002',
        employeeName: 'Dr. Robert Hayes',
        privilegeType: 'PERFORM_GENERAL_SURGERY',
        specialty: 'Orthopedic Surgery',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        status: 'GRANTED',
        effectiveFrom: '2018-09-01',
        effectiveUntil: '2028-09-01',
        grantedByActorId: 'usr_medical_director',
        grantedByName: 'Medical Board Committee',
        createdAt: now,
        updatedAt: now,
      },
    ];

    samplePrivs.forEach((p) => this.privileges.set(p.privilegeId, p));

    // Sample Shifts
    const sampleShift: RosterShiftEntry = {
      rosterId: 'rst_sample_01',
      tenantId: 'tenant_default',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology',
      employeeId: 'emp_001',
      employeeName: 'Dr. Sarah Jenkins',
      positionTitle: 'Attending Cardiologist',
      date: today,
      shiftId: 'sft_morning_01',
      shiftName: 'Cardiology Morning Clinic',
      startTime: `${today}T08:00:00Z`,
      endTime: `${today}T16:00:00Z`,
      durationHours: 8,
      status: 'PUBLISHED',
      isOvertime: false,
      createdAt: now,
      updatedAt: now,
    };
    this.shifts.set(sampleShift.rosterId, sampleShift);
  }

  public static resetForTesting(): void {
    this.employees.clear();
    this.credentials.clear();
    this.privileges.clear();
    this.shifts.clear();
    this.attendanceRecords.clear();
    this.leaveRequests.clear();
    this.leaveBalances.clear();
    this.compensationRecords.clear();
    this.performanceReviews.clear();
    this.disciplinaryRecords.clear();
    this.trainingRecords.clear();
  }

  public static getEmployees(): EmployeeMaster[] {
    this.ensureInitialized();
    return Array.from(this.employees.values());
  }

  public static getCredentials(): EmployeeCredential[] {
    this.ensureInitialized();
    return Array.from(this.credentials.values());
  }

  public static getPrivileges(): ClinicalPrivilege[] {
    this.ensureInitialized();
    return Array.from(this.privileges.values());
  }

  public static getShifts(): RosterShiftEntry[] {
    this.ensureInitialized();
    return Array.from(this.shifts.values());
  }

  public static getAttendanceRecords(): AttendanceRecord[] {
    this.ensureInitialized();
    return Array.from(this.attendanceRecords.values());
  }

  public static getLeaveRequests(): LeaveRequest[] {
    this.ensureInitialized();
    return Array.from(this.leaveRequests.values());
  }
}
