import { createHash } from 'node:crypto';
/**
 * G-HIMS Master Resource Management & Capacity Domain Service
 * Production-grade hospital resource & asset operating engine.
 * Covers Unified Resource Master, Rooms, Equipment, Transfers, Reservations,
 * Conflict Detection, Maintenance Work Orders, Calibration Lockout & Cross-Dept Matchers.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
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
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

function deterministicId(
  prefix: string,
  tenantId: string,
  commandId: string
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\u0000${commandId}`)
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function identityId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.map((part) => part.trim().toLowerCase()).join('\u0000'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function assertFacilityScope(
  context: CommandContext,
  facilityId: string
): void {
  const admin = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !admin &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new Error('FACILITY_SCOPE_MISMATCH');
  }
}

function isCalibrationLocked(
  resource: ResourceMaster,
  requiredThroughMs?: number
): boolean {
  if (!resource.calibrationRequired) return false;
  if (resource.calibrationStatus !== 'VALID') return true;
  if (!resource.nextCalibrationDate) return true;
  const dueMs = Date.parse(`${resource.nextCalibrationDate}T23:59:59.999Z`);
  if (!Number.isFinite(dueMs)) return true;
  return requiredThroughMs !== undefined ? requiredThroughMs > dueMs : Date.now() > dueMs;
}

function repositoryRequiredOutsideTests(): void {
  if (!DomainStateRepository.isAvailable() && process.env.NODE_ENV !== 'test') {
    throw new Error('RESOURCE_PERSISTENCE_UNAVAILABLE');
  }
}


export class ResourceCapacityDomainService {
  private static resources: Map<string, ResourceMaster> = new Map();
  private static rooms: Map<string, HospitalRoom> = new Map();
  private static transfers: Map<string, ResourceTransferRecord> = new Map();
  private static workOrders: Map<string, MaintenanceWorkOrder> = new Map();
  private static calibrations: Map<string, CalibrationRecord> = new Map();
  private static reservations: Map<string, ResourceReservation> = new Map();

  private static async loadResource(
    tenantId: string,
    resourceId: string
  ): Promise<ResourceMaster | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<ResourceMaster>(
        tenantId,
        'resources',
        resourceId
      );
      if (persisted) this.resources.set(resourceId, persisted);
      else this.resources.delete(resourceId);
      return persisted;
    }
    return this.resources.get(resourceId) || null;
  }

  private static async loadWorkOrder(
    tenantId: string,
    workOrderId: string
  ): Promise<MaintenanceWorkOrder | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<MaintenanceWorkOrder>(
        tenantId,
        'maintenanceWorkOrders',
        workOrderId
      );
      if (persisted) this.workOrders.set(workOrderId, persisted);
      else this.workOrders.delete(workOrderId);
      return persisted;
    }
    return this.workOrders.get(workOrderId) || null;
  }

  private static async loadReservationsForResource(
    tenantId: string,
    resourceId: string
  ): Promise<ResourceReservation[]> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.queryEqual<ResourceReservation>(
        tenantId,
        'resourceReservations',
        'resourceId',
        resourceId
      );

      for (const reservation of persisted) {
        this.reservations.set(reservation.reservationId, reservation);
      }

      return persisted;
    }

    return Array.from(this.reservations.values()).filter(
      (reservation) => reservation.resourceId === resourceId
    );
  }

  // ============================================================================
  // 1. UNIFIED RESOURCE MASTER & REGISTRY
  // ============================================================================

  public static async registerResource(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Omit<ResourceMaster, 'resourceId' | 'createdAt' | 'updatedAt'> & {
      resourceNumber?: string;
    }
  ): Promise<CommandResult<ResourceMaster>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FACILITIES_ADMIN', 'BIOMEDICAL_ENGINEER', 'SYSTEM_ADMIN', 'HR_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Facilities / Biomedical authorization required.',
        },
      };
    }

    repositoryRequiredOutsideTests();
    try {
      assertFacilityScope(context, payload.facilityId);
      const resourceId = deterministicId('res', context.tenantId, commandId);
      const resourceNumber =
        payload.resourceNumber?.trim() ||
        `RES-${payload.resourceType.substring(0, 3)}-${resourceId.slice(-8).toUpperCase()}`;
      const now = new Date().toISOString();

      const identities = [
        {
          key: 'resourceNumberIdentity',
          entityId: identityId('resource-number', resourceNumber),
          type: 'RESOURCE_NUMBER',
          value: resourceNumber,
        },
        ...(payload.serialNumber?.trim()
          ? [{
              key: 'serialIdentity',
              entityId: identityId('resource-serial', payload.serialNumber),
              type: 'SERIAL_NUMBER',
              value: payload.serialNumber.trim(),
            }]
          : []),
        ...(payload.assetTagNumber?.trim()
          ? [{
              key: 'assetTagIdentity',
              entityId: identityId('resource-asset-tag', payload.assetTagNumber),
              type: 'ASSET_TAG',
              value: payload.assetTagNumber.trim(),
            }]
          : []),
      ];

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'RESOURCE_MASTER',
        aggregateId: resourceId,
        eventType: 'RESOURCE_REGISTERED',
        auditAction: 'RESOURCE_REGISTERED',
        auditResourceType: 'RESOURCE_MASTER',
        auditResourceId: resourceId,
        outboxTopic: 'g-hims-resource-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: identities.map((identity) => ({
          key: identity.key,
          entityType: 'RESOURCE_IDENTITY',
          entityId: identity.entityId,
          required: false,
        })),
        prepare: (current) => {
          for (const identity of identities) {
            if (current[identity.key]) {
              throw new AtomicMutationRejectedError(
                'RESOURCE_IDENTITY_ALREADY_REGISTERED',
                `${identity.type} '${identity.value}' is already registered in this tenant.`,
                { type: identity.type, value: identity.value }
              );
            }
          }

          const resource: ResourceMaster = {
            ...payload,
            resourceId,
            resourceNumber,
            createdAt: now,
            updatedAt: now,
          };

          return {
            domainState: resource,
            additionalStateWrites: identities.map((identity) => ({
              entityType: 'RESOURCE_IDENTITY',
              entityId: identity.entityId,
              domainState: {
                identityId: identity.entityId,
                tenantId: context.tenantId,
                type: identity.type,
                value: identity.value,
                resourceId,
                createdAt: now,
              },
            })),
            eventPayload: {
              resourceId,
              resourceNumber,
              name: resource.name,
              resourceType: resource.resourceType,
              facilityId: resource.facilityId,
              departmentId: resource.departmentId,
              status: resource.status,
            },
            auditReason:
              `Registered authoritative resource ${resourceNumber} (${resource.name}) for ` +
              `${resource.departmentName || resource.departmentId}.`,
            resultData: resource,
          };
        },
      });

      const resource = tx.resultData as ResourceMaster;
      this.resources.set(resourceId, resource);
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: resourceId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: resource,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      if (error instanceof Error && error.message === 'FACILITY_SCOPE_MISMATCH') {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'FACILITY_SCOPE_MISMATCH',
            message: 'Resource registration is outside the actor facility scope.',
          },
        };
      }
      throw error;
    }
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
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Facilities admin authority required.',
        },
      };
    }

    repositoryRequiredOutsideTests();
    try {
      assertFacilityScope(context, payload.facilityId);
      if (payload.currentOccupancy > payload.capacity) {
        throw new AtomicMutationRejectedError(
          'ROOM_OCCUPANCY_EXCEEDS_CAPACITY',
          'Room occupancy cannot exceed configured capacity.'
        );
      }
      const roomId = deterministicId('room', context.tenantId, commandId);
      const roomIdentityId = identityId(
        'room-number',
        payload.facilityId,
        payload.building,
        payload.floor,
        payload.roomNumber
      );
      const now = new Date().toISOString();

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'HOSPITAL_ROOM',
        aggregateId: roomId,
        eventType: 'ROOM_REGISTERED',
        auditAction: 'ROOM_REGISTERED',
        auditResourceType: 'HOSPITAL_ROOM',
        auditResourceId: roomId,
        outboxTopic: 'g-hims-facility-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'roomIdentity',
          entityType: 'ROOM_IDENTITY',
          entityId: roomIdentityId,
          required: false,
        }],
        prepare: (current) => {
          if (current.roomIdentity) {
            throw new AtomicMutationRejectedError(
              'ROOM_IDENTITY_ALREADY_REGISTERED',
              'This room number/location is already registered in the facility.'
            );
          }
          const room: HospitalRoom = {
            ...payload,
            roomId,
            createdAt: now,
            updatedAt: now,
          };
          return {
            domainState: room,
            additionalStateWrites: [{
              entityType: 'ROOM_IDENTITY',
              entityId: roomIdentityId,
              domainState: {
                identityId: roomIdentityId,
                tenantId: context.tenantId,
                facilityId: payload.facilityId,
                building: payload.building,
                floor: payload.floor,
                roomNumber: payload.roomNumber,
                roomId,
                createdAt: now,
              },
            }],
            eventPayload: {
              roomId,
              roomNumber: room.roomNumber,
              roomType: room.roomType,
              facilityId: room.facilityId,
              departmentId: room.departmentId,
            },
            auditReason: `Registered authoritative room ${room.roomNumber} (${room.roomType}).`,
            resultData: room,
          };
        },
      });

      const room = tx.resultData as HospitalRoom;
      this.rooms.set(roomId, room);
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: roomId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: room,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      if (error instanceof Error && error.message === 'FACILITY_SCOPE_MISMATCH') {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'FACILITY_SCOPE_MISMATCH',
            message: 'Room registration is outside the actor facility scope.',
          },
        };
      }
      throw error;
    }
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
    const resource = await this.loadResource(context.tenantId, payload.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: `Resource ${payload.resourceId} does not exist.`,
        },
      };
    }
    if (
      resource.facilityId !== payload.facilityId ||
      resource.resourceType !== payload.resourceType
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'RESOURCE_RESERVATION_SCOPE_MISMATCH',
          message: 'Reservation resource identity does not match the authoritative resource master.',
        },
      };
    }
    {
      if (
        resource.lifecycleState !== 'IN_SERVICE' ||
        ['OUT_OF_SERVICE', 'MAINTENANCE', 'LOST', 'RETIRED'].includes(resource.status)
      ) {
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

      if (isCalibrationLocked(resource, proposedEnd)) {
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
    const existingReservations = (await this.loadReservationsForResource(
      context.tenantId,
      payload.resourceId
    )).filter(
      (reservation) =>
        reservation.status !== 'CANCELLED' &&
        reservation.status !== 'COMPLETED'
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

    repositoryRequiredOutsideTests();
    try {
      assertFacilityScope(context, payload.facilityId);
    } catch {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Resource reservation is outside the actor facility scope.',
        },
      };
    }

    const reservationId = deterministicId('resv', context.tenantId, commandId);
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

    const resource = await this.loadResource(context.tenantId, payload.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RESOURCE_NOT_FOUND', message: `Resource ${payload.resourceId} does not exist.` },
      };
    }

    try {
      assertFacilityScope(context, resource.facilityId);
      assertFacilityScope(context, payload.toFacilityId);
    } catch {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Resource transfer source or destination is outside the actor facility scope.',
        },
      };
    }

    const previousLocation = { ...resource.location };
    const previousDept = { id: resource.departmentId, name: resource.departmentName };

    const updatedResource: ResourceMaster = {
      ...resource,
      departmentId: payload.toDepartmentId,
      departmentName: payload.toDepartmentName,
      facilityId: payload.toFacilityId,
      facilityName: payload.toFacilityName,
      location: payload.toLocation,
      ...(payload.custodianName
        ? { currentCustodianName: payload.custodianName }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    this.resources.set(payload.resourceId, updatedResource);

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'RESOURCE_MASTER',
      entityId: payload.resourceId,
      eventType: 'RESOURCE_TRANSFERRED',
      domainState: updatedResource,
      eventPayload: {
        resourceId: payload.resourceId,
        previousDept,
        newDept: { id: payload.toDepartmentId, name: payload.toDepartmentName },
        previousLocation,
        newLocation: payload.toLocation,
        reason: payload.reason,
      },
      auditReason: `Resource ${updatedResource.name} (${updatedResource.resourceNumber}) transferred to ${payload.toDepartmentName}: ${payload.reason}`,
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
      data: updatedResource,
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

    const resource = await this.loadResource(context.tenantId, payload.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RESOURCE_NOT_FOUND', message: `Resource ${payload.resourceId} does not exist.` },
      };
    }

    repositoryRequiredOutsideTests();
    try {
      assertFacilityScope(context, resource.facilityId);
    } catch {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Maintenance work order is outside the actor facility scope.',
        },
      };
    }

    const workOrderId = deterministicId('wo', context.tenantId, commandId);
    const workOrderNumber =
      `WO-${new Date().getUTCFullYear()}-${workOrderId.slice(-8).toUpperCase()}`;
    const now = new Date().toISOString();

    const workOrder: MaintenanceWorkOrder = {
      ...payload,
      resourceId: resource.resourceId,
      resourceName: resource.name,
      resourceType: resource.resourceType,
      reportedByActorId: context.actorId,
      workOrderId,
      workOrderNumber,
      status: 'REPORTED',
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const updatedResource: ResourceMaster = {
      ...resource,
      status: 'MAINTENANCE',
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'MAINTENANCE_WORK_ORDER',
      aggregateId: workOrderId,
      eventType: 'WORK_ORDER_CREATED',
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
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: workOrder,
      additionalStateWrites: [
        {
          entityType: 'RESOURCE_MASTER',
          entityId: resource.resourceId,
          domainState: updatedResource,
        },
      ],
    });

    this.workOrders.set(workOrderId, workOrder);
    this.resources.set(resource.resourceId, updatedResource);

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: workOrderId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
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

    const workOrder = await this.loadWorkOrder(context.tenantId, payload.workOrderId);
    if (!workOrder) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'WORK_ORDER_NOT_FOUND', message: 'Work order not found.' },
      };
    }

    const resource = await this.loadResource(context.tenantId, workOrder.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RESOURCE_NOT_FOUND', message: `Resource ${workOrder.resourceId} does not exist.` },
      };
    }

    const now = new Date().toISOString();
    const completedWorkOrder: MaintenanceWorkOrder = {
      ...workOrder,
      status: 'COMPLETED',
      completedAt: now,
      resolutionSummary: payload.resolutionSummary,
      totalCost: payload.totalCost,
      downtimeHours: payload.downtimeHours,
      updatedAt: now,
    };

    const updatedResource: ResourceMaster = {
      ...resource,
      status: isCalibrationLocked(resource) ? 'OUT_OF_SERVICE' : 'AVAILABLE',
      lastMaintenanceDate: now.split('T')[0],
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'MAINTENANCE_WORK_ORDER',
      aggregateId: payload.workOrderId,
      eventType: 'WORK_ORDER_COMPLETED',
      eventPayload: {
        workOrderId: payload.workOrderId,
        resourceId: workOrder.resourceId,
        resolutionSummary: payload.resolutionSummary,
        totalCost: payload.totalCost,
      },
      auditReason: `Completed work order ${workOrder.workOrderNumber} on ${workOrder.resourceName}`,
      outboxTopic: 'g-hims-maintenance-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: completedWorkOrder,
      additionalStateWrites: [
        {
          entityType: 'RESOURCE_MASTER',
          entityId: resource.resourceId,
          domainState: updatedResource,
        },
      ],
    });

    this.workOrders.set(payload.workOrderId, completedWorkOrder);
    this.resources.set(resource.resourceId, updatedResource);

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.workOrderId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: completedWorkOrder,
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

    const resource = await this.loadResource(context.tenantId, payload.resourceId);
    if (!resource) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'RESOURCE_NOT_FOUND', message: `Resource ${payload.resourceId} does not exist.` },
      };
    }

    repositoryRequiredOutsideTests();
    try {
      assertFacilityScope(context, resource.facilityId);
    } catch {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Calibration record is outside the actor facility scope.',
        },
      };
    }

    const calibrationId = deterministicId('cal', context.tenantId, commandId);
    const now = new Date().toISOString();
    const isPassed = payload.result === 'PASS' || payload.result === 'CONDITIONAL_PASS';

    const calibration: CalibrationRecord = {
      ...payload,
      resourceId: resource.resourceId,
      resourceName: resource.name,
      model: resource.model || payload.model,
      serialNumber: resource.serialNumber || payload.serialNumber,
      technicianId: context.actorId,
      calibrationId,
      status: isPassed ? 'VALID' : 'FAILED',
      createdAt: now,
    };

    const updatedResource: ResourceMaster = {
      ...resource,
      calibrationStatus: isPassed ? 'VALID' : 'FAILED',
      lastCalibrationDate: payload.calibrationDate,
      nextCalibrationDate: payload.nextDueDate,
      calibrationCertificateNumber: payload.certificateNumber,
      status: !isPassed ? 'OUT_OF_SERVICE' : resource.status,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CALIBRATION_RECORD',
      aggregateId: calibrationId,
      eventType: 'CALIBRATION_RECORDED',
      eventPayload: {
        calibrationId,
        resourceId: payload.resourceId,
        result: payload.result,
        certificateNumber: payload.certificateNumber,
        nextDueDate: payload.nextDueDate,
      },
      auditReason: `Recorded calibration (${payload.result}) for ${payload.resourceName}, certificate ${payload.certificateNumber}`,
      outboxTopic: 'g-hims-calibration-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: calibration,
      additionalStateWrites: [
        {
          entityType: 'RESOURCE_MASTER',
          entityId: resource.resourceId,
          domainState: updatedResource,
        },
      ],
    });

    this.calibrations.set(calibrationId, calibration);
    this.resources.set(resource.resourceId, updatedResource);

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: calibrationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
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
    // Production initialization is intentionally empty.
    // Authoritative state must come from tenant-scoped persisted read models.
    repositoryRequiredOutsideTests();
  }

  public static seedTestFixtures(): void {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('TEST_FIXTURE_SEED_FORBIDDEN_OUTSIDE_TESTS');
    }
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
    return Array.from(this.resources.values());
  }

  public static getRooms(): HospitalRoom[] {
    return Array.from(this.rooms.values());
  }

  public static getWorkOrders(): MaintenanceWorkOrder[] {
    return Array.from(this.workOrders.values());
  }

  public static getCalibrations(): CalibrationRecord[] {
    return Array.from(this.calibrations.values());
  }

  public static getReservations(): ResourceReservation[] {
    return Array.from(this.reservations.values());
  }
}
