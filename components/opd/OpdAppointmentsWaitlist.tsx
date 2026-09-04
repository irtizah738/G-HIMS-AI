'use client';

import React, { useState } from 'react';
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

interface OpdAppointmentsWaitlistProps {
  appointments: AppointmentRecord[];
  waitlist: WaitlistEntry[];
  patients: PatientDemographics[];
  onBookAppointment: (newAppt: AppointmentRecord) => void;
  onCheckInAppointment: (appointment: AppointmentRecord) => void;
  onCancelAppointment: (appointmentId: string, reason: string) => void;
  onRescheduleAppointment: (appointmentId: string, newDate: string, newTime: string, reason: string) => void;
  onAddToWaitlist: (entry: WaitlistEntry) => void;
  onOfferWaitlistSlot: (waitlistId: string) => void;
  onAcceptWaitlistSlot: (waitlistId: string) => void;
}

const DOCTOR_SCHEDULES = [
  { id: 'doc-01', name: 'Dr. Sarah Jenkins', dept: 'Cardiology', room: 'Consultation Room 104', maxPerSession: 15 },
  { id: 'doc-02', name: 'Dr. Marcus Vance', dept: 'General Medicine', room: 'Consultation Room 101', maxPerSession: 20 },
  { id: 'doc-03', name: 'Dr. Emily Chen', dept: 'Pediatrics', room: 'Pediatric Clinic 202', maxPerSession: 18 },
  { id: 'doc-04', name: 'Dr. Tariq Al-Mansoor', dept: 'Orthopedics', room: 'Ortho Suite 305', maxPerSession: 12 },
  { id: 'doc-05', name: 'Dr. Zainab Qureshi', dept: 'Obstetrics & Gynecology', room: 'Women Health Bay 108', maxPerSession: 16 },
];

