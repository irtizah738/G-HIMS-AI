'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  UserCheck,
  PlusCircle,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Phone,
  MessageSquare,
  ShieldAlert,
  ArrowRight,
  Filter,
  UserPlus,
} from 'lucide-react';
import {
  AppointmentRecord,
  AppointmentType,
  AppointmentStatus,
  WaitlistEntry,
  WaitlistPriority,
  PatientDemographics,
} from '@/types/opd-domain';
import { auth as firebaseAuth } from '@/lib/firebase/client';


type AvailabilitySlot = {
  startAt: number;
  endAt: number;
  rosterId: string;
  privilegeId: string;
};

type AvailabilityProvider = {
  providerEmployeeId: string;
  providerName: string;
  departmentId: string;
  departmentName: string;
  facilityId: string;
  slots: AvailabilitySlot[];
};

interface OpdAppointmentsWaitlistProps {
  tenantId: string;
  facilityIds: string[];
  departmentIds: string[];
  isOnline: boolean;
  appointments: AppointmentRecord[];
  waitlist: WaitlistEntry[];
  patients: PatientDemographics[];
  onBookAppointment: (input: {
    patientId: string;
    providerEmployeeId: string;
    facilityId: string;
    departmentId: string;
    appointmentType: AppointmentType;
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    chiefComplaint: string;
    bookingChannel: 'FRONT_DESK';
  }) => Promise<void>;
  onCheckInAppointment: (appointment: AppointmentRecord) => Promise<void>;
  onResumeBillingAppointment: (
    appointment: AppointmentRecord
  ) => Promise<void>;
  onCancelAppointment: (appointmentId: string, reason: string) => Promise<void>;
  onRescheduleAppointment: (input: {
    appointmentId: string;
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    reason: string;
  }) => Promise<void>;
  onMarkNoShowAppointment: (
    appointmentId: string,
    reason: string
  ) => Promise<void>;
  onAddToWaitlist: (input: {
    patientId: string;
    facilityId: string;
    preferredDepartmentId: string;
    preferredProviderEmployeeId?: string;
    priority: 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';
    notificationPreference: 'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL';
    notes?: string;
  }) => Promise<void>;
  onOfferWaitlistSlot: (input: {
    waitlistId: string;
    providerEmployeeId: string;
    scheduledStartAt: number;
    durationMinutes: number;
    timeZone: string;
    offerTtlMinutes?: number;
  }) => Promise<void>;
  onAcceptWaitlistSlot: (input: {
    waitlistId: string;
    appointmentType: AppointmentType;
    chiefComplaint: string;
    bookingChannel?: string;
  }) => Promise<void>;
  onCancelWaitlist: (waitlistId: string, reason: string) => Promise<void>;
}

const DEFAULT_DURATION_MINUTES = 20;
const AVAILABILITY_LOOKAHEAD_DAYS = 14;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatDate(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return values.year + '-' + values.month + '-' + values.day;
}

