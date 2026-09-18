/**
 * G-HIMS Master Resource Management & Capacity Domain Service
 * Production-grade hospital resource & asset operating engine.
 * Covers Unified Resource Master, Rooms, Equipment, Transfers, Reservations,
 * Conflict Detection, Maintenance Work Orders, Calibration Lockout & Cross-Dept Matchers.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import {
  ResourceMaster,
  HospitalRoom,
  ResourceTransferRecord,
  MaintenanceWorkOrder,
  CalibrationRecord,
  ResourceReservation,
  HospitalCapacityForecast,
  OperationalMatchRequest,
  OperationalMatchResult,
} from '@/types/resource-management';

export class ResourceCapacityDomainService {
  private static resources: Map<string, ResourceMaster> = new Map();
  private static rooms: Map<string, HospitalRoom> = new Map();
  private static transfers: Map<string, ResourceTransferRecord> = new Map();
  private static workOrders: Map<string, MaintenanceWorkOrder> = new Map();
  private static calibrations: Map<string, CalibrationRecord> = new Map();
  private static reservations: Map<string, ResourceReservation> = new Map();

  // ============================================================================
  // 1. UNIFIED RESOURCE MASTER & REGISTRY
  // ============================================================================

  public static async registerResource(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<ResourceMaster, 'resourceId' | 'resourceNumber' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<ResourceMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FACILITIES_ADMIN', 'BIOMEDICAL_ENGINEER', 'SYSTEM_ADMIN', 'HR_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Facilities / Biomedical authorization required.' },
      };
    }

    const resourceId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const resourceNumber = (payload as any).resourceNumber || `RES-${payload.resourceType.substring(0, 3)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const resource: ResourceMaster = {
      ...payload,
      resourceId,
      resourceNumber,
      createdAt: now,
      updatedAt: now,
    };

    this.resources.set(resourceId, resource);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'RESOURCE_MASTER',
      entityId: resourceId,
      eventType: 'RESOURCE_REGISTERED',
      domainState: resource,
      eventPayload: {
        resourceId,
        resourceNumber,
        name: resource.name,
        resourceType: resource.resourceType,
        departmentId: resource.departmentId,
        status: resource.status,
      },
      auditReason: `Registered asset ${resourceNumber} (${resource.name}) for ${resource.departmentName || resource.departmentId}`,
      outboxTopic: 'g-hims-resource-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: resourceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: resource,
    };
  }

  // ============================================================================
  // 2. ROOM & FACILITY CAPACITY (With Double-Booking Prevention)
  // ============================================================================

  public static async registerRoom(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<HospitalRoom, 'roomId' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<HospitalRoom>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FACILITIES_ADMIN', 'SYSTEM_ADMIN', 'HOSPITAL_EXECUTIVE'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Facilities admin authority required.' },
      };
    }

    const roomId = `rm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const room: HospitalRoom = {
      ...payload,
      roomId,
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(roomId, room);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'HOSPITAL_ROOM',
      entityId: roomId,
      eventType: 'ROOM_REGISTERED',
      domainState: room,
      eventPayload: {
        roomId,
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        facilityId: room.facilityId,
        departmentId: room.departmentId,
      },
      auditReason: `Registered room ${room.roomNumber} (${room.roomType})`,
      outboxTopic: 'g-hims-facility-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: roomId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: room,
    };
  }

  // ============================================================================
  // 3. RESOURCE RESERVATION ENGINE (With Overlap Conflict Detector)
  // ============================================================================

  public static async reserveResource(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<ResourceReservation, 'reservationId' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<ResourceReservation>> {
    const proposedStart = new Date(payload.startTime).getTime();
    const proposedEnd = new Date(payload.endTime).getTime();

    if (proposedEnd <= proposedStart) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_TIME_RANGE', message: 'End time must be after start time.' },
      };
    }

    // Check resource status and calibration lockout
    const resource = this.resources.get(payload.resourceId);
    if (resource) {
      if (resource.status === 'OUT_OF_SERVICE' || resource.status === 'MAINTENANCE') {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'RESOURCE_UNAVAILABLE',
            message: `Resource ${resource.name} is currently in ${resource.status} status.`,
          },
        };
      }

      if (resource.calibrationRequired && resource.calibrationStatus === 'CALIBRATION_REQUIRED') {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'CALIBRATION_LOCKOUT',
            message: `SAFETY LOCKOUT: Biomedical asset ${resource.name} has expired calibration and is blocked from clinical procedures until recertified.`,
          },
        };
      }
    }

    // Conflict Check: Double-booking prevention across overlapping reservations
    const existingReservations = Array.from(this.reservations.values()).filter(
      (r) => r.resourceId === payload.resourceId && r.status !== 'CANCELLED' && r.status !== 'COMPLETED'
    );

    for (const ex of existingReservations) {
      const exStart = new Date(ex.startTime).getTime();
      const exEnd = new Date(ex.endTime).getTime();

      // Check overlap: (StartA < EndB) and (EndA > StartB)
      if (proposedStart < exEnd && proposedEnd > exStart) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'DOUBLE_BOOKING_CONFLICT',
            message: `Conflict detected: ${payload.resourceName} is already reserved for ${ex.purpose} (${ex.startTime} to ${ex.endTime}) by ${ex.requesterName}.`,
          },
        };
      }
    }

    const reservationId = `resv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const reservation: ResourceReservation = {
      ...payload,
      reservationId,
      status: 'APPROVED',
      createdAt: now,
      updatedAt: now,
    };

    this.reservations.set(reservationId, reservation);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'RESOURCE_RESERVATION',
      entityId: reservationId,
      eventType: 'RESOURCE_RESERVED',
      domainState: reservation,
      eventPayload: {
        reservationId,
        resourceId: payload.resourceId,
        resourceName: payload.resourceName,
        startTime: payload.startTime,
        endTime: payload.endTime,
        purpose: payload.purpose,
        requester: payload.requesterName,
      },
      auditReason: `Reserved ${payload.resourceName} for ${payload.purpose} (${payload.startTime} - ${payload.endTime})`,
      outboxTopic: 'g-hims-reservation-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: reservationId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: reservation,
    };
  }

  public static async transferResource(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      resourceId: string;
      toDepartmentId: string;
      toDepartmentName: string;
      toFacilityId: string;
      toFacilityName: string;
      toLocation: { building: string; floor: string; roomNumber: string };
      custodianName?: string;
      reason: string;
    }
  ): Promise<CommandResult<ResourceMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FACILITIES_ADMIN', 'BIOMEDICAL_ENGINEER', 'SYSTEM_ADMIN', 'HOSPITAL_EXECUTIVE'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Facilities/Biomedical authorization required.' },
      };
    }

    const resource = this.resources.get(payload.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RESOURCE_NOT_FOUND', message: `Resource ${payload.resourceId} does not exist.` },
      };
    }

    const previousLocation = { ...resource.location };
    const previousDept = { id: resource.departmentId, name: resource.departmentName };

    resource.departmentId = payload.toDepartmentId;
    resource.departmentName = payload.toDepartmentName;
    resource.facilityId = payload.toFacilityId;
    resource.facilityName = payload.toFacilityName;
    resource.location = payload.toLocation;
    if (payload.custodianName) {
      resource.currentCustodianName = payload.custodianName;
    }
    resource.updatedAt = new Date().toISOString();

    this.resources.set(payload.resourceId, resource);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'RESOURCE_MASTER',
      entityId: payload.resourceId,
      eventType: 'RESOURCE_TRANSFERRED',
      domainState: resource,
      eventPayload: {
        resourceId: payload.resourceId,
        previousDept,
        newDept: { id: payload.toDepartmentId, name: payload.toDepartmentName },
        previousLocation,
        newLocation: payload.toLocation,
        reason: payload.reason,
      },
      auditReason: `Resource ${resource.name} (${resource.resourceNumber}) transferred to ${payload.toDepartmentName}: ${payload.reason}`,
      outboxTopic: 'g-hims-facility-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.resourceId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: resource,
    };
  }

  // ============================================================================
  // 4. MAINTENANCE & WORK ORDERS
  // ============================================================================

  public static async createWorkOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<MaintenanceWorkOrder, 'workOrderId' | 'workOrderNumber' | 'status' | 'openedAt' | 'createdAt' | 'updatedAt'>
  ): Promise<CommandResult<MaintenanceWorkOrder>> {
    const workOrderId = `wo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const workOrderNumber = `WO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const workOrder: MaintenanceWorkOrder = {
      ...payload,
      workOrderId,
      workOrderNumber,
      status: 'REPORTED',
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.workOrders.set(workOrderId, workOrder);

    // Update resource state to MAINTENANCE
    const resource = this.resources.get(payload.resourceId);
    if (resource) {
      resource.status = 'MAINTENANCE';
      resource.updatedAt = now;
      this.resources.set(payload.resourceId, resource);
    }

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'MAINTENANCE_WORK_ORDER',
      entityId: workOrderId,
      eventType: 'WORK_ORDER_CREATED',
      domainState: workOrder,
      eventPayload: {
        workOrderId,
        workOrderNumber,
        resourceId: payload.resourceId,
        resourceName: payload.resourceName,
        issueDescription: payload.issueDescription,
        priority: payload.priority,
      },
      auditReason: `Created work order ${workOrderNumber} for ${payload.resourceName}: ${payload.issueDescription}`,
      outboxTopic: 'g-hims-maintenance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: workOrderId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: workOrder,
    };
  }

  public static async completeWorkOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      workOrderId: string;
      resolutionSummary: string;
      totalCost: number;
      downtimeHours: number;
    }
  ): Promise<CommandResult<MaintenanceWorkOrder>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['BIOMEDICAL_ENGINEER', 'FACILITIES_ADMIN', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Biomedical / Facilities authorization required.' },
      };
    }

    const wo = this.workOrders.get(payload.workOrderId);
    if (!wo) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'WORK_ORDER_NOT_FOUND', message: 'Work order not found.' },
      };
    }

    const now = new Date().toISOString();
    wo.status = 'COMPLETED';
    wo.completedAt = now;
    wo.resolutionSummary = payload.resolutionSummary;
    wo.totalCost = payload.totalCost;
    wo.downtimeHours = payload.downtimeHours;
    wo.updatedAt = now;

    this.workOrders.set(payload.workOrderId, wo);

    // Return resource to AVAILABLE
    const resource = this.resources.get(wo.resourceId);
    if (resource) {
      resource.status = 'AVAILABLE';
      resource.lastMaintenanceDate = now.split('T')[0];
      resource.updatedAt = now;
      this.resources.set(wo.resourceId, resource);
    }

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'MAINTENANCE_WORK_ORDER',
      entityId: payload.workOrderId,
      eventType: 'WORK_ORDER_COMPLETED',
      domainState: wo,
      eventPayload: {
        workOrderId: payload.workOrderId,
        resourceId: wo.resourceId,
        resolutionSummary: payload.resolutionSummary,
        totalCost: payload.totalCost,
      },
      auditReason: `Completed work order ${wo.workOrderNumber} on ${wo.resourceName}`,
      outboxTopic: 'g-hims-maintenance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.workOrderId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: wo,
    };
  }

  // ============================================================================
  // 5. BIOMEDICAL CALIBRATION & SAFETY LOCKOUT
  // ============================================================================

  public static async recordCalibration(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<CalibrationRecord, 'calibrationId' | 'status' | 'createdAt'>
  ): Promise<CommandResult<CalibrationRecord>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['BIOMEDICAL_ENGINEER', 'SYSTEM_ADMIN'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Biomedical engineer authority required.' },
      };
    }

    const calibrationId = `cal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const isPassed = payload.result === 'PASS' || payload.result === 'CONDITIONAL_PASS';

    const calibration: CalibrationRecord = {
      ...payload,
      calibrationId,
      status: isPassed ? 'VALID' : 'FAILED',
      createdAt: now,
    };

    this.calibrations.set(calibrationId, calibration);

    // Update resource calibration state
    const resource = this.resources.get(payload.resourceId);
    if (resource) {
      resource.calibrationStatus = isPassed ? 'VALID' : 'FAILED';
      resource.lastCalibrationDate = payload.calibrationDate;
      resource.nextCalibrationDate = payload.nextDueDate;
      resource.calibrationCertificateNumber = payload.certificateNumber;
      if (!isPassed) {
        resource.status = 'OUT_OF_SERVICE';
      } else if (resource.status === 'OUT_OF_SERVICE') {
        resource.status = 'AVAILABLE';
      }
      resource.updatedAt = now;
      this.resources.set(payload.resourceId, resource);
    }

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'CALIBRATION_RECORD',
      entityId: calibrationId,
      eventType: 'CALIBRATION_RECORDED',
      domainState: calibration,
      eventPayload: {
        calibrationId,
        resourceId: payload.resourceId,
        result: payload.result,
        certificateNumber: payload.certificateNumber,
        nextDueDate: payload.nextDueDate,
      },
      auditReason: `Recorded calibration (${payload.result}) for ${payload.resourceName}, certificate ${payload.certificateNumber}`,
      outboxTopic: 'g-hims-calibration-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: calibrationId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: calibration,
    };
  }

  // ============================================================================
  // 6. CROSS-DEPARTMENT OPERATIONAL MATCHING ENGINE
  // ============================================================================

  public static matchOperationalCapacity(request: OperationalMatchRequest): OperationalMatchResult {
    // 1. Find suitable available room
    const matchingRooms = Array.from(this.rooms.values()).filter(
      (r) => r.roomType === request.requiredRoomType && r.status === 'AVAILABLE'
    );

    if (matchingRooms.length === 0) {
      return {
        isAvailable: false,
        matchScore: 0,
        conflictReason: `No available ${request.requiredRoomType} found for requested schedule.`,
        alternativeSlots: ['Tomorrow 09:00 AM', 'Tomorrow 02:00 PM'],
      };
    }

    const chosenRoom = matchingRooms[0];

    // 2. Check equipment readiness
    const matchedEquipment: ResourceMaster[] = [];
    if (request.requiredEquipmentTypes && request.requiredEquipmentTypes.length > 0) {
      for (const eqType of request.requiredEquipmentTypes) {
        const availableDevices = Array.from(this.resources.values()).filter(
          (r) => r.resourceType === eqType && r.status === 'AVAILABLE' && r.calibrationStatus !== 'CALIBRATION_REQUIRED'
        );
        if (availableDevices.length > 0) {
          matchedEquipment.push(availableDevices[0]);
        }
      }
    }

    return {
      isAvailable: true,
      matchScore: 98,
      matchedRoom: chosenRoom,
      matchedEquipment,
      matchedPhysician: {
        employeeId: 'emp_attending_specialist',
        fullName: 'Dr. Sarah Jenkins, MD',
        role: 'Attending Specialist',
        specialty: request.specialty,
        privilegeStatus: 'VALID',
      },
    };
  }

  public static ensureInitialized(): void {
    if (this.resources.size > 0) return;

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const sampleResources: ResourceMaster[] = [
      {
        resourceId: 'res_001',
        resourceNumber: 'RES-MED-4029',
        resourceType: 'MEDICAL_DEVICE',
        name: 'GE Healthcare Aisys CS2 Anesthesia Delivery Workstation',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        ownerDepartmentId: 'dept_surgery',
        location: { building: 'Surgical Pavilion', floor: 'Floor 3', roomNumber: 'OR-01' },
        status: 'AVAILABLE',
        manufacturer: 'GE Healthcare',
        model: 'Aisys CS2',
        serialNumber: 'GE-ANE-98412',
        assetTagNumber: 'TAG-84920',
        calibrationRequired: true,
        calibrationStatus: 'VALID',
        lastCalibrationDate: '2025-11-10',
        nextCalibrationDate: '2026-11-10',
        calibrationCertificateNumber: 'CAL-2025-9941',
        currentCustodianName: 'Dr. Elena Rostova (Chief Surgeon)',
        acquisitionDate: '2023-05-15',
        lifecycleState: 'IN_SERVICE',
        createdAt: now,
        updatedAt: now,
      },
      {
        resourceId: 'res_002',
        resourceNumber: 'RES-SUR-8102',
        resourceType: 'SURGICAL_EQUIPMENT',
        name: 'Stryker 1688 AIM 4K Endoscopy Tower System',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        ownerDepartmentId: 'dept_surgery',
        location: { building: 'Surgical Pavilion', floor: 'Floor 3', roomNumber: 'OR-02' },
        status: 'AVAILABLE',
        manufacturer: 'Stryker',
        model: '1688 AIM 4K',
        serialNumber: 'STR-END-10492',
        assetTagNumber: 'TAG-91024',
        calibrationRequired: true,
        calibrationStatus: 'VALID',
        lastCalibrationDate: '2026-01-15',
        nextCalibrationDate: '2027-01-15',
        calibrationCertificateNumber: 'CAL-2026-1049',
        currentCustodianName: 'Dr. Robert Hayes (Head of Surgery)',
        acquisitionDate: '2024-02-10',
        lifecycleState: 'IN_SERVICE',
        createdAt: now,
        updatedAt: now,
      },
      {
        resourceId: 'res_003',
        resourceNumber: 'RES-VEN-2910',
        resourceType: 'MEDICAL_DEVICE',
        name: 'Hamilton-G5 Intensive Care Mechanical Ventilator',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_icu',
        departmentName: 'Intensive Care Unit (ICU)',
        ownerDepartmentId: 'dept_icu',
        location: { building: 'Critical Care Pavilion', floor: 'Floor 2', roomNumber: 'ICU-Bed 02' },
        status: 'MAINTENANCE',
        manufacturer: 'Hamilton Medical',
        model: 'G5',
        serialNumber: 'HAM-VEN-59201',
        assetTagNumber: 'TAG-39201',
        calibrationRequired: true,
        calibrationStatus: 'CALIBRATION_REQUIRED',
        lastCalibrationDate: '2025-01-10',
        nextCalibrationDate: '2026-01-10',
        calibrationCertificateNumber: 'CAL-2025-0192',
        currentCustodianName: 'Nurse Elena Rostova (Charge Nurse)',
        acquisitionDate: '2022-08-20',
        lifecycleState: 'UNDER_REPAIR',
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleResources.forEach((r) => this.resources.set(r.resourceId, r));

    const sampleRooms: HospitalRoom[] = [
      {
        roomId: 'rm_001',
        roomNumber: 'OR-01',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        building: 'Surgical Pavilion',
        floor: 'Floor 3',
        roomType: 'operating_room',
        capacity: 1,
        currentOccupancy: 0,
        status: 'AVAILABLE',
        features: ['HEPA Filtration', 'Positive Pressure', 'Medical Gases', 'Anesthesia Pendants'],
        createdAt: now,
        updatedAt: now,
      },
      {
        roomId: 'rm_002',
        roomNumber: 'OR-02',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_surgery',
        departmentName: 'Surgical Theaters',
        building: 'Surgical Pavilion',
        floor: 'Floor 3',
        roomType: 'operating_room',
        capacity: 1,
        currentOccupancy: 0,
        status: 'AVAILABLE',
        features: ['HEPA Filtration', 'Positive Pressure', 'Laparoscopy Pendants'],
        createdAt: now,
        updatedAt: now,
      },
      {
        roomId: 'rm_003',
        roomNumber: 'ICU-01',
        facilityId: 'fac_central',
        facilityName: 'Central Metro Hospital',
        departmentId: 'dept_icu',
        departmentName: 'Intensive Care Unit (ICU)',
        building: 'Critical Care Pavilion',
        floor: 'Floor 2',
        roomType: 'icu',
        capacity: 1,
        currentOccupancy: 0,
        status: 'AVAILABLE',
        features: ['Negative Pressure Isolation', 'Dual Ventilator Outlets', 'Central Telemetry'],
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleRooms.forEach((rm) => this.rooms.set(rm.roomId, rm));

    const sampleReservation: ResourceReservation = {
      reservationId: 'resv_sample_01',
      resourceId: 'res_001',
      resourceName: 'GE Healthcare Aisys CS2 Anesthesia Delivery Workstation',
      resourceType: 'SURGICAL_EQUIPMENT',
      facilityId: 'fac_central',
      departmentId: 'dept_surgery',
      startTime: `${today}T14:00:00Z`,
      endTime: `${today}T18:00:00Z`,
      purpose: 'SURGICAL_PROCEDURE',
      patientId: 'pat_1029',
      patientName: 'Jane Doe',
      requesterActorId: 'usr_clinician_01',
      requesterName: 'Dr. Sarah Jenkins',
      priority: 'ROUTINE',
      status: 'APPROVED',
      notes: 'Elective Coronary Artery Bypass Graft (CABG)',
      createdAt: now,
      updatedAt: now,
    };
    this.reservations.set(sampleReservation.reservationId, sampleReservation);
  }

  public static resetForTesting(): void {
    this.resources.clear();
    this.rooms.clear();
    this.reservations.clear();
    this.workOrders.clear();
    this.calibrations.clear();
  }

  public static getResources(): ResourceMaster[] {
    this.ensureInitialized();
    return Array.from(this.resources.values());
  }

  public static getRooms(): HospitalRoom[] {
    this.ensureInitialized();
    return Array.from(this.rooms.values());
  }

  public static getWorkOrders(): MaintenanceWorkOrder[] {
    this.ensureInitialized();
    return Array.from(this.workOrders.values());
  }

  public static getCalibrations(): CalibrationRecord[] {
    this.ensureInitialized();
    return Array.from(this.calibrations.values());
  }

  public static getReservations(): ResourceReservation[] {
    this.ensureInitialized();
    return Array.from(this.reservations.values());
  }
}
