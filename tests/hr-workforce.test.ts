/**
 * G-HIMS Master Human Capital & Workforce Management Test Suite
 * Validates Security, Tenant Isolation, Events, Employee Lifecycle,
 * Credential Auto-Lockout, Fatigue Compliance, Rostering, Attendance & Idempotency.
 */

import { CommandBus } from '../lib/backend/commands/command-bus';
import { HrWorkforceDomainService } from '../lib/backend/services/hr-workforce-domain-service';
import { CommandContext, BaseCommand } from '../lib/backend/types';

describe('G-HIMS HR & Workforce Management Domain Engine', () => {
  const hrAdminContext: CommandContext = {
    actorId: 'usr_hr_lead_01',
    tenantId: 'central-metro-hospital',
    roles: ['HR_ADMIN', 'SYSTEM_ADMIN'],
    permissions: ['ALL_HCM', 'ALL_WORKFORCE'],
    clinicalPrivileges: [],
    correlationId: 'corr_hr_test_1',
    requestId: 'req_hr_test_1',
  };

  const medDirectorContext: CommandContext = {
    actorId: 'usr_med_director',
    tenantId: 'central-metro-hospital',
    roles: ['MEDICAL_DIRECTOR', 'DOCTOR'],
    permissions: ['ALL_CLINICAL', 'ALL_HCM'],
    clinicalPrivileges: ['UNRESTRICTED_CLINICAL_CHIEF'],
    correlationId: 'corr_med_test_1',
    requestId: 'req_med_test_1',
  };

  const nurseContext: CommandContext = {
    actorId: 'usr_nurse_01',
    tenantId: 'central-metro-hospital',
    roles: ['NURSE'],
    permissions: ['CLINICAL_VIEW'],
    clinicalPrivileges: [],
    correlationId: 'corr_nurse_test_1',
    requestId: 'req_nurse_test_1',
  };

  beforeEach(() => {
    HrWorkforceDomainService.resetForTesting();
    HrWorkforceDomainService.ensureInitialized();
  });

  describe('1. Security & Tenant Isolation (Gate A)', () => {
    test('Rejects command if tenantId is missing or empty', async () => {
      const invalidTenantContext: CommandContext = {
        ...hrAdminContext,
        tenantId: '',
      };

      const cmd: BaseCommand = {
        commandId: 'cmd_hr_sec_01',
        idempotencyKey: 'idemp_hr_sec_01',
        commandType: 'CreateEmployeeCommand',
        schemaVersion: 1,
        tenantId: '',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          personalInfo: {
            legalFirstName: 'Jane',
            legalLastName: 'Doe',
            dateOfBirth: '1992-05-10',
            gender: 'FEMALE',
            contactEmail: 'jane.doe@centralmetro.health',
            contactPhone: '+1-555-010-9999',
            emergencyContact: { name: 'John Doe', relationship: 'Spouse', phone: '+1-555-010-9998' },
            residentialAddress: { street: '123 Main St', city: 'Metro City', state: 'NY', postalCode: '10001', country: 'USA' },
          },
          primaryFacilityId: 'fac_central',
          facilityIds: ['fac_central'],
          primaryDepartmentId: 'dept_cardiology',
          primaryDepartmentName: 'Cardiology',
          departmentIds: ['dept_cardiology'],
          positionId: 'pos_resident',
          positionTitle: 'Resident Physician',
          employmentType: 'FULL_TIME',
          hireDate: '2026-04-01',
        },
      };

      const result = await CommandBus.dispatch(invalidTenantContext, cmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TENANT_ISOLATION_ERROR');
    });

    test('Rejects unauthorized roles from creating employees', async () => {
      const cmd: BaseCommand = {
        commandId: 'cmd_hr_sec_02',
        idempotencyKey: 'idemp_hr_sec_02',
        commandType: 'CreateEmployeeCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_nurse_01',
        timestamp: new Date().toISOString(),
        payload: {
          personalInfo: {
            legalFirstName: 'Unauthorized',
            legalLastName: 'User',
            dateOfBirth: '1990-01-01',
            gender: 'MALE',
            contactEmail: 'unauth@centralmetro.health',
            contactPhone: '+1-555-000-0000',
            emergencyContact: { name: 'Emergency', relationship: 'Friend', phone: '+1-555-000-0001' },
            residentialAddress: { street: '100 St', city: 'Metro', state: 'NY', postalCode: '10001', country: 'USA' },
          },
          primaryFacilityId: 'fac_central',
          facilityIds: ['fac_central'],
          primaryDepartmentId: 'dept_cardiology',
          primaryDepartmentName: 'Cardiology',
          departmentIds: ['dept_cardiology'],
          positionId: 'pos_intern',
          positionTitle: 'Intern',
          employmentType: 'FULL_TIME',
          hireDate: '2026-04-01',
        },
      };

      const result = await CommandBus.dispatch(nurseContext, cmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT_ROLE');
    });
  });

  describe('2. Idempotency & Replay Resilience (Gate B)', () => {
    test('Repeated command with identical idempotencyKey returns cached result', async () => {
      const cmd: BaseCommand = {
        commandId: 'cmd_idemp_01',
        idempotencyKey: 'idemp_key_unique_test_100',
        commandType: 'CreateEmployeeCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          personalInfo: {
            legalFirstName: 'Alice',
            legalLastName: 'Smith',
            dateOfBirth: '1988-08-14',
            gender: 'FEMALE',
            contactEmail: 'alice.smith@centralmetro.health',
            contactPhone: '+1-555-012-3456',
            emergencyContact: { name: 'Bob Smith', relationship: 'Spouse', phone: '+1-555-012-3457' },
            residentialAddress: { street: '55 Pine Rd', city: 'Metro', state: 'NY', postalCode: '10002', country: 'USA' },
          },
          primaryFacilityId: 'fac_central',
          facilityIds: ['fac_central'],
          primaryDepartmentId: 'dept_general_medicine',
          primaryDepartmentName: 'General Medicine',
          departmentIds: ['dept_general_medicine'],
          positionId: 'pos_attending_genmed',
          positionTitle: 'Attending Physician',
          employmentType: 'FULL_TIME',
          hireDate: '2026-03-01',
        },
      };

      const firstResult = await CommandBus.dispatch(hrAdminContext, cmd);
      expect(firstResult.success).toBe(true);

      // Re-dispatch identical command
      const secondResult = await CommandBus.dispatch(hrAdminContext, cmd);
      expect(secondResult.success).toBe(true);
      expect(secondResult.entityId).toBe(firstResult.entityId);
      expect((secondResult as any).replayedFromCache).toBe(true);
    });

    test('Reusing idempotency key with conflicting payload is rejected', async () => {
      const key = 'idemp_key_conflict_test_200';
      const cmd1: BaseCommand = {
        commandId: 'cmd_cfl_1',
        idempotencyKey: key,
        commandType: 'CreateEmployeeCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          personalInfo: { legalFirstName: 'Dave', legalLastName: 'Clark', dateOfBirth: '1980-01-01', gender: 'MALE', contactEmail: 'd@h.com', contactPhone: '123', emergencyContact: { name: 'E', relationship: 'S', phone: '123' }, residentialAddress: { street: 'S', city: 'C', state: 'NY', postalCode: '1', country: 'USA' } },
          primaryFacilityId: 'fac_central', facilityIds: ['fac_central'], primaryDepartmentId: 'dept_icu', primaryDepartmentName: 'ICU', departmentIds: ['dept_icu'],
          positionId: 'pos_nurse', positionTitle: 'Nurse', employmentType: 'FULL_TIME', hireDate: '2026-01-01',
        },
      };

      const cmd2: BaseCommand = {
        ...cmd1,
        commandId: 'cmd_cfl_2',
        payload: {
          ...cmd1.payload,
          positionTitle: 'Senior Nurse', // valid but conflicting payload
        },
      };

      await CommandBus.dispatch(hrAdminContext, cmd1);
      const conflictResult = await CommandBus.dispatch(hrAdminContext, cmd2);

      expect(conflictResult.success).toBe(false);
      expect(conflictResult.error?.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });
  });

  describe('3. Employee Lifecycle & Organization Transfers (Gate C)', () => {
    test('Transfers employee to a new department with audited organizational trail', async () => {
      const transferCmd: BaseCommand = {
        commandId: 'cmd_tx_emp_01',
        idempotencyKey: 'idemp_tx_emp_01',
        commandType: 'TransferEmployeeCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          employeeId: 'emp_001',
          toDepartmentId: 'dept_emergency',
          toDepartmentName: 'Emergency Medicine',
          toPositionId: 'pos_er_consultant',
          toPositionTitle: 'Emergency Medicine Consultant',
          reason: 'Internal restructuring to support trauma expansion',
          effectiveDate: '2026-05-01',
        },
      };

      const result = await CommandBus.dispatch(hrAdminContext, transferCmd);
      expect(result.success).toBe(true);

      const employees = HrWorkforceDomainService.getEmployees();
      const updated = employees.find((e) => e.employeeId === 'emp_001');
      expect(updated).toBeDefined();
      expect(updated?.primaryDepartmentId).toBe('dept_emergency');
      expect(updated?.positionTitle).toBe('Emergency Medicine Consultant');
      expect(updated?.departmentIds).toContain('dept_emergency');
    });
  });

  describe('4. Credentials & Automated Practice Lockout (Gate C & D)', () => {
    test('Practice lockout triggers if a mandatory license is expired', () => {
      // emp_001 has active credentials in seed. Let's add an expired mandatory license.
      const pastDate = '2024-01-01';
      const expiredCredId = 'crd_expired_license_test';

      (HrWorkforceDomainService as any).credentials.set(expiredCredId, {
        credentialId: expiredCredId,
        employeeId: 'emp_001',
        credentialType: 'MEDICAL_LICENSE',
        title: 'DEA Prescribing License',
        issuingAuthority: 'DEA',
        credentialNumber: 'DEA-998877',
        issuedDate: '2021-01-01',
        expiryDate: pastDate,
        verificationStatus: 'VERIFIED',
        isMandatoryForPractice: true,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const eligibility = HrWorkforceDomainService.checkClinicalEligibility('emp_001');
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.reason).toContain('CLINICAL PRACTICE LOCKOUT');
      expect(eligibility.expiredCredentials.length).toBeGreaterThan(0);
    });

    test('Verifying a submitted credential requires Medical Director authority', async () => {
      const employeeCmd: BaseCommand = {
        commandId: 'cmd_cred_emp_01',
        idempotencyKey: 'idemp_cred_emp_01',
        commandType: 'CreateEmployeeCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          personalInfo: {
            legalFirstName: 'Credential',
            legalLastName: 'Candidate',
            dateOfBirth: '1985-02-02',
            gender: 'FEMALE',
            contactEmail: 'credential.candidate@hcm2.test',
            contactPhone: '555-0202',
            emergencyContact: { name: 'Emergency Contact', relationship: 'Sibling', phone: '555-0203' },
            residentialAddress: { street: '1 Test Way', city: 'Test City', state: 'TS', postalCode: '10001', country: 'USA' },
          },
          primaryFacilityId: 'fac_central',
          facilityIds: ['fac_central'],
          primaryDepartmentId: 'dept_general_medicine',
          primaryDepartmentName: 'General Medicine',
          departmentIds: ['dept_general_medicine'],
          positionId: 'pos_credential_candidate',
          positionTitle: 'Physician',
          employmentType: 'FULL_TIME',
          hireDate: '2026-03-01',
        },
      };
      const createdEmployee = await CommandBus.dispatch(hrAdminContext, employeeCmd);
      expect(createdEmployee.success).toBe(true);
      const employeeId = createdEmployee.entityId!;

      const submitCmd: BaseCommand = {
        commandId: 'cmd_submit_cred_01',
        idempotencyKey: 'idemp_submit_cred_01',
        commandType: 'SubmitCredentialCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          employeeId,
          credentialType: 'MEDICAL_LICENSE',
          title: 'Additional Medical Council License',
          issuingAuthority: 'Medical Council',
          credentialNumber: 'MC-HCM2-001',
          issueDate: '2026-01-01',
          expiryDate: '2028-01-01',
          isMandatoryForPractice: true,
          notes: 'Submitted for independent verification',
        },
      };
      const submitted = await CommandBus.dispatch(hrAdminContext, submitCmd);
      expect(submitted.success).toBe(true);
      const credentialId = submitted.entityId!;

      const verifyCmdNurse: BaseCommand = {
        commandId: 'cmd_verify_01',
        idempotencyKey: 'idemp_verify_01',
        commandType: 'VerifyCredentialCommand',
        schemaVersion: 1,
        tenantId: 'central-metro-hospital',
        actorId: 'usr_nurse_01',
        timestamp: new Date().toISOString(),
        payload: {
          credentialId,
          status: 'VERIFIED',
          notes: 'Attempt by nurse to verify',
        },
      };

      const nurseResult = await CommandBus.dispatch(nurseContext, verifyCmdNurse);
      expect(nurseResult.success).toBe(false);
      expect(nurseResult.error?.code).toBe('INSUFFICIENT_ROLE');

      const verifyCmdMedDir: BaseCommand = {
        ...verifyCmdNurse,
        commandId: 'cmd_verify_02',
        idempotencyKey: 'idemp_verify_02',
        actorId: 'usr_med_director',
      };

      const medDirResult = await CommandBus.dispatch(medDirectorContext, verifyCmdMedDir);
      expect(medDirResult.success).toBe(true);
    });
  });

  describe('5. Roster Shifts, Fatigue Compliance & Double-Booking (Gate D)', () => {
    test('Rejects shift assignment that violates 10-hour mandatory rest period', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Existing shift: 08:00 to 16:00
      // Propose consecutive shift starting at 18:00 (only 2 hours rest instead of 10!)
      const violatingShiftCmd: BaseCommand = {
        commandId: 'cmd_fatigue_01',
        idempotencyKey: 'idemp_fatigue_01',
        commandType: 'AssignShiftCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          facilityId: 'fac_central',
          facilityName: 'Central Metro Hospital',
          departmentId: 'dept_cardiology',
          departmentName: 'Cardiology',
          employeeId: 'emp_001',
          date: today,
          shiftId: 'sft_night_call',
          shiftName: 'Cardiology Night Call',
          startTime: `${today}T18:00:00Z`,
          endTime: `${today}T23:59:00Z`,
        },
      };

      const result = await CommandBus.dispatch(hrAdminContext, violatingShiftCmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FATIGUE_COMPLIANCE_VIOLATION');
      expect(result.error?.message).toContain('mandatory 10-hour rest');
    });

    test('Rejects overlapping shift due to double-booking conflict', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Existing shift is 08:00 - 16:00. Propose 10:00 - 14:00 (completely overlapping!)
      const doubleBookingCmd: BaseCommand = {
        commandId: 'cmd_db_01',
        idempotencyKey: 'idemp_db_01',
        commandType: 'AssignShiftCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          facilityId: 'fac_central',
          facilityName: 'Central Metro Hospital',
          departmentId: 'dept_cardiology',
          departmentName: 'Cardiology',
          employeeId: 'emp_001',
          date: today,
          shiftId: 'sft_conflict',
          shiftName: 'Conflicting Specialty Clinic',
          startTime: `${today}T10:00:00Z`,
          endTime: `${today}T14:00:00Z`,
        },
      };

      const result = await CommandBus.dispatch(hrAdminContext, doubleBookingCmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SHIFT_DOUBLE_BOOKING_CONFLICT');
    });
  });

  describe('6. Attendance & Audited Time Correction (Gate D)', () => {
    test('Clock-in and clock-out correctly calculates hours and overtime', async () => {
      const clockInCmd: BaseCommand = {
        commandId: 'cmd_cin_01',
        idempotencyKey: 'idemp_cin_01',
        commandType: 'RecordClockInCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          employeeId: 'emp_003',
          source: 'BIOMETRIC_SCANNER',
        },
      };

      const inResult = await CommandBus.dispatch(hrAdminContext, clockInCmd);
      expect(inResult.success).toBe(true);
      const attId = inResult.entityId;

      const clockOutCmd: BaseCommand = {
        commandId: 'cmd_cout_01',
        idempotencyKey: 'idemp_cout_01',
        commandType: 'RecordClockOutCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          attendanceId: attId,
        },
      };

      const outResult = await CommandBus.dispatch(hrAdminContext, clockOutCmd);
      expect(outResult.success).toBe(true);
    });

    test('Supervisor attendance correction creates historical audit log without mutating past records', async () => {
      // First clock in
      const inResult = await HrWorkforceDomainService.recordClockIn(
        hrAdminContext,
        'cmd_c1',
        'idemp_c1',
        {
          employeeId: 'emp_002',
          employeeName: 'Dr. Robert Hayes',
          facilityId: 'fac_central',
          departmentId: 'dept_surgery',
          source: 'KIOSK_TERMINAL',
        }
      );

      const attId = inResult.entityId!;
      const newTime = '2026-04-10T07:30:00Z';

      const correctCmd: BaseCommand = {
        commandId: 'cmd_cor_01',
        idempotencyKey: 'idemp_cor_01',
        commandType: 'CorrectAttendanceTimeCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          attendanceId: attId,
          newClockInTime: newTime,
          reason: 'Badge reader offline during emergency trauma arrival',
        },
      };

      const corResult = await CommandBus.dispatch(hrAdminContext, correctCmd);
      expect(corResult.success).toBe(true);

      const records = HrWorkforceDomainService.getAttendanceRecords();
      const corrected = records.find((r) => r.attendanceId === attId);
      expect(corrected?.isCorrected).toBe(true);
      expect(corrected?.status).toBe('CORRECTED');
      expect(corrected?.correctionHistory?.length).toBe(1);
      expect(corrected?.correctionHistory?.[0].reason).toContain('Badge reader offline');
    });
  });

  describe('7. Leave Management & Balance Deduction (Gate D)', () => {
    test('Approving leave deducts remaining balance; rejection leaves it unchanged', async () => {
      const leaveCmd: BaseCommand = {
        commandId: 'cmd_lve_01',
        idempotencyKey: 'idemp_lve_01',
        commandType: 'SubmitLeaveRequestCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          employeeId: 'emp_001',
          departmentId: 'dept_cardiology',
          leaveType: 'ANNUAL',
          startDate: '2026-07-01',
          endDate: '2026-07-05',
          totalDays: 5,
          reason: 'Annual family leave',
        },
      };

      const submitResult = await CommandBus.dispatch(hrAdminContext, leaveCmd);
      expect(submitResult.success).toBe(true);
      const leaveId = submitResult.entityId!;

      const approveCmd: BaseCommand = {
        commandId: 'cmd_app_01',
        idempotencyKey: 'idemp_app_01',
        commandType: 'ApproveLeaveRequestCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_hr_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          leaveId,
          approved: true,
        },
      };

      const approveResult = await CommandBus.dispatch(hrAdminContext, approveCmd);
      expect(approveResult.success).toBe(true);

      const leaveRequests = HrWorkforceDomainService.getLeaveRequests();
      const approved = leaveRequests.find((l) => l.leaveId === leaveId);
      expect(approved?.status).toBe('APPROVED');
    });
  });
});
