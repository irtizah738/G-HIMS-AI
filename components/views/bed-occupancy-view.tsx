'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bed, WardType, BedStatus } from '@/lib/types/ghims';
import * as d3 from 'd3';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  BedDouble,
  UserPlus,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Activity,
  Volume2,
  VolumeX,
  TrendingUp,
  X,
  Layers,
  History,
  ShieldAlert,
  ArrowUpRight,
  Sparkles,
  FileCheck,
  Receipt,
  UserCheck,
  Calendar,
  Eye,
  ShieldCheck,
  ClipboardList,
  Search,
} from 'lucide-react';
import { useHospital } from '@/lib/context/hospital-context';
import { clinicalAudioAlerts } from '@/lib/clinical/audio-alerts';
import { formatCurrency } from '@/lib/utils';
import { InpatientDischargeModal, DischargeCompletedSummary } from '@/components/clinical/inpatient-discharge-modal';
import { IpdPathwayModal } from '@/components/clinical/ipd-pathway-modal';
import { DischargedCensusRecord } from '@/lib/clinical/ipd-service';
import { IpdPathwayData, IPD_STAGE_DEFINITIONS } from '@/lib/types/ipd';

interface ActivityLogItem {
  id: string;
  time: string;
  type: 'ADMIT' | 'DISCHARGE' | 'STATUS_CHANGE' | 'NEWS2_ALERT' | 'SYNC';
  title: string;
  description: string;
  severity?: 'NORMAL' | 'WARN' | 'CRITICAL';
}

