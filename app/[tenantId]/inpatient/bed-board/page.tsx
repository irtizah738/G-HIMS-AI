'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BedDouble,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ArrowRightLeft,
  UserPlus,
  LogOut,
  Wrench,
  Search,
  Filter,
  RefreshCw,
  Activity,
  HeartPulse,
  Wind,
  Radio,
  ShieldAlert,
  Clock,
  User,
  Phone,
  FileText,
  Bed as BedIcon,
  ChevronRight,
  ArrowUpRight,
  Layers,
  SlidersHorizontal,
  X,
  Stethoscope,
  Scissors,
  Check,
  AlertCircle,
  HelpCircle,
  Wifi,
  WifiOff,
  CloudUpload,
  Thermometer,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import {
  Ward,
  Bed,
  BedStatus,
  BedClass,
  IsolationType,
  BedTransfer,
} from '@/types/inpatient-or';
import {
  subscribeToWardsAndBeds,
  subscribeToBedTransfers,
  seedInitialInpatientORData,
} from '@/lib/firebase/services/inpatient-or';
import { calculateNEWS2, getNEWS2BadgeClasses, VitalSignsInput, NEWS2CalculationResult } from '@/lib/clinical/news2';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { seedDefaultBedOccupancy } from '@/lib/offline/db';
import { WardOccupancyChart } from '@/components/inpatient/WardOccupancyChart';
import { HospitalCensusTrendChart } from '@/components/inpatient/HospitalCensusTrendChart';
import { OfflineActivityStreamDrawer } from '@/components/offline/OfflineActivityStreamDrawer';
import { DischargeConfirmationModal } from '@/components/inpatient/DischargeConfirmationModal';
import { MRNQuickLookup } from '@/components/inpatient/MRNQuickLookup';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

