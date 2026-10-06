import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP13 authoritative appointments and waitlist', () => {
  test('scheduling mutations are command-backed and server authoritative', async () => {
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    for (const command of [
      'BookOpdAppointmentCommand',
      'CancelOpdAppointmentCommand',
      'RescheduleOpdAppointmentCommand',
      'CheckInOpdAppointmentCommand',
      'MarkOpdAppointmentNoShowCommand',
      'AddOpdWaitlistEntryCommand',
      'OfferOpdWaitlistSlotCommand',
      'AcceptOpdWaitlistOfferCommand',
      'CancelOpdWaitlistEntryCommand',
    ]) {
      expect(schema).toContain(command);
      expect(bus).toContain(command);
    }

    expect(service).toContain("aggregateType: 'OPD_APPOINTMENT'");
    expect(service).toContain("aggregateType: 'OPD_WAITLIST_ENTRY'");
    expect(service).toContain("outboxTopic: 'g-hims-opd-scheduling-events'");
  });

  test('booking owns provider and patient overlap locks atomically', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain('providerSlotId');
    expect(service).toContain('patientSlotId');
    expect(service).toContain("'OPD_APPOINTMENT_SLOT_CONFLICT'");
    expect(service).toContain("'OPD_PATIENT_APPOINTMENT_CONFLICT'");
    expect(service).toContain("entityType: 'OPD_APPOINTMENT_SLOT'");
    expect(service).toContain('expectedServerVersion');
  });

  test('concurrent reschedules reject stale appointment slot snapshots', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain(
      "'APPOINTMENT_RESCHEDULE_CONCURRENCY_RETRY_REQUIRED'"
    );
    expect(service).toContain('appointment._serverVersion');
    expect(service).toContain('link._serverVersion');
    expect(service).toContain(
      'Appointment schedule changed after reschedule preflight.'
    );
  });

  test('scheduling write authority excludes ordinary clinical roles', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const start = service.indexOf('function schedulingAuthorization');
    const end = service.indexOf(
      'function requireActorSchedulingScope',
      start
    );
    const block = service.slice(start, end);

    expect(block).toContain("'RECEPTIONIST'");
    expect(block).toContain("'REGISTRAR'");
    expect(block).toContain("'CALL_CENTER'");
    expect(block).not.toContain("'NURSE'");
    expect(block).not.toContain("'DOCTOR'");
    expect(block).not.toContain("'CONSULTANT'");
  });

  test('non-admin scheduling is fail-closed to actor facility and department scope', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain('requireActorSchedulingScope');
    expect(service).toContain("'FACILITY_SCOPE_MISMATCH'");
    expect(service).toContain("'DEPARTMENT_SCOPE_MISMATCH'");
    expect(service).toContain('context.facilityIds');
    expect(service).toContain('context.departmentIds');
  });

  test('slot commits revalidate exact HCM provider authority transactionally', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain('providerAuthorityReadTargets');
    expect(service).toContain('assertProviderAuthoritySnapshot');
    expect(service).toContain("entityType: 'EMPLOYEE_MASTER'");
    expect(service).toContain("entityType: 'CLINICAL_PRIVILEGE'");
    expect(service).toContain("entityType: 'ROSTER_SHIFT'");
    expect(service).toContain("entityType: 'LEAVE_CALENDAR'");
    expect(service).toContain("'OPD_PROVIDER_AUTHORITY_CHANGED'");
    expect(service).toContain('leaveCalendarId');
    expect(service).toContain("entry.status === 'APPROVED'");
  });

  test('appointment and waitlist creation revalidate patient MPI inside atomic commits', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain('assertActivePatientSnapshot');
    expect(service).toContain("'PATIENT_IDENTITY_CHANGED'");
    expect(service).toContain("key: 'patient'");
    expect(service).toContain("entityType: 'PATIENT_MPI'");
    expect(service).toContain(
      'Patient identity changed or is no longer active before scheduling commit.'
    );
  });

  test('provider availability is derived from HCM roster privilege and leave authority', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const route = await source('app/api/opd/availability/route.ts');

    expect(service).toContain("'clinicalPrivileges'");
    expect(service).toContain("'rosterAssignments'");
    expect(service).toContain("'leaveRequests'");
    expect(service).toContain("'CONSULT_OPD'");
    expect(service).toContain("'OPD_PROVIDER_NOT_ROSTERED'");
    expect(service).toContain("'OPD_PROVIDER_ON_LEAVE'");
    expect(route).toContain('OpdAppointmentDomainService.listAvailability');
  });

  test('waitlist prevents duplicate active scope and converts offers atomically', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const scheduling = await source('types/opd-scheduling.ts');

    expect(tx).toContain("OPD_WAITLIST_SCOPE: 'opdWaitlistScopes'");
    expect(scheduling).toContain('OpdWaitlistScopeLock');
    expect(service).toContain('waitlistScopeId');
    expect(service).toContain("'ACTIVE_WAITLIST_ALREADY_EXISTS'");
    expect(service).toContain("'WAITLIST_SCOPE_LINEAGE_MISMATCH'");
    expect(service).toContain("status: 'RELEASED'");
    expect(service).toContain("'WAITLIST_SLOT_HOLD_LOST'");
  });

  test('waitlist offers hold provider and patient capacity together', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const scheduling = await source('types/opd-scheduling.ts');

    expect(scheduling).toContain('offerPatientSlotIds?: string[]');
    expect(service).toContain('offerPatientSlotIds: newPatientSlotIds');
    expect(service).toContain("'WAITLIST_PATIENT_SLOT_HOLD_LOST'");
    expect(service).toContain("'WAITLIST_PATIENT_HOLD_SET_CHANGED'");
    expect(service).toContain(
      "'WAITLIST_PATIENT_SLOT_LINEAGE_MISMATCH'"
    );
    expect(service).toContain("lockScope: 'PATIENT'");
    expect(service).toContain("status: 'HELD'");
  });

  test('expired waitlist offers are recoverable from the front desk UI', async () => {
    const ui = await source('components/opd/OpdAppointmentsWaitlist.tsx');

    expect(ui).toContain('offerExpired');
    expect(ui).toContain('OFFER EXPIRED');
    expect(ui).toContain('Re-offer Earliest Slot');
    expect(ui).toContain("w.status === 'OFFERED' && !offerExpired");
  });

  test('critical patients cannot be parked on an OPD waitlist', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain("'CRITICAL_PATIENT_CANNOT_WAITLIST'");
    expect(service).toContain(
      'Critical patients must be directed to immediate clinical triage/emergency assessment'
    );
  });

  test('appointment check-in atomically creates encounter queue and care pointer', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(service).toContain("'OPD_APPOINTMENT_CHECKED_IN'");
    expect(service).toContain("entityType: 'PATIENT_MPI'");
    expect(service).toContain("entityType: 'ENCOUNTER'");
    expect(service).toContain("entityType: 'OPD_QUEUE_TOKEN'");
    expect(service).toContain("financialClearanceState: 'CONSULTATION_PAYMENT_PENDING'");
    expect(service).toContain('sourceAppointmentId');
    expect(workspace).toContain("'CheckInOpdAppointmentCommand'");
  });

  test('linked appointment completes atomically with OPD disposition', async () => {
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );

    expect(encounter).toContain('sourceAppointmentId');
    expect(encounter).toContain("'OPD_APPOINTMENT_LINEAGE_MISMATCH'");
    expect(encounter).toContain("status: 'COMPLETED'");
    expect(encounter).toContain("entityType: 'OPD_APPOINTMENT'");
    expect(encounter).toContain('sourceAppointment._serverVersion');
  });

  test('checked-in appointments expose deterministic consultation billing recovery', async () => {
    const ui = await source('components/opd/OpdAppointmentsWaitlist.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(ui).toContain('Resume Billing');
    expect(ui).toContain('onResumeBillingAppointment');
    expect(workspace).toContain('handleResumeAppointmentBilling');
    expect(workspace).toContain(
      '`opd-consultation-invoice:${encounterId}`'
    );
    expect(workspace).toContain(
      "'OPD_CONSULTATION_INVOICE_ALREADY_EXISTS'"
    );
  });

  test('started appointments cannot be rewritten as cancellations or reschedules', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain("'APPOINTMENT_ALREADY_STARTED'");
    expect(service).toContain(
      'An appointment cannot be cancelled after its authoritative scheduled start.'
    );
    expect(service).toContain(
      'An appointment cannot be rescheduled after its authoritative scheduled start.'
    );
  });

  test('front desk hides cancel and reschedule once the appointment has started', async () => {
    const ui = await source('components/opd/OpdAppointmentsWaitlist.tsx');

    expect(ui).toContain('appointmentMutableBeforeStart');
    expect(ui).toContain('clockNow < Number(appointment.scheduledStartAt)');
    expect(ui).toContain('{appointmentMutableBeforeStart(appt) && (');
  });

  test('check-in and no-show windows are enforced using server time', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain('CHECKIN_EARLY_WINDOW_MS');
    expect(service).toContain('CHECKIN_LATE_WINDOW_MS');
    expect(service).toContain("'APPOINTMENT_CHECKIN_WINDOW_CHANGED'");
    expect(service).toContain('NO_SHOW_GRACE_MS');
    expect(service).toContain("'APPOINTMENT_NO_SHOW_TOO_EARLY'");
  });

  test('production UI has no hardcoded doctor schedules or browser conflict authority', async () => {
    const ui = await source('components/opd/OpdAppointmentsWaitlist.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(ui).not.toContain('DOCTOR_SCHEDULES');
    expect(ui).not.toContain('Booking Conflict:');
    expect(ui).not.toContain('Exertional dyspnea and follow-up review');
    expect(ui).toContain('/api/opd/availability');
    expect(workspace).toContain("'BookOpdAppointmentCommand'");
    expect(workspace).toContain("'CancelOpdAppointmentCommand'");
    expect(workspace).toContain("'RescheduleOpdAppointmentCommand'");
    expect(workspace).toContain("'MarkOpdAppointmentNoShowCommand'");
  });

  test('appointments and waitlist hydrate from authoritative edge state', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const hydration = await source('lib/offline/hydration.ts');
    const model = await source('lib/opd/workspace-read-model.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(bootstrap).toContain("'opdAppointments'");
    expect(bootstrap).toContain("'opdWaitlist'");
    expect(hydration).toContain("'opdAppointments'");
    expect(hydration).toContain("'opdWaitlist'");
    expect(model).toContain('appointments: AppointmentRecord[]');
    expect(model).toContain('waitlist: WaitlistEntry[]');
    expect(workspace).toContain('setAppointments(readModel.appointments)');
    expect(workspace).toContain('setWaitlist(readModel.waitlist)');
  });

  test('scheduling collections are client read-only and slot/scope locks remain server-only', async () => {
    const rules = await source('firestore.rules');

    expect(rules).toContain('match /opdAppointments/{appointmentId}');
    expect(rules).toContain('match /opdWaitlist/{waitlistId}');
    expect(rules).toContain('match /opdAppointmentSlots/{slotId}');
    expect(rules).toContain('match /opdWaitlistScopes/{scopeId}');
    expect(rules).toContain('allow write: if false');
  });

  test('scheduling mutations fail closed offline until RP15 replay qualification', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    for (const command of [
      "'BookOpdAppointmentCommand'",
      "'CancelOpdAppointmentCommand'",
      "'RescheduleOpdAppointmentCommand'",
      "'CheckInOpdAppointmentCommand'",
      "'MarkOpdAppointmentNoShowCommand'",
      "'AddOpdWaitlistEntryCommand'",
      "'OfferOpdWaitlistSlotCommand'",
      "'AcceptOpdWaitlistOfferCommand'",
      "'CancelOpdWaitlistEntryCommand'",
    ]) {
      const start = workspace.indexOf(command);
      expect(start).toBeGreaterThan(-1);
      const block = workspace.slice(start, start + 1800);
      expect(block).not.toContain('offlineQueue');
    }
  });
});