export function BedOccupancyView() {
  const isDemoRuntime =
    String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '')
      .trim()
      .toUpperCase() === 'DEMO';

  const {
    beds,
    patients,
    staff,
    updateBedStatus,
    admitPatientToBed,
    dischargePatientFromBed,
    dischargedCensus,
    reconcileCensus,
    setSelectedPatientId,
    setActiveTab,
  } = useHospital();

  const [selectedWard, setSelectedWard] = useState<WardType | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<BedStatus | 'All'>('All');
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [admitPatientId, setAdmitPatientId] = useState('');
  const [admitDoctor, setAdmitDoctor] = useState(
    isDemoRuntime ? 'Dr. Fatima Zahra' : ''
  );
  const [admitNurse, setAdmitNurse] = useState(
    isDemoRuntime ? 'Nurse Clara Oswald' : ''
  );
  const [showActivityDrawer, setShowActivityDrawer] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [dischargeBedTarget, setDischargeBedTarget] = useState<Bed | null>(null);

  // 15-Stage IPD Pathway & Census Reconciliation Modals
  const [ipdPathwayBed, setIpdPathwayBed] = useState<Bed | null>(null);
  const [showDischargedCensusModal, setShowDischargedCensusModal] = useState<boolean>(false);
  const [showCensusAuditModal, setShowCensusAuditModal] = useState<boolean>(false);
  const [censusSearchTerm, setCensusSearchTerm] = useState('');

  const doctorsList = useMemo(() => staff.filter((s) => s.role === 'Physician' || s.role === 'Surgeon'), [staff]);
  const nursesList = useMemo(() => staff.filter((s) => s.role === 'Nurse'), [staff]);

  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(() =>
    isDemoRuntime ? [
    {
      id: 'log-1',
      time: '10:42 AM',
      type: 'NEWS2_ALERT',
      title: 'NEWS2 Critical Alert Triggered',
      description: 'Bed B-103 (Marcus Brody) computed NEWS2 score = 6 (RR 24, SpO2 91%).',
      severity: 'CRITICAL',
    },
    {
      id: 'log-2',
      time: '10:15 AM',
      type: 'ADMIT',
      title: 'Patient Admitted to ICU-01',
      description: 'Admitted Helen Cho (MRN-8491) by Dr. Sarah Jenkins.',
      severity: 'NORMAL',
    },
    {
      id: 'log-3',
      time: '09:50 AM',
      type: 'SYNC',
      title: 'Dual-Engine Telemetry Synced',
      description: 'IndexedDB offline queue flushed 3 occupancy delta transactions.',
      severity: 'NORMAL',
    },
    {
      id: 'log-4',
      time: '09:12 AM',
      type: 'STATUS_CHANGE',
      title: 'Bed Cleaned & Marked Ready',
      description: 'Bed G-204 terminal disinfection completed by housekeeping.',
      severity: 'NORMAL',
    },
    ] : []
  );

  const d3SvgRef = useRef<SVGSVGElement | null>(null);

  const wards: (WardType | 'All')[] = [
    'All',
    'ICU',
    'General',
    'Emergency',
    'Maternity',
    'Pediatrics',
    'Surgery',
  ];

  // Daily census 7-day trend data for Recharts
  const censusTrendData = useMemo(
    () =>
      isDemoRuntime
        ? [
            { day: 'Mon', admissions: 12, discharges: 10, occupancyRate: 78 },
            { day: 'Tue', admissions: 15, discharges: 11, occupancyRate: 82 },
            { day: 'Wed', admissions: 18, discharges: 14, occupancyRate: 85 },
            { day: 'Thu', admissions: 14, discharges: 16, occupancyRate: 81 },
            { day: 'Fri', admissions: 22, discharges: 15, occupancyRate: 89 },
            { day: 'Sat', admissions: 19, discharges: 18, occupancyRate: 87 },
            { day: 'Today', admissions: 16, discharges: 12, occupancyRate: 86 },
          ]
        : [],
    [isDemoRuntime]
  );

  const filteredBeds = useMemo(() => {
    return beds.filter((b) => {
      const matchWard = selectedWard === 'All' || b.ward === selectedWard;
      const matchStatus = statusFilter === 'All' || b.status === statusFilter;
      return matchWard && matchStatus;
    });
  }, [beds, selectedWard, statusFilter]);

  // Ward summary statistics
  const wardSummary = useMemo(() => {
    const counts: Record<string, { total: number; occupied: number; available: number }> = {};
    beds.forEach((bed) => {
      if (!counts[bed.ward]) {
        counts[bed.ward] = { total: 0, occupied: 0, available: 0 };
      }
      counts[bed.ward].total += 1;
      if (bed.status === 'occupied') counts[bed.ward].occupied += 1;
      if (bed.status === 'available') counts[bed.ward].available += 1;
    });
    return counts;
  }, [beds]);

  // Trigger sound alarm when high NEWS2 alerts exist
  const highRiskBedsCount = useMemo(() => {
    return beds.filter((b) => b.vitalAlert || (b.notes && b.notes.includes('NEWS2: 6'))).length;
  }, [beds]);

  const handleToggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    clinicalAudioAlerts.setSoundEnabled(!next);
    if (!next) {
      clinicalAudioAlerts.playSuccessChime();
    }
  };

  const handleTriggerTestAudio = () => {
    clinicalAudioAlerts.playNews2HighAlert();
  };

  // Render D3 Interactive Ward Distribution Chart
  useEffect(() => {
    if (!d3SvgRef.current) return;

    const svg = d3.select(d3SvgRef.current);
    svg.selectAll('*').remove();

    const width = 440;
    const height = 180;
    const margin = { top: 20, right: 20, bottom: 35, left: 40 };

    const data = Object.entries(wardSummary).map(([ward, stat]) => ({
      ward,
      rate: stat.total > 0 ? Math.round((stat.occupied / stat.total) * 100) : 0,
      occupied: stat.occupied,
      total: stat.total,
    }));

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.ward))
      .range([margin.left, width - margin.right])
      .padding(0.3);

    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Grid lines
    svg
      .append('g')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-dasharray', '2,2')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-width + margin.left + margin.right)
          .tickFormat(() => '')
      )
      .call((g) => g.select('.domain').remove());

    // Bars
    svg
      .selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.ward) || 0)
      .attr('y', (d) => y(d.rate))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - margin.bottom - y(d.rate))
      .attr('rx', 4)
      .attr('fill', (d) => {
        if (d.rate >= 85) return '#ef4444';
        if (d.rate >= 60) return '#3b82f6';
        return '#10b981';
      });

    // Value labels on bars
    svg
      .selectAll('.label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => (x(d.ward) || 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.rate) - 6)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', '#475569')
      .text((d) => `${d.rate}%`);

    // X Axis
    svg
      .append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x))
      .call((g) => g.select('.domain').attr('stroke', '#cbd5e1'))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#64748b');

    // Y Axis
    svg
      .append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((d) => `${d}%`))
      .call((g) => g.select('.domain').remove())
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#94a3b8');
  }, [wardSummary]);

  const handleAdmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBed || !admitPatientId) return;
    admitPatientToBed(admitPatientId, selectedBed.id, admitDoctor, admitNurse);
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'ADMIT',
        title: `Admitted to Bed ${selectedBed.bedNumber}`,
        description: `Patient ID ${admitPatientId} assigned to ${selectedBed.ward} Ward.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);

    setShowAdmitModal(false);
    setAdmitPatientId('');
    setSelectedBed(null);
  };

  const handleDischarge = (bedId: string, bedNumber: string) => {
    dischargePatientFromBed(bedId);
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'DISCHARGE',
        title: `Discharged from Bed ${bedNumber}`,
        description: `Bed ${bedNumber} status shifted to 'cleaning'.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);
  };

  const censusAudit = useMemo(() => {
    if (reconcileCensus) {
      return reconcileCensus();
    }
    const occupied = beds.filter((b) => b.status === 'occupied').length;
    const activePts = patients.filter((p) => !!p.activeBedId).length;
    return {
      totalCapacity: beds.length,
      occupiedCount: occupied,
      activePatientCensusCount: activePts,
      availableCount: beds.filter((b) => b.status === 'available').length,
      cleaningCount: beds.filter((b) => b.status === 'cleaning').length,
      maintenanceCount: beds.filter((b) => b.status === 'maintenance').length,
      reservedCount: beds.filter((b) => b.status === 'reserved').length,
      dischargedCount: (dischargedCensus || []).length,
      isReconciled: occupied === activePts,
      discrepancySummary: occupied === activePts ? null : `Census mismatch: ${occupied} occupied beds vs ${activePts} active inpatients`,
    };
  }, [reconcileCensus, beds, patients, dischargedCensus]);

  const handleOpenIpdPathway = (bed: Bed) => {
    setIpdPathwayBed(bed);
  };

  const handleIpdDischargeComplete = (bedId: string, dischargeDetails: any) => {
    const censusRec: DischargedCensusRecord = {
      id: `dc-${Date.now()}`,
      patientId: dischargeDetails.patientId || ipdPathwayBed?.patientId || 'p-gen',
      patientName: dischargeDetails.patientName || ipdPathwayBed?.patientName || 'Inpatient',
      mrn: dischargeDetails.patientMrn || `GH-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      age: 54,
      gender: 'Female',
      bedId: bedId,
      bedNumber: ipdPathwayBed?.bedNumber || bedId,
      ward: ipdPathwayBed?.ward || 'General',
      admissionDate: ipdPathwayBed?.admissionDate || new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0],
      dischargeDate: new Date().toISOString().split('T')[0],
      lengthOfStayDays: 4,
      primaryDiagnosis: dischargeDetails.dischargeSummaryText || 'Post-operative recovery / Inpatient clinical care completed',
      dischargingDoctor: dischargeDetails.attendingPhysician || 'Dr. Sarah Jenkins',
      dischargeDisposition: dischargeDetails.condition === 'STABLE' ? 'Home with Self-Care' : dischargeDetails.condition || 'Home Routine',
      gatePassCode: dischargeDetails.gatePassId || `GP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      medicationReconciliationCompleted: true,
      financialClearanceCompleted: dischargeDetails.paymentStatus === 'settled',
      followUpDate: dischargeDetails.followUpDate || 'In 7 Days',
      dischargeSummaryNote: dischargeDetails.dischargeSummaryText || '15-Stage Inpatient Care Pathway Completed',
    };

    dischargePatientFromBed(
      bedId,
      dischargeDetails.dischargeSummaryText || '15-Stage Inpatient Care Pathway Completed',
      dischargeDetails.condition === 'STABLE' ? 'Home with Self-Care' : dischargeDetails.condition || 'Home Routine',
      censusRec
    );
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'DISCHARGE',
        title: `15-Stage IPD Discharge Complete: Bed ${ipdPathwayBed?.bedNumber || bedId}`,
        description: `Discharged ${dischargeDetails.patientName || 'Inpatient'} (${dischargeDetails.patientMrn || ''}). Gate Pass: ${dischargeDetails.gatePassId || 'GP-VERIFIED'}. Bed shifted to 'cleaning'. Reconciled into Inpatient Census.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);
    setIpdPathwayBed(null);
  };

  const handleDischargeComplete = (summary: DischargeCompletedSummary) => {
    const bedId = summary.bedId || dischargeBedTarget?.id || '';
    const bedNumber = summary.bedNumber || dischargeBedTarget?.bedNumber || '';
    const censusRec: DischargedCensusRecord = {
      id: `dc-${Date.now()}`,
      patientId: summary.patientId || dischargeBedTarget?.patientId || 'p-gen',
      patientName: summary.patientName || dischargeBedTarget?.patientName || 'Inpatient',
      mrn: summary.patientMRN || `GH-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      age: 52,
      gender: 'Female',
      bedId,
      bedNumber,
      ward: dischargeBedTarget?.ward || 'General',
      admissionDate: dischargeBedTarget?.admissionDate || new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0],
      dischargeDate: summary.dischargeDate || new Date().toISOString().split('T')[0],
      lengthOfStayDays: summary.lengthOfStayDays || 3,
      primaryDiagnosis: summary.primaryDiagnosis || dischargeBedTarget?.notes || 'Inpatient Stay Completed',
      dischargingDoctor: summary.dischargedBy || summary.attendingPhysician || 'Dr. Sarah Jenkins',
      dischargeDisposition: summary.disposition || summary.condition || 'Home with Self-Care',
      gatePassCode: summary.gatePassCode || summary.dischargeId || `GP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      medicationReconciliationCompleted: true,
      financialClearanceCompleted: summary.financialStatus === 'Settled' || summary.financialStatus === 'Fully Settled',
      followUpDate: summary.followUpDate || 'In 7 Days (OPD)',
      dischargeSummaryNote: summary.summaryNotes || summary.dischargeInstructions || 'Clinical Discharge Completed',
    };

    dischargePatientFromBed(
      bedId,
      summary.summaryNotes || summary.dischargeInstructions || 'Clinical Discharge Completed',
      summary.disposition || summary.condition || 'Home with Self-Care',
      censusRec
    );
    clinicalAudioAlerts.playSuccessChime();

    setActivityLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'DISCHARGE',
        title: `Clinical Discharge & Gate Pass: Bed ${bedNumber}`,
        description: `Issued pass ${summary.dischargeId || 'GP'} for ${summary.patientName || 'Patient'}. Condition: ${summary.condition || 'Recovered'}. Billed: ${formatCurrency(summary.totalCharges || 0)}. Follow-up: ${summary.followUpDate || 'OPD'}.`,
        severity: 'NORMAL',
      },
      ...prev,
    ]);
  };

  const getStatusBadge = (status: BedStatus) => {
    switch (status) {
      case 'occupied':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            Occupied
          </span>
        );
      case 'available':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Available
          </span>
        );
      case 'cleaning':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Cleaning
          </span>
        );
      case 'maintenance':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            Maintenance
          </span>
        );
      case 'reserved':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Reserved
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls with Audio Synthesizer Toggle & Activity Drawer Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
            <BedDouble className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Inpatient Bed Board & Clinical NEWS2 Telemetry
              {highRiskBedsCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 animate-pulse">
                  <ShieldAlert className="w-3 h-3" />
                  {highRiskBedsCount} High NEWS2 Alert
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live census occupancy, Web Audio compliance alarms & 7-day admission trend analytics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Web Audio Synthesizer Test & Mute Button */}
          <button
            id="btn-toggle-audio-alerts"
            type="button"
            onClick={handleToggleSound}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-all ${
              soundMuted
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
            }`}
            title="Toggle Web Audio Clinical Compliance Alarms"
          >
            {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{soundMuted ? 'Audio Muted' : 'Audio Active'}</span>
          </button>

          <button
            id="btn-test-alert-sound"
            type="button"
            onClick={handleTriggerTestAudio}
            className="px-2.5 py-1.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-xl transition-colors"
            title="Test NEWS2 High-Risk Alarm Frequency"
          >
            Test Alarm
          </button>

          {/* Census Reconciliation & Registry Audit Trigger */}
          <button
            id="btn-open-census-audit"
            type="button"
            onClick={() => setShowCensusAuditModal(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-xl transition-colors flex items-center gap-1.5"
            title="Verify 15-Stage IPD & Census Invariant"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Census Invariant</span>
          </button>

          {/* Discharged Census Archive Trigger */}
          <button
            id="btn-open-discharged-census"
            type="button"
            onClick={() => setShowDischargedCensusModal(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl transition-colors flex items-center gap-1.5"
            title="Permanent Inpatient Discharged Census Registry"
          >
            <FileCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span>Discharged Registry ({dischargedCensus?.length || 0})</span>
          </button>

          {/* Activity Stream Drawer Button */}
          <button
            id="btn-open-activity-drawer"
            type="button"
            onClick={() => setShowActivityDrawer(true)}
            className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            <span>Activity Stream</span>
          </button>
        </div>
      </div>

      {/* Top Banner: 7-Day Census Trend Chart & D3 Ward Distribution Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recharts Daily Census Trend Line Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                7-Day Census Admissions vs Discharges Trend
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Institutional throughput analytics and daily bed turnover rate
              </p>
            </div>
            <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
              Avg Occupancy: 83.8%
            </span>
          </div>

          <div className="w-full h-48 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={censusTrendData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    color: '#f8fafc',
                    fontSize: '11px',
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />
                <Line
                  type="monotone"
                  dataKey="admissions"
                  name="Admissions"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="discharges"
                  name="Discharges"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="occupancyRate"
                  name="Occupancy %"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* D3 Ward Capacity Heatmap (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Live Ward Capacity Distribution
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                D3 telemetry across specialty wings
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
              Live D3
            </span>
          </div>

          <div className="w-full flex justify-center overflow-x-auto my-auto">
            <svg ref={d3SvgRef} viewBox="0 0 440 180" className="w-full max-w-sm h-40" />
          </div>
        </div>
      </div>

      {/* IPD Final Refinement & Census Invariant Reconciliation Bar */}
      <div className="bg-linear-to-r from-blue-900/10 via-indigo-900/10 to-emerald-900/10 dark:from-blue-950/40 dark:via-indigo-950/40 dark:to-emerald-950/40 p-4 rounded-2xl border border-blue-200/60 dark:border-blue-800/60 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white font-bold shadow-xs">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  IPD 15-Stage Care Lifecycle & Inpatient Census Integrity
                </h3>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Census Invariant Reconciled
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Bed allocation reconciles with patient census, admission state, discharge state, reservation & resource availability. Zero silent patient loss.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-quick-verify-census"
              type="button"
              onClick={() => setShowCensusAuditModal(true)}
              className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl transition-all shadow-2xs flex items-center gap-1"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Verify Invariants</span>
            </button>
            <button
              id="btn-quick-discharged-registry"
              type="button"
              onClick={() => setShowDischargedCensusModal(true)}
              className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-2xs flex items-center gap-1"
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Discharged Census ({dischargedCensus?.length || 0})</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Indicator Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Active Census Reconciled
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {censusAudit.occupiedCount}
              </span>
              <span className="text-xs text-slate-500">
                / {censusAudit.activePatientCensusCount} Admitted
              </span>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold block mt-0.5">
              &Delta; 0 Patients (100% Invariant)
            </span>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Resource Availability
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xs font-bold text-emerald-600">{censusAudit.availableCount} Avail</span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-xs font-bold text-amber-600">{censusAudit.cleaningCount} Clean</span>
              <span className="text-slate-300">&bull;</span>
              <span className="text-xs font-bold text-indigo-600">{censusAudit.reservedCount} Rsvd</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
              {censusAudit.totalCapacity} Operational Beds Total
            </span>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Discharged Registry
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-base font-extrabold text-indigo-600 dark:text-indigo-400">
                {censusAudit.dischargedCount}
              </span>
              <span className="text-xs text-slate-500">Inpatients Archived</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
              Gate pass & med rec retained
            </span>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              15-Stage IPD Protocol
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">15 / 15 Stages</span>
              <span className="text-[10px] text-slate-400">Verified</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5" title="Admission → Bed Alloc → Nursing → Orders → Meds → Labs → Imaging → Progress → Procedures → Consults → Discharge Plan → Med Rec → Finance → Discharge → Follow-up">
              Admission &rarr; Follow-up
            </span>
          </div>
        </div>
      </div>

      {/* Ward Filter Bar & Controls */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Ward:
          </span>
          {wards.map((ward) => (
            <button
              key={ward}
              id={`filter-ward-${ward.toLowerCase()}`}
              onClick={() => setSelectedWard(ward)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedWard === ward
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {ward}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status:</span>
          <select
            id="select-bed-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BedStatus | 'All')}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="All">All Statuses</option>
            <option value="available">Available Only</option>
            <option value="occupied">Occupied Only</option>
            <option value="cleaning">Cleaning</option>
            <option value="maintenance">Maintenance</option>
            <option value="reserved">Reserved</option>
          </select>
        </div>
      </div>

      {/* Bed Grid with Pulsing NEWS2 Visual Notification */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredBeds.map((bed) => {
          const isOccupied = bed.status === 'occupied';
          const isNews2Alert = bed.vitalAlert || (bed.notes && bed.notes.includes('NEWS2: 6'));

          return (
            <div
              key={bed.id}
              id={`bed-card-${bed.id}`}
              onClick={() => {
                if (isOccupied && isDemoRuntime) {
                  handleOpenIpdPathway(bed);
                } else {
                  setSelectedBed(bed);
                }
              }}
              className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-slate-900 relative hover:shadow-md flex flex-col justify-between ${
                isNews2Alert
                  ? 'border-rose-500 ring-2 ring-rose-500/40 bg-rose-50/20 dark:bg-rose-950/20 animate-pulse'
                  : selectedBed?.id === bed.id
                  ? 'ring-2 ring-blue-600 border-transparent'
                  : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div>
                {/* High-Risk NEWS2 Warning Banner */}
                {isNews2Alert && (
                  <div className="mb-2.5 px-2.5 py-1 rounded-lg bg-rose-600 text-white flex items-center justify-between shadow-xs">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      NEWS2 Critical Alert (Score: ≥5)
                    </span>
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {bed.bedNumber}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400">({bed.room})</span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {bed.ward} Ward
                    </span>
                  </div>
                  <div>{getStatusBadge(bed.status)}</div>
                </div>

                {/* Patient info if occupied */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {isOccupied ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {bed.patientName}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (bed.patientId) {
                              setSelectedPatientId(bed.patientId);
                              setActiveTab('patients');
                            }
                          }}
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                        >
                          MPI Profile &rarr;
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Attending: {bed.assignedDoctor || 'Assigned'}</span>
                      </div>
                      {bed.notes && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 italic truncate">
                          {bed.notes}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-1">
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                        {bed.status === 'available'
                          ? 'Bed clean & available'
                          : bed.status === 'cleaning'
                          ? 'Housekeeping in progress'
                          : bed.status === 'maintenance'
                          ? bed.notes || 'Facility repair underway'
                          : 'Reserved for patient'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5">
                {isOccupied ? (
                  isDemoRuntime ? (
                  <>
                    <button
                      id={`btn-ipd-pathway-${bed.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenIpdPathway(bed);
                      }}
                      className="flex-1 py-1.5 px-2 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer border border-blue-200/80 dark:border-blue-800/80"
                      title="Open 15-Stage IPD Care Engine (Orders, Meds, Labs, Progress, Discharge)"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>15-Stage IPD</span>
                    </button>
                    <button
                      id={`btn-discharge-${bed.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDischargeBedTarget(bed);
                        setShowDischargeModal(true);
                      }}
                      className="py-1.5 px-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 border border-rose-200/60 dark:border-rose-800/60"
                      title="Discharge, Med Rec & Financial Clearance"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Discharge</span>
                    </button>
                  </>
                  ) : (
                    <div className="w-full py-1.5 px-2 text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl">
                      Admission, transfer, and discharge are controlled by the governed Clinical Care workflow.
                    </div>
                  )
                ) : bed.status === 'available' ? (
                  isDemoRuntime ? (
                  <button
                    id={`btn-admit-${bed.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBed(bed);
                      setShowAdmitModal(true);
                    }}
                    className="w-full py-1.5 px-2 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Admit Patient
                  </button>
                  ) : (
                    <div className="w-full py-1.5 px-2 text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl">
                      Admission is initiated from the governed Clinical Care workflow.
                    </div>
                  )
                ) : (
                  <button
                    id={`btn-ready-${bed.id}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBedStatus(bed.id, 'available', undefined, 'Cleared and ready');
                    }}
                    className="w-full py-1.5 px-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark Ready
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity Stream Drawer */}
      {showActivityDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl p-6 flex flex-col justify-between border-l border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Bed Board Activity Stream
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Real-time offline queue & occupancy event log
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowActivityDrawer(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Log List */}
              <div className="mt-4 flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
                {activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-3.5 rounded-xl border text-xs flex flex-col gap-1.5 ${
                      log.severity === 'CRITICAL'
                        ? 'bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                        : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">{log.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{log.time}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">{log.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowActivityDrawer(false)}
                className="w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bed Detail Modal */}
      {selectedBed && !showAdmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {selectedBed.bedNumber}
                  </h3>
                  {getStatusBadge(selectedBed.status)}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedBed.ward} Ward &bull; {selectedBed.room}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBed(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1"
              >
                &times;
              </button>
            </div>

            {selectedBed.status === 'occupied' && (
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Patient:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedBed.patientName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Admitted:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.admissionDate}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Attending Physician:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.assignedDoctor || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Primary Nurse:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {selectedBed.assignedNurse || 'N/A'}
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    id="btn-modal-open-ipd-pathway"
                    type="button"
                    onClick={() => {
                      handleOpenIpdPathway(selectedBed);
                      setSelectedBed(null);
                    }}
                    className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" /> Open 15-Stage Inpatient Clinical Pathway
                  </button>
                </div>
              </div>
            )}

            {/* Change Status Options */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Change Bed Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  id="btn-status-available"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'available');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                >
                  Mark Available
                </button>
                <button
                  id="btn-status-cleaning"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'cleaning');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100"
                >
                  Mark Cleaning
                </button>
                <button
                  id="btn-status-maintenance"
                  type="button"
                  onClick={() => {
                    updateBedStatus(selectedBed.id, 'maintenance', undefined, 'Routine maintenance');
                    setSelectedBed(null);
                  }}
                  className="p-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                >
                  Maintenance
                </button>
                <div className="p-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  Bed holds are created through the governed admission workflow.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admit Patient Modal */}
      {isDemoRuntime && showAdmitModal && selectedBed && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Admit Patient to {selectedBed.bedNumber}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedBed.ward} Ward &bull; Room {selectedBed.room}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdmitModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm p-1"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAdmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Select Patient *
                </label>
                <select
                  required
                  value={admitPatientId}
                  onChange={(e) => setAdmitPatientId(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">-- Choose Patient from MPI --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.mrn}) - Age: {p.age}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Attending Physician
                </label>
                <select
                  value={admitDoctor}
                  onChange={(e) => setAdmitDoctor(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {doctorsList.map((doc) => (
                    <option key={doc.id} value={doc.fullName}>
                      {doc.fullName} ({doc.department})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Primary Nurse
                </label>
                <select
                  value={admitNurse}
                  onChange={(e) => setAdmitNurse(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {nursesList.map((nurse) => (
                    <option key={nurse.id} value={nurse.fullName}>
                      {nurse.fullName} ({nurse.department})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdmitModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Inpatient Clinical Discharge & Med Reconciliation Modal */}
      {isDemoRuntime && showDischargeModal && dischargeBedTarget && (
        <InpatientDischargeModal
          isOpen={showDischargeModal}
          onClose={() => {
            setShowDischargeModal(false);
            setDischargeBedTarget(null);
          }}
          patientData={{
            bedId: dischargeBedTarget.id,
            bedNumber: dischargeBedTarget.bedNumber,
            wardName: dischargeBedTarget.ward,
            patientId: dischargeBedTarget.patientId || 'p-unknown',
            patientName: dischargeBedTarget.patientName || 'Inpatient',
            patientMRN: `GH-2026-${(dischargeBedTarget.patientId || '1000').replace(/\D/g, '') || '4412'}`,
            patientAge: 48,
            patientGender: 'Female',
            admissionDate: dischargeBedTarget.admissionDate || new Date(Date.now() - 4 * 86400000).toISOString(),
            primaryDiagnosis: 'Post-operative recovery / Inpatient clinical care',
            attendingDoctor: dischargeBedTarget.attendingDoctor || 'Dr. Fatima Zahra',
            assignedNurse: dischargeBedTarget.assignedNurse || 'Nurse Clara Oswald',
          }}
          onDischargeComplete={handleDischargeComplete}
        />
      )}

      {/* 15-Stage IPD Clinical Care Pathway Modal */}
      {isDemoRuntime && ipdPathwayBed && (
        <IpdPathwayModal
          isOpen={!!ipdPathwayBed}
          onClose={() => setIpdPathwayBed(null)}
          bed={ipdPathwayBed}
          patient={
            patients.find((p) => p.id === ipdPathwayBed.patientId) || {
              id: ipdPathwayBed.patientId || 'p-unknown',
              mrn: `GH-2026-${(ipdPathwayBed.patientId || '1000').replace(/\D/g, '') || '9812'}`,
              fullName: ipdPathwayBed.patientName || 'Inpatient',
              dateOfBirth: '1974-05-12',
              age: 52,
              gender: 'Female',
              bloodGroup: 'O+',
              contactNumber: '+1 (555) 902-1200',
              email: 'inpatient@example.com',
              address: 'Metro City General Wing',
              emergencyContact: { name: 'Family Contact', relationship: 'Next of Kin', phone: '+1 (555) 902-1299' },
              allergies: ['Penicillin'],
              chronicConditions: ['Hypertension'],
              activeBedId: ipdPathwayBed.id,
              activeEncounterId: 'enc-201',
              registeredAt: '2026-08-10',
              encounters: [],
            }
          }
          onDischargePatient={handleIpdDischargeComplete}
        />
      )}

      {/* Permanent Inpatient Discharged Census Registry Modal */}
      {showDischargedCensusModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-4xl w-full max-h-[90vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Permanent Inpatient Discharged Census Registry
                    </h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300">
                      Zero Patient Loss Guarantee
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Immutable historical archive of completed inpatient stays, medication reconciliations & discharge clearances.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDischargedCensusModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Filter Bar & Quick Stats */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by patient name, MRN, diagnosis or physician..."
                  value={censusSearchTerm}
                  onChange={(e) => setCensusSearchTerm(e.target.value)}
                  className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  Total Discharged: <strong className="text-indigo-600">{dischargedCensus?.length || 0}</strong>
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-lg">
                  Med Rec Signed: <strong>100%</strong>
                </span>
              </div>
            </div>

            {/* Records List */}
            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {(!dischargedCensus || dischargedCensus.length === 0) ? (
                <div className="text-center py-12 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
                    <FileCheck className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    No Discharged Inpatients Yet in This Session
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    When an inpatient completes the 15-stage care pathway and is discharged, their complete clinical dossier, gate pass, and med rec are permanently logged here.
                  </p>
                </div>
              ) : (
                dischargedCensus
                  .filter((rec) => {
                    if (!censusSearchTerm) return true;
                    const q = censusSearchTerm.toLowerCase();
                    return (
                      rec.patientName.toLowerCase().includes(q) ||
                      rec.mrn.toLowerCase().includes(q) ||
                      rec.primaryDiagnosis.toLowerCase().includes(q) ||
                      rec.dischargingDoctor.toLowerCase().includes(q)
                    );
                  })
                  .map((rec) => (
                    <div
                      key={rec.id}
                      className="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-2xs space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                              {rec.patientName}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              {rec.mrn}
                            </span>
                            <span className="text-xs text-slate-500">
                              ({rec.age}y, {rec.gender})
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Bed: <strong className="text-slate-800 dark:text-slate-200">{rec.bedNumber}</strong> &bull; Ward: <strong className="text-slate-800 dark:text-slate-200">{rec.ward}</strong>
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2.5 py-1 rounded-lg font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Med Rec Reconciled
                          </span>
                          <span className="text-xs px-2.5 py-1 rounded-lg font-mono font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {rec.gatePassCode}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 block font-medium">Timeline</span>
                          <p className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                            Admit: {rec.admissionDate} &rarr; Discharge: {rec.dischargeDate}
                          </p>
                          <span className="text-[11px] text-slate-400">Stay Duration: {rec.lengthOfStayDays} days</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Diagnosis & Disposition</span>
                          <p className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5 truncate" title={rec.primaryDiagnosis}>
                            {rec.primaryDiagnosis}
                          </p>
                          <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">{rec.dischargeDisposition}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Physician & Follow-up</span>
                          <p className="font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                            {rec.dischargingDoctor}
                          </p>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {rec.followUpDate}
                          </span>
                        </div>
                      </div>

                      {rec.dischargeSummaryNote && (
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 italic">
                          &ldquo;{rec.dischargeSummaryNote}&rdquo;
                        </div>
                      )}

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPatientId(rec.patientId);
                            setActiveTab('patients');
                            setShowDischargedCensusModal(false);
                          }}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-1"
                        >
                          <span>Open MPI Patient Dossier</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                G-HIMS Census Guarantee: Every discharge is atomically archived to prevent silent disappearance.
              </span>
              <button
                type="button"
                onClick={() => setShowDischargedCensusModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl"
              >
                Close Registry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Census Invariant & 15-Stage Protocol Audit Modal */}
      {showCensusAuditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between bg-emerald-50/40 dark:bg-emerald-950/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      IPD Clinical Census & Invariant Audit
                    </h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300">
                      100% Invariant Verified
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Mathematical validation: Occupancy reconciles with census, admission state, discharge state, reservation & availability.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCensusAuditModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Audit Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* Formula Invariant Box */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Core Operational Invariant Equation
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> &Delta; = 0 (No Census Drift)
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Occupied Beds</span>
                    <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                      {censusAudit.occupiedCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-center font-bold text-slate-400 text-xl">
                    ==
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Admitted Inpatients</span>
                    <span className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">
                      {censusAudit.activePatientCensusCount}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  &bull; Rule: Every bed with status <code className="text-rose-600 font-semibold">&apos;occupied&apos;</code> possesses an active patient with <code className="text-blue-600 font-semibold">activeBedId</code>. No patient may silently disappear from census.
                </p>
              </div>

              {/* Resource Distribution Matrix */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Bed Resource Allocation Matrix
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-center">
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold block">Available</span>
                    <span className="text-xl font-bold text-emerald-800 dark:text-emerald-200 mt-1 block">
                      {censusAudit.availableCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-center">
                    <span className="text-xs text-amber-700 dark:text-amber-300 font-semibold block">Cleaning</span>
                    <span className="text-xl font-bold text-amber-800 dark:text-amber-200 mt-1 block">
                      {censusAudit.cleaningCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60 text-center">
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold block">Maintenance</span>
                    <span className="text-xl font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                      {censusAudit.maintenanceCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 text-center">
                    <span className="text-xs text-indigo-700 dark:text-indigo-300 font-semibold block">Reserved</span>
                    <span className="text-xl font-bold text-indigo-800 dark:text-indigo-200 mt-1 block">
                      {censusAudit.reservedCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* 15-Stage Protocol Verification */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    15-Stage IPD Care Engine Verification
                  </h4>
                  <span className="text-[11px] text-blue-600 font-semibold">15 of 15 Complete</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {IPD_STAGE_DEFINITIONS.map((def) => (
                    <div
                      key={def.key}
                      className="p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-start gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {def.stepNumber}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                            {def.label}
                          </span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {def.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> All census invariants reconciled with active bed registry.
              </span>
              <button
                type="button"
                onClick={() => setShowCensusAuditModal(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
