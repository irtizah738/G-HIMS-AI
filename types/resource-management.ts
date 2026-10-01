/**
 * G-HIMS Master Resource Management Types
 * Unified Registry for Rooms, Beds, Medical Devices, Equipment, Maintenance & Capacity
 */

export type ResourceType =
  | 'ROOM'
  | 'BED'
  | 'MEDICAL_DEVICE'
  | 'LAB_EQUIPMENT'
  | 'RADIOLOGY_EQUIPMENT'
  | 'SURGICAL_EQUIPMENT'
  | 'IT_EQUIPMENT'
  | 'VEHICLE'
  | 'FURNITURE'
  | 'OTHER';

export type ResourceStatus =
  | 'AVAILABLE'
  | 'ALLOCATED'
  | 'IN_USE'
  | 'RESERVED'
  | 'MAINTENANCE'
  | 'OUT_OF_SERVICE'
  | 'LOST'
  | 'RETIRED';

export type RoomType =
  | 'consultation'
  | 'procedure'
  | 'operating_room'
  | 'isolation'
  | 'icu'
  | 'meeting'
  | 'storage'
  | 'laboratory'
  | 'imaging';

export type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'EMERGENCY_REPAIR';

export type MaintenanceStatus =
  | 'REPORTED'
  | 'WORK_ORDER_CREATED'
  | 'TECHNICIAN_ASSIGNED'
  | 'IN_PROGRESS'
  | 'PARTS_PENDING'
  | 'COMPLETED'
  | 'VERIFIED'
  | 'CANCELLED';

export type CalibrationStatus =
  | 'NOT_REQUIRED'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'CALIBRATION_REQUIRED'
  | 'FAILED';

