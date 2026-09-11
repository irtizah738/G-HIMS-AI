/**
 * G-HIMS Master Resource & Capacity Management Test Suite
 * Validates Security, Resource Lifecycle, Reservation Overlaps,
 * Calibration Safety Lockouts, Maintenance Downtime & Operational Matching.
 */

import { CommandBus } from '../lib/backend/commands/command-bus';
import { ResourceCapacityDomainService } from '../lib/backend/services/resource-capacity-domain-service';
import { CommandContext, BaseCommand } from '../lib/backend/types';

describe('G-HIMS Resource & Capacity Management Domain Engine', () => {
  const facilityAdminContext: CommandContext = {
    actorId: 'usr_fac_lead_01',
    tenantId: 'central-metro-hospital',
    roles: ['FACILITIES_ADMIN', 'SYSTEM_ADMIN'],
    permissions: ['ALL_FACILITIES'],
    clinicalPrivileges: [],
    correlationId: 'corr_res_test_1',
    requestId: 'req_res_test_1',
  };

  const biomedicalContext: CommandContext = {
    actorId: 'usr_biomed_01',
    tenantId: 'central-metro-hospital',
    roles: ['BIOMEDICAL_ENGINEER'],
    permissions: ['ALL_BIOMEDICAL'],
    clinicalPrivileges: [],
    correlationId: 'corr_biomed_test_1',
    requestId: 'req_biomed_test_1',
  };

  const clinicianContext: CommandContext = {
    actorId: 'usr_doc_01',
    tenantId: 'central-metro-hospital',
    roles: ['DOCTOR', 'CLINICIAN'],
    permissions: ['CLINICAL_ACCESS'],
    clinicalPrivileges: ['CONSULT', 'PERFORM_GENERAL_SURGERY'],
    correlationId: 'corr_doc_test_1',
    requestId: 'req_doc_test_1',
  };

  beforeEach(() => {
    ResourceCapacityDomainService.resetForTesting();
    ResourceCapacityDomainService.ensureInitialized();
  });

  describe('1. Resource Registration & Role Authorization (Gate E)', () => {
    test('Rejects non-facilities actor from registering biomedical assets', async () => {
      const regCmd: BaseCommand = {
        commandId: 'cmd_reg_01',
        idempotencyKey: 'idemp_reg_01',
        commandType: 'RegisterResourceCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_doc_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceNumber: 'RES-TEST-001',
          resourceType: 'MEDICAL_DEVICE',
          name: 'Infusion Pump',
          facilityId: 'fac_central',
          facilityName: 'Central Metro Hospital',
          departmentId: 'dept_icu',
          departmentName: 'ICU',
          ownerDepartmentId: 'dept_icu',
          location: { building: 'Main', floor: '2', roomNumber: 'ICU-1' },
          status: 'AVAILABLE',
          manufacturer: 'Baxter',
          model: 'Sigma Spectrum',
          serialNumber: 'BAX-84920',
          assetTagNumber: 'TAG-11223',
          calibrationRequired: false,
          calibrationStatus: 'NOT_REQUIRED',
          acquisitionDate: '2025-01-01',
          lifecycleState: 'IN_SERVICE',
        },
      };

      const result = await CommandBus.dispatch(clinicianContext, regCmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INSUFFICIENT_ROLE');
    });

    test('Facilities admin can successfully register new biomedical asset', async () => {
      const regCmd: BaseCommand = {
        commandId: 'cmd_reg_02',
        idempotencyKey: 'idemp_reg_02',
        commandType: 'RegisterResourceCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_fac_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceNumber: 'RES-DEF-9001',
          resourceType: 'MEDICAL_DEVICE',
          name: 'ZOLL R Series ALS Defibrillator',
          facilityId: 'fac_central',
          facilityName: 'Central Metro Hospital',
          departmentId: 'dept_emergency',
          departmentName: 'Emergency Medicine',
          ownerDepartmentId: 'dept_emergency',
          location: { building: 'Pavilion A', floor: '1', roomNumber: 'ER-Crash Cart 1' },
          status: 'AVAILABLE',
          manufacturer: 'ZOLL Medical',
          model: 'R Series',
          serialNumber: 'ZOL-94820',
          assetTagNumber: 'TAG-74920',
          calibrationRequired: true,
          calibrationStatus: 'VALID',
          acquisitionDate: '2025-06-01',
          lifecycleState: 'IN_SERVICE',
        },
      };

      const result = await CommandBus.dispatch(facilityAdminContext, regCmd);
      expect(result.success).toBe(true);
      expect(result.entityId).toBeDefined();

      const resources = ResourceCapacityDomainService.getResources();
      expect(resources.some((r) => r.resourceNumber === 'RES-DEF-9001')).toBe(true);
    });
  });

  describe('2. Double-Booking Overlap Prevention (Gate E)', () => {
    test('Rejects overlapping reservation for same resource during scheduled procedure', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Sample reservation is res_001 from 14:00 to 18:00
      // Propose overlapping reservation: 15:00 to 17:00
      const overlapCmd: BaseCommand = {
        commandId: 'cmd_resv_ovl_01',
        idempotencyKey: 'idemp_resv_ovl_01',
        commandType: 'ReserveResourceCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_doc_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceId: 'res_001',
          resourceName: 'GE Healthcare Aisys CS2 Anesthesia Delivery Workstation',
          resourceType: 'SURGICAL_EQUIPMENT',
          facilityId: 'fac_central',
          departmentId: 'dept_surgery',
          startTime: `${today}T15:00:00Z`,
          endTime: `${today}T17:00:00Z`,
          purpose: 'SURGICAL_PROCEDURE',
          patientId: 'pat_2048',
          patientName: 'Jane Smith',
          requesterActorId: 'usr_doc_01',
          requesterName: 'Dr. Robert Hayes',
          priority: 'URGENT',
          notes: 'Emergency Exploratory Laparotomy',
        },
      };

      const result = await CommandBus.dispatch(clinicianContext, overlapCmd);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DOUBLE_BOOKING_CONFLICT');
      expect(result.error?.message).toContain('Conflict detected');
    });
  });

  describe('3. Biomedical Calibration Safety Lockout (Gate E)', () => {
    test('Blocks clinical reservation of equipment with expired calibration', async () => {
      const today = new Date().toISOString().split('T')[0];

      // res_003 (Hamilton-G5) is in MAINTENANCE and CALIBRATION_REQUIRED in sample seeds
      const resvExpiredCmd: BaseCommand = {
        commandId: 'cmd_resv_lockout_01',
        idempotencyKey: 'idemp_resv_lockout_01',
        commandType: 'ReserveResourceCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_doc_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceId: 'res_003',
          resourceName: 'Hamilton-G5 Intensive Care Mechanical Ventilator',
          resourceType: 'MEDICAL_DEVICE',
          facilityId: 'fac_central',
          departmentId: 'dept_icu',
          startTime: `${today}T19:00:00Z`,
          endTime: `${today}T23:00:00Z`,
          purpose: 'SURGICAL_PROCEDURE',
          requesterActorId: 'usr_doc_01',
          requesterName: 'Dr. Robert Hayes',
          priority: 'STAT_EMERGENCY',
          notes: 'Severe ARDS Mechanical Ventilation',
        },
      };

      const result = await CommandBus.dispatch(clinicianContext, resvExpiredCmd);
      expect(result.success).toBe(false);
      // Either RESOURCE_UNAVAILABLE due to MAINTENANCE or CALIBRATION_LOCKOUT
      expect(['RESOURCE_UNAVAILABLE', 'CALIBRATION_LOCKOUT']).toContain(result.error?.code);
    });

    test('Biomedical engineer recording PASS calibration restores equipment to service', async () => {
      const today = new Date().toISOString().split('T')[0];
      const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const calCmd: BaseCommand = {
        commandId: 'cmd_cal_01',
        idempotencyKey: 'idemp_cal_01',
        commandType: 'RecordCalibrationCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_biomed_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceId: 'res_003',
          resourceName: 'Hamilton-G5 Intensive Care Mechanical Ventilator',
          calibrationDate: today,
          nextDueDate: nextYear,
          performedByActorId: 'usr_biomed_01',
          performedByName: 'Biomedical Engineering Team',
          certificateNumber: 'CAL-CERT-2026-8819',
          result: 'PASS',
          notes: 'Annual transducer and oxygen sensor recalibration complete. Meets factory specs.',
        },
      };

      const result = await CommandBus.dispatch(biomedicalContext, calCmd);
      expect(result.success).toBe(true);

      const resources = ResourceCapacityDomainService.getResources();
      const updated = resources.find((r) => r.resourceId === 'res_003');
      expect(updated?.calibrationStatus).toBe('VALID');
      expect(updated?.calibrationCertificateNumber).toBe('CAL-CERT-2026-8819');
    });
  });

  describe('4. Maintenance Work Orders & Lifecycle (Gate E)', () => {
    test('Creating maintenance work order transitions resource to MAINTENANCE status', async () => {
      const woCmd: BaseCommand = {
        commandId: 'cmd_wo_01',
        idempotencyKey: 'idemp_wo_01',
        commandType: 'CreateMaintenanceWorkOrderCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_fac_lead_01',
        timestamp: new Date().toISOString(),
        payload: {
          resourceId: 'res_002',
          resourceName: 'Stryker 1688 AIM 4K Endoscopy Tower System',
          workOrderType: 'CORRECTIVE',
          priority: 'HIGH',
          issueDescription: 'Fiber optic light cable flickering during laparoscopic cholecystectomy',
          reportedByActorId: 'usr_fac_lead_01',
          reportedByName: 'OR Charge Nurse',
        },
      };

      const result = await CommandBus.dispatch(facilityAdminContext, woCmd);
      expect(result.success).toBe(true);
      const woId = result.entityId!;

      const resources = ResourceCapacityDomainService.getResources();
      const updated = resources.find((r) => r.resourceId === 'res_002');
      expect(updated?.status).toBe('MAINTENANCE');

      // Complete work order
      const completeCmd: BaseCommand = {
        commandId: 'cmd_comp_wo_01',
        idempotencyKey: 'idemp_comp_wo_01',
        commandType: 'CompleteMaintenanceWorkOrderCommand',
        tenantId: 'central-metro-hospital',
        actorId: 'usr_biomed_01',
        timestamp: new Date().toISOString(),
        payload: {
          workOrderId: woId,
          resolutionSummary: 'Replaced fiber optic illumination bundle and calibrated xenon illuminator.',
          totalCost: 125000, // $1,250.00 in minor units
          downtimeHours: 4.5,
        },
      };

      const compResult = await CommandBus.dispatch(biomedicalContext, completeCmd);
      expect(compResult.success).toBe(true);
    });
  });

  describe('5. Cross-Department Operational Capacity Matcher (Gate F)', () => {
    test('Matches available surgical suite, anesthesia workstation, and credentialed surgeon for OT', () => {
      const matchResult = ResourceCapacityDomainService.matchOperationalCapacity({
        serviceType: 'OT_SURGERY',
        specialty: 'Cardiothoracic Surgery',
        scheduledTime: '2026-04-10T14:00:00Z',
        durationMinutes: 180,
        requiredRoomType: 'operating_room',
        requiredPrivileges: ['PERFORM_GENERAL_SURGERY'],
        requiredEquipmentTypes: ['MEDICAL_DEVICE', 'SURGICAL_EQUIPMENT'],
      });

      expect(matchResult.isAvailable).toBe(true);
      expect(matchResult.matchedRoom).toBeDefined();
      expect(matchResult.matchedRoom?.roomType).toBe('operating_room');
      expect(matchResult.matchedEquipment && matchResult.matchedEquipment.length > 0).toBe(true);
      expect(matchResult.matchedPhysician).toBeDefined();
      expect(matchResult.matchScore).toBeGreaterThanOrEqual(90);
    });
  });
});
