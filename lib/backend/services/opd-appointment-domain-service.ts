import { createHash } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import {
  activateCareContext,
  compatibilityEncounterId,
  normalizePatientCarePointers,
} from '@/lib/clinical/patient360/care-context';
import type {
  ClinicalPrivilege,
  EmployeeMaster,
  LeaveCalendarBucket,
  LeaveRequest,
  RosterShiftEntry,
} from '@/types/hcm-advanced';
import type {
  AppointmentType,
  WaitlistPriority,
} from '@/types/opd-domain';
import type {
  OpdAppointmentBookingChannel,
  OpdAppointmentRecord,
  OpdAppointmentSlotLock,
  OpdWaitlistEntryRecord,
  OpdWaitlistScopeLock,
} from '@/types/opd-scheduling';

type DomainRecord = Record<string, any>;

const SLOT_BUCKET_MS = 5 * 60 * 1000;
const MIN_APPOINTMENT_MINUTES = 10;
const MAX_APPOINTMENT_MINUTES = 120;
const NO_SHOW_GRACE_MS = 15 * 60 * 1000;
const CHECKIN_EARLY_WINDOW_MS = 60 * 60 * 1000;
const CHECKIN_LATE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_WAITLIST_HOLD_MINUTES = 30;
const MAX_WAITLIST_HOLD_MINUTES = 120;

export interface BookOpdAppointmentPayload {
  patientId: string;
  providerEmployeeId: string;
  facilityId: string;
  departmentId: string;
  appointmentType: AppointmentType;
  scheduledStartAt: number;
  durationMinutes: number;
  timeZone: string;
  chiefComplaint: string;
  bookingChannel: OpdAppointmentBookingChannel;
}

export interface RescheduleOpdAppointmentPayload {
  appointmentId: string;
  scheduledStartAt: number;
  durationMinutes: number;
  timeZone: string;
  reason: string;
}

export interface AddOpdWaitlistPayload {
  patientId: string;
  facilityId: string;
  preferredDepartmentId: string;
  preferredProviderEmployeeId?: string;
  priority: WaitlistPriority;
  notificationPreference: 'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL';
  notes?: string;
}

export interface OfferOpdWaitlistSlotPayload {
  waitlistId: string;
  providerEmployeeId: string;
  scheduledStartAt: number;
  durationMinutes: number;
  timeZone: string;
  offerTtlMinutes?: number;
}

export interface AcceptOpdWaitlistOfferPayload {
  waitlistId: string;
  appointmentType: AppointmentType;
  chiefComplaint: string;
  bookingChannel?: OpdAppointmentBookingChannel;
}

interface ProviderAuthority {
  employee: EmployeeMaster;
  providerName: string;
  roster: RosterShiftEntry;
  privilege: ClinicalPrivilege;
  departmentName: string;
}

function reject<T = unknown>(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult<T> {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

function deterministicId(prefix: string, tenantId: string, commandId: string): string {
  return (
    prefix +
    '_' +
    createHash('sha256')
      .update(`${tenantId}\u0000${commandId}`)
      .digest('hex')
      .slice(0, 32)
  );
}

function providerSlotId(providerEmployeeId: string, bucketStartAt: number): string {
  return (
    'opdslot_' +
    createHash('sha256')
      .update(`${providerEmployeeId}\u0000${bucketStartAt}`)
      .digest('hex')
      .slice(0, 36)
  );
}

function patientSlotId(patientId: string, bucketStartAt: number): string {
  return (
    'opdpatientslot_' +
    createHash('sha256')
      .update(`${patientId}\u0000${bucketStartAt}`)
      .digest('hex')
      .slice(0, 36)
  );
}

function waitlistScopeId(
  patientId: string,
  facilityId: string,
  departmentId: string
): string {
  return (
    'opdwaitscope_' +
    createHash('sha256')
      .update(`${patientId}\u0000${facilityId}\u0000${departmentId}`)
      .digest('hex')
      .slice(0, 36)
  );
}

function buildWaitlistScopeLock(input: {
  scopeId: string;
  tenantId: string;
  patientId: string;
  facilityId: string;
  departmentId: string;
  status: 'ACTIVE' | 'RELEASED';
  waitlistId: string;
  actorId: string;
  previous?: DomainRecord | null;
  now: number;
}): OpdWaitlistScopeLock {
  return {
    scopeId: input.scopeId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    facilityId: input.facilityId,
    departmentId: input.departmentId,
    status: input.status,
    waitlistId: input.waitlistId,
    revision: Number(input.previous?.revision || 0) + 1,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    throw new AtomicMutationRejectedError(
      'INVALID_APPOINTMENT_TIME_ZONE',
      'Appointment time zone must be a valid IANA time-zone identifier.'
    );
  }
}

function localDateAt(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function leaveCalendarId(employeeId: string, year: number): string {
  return (
    'lvc_' +
    createHash('sha256')
      .update(
        `${employeeId.trim().toLowerCase()}\u0000${year}`
      )
      .digest('hex')
      .slice(0, 40)
  );
}

function appointmentLocalDates(
  startAt: number,
  endAt: number,
  timeZone: string
): string[] {
  const startDate = localDateAt(startAt, timeZone);
  const endDate = localDateAt(Math.max(startAt, endAt - 1), timeZone);
  return startDate === endDate ? [startDate] : [startDate, endDate];
}

function providerAuthorityReadTargets(input: {
  authority: ProviderAuthority;
  startAt: number;
  endAt: number;
  timeZone: string;
}) {
  const years = [
    ...new Set(
      appointmentLocalDates(input.startAt, input.endAt, input.timeZone).map(
        (date) => Number(date.slice(0, 4))
      )
    ),
  ];

  return [
    {
      key: 'providerEmployee',
      entityType: 'EMPLOYEE_MASTER',
      entityId: input.authority.employee.employeeId,
      required: true,
    },
    {
      key: 'providerPrivilege',
      entityType: 'CLINICAL_PRIVILEGE',
      entityId: input.authority.privilege.privilegeId,
      required: true,
    },
    {
      key: 'providerRoster',
      entityType: 'ROSTER_SHIFT',
      entityId: input.authority.roster.rosterId,
      required: true,
    },
    ...years.map((year) => ({
      key: `providerLeaveCalendar:${year}`,
      entityType: 'LEAVE_CALENDAR',
      entityId: leaveCalendarId(input.authority.employee.employeeId, year),
      required: false,
    })),
  ];
}

function assertProviderAuthoritySnapshot(
  current: Record<string, DomainRecord | null | undefined>,
  input: {
    authority: ProviderAuthority;
    providerEmployeeId: string;
    facilityId: string;
    departmentId: string;
    startAt: number;
    endAt: number;
    timeZone: string;
  }
): void {
  const employee = current.providerEmployee as
    | (EmployeeMaster & DomainRecord)
    | null
    | undefined;
  const privilege = current.providerPrivilege as
    | (ClinicalPrivilege & DomainRecord)
    | null
    | undefined;
  const roster = current.providerRoster as
    | (RosterShiftEntry & DomainRecord)
    | null
    | undefined;

  if (
    !employee ||
    employee.employeeId !== input.providerEmployeeId ||
    employee.employmentStatus !== 'ACTIVE' ||
    !employee.facilityIds.includes(input.facilityId) ||
    !employee.departmentIds.includes(input.departmentId)
  ) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_AUTHORITY_CHANGED',
      'Provider employment or facility/department assignment changed before scheduling commit.'
    );
  }

  const localDates = appointmentLocalDates(
    input.startAt,
    input.endAt,
    input.timeZone
  );
  const privilegeFrom = String(privilege?.effectiveFrom || '').slice(0, 10);
  const privilegeUntil = String(privilege?.effectiveUntil || '').slice(0, 10);
  if (
    !privilege ||
    privilege.privilegeId !== input.authority.privilege.privilegeId ||
    privilege.employeeId !== input.providerEmployeeId ||
    privilege.privilegeType !== 'CONSULT_OPD' ||
    privilege.status !== 'GRANTED' ||
    privilege.facilityId !== input.facilityId ||
    privilege.departmentId !== input.departmentId ||
    localDates.some(
      (date) =>
        (privilegeFrom && privilegeFrom > date) ||
        (privilegeUntil && privilegeUntil < date)
    )
  ) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_AUTHORITY_CHANGED',
      'Provider OPD privilege changed or no longer covers the scheduled interval.'
    );
  }

  const rosterStart = Date.parse(String(roster?.startTime || ''));
  const rosterEnd = Date.parse(String(roster?.endTime || ''));
  if (
    !roster ||
    roster.rosterId !== input.authority.roster.rosterId ||
    roster.employeeId !== input.providerEmployeeId ||
    !['PUBLISHED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(roster.status) ||
    roster.facilityId !== input.facilityId ||
    roster.departmentId !== input.departmentId ||
    !Number.isFinite(rosterStart) ||
    !Number.isFinite(rosterEnd) ||
    rosterStart > input.startAt ||
    rosterEnd < input.endAt
  ) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_AUTHORITY_CHANGED',
      'Provider roster changed or no longer covers the scheduled interval.'
    );
  }

  const years = [...new Set(localDates.map((date) => Number(date.slice(0, 4))))];
  for (const year of years) {
    const calendar = current[
      `providerLeaveCalendar:${year}`
    ] as LeaveCalendarBucket | null | undefined;
    if (!calendar) continue;
    if (
      calendar.employeeId !== input.providerEmployeeId ||
      calendar.year !== year
    ) {
      throw new AtomicMutationRejectedError(
        'OPD_PROVIDER_AUTHORITY_CHANGED',
        'Provider leave calendar lineage changed before scheduling commit.'
      );
    }
    const approvedLeave = (calendar.entries || []).find(
      (entry) =>
        entry.status === 'APPROVED' &&
        localDates.some(
          (date) =>
            date.slice(0, 4) === String(year) &&
            entry.startDate <= date &&
            entry.endDate >= date
        )
    );
    if (approvedLeave) {
      throw new AtomicMutationRejectedError(
        'OPD_PROVIDER_ON_LEAVE',
        'Provider approved leave now overlaps the scheduled appointment date.',
        { leaveId: approvedLeave.leaveId }
      );
    }
  }
}

function normalizeInterval(input: {
  scheduledStartAt: number;
  durationMinutes: number;
  timeZone: string;
}): { startAt: number; endAt: number; slotIds: string[] } {
  const startAt = Number(input.scheduledStartAt);
  const durationMinutes = Number(input.durationMinutes);
  assertTimeZone(input.timeZone);

  if (
    !Number.isSafeInteger(startAt) ||
    startAt <= 0 ||
    startAt % SLOT_BUCKET_MS !== 0
  ) {
    throw new AtomicMutationRejectedError(
      'INVALID_APPOINTMENT_START',
      'Appointment start must be a positive UTC epoch aligned to a 5-minute slot boundary.'
    );
  }

  if (
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < MIN_APPOINTMENT_MINUTES ||
    durationMinutes > MAX_APPOINTMENT_MINUTES ||
    durationMinutes % 5 !== 0
  ) {
    throw new AtomicMutationRejectedError(
      'INVALID_APPOINTMENT_DURATION',
      'Appointment duration must be a 5-minute multiple between 10 and 120 minutes.'
    );
  }

  const endAt = startAt + durationMinutes * 60_000;
  return { startAt, endAt, slotIds: [] };
}