export type ReservationStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'RESERVED'
  | 'IN_USE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface ResourceMaster {
  resourceId: string;
  resourceNumber: string; // e.g. "RES-MED-4029"
  resourceType: ResourceType;
  name: string;
  facilityId: string;
  facilityName?: string;
  departmentId: string;
  departmentName?: string;
  ownerDepartmentId: string;
  ownerDepartmentName?: string;
  location: {
    building: string;
    floor: string;
    roomNumber?: string;
    zone?: string;
  };
  status: ResourceStatus;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  assetTagNumber?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  warrantyExpiry?: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  calibrationRequired?: boolean;
  calibrationStatus?: CalibrationStatus;
  lastCalibrationDate?: string;
  nextCalibrationDate?: string;
  calibrationCertificateNumber?: string;
  currentCustodianId?: string;
  currentCustodianName?: string;
  operatingSpecifications?: Record<string, string | number>;
  acquisitionDate: string;
  lifecycleState: 'IN_SERVICE' | 'STORAGE' | 'UNDER_REPAIR' | 'DECOMMISSIONED' | 'DISPOSED';
  /** Monotonic server-owned token used to serialize reservation decisions. */
  reservationRevision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface HospitalRoom {
  roomId: string;
  roomNumber: string; // e.g. "OR-03", "CONS-104"
  facilityId: string;
  facilityName: string;
  building: string;
  floor: string;
  departmentId: string;
  departmentName: string;
  roomType: RoomType;
  capacity: number; // Patient capacity or seating capacity
  currentOccupancy: number;
  status: ResourceStatus;
  equipmentIds?: string[];
  bedIds?: string[];
  features?: string[]; // e.g. ["HEPA Filtration", "Negative Pressure", "Laminar Flow", "Gas Outlets"]
  operatingHours?: {
    openTime: string; // "08:00"
    closeTime: string; // "20:00"
    is24x7: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ResourceAssignment {
  assignmentId: string;
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  assignedToEmployeeId?: string;
  assignedToEmployeeName?: string;
  assignedToDepartmentId: string;
  assignedToDepartmentName: string;
  assignedByActorId: string;
  assignedByActorName?: string;
  startDate: string;
  endDate?: string;
  purpose: string;
  status: 'ACTIVE' | 'RETURNED' | 'TRANSFERRED';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceTransferRecord {
  transferId: string;
  resourceId: string;
  resourceName: string;
  sourceDepartmentId: string;
  sourceDepartmentName: string;
  destinationDepartmentId: string;
  destinationDepartmentName: string;
  sourceFacilityId: string;
  destinationFacilityId: string;
  requestedBy: string;
  requestedByName: string;
  approvedBy?: string;
  approvedByName?: string;
  transferredAt: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'COMPLETED' | 'REJECTED';
  transferChecklistVerified: boolean;
  createdAt: string;
}

export interface MaintenanceWorkOrder {
  workOrderId: string;
  workOrderNumber: string; // e.g. "WO-2026-0819"
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  issueDescription: string;
  maintenanceType: MaintenanceType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL_SURGE';
  reportedByActorId: string;
  reportedByName: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  assignedVendorName?: string;
  status: MaintenanceStatus;
  openedAt: string;
  startedAt?: string;
  completedAt?: string;
  verifiedAt?: string;
  verifiedByActorId?: string;
  resolutionSummary?: string;
  partsUsed?: Array<{
    partNumber: string;
    partName: string;
    quantity: number;
    unitCost: number;
  }>;
  totalCost?: number;
  downtimeHours?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalibrationRecord {
  calibrationId: string;
  resourceId: string;
  resourceName: string;
  model: string;
  serialNumber: string;
  calibrationDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD
  certificateNumber: string;
  technicianName: string;
  technicianId?: string;
  accreditedAgency?: string;
  result: 'PASS' | 'FAIL' | 'CONDITIONAL_PASS';
  measuredTolerances?: Record<string, { standard: number; measured: number; deviation: number; pass: boolean }>;
  notes?: string;
  documentReference?: string;
  status: CalibrationStatus;
  createdAt: string;
}

export interface ResourceReservation {
  reservationId: string;
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  facilityId: string;
  departmentId: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  purpose: 'OPD_CONSULTATION' | 'SURGICAL_PROCEDURE' | 'DIAGNOSTIC_IMAGING' | 'LAB_BATCH' | 'PREVENTIVE_MAINTENANCE' | 'STAFF_TRAINING' | 'EMERGENCY_HOLD';
  procedureCode?: string;
  clinicalEncounterId?: string;
  patientId?: string;
  patientName?: string;
  requesterActorId: string;
  requesterName: string;
  priority: 'ROUTINE' | 'URGENT' | 'STAT_EMERGENCY';
  status: ReservationStatus;
  conflictDetails?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HospitalCapacityForecast {
  facilityId: string;
  facilityName: string;
  date: string;
  totalConsultationRooms: number;
  availableConsultationRooms: number;
  totalOperatingRooms: number;
  availableOperatingRooms: number;
  totalDiagnosticMachines: number;
  availableDiagnosticMachines: number;
  totalBeds: number;
  availableBeds: number;
  activeSurgeons: number;
  activePhysicians: number;
  activeNurses: number;
  activeTechnicians: number;
  utilizationRate: number; // 0 - 100%
  downtimeRate: number; // 0 - 100%
  bottlenecks: string[];
}

export interface OperationalMatchRequest {
  serviceType: 'OPD' | 'OT_SURGERY' | 'EMERGENCY_SURGE' | 'DIAGNOSTICS' | 'IPD_ADMISSION';
  specialty: string;
  scheduledTime: string;
  durationMinutes: number;
  requiredRoomType: RoomType;
  requiredPrivileges: string[];
  requiredEquipmentTypes?: ResourceType[];
  patientId?: string;
}

export interface OperationalMatchResult {
  isAvailable: boolean;
  matchScore: number;
  matchedPhysician?: {
    employeeId: string;
    fullName: string;
    role: string;
    specialty: string;
    privilegeStatus: 'VALID' | 'RESTRICTED' | 'EXPIRED';
  };
  matchedRoom?: HospitalRoom;
  matchedEquipment?: ResourceMaster[];
  conflictReason?: string;
  alternativeSlots?: string[];
}
