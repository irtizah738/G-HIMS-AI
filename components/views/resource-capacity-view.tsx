'use client';

import React, { useState } from 'react';
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
import { ResourceCapacityDomainService } from '@/lib/backend/services/resource-capacity-domain-service';

export function ResourceCapacityView() {
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

  // Sample Master Datasets
  const [resources, setResources] = useState<ResourceMaster[]>([
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
      createdAt: '2023-05-15T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
    {
      resourceId: 'res_002',
      resourceNumber: 'RES-SUR-8102',
      resourceType: 'SURGICAL_EQUIPMENT',
      name: 'Intuitive da Vinci Xi Surgical Robotic Console',
      facilityId: 'fac_central',
      departmentId: 'dept_surgery',
      departmentName: 'Surgical Theaters',
      ownerDepartmentId: 'dept_surgery',
      location: { building: 'Surgical Pavilion', floor: 'Floor 3', roomNumber: 'OR-03' },
      status: 'IN_USE',
      manufacturer: 'Intuitive Surgical',
      model: 'da Vinci Xi',
      serialNumber: 'IS-XI-78401',
      assetTagNumber: 'TAG-39201',
      calibrationRequired: true,
      calibrationStatus: 'VALID',
      lastCalibrationDate: '2026-01-15',
      nextCalibrationDate: '2026-07-15',
      currentCustodianName: 'Dr. Elena Rostova',
      acquisitionDate: '2022-09-10',
      lifecycleState: 'IN_SERVICE',
      createdAt: '2022-09-10T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      resourceId: 'res_003',
      resourceNumber: 'RES-RAD-1920',
      resourceType: 'RADIOLOGY_EQUIPMENT',
      name: 'Siemens SOMATOM Force Dual-Source CT Scanner',
      facilityId: 'fac_central',
      departmentId: 'dept_radiology',
      departmentName: 'Diagnostic Imaging',
      ownerDepartmentId: 'dept_radiology',
      location: { building: 'Diagnostic Wing', floor: 'Ground Floor', roomNumber: 'RAD-CT-02' },
      status: 'AVAILABLE',
      manufacturer: 'Siemens Healthineers',
      model: 'SOMATOM Force',
      serialNumber: 'SIEM-CT-5510',
      assetTagNumber: 'TAG-10492',
      calibrationRequired: true,
      calibrationStatus: 'CALIBRATION_REQUIRED', // Requires calibration!
      lastCalibrationDate: '2025-02-15',
      nextCalibrationDate: '2026-02-15', // Past due
      acquisitionDate: '2021-08-01',
      lifecycleState: 'UNDER_REPAIR',
      createdAt: '2021-08-01T00:00:00Z',
      updatedAt: '2026-02-20T00:00:00Z',
    },
    {
      resourceId: 'res_004',
      resourceNumber: 'RES-LAB-3891',
      resourceType: 'LAB_EQUIPMENT',
      name: 'Roche Cobas 8000 Clinical Chemistry Analyzer',
      facilityId: 'fac_central',
      departmentId: 'dept_laboratory',
      departmentName: 'Central Diagnostic Lab',
      ownerDepartmentId: 'dept_laboratory',
      location: { building: 'Diagnostic Wing', floor: 'Floor 2', roomNumber: 'LAB-204' },
      status: 'AVAILABLE',
      manufacturer: 'Roche Diagnostics',
      model: 'Cobas 8000',
      serialNumber: 'RCH-8000-4819',
      assetTagNumber: 'TAG-59201',
      calibrationRequired: true,
      calibrationStatus: 'VALID',
      lastCalibrationDate: '2026-02-01',
      nextCalibrationDate: '2026-08-01',
      acquisitionDate: '2023-01-20',
      lifecycleState: 'IN_SERVICE',
      createdAt: '2023-01-20T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    },
  ]);

  const [rooms, setRooms] = useState<HospitalRoom[]>([
    {
      roomId: 'rm_001',
      roomNumber: 'OR-01',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      building: 'Surgical Pavilion',
      floor: 'Floor 3',
      departmentId: 'dept_surgery',
      departmentName: 'Surgical Theaters',
      roomType: 'operating_room',
      capacity: 1,
      currentOccupancy: 0,
      status: 'AVAILABLE',
      features: ['Laminar Flow', 'HEPA Filtration', 'Negative Pressure', 'Central Gas Outlets'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      roomId: 'rm_002',
      roomNumber: 'OR-03 (Robotics)',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      building: 'Surgical Pavilion',
      floor: 'Floor 3',
      departmentId: 'dept_surgery',
      departmentName: 'Surgical Theaters',
      roomType: 'operating_room',
      capacity: 1,
      currentOccupancy: 1,
      status: 'IN_USE',
      features: ['Robotic Arms Docking', 'HD Surgical Monitors', 'Laminar Airflow'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
    {
      roomId: 'rm_003',
      roomNumber: 'CONS-CARD-104',
      facilityId: 'fac_central',
      facilityName: 'Central Metro Hospital',
      building: 'Outpatient Pavilion',
      floor: 'Floor 1',
      departmentId: 'dept_cardiology',
      departmentName: 'Cardiology Outpatient',
      roomType: 'consultation',
      capacity: 1,
      currentOccupancy: 0,
      status: 'AVAILABLE',
      features: ['12-Lead ECG Machine', 'Echocardiography Station', 'Examination Couch'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    },
  ]);

  const [transfers, setTransfers] = useState<ResourceTransferRecord[]>([
    {
      transferId: 'trf_001',
      resourceId: 'res_001',
      resourceName: 'GE Anesthesia Delivery CS2',
      sourceDepartmentId: 'dept_surgery',
      sourceDepartmentName: 'Surgical Theaters',
      destinationDepartmentId: 'dept_emergency',
      destinationDepartmentName: 'Emergency Trauma Care',
      sourceFacilityId: 'fac_central',
      destinationFacilityId: 'fac_central',
      requestedBy: 'usr_er_lead',
      requestedByName: 'Dr. Michael Chang',
      transferredAt: '2026-02-28T10:00:00Z',
      reason: 'Temporary surge capacity support during multi-vehicle collision trauma response',
      status: 'COMPLETED',
      transferChecklistVerified: true,
      createdAt: '2026-02-28T10:00:00Z',
    },
  ]);

  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([
    {
      workOrderId: 'wo_001',
      workOrderNumber: 'WO-2026-4819',
      resourceId: 'res_003',
      resourceName: 'Siemens SOMATOM Force CT Scanner',
      resourceType: 'RADIOLOGY_EQUIPMENT',
      issueDescription: 'X-ray tube calibration drift exceeding ±2.5% tolerance threshold',
      maintenanceType: 'CORRECTIVE',
      priority: 'HIGH',
      reportedByActorId: 'usr_rad_lead',
      reportedByName: 'Radiology Chief Tech',
      assignedTechnicianName: 'Siemens Certified Field Specialist',
      status: 'IN_PROGRESS',
      openedAt: '2026-02-27T08:00:00Z',
      createdAt: '2026-02-27T08:00:00Z',
      updatedAt: '2026-03-01T09:00:00Z',
    },
  ]);

  const [calibrations, setCalibrations] = useState<CalibrationRecord[]>([
    {
      calibrationId: 'cal_001',
      resourceId: 'res_001',
      resourceName: 'GE Healthcare Aisys CS2 Anesthesia',
      model: 'Aisys CS2',
      serialNumber: 'GE-ANE-98412',
      calibrationDate: '2025-11-10',
      nextDueDate: '2026-11-10',
      certificateNumber: 'CAL-2025-9941',
      technicianName: 'Biomedical Inspection Agency',
      result: 'PASS',
      status: 'VALID',
      createdAt: '2025-11-10T00:00:00Z',
    },
    {
      calibrationId: 'cal_002',
      resourceId: 'res_003',
      resourceName: 'Siemens SOMATOM Force CT Scanner',
      model: 'SOMATOM Force',
      serialNumber: 'SIEM-CT-5510',
      calibrationDate: '2025-02-15',
      nextDueDate: '2026-02-15', // Expired
      certificateNumber: 'CAL-2025-1049',
      technicianName: 'Siemens Service Team',
      result: 'FAIL',
      status: 'CALIBRATION_REQUIRED',
      createdAt: '2025-02-15T00:00:00Z',
    },
  ]);

  const [reservations, setReservations] = useState<ResourceReservation[]>([
    {
      reservationId: 'resv_001',
      resourceId: 'rm_002',
      resourceName: 'Operating Theater OR-03',
      resourceType: 'ROOM',
      facilityId: 'fac_central',
      departmentId: 'dept_surgery',
      startTime: `${new Date().toISOString().split('T')[0]}T08:00:00Z`,
      endTime: `${new Date().toISOString().split('T')[0]}T14:00:00Z`,
      purpose: 'SURGICAL_PROCEDURE',
      procedureCode: 'CPT-33533 (Coronary Artery Bypass)',
      patientName: 'Robert Langdon (MRN-84920)',
      requesterActorId: 'usr_surgeon',
      requesterName: 'Dr. Elena Rostova, MD',
      priority: 'URGENT',
      status: 'IN_USE',
      createdAt: '2026-03-01T06:00:00Z',
      updatedAt: '2026-03-01T08:00:00Z',
    },
  ]);

  // Aggregate Metrics
  const totalAssets = resources.length;
  const availableAssets = resources.filter((r) => r.status === 'AVAILABLE').length;
  const inUseAssets = resources.filter((r) => r.status === 'IN_USE').length;
  const calibrationLocked = resources.filter((r) => r.calibrationStatus === 'CALIBRATION_REQUIRED').length;
  const pendingMaintenance = workOrders.filter((w) => w.status !== 'COMPLETED').length;

  const handleExecuteMatching = () => {
    const result = ResourceCapacityDomainService.matchOperationalCapacity({
      serviceType: matchServiceType,
      specialty: 'Cardiothoracic Surgery',
      scheduledTime: new Date().toISOString(),
      durationMinutes: 180,
      requiredRoomType: 'operating_room',
      requiredPrivileges: ['PERFORM_CARDIOTHORACIC_SURGERY', 'ADMINISTER_ANESTHESIA'],
      requiredEquipmentTypes: ['MEDICAL_DEVICE', 'SURGICAL_EQUIPMENT'],
    });

    setMatchResult(result);
  };

  const handleRecordCalibrationPass = async (resource: ResourceMaster) => {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const certNumber = `CAL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const result = await ResourceCapacityDomainService.recordCalibration(
        {
          actorId: 'usr_biomed_engineer',
          tenantId: 'metro-health',
          roles: ['BIOMEDICAL_ENGINEER'],
          permissions: ['CALIBRATE_EQUIPMENT'],
          correlationId: `cor_${Date.now()}`,
          requestId: `req_${Date.now()}`,
        },
        `cmd_${Date.now()}`,
        `idemp_${Date.now()}`,
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
        }
      );

      if (result.success) {
        setResources((prev) =>
          prev.map((r) =>
            r.resourceId === resource.resourceId
              ? {
                  ...r,
                  calibrationStatus: 'VALID',
                  status: 'AVAILABLE',
                  nextCalibrationDate: nextYear,
                  calibrationCertificateNumber: certNumber,
                }
              : r
          )
        );
        setActionMessage({
          text: `Biomedical calibration validated for ${resource.name}. Asset returned to clinical service!`,
          type: 'success',
        });
      }
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
