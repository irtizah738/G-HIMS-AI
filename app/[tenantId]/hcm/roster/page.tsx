'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  Clock,
  Plus,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Building2,
  Stethoscope,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  X,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Layers,
  Search,
  Check,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import {
  StaffMember,
  RosterShift,
  ClinicalCredential,
  ShiftType,
  ShiftStatus,
  StaffRole,
  ShiftValidationResult,
} from '@/types/hcm';
import {
  subscribeToStaffMembers,
  subscribeToRosterShifts,
  subscribeToStaffCredentials,
  createRosterShift,
  updateRosterShift,
  deleteRosterShift,
  swapShifts,
  seedInitialRosterAndShifts,
} from '@/lib/firebase/services/hcm';
import {
  validateShiftAssignment,
  calculateShiftDurationHours,
} from '@/lib/hcm/roster-engine';

export default function ClinicalRosterPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [credentials, setCredentials] = useState<ClinicalCredential[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & State
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<StaffRole | 'all'>('all');
  const [validationFilter, setValidationFilter] = useState<'all' | 'compliant' | 'warning' | 'critical'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  // Selected Shift Drawer
  const [selectedShift, setSelectedShift] = useState<RosterShift | null>(null);

  // Selected Staff Validation Audit Drawer
  const [selectedStaffAudit, setSelectedStaffAudit] = useState<{
    staffMember: StaffMember;
    validation: {
      status: 'compliant' | 'warning' | 'critical';
      errors: string[];
      warnings: string[];
      blockReasons: string[];
      details: { type: 'error' | 'warning' | 'info'; message: string; shiftId?: string }[];
    };
  } | null>(null);

  // New Shift Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newStaffId, setNewStaffId] = useState('');
  const [newShiftType, setNewShiftType] = useState<ShiftType>('morning');
  const [newWardId, setNewWardId] = useState('ward-icu-1');
  const [newWardName, setNewWardName] = useState('ICU Pod A');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newStartTime, setNewStartTime] = useState(`${new Date().toISOString().split('T')[0]}T07:00`);
  const [newEndTime, setNewEndTime] = useState(`${new Date().toISOString().split('T')[0]}T15:30`);
  const [newBreakDuration, setNewBreakDuration] = useState<number>(30);
  const [newNotes, setNewNotes] = useState('');
  const [creatingShift, setCreatingShift] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Shift Swap Modal
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapShiftAId, setSwapShiftAId] = useState<string>('');
  const [swapShiftBId, setSwapShiftBId] = useState<string>('');
  const [swapReason, setSwapReason] = useState('Mutual schedule adjustment');
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Seeding State
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubStaff = subscribeToStaffMembers(tenantId, setStaff);
    const unsubShifts = subscribeToRosterShifts(tenantId, (data) => {
      setShifts(data);
      setLoading(false);
    });
    const unsubCreds = subscribeToStaffCredentials(tenantId, setCredentials);

    return () => {
      unsubStaff();
      unsubShifts();
      unsubCreds();
    };
  }, [tenantId]);

  // Set default staff in create modal
  useEffect(() => {
    if (staff.length > 0 && !newStaffId) {
      setNewStaffId(staff[0].id);
    }
  }, [staff, newStaffId]);

  // Generate 7 days for current week
  const weekDays = useMemo(() => {
    const days: { dateStr: string; dayName: string; monthDay: string; isToday: boolean }[] = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      days.push({
        dateStr,
        dayName,
        monthDay,
        isToday: dateStr === todayStr,
      });
    }
    return days;
  }, [currentWeekStart]);

  // Real-Time Staff Shift Validation Map using validateShiftAssignment helper
  const staffValidationMap = useMemo(() => {
    const map = new Map<
      string,
      {
        status: 'compliant' | 'warning' | 'critical';
        errors: string[];
        warnings: string[];
        blockReasons: string[];
        details: { type: 'error' | 'warning' | 'info'; message: string; shiftId?: string }[];
        compliantCount: number;
        warningCount: number;
        criticalCount: number;
      }
    >();

    const todayStr = new Date().toISOString().split('T')[0];

    staff.forEach((staffMember) => {
      const memberShifts = shifts.filter((s) => s.staffId === staffMember.id);
      const memberCreds = credentials.filter((c) => c.staffId === staffMember.id);

      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      const allBlockReasons: string[] = [];
      const detailedAudit: { type: 'error' | 'warning' | 'info'; message: string; shiftId?: string }[] = [];

      // 1. Account status validation
      if (staffMember.activeStatus === 'suspended') {
        const msg = `Staff account ${staffMember.fullName} is suspended.`;
        allBlockReasons.push(msg);
        allErrors.push(msg);
        detailedAudit.push({ type: 'error', message: msg });
      } else if (staffMember.activeStatus === 'terminated') {
        const msg = `Staff account ${staffMember.fullName} is terminated.`;
        allBlockReasons.push(msg);
        allErrors.push(msg);
        detailedAudit.push({ type: 'error', message: msg });
      } else if (staffMember.activeStatus === 'on_leave') {
        const msg = `Staff member ${staffMember.fullName} is marked on leave.`;
        allWarnings.push(msg);
        detailedAudit.push({ type: 'warning', message: msg });
      }

      // 2. Direct credential status check
      memberCreds.forEach((cred) => {
        const isExpired =
          cred.verificationStatus === 'expired' ||
          (cred.expirationDate && cred.expirationDate <= todayStr);
        if (isExpired) {
          const msg = `Mandatory license "${cred.title}" (${cred.licenseNumber}) is expired (${cred.expirationDate || 'N/A'}).`;
          allBlockReasons.push(msg);
          allErrors.push(msg);
          detailedAudit.push({ type: 'error', message: msg });
        } else if (cred.verificationStatus === 'pending') {
          const msg = `Credential "${cred.title}" is pending supervisor verification.`;
          allWarnings.push(msg);
          detailedAudit.push({ type: 'warning', message: msg });
        } else if (cred.expirationDate) {
          const expTime = new Date(cred.expirationDate).getTime();
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          if (expTime - Date.now() < thirtyDays && expTime > Date.now()) {
            const msg = `Credential "${cred.title}" will expire soon on ${cred.expirationDate}.`;
            allWarnings.push(msg);
            detailedAudit.push({ type: 'warning', message: msg });
          }
        }
      });

      // 3. Shift-level validation via validateShiftAssignment
      memberShifts.forEach((shift) => {
        const val = validateShiftAssignment(
          {
            staffId: staffMember.id,
            scheduledStartTime: shift.scheduledStartTime,
            scheduledEndTime: shift.scheduledEndTime,
            date: shift.date || shift.scheduledStartTime.split('T')[0],
            shiftId: shift.id,
          },
          shifts,
          credentials,
          staffMember,
          { minRestHours: 11, maxWeeklyHours: 60 }
        );

        if (val.errors && val.errors.length > 0) {
          val.errors.forEach((err) => {
            allErrors.push(err);
            detailedAudit.push({
              type: 'error',
              message: `Shift ${shift.shiftNumber}: ${err}`,
              shiftId: shift.id,
            });
          });
        }
        if (val.blockReasons && val.blockReasons.length > 0) {
          val.blockReasons.forEach((br) => {
            allBlockReasons.push(br);
          });
        }
        if (val.warnings && val.warnings.length > 0) {
          val.warnings.forEach((w) => {
            allWarnings.push(w);
            detailedAudit.push({
              type: 'warning',
              message: `Shift ${shift.shiftNumber}: ${w}`,
              shiftId: shift.id,
            });
          });
        }
      });

      const uniqueErrors = Array.from(new Set(allErrors));
      const uniqueWarnings = Array.from(new Set(allWarnings));
      const uniqueBlockReasons = Array.from(new Set(allBlockReasons));

      let status: 'compliant' | 'warning' | 'critical' = 'compliant';
      if (uniqueErrors.length > 0 || uniqueBlockReasons.length > 0) {
        status = 'critical';
      } else if (uniqueWarnings.length > 0) {
        status = 'warning';
      }

      if (status === 'compliant') {
        detailedAudit.push({
          type: 'info',
          message:
            'All shift assignments comply with rest-period (≥11h), weekly cap (≤60h), and license standards.',
        });
      }

      map.set(staffMember.id, {
        status,
        errors: uniqueErrors,
        warnings: uniqueWarnings,
        blockReasons: uniqueBlockReasons,
        details: detailedAudit,
        compliantCount: status === 'compliant' ? 1 : 0,
        warningCount: status === 'warning' ? 1 : 0,
        criticalCount: status === 'critical' ? 1 : 0,
      });
    });

    return map;
  }, [staff, shifts, credentials]);

  // Filtered Staff
  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      const matchRole = roleFilter === 'all' || s.primaryRole === roleFilter;
      const matchDept =
        departmentFilter === 'all' ||
        s.departmentId === departmentFilter ||
        s.departmentName.toLowerCase().includes(departmentFilter.toLowerCase());
      const matchSearch =
        s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.staffNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.departmentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.specialty && s.specialty.toLowerCase().includes(searchTerm.toLowerCase()));

      const validation = staffValidationMap.get(s.id);
      const matchValidation =
        validationFilter === 'all' || validation?.status === validationFilter;

      return matchRole && matchDept && matchSearch && matchValidation;
    });
  }, [staff, roleFilter, departmentFilter, searchTerm, validationFilter, staffValidationMap]);

  // Departments list for dropdown
  const departments = useMemo(() => {
    const map = new Map<string, string>();
    staff.forEach((s) => {
      if (s.departmentId && s.departmentName) {
        map.set(s.departmentId, s.departmentName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [staff]);

  // Live Shift Validation in Create Modal
  const liveValidation: ShiftValidationResult = useMemo(() => {
    if (!newStaffId || !newStartTime || !newEndTime) {
      return { valid: true, errors: [], warnings: [], blockReasons: [] };
    }
    const staffMem = staff.find((s) => s.id === newStaffId);
    return validateShiftAssignment(
      {
        staffId: newStaffId,
        scheduledStartTime: newStartTime,
        scheduledEndTime: newEndTime,
        date: newDate,
      },
      shifts,
      credentials,
      staffMem
    );
  }, [newStaffId, newStartTime, newEndTime, newDate, shifts, credentials, staff]);

  // KPI Calculations
  const kpis = useMemo(() => {
    const total = shifts.length;
    const inProgress = shifts.filter((s) => s.status === 'in_progress').length;
    const completed = shifts.filter((s) => s.status === 'completed').length;
    const scheduled = shifts.filter((s) => s.status === 'scheduled').length;

    let totalHours = 0;
    let conflictCount = 0;

    shifts.forEach((s) => {
      totalHours += Number(s.totalHours) || 0;
      if (s.conflictFlags && s.conflictFlags.length > 0) {
        conflictCount++;
      }
    });

    let compliantStaffCount = 0;
    let warningStaffCount = 0;
    let criticalStaffCount = 0;

    staffValidationMap.forEach((v) => {
      if (v.status === 'compliant') compliantStaffCount++;
      if (v.status === 'warning') warningStaffCount++;
      if (v.status === 'critical') criticalStaffCount++;
    });

    return {
      total,
      inProgress,
      completed,
      scheduled,
      totalHours: Math.round(totalHours),
      conflictCount,
      compliantStaffCount,
      warningStaffCount,
      criticalStaffCount,
    };
  }, [shifts, staffValidationMap]);

  const handlePrevWeek = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d);
  };

  const handleToday = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    setCurrentWeekStart(monday);
  };

  const handleShiftTypeChange = (type: ShiftType) => {
    setNewShiftType(type);
    if (!newDate) return;

    if (type === 'morning') {
      setNewStartTime(`${newDate}T07:00`);
      setNewEndTime(`${newDate}T15:30`);
      setNewBreakDuration(30);
    } else if (type === 'evening') {
      setNewStartTime(`${newDate}T15:00`);
      setNewEndTime(`${newDate}T23:30`);
      setNewBreakDuration(30);
    } else if (type === 'night') {
      const nextDay = new Date(new Date(newDate).getTime() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      setNewStartTime(`${newDate}T23:00`);
      setNewEndTime(`${nextDay}T07:30`);
      setNewBreakDuration(30);
    } else if (type === 'on_call') {
      setNewStartTime(`${newDate}T08:00`);
      setNewEndTime(`${newDate}T20:00`);
      setNewBreakDuration(60);
    }
  };

  const handleDateChange = (dateVal: string) => {
    setNewDate(dateVal);
    const timeStart = newStartTime.split('T')[1] || '07:00';
    const timeEnd = newEndTime.split('T')[1] || '15:30';
    setNewStartTime(`${dateVal}T${timeStart}`);
    setNewEndTime(`${dateVal}T${timeEnd}`);
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const staffMember = staff.find((s) => s.id === newStaffId);
    if (!staffMember) {
      setCreateError('Please select a valid staff member.');
      return;
    }

    if (!liveValidation.valid && liveValidation.blockReasons.length > 0) {
      setCreateError(liveValidation.blockReasons.join(' | '));
      return;
    }

    setCreatingShift(true);
    try {
      const shiftNum = `SH-${newDate.replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

      await createRosterShift(tenantId, {
        shiftNumber: shiftNum,
        staffId: staffMember.id,
        staffName: staffMember.fullName,
        staffRole: staffMember.primaryRole,
        departmentId: staffMember.departmentId,
        departmentName: staffMember.departmentName,
        wardId: newWardId,
        wardName: newWardName,
        shiftType: newShiftType,
        date: newDate,
        scheduledStartTime: newStartTime,
        scheduledEndTime: newEndTime,
        breakDuration: Number(newBreakDuration),
        status: 'scheduled',
        notes: newNotes.trim() || undefined,
      });

      setShowCreateModal(false);
      setNewNotes('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to schedule shift.');
    } finally {
      setCreatingShift(false);
    }
  };

  const handleExecuteSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwapError(null);

    if (!swapShiftAId || !swapShiftBId) {
      setSwapError('Please select both shifts to execute the swap.');
      return;
    }

    const shiftA = shifts.find((s) => s.id === swapShiftAId);
    const shiftB = shifts.find((s) => s.id === swapShiftBId);

    if (!shiftA || !shiftB) {
      setSwapError('Selected shift data could not be found.');
      return;
    }

    if (shiftA.staffId === shiftB.staffId) {
      setSwapError('Cannot swap two shifts belonging to the same staff member.');
      return;
    }

    setSwapping(true);
    try {
      await swapShifts(tenantId, {
        requestingShiftId: shiftA.id,
        targetShiftId: shiftB.id,
        requestingStaffId: shiftA.staffId,
        targetStaffId: shiftB.staffId,
        reason: swapReason,
        reviewer: 'Clinical Shift Supervisor',
      });

      setShowSwapModal(false);
      setSwapShiftAId('');
      setSwapShiftBId('');
    } catch (err: any) {
      setSwapError(err.message || 'Failed to execute shift swap.');
    } finally {
      setSwapping(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    if (!confirm('Are you sure you want to cancel and remove this scheduled shift?')) return;
    try {
      await deleteRosterShift(tenantId, shiftId);
      if (selectedShift?.id === shiftId) {
        setSelectedShift(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSeedRoster = async () => {
    setSeeding(true);
    try {
      await seedInitialRosterAndShifts(tenantId);
    } catch (err) {
      console.error('Failed to seed roster:', err);
    } finally {
      setSeeding(false);
    }
  };

  const getShiftBadgeColor = (type: ShiftType) => {
    switch (type) {
      case 'morning':
        return 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100';
      case 'evening':
        return 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100';
      case 'night':
        return 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100';
      case 'on_call':
        return 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200';
    }
  };

  return (
    <div className="space-y-6 pb-12" id="clinical-roster-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Clinical Rostering & Shift Matrix
              </h1>
              <p className="text-sm text-slate-500">
                Multi-ward physician & nursing rotation schedule, 11-hour rest period compliance & peer shift swaps
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            id="seed-roster-btn"
            onClick={handleSeedRoster}
            disabled={seeding}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg shadow-xs transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-slate-500 ${seeding ? 'animate-spin' : ''}`} />
            {seeding ? 'Generating...' : 'Seed 7-Day Demo Roster'}
          </button>
          <button
            id="open-swap-modal-btn"
            onClick={() => setShowSwapModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg shadow-xs transition-colors"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Swap Shifts
          </button>
          <button
            id="open-create-shift-modal-btn"
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            Schedule Shift
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Scheduled Shifts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Scheduled Shifts</span>
            <Layers className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            {kpis.total} <span className="text-xs font-normal text-slate-500">Shifts</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {kpis.scheduled} Upcoming • {kpis.completed} Finished
          </div>
        </div>

        {/* On Duty Now */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Active On-Duty Staff</span>
            <UserCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 font-mono">
            {kpis.inProgress} <span className="text-xs font-normal text-emerald-600">On Ward</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Live in-progress rotations</div>
        </div>

        {/* Total Scheduled Clinical Hours */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Clinical Workload</span>
            <Clock className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-indigo-700 font-mono">
            {kpis.totalHours} <span className="text-xs font-normal text-indigo-600">Hours</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Net scheduled hospital labor</div>
        </div>

        {/* Conflict / Warning Alerts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Compliance Engine</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700 font-mono">
              {kpis.compliantStaffCount}
            </span>
            <span className="text-xs font-semibold text-emerald-600">Compliant</span>
            <span className="text-slate-300">/</span>
            <span className="text-sm font-bold text-amber-600 font-mono">{kpis.warningStaffCount} Warn</span>
            {kpis.criticalStaffCount > 0 && (
              <>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-bold text-rose-600 font-mono">{kpis.criticalStaffCount} Critical</span>
              </>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">Live validation across all staff & shifts</div>
        </div>
      </div>

      {/* Roster Controls & Navigation */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row items-center justify-between gap-4">
        {/* Date Navigator */}
        <div className="flex items-center gap-2">
          <button
            id="prev-week-btn"
            onClick={handlePrevWeek}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            id="today-btn"
            onClick={handleToday}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            Current Week
          </button>
          <button
            id="next-week-btn"
            onClick={handleNextWeek}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <span className="text-sm font-bold text-slate-800 ml-2">
            {weekDays[0]?.monthDay} — {weekDays[6]?.monthDay}, {currentWeekStart.getFullYear()}
          </span>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Validation Status Filter */}
          <select
            id="filter-validation-select"
            value={validationFilter}
            onChange={(e) => setValidationFilter(e.target.value as any)}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Validation Statuses</option>
            <option value="compliant">🟢 Compliant Staff Only</option>
            <option value="warning">🟡 Warning Watch Only</option>
            <option value="critical">🔴 Critical Issues Only</option>
          </select>

          {/* Role Filter */}
          <select
            id="filter-role-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Roles</option>
            <option value="doctor">Doctors / MD</option>
            <option value="nurse">Nurses / RN</option>
            <option value="pharmacy">Pharmacy</option>
            <option value="lab">Lab Specialists</option>
            <option value="admin">Administration</option>
          </select>

          {/* Department Filter */}
          <select
            id="filter-dept-select"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              id="search-staff-input"
              type="text"
              placeholder="Search staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </div>

      {/* Weekly Shift Matrix Grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[950px]" id="roster-grid-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                <th className="py-3 px-4 w-72 sticky left-0 bg-slate-50 z-10 border-r border-slate-200">
                  Staff Member & Validation
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day.dateStr}
                    className={`py-3 px-3 text-center border-r border-slate-200 last:border-r-0 ${
                      day.isToday ? 'bg-blue-50/70 text-blue-800' : ''
                    }`}
                  >
                    <div className="font-bold">{day.dayName}</div>
                    <div className="text-[11px] font-normal text-slate-500 font-mono">
                      {day.monthDay}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Loading Clinical Roster...
                  </td>
                </tr>
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No staff found matching selected filters.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staffMember) => {
                  const val = staffValidationMap.get(staffMember.id) || {
                    status: 'compliant' as const,
                    errors: [],
                    warnings: [],
                    blockReasons: [],
                    details: [],
                    compliantCount: 1,
                    warningCount: 0,
                    criticalCount: 0,
                  };

                  return (
                    <tr key={staffMember.id} className="hover:bg-slate-50/50">
                      {/* Staff Header Column with Real-Time Validation Badge */}
                      <td className="py-3 px-4 sticky left-0 bg-white z-10 border-r border-slate-200 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">{staffMember.fullName}</div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <span className="capitalize font-mono font-medium text-slate-600">
                                {staffMember.primaryRole}
                              </span>
                              <span>•</span>
                              <span className="truncate max-w-[100px]">{staffMember.departmentName}</span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {staffMember.staffNumber} • ${staffMember.hourlyRate}/hr
                            </div>
                          </div>

                          {/* Real-time Validation Badge */}
                          <div className="shrink-0">
                            {val.status === 'compliant' ? (
                              <button
                                id={`val-badge-${staffMember.id}`}
                                onClick={() => setSelectedStaffAudit({ staffMember, validation: val })}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 transition shadow-2xs"
                                title="Validated: Compliant (FLSA, Rest Period, Credential Active)"
                              >
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                <span>Compliant</span>
                              </button>
                            ) : val.status === 'warning' ? (
                              <button
                                id={`val-badge-${staffMember.id}`}
                                onClick={() => setSelectedStaffAudit({ staffMember, validation: val })}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100 transition shadow-2xs"
                                title={`Validation Warning:\n${val.warnings.join('\n')}`}
                              >
                                <AlertTriangle className="h-3 w-3 text-amber-600" />
                                <span>Warning</span>
                              </button>
                            ) : (
                              <button
                                id={`val-badge-${staffMember.id}`}
                                onClick={() => setSelectedStaffAudit({ staffMember, validation: val })}
                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 transition shadow-2xs animate-pulse"
                                title={`Critical Validation Issue:\n${val.errors.concat(val.blockReasons).join('\n')}`}
                              >
                                <AlertCircle className="h-3 w-3 text-rose-600" />
                                <span>Critical</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 7 Days Columns */}
                      {weekDays.map((day) => {
                        const dayShifts = shifts.filter(
                          (s) =>
                            s.staffId === staffMember.id &&
                            (s.date === day.dateStr || s.scheduledStartTime.startsWith(day.dateStr))
                        );

                        return (
                          <td
                            key={day.dateStr}
                            className={`p-2 border-r border-slate-200 last:border-r-0 align-top h-24 ${
                              day.isToday ? 'bg-blue-50/20' : ''
                            }`}
                          >
                            <div className="space-y-1.5 h-full">
                              {dayShifts.map((shift) => (
                                <div
                                  key={shift.id}
                                  id={`shift-card-${shift.id}`}
                                  onClick={() => setSelectedShift(shift)}
                                  className={`p-2 rounded-lg border text-left cursor-pointer transition-all shadow-2xs ${getShiftBadgeColor(
                                    shift.shiftType
                                  )}`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-bold text-[11px] uppercase tracking-tight">
                                      {shift.shiftType}
                                    </span>
                                    <span className="text-[10px] font-mono font-medium">
                                      {shift.totalHours}h
                                    </span>
                                  </div>

                                  <div className="text-[10px] font-medium text-slate-700 truncate mt-0.5">
                                    {shift.wardName || shift.departmentName}
                                  </div>

                                  <div className="text-[9px] font-mono text-slate-500 mt-0.5">
                                    {shift.scheduledStartTime.split('T')[1]?.substring(0, 5)} -{' '}
                                    {shift.scheduledEndTime.split('T')[1]?.substring(0, 5)}
                                  </div>

                                  {/* Conflict Warning Pill */}
                                  {shift.conflictFlags && shift.conflictFlags.length > 0 && (
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-amber-700 bg-amber-100/80 px-1 py-0.5 rounded font-medium">
                                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                      <span className="truncate">Rest/OT Watch</span>
                                    </div>
                                  )}

                                  {/* Status indicator */}
                                  {shift.status === 'in_progress' && (
                                    <div className="mt-1 flex items-center gap-1 text-[9px] text-emerald-700 font-bold">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                      On Duty
                                    </div>
                                  )}
                                </div>
                              ))}

                              {/* Empty slot quick schedule */}
                              {dayShifts.length === 0 && (
                                <button
                                  id={`quick-add-${staffMember.id}-${day.dateStr}`}
                                  onClick={() => {
                                    setNewStaffId(staffMember.id);
                                    handleDateChange(day.dateStr);
                                    handleShiftTypeChange('morning');
                                    setShowCreateModal(true);
                                  }}
                                  className="w-full h-full min-h-[40px] opacity-0 hover:opacity-100 border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 transition-all"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Details Drawer */}
      {selectedShift && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-200"
          id="shift-details-drawer"
          onClick={() => setSelectedShift(null)}
        >
          <div
            className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                  <CalendarIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-mono text-xs font-bold text-blue-700">
                    {selectedShift.shiftNumber}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {selectedShift.staffName}
                  </h2>
                </div>
              </div>

              <button
                id="close-shift-drawer-btn"
                onClick={() => setSelectedShift(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 my-5 flex-1">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Department:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedShift.departmentName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Ward / Station:</span>
                  <span className="font-semibold text-slate-800">{selectedShift.wardName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Shift Type:</span>
                  <span className="capitalize font-bold text-blue-700">
                    {selectedShift.shiftType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span className="font-mono font-medium text-slate-800">{selectedShift.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Start Time:</span>
                  <span className="font-mono text-slate-800">
                    {selectedShift.scheduledStartTime}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">End Time:</span>
                  <span className="font-mono text-slate-800">
                    {selectedShift.scheduledEndTime}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Break Duration:</span>
                  <span className="font-mono text-slate-800">
                    {selectedShift.breakDuration} Minutes
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
                  <span className="text-slate-700">Net Working Hours:</span>
                  <span className="text-blue-700 font-mono">{selectedShift.totalHours} hrs</span>
                </div>
              </div>

              {selectedShift.conflictFlags && selectedShift.conflictFlags.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Roster Warnings
                  </div>
                  <ul className="text-xs text-amber-700 list-disc list-inside space-y-1">
                    {selectedShift.conflictFlags.map((flag, idx) => (
                      <li key={idx}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedShift.notes && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <div className="font-semibold text-slate-700 mb-1">Supervisor Notes:</div>
                  <p className="text-slate-600">{selectedShift.notes}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-200">
              <button
                id="delete-shift-btn"
                onClick={() => handleDeleteShift(selectedShift.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Cancel Shift
              </button>

              <div className="flex items-center gap-2">
                <button
                  id="swap-this-shift-btn"
                  onClick={() => {
                    setSwapShiftAId(selectedShift.id);
                    setSelectedShift(null);
                    setShowSwapModal(true);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Initiate Swap
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Shift Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="create-shift-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                  <CalendarIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Schedule Clinical Shift</h2>
                  <p className="text-xs text-slate-500">
                    Enforces credential checks & 11-hour rest interval rules
                  </p>
                </div>
              </div>
              <button
                id="close-create-shift-btn"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShift} className="flex-1 overflow-y-auto p-5 space-y-4">
              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {createError}
                </div>
              )}

              {/* Live Validation Alert Box */}
              {!liveValidation.valid && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                    <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
                    Assignment Blocked (Clinical Safety Rules)
                  </div>
                  <ul className="text-xs text-rose-700 list-disc list-inside space-y-1">
                    {liveValidation.blockReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {liveValidation.valid && liveValidation.warnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    Advisory Notices
                  </div>
                  <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                    {liveValidation.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Staff Member *
                </label>
                <select
                  id="modal-staff-select"
                  required
                  value={newStaffId}
                  onChange={(e) => setNewStaffId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                >
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.primaryRole.toUpperCase()} — {s.departmentName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shift Template *
                  </label>
                  <select
                    id="modal-shift-type-select"
                    value={newShiftType}
                    onChange={(e) => handleShiftTypeChange(e.target.value as ShiftType)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="morning">Morning (07:00 - 15:30)</option>
                    <option value="evening">Evening (15:00 - 23:30)</option>
                    <option value="night">Night (23:00 - 07:30)</option>
                    <option value="on_call">On-Call 12h (08:00 - 20:00)</option>
                    <option value="custom">Custom Hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shift Date *
                  </label>
                  <input
                    id="modal-shift-date-input"
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Scheduled Start *
                  </label>
                  <input
                    id="modal-shift-start-input"
                    type="datetime-local"
                    required
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Scheduled End *
                  </label>
                  <input
                    id="modal-shift-end-input"
                    type="datetime-local"
                    required
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ward / Station *
                  </label>
                  <input
                    id="modal-ward-input"
                    type="text"
                    required
                    value={newWardName}
                    onChange={(e) => setNewWardName(e.target.value)}
                    placeholder="e.g. ICU Pod A, ER Bay 1"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Break Duration (mins)
                  </label>
                  <input
                    id="modal-break-input"
                    type="number"
                    min="0"
                    max="180"
                    value={newBreakDuration}
                    onChange={(e) => setNewBreakDuration(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supervisor Notes
                </label>
                <input
                  id="modal-notes-input"
                  type="text"
                  placeholder="e.g. Acting Charge Nurse for morning code team"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <div className="text-xs text-slate-500">
                  Net Duration:{' '}
                  <span className="font-mono font-bold text-slate-800">
                    {calculateShiftDurationHours(newStartTime, newEndTime, newBreakDuration)} hrs
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id="submit-create-shift-btn"
                    disabled={creatingShift || (!liveValidation.valid && liveValidation.blockReasons.length > 0)}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-xs"
                  >
                    {creatingShift ? 'Assigning...' : 'Confirm Assignment'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shift Swap Modal */}
      {showSwapModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="shift-swap-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <ArrowLeftRight className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Peer Shift Swap Terminal</h2>
                  <p className="text-xs text-slate-500">
                    Swap rotation assignments between clinical team members
                  </p>
                </div>
              </div>
              <button
                id="close-swap-modal-btn"
                onClick={() => setShowSwapModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteSwap} className="p-5 space-y-4">
              {swapError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {swapError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shift A (Source Shift) *
                </label>
                <select
                  id="swap-shift-a-select"
                  required
                  value={swapShiftAId}
                  onChange={(e) => setSwapShiftAId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="">-- Select Shift A --</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.staffName} ({s.date} • {s.shiftType.toUpperCase()} in {s.wardName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shift B (Target Shift to Swap With) *
                </label>
                <select
                  id="swap-shift-b-select"
                  required
                  value={swapShiftBId}
                  onChange={(e) => setSwapShiftBId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="">-- Select Shift B --</option>
                  {shifts
                    .filter((s) => s.id !== swapShiftAId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.staffName} ({s.date} • {s.shiftType.toUpperCase()} in {s.wardName})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Swap
                </label>
                <input
                  id="swap-reason-input"
                  type="text"
                  value={swapReason}
                  onChange={(e) => setSwapReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowSwapModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-swap-btn"
                  disabled={swapping || !swapShiftAId || !swapShiftBId}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {swapping ? 'Swapping...' : 'Execute Mutual Swap'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Validation & Compliance Audit Drawer Modal */}
      {selectedStaffAudit && (
        <div
          id="staff-audit-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-xl border ${
                    selectedStaffAudit.validation.status === 'compliant'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : selectedStaffAudit.validation.status === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {selectedStaffAudit.validation.status === 'compliant' ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : selectedStaffAudit.validation.status === 'warning' ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <AlertCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Clinical Shift Validation Audit
                  </h3>
                  <p className="text-xs text-slate-500">
                    Real-time compliance engine evaluation for{' '}
                    <strong className="text-slate-700 font-semibold">
                      {selectedStaffAudit.staffMember.fullName}
                    </strong>
                  </p>
                </div>
              </div>

              <button
                id="close-staff-audit-modal"
                onClick={() => setSelectedStaffAudit(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Staff Snapshot */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Role / Track</span>
                  <span className="font-semibold text-slate-800 capitalize">
                    {selectedStaffAudit.staffMember.primaryRole}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Department</span>
                  <span className="font-semibold text-slate-800">
                    {selectedStaffAudit.staffMember.departmentName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Staff ID</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {selectedStaffAudit.staffMember.staffNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Status</span>
                  <span className="font-semibold capitalize text-emerald-700">
                    {selectedStaffAudit.staffMember.activeStatus}
                  </span>
                </div>
              </div>

              {/* Status Banner */}
              <div
                className={`p-4 rounded-xl border ${
                  selectedStaffAudit.validation.status === 'compliant'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : selectedStaffAudit.validation.status === 'warning'
                    ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                    : 'bg-rose-50/70 border-rose-200 text-rose-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>
                      Compliance Status:{' '}
                      <strong className="uppercase">
                        {selectedStaffAudit.validation.status}
                      </strong>
                    </span>
                  </div>
                  <span className="text-xs font-mono">
                    {selectedStaffAudit.validation.errors.length} Errors •{' '}
                    {selectedStaffAudit.validation.warnings.length} Warnings
                  </span>
                </div>
                <p className="text-xs mt-1 text-slate-600">
                  {selectedStaffAudit.validation.status === 'compliant'
                    ? 'All scheduled shift intervals satisfy the 11-hour mandatory rest period, maximum weekly cap (≤60h), and clinical licensing prerequisites.'
                    : selectedStaffAudit.validation.status === 'warning'
                    ? 'Advisory warnings detected. Schedule complies with minimum requirements but flags overtime or credential maintenance alerts.'
                    : 'Critical violations detected! Scheduling conflicts, expired licenses, or consecutive shift rule infractions must be resolved.'}
                </p>
              </div>

              {/* Validation Findings List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Audit Findings & Rules Checked
                </h4>

                <div className="space-y-2">
                  {selectedStaffAudit.validation.details.map((item, idx) => (
                    <div
                      key={`audit-item-${idx}`}
                      className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                        item.type === 'error'
                          ? 'bg-rose-50/50 border-rose-200 text-rose-800'
                          : item.type === 'warning'
                          ? 'bg-amber-50/50 border-amber-200 text-amber-800'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {item.type === 'error' ? (
                        <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      ) : item.type === 'warning' ? (
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">{item.message}</div>
                        {item.shiftId && (
                          <div className="text-[10px] font-mono opacity-80 mt-0.5">
                            Target Shift ID: {item.shiftId}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active Credentials & Licensing */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Verified Licenses & Board Certifications
                </h4>
                {credentials.filter((c) => c.staffId === selectedStaffAudit.staffMember.id).length ===
                0 ? (
                  <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No individual licenses logged on file.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {credentials
                      .filter((c) => c.staffId === selectedStaffAudit.staffMember.id)
                      .map((cred) => (
                        <div
                          key={cred.id}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-800">{cred.title}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              #{cred.licenseNumber || 'N/A'} • Issuer: {cred.issuingBody || 'Board'}
                            </div>
                          </div>
                          <div className="text-right">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                cred.verificationStatus === 'verified'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : cred.verificationStatus === 'expired'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {cred.verificationStatus.toUpperCase()}
                            </span>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              Exp: {cred.expirationDate || 'None'}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Engine: <code className="font-mono text-slate-700">validateShiftAssignment</code>
              </span>
              <button
                type="button"
                onClick={() => setSelectedStaffAudit(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg shadow-2xs"
              >
                Dismiss Audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
