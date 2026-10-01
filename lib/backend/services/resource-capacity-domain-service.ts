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
import type { Bed, BedStatus } from '@/lib/types/ghims';

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
  private static beds: Map<string, Bed> = new Map();
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

  private static async loadRoom(
    tenantId: string,
    roomId: string
  ): Promise<HospitalRoom | null> {
    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<HospitalRoom>(
        tenantId,
        'rooms',
        roomId
      );
      if (persisted) this.rooms.set(roomId, persisted);
      else this.rooms.delete(roomId);
      return persisted;
    }
    return this.rooms.get(roomId) || null;
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
      const persisted = await DomainStateRepository.queryAllEqual<ResourceReservation>(
        tenantId,
        'resourceReservations',
        'resourceId',
        resourceId,
        { pageSize: 250, maxRows: 10000 }
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
  // FAC-2. AUTHORITATIVE BED & SPACE CAPACITY
  // ============================================================================

  public static async registerBed(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      bedNumber: string;
      facilityId: string;
      facilityName: string;
      departmentId: string;
      departmentName: string;
      roomId: string;
      ward: Bed['ward'];
      bedType: NonNullable<Bed['bedType']>;
      capabilities?: string[];
      notes?: string;
    }
  ): Promise<CommandResult<Bed>> {
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

      const bedId = deterministicId('bed', context.tenantId, commandId);
      const bedIdentityId = identityId(
        'bed-number',
        payload.facilityId,
        payload.roomId,
        payload.bedNumber
      );
      const now = new Date().toISOString();

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'FACILITIES_ADMIN',
        aggregateType: 'HOSPITAL_BED',
        aggregateId: bedId,
        eventType: 'BED_REGISTERED',
        auditAction: 'BED_REGISTERED',
        auditResourceType: 'HOSPITAL_BED',
        auditResourceId: bedId,
        outboxTopic: 'g-hims-facility-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'room',
            entityType: 'HOSPITAL_ROOM',
            entityId: payload.roomId,
            required: true,
          },
          {
            key: 'bedIdentity',
            entityType: 'BED_IDENTITY',
            entityId: bedIdentityId,
            required: false,
          },
        ],
        prepare: (current) => {
          if (current.bedIdentity) {
            throw new AtomicMutationRejectedError(
              'BED_IDENTITY_ALREADY_REGISTERED',
              'This bed number is already registered in the room.'
            );
          }

          const room = current.room as (HospitalRoom & { _serverVersion?: number }) | null;
          if (!room) {
            throw new AtomicMutationRejectedError(
              'ROOM_NOT_FOUND',
              'The authoritative room does not exist.'
            );
          }

          if (
            room.facilityId !== payload.facilityId ||
            room.departmentId !== payload.departmentId
          ) {
            throw new AtomicMutationRejectedError(
              'BED_ROOM_SCOPE_MISMATCH',
              'Bed facility/department does not match the authoritative room.'
            );
          }

          if (['OUT_OF_SERVICE', 'LOST', 'RETIRED'].includes(room.status)) {
            throw new AtomicMutationRejectedError(
              'ROOM_NOT_IN_SERVICE',
              'Beds cannot be registered in a room that is out of service or retired.'
            );
          }

          const existingBedIds = Array.from(new Set(room.bedIds || []));
          if (existingBedIds.length >= room.capacity) {
            throw new AtomicMutationRejectedError(
              'ROOM_BED_CAPACITY_EXCEEDED',
              `Room ${room.roomNumber} already has ${existingBedIds.length} registered beds for capacity ${room.capacity}.`
            );
          }

          const bed: Bed = {
            id: bedId,
            bedNumber: payload.bedNumber.trim(),
            ward: payload.ward,
            room: room.roomNumber,
            status: 'available',
            facilityId: room.facilityId,
            facilityName: room.facilityName,
            departmentId: room.departmentId,
            departmentName: room.departmentName,
            roomId: room.roomId,
            bedType: payload.bedType,
            lifecycleState: 'IN_SERVICE',
            capabilities: payload.capabilities || [],
            notes: payload.notes,
            createdAt: now,
            updatedAt: now,
          };

          const nextRoom: HospitalRoom = {
            ...room,
            bedIds: [...existingBedIds, bedId],
            updatedAt: now,
          };

          return {
            domainState: bed,
            additionalStateWrites: [
              {
                entityType: 'BED_IDENTITY',
                entityId: bedIdentityId,
                domainState: {
                  identityId: bedIdentityId,
                  tenantId: context.tenantId,
                  facilityId: room.facilityId,
                  departmentId: room.departmentId,
                  roomId: room.roomId,
                  bedNumber: bed.bedNumber,
                  bedId,
                  createdAt: now,
                },
              },
              {
                entityType: 'HOSPITAL_ROOM',
                entityId: room.roomId,
                domainState: nextRoom,
              },
            ],
            eventPayload: {
              bedId,
              bedNumber: bed.bedNumber,
              roomId: room.roomId,
              facilityId: room.facilityId,
              departmentId: room.departmentId,
              ward: bed.ward,
              bedType: bed.bedType,
            },
            auditReason:
              `Registered authoritative bed ${bed.bedNumber} in room ${room.roomNumber}.`,
            resultData: {
              bed,
              room: nextRoom,
            },
          };
        },
      });

      const committed = tx.resultData as { bed: Bed; room: HospitalRoom };
      this.beds.set(committed.bed.id, committed.bed);
      this.rooms.set(committed.room.roomId, committed.room);

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: committed.bed.id,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: committed.bed,
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
            message: 'Bed registration is outside the actor facility scope.',
          },
        };
      }
      throw error;
    }
  }

  public static async updateBedOperationalStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      bedId: string;
      status: Extract<BedStatus, 'available' | 'maintenance' | 'cleaning'>;
      notes?: string;
    }
  ): Promise<CommandResult<{ bed: Bed }>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'NURSE',
        'HOUSEKEEPING',
        'FACILITIES_ADMIN',
        'BIOMEDICAL_ENGINEER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Bed operational-status authority required.',
        },
      };
    }

    repositoryRequiredOutsideTests();
    const now = new Date().toISOString();

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'FACILITIES_ADMIN',
        aggregateType: 'HOSPITAL_BED',
        aggregateId: payload.bedId,
        eventType: 'BED_OPERATIONAL_STATUS_CHANGED',
        auditAction: 'UPDATE_BED_OPERATIONAL_STATUS',
        auditResourceType: 'HOSPITAL_BED',
        auditResourceId: payload.bedId,
        outboxTopic: 'g-hims-facility-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'bed',
          entityType: 'HOSPITAL_BED',
          entityId: payload.bedId,
          required: true,
        }],
        prepare: (current) => {
          const bed = current.bed as (Bed & { _serverVersion?: number }) | null;
          if (!bed) {
            throw new AtomicMutationRejectedError(
              'BED_NOT_FOUND',
              'Target bed does not exist.'
            );
          }

          if (bed.facilityId) assertFacilityScope(context, bed.facilityId);

          if (
            bed.status === 'occupied' ||
            bed.patientId ||
            bed.currentPatientId ||
            bed.currentEncounterId
          ) {
            throw new AtomicMutationRejectedError(
              'BED_OCCUPIED',
              'Physical bed readiness cannot change while clinical occupancy is active.'
            );
          }

          if (bed.status === 'reserved') {
            throw new AtomicMutationRejectedError(
              'BED_CLINICAL_HOLD_ACTIVE',
              'A clinically reserved bed must be released through the care-transition allocation workflow.'
            );
          }

          if (
            bed.lifecycleState === 'DECOMMISSIONED' ||
            bed.lifecycleState === 'OUT_OF_SERVICE'
          ) {
            throw new AtomicMutationRejectedError(
              'BED_LIFECYCLE_LOCKOUT',
              'A decommissioned/out-of-service bed cannot be returned to operational readiness.'
            );
          }

          const nextLifecycle =
            payload.status === 'maintenance' ? 'MAINTENANCE' : 'IN_SERVICE';
          const bedState: Bed = {
            ...bed,
            status: payload.status,
            lifecycleState: nextLifecycle,
            patientId: undefined,
            currentPatientId: undefined,
            patientName: undefined,
            currentEncounterId: undefined,
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            updatedAt: now,
          };

          return {
            domainState: bedState,
            eventPayload: {
              bedId: payload.bedId,
              facilityId: bed.facilityId,
              roomId: bed.roomId,
              previousStatus: bed.status,
              status: payload.status,
              lifecycleState: nextLifecycle,
            },
            auditReason:
              `Bed ${bed.bedNumber || bed.id} operational status changed from ${bed.status} to ${payload.status}.`,
            resultData: bedState,
          };
        },
      });

      const bedState = tx.resultData as Bed;
      this.beds.set(payload.bedId, bedState);
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.bedId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: { bed: bedState },
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        const code =
          error.code === 'REQUIRED_STATE_NOT_FOUND' ? 'BED_NOT_FOUND' : error.code;
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code,
            message:
              code === 'BED_NOT_FOUND' ? 'Target bed does not exist.' : error.message,
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
            message: 'Bed status update is outside the actor facility scope.',
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
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'DOCTOR',
        'CLINICIAN',
        'NURSE',
        'LAB_TECHNICIAN',
        'RADIOLOGY_TECHNICIAN',
        'FACILITIES_ADMIN',
        'BIOMEDICAL_ENGINEER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Resource reservation authority required.',
        },
      };
    }

    const proposedStart = new Date(payload.startTime).getTime();
    const proposedEnd = new Date(payload.endTime).getTime();

    if (
      !Number.isFinite(proposedStart) ||
      !Number.isFinite(proposedEnd) ||
      proposedEnd <= proposedStart
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_TIME_RANGE', message: 'End time must be after start time.' },
      };
    }

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
          message:
            `SAFETY LOCKOUT: Biomedical asset ${resource.name} has expired calibration and ` +
            'is blocked from clinical procedures until recertified.',
        },
      };
    }

    try {
      assertFacilityScope(context, resource.facilityId);
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

    // Query all active reservations before entering the write transaction.
    // The resource's reservationRevision below acts as the serialization token:
    // if another reservation commits after this read, this transaction fails
    // closed and the caller must retry against fresh availability.
    const existingReservations = (await this.loadReservationsForResource(
      context.tenantId,
      resource.resourceId
    )).filter(
      (reservation) =>
        reservation.status !== 'CANCELLED' &&
        reservation.status !== 'COMPLETED' &&
        reservation.status !== 'EXPIRED'
    );

    for (const ex of existingReservations) {
      const exStart = new Date(ex.startTime).getTime();
      const exEnd = new Date(ex.endTime).getTime();
      if (proposedStart < exEnd && proposedEnd > exStart) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'DOUBLE_BOOKING_CONFLICT',
            message:
              `Conflict detected: ${resource.name} is already reserved for ${ex.purpose} ` +
              `(${ex.startTime} to ${ex.endTime}) by ${ex.requesterName}.`,
          },
        };
      }
    }

    repositoryRequiredOutsideTests();

    const expectedReservationRevision = Number(resource.reservationRevision || 0);
    const reservationId = deterministicId('resv', context.tenantId, commandId);
    const now = new Date().toISOString();

    const reservation: ResourceReservation = {
      ...payload,
      resourceName: resource.name,
      resourceType: resource.resourceType,
      facilityId: resource.facilityId,
      requesterActorId: context.actorId,
      reservationId,
      status: 'APPROVED',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'RESOURCE_RESERVATION',
        aggregateId: reservationId,
        eventType: 'RESOURCE_RESERVED',
        auditAction: 'RESOURCE_RESERVED',
        auditResourceType: 'RESOURCE_RESERVATION',
        auditResourceId: reservationId,
        outboxTopic: 'g-hims-reservation-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'resource',
          entityType: 'RESOURCE_MASTER',
          entityId: resource.resourceId,
          required: true,
        }],
        prepare: (current) => {
          const currentResource = current.resource as
            | (ResourceMaster & { _serverVersion?: number })
            | null;

          if (!currentResource) {
            throw new AtomicMutationRejectedError(
              'RESOURCE_NOT_FOUND',
              `Resource ${resource.resourceId} does not exist.`
            );
          }

          if (Number(currentResource.reservationRevision || 0) !== expectedReservationRevision) {
            throw new AtomicMutationRejectedError(
              'RESERVATION_CONCURRENCY_RETRY_REQUIRED',
              'Resource availability changed while the reservation was being committed. Retry against fresh availability.',
              {
                resourceId: resource.resourceId,
                expectedReservationRevision,
                currentReservationRevision: Number(currentResource.reservationRevision || 0),
              }
            );
          }

          if (
            currentResource.facilityId !== resource.facilityId ||
            currentResource.resourceType !== resource.resourceType
          ) {
            throw new AtomicMutationRejectedError(
              'RESOURCE_RESERVATION_SCOPE_MISMATCH',
              'Authoritative resource identity changed while the reservation was being committed.'
            );
          }

          if (
            currentResource.lifecycleState !== 'IN_SERVICE' ||
            ['OUT_OF_SERVICE', 'MAINTENANCE', 'LOST', 'RETIRED'].includes(currentResource.status)
          ) {
            throw new AtomicMutationRejectedError(
              'RESOURCE_UNAVAILABLE',
              `Resource ${currentResource.name} is currently in ${currentResource.status} status.`
            );
          }

          if (isCalibrationLocked(currentResource, proposedEnd)) {
            throw new AtomicMutationRejectedError(
              'CALIBRATION_LOCKOUT',
              `SAFETY LOCKOUT: Biomedical asset ${currentResource.name} is not calibration-valid through the requested reservation window.`
            );
          }

          const nextResource: ResourceMaster = {
            ...currentResource,
            reservationRevision: expectedReservationRevision + 1,
            updatedAt: now,
          };

          return {
            domainState: reservation,
            additionalStateWrites: [{
              entityType: 'RESOURCE_MASTER',
              entityId: resource.resourceId,
              domainState: nextResource,
            }],
            eventPayload: {
              reservationId,
              resourceId: resource.resourceId,
              resourceName: currentResource.name,
              startTime: reservation.startTime,
              endTime: reservation.endTime,
              purpose: reservation.purpose,
              requesterActorId: context.actorId,
            },
            auditReason:
              `Reserved ${currentResource.name} for ${reservation.purpose} ` +
              `(${reservation.startTime} - ${reservation.endTime})`,
            resultData: {
              reservation,
              resource: nextResource,
            },
          };
        },
      });

      const committed = tx.resultData as {
        reservation: ResourceReservation;
        resource: ResourceMaster;
      };

      this.reservations.set(reservationId, committed.reservation);
      this.resources.set(resource.resourceId, committed.resource);

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: reservationId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: committed.reservation,
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
      throw error;
    }
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

  public static seedTestFixtures(tenantId = 'central-metro-hospital'): void {
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
        reservationRevision: 0,
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
        reservationRevision: 0,
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
        reservationRevision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];

    sampleResources.forEach((r) => {
      this.resources.set(r.resourceId, r);
      TransactionManager.seedEphemeralStateForTesting(
        tenantId,
        'RESOURCE_MASTER',
        r.resourceId,
        r
      );
    });

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

    sampleRooms.forEach((rm) => {
      this.rooms.set(rm.roomId, rm);
      TransactionManager.seedEphemeralStateForTesting(
        tenantId,
        'HOSPITAL_ROOM',
        rm.roomId,
        rm
      );
    });

    const sampleReservation: ResourceReservation = {
      reservationId: 'resv_sample_01',
      resourceId: 'res_001',
      resourceName: 'GE Healthcare Aisys CS2 Anesthesia Delivery Workstation',
      resourceType: 'MEDICAL_DEVICE',
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
    this.beds.clear();
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

  public static getBeds(): Bed[] {
    return Array.from(this.beds.values());
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