function intervalSlotIds(
  providerEmployeeId: string,
  startAt: number,
  endAt: number
): string[] {
  const ids: string[] = [];
  for (let cursor = startAt; cursor < endAt; cursor += SLOT_BUCKET_MS) {
    ids.push(providerSlotId(providerEmployeeId, cursor));
  }
  return ids;
}

function providerName(employee: EmployeeMaster): string {
  const preferred = String(employee.personalInfo?.preferredName || '').trim();
  if (preferred) return preferred;
  return [
    employee.personalInfo?.legalFirstName,
    employee.personalInfo?.legalLastName,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function schedulingAuthorization(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'RECEPTIONIST',
      'REGISTRAR',
      'CALL_CENTER',
      'NURSE',
      'DOCTOR',
      'CONSULTANT',
      'SYSTEM_ADMIN',
      'ADMINISTRATOR',
    ],
  });
}

function requireActorSchedulingScope(
  context: CommandContext,
  facilityId: string,
  departmentId: string
): void {
  const roles = new Set(
    context.roles.map((role) => String(role || '').trim().toUpperCase())
  );
  if (roles.has('SYSTEM_ADMIN') || roles.has('ADMINISTRATOR')) return;

  const facilityIds = new Set(
    (context.facilityIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (!facilityIds.has(facilityId)) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Actor is not assigned to the requested scheduling facility.',
      { facilityId }
    );
  }

  const departmentIds = new Set(
    [
      ...(context.departmentIds || []),
      ...(context.departmentId ? [context.departmentId] : []),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (departmentIds.size > 0 && !departmentIds.has(departmentId)) {
    throw new AtomicMutationRejectedError(
      'DEPARTMENT_SCOPE_MISMATCH',
      'Actor department assignments do not include the requested scheduling department.',
      { departmentId }
    );
  }
}

function isSlotClaimable(
  current: DomainRecord | null | undefined,
  now: number,
  owner: { appointmentId?: string; waitlistId?: string } = {}
): boolean {
  if (!current) return true;
  const status = String(current.status || '').toUpperCase();
  if (status === 'RELEASED') return true;

  if (
    owner.appointmentId &&
    String(current.appointmentId || '') === owner.appointmentId
  ) {
    return true;
  }
  if (
    owner.waitlistId &&
    String(current.waitlistId || '') === owner.waitlistId
  ) {
    return true;
  }

  if (
    status === 'HELD' &&
    Number(current.holdExpiresAt || 0) > 0 &&
    Number(current.holdExpiresAt) <= now
  ) {
    return true;
  }

  return false;
}

function buildSlotLock(input: {
  slotId: string;
  tenantId: string;
  lockScope?: 'PROVIDER' | 'PATIENT';
  subjectId?: string;
  providerEmployeeId?: string;
  patientId?: string;
  facilityId: string;
  departmentId: string;
  startAt: number;
  status: 'BOOKED' | 'HELD' | 'RELEASED';
  appointmentId?: string;
  waitlistId?: string;
  holdExpiresAt?: number;
  actorId: string;
  previous?: DomainRecord | null;
  now: number;
}): OpdAppointmentSlotLock {
  return {
    slotId: input.slotId,
    tenantId: input.tenantId,
    lockScope: input.lockScope || 'PROVIDER',
    subjectId:
      input.subjectId ||
      input.providerEmployeeId ||
      input.patientId ||
      '',
    ...(input.providerEmployeeId
      ? { providerEmployeeId: input.providerEmployeeId }
      : {}),
    ...(input.patientId ? { patientId: input.patientId } : {}),
    facilityId: input.facilityId,
    departmentId: input.departmentId,
    bucketStartAt: input.startAt,
    bucketEndAt: input.startAt + SLOT_BUCKET_MS,
    status: input.status,
    ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
    ...(input.waitlistId ? { waitlistId: input.waitlistId } : {}),
    ...(input.holdExpiresAt
      ? { holdExpiresAt: input.holdExpiresAt }
      : {}),
    revision: Number(input.previous?.revision || 0) + 1,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
}

async function resolveProviderAuthority(input: {
  tenantId: string;
  providerEmployeeId: string;
  facilityId: string;
  departmentId: string;
  startAt: number;
  endAt: number;
  timeZone: string;
}): Promise<ProviderAuthority> {
  const [employee, privileges, rosters, leaveRequests] = await Promise.all([
    DomainStateRepository.getById<EmployeeMaster>(
      input.tenantId,
      'employees',
      input.providerEmployeeId
    ),
    DomainStateRepository.queryAllEqual<ClinicalPrivilege>(
      input.tenantId,
      'clinicalPrivileges',
      'employeeId',
      input.providerEmployeeId,
      { pageSize: 100, maxRows: 500 }
    ),
    DomainStateRepository.queryAllEqual<RosterShiftEntry>(
      input.tenantId,
      'rosterAssignments',
      'employeeId',
      input.providerEmployeeId,
      { pageSize: 100, maxRows: 500 }
    ),
    DomainStateRepository.queryAllEqual<LeaveRequest>(
      input.tenantId,
      'leaveRequests',
      'employeeId',
      input.providerEmployeeId,
      { pageSize: 100, maxRows: 500 }
    ),
  ]);

  if (
    !employee ||
    employee.employmentStatus !== 'ACTIVE' ||
    !employee.facilityIds.includes(input.facilityId) ||
    !employee.departmentIds.includes(input.departmentId)
  ) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_NOT_ACTIVE',
      'Booked OPD provider must be an active employee assigned to the requested facility and department.'
    );
  }

  const localDate = localDateAt(input.startAt, input.timeZone);
  const privilege = privileges.find((candidate) => {
    const effectiveFrom = String(candidate.effectiveFrom || '').slice(0, 10);
    const effectiveUntil = String(candidate.effectiveUntil || '').slice(0, 10);
    return (
      candidate.privilegeType === 'CONSULT_OPD' &&
      candidate.status === 'GRANTED' &&
      candidate.facilityId === input.facilityId &&
      candidate.departmentId === input.departmentId &&
      (!effectiveFrom || effectiveFrom <= localDate) &&
      (!effectiveUntil || effectiveUntil >= localDate)
    );
  });

  if (!privilege) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_PRIVILEGE_REQUIRED',
      'Provider does not hold an active CONSULT_OPD privilege for the requested facility and department.'
    );
  }

  const roster = rosters.find((candidate) => {
    const rosterStart = Date.parse(candidate.startTime);
    const rosterEnd = Date.parse(candidate.endTime);
    return (
      ['PUBLISHED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(candidate.status) &&
      candidate.facilityId === input.facilityId &&
      candidate.departmentId === input.departmentId &&
      Number.isFinite(rosterStart) &&
      Number.isFinite(rosterEnd) &&
      rosterStart <= input.startAt &&
      rosterEnd >= input.endAt
    );
  });

  if (!roster) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_NOT_ROSTERED',
      'Requested appointment interval is outside the provider authoritative published roster.'
    );
  }

  const conflictingLeave = leaveRequests.find((leave) => {
    if (leave.status !== 'APPROVED') return false;
    return leave.startDate <= localDate && leave.endDate >= localDate;
  });

  if (conflictingLeave) {
    throw new AtomicMutationRejectedError(
      'OPD_PROVIDER_ON_LEAVE',
      'Requested provider has approved leave covering the appointment date.',
      { leaveId: conflictingLeave.leaveId }
    );
  }

  return {
    employee,
    providerName: providerName(employee),
    roster,
    privilege,
    departmentName:
      String(roster.departmentName || employee.primaryDepartmentName || '').trim() ||
      input.departmentId,
  };
}

async function requireActivePatient(
  tenantId: string,
  patientId: string
): Promise<DomainRecord> {
  const patient = await DomainStateRepository.getById<DomainRecord>(
    tenantId,
    'patients',
    patientId
  );
  if (!patient) {
    throw new AtomicMutationRejectedError(
      'PATIENT_NOT_FOUND',
      'Appointment patient does not exist.'
    );
  }
  if (
    ['MERGED', 'DECEASED', 'INACTIVE'].includes(
      String(patient.status || '').toUpperCase()
    )
  ) {
    throw new AtomicMutationRejectedError(
      'PATIENT_NOT_ACTIVE',
      'Appointment scheduling requires an active patient identity.'
    );
  }
  return patient;
}

function assertActivePatientSnapshot(
  patient: DomainRecord | null | undefined,
  patientId: string
): DomainRecord {
  if (!patient) {
    throw new AtomicMutationRejectedError(
      'PATIENT_IDENTITY_CHANGED',
      'Patient identity disappeared before the scheduling transaction committed.'
    );
  }
  const currentPatientId = String(
    patient.id || patient.patientId || patientId
  ).trim();
  if (
    currentPatientId !== patientId ||
    ['MERGED', 'DECEASED', 'INACTIVE'].includes(
      String(patient.status || '').toUpperCase()
    )
  ) {
    throw new AtomicMutationRejectedError(
      'PATIENT_IDENTITY_CHANGED',
      'Patient identity changed or is no longer active before scheduling commit.'
    );
  }
  return patient;
}


function requireOpdCheckInEligibility(patient: DomainRecord): void {
  const consent = (
    patient.consentSummary as
      | Record<string, { status?: string; consentId?: string }>
      | undefined
  )?.GENERAL_OUTPATIENT;
  if (String(consent?.status || '').toUpperCase() !== 'GRANTED') {
    throw new AtomicMutationRejectedError(
      'GENERAL_OPD_CONSENT_REQUIRED',
      'General OPD Care consent is required before appointment check-in.'
    );
  }

  if (String(patient.tariffPlan || '').toUpperCase() !== 'OUT_OF_POCKET') {
    throw new AtomicMutationRejectedError(
      'OPD_PILOT_PAYER_NOT_SUPPORTED',
      'The controlled OPD pilot currently supports OUT_OF_POCKET cash billing only.'
    );
  }
}