export function OpdAppointmentsWaitlist({
  appointments,
  waitlist,
  patients,
  onBookAppointment,
  onCheckInAppointment,
  onCancelAppointment,
  onRescheduleAppointment,
  onAddToWaitlist,
  onOfferWaitlistSlot,
  onAcceptWaitlistSlot,
}: OpdAppointmentsWaitlistProps) {
  const [activeTab, setActiveTab] = useState<'APPOINTMENTS' | 'WAITLIST' | 'BOOK_NEW'>('APPOINTMENTS');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Booking Form State
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || '');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(DOCTOR_SCHEDULES[0].id);
  const [bookingType, setBookingType] = useState<AppointmentType>('NEW_CONSULTATION');
  const [bookingDate, setBookingDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState<string>('09:30');
  const [bookingComplaint, setBookingComplaint] = useState<string>('Exertional dyspnea and follow-up review');

  // Cancel / Reschedule Modals
  const [cancelModalAppt, setCancelModalAppt] = useState<AppointmentRecord | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('Patient requested cancellation due to personal conflict');
  const [rescheduleModalAppt, setRescheduleModalAppt] = useState<AppointmentRecord | null>(null);
  const [newRescheduleDate, setNewRescheduleDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newRescheduleTime, setNewRescheduleTime] = useState<string>('11:00');
  const [rescheduleReason, setRescheduleReason] = useState<string>('Clinician rescheduled due to emergency OT case');

  // Waitlist Add State
  const [waitlistPatientId, setWaitlistPatientId] = useState<string>(patients[0]?.id || '');
  const [waitlistPriority, setWaitlistPriority] = useState<WaitlistPriority>('NORMAL');
  const [waitlistDept, setWaitlistDept] = useState<string>('Cardiology');
  const [waitlistChannel, setWaitlistChannel] = useState<'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL'>('SMS');

  const filteredAppointments = appointments.filter((a) => {
    const matchesDate = !selectedDate || a.scheduledDate === selectedDate;
    const matchesStatus = statusFilter === 'ALL' || a.status === statusFilter;
    return matchesDate && matchesStatus;
  });

  const handleCreateBooking = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === selectedPatientId) || patients[0];
    const doc = DOCTOR_SCHEDULES.find((d) => d.id === selectedDoctorId) || DOCTOR_SCHEDULES[0];

    // Conflict Guard: check if doctor has slot clash
    const conflict = appointments.find(
      (a) =>
        a.doctorId === doc.id &&
        a.scheduledDate === bookingDate &&
        a.scheduledTimeSlot === bookingTime &&
        a.status !== 'CANCELLED'
    );

    if (conflict) {
      alert(`Booking Conflict: ${doc.name} already has appointment with ${conflict.patientName} at ${bookingTime}. Please choose another time slot.`);
      return;
    }

    const newAppt: AppointmentRecord = {
      id: `appt-${Date.now()}`,
      patientId: pat.id,
      patientName: pat.fullName,
      mrn: pat.mrn,
      doctorId: doc.id,
      doctorName: doc.name,
      department: doc.dept,
      appointmentType: bookingType,
      scheduledDate: bookingDate,
      scheduledTimeSlot: bookingTime,
      durationMinutes: 20,
      status: 'CONFIRMED',
      chiefComplaint: bookingComplaint,
      bookingChannel: 'FRONT_DESK',
      createdAt: Date.now(),
    };

    onBookAppointment(newAppt);
    setActiveTab('APPOINTMENTS');
  };

  const handleAddWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patients.find((p) => p.id === waitlistPatientId) || patients[0];

    const newWaitlistEntry: WaitlistEntry = {
      id: `wl-${Date.now()}`,
      patientId: pat.id,
      patientName: pat.fullName,
      mrn: pat.mrn,
      preferredDepartment: waitlistDept,
      priority: waitlistPriority,
      notificationPreference: waitlistChannel,
      contactPhone: pat.phone,
      status: 'WAITING',
      requestedDate: new Date().toISOString().slice(0, 10),
      notes: 'Priority waitlist requested for nearest slot opening',
      createdAt: Date.now(),
    };

    onAddToWaitlist(newWaitlistEntry);
    setActiveTab('WAITLIST');
  };

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
                          {appt.status !== 'CHECKED_IN' && appt.status !== 'CANCELLED' && (
                            <button
                              onClick={() => onCheckInAppointment(appt)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1"
                              title="Check-in patient and issue live queue token"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Check-In
                            </button>
                          )}
                          {appt.status !== 'CANCELLED' && (
                            <>
                              <button
                                onClick={() => {
                                  setRescheduleModalAppt(appt);
                                  setNewRescheduleDate(appt.scheduledDate);
                                }}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold cursor-pointer"
                                title="Reschedule appointment"
                              >
                                Reschedule
                              </button>
                              <button
                                onClick={() => setCancelModalAppt(appt)}
                                className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 rounded-lg text-[10px] font-bold cursor-pointer"
                                title="Cancel appointment"
                              >
                                Cancel
                              </button>
                            </>
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
                  Patients waiting for clinic cancellations or slot openings. Automated notification sent upon offer.
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
                  {waitlist.map((w) => (
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
                          {w.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {w.status === 'WAITING' && (
                          <button
                            onClick={() => onOfferWaitlistSlot(w.id)}
                            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                          >
                            Offer Slot
                          </button>
                        )}
                        {w.status === 'OFFERED' && (
                          <button
                            onClick={() => onAcceptWaitlistSlot(w.id)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                          >
                            Accept & Convert to Appt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
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

            <form onSubmit={handleAddWaitlistSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                <label className="block text-xs font-semibold mb-1">Target Specialty</label>
                <select
                  value={waitlistDept}
                  onChange={(e) => setWaitlistDept(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="Cardiology">Cardiology</option>
                  <option value="General Medicine">General Medicine</option>
                  <option value="Pediatrics">Pediatrics</option>
                  <option value="Orthopedics">Orthopedics</option>
                  <option value="Obstetrics & Gynecology">Obstetrics & Gynecology</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Clinical Priority</label>
                <select
                  value={waitlistPriority}
                  onChange={(e) => setWaitlistPriority(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="NORMAL">Normal Priority</option>
                  <option value="URGENT">Urgent (Within 48h)</option>
                  <option value="CRITICAL">Critical Fast-Track</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Enlist on Waitlist
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
                  Attending Clinician & Room
                </label>
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  {DOCTOR_SCHEDULES.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {d.dept} ({d.room})
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
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Time Slot
                </label>
                <select
                  value={bookingTime}
                  onChange={(e) => setBookingTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold"
                >
                  <option value="08:30">08:30 AM (Session A)</option>
                  <option value="09:00">09:00 AM (Session A)</option>
                  <option value="09:30">09:30 AM (Session A)</option>
                  <option value="10:00">10:00 AM (Session A)</option>
                  <option value="10:30">10:30 AM (Session A)</option>
                  <option value="11:00">11:00 AM (Session A)</option>
                  <option value="14:00">02:00 PM (Session B)</option>
                  <option value="14:30">02:30 PM (Session B)</option>
                  <option value="15:00">03:00 PM (Session B)</option>
                  <option value="15:30">03:30 PM (Session B)</option>
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
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
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
                onClick={() => {
                  onCancelAppointment(cancelModalAppt.id, cancelReason);
                  setCancelModalAppt(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold"
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
                  value={newRescheduleDate}
                  onChange={(e) => setNewRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">New Time Slot</label>
                <select
                  value={newRescheduleTime}
                  onChange={(e) => setNewRescheduleTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                >
                  <option value="09:00">09:00 AM</option>
                  <option value="10:00">10:00 AM</option>
                  <option value="11:30">11:30 AM</option>
                  <option value="14:00">02:00 PM</option>
                  <option value="15:30">03:30 PM</option>
                </select>
              </div>
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
                onClick={() => {
                  onRescheduleAppointment(
                    rescheduleModalAppt.id,
                    newRescheduleDate,
                    newRescheduleTime,
                    rescheduleReason
                  );
                  setRescheduleModalAppt(null);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
              >
                Commit Reschedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