function formatTime(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

export function OpdAppointmentsWaitlist({
  tenantId,
  facilityIds,
  departmentIds,
  isOnline,
  appointments,
  waitlist,
  patients,
  onBookAppointment,
  onCheckInAppointment,
  onResumeBillingAppointment,
  onCancelAppointment,
  onRescheduleAppointment,
  onMarkNoShowAppointment,
  onAddToWaitlist,
  onOfferWaitlistSlot,
  onAcceptWaitlistSlot,
  onCancelWaitlist,
}: OpdAppointmentsWaitlistProps) {
  const timeZone = useMemo(() => browserTimeZone(), []);
  const today = useMemo(
    () => formatDate(Date.now(), timeZone),
    [timeZone]
  );
  const [activeTab, setActiveTab] = useState<
    'APPOINTMENTS' | 'WAITLIST' | 'BOOK_NEW'
  >('APPOINTMENTS');
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [schedulingError, setSchedulingError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState<number>(() => Date.now());

  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [bookingFacilityId, setBookingFacilityId] = useState<string>('');
  const [bookingDepartmentId, setBookingDepartmentId] =
    useState<string>('');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [bookingType, setBookingType] =
    useState<AppointmentType>('NEW_CONSULTATION');
  const [bookingDate, setBookingDate] = useState<string>(today);
  const [bookingDurationMinutes, setBookingDurationMinutes] =
    useState<number>(DEFAULT_DURATION_MINUTES);
  const [bookingStartAt, setBookingStartAt] = useState<number | null>(null);
  const [bookingComplaint, setBookingComplaint] = useState<string>('');
  const [availability, setAvailability] = useState<AvailabilityProvider[]>([]);

  const [cancelModalAppt, setCancelModalAppt] =
    useState<AppointmentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [rescheduleModalAppt, setRescheduleModalAppt] =
    useState<AppointmentRecord | null>(null);
  const [newRescheduleDate, setNewRescheduleDate] =
    useState<string>(today);
  const [newRescheduleStartAt, setNewRescheduleStartAt] =
    useState<number | null>(null);
  const [rescheduleDurationMinutes, setRescheduleDurationMinutes] =
    useState<number>(DEFAULT_DURATION_MINUTES);
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [rescheduleAvailability, setRescheduleAvailability] =
    useState<AvailabilityProvider[]>([]);
  const [noShowModalAppt, setNoShowModalAppt] =
    useState<AppointmentRecord | null>(null);
  const [noShowReason, setNoShowReason] = useState<string>('');

  const [waitlistPatientId, setWaitlistPatientId] = useState<string>('');
  const [waitlistPriority, setWaitlistPriority] =
    useState<WaitlistPriority>('NORMAL');
  const [waitlistFacilityId, setWaitlistFacilityId] =
    useState<string>('');
  const [waitlistDept, setWaitlistDept] = useState<string>('');
  const [waitlistChannel, setWaitlistChannel] = useState<
    'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL'
  >('PHONE');
  const [waitlistNotes, setWaitlistNotes] = useState<string>('');
  const [cancelWaitlistEntry, setCancelWaitlistEntry] =
    useState<WaitlistEntry | null>(null);
  const [cancelWaitlistReason, setCancelWaitlistReason] =
    useState<string>('');

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setClockNow(Date.now()),
      30_000
    );
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedPatientId && patients[0]?.id) {
      setSelectedPatientId(patients[0].id);
    }
    if (!waitlistPatientId && patients[0]?.id) {
      setWaitlistPatientId(patients[0].id);
    }
    if (!bookingFacilityId && facilityIds[0]) {
      setBookingFacilityId(facilityIds[0]);
    }
    if (!waitlistFacilityId && facilityIds[0]) {
      setWaitlistFacilityId(facilityIds[0]);
    }
    if (!bookingDepartmentId && departmentIds[0]) {
      setBookingDepartmentId(departmentIds[0]);
    }
    if (!waitlistDept && departmentIds[0]) {
      setWaitlistDept(departmentIds[0]);
    }
  }, [
    patients,
    facilityIds,
    departmentIds,
    selectedPatientId,
    waitlistPatientId,
    bookingFacilityId,
    waitlistFacilityId,
    bookingDepartmentId,
    waitlistDept,
  ]);

  const loadAvailability = useCallback(
    async (
      facilityId: string,
      departmentId: string,
      date: string,
      durationMinutes: number
    ): Promise<AvailabilityProvider[]> => {
      if (!isOnline) {
        throw new Error(
          'Scheduling is online-only until OPD-RP15 offline replay qualification.'
        );
      }
      if (!tenantId || !facilityId || !departmentId || !date) return [];
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error('AUTHENTICATED_USER_REQUIRED');
      const idToken = await user.getIdToken(false);
      const query = new URLSearchParams({
        tenantId,
        facilityId,
        departmentId,
        date,
        timeZone,
        durationMinutes: String(durationMinutes),
      });
      const response = await fetch(
        '/api/opd/availability?' + query.toString(),
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            Authorization: 'Bearer ' + idToken,
            'x-ghims-tenant-id': tenantId,
          },
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.error?.message ||
            'Unable to load authoritative provider availability.'
        );
      }
      return Array.isArray(payload.providers) ? payload.providers : [];
    },
    [isOnline, tenantId, timeZone]
  );

  useEffect(() => {
    if (
      activeTab !== 'BOOK_NEW' ||
      !bookingFacilityId ||
      !bookingDepartmentId
    ) {
      return;
    }
    let cancelled = false;
    setSchedulingError(null);
    void loadAvailability(
      bookingFacilityId,
      bookingDepartmentId,
      bookingDate,
      bookingDurationMinutes
    )
      .then((providers) => {
        if (cancelled) return;
        setAvailability(providers);
        setSelectedDoctorId(providers[0]?.providerEmployeeId || '');
        setBookingStartAt(providers[0]?.slots[0]?.startAt || null);
      })
      .catch((error) => {
        if (!cancelled) {
          setAvailability([]);
          setSelectedDoctorId('');
          setBookingStartAt(null);
          setSchedulingError(
            error instanceof Error
              ? error.message
              : 'Provider availability failed.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    bookingFacilityId,
    bookingDepartmentId,
    bookingDate,
    bookingDurationMinutes,
    loadAvailability,
  ]);

  useEffect(() => {
    const provider = availability.find(
      (candidate) => candidate.providerEmployeeId === selectedDoctorId
    );
    if (
      provider &&
      !provider.slots.some((slot) => slot.startAt === bookingStartAt)
    ) {
      setBookingStartAt(provider.slots[0]?.startAt || null);
    }
  }, [availability, selectedDoctorId, bookingStartAt]);

  useEffect(() => {
    if (!rescheduleModalAppt) return;
    const facilityId =
      rescheduleModalAppt.facilityId || facilityIds[0] || '';
    const departmentId =
      rescheduleModalAppt.departmentId || departmentIds[0] || '';
    let cancelled = false;
    setSchedulingError(null);
    void loadAvailability(
      facilityId,
      departmentId,
      newRescheduleDate,
      rescheduleDurationMinutes
    )
      .then((providers) => {
        if (cancelled) return;
        const sameProvider = providers.filter(
          (provider) =>
            provider.providerEmployeeId === rescheduleModalAppt.doctorId
        );
        setRescheduleAvailability(sameProvider);
        setNewRescheduleStartAt(sameProvider[0]?.slots[0]?.startAt || null);
      })
      .catch((error) => {
        if (!cancelled) {
          setRescheduleAvailability([]);
          setNewRescheduleStartAt(null);
          setSchedulingError(
            error instanceof Error
              ? error.message
              : 'Reschedule availability failed.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    rescheduleModalAppt,
    newRescheduleDate,
    rescheduleDurationMinutes,
    facilityIds,
    departmentIds,
    loadAvailability,
  ]);

  const filteredAppointments = appointments.filter((appointment) => {
    const matchesDate =
      !selectedDate || appointment.scheduledDate === selectedDate;
    const matchesStatus =
      statusFilter === 'ALL' || appointment.status === statusFilter;
    return matchesDate && matchesStatus;
  });

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setSchedulingError(null);
    try {
      await action();
    } catch (error) {
      setSchedulingError(
        error instanceof Error ? error.message : 'Scheduling action failed.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateBooking = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !selectedPatientId ||
      !bookingFacilityId ||
      !bookingDepartmentId ||
      !selectedDoctorId ||
      !bookingStartAt ||
      !bookingComplaint.trim()
    ) {
      setSchedulingError(
        'Patient, facility, department, provider, slot and visit reason are required.'
      );
      return;
    }

    void runAction('book', async () => {
      await onBookAppointment({
        patientId: selectedPatientId,
        providerEmployeeId: selectedDoctorId,
        facilityId: bookingFacilityId,
        departmentId: bookingDepartmentId,
        appointmentType: bookingType,
        scheduledStartAt: bookingStartAt,
        durationMinutes: bookingDurationMinutes,
        timeZone,
        chiefComplaint: bookingComplaint.trim(),
        bookingChannel: 'FRONT_DESK',
      });
      setBookingComplaint('');
      setActiveTab('APPOINTMENTS');
    });
  };

  const handleAddWaitlistSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !waitlistPatientId ||
      !waitlistFacilityId ||
      !waitlistDept ||
      !waitlistNotes.trim()
    ) {
      setSchedulingError(
        'Patient, facility, department and visit reason are required for the waitlist.'
      );
      return;
    }
    void runAction('waitlist-add', async () => {
      await onAddToWaitlist({
        patientId: waitlistPatientId,
        facilityId: waitlistFacilityId,
        preferredDepartmentId: waitlistDept,
        priority: waitlistPriority,
        notificationPreference: waitlistChannel,
        notes: waitlistNotes.trim(),
      });
      setWaitlistNotes('');
      setActiveTab('WAITLIST');
    });
  };

  const handleOfferEarliestSlot = (entry: WaitlistEntry) => {
    void runAction('waitlist-offer:' + entry.id, async () => {
      const facilityId = entry.facilityId || facilityIds[0] || '';
      const departmentId =
        entry.preferredDepartmentId || departmentIds[0] || '';
      if (!facilityId || !departmentId) {
        throw new Error('WAITLIST_SCOPE_REQUIRED');
      }

      for (let offset = 0; offset < AVAILABILITY_LOOKAHEAD_DAYS; offset += 1) {
        const target = new Date(Date.now() + offset * 86400000);
        const targetDate = formatDate(target.getTime(), timeZone);
        const providers = await loadAvailability(
          facilityId,
          departmentId,
          targetDate,
          DEFAULT_DURATION_MINUTES
        );
        const scoped = entry.preferredDoctorId
          ? providers.filter(
              (provider) =>
                provider.providerEmployeeId === entry.preferredDoctorId
            )
          : providers;
        const provider = scoped.find((candidate) => candidate.slots.length > 0);
        const slot = provider?.slots[0];
        if (provider && slot) {
          await onOfferWaitlistSlot({
            waitlistId: entry.id,
            providerEmployeeId: provider.providerEmployeeId,
            scheduledStartAt: slot.startAt,
            durationMinutes: DEFAULT_DURATION_MINUTES,
            timeZone,
            offerTtlMinutes: 30,
          });
          return;
        }
      }
      throw new Error(
        'NO_WAITLIST_SLOT_AVAILABLE: no governed slot was found in the next 14 days.'
      );
    });
  };

  const handleAcceptWaitlistOffer = (entry: WaitlistEntry) => {
    if (!entry.notes?.trim()) {
      setSchedulingError(
        'WAITLIST_VISIT_REASON_REQUIRED: add a documented visit reason before accepting the offer.'
      );
      return;
    }
    void runAction('waitlist-accept:' + entry.id, async () => {
      await onAcceptWaitlistSlot({
        waitlistId: entry.id,
        appointmentType: 'NEW_CONSULTATION',
        chiefComplaint: entry.notes!.trim(),
        bookingChannel: 'CALL_CENTER',
      });
    });
  };

  const noShowEligible = (appointment: AppointmentRecord) =>
    ['CONFIRMED', 'RESCHEDULED'].includes(appointment.status) &&
    Boolean(appointment.scheduledEndAt) &&
    Date.now() >= Number(appointment.scheduledEndAt) + 15 * 60 * 1000;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('APPOINTMENTS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'APPOINTMENTS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            Scheduled Appointments ({appointments.length})
          </button>
          <button
            onClick={() => setActiveTab('WAITLIST')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'WAITLIST'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            Waitlist Queue ({waitlist.length})
          </button>
          <button
            onClick={() => setActiveTab('BOOK_NEW')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'BOOK_NEW'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Book New Slot
          </button>
        </div>

        {activeTab === 'APPOINTMENTS' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
            >
              <option value="ALL">All Statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="CHECKED_IN">Checked-In</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="NO_SHOW">No-Show</option>
            </select>
          </div>
        )}
      </div>

      {!isOnline && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Scheduling mutations are disabled offline until OPD-RP15 qualifies slot-lock replay and conflict recovery.
        </div>
      )}
      {schedulingError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {schedulingError}
        </div>
      )}

      {/* VIEW 1: SCHEDULED APPOINTMENTS */}
      {activeTab === 'APPOINTMENTS' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Clinic Appointments Schedule ({filteredAppointments.length})
            </h3>
            <span className="text-xs text-slate-400">Date: {selectedDate || 'All Dates'}</span>
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-500">No appointments scheduled for selected date/filter.</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Time Slot</th>
                    <th className="p-3">Patient Name</th>
                    <th className="p-3">MRN</th>
                    <th className="p-3">Doctor & Dept</th>
                    <th className="p-3">Appointment Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredAppointments.map((appt) => (
                    <tr key={appt.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono font-bold text-blue-600">{appt.scheduledTimeSlot}</td>
                      <td className="p-3">
                        <p className="font-bold text-slate-900 dark:text-slate-100">{appt.patientName}</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-xs">{appt.chiefComplaint}</p>
                      </td>
                      <td className="p-3 font-mono text-slate-500">{appt.mrn}</td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{appt.doctorName}</p>
                        <p className="text-[10px] text-slate-400">{appt.department}</p>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {appt.appointmentType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            appt.status === 'CHECKED_IN'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : appt.status === 'CONFIRMED'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : appt.status === 'CANCELLED'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {appt.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {['CONFIRMED', 'RESCHEDULED'].includes(appt.status) && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() =>
                                void runAction(
                                  'checkin:' + appt.id,
                                  () => onCheckInAppointment(appt)
                                )
                              }
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1 disabled:opacity-50"
                              title="Authoritative check-in creates encounter and payment-pending queue token"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Check-In
                            </button>
                          )}
                          {appt.status === 'CHECKED_IN' && appt.encounterId && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() =>
                                void runAction(
                                  'resume-billing:' + appt.id,
                                  () => onResumeBillingAppointment(appt)
                                )
                              }
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              title="Retry the deterministic consultation invoice for this checked-in encounter"
                            >
                              Resume Billing
                            </button>
                          )}
                          {['CONFIRMED', 'RESCHEDULED'].includes(appt.status) && (
                            <>
                              <button
                                disabled={!isOnline || busyAction !== null}
                                onClick={() => {
                                  setRescheduleModalAppt(appt);
                                  setNewRescheduleDate(appt.scheduledDate);
                                  setRescheduleDurationMinutes(
                                    appt.durationMinutes || DEFAULT_DURATION_MINUTES
                                  );
                                  setRescheduleReason('');
                                }}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                                title="Reschedule against authoritative provider availability"
                              >
                                Reschedule
                              </button>
                              <button
                                disabled={!isOnline || busyAction !== null}
                                onClick={() => {
                                  setCancelReason('');
                                  setCancelModalAppt(appt);
                                }}
                                className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                                title="Cancel appointment"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {noShowEligible(appt) && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() => {
                                setNoShowReason('');
                                setNoShowModalAppt(appt);
                              }}
                              className="px-2 py-1 bg-amber-100 text-amber-800 rounded-lg text-[10px] font-bold disabled:opacity-50"
                              title="No-show is allowed only after the scheduled interval plus grace period"
                            >
                              No-Show
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: WAITLIST MANAGEMENT */}
      {activeTab === 'WAITLIST' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  Priority Outpatient Waitlist ({waitlist.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Patients waiting for clinic cancellations or slot openings. Slot offers are server-held and notification delivery depends on the configured messaging channel.
                </p>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Priority</th>
                    <th className="p-3">Patient Name</th>
                    <th className="p-3">MRN</th>
                    <th className="p-3">Target Dept</th>
                    <th className="p-3">Contact</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {waitlist.map((w) => {
                    const offerExpired =
                      w.status === 'OFFERED' &&
                      Number(w.offerExpiresAt || 0) > 0 &&
                      Number(w.offerExpiresAt) <= clockNow;

                    return (
                    <tr key={w.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                            w.priority === 'CRITICAL' || w.priority === 'URGENT'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {w.priority}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-900 dark:text-slate-100">{w.patientName}</td>
                      <td className="p-3 font-mono text-slate-500">{w.mrn}</td>
                      <td className="p-3 font-semibold">{w.preferredDepartment}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {w.contactPhone} ({w.notificationPreference})
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {offerExpired ? 'OFFER EXPIRED' : w.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {(w.status === 'WAITING' || offerExpired) && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() => handleOfferEarliestSlot(w)}
                              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              {offerExpired ? 'Re-offer Earliest Slot' : 'Offer Earliest Slot'}
                            </button>
                          )}
                          {w.status === 'OFFERED' && !offerExpired && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() => handleAcceptWaitlistOffer(w)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              Accept Offer
                            </button>
                          )}
                          {['WAITING', 'OFFERED'].includes(w.status) && (
                            <button
                              disabled={!isOnline || busyAction !== null}
                              onClick={() => {
                                setCancelWaitlistReason('');
                                setCancelWaitlistEntry(w);
                              }}
                              className="px-3 py-1 bg-red-50 text-red-700 rounded-lg text-[10px] font-bold disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Add to Waitlist Form */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              Add Patient to Clinic Waitlist
            </h3>

            <form onSubmit={handleAddWaitlistSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Select Patient</label>
                <select
                  value={waitlistPatientId}
                  onChange={(e) => setWaitlistPatientId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Facility</label>
                <select
                  value={waitlistFacilityId}
                  onChange={(e) => setWaitlistFacilityId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="">Select facility</option>
                  {facilityIds.map((facilityId) => (
                    <option key={facilityId} value={facilityId}>
                      {facilityId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Target Department</label>
                <select
                  value={waitlistDept}
                  onChange={(e) => setWaitlistDept(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="">Select department</option>
                  {departmentIds.map((departmentId) => (
                    <option key={departmentId} value={departmentId}>
                      {departmentId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Priority</label>
                <select
                  value={waitlistPriority}
                  onChange={(e) =>
                    setWaitlistPriority(e.target.value as WaitlistPriority)
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Notification Channel</label>
                <select
                  value={waitlistChannel}
                  onChange={(e) =>
                    setWaitlistChannel(e.target.value as typeof waitlistChannel)
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="PHONE">Phone</option>
                  <option value="SMS">SMS</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Visit Reason</label>
                <input
                  value={waitlistNotes}
                  onChange={(e) => setWaitlistNotes(e.target.value)}
                  placeholder="Required before an offered slot can become an appointment"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="sm:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={!isOnline || busyAction !== null}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {busyAction === 'waitlist-add'
                    ? 'Adding…'
                    : 'Enlist on Waitlist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW 3: BOOK NEW APPOINTMENT */}
      {activeTab === 'BOOK_NEW' && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              Book Outpatient Consultation Slot
            </h3>
            <p className="text-xs text-slate-500">
              Evaluates physician clinic sessions, slot buffer rules, and prevents duplicate calendar collisions.
            </p>
          </div>

          <form onSubmit={handleCreateBooking} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Select Patient
                </label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} — {p.mrn} ({p.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Facility
                </label>
                <select
                  value={bookingFacilityId}
                  onChange={(e) => setBookingFacilityId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="">Select facility</option>
                  {facilityIds.map((facilityId) => (
                    <option key={facilityId} value={facilityId}>
                      {facilityId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Department
                </label>
                <select
                  value={bookingDepartmentId}
                  onChange={(e) => setBookingDepartmentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="">Select department</option>
                  {departmentIds.map((departmentId) => (
                    <option key={departmentId} value={departmentId}>
                      {departmentId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Attending Clinician
                </label>
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="">Select provider</option>
                  {availability.map((provider) => (
                    <option
                      key={provider.providerEmployeeId}
                      value={provider.providerEmployeeId}
                    >
                      {provider.providerName} — {provider.departmentName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Appointment Category
                </label>
                <select
                  value={bookingType}
                  onChange={(e) => setBookingType(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="NEW_CONSULTATION">New Consultation</option>
                  <option value="FOLLOW_UP">Follow-Up Review</option>
                  <option value="ROUTINE_REVIEW">Routine Chronic Care Review</option>
                  <option value="OUTPATIENT_PROCEDURE">Outpatient Procedure</option>
                  <option value="EXECUTIVE_HEALTH_CHECK">Executive Health Check</option>
                  <option value="SPECIALIST_CONSULTATION">Specialist Referral</option>
                  <option value="TELECONSULTATION">Virtual / Telehealth</option>
                  <option value="POST_DISCHARGE_REVIEW">Post-Discharge Follow-up</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Booking Date
                </label>
                <input
                  type="date"
                  required
                  min={today}
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Duration
                </label>
                <select
                  value={bookingDurationMinutes}
                  onChange={(e) =>
                    setBookingDurationMinutes(Number(e.target.value))
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {[10, 15, 20, 30, 45, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Available Slot
                </label>
                <select
                  value={bookingStartAt || ''}
                  onChange={(e) =>
                    setBookingStartAt(Number(e.target.value) || null)
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                >
                  <option value="">Select slot</option>
                  {(availability.find(
                    (provider) =>
                      provider.providerEmployeeId === selectedDoctorId
                  )?.slots || []).map((slot) => (
                    <option key={slot.startAt} value={slot.startAt}>
                      {formatTime(slot.startAt, timeZone)}–
                      {formatTime(slot.endAt, timeZone)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Chief Complaint / Visit Reason
                </label>
                <input
                  type="text"
                  required
                  value={bookingComplaint}
                  onChange={(e) => setBookingComplaint(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="submit"
                disabled={
                  !isOnline ||
                  busyAction !== null ||
                  !selectedDoctorId ||
                  !bookingStartAt
                }
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm Appointment Slot
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelModalAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Cancel Appointment Confirmation
            </h3>
            <p className="text-xs text-slate-500">
              Document mandatory reason for audit. Appointment state will be marked CANCELLED without erasing immutable audit logs.
            </p>

            <div>
              <label className="block text-xs font-semibold mb-1">Reason for Cancellation</label>
              <textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelModalAppt(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700"
              >
                Back
              </button>
              <button
                disabled={!cancelReason.trim() || busyAction !== null}
                onClick={() =>
                  void runAction(
                    'cancel:' + cancelModalAppt.id,
                    async () => {
                      await onCancelAppointment(
                        cancelModalAppt.id,
                        cancelReason.trim()
                      );
                      setCancelModalAppt(null);
                    }
                  )
                }
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleModalAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-600" />
              Reschedule Appointment Slot
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">New Date</label>
                <input
                  type="date"
                  min={today}
                  value={newRescheduleDate}
                  onChange={(e) => setNewRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Duration</label>
                <select
                  value={rescheduleDurationMinutes}
                  onChange={(e) =>
                    setRescheduleDurationMinutes(Number(e.target.value))
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {[10, 15, 20, 30, 45, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Authoritative Available Slot
              </label>
              <select
                value={newRescheduleStartAt || ''}
                onChange={(e) =>
                  setNewRescheduleStartAt(Number(e.target.value) || null)
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              >
                <option value="">Select slot</option>
                {(rescheduleAvailability[0]?.slots || []).map((slot) => (
                  <option key={slot.startAt} value={slot.startAt}>
                    {formatTime(slot.startAt, timeZone)}–
                    {formatTime(slot.endAt, timeZone)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Reschedule Reason</label>
              <input
                type="text"
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRescheduleModalAppt(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700"
              >
                Back
              </button>
              <button
                disabled={
                  !newRescheduleStartAt ||
                  !rescheduleReason.trim() ||
                  busyAction !== null
                }
                onClick={() =>
                  void runAction(
                    'reschedule:' + rescheduleModalAppt.id,
                    async () => {
                      await onRescheduleAppointment({
                        appointmentId: rescheduleModalAppt.id,
                        scheduledStartAt: newRescheduleStartAt!,
                        durationMinutes: rescheduleDurationMinutes,
                        timeZone,
                        reason: rescheduleReason.trim(),
                      });
                      setRescheduleModalAppt(null);
                    }
                  )
                }
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold disabled:opacity-50"
              >
                Commit Reschedule
              </button>
            </div>
          </div>
        </div>
      )}

      {noShowModalAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              Confirm Appointment No-Show
            </h3>
            <p className="text-xs text-slate-500">
              No-show can be recorded only after the scheduled interval and server grace period.
            </p>
            <textarea
              rows={3}
              value={noShowReason}
              onChange={(e) => setNoShowReason(e.target.value)}
              placeholder="Document no-show verification or reason"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setNoShowModalAppt(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border"
              >
                Back
              </button>
              <button
                disabled={!noShowReason.trim() || busyAction !== null}
                onClick={() =>
                  void runAction(
                    'noshow:' + noShowModalAppt.id,
                    async () => {
                      await onMarkNoShowAppointment(
                        noShowModalAppt.id,
                        noShowReason.trim()
                      );
                      setNoShowModalAppt(null);
                    }
                  )
                }
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white disabled:opacity-50"
              >
                Confirm No-Show
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelWaitlistEntry && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Cancel Waitlist Entry
            </h3>
            <textarea
              rows={3}
              value={cancelWaitlistReason}
              onChange={(e) => setCancelWaitlistReason(e.target.value)}
              placeholder="Cancellation reason"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelWaitlistEntry(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border"
              >
                Back
              </button>
              <button
                disabled={!cancelWaitlistReason.trim() || busyAction !== null}
                onClick={() =>
                  void runAction(
                    'waitlist-cancel:' + cancelWaitlistEntry.id,
                    async () => {
                      await onCancelWaitlist(
                        cancelWaitlistEntry.id,
                        cancelWaitlistReason.trim()
                      );
                      setCancelWaitlistEntry(null);
                    }
                  )
                }
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white disabled:opacity-50"
              >
                Cancel Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