export class OpdAppointmentDomainService {
  public static async listAvailability(
    context: CommandContext,
    input: {
      facilityId: string;
      departmentId: string;
      date: string;
      timeZone: string;
      durationMinutes?: number;
    }
  ): Promise<{
    providers: Array<{
      providerEmployeeId: string;
      providerName: string;
      departmentId: string;
      departmentName: string;
      facilityId: string;
      slots: Array<{
        startAt: number;
        endAt: number;
        rosterId: string;
        privilegeId: string;
      }>;
    }>;
  }> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      throw new AtomicMutationRejectedError(
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD scheduling read authority required.'
      );
    }
    requireActorSchedulingScope(
      context,
      input.facilityId,
      input.departmentId
    );

    assertTimeZone(input.timeZone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new AtomicMutationRejectedError(
        'INVALID_AVAILABILITY_DATE',
        'Availability date must use YYYY-MM-DD.'
      );
    }
    const durationMinutes = Number(input.durationMinutes || 20);
    if (
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes < MIN_APPOINTMENT_MINUTES ||
      durationMinutes > MAX_APPOINTMENT_MINUTES ||
      durationMinutes % 5 !== 0
    ) {
      throw new AtomicMutationRejectedError(
        'INVALID_APPOINTMENT_DURATION',
        'Availability duration must be a 5-minute multiple between 10 and 120 minutes.'
      );
    }

    const rosters = await DomainStateRepository.queryAllEqual<RosterShiftEntry>(
      context.tenantId,
      'rosterAssignments',
      'departmentId',
      input.departmentId,
      { pageSize: 200, maxRows: 2000 }
    );
    const relevantRosters = rosters.filter(
      (roster) =>
        roster.facilityId === input.facilityId &&
        roster.date === input.date &&
        ['PUBLISHED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(roster.status)
    );

    const providers: Array<{
      providerEmployeeId: string;
      providerName: string;
      departmentId: string;
      departmentName: string;
      facilityId: string;
      slots: Array<{
        startAt: number;
        endAt: number;
        rosterId: string;
        privilegeId: string;
      }>;
    }> = [];

    for (const roster of relevantRosters.slice(0, 100)) {
      const rosterStart = Date.parse(roster.startTime);
      const rosterEnd = Date.parse(roster.endTime);
      if (
        !Number.isFinite(rosterStart) ||
        !Number.isFinite(rosterEnd) ||
        rosterEnd <= rosterStart
      ) {
        continue;
      }

      const [employee, privileges, leaves, locks] = await Promise.all([
        DomainStateRepository.getById<EmployeeMaster>(
          context.tenantId,
          'employees',
          roster.employeeId
        ),
        DomainStateRepository.queryAllEqual<ClinicalPrivilege>(
          context.tenantId,
          'clinicalPrivileges',
          'employeeId',
          roster.employeeId,
          { pageSize: 100, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<LeaveRequest>(
          context.tenantId,
          'leaveRequests',
          'employeeId',
          roster.employeeId,
          { pageSize: 100, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<OpdAppointmentSlotLock>(
          context.tenantId,
          'opdAppointmentSlots',
          'providerEmployeeId',
          roster.employeeId,
          { pageSize: 200, maxRows: 5000 }
        ),
      ]);

      if (
        !employee ||
        employee.employmentStatus !== 'ACTIVE' ||
        !employee.facilityIds.includes(input.facilityId) ||
        !employee.departmentIds.includes(input.departmentId)
      ) {
        continue;
      }

      const privilege = privileges.find((candidate) => {
        const from = String(candidate.effectiveFrom || '').slice(0, 10);
        const until = String(candidate.effectiveUntil || '').slice(0, 10);
        return (
          candidate.privilegeType === 'CONSULT_OPD' &&
          candidate.status === 'GRANTED' &&
          candidate.facilityId === input.facilityId &&
          candidate.departmentId === input.departmentId &&
          (!from || from <= input.date) &&
          (!until || until >= input.date)
        );
      });
      if (!privilege) continue;

      if (
        leaves.some(
          (leave) =>
            leave.status === 'APPROVED' &&
            leave.startDate <= input.date &&
            leave.endDate >= input.date
        )
      ) {
        continue;
      }

      const unavailableBuckets = new Set(
        locks
          .filter((lock) => {
            if (lock.status === 'BOOKED') return true;
            return (
              lock.status === 'HELD' &&
              Number(lock.holdExpiresAt || 0) > Date.now()
            );
          })
          .map((lock) => lock.bucketStartAt)
      );

      const slots: Array<{
        startAt: number;
        endAt: number;
        rosterId: string;
        privilegeId: string;
      }> = [];
      let cursor =
        Math.ceil(rosterStart / SLOT_BUCKET_MS) * SLOT_BUCKET_MS;
      const durationMs = durationMinutes * 60_000;
      for (
        ;
        cursor + durationMs <= rosterEnd;
        cursor += SLOT_BUCKET_MS
      ) {
        if (cursor <= Date.now()) continue;
        let occupied = false;
        for (
          let bucket = cursor;
          bucket < cursor + durationMs;
          bucket += SLOT_BUCKET_MS
        ) {
          if (unavailableBuckets.has(bucket)) {
            occupied = true;
            break;
          }
        }
        if (!occupied) {
          slots.push({
            startAt: cursor,
            endAt: cursor + durationMs,
            rosterId: roster.rosterId,
            privilegeId: privilege.privilegeId,
          });
        }
      }

      if (slots.length > 0) {
        providers.push({
          providerEmployeeId: roster.employeeId,
          providerName: providerName(employee),
          departmentId: roster.departmentId,
          departmentName:
            String(roster.departmentName || employee.primaryDepartmentName || '').trim() ||
            roster.departmentId,
          facilityId: roster.facilityId,
          slots,
        });
      }
    }

    const mergedProviders = new Map<string, (typeof providers)[number]>();
    for (const provider of providers) {
      const key = [
        provider.facilityId,
        provider.departmentId,
        provider.providerEmployeeId,
      ].join(':');
      const existing = mergedProviders.get(key);
      if (!existing) {
        mergedProviders.set(key, {
          ...provider,
          slots: [...provider.slots],
        });
        continue;
      }
      const slotByStart = new Map(
        existing.slots.map((slot) => [slot.startAt, slot])
      );
      for (const slot of provider.slots) {
        slotByStart.set(slot.startAt, slot);
      }
      existing.slots = [...slotByStart.values()].sort(
        (left, right) => left.startAt - right.startAt
      );
    }

    return {
      providers: [...mergedProviders.values()].sort((left, right) =>
        left.providerName.localeCompare(right.providerName)
      ),
    };
  }

  public static async book(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: BookOpdAppointmentPayload
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD scheduling authority required.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        payload.facilityId,
        payload.departmentId
      );
      const { startAt, endAt } = normalizeInterval(payload);
      if (startAt <= Date.now()) {
        return reject(
          commandId,
          idempotencyKey,
          'APPOINTMENT_MUST_BE_FUTURE',
          'A new OPD appointment must be scheduled in the future.'
        );
      }

      const [patient, authority] = await Promise.all([
        requireActivePatient(context.tenantId, payload.patientId),
        resolveProviderAuthority({
          tenantId: context.tenantId,
          providerEmployeeId: payload.providerEmployeeId,
          facilityId: payload.facilityId,
          departmentId: payload.departmentId,
          startAt,
          endAt,
          timeZone: payload.timeZone,
        }),
      ]);

      const appointmentId = deterministicId(
        'appt',
        context.tenantId,
        commandId
      );
      const slotIds = intervalSlotIds(
        payload.providerEmployeeId,
        startAt,
        endAt
      );
      const patientSlotIds: string[] = [];
      for (let cursor = startAt; cursor < endAt; cursor += SLOT_BUCKET_MS) {
        patientSlotIds.push(patientSlotId(payload.patientId, cursor));
      }
      const now = Date.now();

      const appointment: OpdAppointmentRecord = {
        appointmentId,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        patientName: String(patient.fullName || ''),
        mrn: String(patient.mrn || ''),
        providerEmployeeId: payload.providerEmployeeId,
        providerName: authority.providerName,
        facilityId: payload.facilityId,
        departmentId: payload.departmentId,
        departmentName: authority.departmentName,
        appointmentType: payload.appointmentType,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        timeZone: payload.timeZone,
        durationMinutes: payload.durationMinutes,
        chiefComplaint: payload.chiefComplaint.trim(),
        bookingChannel: payload.bookingChannel,
        status: 'CONFIRMED',
        slotIds,
        patientSlotIds,
        rescheduleHistory: [],
        providerAuthority: {
          rosterId: authority.roster.rosterId,
          privilegeId: authority.privilege.privilegeId,
          verifiedAt: now,
        },
        createdAt: now,
        createdBy: context.actorId,
        updatedAt: now,
        schemaVersion: 1,
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_APPOINTMENT',
        aggregateId: appointmentId,
        eventType: 'OPD_APPOINTMENT_BOOKED',
        auditAction: 'BOOK_OPD_APPOINTMENT',
        auditResourceType: 'OPD_APPOINTMENT',
        auditResourceId: appointmentId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: appointmentId,
            required: false,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: payload.patientId,
            required: true,
          },
          ...providerAuthorityReadTargets({
            authority,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          }),
          ...slotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
          ...patientSlotIds.map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
        ],
        prepare: (current) => {
          const currentPatient = assertActivePatientSnapshot(
            current.patient,
            payload.patientId
          );
          assertProviderAuthoritySnapshot(current, {
            authority,
            providerEmployeeId: payload.providerEmployeeId,
            facilityId: payload.facilityId,
            departmentId: payload.departmentId,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          });
          if (current.appointment) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_IDENTITY_ALREADY_EXISTS',
              'Appointment identity already exists.'
            );
          }

          for (const slotId of slotIds) {
            const lock = current[`slot:${slotId}`] || null;
            if (!isSlotClaimable(lock, now)) {
              throw new AtomicMutationRejectedError(
                'OPD_APPOINTMENT_SLOT_CONFLICT',
                'One or more provider time buckets are already booked or actively held.',
                { slotId }
              );
            }
          }
          for (const slotId of patientSlotIds) {
            const lock = current[`patientSlot:${slotId}`] || null;
            if (!isSlotClaimable(lock, now)) {
              throw new AtomicMutationRejectedError(
                'OPD_PATIENT_APPOINTMENT_CONFLICT',
                'Patient already has an overlapping appointment.',
                { slotId }
              );
            }
          }

          const providerWrites = slotIds.map((slotId, index) => {
              const previous = current[`slot:${slotId}`] || null;
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  providerEmployeeId: payload.providerEmployeeId,
                  facilityId: payload.facilityId,
                  departmentId: payload.departmentId,
                  startAt: startAt + index * SLOT_BUCKET_MS,
                  status: 'BOOKED',
                  appointmentId,
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(previous?._serverVersion || 0),
              };
            });
          const patientWrites = patientSlotIds.map((slotId, index) => {
            const previous = current[`patientSlot:${slotId}`] || null;
            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                lockScope: 'PATIENT',
                subjectId: payload.patientId,
                patientId: payload.patientId,
                facilityId: payload.facilityId,
                departmentId: payload.departmentId,
                startAt: startAt + index * SLOT_BUCKET_MS,
                status: 'BOOKED',
                appointmentId,
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });

          const committedAppointment: OpdAppointmentRecord = {
            ...appointment,
            patientName: String(currentPatient.fullName || appointment.patientName),
            mrn: String(currentPatient.mrn || appointment.mrn),
          };

          return {
            domainState: committedAppointment,
            additionalStateWrites: [...providerWrites, ...patientWrites],
            eventPayload: {
              appointmentId,
              patientId: payload.patientId,
              providerEmployeeId: payload.providerEmployeeId,
              facilityId: payload.facilityId,
              departmentId: payload.departmentId,
              scheduledStartAt: startAt,
              scheduledEndAt: endAt,
              slotIds,
              rosterId: authority.roster.rosterId,
              privilegeId: authority.privilege.privilegeId,
            },
            auditReason:
              `Booked OPD appointment ${appointmentId} for ${appointment.patientName} with ${appointment.providerName}.`,
            resultData: { appointment: committedAppointment },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async cancel(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { appointmentId: string; reason: string }
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD scheduling authority required.'
      );
    }

    const link = await DomainStateRepository.getById<
      OpdAppointmentRecord & { _serverVersion?: number }
    >(context.tenantId, 'opdAppointments', payload.appointmentId);
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_NOT_FOUND',
        'Appointment does not exist.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.departmentId
      );
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_APPOINTMENT',
        aggregateId: payload.appointmentId,
        eventType: 'OPD_APPOINTMENT_CANCELLED',
        auditAction: 'CANCEL_OPD_APPOINTMENT',
        auditResourceType: 'OPD_APPOINTMENT',
        auditResourceId: payload.appointmentId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: payload.appointmentId,
            required: true,
          },
          ...link.slotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
          ...(link.patientSlotIds || []).map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const appointment = current.appointment as unknown as OpdAppointmentRecord;
          if (
            !['CONFIRMED', 'RESCHEDULED'].includes(appointment.status)
          ) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_NOT_CANCELLABLE',
              `Appointment in status ${appointment.status} cannot be cancelled.`
            );
          }

          const now = Date.now();
          if (now >= appointment.scheduledStartAt) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_ALREADY_STARTED',
              'An appointment cannot be cancelled after its authoritative scheduled start. Use check-in or no-show handling.'
            );
          }
          const updated: OpdAppointmentRecord = {
            ...appointment,
            status: 'CANCELLED',
            cancellationReason: payload.reason.trim(),
            cancelledAt: now,
            cancelledBy: context.actorId,
            updatedAt: now,
          };

          const providerSlotWrites = appointment.slotIds.map((slotId, index) => {
            const previous = current[`slot:${slotId}`] || null;
            if (
              String(previous?.appointmentId || '') !== appointment.appointmentId
            ) {
              throw new AtomicMutationRejectedError(
                'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                'Appointment provider-slot ownership changed before cancellation.'
              );
            }
            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                providerEmployeeId: appointment.providerEmployeeId,
                facilityId: appointment.facilityId,
                departmentId: appointment.departmentId,
                startAt:
                  appointment.scheduledStartAt + index * SLOT_BUCKET_MS,
                status: 'RELEASED',
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });
          const patientSlotWrites = (appointment.patientSlotIds || []).map(
            (slotId, index) => {
              const previous = current[`patientSlot:${slotId}`] || null;
              if (
                String(previous?.appointmentId || '') !==
                appointment.appointmentId
              ) {
                throw new AtomicMutationRejectedError(
                  'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                  'Appointment patient-slot ownership changed before cancellation.'
                );
              }
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  lockScope: 'PATIENT',
                  subjectId: appointment.patientId,
                  patientId: appointment.patientId,
                  facilityId: appointment.facilityId,
                  departmentId: appointment.departmentId,
                  startAt:
                    appointment.scheduledStartAt + index * SLOT_BUCKET_MS,
                  status: 'RELEASED',
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(previous?._serverVersion || 0),
              };
            }
          );

          return {
            domainState: updated,
            additionalStateWrites: [
              ...providerSlotWrites,
              ...patientSlotWrites,
            ],
            eventPayload: {
              appointmentId: appointment.appointmentId,
              patientId: appointment.patientId,
              reason: payload.reason.trim(),
            },
            auditReason: `Cancelled OPD appointment ${appointment.appointmentId}: ${payload.reason.trim()}`,
            resultData: { appointment: updated },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async reschedule(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RescheduleOpdAppointmentPayload
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD scheduling authority required.'
      );
    }

    const link = await DomainStateRepository.getById<
      OpdAppointmentRecord & { _serverVersion?: number }
    >(
      context.tenantId,
      'opdAppointments',
      payload.appointmentId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_NOT_FOUND',
        'Appointment does not exist.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.departmentId
      );
      const { startAt, endAt } = normalizeInterval(payload);
      if (startAt <= Date.now()) {
        return reject(
          commandId,
          idempotencyKey,
          'APPOINTMENT_MUST_BE_FUTURE',
          'Rescheduled appointment must be in the future.'
        );
      }

      const authority = await resolveProviderAuthority({
        tenantId: context.tenantId,
        providerEmployeeId: link.providerEmployeeId,
        facilityId: link.facilityId,
        departmentId: link.departmentId,
        startAt,
        endAt,
        timeZone: payload.timeZone,
      });
      const newSlotIds = intervalSlotIds(
        link.providerEmployeeId,
        startAt,
        endAt
      );
      const newPatientSlotIds: string[] = [];
      for (let cursor = startAt; cursor < endAt; cursor += SLOT_BUCKET_MS) {
        newPatientSlotIds.push(patientSlotId(link.patientId, cursor));
      }
      const allSlotIds = [...new Set([...link.slotIds, ...newSlotIds])];
      const allPatientSlotIds = [
        ...new Set([
          ...(link.patientSlotIds || []),
          ...newPatientSlotIds,
        ]),
      ];
      const now = Date.now();

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_APPOINTMENT',
        aggregateId: payload.appointmentId,
        eventType: 'OPD_APPOINTMENT_RESCHEDULED',
        auditAction: 'RESCHEDULE_OPD_APPOINTMENT',
        auditResourceType: 'OPD_APPOINTMENT',
        auditResourceId: payload.appointmentId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: payload.appointmentId,
            required: true,
          },
          ...providerAuthorityReadTargets({
            authority,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          }),
          ...allSlotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
          ...allPatientSlotIds.map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
        ],
        prepare: (current) => {
          const appointment = current.appointment as unknown as
            OpdAppointmentRecord & { _serverVersion?: number };

          const sameStringSet = (left: string[] = [], right: string[] = []) =>
            left.length === right.length &&
            [...left].sort().every(
              (value, index) => value === [...right].sort()[index]
            );

          if (
            Number(appointment._serverVersion || 0) !==
              Number(link._serverVersion || 0) ||
            appointment.scheduledStartAt !== link.scheduledStartAt ||
            appointment.scheduledEndAt !== link.scheduledEndAt ||
            !sameStringSet(appointment.slotIds, link.slotIds) ||
            !sameStringSet(
              appointment.patientSlotIds || [],
              link.patientSlotIds || []
            )
          ) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_RESCHEDULE_CONCURRENCY_RETRY_REQUIRED',
              'Appointment schedule changed after reschedule preflight. Refresh authoritative appointment state and retry.'
            );
          }

          assertProviderAuthoritySnapshot(current, {
            authority,
            providerEmployeeId: appointment.providerEmployeeId,
            facilityId: appointment.facilityId,
            departmentId: appointment.departmentId,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          });
          if (!['CONFIRMED', 'RESCHEDULED'].includes(appointment.status)) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_NOT_RESCHEDULABLE',
              `Appointment in status ${appointment.status} cannot be rescheduled.`
            );
          }
          if (Date.now() >= appointment.scheduledStartAt) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_ALREADY_STARTED',
              'An appointment cannot be rescheduled after its authoritative scheduled start. Use check-in or no-show handling.'
            );
          }

          for (const slotId of newSlotIds) {
            const lock = current[`slot:${slotId}`] || null;
            if (
              !isSlotClaimable(lock, now, {
                appointmentId: appointment.appointmentId,
              })
            ) {
              throw new AtomicMutationRejectedError(
                'OPD_APPOINTMENT_SLOT_CONFLICT',
                'Requested replacement slot conflicts with another appointment or active waitlist hold.',
                { slotId }
              );
            }
          }
          for (const slotId of newPatientSlotIds) {
            const lock = current[`patientSlot:${slotId}`] || null;
            if (
              !isSlotClaimable(lock, now, {
                appointmentId: appointment.appointmentId,
              })
            ) {
              throw new AtomicMutationRejectedError(
                'OPD_PATIENT_APPOINTMENT_CONFLICT',
                'Patient already has another appointment overlapping the requested replacement slot.',
                { slotId }
              );
            }
          }

          const updated: OpdAppointmentRecord = {
            ...appointment,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            timeZone: payload.timeZone,
            durationMinutes: payload.durationMinutes,
            status: 'RESCHEDULED',
            slotIds: newSlotIds,
            patientSlotIds: newPatientSlotIds,
            providerName: authority.providerName,
            departmentName: authority.departmentName,
            providerAuthority: {
              rosterId: authority.roster.rosterId,
              privilegeId: authority.privilege.privilegeId,
              verifiedAt: now,
            },
            rescheduleHistory: [
              ...(appointment.rescheduleHistory || []),
              {
                fromStartAt: appointment.scheduledStartAt,
                fromEndAt: appointment.scheduledEndAt,
                toStartAt: startAt,
                toEndAt: endAt,
                reason: payload.reason.trim(),
                changedAt: now,
                changedBy: context.actorId,
              },
            ],
            updatedAt: now,
          };

          const oldSet = new Set(appointment.slotIds);
          const newSet = new Set(newSlotIds);
          const writes = allSlotIds.map((slotId) => {
            const previous = current[`slot:${slotId}`] || null;
            const newIndex = newSlotIds.indexOf(slotId);
            const oldIndex = appointment.slotIds.indexOf(slotId);

            if (newSet.has(slotId)) {
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  providerEmployeeId: appointment.providerEmployeeId,
                  facilityId: appointment.facilityId,
                  departmentId: appointment.departmentId,
                  startAt: startAt + newIndex * SLOT_BUCKET_MS,
                  status: 'BOOKED',
                  appointmentId: appointment.appointmentId,
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(previous?._serverVersion || 0),
              };
            }

            if (
              oldSet.has(slotId) &&
              String(previous?.appointmentId || '') !== appointment.appointmentId
            ) {
              throw new AtomicMutationRejectedError(
                'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                'Existing appointment slot ownership changed before reschedule.'
              );
            }

            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                providerEmployeeId: appointment.providerEmployeeId,
                facilityId: appointment.facilityId,
                departmentId: appointment.departmentId,
                startAt:
                  appointment.scheduledStartAt +
                  Math.max(0, oldIndex) * SLOT_BUCKET_MS,
                status: 'RELEASED',
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });

          const oldPatientSet = new Set(
            appointment.patientSlotIds || []
          );
          const newPatientSet = new Set(newPatientSlotIds);
          const patientWrites = allPatientSlotIds.map((slotId) => {
            const previous = current[`patientSlot:${slotId}`] || null;
            const newIndex = newPatientSlotIds.indexOf(slotId);
            const oldIndex = (appointment.patientSlotIds || []).indexOf(slotId);

            if (newPatientSet.has(slotId)) {
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  lockScope: 'PATIENT',
                  subjectId: appointment.patientId,
                  patientId: appointment.patientId,
                  facilityId: appointment.facilityId,
                  departmentId: appointment.departmentId,
                  startAt: startAt + newIndex * SLOT_BUCKET_MS,
                  status: 'BOOKED',
                  appointmentId: appointment.appointmentId,
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(previous?._serverVersion || 0),
              };
            }

            if (
              oldPatientSet.has(slotId) &&
              String(previous?.appointmentId || '') !==
                appointment.appointmentId
            ) {
              throw new AtomicMutationRejectedError(
                'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                'Existing patient appointment-slot ownership changed before reschedule.'
              );
            }

            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                lockScope: 'PATIENT',
                subjectId: appointment.patientId,
                patientId: appointment.patientId,
                facilityId: appointment.facilityId,
                departmentId: appointment.departmentId,
                startAt:
                  appointment.scheduledStartAt +
                  Math.max(0, oldIndex) * SLOT_BUCKET_MS,
                status: 'RELEASED',
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });

          return {
            domainState: updated,
            additionalStateWrites: [...writes, ...patientWrites],
            eventPayload: {
              appointmentId: appointment.appointmentId,
              fromStartAt: appointment.scheduledStartAt,
              fromEndAt: appointment.scheduledEndAt,
              toStartAt: startAt,
              toEndAt: endAt,
              reason: payload.reason.trim(),
            },
            auditReason:
              `Rescheduled OPD appointment ${appointment.appointmentId}: ${payload.reason.trim()}`,
            resultData: { appointment: updated },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async checkIn(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { appointmentId: string }
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD check-in authority required.'
      );
    }

    const link = await DomainStateRepository.getById<OpdAppointmentRecord>(
      context.tenantId,
      'opdAppointments',
      payload.appointmentId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_NOT_FOUND',
        'Appointment does not exist.'
      );
    }

    const patient = await requireActivePatient(
      context.tenantId,
      link.patientId
    );
    const now = Date.now();
    if (now < link.scheduledStartAt - CHECKIN_EARLY_WINDOW_MS) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_CHECKIN_TOO_EARLY',
        'Appointment check-in is not allowed more than 60 minutes before the authoritative scheduled start.'
      );
    }
    if (now > link.scheduledEndAt + CHECKIN_LATE_WINDOW_MS) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_CHECKIN_WINDOW_EXPIRED',
        'Appointment check-in window has expired. Mark no-show or reschedule instead.'
      );
    }

    const legacyActiveEncounterId = String(
      patient.activeEncounterId || ''
    ).trim();
    const legacyActiveEncounter = legacyActiveEncounterId
      ? await DomainStateRepository.getById<DomainRecord>(
          context.tenantId,
          'encounters',
          legacyActiveEncounterId
        )
      : null;
    const legacyActiveOpdConflict =
      Boolean(legacyActiveEncounter) &&
      String(
        legacyActiveEncounter?.encounterType ||
          legacyActiveEncounter?.type ||
          ''
      ).toUpperCase() === 'OPD' &&
      !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
        String(legacyActiveEncounter?.status || '').toUpperCase()
      );

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.departmentId
      );
      requireOpdCheckInEligibility(patient);
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }

    let authority: ProviderAuthority;
    try {
      authority = await resolveProviderAuthority({
        tenantId: context.tenantId,
        providerEmployeeId: link.providerEmployeeId,
        facilityId: link.facilityId,
        departmentId: link.departmentId,
        startAt: link.scheduledStartAt,
        endAt: link.scheduledEndAt,
        timeZone: link.timeZone,
      });
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }

    const encounterId = deterministicId(
      'enc_opd_appt',
      context.tenantId,
      commandId
    );
    const tokenId = `opd_${encounterId}`;

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'RECEPTIONIST',
        aggregateType: 'OPD_APPOINTMENT',
        aggregateId: payload.appointmentId,
        eventType: 'OPD_APPOINTMENT_CHECKED_IN',
        auditAction: 'CHECK_IN_OPD_APPOINTMENT',
        auditResourceType: 'OPD_APPOINTMENT',
        auditResourceId: payload.appointmentId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: payload.appointmentId,
            required: true,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: link.patientId,
            required: true,
          },
          ...providerAuthorityReadTargets({
            authority,
            startAt: link.scheduledStartAt,
            endAt: link.scheduledEndAt,
            timeZone: link.timeZone,
          }),
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: encounterId,
            required: false,
          },
          {
            key: 'queueToken',
            entityType: 'OPD_QUEUE_TOKEN',
            entityId: tokenId,
            required: false,
          },
        ],
        prepare: (current) => {
          const appointment = current.appointment as unknown as OpdAppointmentRecord;
          const currentPatient = current.patient || {};
          assertProviderAuthoritySnapshot(current, {
            authority,
            providerEmployeeId: appointment.providerEmployeeId,
            facilityId: appointment.facilityId,
            departmentId: appointment.departmentId,
            startAt: appointment.scheduledStartAt,
            endAt: appointment.scheduledEndAt,
            timeZone: appointment.timeZone,
          });

          if (!['CONFIRMED', 'RESCHEDULED'].includes(appointment.status)) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_NOT_CHECKIN_ELIGIBLE',
              `Appointment in status ${appointment.status} cannot be checked in.`
            );
          }
          if (
            String(currentPatient.id || currentPatient.patientId || link.patientId) !==
              link.patientId ||
            ['MERGED', 'DECEASED', 'INACTIVE'].includes(
              String(currentPatient.status || '').toUpperCase()
            )
          ) {
            throw new AtomicMutationRejectedError(
              'PATIENT_NOT_ACTIVE',
              'Appointment patient is no longer an active patient identity.'
            );
          }
          requireOpdCheckInEligibility(currentPatient);

          const carePointers = normalizePatientCarePointers(
            currentPatient.activeCareContexts as any
          );
          if (
            carePointers.activeOpdEncounterIds.length > 0 ||
            (
              legacyActiveOpdConflict &&
              String(currentPatient.activeEncounterId || '') ===
                legacyActiveEncounterId
            )
          ) {
            throw new AtomicMutationRejectedError(
              'PATIENT_ACTIVE_OPD_ENCOUNTER_CONFLICT',
              'Patient already has an active OPD encounter and cannot be checked into a second OPD encounter.'
            );
          }
          const commitNow = Date.now();
          if (
            commitNow < appointment.scheduledStartAt - CHECKIN_EARLY_WINDOW_MS ||
            commitNow >
              appointment.scheduledEndAt + CHECKIN_LATE_WINDOW_MS
          ) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_CHECKIN_WINDOW_CHANGED',
              'Appointment check-in window changed or expired before commit.'
            );
          }
          if (current.encounter || current.queueToken) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_CHECKIN_IDENTITY_CONFLICT',
              'Deterministic check-in encounter or queue identity already exists.'
            );
          }

          const activeCareContexts = activateCareContext(
            currentPatient.activeCareContexts as any,
            'OPD',
            encounterId,
            now
          );
          const patientState = {
            ...currentPatient,
            activeCareContexts,
            activeEncounterId: compatibilityEncounterId(activeCareContexts),
            updatedAt: now,
          };

          const encounterState = {
            encounterId,
            tenantId: context.tenantId,
            patientId: appointment.patientId,
            encounterType: 'OPD',
            chiefComplaint: appointment.chiefComplaint,
            departmentId: appointment.departmentId,
            facilityId: appointment.facilityId,
            status: 'ACTIVE',
            currentStage: 'REGISTERED',
            clinicalState: 'REGISTERED',
            operationalState: 'QUEUED',
            financialClearanceState: 'CONSULTATION_PAYMENT_PENDING',
            resourceAssignmentState: 'NONE',
            priority: 'ROUTINE',
            assignedProviderId: appointment.providerEmployeeId,
            sourceAppointmentId: appointment.appointmentId,
            createdAt: now,
            updatedAt: now,
          };

          const queueState = {
            id: tokenId,
            encounterId,
            patientId: appointment.patientId,
            patientName: appointment.patientName,
            mrn: appointment.mrn,
            tokenNumber: `OPD-${encounterId.slice(-6).toUpperCase()}`,
            department: appointment.departmentId,
            assignedDoctorId: appointment.providerEmployeeId,
            assignedDoctorName: appointment.providerName,
            priority: 'routine',
            status: 'payment_pending',
            arrivalTime: new Date(now).toISOString(),
            sourceAppointmentId: appointment.appointmentId,
            createdAt: now,
          };

          const updatedAppointment: OpdAppointmentRecord = {
            ...appointment,
            status: 'CHECKED_IN',
            encounterId,
            queueTokenId: tokenId,
            checkedInAt: now,
            checkedInBy: context.actorId,
            updatedAt: now,
          };

          return {
            domainState: updatedAppointment,
            additionalStateWrites: [
              {
                entityType: 'PATIENT_MPI',
                entityId: appointment.patientId,
                domainState: patientState,
                expectedServerVersion: Number(
                  currentPatient._serverVersion || 0
                ),
              },
              {
                entityType: 'ENCOUNTER',
                entityId: encounterId,
                domainState: encounterState,
              },
              {
                entityType: 'OPD_QUEUE_TOKEN',
                entityId: tokenId,
                domainState: queueState,
              },
            ],
            eventPayload: {
              appointmentId: appointment.appointmentId,
              patientId: appointment.patientId,
              encounterId,
              queueTokenId: tokenId,
              financialClearanceState: 'CONSULTATION_PAYMENT_PENDING',
            },
            auditReason:
              `Checked in appointment ${appointment.appointmentId} and created OPD encounter ${encounterId}.`,
            resultData: {
              appointment: updatedAppointment,
              encounter: encounterState,
              queueToken: queueState,
              patient: patientState,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async markNoShow(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { appointmentId: string; reason: string }
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD scheduling authority required.'
      );
    }

    const link = await DomainStateRepository.getById<OpdAppointmentRecord>(
      context.tenantId,
      'opdAppointments',
      payload.appointmentId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_NOT_FOUND',
        'Appointment does not exist.'
      );
    }

    if (Date.now() < link.scheduledEndAt + NO_SHOW_GRACE_MS) {
      return reject(
        commandId,
        idempotencyKey,
        'APPOINTMENT_NO_SHOW_TOO_EARLY',
        'Appointment cannot be marked NO_SHOW until the scheduled interval plus grace period has elapsed.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.departmentId
      );
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_APPOINTMENT',
        aggregateId: payload.appointmentId,
        eventType: 'OPD_APPOINTMENT_NO_SHOW',
        auditAction: 'MARK_OPD_APPOINTMENT_NO_SHOW',
        auditResourceType: 'OPD_APPOINTMENT',
        auditResourceId: payload.appointmentId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: payload.appointmentId,
            required: true,
          },
          ...link.slotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
          ...(link.patientSlotIds || []).map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const appointment = current.appointment as unknown as OpdAppointmentRecord;
          const now = Date.now();
          if (!['CONFIRMED', 'RESCHEDULED'].includes(appointment.status)) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_NOT_NO_SHOW_ELIGIBLE',
              `Appointment in status ${appointment.status} cannot be marked NO_SHOW.`
            );
          }
          if (now < appointment.scheduledEndAt + NO_SHOW_GRACE_MS) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_NO_SHOW_TOO_EARLY',
              'No-show grace period has not elapsed.'
            );
          }

          const updated: OpdAppointmentRecord = {
            ...appointment,
            status: 'NO_SHOW',
            noShowReason: payload.reason.trim(),
            noShowAt: now,
            noShowBy: context.actorId,
            updatedAt: now,
          };

          return {
            domainState: updated,
            additionalStateWrites: [
              ...appointment.slotIds.map((slotId, index) => {
                const previous = current[`slot:${slotId}`] || null;
                if (
                  String(previous?.appointmentId || '') !==
                  appointment.appointmentId
                ) {
                  throw new AtomicMutationRejectedError(
                    'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                    'Appointment provider-slot ownership changed before no-show finalization.'
                  );
                }
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    providerEmployeeId: appointment.providerEmployeeId,
                    facilityId: appointment.facilityId,
                    departmentId: appointment.departmentId,
                    startAt:
                      appointment.scheduledStartAt +
                      index * SLOT_BUCKET_MS,
                    status: 'RELEASED',
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }),
              ...(appointment.patientSlotIds || []).map((slotId, index) => {
                const previous = current[`patientSlot:${slotId}`] || null;
                if (
                  String(previous?.appointmentId || '') !==
                  appointment.appointmentId
                ) {
                  throw new AtomicMutationRejectedError(
                    'APPOINTMENT_SLOT_LINEAGE_MISMATCH',
                    'Appointment patient-slot ownership changed before no-show finalization.'
                  );
                }
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    lockScope: 'PATIENT',
                    subjectId: appointment.patientId,
                    patientId: appointment.patientId,
                    facilityId: appointment.facilityId,
                    departmentId: appointment.departmentId,
                    startAt:
                      appointment.scheduledStartAt +
                      index * SLOT_BUCKET_MS,
                    status: 'RELEASED',
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }),
            ],
            eventPayload: {
              appointmentId: appointment.appointmentId,
              patientId: appointment.patientId,
              reason: payload.reason.trim(),
            },
            auditReason:
              `Marked OPD appointment ${appointment.appointmentId} NO_SHOW: ${payload.reason.trim()}`,
            resultData: { appointment: updated },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async addWaitlist(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AddOpdWaitlistPayload
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD waitlist authority required.'
      );
    }

    if (payload.priority === 'CRITICAL') {
      return reject(
        commandId,
        idempotencyKey,
        'CRITICAL_PATIENT_CANNOT_WAITLIST',
        'Critical patients must be directed to immediate clinical triage/emergency assessment, not an OPD waitlist.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        payload.facilityId,
        payload.preferredDepartmentId
      );
      const patient = await requireActivePatient(
        context.tenantId,
        payload.patientId
      );

      if (payload.preferredProviderEmployeeId) {
        const provider = await DomainStateRepository.getById<EmployeeMaster>(
          context.tenantId,
          'employees',
          payload.preferredProviderEmployeeId
        );
        if (
          !provider ||
          provider.employmentStatus !== 'ACTIVE' ||
          !provider.facilityIds.includes(payload.facilityId) ||
          !provider.departmentIds.includes(payload.preferredDepartmentId)
        ) {
          return reject(
            commandId,
            idempotencyKey,
            'WAITLIST_PROVIDER_SCOPE_INVALID',
            'Preferred waitlist provider is not active in the requested facility/department.'
          );
        }
      }

      const waitlistId = deterministicId('opdwl', context.tenantId, commandId);
      const scopeId = waitlistScopeId(
        payload.patientId,
        payload.facilityId,
        payload.preferredDepartmentId
      );
      const now = Date.now();
      const entry: OpdWaitlistEntryRecord = {
        waitlistId,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        patientName: String(patient.fullName || ''),
        mrn: String(patient.mrn || ''),
        facilityId: payload.facilityId,
        preferredDepartmentId: payload.preferredDepartmentId,
        preferredDepartmentName: payload.preferredDepartmentId,
        ...(payload.preferredProviderEmployeeId
          ? {
              preferredProviderEmployeeId:
                payload.preferredProviderEmployeeId,
            }
          : {}),
        priority: payload.priority,
        notificationPreference: payload.notificationPreference,
        contactPhone: String(
          patient.contactPhone || patient.phone || ''
        ),
        ...(payload.notes?.trim() ? { notes: payload.notes.trim() } : {}),
        status: 'WAITING',
        createdAt: now,
        createdBy: context.actorId,
        updatedAt: now,
        schemaVersion: 1,
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_WAITLIST_ENTRY',
        aggregateId: waitlistId,
        eventType: 'OPD_WAITLIST_ENTRY_CREATED',
        auditAction: 'CREATE_OPD_WAITLIST_ENTRY',
        auditResourceType: 'OPD_WAITLIST_ENTRY',
        auditResourceId: waitlistId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'waitlist',
            entityType: 'OPD_WAITLIST_ENTRY',
            entityId: waitlistId,
            required: false,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: payload.patientId,
            required: true,
          },
          {
            key: 'scope',
            entityType: 'OPD_WAITLIST_SCOPE',
            entityId: scopeId,
            required: false,
          },
        ],
        prepare: (current) => {
          const currentPatient = assertActivePatientSnapshot(
            current.patient,
            payload.patientId
          );
          if (current.waitlist) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_IDENTITY_ALREADY_EXISTS',
              'Waitlist identity already exists.'
            );
          }
          const currentScope = current.scope || null;
          if (
            currentScope &&
            String(currentScope.status || '').toUpperCase() === 'ACTIVE' &&
            String(currentScope.waitlistId || '') !== waitlistId
          ) {
            throw new AtomicMutationRejectedError(
              'ACTIVE_WAITLIST_ALREADY_EXISTS',
              'Patient already has an active waitlist entry for this facility and department.',
              {
                activeWaitlistId: String(currentScope.waitlistId || ''),
                facilityId: payload.facilityId,
                departmentId: payload.preferredDepartmentId,
              }
            );
          }

          const scopeLock = buildWaitlistScopeLock({
            scopeId,
            tenantId: context.tenantId,
            patientId: payload.patientId,
            facilityId: payload.facilityId,
            departmentId: payload.preferredDepartmentId,
            status: 'ACTIVE',
            waitlistId,
            actorId: context.actorId,
            previous: currentScope,
            now,
          });

          const committedEntry: OpdWaitlistEntryRecord = {
            ...entry,
            patientName: String(currentPatient.fullName || entry.patientName),
            mrn: String(currentPatient.mrn || entry.mrn),
            contactPhone: String(
              currentPatient.contactPhone ||
                currentPatient.phone ||
                entry.contactPhone ||
                ''
            ),
          };

          return {
            domainState: committedEntry,
            additionalStateWrites: [
              {
                entityType: 'OPD_WAITLIST_SCOPE',
                entityId: scopeId,
                domainState: scopeLock,
                expectedServerVersion: Number(
                  currentScope?._serverVersion || 0
                ),
              },
            ],
            eventPayload: {
              waitlistId,
              patientId: entry.patientId,
              facilityId: entry.facilityId,
              departmentId: entry.preferredDepartmentId,
              priority: entry.priority,
            },
            auditReason:
              `Added patient ${entry.patientId} to OPD waitlist ${waitlistId}.`,
            resultData: { waitlist: committedEntry },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: waitlistId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async offerWaitlistSlot(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: OfferOpdWaitlistSlotPayload
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD waitlist authority required.'
      );
    }

    const link = await DomainStateRepository.getById<OpdWaitlistEntryRecord>(
      context.tenantId,
      'opdWaitlist',
      payload.waitlistId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'WAITLIST_NOT_FOUND',
        'Waitlist entry does not exist.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.preferredDepartmentId
      );
      const { startAt, endAt } = normalizeInterval(payload);
      if (startAt <= Date.now()) {
        return reject(
          commandId,
          idempotencyKey,
          'APPOINTMENT_MUST_BE_FUTURE',
          'Waitlist slot offer must be in the future.'
        );
      }

      const authority = await resolveProviderAuthority({
        tenantId: context.tenantId,
        providerEmployeeId: payload.providerEmployeeId,
        facilityId: link.facilityId,
        departmentId: link.preferredDepartmentId,
        startAt,
        endAt,
        timeZone: payload.timeZone,
      });

      if (
        link.preferredProviderEmployeeId &&
        link.preferredProviderEmployeeId !== payload.providerEmployeeId
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'WAITLIST_PROVIDER_PREFERENCE_MISMATCH',
          'Offered provider does not match the patient preferred provider.'
        );
      }

      const ttlMinutes = Math.min(
        MAX_WAITLIST_HOLD_MINUTES,
        Math.max(
          5,
          Number(payload.offerTtlMinutes || DEFAULT_WAITLIST_HOLD_MINUTES)
        )
      );
      const now = Date.now();
      const holdExpiresAt = now + ttlMinutes * 60_000;
      const newSlotIds = intervalSlotIds(
        payload.providerEmployeeId,
        startAt,
        endAt
      );
      const newPatientSlotIds: string[] = [];
      for (let cursor = startAt; cursor < endAt; cursor += SLOT_BUCKET_MS) {
        newPatientSlotIds.push(patientSlotId(link.patientId, cursor));
      }
      const priorSlotIds = link.offerSlotIds || [];
      const priorPatientSlotIds = link.offerPatientSlotIds || [];
      const allSlotIds = [...new Set([...priorSlotIds, ...newSlotIds])];
      const allPatientSlotIds = [
        ...new Set([...priorPatientSlotIds, ...newPatientSlotIds]),
      ];

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_WAITLIST_ENTRY',
        aggregateId: payload.waitlistId,
        eventType: 'OPD_WAITLIST_SLOT_OFFERED',
        auditAction: 'OFFER_OPD_WAITLIST_SLOT',
        auditResourceType: 'OPD_WAITLIST_ENTRY',
        auditResourceId: payload.waitlistId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'waitlist',
            entityType: 'OPD_WAITLIST_ENTRY',
            entityId: payload.waitlistId,
            required: true,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: link.patientId,
            required: true,
          },
          ...providerAuthorityReadTargets({
            authority,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          }),
          ...allSlotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
          ...allPatientSlotIds.map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
        ],
        prepare: (current) => {
          const entry = current.waitlist as unknown as OpdWaitlistEntryRecord;
          assertActivePatientSnapshot(current.patient, entry.patientId);
          assertProviderAuthoritySnapshot(current, {
            authority,
            providerEmployeeId: payload.providerEmployeeId,
            facilityId: entry.facilityId,
            departmentId: entry.preferredDepartmentId,
            startAt,
            endAt,
            timeZone: payload.timeZone,
          });
          const offerExpired =
            entry.status === 'OFFERED' &&
            Number(entry.offerExpiresAt || 0) <= now;
          if (entry.status !== 'WAITING' && !offerExpired) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_NOT_OFFER_ELIGIBLE',
              `Waitlist entry in status ${entry.status} cannot receive a new slot offer.`
            );
          }

          for (const slotId of newSlotIds) {
            const lock = current[`slot:${slotId}`] || null;
            if (
              !isSlotClaimable(lock, now, {
                waitlistId: entry.waitlistId,
              })
            ) {
              throw new AtomicMutationRejectedError(
                'OPD_APPOINTMENT_SLOT_CONFLICT',
                'Waitlist offer conflicts with an existing appointment or active hold.',
                { slotId }
              );
            }
          }
          for (const slotId of newPatientSlotIds) {
            const lock = current[`patientSlot:${slotId}`] || null;
            if (
              !isSlotClaimable(lock, now, {
                waitlistId: entry.waitlistId,
              })
            ) {
              throw new AtomicMutationRejectedError(
                'OPD_PATIENT_APPOINTMENT_CONFLICT',
                'Waitlist offer overlaps another appointment or active patient hold.',
                { slotId }
              );
            }
          }

          const updated: OpdWaitlistEntryRecord = {
            ...entry,
            status: 'OFFERED',
            offeredProviderEmployeeId: payload.providerEmployeeId,
            offeredProviderName: authority.providerName,
            offeredStartAt: startAt,
            offeredEndAt: endAt,
            offeredTimeZone: payload.timeZone,
            offerProviderAuthority: {
              rosterId: authority.roster.rosterId,
              privilegeId: authority.privilege.privilegeId,
              verifiedAt: now,
            },
            offerSlotIds: newSlotIds,
            offerPatientSlotIds: newPatientSlotIds,
            offerExpiresAt: holdExpiresAt,
            updatedAt: now,
          };

          const newSet = new Set(newSlotIds);
          const writes = allSlotIds.map((slotId) => {
            const previous = current[`slot:${slotId}`] || null;
            if (newSet.has(slotId)) {
              const index = newSlotIds.indexOf(slotId);
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  providerEmployeeId: payload.providerEmployeeId,
                  facilityId: entry.facilityId,
                  departmentId: entry.preferredDepartmentId,
                  startAt: startAt + index * SLOT_BUCKET_MS,
                  status: 'HELD',
                  waitlistId: entry.waitlistId,
                  holdExpiresAt,
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(
                  previous?._serverVersion || 0
                ),
              };
            }

            if (
              String(previous?.waitlistId || '') !== entry.waitlistId
            ) {
              throw new AtomicMutationRejectedError(
                'WAITLIST_SLOT_LINEAGE_MISMATCH',
                'Previous waitlist hold ownership changed before re-offer.'
              );
            }
            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                providerEmployeeId:
                  entry.offeredProviderEmployeeId ||
                  payload.providerEmployeeId,
                facilityId: entry.facilityId,
                departmentId: entry.preferredDepartmentId,
                startAt:
                  Number(entry.offeredStartAt || 0) +
                  priorSlotIds.indexOf(slotId) * SLOT_BUCKET_MS,
                status: 'RELEASED',
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });

          const newPatientSet = new Set(newPatientSlotIds);
          const patientWrites = allPatientSlotIds.map((slotId) => {
            const previous = current[`patientSlot:${slotId}`] || null;
            if (newPatientSet.has(slotId)) {
              const index = newPatientSlotIds.indexOf(slotId);
              return {
                entityType: 'OPD_APPOINTMENT_SLOT',
                entityId: slotId,
                domainState: buildSlotLock({
                  slotId,
                  tenantId: context.tenantId,
                  lockScope: 'PATIENT',
                  subjectId: entry.patientId,
                  patientId: entry.patientId,
                  facilityId: entry.facilityId,
                  departmentId: entry.preferredDepartmentId,
                  startAt: startAt + index * SLOT_BUCKET_MS,
                  status: 'HELD',
                  waitlistId: entry.waitlistId,
                  holdExpiresAt,
                  actorId: context.actorId,
                  previous,
                  now,
                }),
                expectedServerVersion: Number(
                  previous?._serverVersion || 0
                ),
              };
            }

            if (
              String(previous?.waitlistId || '') !== entry.waitlistId
            ) {
              throw new AtomicMutationRejectedError(
                'WAITLIST_PATIENT_SLOT_LINEAGE_MISMATCH',
                'Previous patient waitlist hold ownership changed before re-offer.'
              );
            }
            return {
              entityType: 'OPD_APPOINTMENT_SLOT',
              entityId: slotId,
              domainState: buildSlotLock({
                slotId,
                tenantId: context.tenantId,
                lockScope: 'PATIENT',
                subjectId: entry.patientId,
                patientId: entry.patientId,
                facilityId: entry.facilityId,
                departmentId: entry.preferredDepartmentId,
                startAt:
                  Number(entry.offeredStartAt || 0) +
                  priorPatientSlotIds.indexOf(slotId) * SLOT_BUCKET_MS,
                status: 'RELEASED',
                actorId: context.actorId,
                previous,
                now,
              }),
              expectedServerVersion: Number(previous?._serverVersion || 0),
            };
          });

          return {
            domainState: updated,
            additionalStateWrites: [...writes, ...patientWrites],
            eventPayload: {
              waitlistId: entry.waitlistId,
              patientId: entry.patientId,
              providerEmployeeId: payload.providerEmployeeId,
              offeredStartAt: startAt,
              offeredEndAt: endAt,
              offerExpiresAt: holdExpiresAt,
            },
            auditReason:
              `Offered OPD waitlist slot ${startAt}-${endAt} to ${entry.patientId}.`,
            resultData: { waitlist: updated },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.waitlistId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async acceptWaitlistOffer(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcceptOpdWaitlistOfferPayload
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD waitlist authority required.'
      );
    }

    const link = await DomainStateRepository.getById<OpdWaitlistEntryRecord>(
      context.tenantId,
      'opdWaitlist',
      payload.waitlistId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'WAITLIST_NOT_FOUND',
        'Waitlist entry does not exist.'
      );
    }

    if (
      link.status !== 'OFFERED' ||
      !link.offeredProviderEmployeeId ||
      !link.offeredStartAt ||
      !link.offeredEndAt ||
      !link.offeredTimeZone ||
      !link.offerSlotIds?.length ||
      !link.offerPatientSlotIds?.length
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'WAITLIST_OFFER_NOT_ACTIVE',
        'Waitlist entry does not contain an active complete slot offer.'
      );
    }
    if (Number(link.offerExpiresAt || 0) <= Date.now()) {
      return reject(
        commandId,
        idempotencyKey,
        'WAITLIST_OFFER_EXPIRED',
        'Waitlist slot offer has expired.'
      );
    }

    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.preferredDepartmentId
      );
      const [, authority] = await Promise.all([
        requireActivePatient(context.tenantId, link.patientId),
        resolveProviderAuthority({
          tenantId: context.tenantId,
          providerEmployeeId: link.offeredProviderEmployeeId,
          facilityId: link.facilityId,
          departmentId: link.preferredDepartmentId,
          startAt: link.offeredStartAt,
          endAt: link.offeredEndAt,
          timeZone: link.offeredTimeZone,
        }),
      ]);

      const appointmentId = deterministicId(
        'appt',
        context.tenantId,
        commandId
      );
      const patientSlotIds: string[] = [];
      for (
        let cursor = link.offeredStartAt;
        cursor < link.offeredEndAt;
        cursor += SLOT_BUCKET_MS
      ) {
        patientSlotIds.push(patientSlotId(link.patientId, cursor));
      }
      const now = Date.now();
      const scopeId = waitlistScopeId(
        link.patientId,
        link.facilityId,
        link.preferredDepartmentId
      );

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_WAITLIST_ENTRY',
        aggregateId: payload.waitlistId,
        eventType: 'OPD_WAITLIST_OFFER_ACCEPTED',
        auditAction: 'ACCEPT_OPD_WAITLIST_OFFER',
        auditResourceType: 'OPD_WAITLIST_ENTRY',
        auditResourceId: payload.waitlistId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'waitlist',
            entityType: 'OPD_WAITLIST_ENTRY',
            entityId: payload.waitlistId,
            required: true,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: link.patientId,
            required: true,
          },
          {
            key: 'appointment',
            entityType: 'OPD_APPOINTMENT',
            entityId: appointmentId,
            required: false,
          },
          {
            key: 'scope',
            entityType: 'OPD_WAITLIST_SCOPE',
            entityId: scopeId,
            required: false,
          },
          ...providerAuthorityReadTargets({
            authority,
            startAt: link.offeredStartAt,
            endAt: link.offeredEndAt,
            timeZone: link.offeredTimeZone,
          }),
          ...link.offerSlotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
          ...(link.offerPatientSlotIds || []).map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const entry = current.waitlist as unknown as OpdWaitlistEntryRecord;
          const currentPatient = assertActivePatientSnapshot(
            current.patient,
            entry.patientId
          );
          assertProviderAuthoritySnapshot(current, {
            authority,
            providerEmployeeId: String(entry.offeredProviderEmployeeId || ''),
            facilityId: entry.facilityId,
            departmentId: entry.preferredDepartmentId,
            startAt: Number(entry.offeredStartAt || 0),
            endAt: Number(entry.offeredEndAt || 0),
            timeZone: String(entry.offeredTimeZone || ''),
          });
          if (
            entry.status !== 'OFFERED' ||
            Number(entry.offerExpiresAt || 0) <= now ||
            entry.offeredProviderEmployeeId !== link.offeredProviderEmployeeId ||
            entry.offeredStartAt !== link.offeredStartAt ||
            entry.offeredEndAt !== link.offeredEndAt
          ) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_OFFER_CHANGED_OR_EXPIRED',
              'Waitlist offer changed or expired before acceptance.'
            );
          }
          if (current.appointment) {
            throw new AtomicMutationRejectedError(
              'APPOINTMENT_IDENTITY_ALREADY_EXISTS',
              'Waitlist appointment identity already exists.'
            );
          }
          const currentScope = current.scope || null;
          if (
            currentScope &&
            String(currentScope.status || '').toUpperCase() === 'ACTIVE' &&
            String(currentScope.waitlistId || '') !== entry.waitlistId
          ) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_SCOPE_LINEAGE_MISMATCH',
              'Active waitlist scope no longer belongs to the accepted waitlist entry.'
            );
          }

          for (const slotId of entry.offerSlotIds || []) {
            const lock = current[`slot:${slotId}`] || null;
            if (
              String(lock?.status || '').toUpperCase() !== 'HELD' ||
              String(lock?.waitlistId || '') !== entry.waitlistId ||
              Number(lock?.holdExpiresAt || 0) <= now
            ) {
              throw new AtomicMutationRejectedError(
                'WAITLIST_SLOT_HOLD_LOST',
                'Waitlist slot hold expired or was reclaimed before acceptance.',
                { slotId }
              );
            }
          }
          const offeredPatientSlotIds = entry.offerPatientSlotIds || [];
          if (
            offeredPatientSlotIds.length !== patientSlotIds.length ||
            offeredPatientSlotIds.some(
              (slotId, index) => slotId !== patientSlotIds[index]
            )
          ) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_PATIENT_HOLD_SET_CHANGED',
              'Waitlist patient hold set changed before acceptance.'
            );
          }
          for (const slotId of offeredPatientSlotIds) {
            const lock = current[`patientSlot:${slotId}`] || null;
            if (
              String(lock?.status || '').toUpperCase() !== 'HELD' ||
              String(lock?.waitlistId || '') !== entry.waitlistId ||
              Number(lock?.holdExpiresAt || 0) <= now
            ) {
              throw new AtomicMutationRejectedError(
                'WAITLIST_PATIENT_SLOT_HOLD_LOST',
                'Patient-side waitlist hold expired or was reclaimed before acceptance.',
                { slotId }
              );
            }
          }

          const appointment: OpdAppointmentRecord = {
            appointmentId,
            tenantId: context.tenantId,
            patientId: entry.patientId,
            patientName: String(
              currentPatient.fullName || entry.patientName
            ),
            mrn: String(currentPatient.mrn || entry.mrn),
            providerEmployeeId: entry.offeredProviderEmployeeId!,
            providerName: authority.providerName,
            facilityId: entry.facilityId,
            departmentId: entry.preferredDepartmentId,
            departmentName: authority.departmentName,
            appointmentType: payload.appointmentType,
            scheduledStartAt: entry.offeredStartAt!,
            scheduledEndAt: entry.offeredEndAt!,
            timeZone: entry.offeredTimeZone!,
            durationMinutes: Math.round(
              (entry.offeredEndAt! - entry.offeredStartAt!) / 60_000
            ),
            chiefComplaint: payload.chiefComplaint.trim(),
            bookingChannel: payload.bookingChannel || 'CALL_CENTER',
            status: 'CONFIRMED',
            slotIds: [...(entry.offerSlotIds || [])],
            patientSlotIds,
            sourceWaitlistId: entry.waitlistId,
            rescheduleHistory: [],
            providerAuthority: {
              rosterId: authority.roster.rosterId,
              privilegeId: authority.privilege.privilegeId,
              verifiedAt: now,
            },
            createdAt: now,
            createdBy: context.actorId,
            updatedAt: now,
            schemaVersion: 1,
          };

          const updatedWaitlist: OpdWaitlistEntryRecord = {
            ...entry,
            status: 'ACCEPTED',
            acceptedAppointmentId: appointmentId,
            updatedAt: now,
          };

          return {
            domainState: updatedWaitlist,
            additionalStateWrites: [
              {
                entityType: 'OPD_APPOINTMENT',
                entityId: appointmentId,
                domainState: appointment,
              },
              {
                entityType: 'OPD_WAITLIST_SCOPE',
                entityId: scopeId,
                domainState: buildWaitlistScopeLock({
                  scopeId,
                  tenantId: context.tenantId,
                  patientId: entry.patientId,
                  facilityId: entry.facilityId,
                  departmentId: entry.preferredDepartmentId,
                  status: 'RELEASED',
                  waitlistId: entry.waitlistId,
                  actorId: context.actorId,
                  previous: current.scope || null,
                  now,
                }),
                expectedServerVersion: Number(
                  current.scope?._serverVersion || 0
                ),
              },
              ...(entry.offerSlotIds || []).map((slotId, index) => {
                const previous = current[`slot:${slotId}`] || null;
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    providerEmployeeId: entry.offeredProviderEmployeeId!,
                    facilityId: entry.facilityId,
                    departmentId: entry.preferredDepartmentId,
                    startAt:
                      entry.offeredStartAt! + index * SLOT_BUCKET_MS,
                    status: 'BOOKED',
                    appointmentId,
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }),
              ...patientSlotIds.map((slotId, index) => {
                const previous = current[`patientSlot:${slotId}`] || null;
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    lockScope: 'PATIENT',
                    subjectId: entry.patientId,
                    patientId: entry.patientId,
                    facilityId: entry.facilityId,
                    departmentId: entry.preferredDepartmentId,
                    startAt:
                      entry.offeredStartAt! + index * SLOT_BUCKET_MS,
                    status: 'BOOKED',
                    appointmentId,
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }),
            ],
            eventPayload: {
              waitlistId: entry.waitlistId,
              appointmentId,
              patientId: entry.patientId,
              providerEmployeeId: entry.offeredProviderEmployeeId,
              scheduledStartAt: entry.offeredStartAt,
              scheduledEndAt: entry.offeredEndAt,
            },
            auditReason:
              `Accepted waitlist offer ${entry.waitlistId} into appointment ${appointmentId}.`,
            resultData: {
              waitlist: updatedWaitlist,
              appointment,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: appointmentId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async cancelWaitlist(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { waitlistId: string; reason: string }
  ): Promise<CommandResult> {
    const auth = schedulingAuthorization(context);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'OPD waitlist authority required.'
      );
    }

    const link = await DomainStateRepository.getById<OpdWaitlistEntryRecord>(
      context.tenantId,
      'opdWaitlist',
      payload.waitlistId
    );
    if (!link) {
      return reject(
        commandId,
        idempotencyKey,
        'WAITLIST_NOT_FOUND',
        'Waitlist entry does not exist.'
      );
    }

    const slotIds = link.offerSlotIds || [];
    const patientSlotIds = link.offerPatientSlotIds || [];
    const scopeId = waitlistScopeId(
      link.patientId,
      link.facilityId,
      link.preferredDepartmentId
    );
    try {
      requireActorSchedulingScope(
        context,
        link.facilityId,
        link.preferredDepartmentId
      );
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_SCHEDULING',
        aggregateType: 'OPD_WAITLIST_ENTRY',
        aggregateId: payload.waitlistId,
        eventType: 'OPD_WAITLIST_ENTRY_CANCELLED',
        auditAction: 'CANCEL_OPD_WAITLIST_ENTRY',
        auditResourceType: 'OPD_WAITLIST_ENTRY',
        auditResourceId: payload.waitlistId,
        outboxTopic: 'g-hims-opd-scheduling-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'waitlist',
            entityType: 'OPD_WAITLIST_ENTRY',
            entityId: payload.waitlistId,
            required: true,
          },
          {
            key: 'scope',
            entityType: 'OPD_WAITLIST_SCOPE',
            entityId: scopeId,
            required: false,
          },
          ...slotIds.map((slotId) => ({
            key: `slot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
          ...patientSlotIds.map((slotId) => ({
            key: `patientSlot:${slotId}`,
            entityType: 'OPD_APPOINTMENT_SLOT',
            entityId: slotId,
            required: false,
          })),
        ],
        prepare: (current) => {
          const entry = current.waitlist as unknown as OpdWaitlistEntryRecord;
          if (['ACCEPTED', 'CANCELLED'].includes(entry.status)) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_NOT_CANCELLABLE',
              `Waitlist entry in status ${entry.status} cannot be cancelled.`
            );
          }

          const now = Date.now();
          const updated: OpdWaitlistEntryRecord = {
            ...entry,
            status: 'CANCELLED',
            notes: [entry.notes, `Cancelled: ${payload.reason.trim()}`]
              .filter(Boolean)
              .join(' | '),
            updatedAt: now,
          };

          const writes = (entry.offerSlotIds || []).map(
            (slotId, index) => {
              const previous = current[`slot:${slotId}`] || null;
              if (
                previous &&
                String(previous.waitlistId || '') === entry.waitlistId &&
                String(previous.status || '').toUpperCase() === 'HELD'
              ) {
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    providerEmployeeId:
                      entry.offeredProviderEmployeeId || '',
                    facilityId: entry.facilityId,
                    departmentId: entry.preferredDepartmentId,
                    startAt:
                      Number(entry.offeredStartAt || 0) +
                      index * SLOT_BUCKET_MS,
                    status: 'RELEASED',
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }
              return null;
            }
          ).filter(Boolean) as Array<{
            entityType: string;
            entityId: string;
            domainState: unknown;
            expectedServerVersion: number;
          }>;

          const patientWrites = (entry.offerPatientSlotIds || [])
            .map((slotId, index) => {
              const previous = current[`patientSlot:${slotId}`] || null;
              if (
                previous &&
                String(previous.waitlistId || '') === entry.waitlistId &&
                String(previous.status || '').toUpperCase() === 'HELD'
              ) {
                return {
                  entityType: 'OPD_APPOINTMENT_SLOT',
                  entityId: slotId,
                  domainState: buildSlotLock({
                    slotId,
                    tenantId: context.tenantId,
                    lockScope: 'PATIENT',
                    subjectId: entry.patientId,
                    patientId: entry.patientId,
                    facilityId: entry.facilityId,
                    departmentId: entry.preferredDepartmentId,
                    startAt:
                      Number(entry.offeredStartAt || 0) +
                      index * SLOT_BUCKET_MS,
                    status: 'RELEASED',
                    actorId: context.actorId,
                    previous,
                    now,
                  }),
                  expectedServerVersion: Number(
                    previous?._serverVersion || 0
                  ),
                };
              }
              return null;
            })
            .filter(Boolean) as Array<{
              entityType: string;
              entityId: string;
              domainState: unknown;
              expectedServerVersion: number;
            }>;

          const currentScope = current.scope || null;
          if (
            currentScope &&
            String(currentScope.status || '').toUpperCase() === 'ACTIVE' &&
            String(currentScope.waitlistId || '') !== entry.waitlistId
          ) {
            throw new AtomicMutationRejectedError(
              'WAITLIST_SCOPE_LINEAGE_MISMATCH',
              'Active waitlist scope no longer belongs to the cancelled waitlist entry.'
            );
          }

          return {
            domainState: updated,
            additionalStateWrites: [
              ...writes,
              ...patientWrites,
              {
                entityType: 'OPD_WAITLIST_SCOPE',
                entityId: scopeId,
                domainState: buildWaitlistScopeLock({
                  scopeId,
                  tenantId: context.tenantId,
                  patientId: entry.patientId,
                  facilityId: entry.facilityId,
                  departmentId: entry.preferredDepartmentId,
                  status: 'RELEASED',
                  waitlistId: entry.waitlistId,
                  actorId: context.actorId,
                  previous: currentScope,
                  now,
                }),
                expectedServerVersion: Number(
                  currentScope?._serverVersion || 0
                ),
              },
            ],
            eventPayload: {
              waitlistId: entry.waitlistId,
              patientId: entry.patientId,
              reason: payload.reason.trim(),
            },
            auditReason:
              `Cancelled OPD waitlist entry ${entry.waitlistId}: ${payload.reason.trim()}`,
            resultData: { waitlist: updated },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.waitlistId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }
}
