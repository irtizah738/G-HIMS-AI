'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Scissors,
  Calendar,
  Clock,
  User,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Filter,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Building2,
  Layers,
  ChevronRight,
  ChevronLeft,
  Activity,
  HeartPulse,
  Flame,
  FileCheck2,
  X,
  Stethoscope,
  Maximize2,
} from 'lucide-react';
import {
  SurgicalCase,
  SurgicalCaseStatus,
  SurgicalUrgency,
  AnesthesiaType,
  ORRoom,
  SurgicalStaff,
  ORConflict,
} from '@/types/inpatient-or';
import {
  subscribeToSurgicalCases,
  getORRooms,
  getSurgicalStaff,
  scheduleSurgicalCase,
  updateORCaseStatus,
  seedInitialInpatientORData,
} from '@/lib/firebase/services/inpatient-or';
import { detectORConflicts, checkAllORConflicts } from '@/lib/or/conflict-checker';

export default function ORSchedulePage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [cases, setCases] = useState<SurgicalCase[]>([]);
  const [rooms, setRooms] = useState<ORRoom[]>([]);
  const [staff, setStaff] = useState<SurgicalStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & View Mode
  const [selectedDate, setSelectedDate] = useState<string>('2026-08-15');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedUrgency, setSelectedUrgency] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'timeline' | 'grid'>('timeline');

  // Modal State for New Case
  const [newCaseModalOpen, setNewCaseModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [caseForm, setCaseForm] = useState({
    patientName: '',
    patientMRN: 'GH-2026-7890',
    patientAge: 48,
    patientGender: 'Male' as 'Male' | 'Female' | 'Other',
    patientBloodType: 'O+',
    patientAllergies: 'Penicillin',
    surgicalProcedureName: '',
    procedureCategory: 'General Surgery',
    icd10Code: 'K80.00',
    icd10Desc: 'Calculus of gallbladder with acute cholecystitis',
    cptCode: '47563',
    cptDesc: 'Laparoscopic cholecystectomy with cholangiography',
    orRoomId: 'or-suite-1',
    surgeonId: 'staff-surg-1',
    anesthesiologistId: 'staff-anes-2',
    scrubNurseName: 'Nurse Kevin O\'Connor, BSN, CNOR',
    circulatingNurseName: 'Nurse Maya Patel, BSN, RN',
    scheduledStartTime: '2026-08-15T09:00',
    scheduledEndTime: '2026-08-15T11:30',
    urgency: 'elective' as SurgicalUrgency,
    anesthesiaType: 'general' as AnesthesiaType,
    preOpDiagnosis: '',
    bloodUnitsReserved: 0,
    implantRequired: false,
    implantDetails: '',
    notes: '',
  });

  // Fetch / Subscribe to data
  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToSurgicalCases(
      tenantId,
      (cList) => {
        setCases(cList);
        setLoading(false);
      },
      (err) => {
        setErrorMsg(err.message);
        setLoading(false);
      }
    );

    Promise.all([getORRooms(tenantId), getSurgicalStaff(tenantId)]).then(([rList, sList]) => {
      setRooms(rList);
      setStaff(sList);
    });

    return () => unsub();
  }, [tenantId]);

  // Surgeons & Anesthesiologists lists
  const surgeons = useMemo(() => staff.filter((s) => s.role === 'Surgeon'), [staff]);
  const anesthesiologists = useMemo(() => staff.filter((s) => s.role === 'Anesthesiologist'), [staff]);

  // Conflict Matrix for all existing cases
  const allConflictsMap = useMemo(() => {
    return checkAllORConflicts(cases);
  }, [cases]);

  // Live conflict detection on Candidate Form
  const candidateConflicts = useMemo(() => {
    if (!newCaseModalOpen) return { hasCriticalConflict: false, hasWarning: false, conflicts: [], summary: [] };

    const selectedRoom = rooms.find((r) => r.id === caseForm.orRoomId);
    const selectedSurgeon = staff.find((s) => s.id === caseForm.surgeonId);
    const selectedAnesthetist = staff.find((s) => s.id === caseForm.anesthesiologistId);

    const candidate: Partial<SurgicalCase> = {
      orRoomId: caseForm.orRoomId,
      orRoomName: selectedRoom?.name || 'OR Room',
      surgeonId: caseForm.surgeonId,
      surgeonName: selectedSurgeon?.name || 'Surgeon',
      anesthesiologistId: caseForm.anesthesiologistId,
      anesthesiologistName: selectedAnesthetist?.name || 'Anesthesiologist',
      scheduledStartTime: caseForm.scheduledStartTime,
      scheduledEndTime: caseForm.scheduledEndTime,
      surgicalProcedureName: caseForm.surgicalProcedureName || 'Candidate Procedure',
    };

    return detectORConflicts(candidate, cases);
  }, [caseForm, cases, rooms, staff, newCaseModalOpen]);

  // Filtered cases
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (selectedRoomId !== 'all' && c.orRoomId !== selectedRoomId) return false;
      if (selectedStatus !== 'all' && c.status !== selectedStatus) return false;
      if (selectedUrgency !== 'all' && c.urgency !== selectedUrgency) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const procName = c.surgicalProcedureName || c.procedureName || '';
        const surgeon = c.surgeonName || c.leadSurgeon || '';
        const room = c.orRoomName || c.suiteName || '';
        const matchProc = procName.toLowerCase().includes(q);
        const matchPat = c.patientName.toLowerCase().includes(q) || c.patientMRN.toLowerCase().includes(q);
        const matchSurgeon = surgeon.toLowerCase().includes(q);
        const matchRoom = room.toLowerCase().includes(q);
        if (!matchProc && !matchPat && !matchSurgeon && !matchRoom) return false;
      }
      return true;
    });
  }, [cases, selectedRoomId, selectedStatus, selectedUrgency, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = cases.length;
    const intraOp = cases.filter((c) => c.status === 'intra_op').length;
    const scheduled = cases.filter((c) => c.status === 'scheduled').length;
    const pacu = cases.filter((c) => c.status === 'post_op_pacu').length;
    const completed = cases.filter((c) => c.status === 'completed').length;
    const conflictsCount = allConflictsMap.size;

    return { total, intraOp, scheduled, pacu, completed, conflictsCount };
  }, [cases, allConflictsMap]);

  // Handlers
  const handleOpenScheduleModal = (roomId?: string, timeSlot?: string) => {
    const targetRoomId = roomId || rooms[0]?.id || 'or-suite-1';
    const startTime = timeSlot ? `${selectedDate}T${timeSlot}` : `${selectedDate}T09:00`;
    const endTime = timeSlot
      ? `${selectedDate}T${String(Number(timeSlot.split(':')[0]) + 2).padStart(2, '0')}:${timeSlot.split(':')[1]}`
      : `${selectedDate}T11:30`;

    setCaseForm({
      ...caseForm,
      orRoomId: targetRoomId,
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
      patientName: '',
      surgicalProcedureName: '',
      preOpDiagnosis: '',
      notes: '',
    });
    setNewCaseModalOpen(true);
  };

  const handleExecuteSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseForm.patientName || !caseForm.surgicalProcedureName) return;

    if (candidateConflicts.hasCriticalConflict) {
      if (!confirm('Warning: Critical OR conflict detected. Overlapping schedule might cause surgeon or room collision. Proceed anyway?')) {
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const selectedRoom = rooms.find((r) => r.id === caseForm.orRoomId);
      const selectedSurgeon = staff.find((s) => s.id === caseForm.surgeonId);
      const selectedAnes = staff.find((s) => s.id === caseForm.anesthesiologistId);

      const start = new Date(caseForm.scheduledStartTime).getTime();
      const end = new Date(caseForm.scheduledEndTime).getTime();
      const durationMin = Math.max(30, Math.round((end - start) / 60000));

      const newCase = await scheduleSurgicalCase(tenantId, {
        patientId: `p-${Math.floor(1000 + Math.random() * 9000)}`,
        patientName: caseForm.patientName,
        patientMRN: caseForm.patientMRN,
        patientAge: Number(caseForm.patientAge),
        patientGender: caseForm.patientGender,
        patientBloodType: caseForm.patientBloodType,
        patientAllergies: caseForm.patientAllergies ? caseForm.patientAllergies.split(',').map((s) => s.trim()) : [],
        surgeonId: caseForm.surgeonId,
        surgeonName: selectedSurgeon?.name || 'Lead Surgeon',
        anesthesiologistId: caseForm.anesthesiologistId,
        anesthesiologistName: selectedAnes?.name || 'Staff Anesthesiologist',
        scrubNurseName: caseForm.scrubNurseName,
        circulatingNurseName: caseForm.circulatingNurseName,
        orRoomId: caseForm.orRoomId,
        orRoomName: selectedRoom?.name || 'OR Suite',
        scheduledStartTime: caseForm.scheduledStartTime,
        scheduledEndTime: caseForm.scheduledEndTime,
        surgicalProcedureName: caseForm.surgicalProcedureName,
        procedureCategory: caseForm.procedureCategory,
        icd10Codes: [{ code: caseForm.icd10Code, description: caseForm.icd10Desc }],
        cptCodes: [{ code: caseForm.cptCode, description: caseForm.cptDesc }],
        urgency: caseForm.urgency,
        anesthesiaType: caseForm.anesthesiaType,
        status: 'scheduled',
        preOpDiagnosis: caseForm.preOpDiagnosis,
        estimatedDurationMinutes: durationMin,
        bloodUnitsReserved: Number(caseForm.bloodUnitsReserved),
        implantRequired: caseForm.implantRequired,
        implantDetails: caseForm.implantDetails,
        notes: caseForm.notes,
      });

      setSuccessMsg(`Surgical Case "${newCase.surgicalProcedureName}" scheduled successfully for ${newCase.patientName}.`);
      setNewCaseModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to schedule surgical case.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickStatusChange = async (caseId: string, nextStatus: SurgicalCaseStatus) => {
    try {
      setErrorMsg(null);
      await updateORCaseStatus(tenantId, caseId, nextStatus);
      setSuccessMsg(`Case ${caseId} status updated to ${nextStatus.toUpperCase()}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update case status.');
    }
  };

  const getStatusBadge = (status?: SurgicalCaseStatus | string) => {
    switch (status) {
      case 'scheduled':
        return { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Scheduled' };
      case 'pre_op':
      case 'PRE_OP_HOLDING':
        return { bg: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Pre-Op Holding' };
      case 'intra_op':
      case 'SURGICAL_INCISION':
      case 'ANESTHESIA_INDUCTION':
        return { bg: 'bg-purple-100 text-purple-800 border-purple-300 font-bold animate-pulse', label: 'Intra-Op ACTIVE' };
      case 'post_op_pacu':
      case 'PACU_RECOVERY':
        return { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Post-Op PACU' };
      case 'completed':
      case 'COMPLETED':
        return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Completed' };
      case 'cancelled':
        return { bg: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Cancelled' };
      default:
        return { bg: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Scheduled' };
    }
  };

  const getUrgencyBadge = (urgency?: SurgicalUrgency | string) => {
    switch (urgency) {
      case 'emergency':
      case 'STAT_EMERGENCY':
        return 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
      case 'urgent':
      case 'URGENT':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'elective':
      case 'ELECTIVE':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  // Timeline hours (07:00 to 19:00)
  const timelineHours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      {/* Top Banner */}
      <div className="border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-600">
                <Scissors className="h-4 w-4" />
                <span>Operating Room Management & Surgical Planner (ORMS)</span>
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                  Tenant: {tenantId}
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                OR Suite Planner & Schedule Timeline
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Multi-suite Gantt scheduling, conflict collision detection, team allocation, and WHO surgical workspace.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/${tenantId}/inpatient/bed-board`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 hover:text-blue-600"
              >
                <Building2 className="h-4 w-4 text-blue-600" />
                <span>Inpatient Bed Board</span>
              </Link>

              <button
                onClick={() => handleOpenScheduleModal()}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-purple-700"
              >
                <Plus className="h-4 w-4" />
                <span>Schedule Surgical Case</span>
              </button>
            </div>
          </div>

          {/* Notifications */}
          {successMsg && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
              <button onClick={() => setSuccessMsg(null)}>
                <X className="h-4 w-4 text-emerald-700" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)}>
                <X className="h-4 w-4 text-rose-700" />
              </button>
            </div>
          )}

          {/* Global Conflict Alert Warning Banner */}
          {stats.conflictsCount > 0 && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-bold text-sm">
                  {stats.conflictsCount} Schedule Collision(s) Detected Across OR Suites
                </div>
                <p className="text-xs text-amber-800 mt-0.5">
                  Overlapping room bookings, double-booked surgeons, or turnaround violations require coordinator resolution.
                </p>
              </div>
            </div>
          )}

          {/* KPI Dashboard */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Total Cases (Today)</span>
              <div className="mt-1 text-2xl font-bold text-slate-900">{stats.total}</div>
              <div className="text-[11px] text-slate-400">5 Suites Operating</div>
            </div>

            <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 shadow-xs">
              <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-purple-600" /> Intra-Op (Active)
              </span>
              <div className="mt-1 text-2xl font-bold text-purple-900">{stats.intraOp}</div>
              <div className="text-[11px] text-purple-700">Live Surgery in Progress</div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 shadow-xs">
              <span className="text-xs font-semibold text-blue-900">Scheduled / Pre-Op</span>
              <div className="mt-1 text-2xl font-bold text-blue-900">{stats.scheduled}</div>
              <div className="text-[11px] text-blue-700">Upcoming in Pipeline</div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-xs">
              <span className="text-xs font-semibold text-indigo-900">PACU Recovery</span>
              <div className="mt-1 text-2xl font-bold text-indigo-900">{stats.pacu}</div>
              <div className="text-[11px] text-indigo-700">Post-Anesthesia Unit</div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
              <span className="text-xs font-semibold text-emerald-900">Completed & Discharged</span>
              <div className="mt-1 text-2xl font-bold text-emerald-900">{stats.completed}</div>
              <div className="text-[11px] text-emerald-700">OR Turnaround Verified</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and View Bar */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search procedure, patient, surgeon..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-purple-500 focus:bg-white focus:outline-none"
              />
            </div>

            {/* Room Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">OR Suite:</span>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-purple-500 focus:outline-none"
              >
                <option value="all">All OR Suites (5)</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-purple-500 focus:outline-none"
              >
                <option value="all">All Case Statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="pre_op">Pre-Op Holding</option>
                <option value="intra_op">Intra-Op Active</option>
                <option value="post_op_pacu">Post-Op PACU</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Urgency */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Urgency:</span>
              <select
                value={selectedUrgency}
                onChange={(e) => setSelectedUrgency(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-purple-500 focus:outline-none"
              >
                <option value="all">All Urgencies</option>
                <option value="elective">Elective</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">🚨 Emergency</option>
              </select>
            </div>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'timeline' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Gantt Timeline</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'grid' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>Case Cards</span>
            </button>
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="mt-12 flex flex-col items-center justify-center text-slate-500">
            <RefreshCw className="h-8 w-8 animate-spin text-purple-600" />
            <p className="mt-3 text-sm font-medium">Loading OR schedule and conflict matrix...</p>
          </div>
        ) : viewMode === 'timeline' ? (
          /* ========================================================================= */
          /* GANTT / TIMELINE VIEW                                                     */
          /* ========================================================================= */
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Timeline Header (Hours) */}
              <div className="grid grid-cols-12 border-b border-slate-200 pb-3 text-center text-xs font-bold text-slate-600">
                <div className="text-left font-bold text-slate-800">OR Suite / Pavilion</div>
                {timelineHours.slice(1).map((h) => (
                  <div key={h} className="border-l border-slate-100">
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Rows for each OR Room */}
              <div className="divide-y divide-slate-100">
                {rooms.map((room) => {
                  const roomCases = filteredCases.filter((c) => c.orRoomId === room.id);

                  return (
                    <div key={room.id} className="py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{room.name}</span>
                          <span className="text-xs text-slate-400">({room.features.slice(0, 2).join(', ')})</span>
                        </div>
                        <button
                          onClick={() => handleOpenScheduleModal(room.id)}
                          className="text-xs font-semibold text-purple-600 hover:text-purple-800"
                        >
                          + Add Case to {room.suiteNumber}
                        </button>
                      </div>

                      {/* Time Slots Track */}
                      <div className="relative h-20 rounded-xl bg-slate-50/80 border border-slate-200/80 overflow-hidden">
                        {/* Hour Grid Lines */}
                        <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
                          {timelineHours.map((h, idx) => (
                            <div key={h} className={`h-full ${idx > 0 ? 'border-l border-slate-200/60' : ''}`} />
                          ))}
                        </div>

                        {/* Placed Case Blocks */}
                        {roomCases.map((c) => {
                          const endTimeStr = c.scheduledEndTime || c.scheduledStartTime;
                          const startHour = new Date(c.scheduledStartTime).getHours() + new Date(c.scheduledStartTime).getMinutes() / 60;
                          const endHour = new Date(endTimeStr).getHours() + new Date(endTimeStr).getMinutes() / 60;

                          // Map hours 7:00 to 19:00 (12 hours total) to 0% - 100%
                          const leftPct = Math.max(0, Math.min(100, ((startHour - 7) / 12) * 100));
                          const widthPct = Math.max(8, Math.min(100 - leftPct, ((endHour - startHour) / 12) * 100));

                          const conflictList = allConflictsMap.get(c.id);
                          const hasConflict = conflictList && conflictList.length > 0;

                          return (
                            <Link
                              key={c.id}
                              href={`/${tenantId}/or/cases/${c.id}`}
                              className={`absolute top-2 bottom-2 rounded-lg p-2 text-xs shadow-xs transition-all hover:scale-[1.01] hover:z-20 cursor-pointer overflow-hidden flex flex-col justify-between ${
                                c.status === 'intra_op'
                                  ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                                  : c.status === 'post_op_pacu'
                                  ? 'bg-indigo-600 text-white'
                                  : c.status === 'completed'
                                  ? 'bg-emerald-700 text-white'
                                  : hasConflict
                                  ? 'bg-amber-100 text-amber-900 border-2 border-amber-500'
                                  : 'bg-white text-slate-900 border border-slate-300'
                              }`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              title={`Click to open WHO Safety Checklist & Intra-Op Console for ${c.surgicalProcedureName}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold truncate">{c.surgicalProcedureName}</span>
                                {hasConflict && <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                              </div>

                              <div className="flex items-center justify-between text-[10px] opacity-90">
                                <span className="truncate">{c.patientName}</span>
                                <span className="font-mono">
                                  {new Date(c.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* DETAILED CASE CARDS VIEW                                                  */
          /* ========================================================================= */
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredCases.map((c) => {
              const statusInfo = getStatusBadge(c.status);
              const urgencyBadge = getUrgencyBadge(c.urgency);
              const conflictList = allConflictsMap.get(c.id);

              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${urgencyBadge}`}>
                        {c.urgency}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] ${statusInfo.bg}`}
                      >
                        {statusInfo.label}
                      </span>
                    </div>

                    <h3 className="mt-3 text-base font-bold text-slate-900 leading-snug">
                      {c.surgicalProcedureName}
                    </h3>
                    <p className="text-xs text-purple-700 font-medium mt-0.5">{c.procedureCategory}</p>

                    {/* Conflict Alert in Card */}
                    {conflictList && conflictList.length > 0 && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{conflictList[0].title}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-amber-800">{conflictList[0].description}</p>
                      </div>
                    )}

                    {/* Patient Banner */}
                    <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 space-y-1.5">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-blue-600" />
                          {c.patientName}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">{c.patientMRN}</span>
                      </div>

                      <div className="text-[11px] text-slate-500">
                        {c.patientAge}y • {c.patientGender} • Blood Type: <span className="font-bold text-slate-800">{c.patientBloodType || 'Pending'}</span>
                      </div>

                      {c.patientAllergies && c.patientAllergies.length > 0 && (
                        <div className="text-[10px] text-rose-700 font-bold">
                          ⚠️ Allergies: {c.patientAllergies.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Clinical Details */}
                    <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Suite:</span>
                        <span className="font-medium text-slate-800">{c.orRoomName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Surgeon:</span>
                        <span className="font-medium text-slate-800">{c.surgeonName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Anesthetist:</span>
                        <span className="font-medium text-slate-800">{c.anesthesiologistName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Time:</span>
                        <span className="font-medium font-mono text-slate-800">
                          {new Date(c.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(c.scheduledEndTime || c.scheduledStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({c.estimatedDurationMinutes}m)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-5 border-t border-slate-100 pt-4 flex items-center justify-between gap-2">
                    <Link
                      href={`/${tenantId}/or/cases/${c.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-purple-700"
                    >
                      <FileCheck2 className="h-4 w-4" />
                      <span>WHO Safety Console</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>

                    {c.status === 'scheduled' && (
                      <button
                        onClick={() => handleQuickStatusChange(c.id, 'pre_op')}
                        className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        title="Move to Pre-Op Holding"
                      >
                        To Pre-Op
                      </button>
                    )}

                    {c.status === 'pre_op' && (
                      <button
                        onClick={() => handleQuickStatusChange(c.id, 'intra_op')}
                        className="rounded-lg bg-purple-100 border border-purple-300 px-2.5 py-2 text-xs font-bold text-purple-800 hover:bg-purple-200"
                        title="Start Surgery (Intra-Op)"
                      >
                        Start Surgery
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SCHEDULE NEW SURGICAL CASE MODAL                                          */}
      {/* ========================================================================= */}
      {newCaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl my-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Schedule New Surgical Case</h3>
                <p className="text-xs text-slate-500">
                  Book OR suite, assign surgical & anesthesia teams, and validate live schedule collisions.
                </p>
              </div>
              <button onClick={() => setNewCaseModalOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Live Conflict Warning Banner inside Modal */}
            {candidateConflicts.conflicts.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Collision Warning ({candidateConflicts.conflicts.length} conflict(s))</span>
                </div>
                {candidateConflicts.conflicts.map((conf) => (
                  <div key={conf.id} className="text-[11px] text-amber-800">
                    • <span className="font-semibold">{conf.title}:</span> {conf.description}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleExecuteSchedule} className="mt-4 space-y-4">
              {/* Patient Info */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">Patient Full Name *</label>
                  <input
                    type="text"
                    required
                    value={caseForm.patientName}
                    onChange={(e) => setCaseForm({ ...caseForm, patientName: e.target.value })}
                    placeholder="e.g. Eleanor Vance"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">MRN</label>
                  <input
                    type="text"
                    value={caseForm.patientMRN}
                    onChange={(e) => setCaseForm({ ...caseForm, patientMRN: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Age & Gender</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      value={caseForm.patientAge}
                      onChange={(e) => setCaseForm({ ...caseForm, patientAge: Number(e.target.value) })}
                      className="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                    />
                    <select
                      value={caseForm.patientGender}
                      onChange={(e) => setCaseForm({ ...caseForm, patientGender: e.target.value as any })}
                      className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-purple-500 focus:outline-none"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Blood Type</label>
                  <select
                    value={caseForm.patientBloodType}
                    onChange={(e) => setCaseForm({ ...caseForm, patientBloodType: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold focus:border-purple-500 focus:outline-none"
                  >
                    <option value="O+">O Positive (O+)</option>
                    <option value="O-">O Negative (O-)</option>
                    <option value="A+">A Positive (A+)</option>
                    <option value="A-">A Negative (A-)</option>
                    <option value="B+">B Positive (B+)</option>
                    <option value="B-">B Negative (B-)</option>
                    <option value="AB+">AB Positive (AB+)</option>
                    <option value="AB-">AB Negative (AB-)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Known Allergies</label>
                  <input
                    type="text"
                    value={caseForm.patientAllergies}
                    onChange={(e) => setCaseForm({ ...caseForm, patientAllergies: e.target.value })}
                    placeholder="e.g. Penicillin, Latex"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Procedure & Coding */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-slate-100 pt-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">Surgical Procedure Name *</label>
                  <input
                    type="text"
                    required
                    value={caseForm.surgicalProcedureName}
                    onChange={(e) => setCaseForm({ ...caseForm, surgicalProcedureName: e.target.value })}
                    placeholder="e.g. Laparoscopic Appendectomy / Total Hip Arthroplasty"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Procedure Category</label>
                  <select
                    value={caseForm.procedureCategory}
                    onChange={(e) => setCaseForm({ ...caseForm, procedureCategory: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  >
                    <option value="General Surgery">General Surgery</option>
                    <option value="Cardiothoracic Surgery">Cardiothoracic Surgery</option>
                    <option value="Orthopedic Surgery">Orthopedic Surgery</option>
                    <option value="Neurosurgery">Neurosurgery</option>
                    <option value="Urology">Urology</option>
                    <option value="Gynecology & Obstetrics">Gynecology & Obstetrics</option>
                    <option value="Pediatric Surgery">Pediatric Surgery</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Surgical Urgency</label>
                  <select
                    value={caseForm.urgency}
                    onChange={(e) => setCaseForm({ ...caseForm, urgency: e.target.value as SurgicalUrgency })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-purple-500 focus:outline-none"
                  >
                    <option value="elective">Elective (Planned)</option>
                    <option value="urgent">Urgent (&lt; 24h)</option>
                    <option value="emergency">🚨 Emergency (&lt; 2h)</option>
                  </select>
                </div>
              </div>

              {/* OR Suite & Timetable */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 border-t border-slate-100 pt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Target OR Suite *</label>
                  <select
                    value={caseForm.orRoomId}
                    onChange={(e) => setCaseForm({ ...caseForm, orRoomId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium focus:border-purple-500 focus:outline-none"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Scheduled Start Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={caseForm.scheduledStartTime}
                    onChange={(e) => setCaseForm({ ...caseForm, scheduledStartTime: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Scheduled End Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={caseForm.scheduledEndTime}
                    onChange={(e) => setCaseForm({ ...caseForm, scheduledEndTime: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Staff Roster Allocation */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-slate-100 pt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Lead Surgeon *</label>
                  <select
                    value={caseForm.surgeonId}
                    onChange={(e) => setCaseForm({ ...caseForm, surgeonId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  >
                    {surgeons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.specialty})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Anesthesiologist *</label>
                  <select
                    value={caseForm.anesthesiologistId}
                    onChange={(e) => setCaseForm({ ...caseForm, anesthesiologistId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  >
                    {anesthesiologists.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.specialty})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Anesthesia Technique</label>
                  <select
                    value={caseForm.anesthesiaType}
                    onChange={(e) => setCaseForm({ ...caseForm, anesthesiaType: e.target.value as AnesthesiaType })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  >
                    <option value="general">General Endotracheal Anesthesia (GETA)</option>
                    <option value="regional">Regional Spinal / Epidural / Peripheral Nerve Block</option>
                    <option value="mac">Monitored Anesthesia Care (MAC)</option>
                    <option value="local">Local Infiltration</option>
                    <option value="sedation">Conscious Sedation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Blood Units Reserved (Crossmatch)</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={caseForm.bloodUnitsReserved}
                    onChange={(e) => setCaseForm({ ...caseForm, bloodUnitsReserved: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Implant toggle */}
              <div className="border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={caseForm.implantRequired}
                    onChange={(e) => setCaseForm({ ...caseForm, implantRequired: e.target.checked })}
                    className="rounded text-purple-600"
                  />
                  <span>Surgical Prosthesis / Implant Required (Enables Biological Lot Tracking)</span>
                </label>

                {caseForm.implantRequired && (
                  <input
                    type="text"
                    value={caseForm.implantDetails}
                    onChange={(e) => setCaseForm({ ...caseForm, implantDetails: e.target.value })}
                    placeholder="Implant spec e.g. Titanium Mesh Cage, Size 4 Stryker Triathlon knee..."
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none"
                  />
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setNewCaseModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700 disabled:opacity-50"
                >
                  {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span>Confirm Booking & Initialize WHO Checklist</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