export default function InpatientBedBoardPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const {
    isOnline,
    isSyncing,
    pendingMutationsCount,
    conflictCount,
    triggerSync,
  } = useOfflineSync(tenantId);

  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [transfers, setTransfers] = useState<BedTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & View State
  const [selectedWardId, setSelectedWardId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCriticalOnly, setFilterCriticalOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'matrix' | 'table' | 'transfers'>('matrix');

  // Modals & Drawer state
  const [activityStreamOpen, setActivityStreamOpen] = useState(false);
  const [admitModalOpen, setAdmitModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [dischargeModalOpen, setDischargeModalOpen] = useState(false);
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false);
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Interactive NEWS2 Calculation State for Bed Admission
  const [admissionVitals, setAdmissionVitals] = useState<VitalSignsInput>({
    respirationRate: 16,
    spO2: 98,
    spO2Scale: 1,
    onSupplementalOxygen: false,
    systolicBP: 120,
    heartRate: 72,
    consciousness: 'Alert',
    temperature: 36.8,
  });

  // Admission Form State
  const [admitForm, setAdmitForm] = useState({
    patientId: '',
    patientName: '',
    patientMRN: '',
    patientAge: 45,
    patientGender: 'Male' as 'Male' | 'Female' | 'Other',
    primaryDiagnosis: 'Community Acquired Pneumonia',
    assignedDoctor: 'Dr. Sarah Jenkins, FACS',
    assignedNurse: 'Nurse Clara Oswald, RN',
    isolationType: 'none' as IsolationType,
    oxygenPort: true,
    telemetryEnabled: false,
    expectedDischargeDate: '',
    notes: '',
  });

  // Transfer Form State
  const [transferForm, setTransferForm] = useState({
    targetBedId: '',
    requestedBy: 'Dr. David Rodriguez, MD',
    approvedBy: 'Charge Nurse Maya Patel, BSN',
    reason: 'Clinical condition escalation requiring continuous ICU telemetry & ventilation support',
    clinicalIndication: 'Step-up care / Post-op hemodynamic instability',
  });

  // Discharge Form State
  const [dischargeForm, setDischargeForm] = useState({
    dischargedBy: 'Dr. Sarah Jenkins, FACS',
    notes: 'Patient clinically stable for discharge to home. Follow-up clinic appointment in 7 days.',
  });

  // Compute live NEWS2 score for Admission Modal
  const calculatedAdmissionNEWS2: NEWS2CalculationResult = useMemo(() => {
    return calculateNEWS2(admissionVitals);
  }, [admissionVitals]);

  // Initial Load & Real-Time / Offline Sync
  useEffect(() => {
    setLoading(true);

    // Demo fixtures never populate STAGING/PRODUCTION census state.
    if (IS_DEMO_RUNTIME) {
      seedDefaultBedOccupancy(tenantId).catch(console.warn);
    }

    const unsubscribe = subscribeToWardsAndBeds(tenantId, ({ wards: wList, beds: bList }) => {
      setWards(wList);
      setBeds(bList);
      setLoading(false);
    });

    const unsubTransfers = subscribeToBedTransfers(tenantId, (trfList) => {
      setTransfers(trfList);
    });

    return () => {
      unsubscribe();
      unsubTransfers();
    };
  }, [tenantId]);

  // Notifications timeout
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Bed-board acuity is display-only and may only show an explicitly stored score.
  // Never infer NEWS2 from bed class, isolation status, or other non-vital metadata.
  const getBedNEWS2 = (bed: Bed) => {
    if (typeof bed.acuityScore === 'number' && Number.isFinite(bed.acuityScore)) {
      const score = bed.acuityScore;
      let riskLevel: 'Low' | 'Low-Medium' | 'Medium' | 'High' = 'Low';
      if (score >= 7) riskLevel = 'High';
      else if (score >= 5) riskLevel = 'Medium';
      else if (score >= 3) riskLevel = 'Low-Medium';
      return { score, riskLevel };
    }
    return { score: null, riskLevel: null };
  };

  const hasHighRecordedNEWS2 = (bed: Bed): boolean => {
    const score = getBedNEWS2(bed).score;
    return bed.status === 'occupied' && typeof score === 'number' && score >= 5;
  };

  const criticalNEWS2Beds = useMemo(
    () => beds.filter(hasHighRecordedNEWS2),
    [beds]
  );

  // Statistics Calculations
  const stats = useMemo(() => {
    const total = beds.length;
    const occupied = beds.filter((b) => b.status === 'occupied').length;
    const available = beds.filter((b) => b.status === 'available').length;
    const cleaning = beds.filter((b) => b.status === 'cleaning').length;
    const maintenance = beds.filter((b) => b.status === 'maintenance').length;
    const reserved = beds.filter((b) => b.status === 'reserved').length;
    const occupancyRate = total > 0 ? Math.round((occupied / total) * 100) : 0;
    const criticalAlerts = beds.filter(hasHighRecordedNEWS2).length;

    return {
      total,
      occupied,
      available,
      cleaning,
      maintenance,
      reserved,
      occupancyRate,
      criticalAlerts,
    };
  }, [beds]);

  // Filtered beds
  const filteredBeds = useMemo(() => {
    return beds.filter((bed) => {
      if (selectedWardId !== 'all' && bed.wardId !== selectedWardId) return false;
      if (selectedStatus !== 'all' && bed.status !== selectedStatus) return false;
      if (selectedClass !== 'all' && bed.class !== selectedClass) return false;
      if (filterCriticalOnly && !hasHighRecordedNEWS2(bed)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchBed = bed.bedNumber.toLowerCase().includes(q) || bed.roomNumber.toLowerCase().includes(q);
        const matchPatient =
          bed.patientName?.toLowerCase().includes(q) ||
          bed.patientMRN?.toLowerCase().includes(q) ||
          bed.assignedDoctor?.toLowerCase().includes(q);
        const matchWard = bed.wardName.toLowerCase().includes(q);
        if (!matchBed && !matchPatient && !matchWard) return false;
      }
      return true;
    });
  }, [beds, selectedWardId, selectedStatus, selectedClass, searchQuery, filterCriticalOnly]);

  // Group beds by ward
  const bedsByWard = useMemo(() => {
    const map = new Map<string, { ward: Ward; beds: Bed[] }>();

    wards.forEach((w) => {
      map.set(w.id, { ward: w, beds: [] });
    });

    filteredBeds.forEach((bed) => {
      if (!map.has(bed.wardId)) {
        map.set(bed.wardId, {
          ward: {
            id: bed.wardId,
            tenantId,
            name: bed.wardName,
            floor: 'Main Complex',
            department: 'General_Medicine',
            totalBeds: 10,
          },
          beds: [],
        });
      }
      map.get(bed.wardId)!.beds.push(bed);
    });

    return Array.from(map.values()).filter((item) => item.beds.length > 0 || selectedWardId === item.ward.id);
  }, [wards, filteredBeds, selectedWardId, tenantId]);

  // Available beds for transfer dropdown
  const availableTargetBeds = useMemo(() => {
    return beds.filter((b) => b.status === 'available' && b.id !== selectedBed?.id);
  }, [beds, selectedBed]);

  // Admission Modal Trigger
  const handleOpenAdmit = (bed: Bed) => {
    setSelectedBed(bed);
    setAdmitForm({
      patientId: '',
      patientName: '',
      patientMRN: '',
      patientAge: 52,
      patientGender: 'Male',
      primaryDiagnosis: 'Acute Exacerbation / Inpatient Care',
      assignedDoctor: bed.assignedDoctor || 'Dr. Sarah Jenkins, FACS',
      assignedNurse: bed.assignedNurse || 'Nurse Clara Oswald, RN',
      isolationType: bed.isolationType || 'none',
      oxygenPort: bed.oxygenPort,
      telemetryEnabled: bed.telemetryEnabled,
      expectedDischargeDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
      notes: '',
    });
    setAdmissionVitals({
      respirationRate: 16,
      spO2: 98,
      spO2Scale: 1,
      onSupplementalOxygen: false,
      systolicBP: 120,
      heartRate: 74,
      consciousness: 'Alert',
      temperature: 36.8,
    });
    setAdmitModalOpen(true);
  };

  // Execute authoritative inpatient admission. Patient identity must already exist in MPI.
  const handleExecuteAdmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBed) return;

    if (!admitForm.patientId.trim()) {
      setErrorMsg('Existing registered Patient ID is required. Register the patient before inpatient admission.');
      return;
    }
    if (!admitForm.primaryDiagnosis.trim()) {
      setErrorMsg('Admitting diagnosis is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const result = await executeActiveTenantCommand<Record<string, unknown>>(
        'AdmitPatientToInpatientCareCommand',
        {
          patientId: admitForm.patientId.trim(),
          bedId: selectedBed.id,
          admittingDiagnosis: admitForm.primaryDiagnosis.trim(),
          targetWard: selectedBed.wardName || selectedBed.wardId,
          assignedDoctor: admitForm.assignedDoctor || undefined,
          assignedNurse: admitForm.assignedNurse || undefined,
          priority:
            calculatedAdmissionNEWS2.score >= 5 ? 'URGENT' : 'ROUTINE',
        },
        {
          idempotencyKey:
            `ipd-admission:${admitForm.patientId.trim()}:${selectedBed.id}`,
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Inpatient admission failed.');
      }

      setSuccessMsg(
        `Patient admitted authoritatively to Bed ${selectedBed.bedNumber}. The NEWS2 calculator shown during admission is a preview only; record authoritative vitals in the inpatient clinical workflow for CI-7.`
      );
      setAdmitModalOpen(false);
      setSelectedBed(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create inpatient admission.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Transfer Bed Modal Trigger
  const handleOpenTransfer = (bed: Bed) => {
    setSelectedBed(bed);
    const firstAvail = availableTargetBeds[0]?.id || '';
    setTransferForm({
      targetBedId: firstAvail,
      requestedBy: bed.assignedDoctor || 'Dr. David Rodriguez, MD',
      approvedBy: 'Charge Nurse Maya Patel, BSN',
      reason: 'Clinical step-down / ward reallocation',
      clinicalIndication: 'Patient condition stabilized under treatment protocol',
    });
    setTransferModalOpen(true);
  };

  // Execute authoritative inpatient bed transfer.
  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBed || !transferForm.targetBedId) return;

    if (!selectedBed.currentEncounterId) {
      setErrorMsg(
        'Active inpatient encounter identity is missing for this bed. Refresh from the authoritative census before transfer.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const target = beds.find((b) => b.id === transferForm.targetBedId);
      const result = await executeActiveTenantCommand<Record<string, unknown>>(
        'TransferInpatientBedCommand',
        {
          encounterId: selectedBed.currentEncounterId,
          sourceBedId: selectedBed.id,
          targetBedId: transferForm.targetBedId,
          reason: transferForm.reason,
          clinicalIndication: transferForm.clinicalIndication,
        },
        {
          idempotencyKey:
            `ipd-bed-transfer:${selectedBed.currentEncounterId}:${selectedBed.id}:${transferForm.targetBedId}`,
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Inpatient bed transfer failed.');
      }

      setSuccessMsg(
        `Authoritative transfer completed from ${selectedBed.bedNumber} to ${target?.bedNumber || transferForm.targetBedId}. Source bed moved to cleaning.`
      );
      setTransferModalOpen(false);
      setSelectedBed(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to execute bed transfer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Discharge Modal Trigger
  const handleOpenDischarge = (bed: Bed) => {
    setSelectedBed(bed);
    setDischargeForm({
      dischargedBy: bed.assignedDoctor || 'Dr. Sarah Jenkins, FACS',
      notes: '',
    });
    setDischargeModalOpen(true);
  };

  // Bed Board never releases census directly. It creates the signed summary
  // then submits the governed encounter discharge; the server re-checks all CI-7
  // safety evidence regardless of UI review prompts.
  const handleConfirmDischargeModal = async (formData: {
    dischargedBy: string;
    disposition: string;
    notes: string;
    followUpInstructions: string;
    clearanceChecks: Record<string, boolean>;
  }) => {
    if (!selectedBed) return;

    if (!selectedBed.currentEncounterId || !selectedBed.currentPatientId) {
      setErrorMsg(
        'Authoritative inpatient encounter/patient identity is missing for this bed. Refresh the census before discharge.'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const summary = await executeActiveTenantCommand<Record<string, unknown>>(
        'SignClinicalNoteCommand',
        {
          encounterId: selectedBed.currentEncounterId,
          patientId: selectedBed.currentPatientId,
          category: 'DISCHARGE',
          content: formData.notes,
        },
        {
          idempotencyKey:
            `ipd-discharge-summary:${selectedBed.currentEncounterId}`,
        }
      );
      if (!summary.success) {
        throw new Error(summary.error?.message || 'Discharge summary signing failed.');
      }

      const dischargeSummaryEvidenceId = String(
        summary.entityId ||
          (summary.data as Record<string, unknown> | undefined)?.evidenceId ||
          ''
      );
      if (!dischargeSummaryEvidenceId) {
        throw new Error('SIGNED_DISCHARGE_SUMMARY_ID_MISSING');
      }

      const discharge = await executeActiveTenantCommand<Record<string, unknown>>(
        'DischargeInpatientEncounterCommand',
        {
          encounterId: selectedBed.currentEncounterId,
          bedId: selectedBed.id,
          disposition: formData.disposition,
          dischargeSummaryEvidenceId,
          followUpInstructions: formData.followUpInstructions,
          notes: formData.notes,
        },
        {
          idempotencyKey:
            `ipd-discharge:${selectedBed.currentEncounterId}:${dischargeSummaryEvidenceId}`,
        }
      );
      if (!discharge.success) {
        throw new Error(discharge.error?.message || 'Governed inpatient discharge failed.');
      }

      setSuccessMsg(
        `Patient ${selectedBed.patientName || selectedBed.currentPatientId} discharged through the governed encounter workflow. Bed ${selectedBed.bedNumber} is now queued for cleaning.`
      );
      setDischargeModalOpen(false);
      setSelectedBed(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to discharge patient.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateOperationalBedStatus = async (
    bed: Bed,
    status: 'available' | 'cleaning' | 'reserved' | 'maintenance',
    notes: string
  ) => {
    const result = await executeActiveTenantCommand<Record<string, unknown>>(
      'UpdateBedStatusCommand',
      { bedId: bed.id, status, notes },
      {
        idempotencyKey:
          `bed-status:${bed.id}:${status}:${Date.now()}`,
      }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Bed status update failed.');
    }
  };

  const handleQuickSanitize = async (bed: Bed) => {
    if (bed.status === 'occupied' || bed.currentPatientId) {
      setErrorMsg(
        'Occupied beds cannot enter cleaning directly. Transfer or discharge the active inpatient encounter first.'
      );
      return;
    }
    try {
      setErrorMsg(null);
      await updateOperationalBedStatus(
        bed,
        'cleaning',
        `Quick sanitize initiated for Bed ${bed.bedNumber}.`
      );
      setSuccessMsg(
        `Bed ${bed.bedNumber} moved to Housekeeping Cleaning.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to initiate Quick Sanitize.');
    }
  };

  const handleMarkCleaned = async (bed: Bed) => {
    try {
      setErrorMsg(null);
      await updateOperationalBedStatus(
        bed,
        'available',
        'Sanitization and disinfection certified. Ready for admission.'
      );
      setSuccessMsg(
        `Bed ${bed.bedNumber} sanitization certified and available.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to certify bed sanitization.');
    }
  };

  const handleToggleMaintenance = async (bed: Bed) => {
    try {
      setErrorMsg(null);
      const newStatus =
        bed.status === 'maintenance' ? 'available' : 'maintenance';
      await updateOperationalBedStatus(
        bed,
        newStatus,
        newStatus === 'maintenance'
          ? 'Bio-Medical Engineering maintenance hold.'
          : 'Maintenance completed and cleared.'
      );
      setSuccessMsg(
        `Bed ${bed.bedNumber} status updated to ${newStatus.toUpperCase()}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update bed maintenance status.');
    }
  };

  // Helper for Status Badge Styling
  const getStatusBadge = (status: BedStatus) => {
    switch (status) {
      case 'available':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
          dot: 'bg-emerald-500',
          label: 'Available',
        };
      case 'occupied':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
          dot: 'bg-rose-500',
          label: 'Occupied',
        };
      case 'cleaning':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
          dot: 'bg-amber-500 animate-pulse',
          label: 'Housekeeping (EVS)',
        };
      case 'reserved':
        return {
          bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
          dot: 'bg-blue-500',
          label: 'Reserved (OR/PACU)',
        };
      case 'maintenance':
        return {
          bg: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          dot: 'bg-slate-500',
          label: 'Maintenance Hold',
        };
    }
  };

  const getClassBadge = (cls: BedClass) => {
    switch (cls) {
      case 'icu':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800 font-bold';
      case 'private':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800';
      case 'semi_private':
        return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800';
      case 'general':
        return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      {/* Top Banner Header */}
      <div className="border-b border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                <Building2 className="h-4 w-4" />
                <span>Inpatient Bed Management & Census Engine</span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  Tenant: {tenantId}
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                Hospital Ward & Bed Matrix
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Real-time NEWS2 acuity telemetry, Dexie.js offline replication, atomic bed transfers, and automated housekeeping turnaround.
              </p>
            </div>

            {/* Offline Sync State Badge & Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Offline Activity Stream Drawer Trigger Button */}
              <button
                type="button"
                onClick={() => setActivityStreamOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                title="View detailed offline operations queue and sync conflict logs"
              >
                <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Offline Stream</span>
                {(pendingMutationsCount > 0 || conflictCount > 0) && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white animate-pulse">
                    {pendingMutationsCount + conflictCount}
                  </span>
                )}
              </button>

              {/* Offline / Online Sync State Pill */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs shadow-2xs dark:border-slate-800 dark:bg-slate-800">
                {isOnline ? (
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                    <Wifi className="h-3.5 w-3.5" />
                    <span>Cloud Connected</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                    <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                    <span>Offline (Dexie.js Queue)</span>
                  </span>
                )}

                {pendingMutationsCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                    {pendingMutationsCount} Pending Sync
                  </span>
                )}

                {conflictCount > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/60 dark:text-rose-300">
                    {conflictCount} Conflicts
                  </span>
                )}

                <button
                  onClick={() => triggerSync()}
                  disabled={isSyncing || !isOnline}
                  className="ml-1 inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-2xs hover:bg-slate-100 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200"
                  title="Trigger Immediate Sync with Firestore"
                >
                  <CloudUpload className={`h-3 w-3 ${isSyncing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>

              <Link
                href={`/${tenantId}/or/cases/case-or-101`}
                className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3.5 py-2 text-xs font-semibold text-purple-700 shadow-xs transition hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
              >
                <Scissors className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span>OR Case Console</span>
                <ArrowRightLeft className="h-3 w-3 text-purple-400" />
              </Link>

              <button
                onClick={() => {
                  if (IS_DEMO_RUNTIME) void seedInitialInpatientORData(tenantId);
                }}
                disabled={!IS_DEMO_RUNTIME}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title={
                  IS_DEMO_RUNTIME
                    ? 'Reset or re-seed sample beds & wards'
                    : 'Demo seeding is disabled in STAGING/PRODUCTION'
                }
              >
                <RefreshCw className="h-4 w-4 text-slate-500" />
                <span>Re-Sync Wards</span>
              </button>
            </div>
          </div>

          {/* Real-Time NEWS2 Deterioration Alert Banner */}
          {criticalNEWS2Beds.length > 0 && (
            <div className="mt-4 rounded-xl border border-rose-300 bg-rose-500/10 p-4 backdrop-blur-xs dark:border-rose-800 dark:bg-rose-950/40 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-md animate-pulse">
                    <HeartPulse className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-rose-950 dark:text-rose-100">
                        Critical NEWS2 Acuity Alert Active ({criticalNEWS2Beds.length} High-Risk Patient{criticalNEWS2Beds.length > 1 ? 's' : ''} with NEWS2 ≥ 5)
                      </h3>
                      <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold text-white animate-pulse">
                        PULSING BEDS
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-rose-800 dark:text-rose-300">
                      Immediate clinical escalation and vitals review required for:{' '}
                      <span className="font-semibold">
                        {criticalNEWS2Beds.map((b) => `Bed ${b.bedNumber} (${b.patientName || 'Patient'}, NEWS2: ${getBedNEWS2(b).score})`).join(' • ')}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setFilterCriticalOnly(!filterCriticalOnly)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer shadow-xs ${
                      filterCriticalOnly
                        ? 'bg-rose-800 text-white hover:bg-rose-900'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                    }`}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    <span>{filterCriticalOnly ? 'Show All Hospital Beds' : `Filter ${criticalNEWS2Beds.length} Critical Bed${criticalNEWS2Beds.length > 1 ? 's' : ''}`}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Success / Error Notification Banners */}
          {successMsg && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 dark:text-emerald-400" />
                <span>{successMsg}</span>
              </div>
              <button onClick={() => setSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 dark:text-rose-400" />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)} className="text-rose-700 hover:text-rose-900 dark:text-rose-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* 6 Key Operational KPI Cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {/* Total Beds */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Capacity</span>
                <BedDouble className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Beds</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">Hospital Census</div>
            </div>

            {/* Occupancy Rate & Occupied */}
            <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-xs dark:border-rose-900/60 dark:bg-rose-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-rose-800 dark:text-rose-300">Occupied Beds</span>
                <Activity className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-rose-900 dark:text-rose-200">{stats.occupied}</span>
                <span className="text-xs font-bold text-rose-700 dark:text-rose-300">{stats.occupancyRate}% Full</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rose-200 dark:bg-rose-950">
                <div
                  className="h-full bg-rose-600 transition-all duration-500 dark:bg-rose-500"
                  style={{ width: `${stats.occupancyRate}%` }}
                />
              </div>
            </div>

            {/* Available Beds */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Available Ready</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">{stats.available}</span>
                <span className="text-xs text-emerald-700 dark:text-emerald-300">Immediate Admit</span>
              </div>
              <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Sanitized & Linens Prepped</div>
            </div>

            {/* Cleaning / Housekeeping */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-xs dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Housekeeping (EVS)</span>
                <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-amber-900 dark:text-amber-200">{stats.cleaning}</span>
                <span className="text-xs text-amber-700 dark:text-amber-300">Turnaround</span>
              </div>
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">UV-C & Disinfection Active</div>
            </div>

            {/* Reserved / Surgical PACU */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-xs dark:border-blue-900/60 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">OR/PACU Reserved</span>
                <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-blue-900 dark:text-blue-200">{stats.reserved}</span>
                <span className="text-xs text-blue-700 dark:text-blue-300">Pending Post-Op</span>
              </div>
              <div className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">Reserved for Surgical Transfer</div>
            </div>

            {/* Maintenance / Hold */}
            <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-xs dark:border-slate-800 dark:bg-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Maintenance</span>
                <Wrench className="h-4 w-4 text-slate-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-800 dark:text-slate-200">{stats.maintenance}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Hold</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Bio-Med Engineering</div>
            </div>
          </div>

          {/* Hospital-Wide Daily Census & Intake Velocity Trend Line Chart (7 Days) */}
          <div className="mt-6">
            <HospitalCensusTrendChart
              tenantId={tenantId}
              totalCapacity={stats.total || 140}
              currentOccupied={stats.occupied || 112}
            />
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        {/* MRN Quick Lookup Search Bar Across All Wards */}
        <MRNQuickLookup
          beds={beds}
          wards={wards}
          onSelectBed={(bed) => {
            setSelectedWardId(bed.wardId);
            setSearchQuery(bed.patientMRN || bed.bedNumber);
            setViewMode('matrix');
          }}
          onQuickSanitize={handleQuickSanitize}
          onDischarge={handleOpenDischarge}
          onTransfer={handleOpenTransfer}
        />

        {/* Controls, Filters & Search Bar */}
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search bed number, patient name, MRN, doctor..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-900"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Ward Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Ward:</span>
              <select
                value={selectedWardId}
                onChange={(e) => setSelectedWardId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">All Hospital Wards ({beds.length})</option>
                {wards.map((w) => {
                  const count = beds.filter((b) => b.wardId === w.id).length;
                  return (
                    <option key={w.id} value={w.id}>
                      {w.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">All Statuses</option>
                <option value="available">🟢 Available ({stats.available})</option>
                <option value="occupied">🔴 Occupied ({stats.occupied})</option>
                <option value="cleaning">🟡 Housekeeping ({stats.cleaning})</option>
                <option value="reserved">🔵 Reserved ({stats.reserved})</option>
                <option value="maintenance">⚪ Maintenance ({stats.maintenance})</option>
              </select>
            </div>

            {/* Class Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Class:</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">All Classes</option>
                <option value="icu">ICU Critical</option>
                <option value="private">Private Deluxe</option>
                <option value="semi_private">Semi-Private</option>
                <option value="general">General Ward</option>
              </select>
            </div>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            <button
              onClick={() => setViewMode('matrix')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'matrix'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Ward Matrix</span>
            </button>

            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Census Table</span>
            </button>

            <button
              onClick={() => setViewMode('transfers')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'transfers'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>Transfer Logs ({transfers.length})</span>
            </button>
          </div>
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="mt-12 flex flex-col items-center justify-center text-slate-500">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <p className="mt-3 text-sm font-medium">Syncing live inpatient telemetry & census...</p>
          </div>
        ) : viewMode === 'matrix' ? (
          /* ========================================================================= */
          /* WARD MATRIX GRID VIEW                                                     */
          /* ========================================================================= */
          <div className="mt-6 space-y-8">
            {bedsByWard.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
                <BedDouble className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
                <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-200">No Beds Match Selected Filters</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Try adjusting your ward, bed class, or status filter criteria.
                </p>
                <button
                  onClick={() => {
                    setSelectedWardId('all');
                    setSelectedStatus('all');
                    setSelectedClass('all');
                    setSearchQuery('');
                  }}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              bedsByWard.map(({ ward, beds: wardBeds }) => {
                const wardOccupied = wardBeds.filter((b) => b.status === 'occupied').length;
                const wardAvailable = wardBeds.filter((b) => b.status === 'available').length;
                const wardCleaning = wardBeds.filter((b) => b.status === 'cleaning').length;
                const wardReserved = wardBeds.filter((b) => b.status === 'reserved').length;
                const wardMaintenance = wardBeds.filter((b) => b.status === 'maintenance').length;
                const wardTotal = wardBeds.length;
                const wardOccRate = wardTotal > 0 ? Math.round((wardOccupied / wardTotal) * 100) : 0;

                return (
                  <div key={ward.id} className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-900">
                    {/* Ward Header */}
                    <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-850">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{ward.name}</h2>
                            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {ward.floor}
                            </span>
                            <span className="rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                              {ward.department || 'Clinical Unit'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            <span>Nurse Station: {ward.nurseStationPhone || 'Ext. 2000'}</span>
                            <span>•</span>
                            <span>Charge Nurse: {ward.headNurse || 'Assigned On Duty'}</span>
                            <span>•</span>
                            <span>Attending: {ward.attendingPhysician || 'Rotating Staff'}</span>
                          </div>
                        </div>

                        {/* 24-Hour Ward Occupancy Trend Chart & Live Census Indicator */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 shrink-0">
                          {/* 24h Recharts Occupancy Sparkline / Area Chart */}
                          <div className="w-full sm:w-64">
                            <WardOccupancyChart
                              wardId={ward.id}
                              wardName={ward.name}
                              currentOccupied={wardOccupied}
                              totalBeds={wardTotal}
                              occupancyRate={wardOccRate}
                            />
                          </div>

                          {/* Total Daily Census Indicator Badge */}
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center justify-end gap-1.5">
                                <span>Census:</span>
                                <span className="font-mono text-blue-700 dark:text-blue-400">{wardOccupied} / {wardTotal}</span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  wardOccRate >= 90
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300'
                                    : wardOccRate >= 75
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                                }`}>
                                  {wardOccRate}% Occ
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="text-emerald-600 font-semibold dark:text-emerald-400">{wardAvailable} Avail</span>
                                <span>•</span>
                                <span className="text-amber-600 font-medium dark:text-amber-400">{wardCleaning} Sanitize</span>
                              </div>
                            </div>
                            <div className="h-11 w-11 shrink-0">
                              <div className={`relative flex h-full w-full items-center justify-center rounded-xl border font-bold text-xs ${
                                wardOccRate >= 90
                                  ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  : wardOccRate >= 75
                                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}>
                                {wardOccRate}%
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Total Daily Census Progress Bar */}
                      <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Ward Capacity Load:</span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white">{wardOccupied} Active Patients</span>
                          <span className="text-slate-400">|</span>
                          <span className="text-slate-600 dark:text-slate-400">
                            Status: <strong className={wardOccRate >= 90 ? 'text-rose-600 font-bold' : wardOccRate >= 75 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
                              {wardOccRate >= 90 ? 'Near Capacity' : wardOccRate >= 75 ? 'High Volume' : 'Nominal Capacity'}
                            </strong>
                          </span>
                        </div>
                        <div className="w-full sm:w-64">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className={`h-full transition-all duration-500 rounded-full ${
                                wardOccRate >= 90
                                  ? 'bg-rose-600'
                                  : wardOccRate >= 75
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-600'
                              }`}
                              style={{ width: `${Math.min(100, wardOccRate)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Beds Grid */}
                    <div className="p-6">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {wardBeds.map((bed) => {
                          const statusInfo = getStatusBadge(bed.status);
                          const classBadge = getClassBadge(bed.class);
                          const news = getBedNEWS2(bed);
                          const newsClasses = getNEWS2BadgeClasses(news.score, news.riskLevel);
                          const isHighNEWS2Acuity = bed.status === 'occupied' && news.score >= 5;

                          return (
                            <div
                              key={bed.id}
                              className={`relative flex flex-col justify-between rounded-xl border p-4 shadow-2xs transition-all hover:shadow-md ${
                                isHighNEWS2Acuity
                                  ? 'border-rose-400 bg-rose-50/30 dark:border-rose-600 dark:bg-rose-950/20 ring-2 ring-rose-500 shadow-md shadow-rose-200/50 dark:shadow-rose-950/50 animate-pulse'
                                  : bed.status === 'occupied'
                                  ? 'border-rose-200 bg-rose-50/15 dark:border-rose-900/40 dark:bg-rose-950/10'
                                  : bed.status === 'available'
                                  ? 'border-emerald-200 bg-emerald-50/15 dark:border-emerald-900/40 dark:bg-emerald-950/10'
                                  : bed.status === 'cleaning'
                                  ? 'border-amber-200 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10'
                                  : bed.status === 'reserved'
                                  ? 'border-blue-200 bg-blue-50/20 dark:border-blue-900/40 dark:bg-blue-950/10'
                                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-850'
                              }`}
                            >
                              {/* NEWS2 >= 5 High Acuity Emergency Alert Pulsing Header */}
                              {isHighNEWS2Acuity && (
                                <div className="mb-2.5 flex items-center justify-between rounded-lg bg-rose-600 px-2.5 py-1 text-white shadow-xs animate-pulse">
                                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide">
                                    <HeartPulse className="h-3.5 w-3.5 animate-bounce" />
                                    <span>NEWS2: {news.score} • IMMEDIATE ATTENTION</span>
                                  </div>
                                  <span className="rounded bg-rose-800/80 px-1.5 py-0.2 text-[9px] font-extrabold uppercase">
                                    {news.riskLevel}
                                  </span>
                                </div>
                              )}

                              {/* Bed Top Header */}
                              <div>
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base font-extrabold text-slate-900 dark:text-white">{bed.bedNumber}</span>
                                    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase ${classBadge}`}>
                                      {bed.class.replace('_', ' ')}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <span
                                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusInfo.bg}`}
                                    >
                                      <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                                      {statusInfo.label}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                  <span>{bed.roomNumber}</span>
                                  {bed.dailyRate && (
                                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">${bed.dailyRate}/day</span>
                                  )}
                                </div>

                                {/* Patient Details & NEWS2 Acuity Badge */}
                                {bed.status === 'occupied' ? (
                                  <div className="mt-3 rounded-lg border border-slate-100 bg-white p-3 shadow-2xs dark:border-slate-700/60 dark:bg-slate-800">
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-sm dark:text-white">
                                          <User className="h-3.5 w-3.5 text-blue-600 shrink-0 dark:text-blue-400" />
                                          <span className="truncate max-w-[130px]">{bed.patientName}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-500 font-mono dark:text-slate-400">
                                          {bed.patientMRN} • {bed.patientAge || 54}y • {bed.patientGender || 'Male'}
                                        </div>
                                      </div>

                                      {/* NEWS2 Score Badge */}
                                      <div className="flex flex-col items-end">
                                        <span
                                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold shadow-2xs ${newsClasses.bg}`}
                                          title={`NEWS2 Score: ${news.score} (${news.riskLevel} Acuity Risk)`}
                                        >
                                          <HeartPulse className="h-3 w-3" />
                                          <span>NEWS2: {news.score}</span>
                                        </span>
                                        <span className="text-[9px] font-semibold text-slate-400 mt-0.5">
                                          {news.riskLevel} Risk
                                        </span>
                                      </div>
                                    </div>

                                    {/* Primary Diagnosis & Clinical Staff */}
                                    <div className="mt-2.5 space-y-1 text-[11px] text-slate-600 border-t border-slate-100 pt-2 dark:border-slate-700 dark:text-slate-300">
                                      <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Doctor:</span>
                                        <span className="font-medium truncate max-w-[130px]">{bed.assignedDoctor || 'Dr. S. Jenkins'}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Nurse:</span>
                                        <span className="font-medium truncate max-w-[130px]">{bed.assignedNurse || 'Nurse Clara O.'}</span>
                                      </div>
                                      {bed.admissionDate && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-slate-400">Admit Date:</span>
                                          <span>{new Date(bed.admissionDate).toLocaleDateString()}</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Feature Badges: Oxygen, Telemetry, Isolation */}
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {bed.oxygenPort && (
                                        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                                          <Wind className="h-3 w-3" /> O2 Port
                                        </span>
                                      )}
                                      {bed.telemetryEnabled && (
                                        <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                                          <Radio className="h-3 w-3" /> Telemetry
                                        </span>
                                      )}
                                      {bed.isolationType && bed.isolationType !== 'none' && (
                                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                                          <ShieldAlert className="h-3 w-3" /> {bed.isolationType.toUpperCase()}
                                        </span>
                                      )}
                                    </div>

                                    {bed.notes && (
                                      <p className="mt-2 text-[11px] text-slate-500 line-clamp-2 italic bg-slate-50 p-1.5 rounded dark:bg-slate-900/60 dark:text-slate-400">
                                        &ldquo;{bed.notes}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                ) : bed.status === 'cleaning' ? (
                                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                      <span>Housekeeping Turnaround</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                                      Terminal sanitation, linens swap & UV-C air filtration cycle in progress.
                                    </p>
                                  </div>
                                ) : bed.status === 'reserved' ? (
                                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                      <span>OR / PACU Post-Op Hold</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-blue-700 dark:text-blue-400">
                                      Bed reserved for surgical step-down admission following PACU recovery.
                                    </p>
                                  </div>
                                ) : bed.status === 'maintenance' ? (
                                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <Wrench className="h-4 w-4 text-slate-500" />
                                      <span>Engineering Hold</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                      Bio-Medical equipment inspection & electrical calibration required.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                      <span>Ready for Admission</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                                      Sanitized, made with sterile linens, oxygen and telemetry tested.
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Bed Actions Footer Bar */}
                              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                                {bed.status === 'available' ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleOpenAdmit(bed)}
                                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                                    >
                                      <UserPlus className="h-3.5 w-3.5" />
                                      <span>Admit Patient</span>
                                    </button>
                                    <button
                                      onClick={() => handleToggleMaintenance(bed)}
                                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800"
                                      title="Mark for Maintenance"
                                    >
                                      <Wrench className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : bed.status === 'occupied' ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      onClick={() => handleOpenTransfer(bed)}
                                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                    >
                                      <ArrowRightLeft className="h-3.5 w-3.5 text-purple-600" />
                                      <span>Transfer</span>
                                    </button>

                                    <button
                                      onClick={() => handleOpenDischarge(bed)}
                                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 shadow-2xs hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                    >
                                      <LogOut className="h-3.5 w-3.5 text-rose-600" />
                                      <span>Discharge</span>
                                    </button>
                                  </div>
                                ) : bed.status === 'cleaning' ? (
                                  <button
                                    onClick={() => handleMarkCleaned(bed)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    <span>Certify Sanitization Complete</span>
                                  </button>
                                ) : bed.status === 'maintenance' ? (
                                  <button
                                    onClick={() => handleToggleMaintenance(bed)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>Clear Engineering Hold</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleOpenAdmit(bed)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                                  >
                                    <UserPlus className="h-3.5 w-3.5" />
                                    <span>Admit Surgical Transfer</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : viewMode === 'table' ? (
          /* ========================================================================= */
          /* CENSUS TABLE VIEW                                                         */
          /* ========================================================================= */
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider dark:border-slate-800 dark:bg-slate-850 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3.5">Bed Number</th>
                    <th className="px-4 py-3.5">Ward & Room</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Patient Details</th>
                    <th className="px-4 py-3.5">NEWS2 Acuity</th>
                    <th className="px-4 py-3.5">Attending Staff</th>
                    <th className="px-4 py-3.5">Equipment / Notes</th>
                    <th className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800 dark:text-slate-300">
                  {filteredBeds.map((b) => {
                    const statusInfo = getStatusBadge(b.status);
                    const news = getBedNEWS2(b);
                    const newsClasses = getNEWS2BadgeClasses(news.score, news.riskLevel);

                    const isCriticalNEWS2 = b.status === 'occupied' && news.score >= 5;

                    return (
                      <tr
                        key={b.id}
                        className={`transition-colors ${
                          isCriticalNEWS2
                            ? 'bg-rose-50/70 dark:bg-rose-950/40 ring-1 ring-inset ring-rose-400 font-medium'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-850'
                        }`}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                          <div className="flex items-center gap-1.5">
                            {isCriticalNEWS2 && <HeartPulse className="h-3.5 w-3.5 text-rose-600 animate-pulse shrink-0" />}
                            <span>{b.bedNumber}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{b.wardName}</div>
                          <div className="text-[11px] text-slate-400">{b.roomNumber}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusInfo.bg}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {b.patientName ? (
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white">{b.patientName}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{b.patientMRN}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No patient assigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {b.status === 'occupied' ? (
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${newsClasses.bg}`}>
                              <HeartPulse className="h-3 w-3" />
                              <span>NEWS2: {news.score} ({news.riskLevel})</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px]">
                          <div>{b.assignedDoctor || '—'}</div>
                          <div className="text-slate-400">{b.assignedNurse || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-slate-500 max-w-xs truncate">
                          {b.notes || (b.oxygenPort ? 'O2 Port Available' : 'Standard Ward Bed')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {b.status === 'available' ? (
                            <button
                              onClick={() => handleOpenAdmit(b)}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              Admit
                            </button>
                          ) : b.status === 'occupied' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenTransfer(b)}
                                className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                              >
                                Transfer
                              </button>
                              <button
                                onClick={() => handleOpenDischarge(b)}
                                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                              >
                                Discharge
                              </button>
                            </div>
                          ) : b.status === 'cleaning' ? (
                            <button
                              onClick={() => handleMarkCleaned(b)}
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                              Certify Clean
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleMaintenance(b)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                            >
                              Toggle Status
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* TRANSFER LOGS VIEW                                                        */
          /* ========================================================================= */
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Inpatient Bed Transfer Audit Trail</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete historical ledger of inter-ward patient movements and clinical handovers.
            </p>

            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {transfers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No patient transfers recorded in current hospital shift.
                </div>
              ) : (
                transfers.map((t) => (
                  <div key={t.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                        <span>{t.patientName}</span>
                        <span className="font-mono text-slate-500 font-normal">({t.patientMRN})</span>
                        <span className="rounded bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 text-[10px] dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300">
                          {t.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-slate-500 mt-1 flex items-center gap-2 dark:text-slate-400">
                        <span>From: <strong>{t.sourceWardName} ({t.sourceBedNumber})</strong></span>
                        <ArrowRightLeft className="h-3 w-3 text-purple-600" />
                        <span>To: <strong>{t.targetWardName} ({t.targetBedNumber})</strong></span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Reason: {t.reason} | Indication: {t.clinicalIndication || 'Standard transfer'}
                      </div>
                    </div>

                    <div className="text-right text-[11px] text-slate-400 shrink-0">
                      <div>Requested By: <span className="font-semibold text-slate-700 dark:text-slate-300">{t.requestedBy}</span></div>
                      <div>{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: ADMIT PATIENT WITH INTEGRATED NEWS2 ACUITY CALCULATOR             */}
      {/* ========================================================================= */}
      {admitModalOpen && selectedBed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  <UserPlus className="h-4 w-4" />
                  <span>Inpatient Admission & Acuity Triage</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                  Admit to Bed {selectedBed.bedNumber} ({selectedBed.wardName})
                </h3>
              </div>
              <button
                onClick={() => setAdmitModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteAdmission} className="mt-5 space-y-6">
              {/* 1. Patient Demographics & Identification */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. Patient Demographics & Registration
                </h4>
                <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Existing Patient ID *</label>
                    <input
                      type="text"
                      required
                      value={admitForm.patientId}
                      onChange={(e) =>
                        setAdmitForm({ ...admitForm, patientId: e.target.value })
                      }
                      placeholder="pat_..."
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Patient Full Name *</label>
                    <input
                      type="text"
                      required
                      value={admitForm.patientName}
                      onChange={(e) => setAdmitForm({ ...admitForm, patientName: e.target.value })}
                      placeholder="e.g. Eleanor Vance"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">MRN *</label>
                    <input
                      type="text"
                      required
                      value={admitForm.patientMRN}
                      onChange={(e) => setAdmitForm({ ...admitForm, patientMRN: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Age</label>
                    <input
                      type="number"
                      value={admitForm.patientAge}
                      onChange={(e) => setAdmitForm({ ...admitForm, patientAge: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Gender</label>
                    <select
                      value={admitForm.patientGender}
                      onChange={(e) => setAdmitForm({ ...admitForm, patientGender: e.target.value as any })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Isolation Precaution</label>
                    <select
                      value={admitForm.isolationType}
                      onChange={(e) => setAdmitForm({ ...admitForm, isolationType: e.target.value as IsolationType })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="none">None (Standard)</option>
                      <option value="contact">Contact Precautions</option>
                      <option value="droplet">Droplet Precautions</option>
                      <option value="airborne">Airborne Isolation (Negative Pressure)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 2. Interactive NEWS2 Clinical Acuity Calculator */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                <div className="flex items-center justify-between border-b border-blue-100 pb-2 dark:border-blue-900/40">
                  <div className="flex items-center gap-2">
                    <HeartPulse className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-bold text-blue-900 uppercase tracking-wider dark:text-blue-300">
                      2. Pre-Admission NEWS2 Preview (not authoritative until recorded in chart)
                    </span>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold shadow-2xs ${getNEWS2BadgeClasses(calculatedAdmissionNEWS2.score, calculatedAdmissionNEWS2.riskLevel).bg}`}>
                    <span>Score: {calculatedAdmissionNEWS2.score}</span>
                    <span>•</span>
                    <span>{calculatedAdmissionNEWS2.riskLevel} Risk</span>
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Respiration Rate (/min)</label>
                    <input
                      type="number"
                      value={admissionVitals.respirationRate}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, respirationRate: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-[10px] text-slate-500">Sub-score: {calculatedAdmissionNEWS2.parameterScores.respirationRate}</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">SpO2 (%)</label>
                    <input
                      type="number"
                      value={admissionVitals.spO2}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, spO2: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-[10px] text-slate-500">Sub-score: {calculatedAdmissionNEWS2.parameterScores.spO2}</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Supplemental O2</label>
                    <select
                      value={admissionVitals.onSupplementalOxygen ? 'yes' : 'no'}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, onSupplementalOxygen: e.target.value === 'yes' })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="no">Room Air (Score 0)</option>
                      <option value="yes">Oxygen Support (Score 2)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">SpO2 Target Scale</label>
                    <select
                      value={admissionVitals.spO2Scale}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, spO2Scale: Number(e.target.value) as 1 | 2 })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value={1}>Scale 1 (Normal ≥96%)</option>
                      <option value={2}>Scale 2 (COPD 88-92%)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Systolic BP (mmHg)</label>
                    <input
                      type="number"
                      value={admissionVitals.systolicBP}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, systolicBP: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-[10px] text-slate-500">Sub-score: {calculatedAdmissionNEWS2.parameterScores.systolicBP}</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Heart Rate (bpm)</label>
                    <input
                      type="number"
                      value={admissionVitals.heartRate}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, heartRate: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-[10px] text-slate-500">Sub-score: {calculatedAdmissionNEWS2.parameterScores.heartRate}</span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Consciousness (CVPU)</label>
                    <select
                      value={admissionVitals.consciousness}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, consciousness: e.target.value as any })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="Alert">Alert (Score 0)</option>
                      <option value="Voice">Voice / Responds (Score 3)</option>
                      <option value="Pain">Pain Stimulus (Score 3)</option>
                      <option value="Unresponsive">Unresponsive (Score 3)</option>
                      <option value="NewConfusion">New Confusion (Score 3)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">Temperature (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={admissionVitals.temperature}
                      onChange={(e) => setAdmissionVitals({ ...admissionVitals, temperature: Number(e.target.value) })}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-[10px] text-slate-500">Sub-score: {calculatedAdmissionNEWS2.parameterScores.temperature}</span>
                  </div>
                </div>

                {/* Clinical Response Guideline recommendation */}
                <div className="mt-3 rounded bg-white p-2.5 text-[11px] text-slate-700 border border-blue-100 dark:bg-slate-800 dark:border-blue-900/50 dark:text-slate-300">
                  <div className="font-semibold text-blue-900 dark:text-blue-300">Clinical Triage Recommendation:</div>
                  <div>{calculatedAdmissionNEWS2.clinicalResponse}</div>
                  {calculatedAdmissionNEWS2.hasRedTrigger && (
                    <div className="mt-1 font-bold text-rose-700 dark:text-rose-400">
                      ⚠️ Red Trigger Alert in: {calculatedAdmissionNEWS2.redTriggerParameters.join(', ')}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Clinical Assignment & Staff */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  3. Clinical Assignment & Care Plan
                </h4>
                <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Primary Diagnosis</label>
                    <input
                      type="text"
                      value={admitForm.primaryDiagnosis}
                      onChange={(e) => setAdmitForm({ ...admitForm, primaryDiagnosis: e.target.value })}
                      placeholder="e.g. Sepsis secondary to Pyelonephritis"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Attending Physician</label>
                    <input
                      type="text"
                      value={admitForm.assignedDoctor}
                      onChange={(e) => setAdmitForm({ ...admitForm, assignedDoctor: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Assigned Nurse</label>
                    <input
                      type="text"
                      value={admitForm.assignedNurse}
                      onChange={(e) => setAdmitForm({ ...admitForm, assignedNurse: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Expected Discharge Date</label>
                    <input
                      type="date"
                      value={admitForm.expectedDischargeDate}
                      onChange={(e) => setAdmitForm({ ...admitForm, expectedDischargeDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdmitModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{isSubmitting ? 'Admitting...' : 'Confirm Patient Admission'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TRANSFER BED                                                       */}
      {/* ========================================================================= */}
      {transferModalOpen && selectedBed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  <ArrowRightLeft className="h-4 w-4" />
                  <span>Atomic Inter-Ward Bed Transfer</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                  Transfer {selectedBed.patientName}
                </h3>
              </div>
              <button
                onClick={() => setTransferModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="mt-4 space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">Current Location:</span> {selectedBed.wardName} — Bed {selectedBed.bedNumber} ({selectedBed.roomNumber})
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Destination Available Bed *</label>
                {availableTargetBeds.length === 0 ? (
                  <p className="mt-1 text-xs text-rose-600 font-semibold">
                    No available ready beds found. Please clear or sanitize an available bed first.
                  </p>
                ) : (
                  <select
                    required
                    value={transferForm.targetBedId}
                    onChange={(e) => setTransferForm({ ...transferForm, targetBedId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {availableTargetBeds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.wardName} — Bed {b.bedNumber} ({b.class.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Transfer Reason</label>
                <input
                  type="text"
                  required
                  value={transferForm.reason}
                  onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Clinical Indication</label>
                <input
                  type="text"
                  value={transferForm.clinicalIndication}
                  onChange={(e) => setTransferForm({ ...transferForm, clinicalIndication: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setTransferModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || availableTargetBeds.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700 disabled:opacity-50"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  <span>{isSubmitting ? 'Transferring...' : 'Execute Bed Transfer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PRE-DISCHARGE VERIFICATION & PATIENT DISCHARGE                    */}
      {/* ========================================================================= */}
      <DischargeConfirmationModal
        isOpen={dischargeModalOpen}
        onClose={() => {
          setDischargeModalOpen(false);
          setSelectedBed(null);
        }}
        bed={selectedBed}
        onConfirmDischarge={handleConfirmDischargeModal}
        isSubmitting={isSubmitting}
      />

      {/* ========================================================================= */}
      {/* DRAWER: OFFLINE OPERATIONS & RESOLUTION STREAM                             */}
      {/* ========================================================================= */}
      <OfflineActivityStreamDrawer
        isOpen={activityStreamOpen}
        onClose={() => setActivityStreamOpen(false)}
        tenantId={tenantId}
        isOnline={isOnline}
        onSyncTriggered={() => triggerSync()}
      />
    </div>
  );
}
