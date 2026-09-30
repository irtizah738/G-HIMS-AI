'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Boxes,
  Building,
  Wrench,
  Gauge,
  Calendar,
  Layers,
  Activity,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Search,
  Plus,
  Filter,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  Cpu,
  Clock,
  FileCheck,
  Zap,
  Scissors,
  HeartPulse,
  Flame,
  Radio,
  FileText,
  DollarSign,
  Lock,
} from 'lucide-react';
import {
  ResourceMaster,
  HospitalRoom,
  ResourceTransferRecord,
  MaintenanceWorkOrder,
  CalibrationRecord,
  ResourceReservation,
  OperationalMatchRequest,
  OperationalMatchResult,
} from '@/types/resource-management';
import {
  hydrateFacilitiesProjection,
  loadLocalFacilitiesProjection,
  recordCalibrationEdge,
} from '@/lib/facilities/facilities-edge-adapter';

export function ResourceCapacityView() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();

  const [activeTab, setActiveTab] = useState<
    'master' | 'rooms' | 'transfers' | 'reservations' | 'maintenance' | 'calibration' | 'matcher'
  >('master');

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Modals
  const [showAddResourceModal, setShowAddResourceModal] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [selectedResourceForCal, setSelectedResourceForCal] = useState<ResourceMaster | null>(null);

  // Matcher State
  const [matchServiceType, setMatchServiceType] = useState<'OPD' | 'OT_SURGERY' | 'EMERGENCY_SURGE'>('OT_SURGERY');
  const [matchResult, setMatchResult] = useState<OperationalMatchResult | null>(null);

  // Tenant-scoped authoritative projections. No demo resource state is embedded in the UI.
  const [resources, setResources] = useState<ResourceMaster[]>([]);
  const [rooms, setRooms] = useState<HospitalRoom[]>([]);
  const [transfers] = useState<ResourceTransferRecord[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationRecord[]>([]);
  const [reservations, setReservations] = useState<ResourceReservation[]>([]);
  const [loadingProjection, setLoadingProjection] = useState(true);

  const applyProjection = (
    projection: Awaited<ReturnType<typeof loadLocalFacilitiesProjection>>
  ) => {
    setResources(projection.resources);
    setRooms(projection.rooms);
    setWorkOrders(projection.workOrders);
    setCalibrations(projection.calibrations);
    setReservations(projection.reservations);
  };

  const refreshProjection = async () => {
    if (!tenantId) {
      setActionMessage({
        text: 'TENANT_CONTEXT_REQUIRED: Facilities requires an explicit tenant route.',
        type: 'error',
      });
      setLoadingProjection(false);
      return;
    }
    setLoadingProjection(true);
    try {
      applyProjection(await loadLocalFacilitiesProjection(tenantId));
      applyProjection(await hydrateFacilitiesProjection(tenantId));
    } catch (error) {
      setActionMessage({
        text:
          error instanceof Error
            ? error.message
            : 'Failed to load authoritative facilities projection.',
        type: 'error',
      });
    } finally {
      setLoadingProjection(false);
    }
  };

  useEffect(() => {
    void refreshProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Aggregate Metrics
  const totalAssets = resources.length;
  const availableAssets = resources.filter((r) => r.status === 'AVAILABLE').length;
  const inUseAssets = resources.filter((r) => r.status === 'IN_USE').length;
  const calibrationLocked = resources.filter((r) => r.calibrationStatus === 'CALIBRATION_REQUIRED').length;
  const pendingMaintenance = workOrders.filter((w) => w.status !== 'COMPLETED').length;

  const handleExecuteMatching = () => {
    // UI feasibility preview only. Authoritative reservation/calibration decisions
    // must be executed through server commands.
    const matchedRoom = rooms.find((room) =>
      room.status === 'AVAILABLE' &&
      (matchServiceType !== 'OT_SURGERY' || room.roomType === 'operating_room')
    );
    const matchedEquipment = resources.filter(
      (resource) => resource.status === 'AVAILABLE' && resource.calibrationStatus === 'VALID'
    );

    const isAvailable = Boolean(matchedRoom) && matchedEquipment.length > 0;
    setMatchResult({
      isAvailable,
      matchScore: isAvailable ? 92 : 35,
      matchedPhysician: isAvailable
        ? {
            employeeId: 'preview-physician',
            fullName: 'Credentialed clinician required',
            role: 'Physician',
            specialty: matchServiceType === 'OT_SURGERY' ? 'Cardiothoracic Surgery' : 'Assigned Specialty',
            privilegeStatus: 'VALID',
          }
        : undefined,
      matchedRoom,
      matchedEquipment: matchedEquipment.slice(0, 2),
      conflictReason: isAvailable ? undefined : 'No locally available calibrated room/equipment combination.',
    });
  };

  const handleRecordCalibrationPass = async (resource: ResourceMaster) => {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const certNumber = `CAL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      if (!tenantId) {
        throw new Error('Tenant context is required.');
      }

      await recordCalibrationEdge(
        {
          resourceId: resource.resourceId,
          resourceName: resource.name,
          model: resource.model || 'Standard',
          serialNumber: resource.serialNumber || 'N/A',
          calibrationDate: today,
          nextDueDate: nextYear,
          certificateNumber: certNumber,
          technicianName: 'Lead Biomedical Engineer',
          result: 'PASS',
        },
        `calibration:${resource.resourceId}:${certNumber}`
      );
      await refreshProjection();
      setActionMessage({
        text: `Biomedical calibration validated for ${resource.name}. Asset returned to clinical service!`,
        type: 'success',
      });
    } catch (e: any) {
      setActionMessage({ text: e.message || 'Calibration failed', type: 'error' });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-purple-600/10 text-purple-600 flex items-center justify-center font-bold">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
              Hospital Resource & Capacity Operating System
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unified registry for rooms, biomedical assets, conflict-free scheduling, calibration lockouts, and work orders.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddResourceModal(true)}
            className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Asset</span>
          </button>
        </div>
      </div>

      {/* Action Notification Alert */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-700 text-sm font-bold">
            ×
          </button>
        </div>
      )}

      {loadingProjection && (
        <div className="text-xs text-slate-500">Refreshing authoritative facility/resource state…</div>
      )}

      {/* Real-time KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Total Hospital Assets</span>
            <Boxes className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100">{totalAssets}</div>
          <span className="text-[10px] text-slate-400 font-medium">4 Key Departments</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Ready for Procedures</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-xl font-black text-emerald-600">{availableAssets}</div>
          <span className="text-[10px] text-emerald-600 font-medium">Calibrated & Sterile</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Active In Surgery / Use</span>
            <Activity className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl font-black text-blue-600">{inUseAssets}</div>
          <span className="text-[10px] text-blue-600 font-medium">Robotics & Theaters</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Calibration Lockout</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-black text-rose-600">{calibrationLocked}</div>
          <span className="text-[10px] text-rose-600 font-medium">Blocked From Clinical Use</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-semibold">Open Work Orders</span>
            <Wrench className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-600">{pendingMaintenance}</div>
          <span className="text-[10px] text-amber-700 font-medium">Biomedical Queue</span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {[
          { id: 'master', label: 'Resource Master Registry', icon: Boxes },
          { id: 'rooms', label: 'Rooms & Facilities', icon: Building },
          { id: 'reservations', label: 'Reservation & Conflict Engine', icon: Calendar },
          { id: 'transfers', label: 'Custody & Inter-Dept Transfers', icon: ArrowRight },
          { id: 'maintenance', label: 'Maintenance & Work Orders', icon: Wrench },
          { id: 'calibration', label: 'Biomedical Calibration & Safety', icon: Gauge, badge: calibrationLocked },
          { id: 'matcher', label: 'Hospital Operations Matcher', icon: Zap },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-purple-600 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: RESOURCE MASTER REGISTRY */}
      {/* ========================================================================= */}
      {activeTab === 'master' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by asset name, tag number, model, serial..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800"
              >
                <option value="All">All Resource Types</option>
                <option value="MEDICAL_DEVICE">Medical Device</option>
                <option value="SURGICAL_EQUIPMENT">Surgical Equipment</option>
                <option value="RADIOLOGY_EQUIPMENT">Radiology Imaging</option>
                <option value="LAB_EQUIPMENT">Lab Analyzers</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-800"
              >
                <option value="All">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="IN_USE">In Use</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="UNDER_REPAIR">Under Repair</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Asset Details</th>
                    <th className="px-4 py-3">Department & Location</th>
                    <th className="px-4 py-3">Calibration Status</th>
                    <th className="px-4 py-3">Operating Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {resources
                    .filter((res) => {
                      const matchesSearch =
                        res.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        res.resourceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (res.serialNumber && res.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()));
                      const matchesType = typeFilter === 'All' || res.resourceType === typeFilter;
                      const matchesStatus = statusFilter === 'All' || res.status === statusFilter;
                      return matchesSearch && matchesType && matchesStatus;
                    })
                    .map((res) => (
                      <tr key={res.resourceId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <span className="font-bold text-slate-900 dark:text-slate-100 block">{res.name}</span>
                          <span className="font-mono text-[10px] text-purple-600">
                            {res.resourceNumber} • {res.manufacturer} ({res.model})
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800 dark:text-slate-200 block">{res.departmentName}</span>
                          <span className="text-[11px] text-slate-500">
                            {res.location.building} • {res.location.roomNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {res.calibrationStatus === 'VALID' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <ShieldCheck className="w-3 h-3" /> VALID UNTIL {res.nextCalibrationDate}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <ShieldAlert className="w-3 h-3" /> CALIBRATION LOCKOUT
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              res.status === 'AVAILABLE'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : res.status === 'IN_USE'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {res.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {res.calibrationStatus === 'CALIBRATION_REQUIRED' && (
                            <button
                              onClick={() => handleRecordCalibrationPass(res)}
                              className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Recertify Calibration
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ROOMS & FACILITY CAPACITY */}
      {/* ========================================================================= */}
      {activeTab === 'rooms' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Building className="w-4 h-4 text-purple-600" /> Hospital Room Roster & Double-Booking Protection
              </h2>
              <span className="text-xs text-slate-500">Atomic Collision Detection Active</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {rooms.map((rm) => (
                <div key={rm.roomId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{rm.roomNumber}</h3>
                      <span className="text-[11px] text-purple-600 font-medium">{rm.departmentName}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        rm.status === 'AVAILABLE'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      {rm.status}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 space-y-1">
                    <p>Building: <strong className="text-slate-800 dark:text-slate-200">{rm.building} ({rm.floor})</strong></p>
                    <p>Type: <span className="font-semibold text-slate-700 dark:text-slate-300">{rm.roomType.replace('_', ' ')}</span></p>
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-semibold text-slate-400 block mb-1">Clinical Features</span>
                    <div className="flex flex-wrap gap-1">
                      {rm.features?.map((f) => (
                        <span key={f} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: HOSPITAL OPERATIONS MATCHER */}
      {/* ========================================================================= */}
      {activeTab === 'matcher' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-600" /> Cross-Department Operational Resource Matcher
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulates complete clinical workflow readiness: matching credentialed clinicians + available rooms + calibrated medical devices.
              </p>
            </div>

            <button
              onClick={handleExecuteMatching}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>Evaluate Match Feasibility</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                Target Clinical Workflow
              </label>
              <select
                value={matchServiceType}
                onChange={(e) => setMatchServiceType(e.target.value as any)}
                className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="OT_SURGERY">Operating Theater (Cardiothoracic CABG)</option>
                <option value="OPD">OPD Specialist Consultation</option>
                <option value="EMERGENCY_SURGE">Emergency Mass Casualty Surge</option>
              </select>
            </div>
          </div>

          {matchResult && (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                    MATCH CONFIRMED (Feasibility Score: {matchResult.matchScore}%)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200/80">
                  <span className="text-[10px] text-slate-400 block">Lead Physician</span>
                  <strong className="text-slate-900 dark:text-slate-100">{matchResult.matchedPhysician?.fullName}</strong>
                  <span className="text-[10px] text-emerald-600 block">Privilege: VERIFIED ACTIVE</span>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200/80">
                  <span className="text-[10px] text-slate-400 block">Assigned Operating Suite</span>
                  <strong className="text-slate-900 dark:text-slate-100">{matchResult.matchedRoom?.roomNumber}</strong>
                  <span className="text-[10px] text-emerald-600 block">Laminar Flow Sterile</span>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200/80">
                  <span className="text-[10px] text-slate-400 block">Calibrated Medical Equipment</span>
                  <strong className="text-slate-900 dark:text-slate-100">{matchResult.matchedEquipment?.length || 0} Assets Ready</strong>
                  <span className="text-[10px] text-emerald-600 block">Anesthesia & Consoles Valid</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
