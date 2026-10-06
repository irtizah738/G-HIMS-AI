import type {
  AppointmentType,
  WaitlistPriority,
} from '@/types/opd-domain';

export type OpdAppointmentAuthorityStatus =
  | 'CONFIRMED'
  | 'RESCHEDULED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type OpdAppointmentBookingChannel =
  | 'FRONT_DESK'
  | 'PATIENT_PORTAL'
  | 'CALL_CENTER'
  | 'PHYSICIAN_REFERRAL'
  | 'ONLINE_PORTAL';

export interface OpdAppointmentRescheduleHistoryEntry {
  fromStartAt: number;
  fromEndAt: number;
  toStartAt: number;
  toEndAt: number;
  reason: string;
  changedAt: number;
  changedBy: string;
}

export interface OpdAppointmentRecord {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  providerEmployeeId: string;
  providerName: string;
  facilityId: string;
  departmentId: string;
  departmentName: string;
  appointmentType: AppointmentType;
  scheduledStartAt: number;
  scheduledEndAt: number;
  timeZone: string;
  durationMinutes: number;
  chiefComplaint: string;
  bookingChannel: OpdAppointmentBookingChannel;
  status: OpdAppointmentAuthorityStatus;
  slotIds: string[];
  patientSlotIds: string[];
  sourceWaitlistId?: string;
  encounterId?: string;
  queueTokenId?: string;
  checkedInAt?: number;
  checkedInBy?: string;
  completedAt?: number;
  completedBy?: string;
  cancellationReason?: string;
  cancelledAt?: number;
  cancelledBy?: string;
  noShowReason?: string;
  noShowAt?: number;
  noShowBy?: string;
  rescheduleHistory: OpdAppointmentRescheduleHistoryEntry[];
  providerAuthority: {
    rosterId: string;
    privilegeId: string;
    verifiedAt: number;
  };
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  schemaVersion: 1;
}

export type OpdAppointmentSlotStatus = 'BOOKED' | 'HELD' | 'RELEASED';

export interface OpdAppointmentSlotLock {
  slotId: string;
  tenantId: string;
  lockScope: 'PROVIDER' | 'PATIENT';
  subjectId: string;
  providerEmployeeId?: string;
  patientId?: string;
  facilityId: string;
  departmentId: string;
  bucketStartAt: number;
  bucketEndAt: number;
  status: OpdAppointmentSlotStatus;
  appointmentId?: string;
  waitlistId?: string;
  holdExpiresAt?: number;
  revision: number;
  updatedAt: number;
  updatedBy: string;
}

export type OpdWaitlistStatus =
  | 'WAITING'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface OpdWaitlistEntryRecord {
  waitlistId: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  facilityId: string;
  preferredDepartmentId: string;
  preferredDepartmentName: string;
  preferredProviderEmployeeId?: string;
  priority: WaitlistPriority;
  notificationPreference: 'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL';
  contactPhone: string;
  notes?: string;
  status: OpdWaitlistStatus;
  offeredProviderEmployeeId?: string;
  offeredProviderName?: string;
  offeredStartAt?: number;
  offeredEndAt?: number;
  offeredTimeZone?: string;
  offerProviderAuthority?: {
    rosterId: string;
    privilegeId: string;
    verifiedAt: number;
  };
  offerSlotIds?: string[];
  offerPatientSlotIds?: string[];
  offerExpiresAt?: number;
  acceptedAppointmentId?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  schemaVersion: 1;
}

export interface OpdProviderAvailabilitySlot {
  providerEmployeeId: string;
  providerName: string;
  facilityId: string;
  departmentId: string;
  departmentName: string;
  rosterId: string;
  privilegeId: string;
  startAt: number;
  endAt: number;
  timeZone: string;
}

export interface OpdWaitlistScopeLock {
  scopeId: string;
  tenantId: string;
  patientId: string;
  facilityId: string;
  departmentId: string;
  status: 'ACTIVE' | 'RELEASED';
  waitlistId: string;
  revision: number;
  updatedAt: number;
  updatedBy: string;
}
