'use client';

import React, { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Scissors,
  Building2,
  Calendar,
  Clock,
  User,
  ShieldCheck,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Sparkles,
  Plus,
  ArrowRight,
  Boxes,
  Stethoscope,
  HeartPulse,
  Eye,
  Check,
  X,
  Play,
  Flame,
  FileCheck2,
  ShieldAlert,
  Users,
  Award,
  AlertCircle,
  FileText,
  Radio,
} from 'lucide-react';
import { ORCase, ORSuite, SurgicalStage, SurgicalCaseStatus } from '@/types/inpatient-or';

export default function MasterSurgicalCasesPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [searchQuery, setSearchQuery] = useState('');
  const [suiteFilter, setSuiteFilter] = useState<string>('ALL');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [showBookModal, setShowBookModal] = useState(false);

  // STAT_EMERGENCY Acknowledgement Modal State
  const [emergencyModalCase, setEmergencyModalCase] = useState<ORCase | null>(null);
  const [emergencyChecks, setEmergencyChecks] = useState<{
    surgeonScrubbed: boolean;
    anesthesiaReady: boolean;
    nursingSterileCount: boolean;
    bloodBankReady: boolean;
  }>({
    surgeonScrubbed: false,
    anesthesiaReady: false,
    nursingSterileCount: false,
    bloodBankReady: false,
  });
  const [emergencyAcknowledgedBy, setEmergencyAcknowledgedBy] = useState('');
  const [emergencyBadgeId, setEmergencyBadgeId] = useState('');

  // Toast feedback
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'alert' } | null>(null);

  const showToast = (text: string, type: 'success' | 'alert' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Surgical Cases Mock Data with Real State
  const [cases, setCases] = useState<ORCase[]>([
    {
      id: 'case-or-101',
      tenantId,
      caseNumber: 'OR-2026-0891',
      patientId: 'pat-9012',
      patientName: 'Arthur Pendelton',
      patientMRN: 'MRN-778219',
      patientAge: 64,
      patientGender: 'Male',
      procedureName: 'Laparoscopic Cholecystectomy with Cholangiography',
      cptCode: '47563',
      icd10Diagnosis: 'K80.00 (Acute cholecystitis with cholelithiasis)',
      suiteId: 'suite-or-3',
      suiteName: 'OR Suite 3 (Laparoscopic / GI)',
      leadSurgeon: 'Dr. Sarah Jenkins, FACS',
      anesthesiologist: 'Dr. Michael Chang, MD',
      scrubNurse: 'Nurse Clara Oswald, RN',
      circulatingNurse: 'Nurse James Wilson, BSN',
      stage: 'SURGICAL_INCISION',
      scheduledStartTime: '08:30',
      estimatedDurationMinutes: 120,
      actualStartTime: '08:45',
      anesthesiaType: 'GENERAL_ENDOTRACHEAL',
      whoChecklist: {
        signInComplete: true,
        timeOutComplete: true,
        signOutComplete: false,
      },
      cssdTrays: [
        { trayId: 'TRAY-LAP-04', trayName: 'Laparoscopic Major Tray', isSterile: true, barcode: 'CSSD-8821' },
        { trayId: 'TRAY-CHOL-01', trayName: 'Biliary Micro-Vascular Set', isSterile: true, barcode: 'CSSD-9942' },
      ],
      bloodProductsCrossmatched: 2,
      implantRequired: false,
      priority: 'ELECTIVE',
    },
    {
      id: 'case-or-102',
      tenantId,
      caseNumber: 'OR-2026-0892',
      patientId: 'pat-4412',
      patientName: 'Devon Miles',
      patientMRN: 'MRN-441290',
      patientAge: 58,
      patientGender: 'Male',
      procedureName: 'Coronary Artery Bypass Graft (CABG x3)',
      cptCode: '33533',
      icd10Diagnosis: 'I25.10 (Atherosclerotic heart disease of native coronary artery)',
      suiteId: 'suite-or-1',
      suiteName: 'OR Suite 1 (Cardiovascular Hybrid)',
      leadSurgeon: 'Dr. Marcus Vance, MD (Cardiothoracic)',
      anesthesiologist: 'Dr. Priya Nair, MD (Cardiac Anesthesia)',
      scrubNurse: 'Nurse Clara Oswald, RN',
      circulatingNurse: 'Nurse David Kim, RN',
      stage: 'ANESTHESIA_INDUCTION',
      scheduledStartTime: '09:00',
      estimatedDurationMinutes: 240,
      actualStartTime: '09:15',
      anesthesiaType: 'GENERAL_ENDOTRACHEAL',
      whoChecklist: {
        signInComplete: true,
        timeOutComplete: false,
        signOutComplete: false,
      },
      cssdTrays: [
        { trayId: 'TRAY-CABG-01', trayName: 'Open Heart Sternotomy Set', isSterile: true, barcode: 'CSSD-1029' },
      ],
      bloodProductsCrossmatched: 4,
      implantRequired: true,
      priority: 'URGENT',
    },
    {
      id: 'case-or-103',
      tenantId,
      caseNumber: 'OR-2026-0893',
      patientId: 'pat-6631',
      patientName: 'Sophia Rodriguez',
      patientMRN: 'MRN-663190',
      patientAge: 42,
      patientGender: 'Female',
      procedureName: 'Total Knee Arthroplasty (Robotic-Assisted Mako)',
      cptCode: '27447',
      icd10Diagnosis: 'M17.11 (Primary osteoarthritis, right knee)',
      suiteId: 'suite-or-2',
      suiteName: 'OR Suite 2 (Orthopedic & Robotics)',
      leadSurgeon: 'Dr. Gregory House, MD (Orthopedics)',
      anesthesiologist: 'Dr. Michael Chang, MD',
      scrubNurse: 'Nurse Maya Patel, RN',
      circulatingNurse: 'Nurse James Wilson, BSN',
      stage: 'PRE_OP_HOLDING',
      scheduledStartTime: '11:00',
      estimatedDurationMinutes: 150,
      anesthesiaType: 'SPINAL_REGIONAL',
      whoChecklist: {
        signInComplete: false,
        timeOutComplete: false,
        signOutComplete: false,
      },
      cssdTrays: [
        { trayId: 'TRAY-TKA-02', trayName: 'Robotic Arthroplasty Kit', isSterile: true, barcode: 'CSSD-4410' },
      ],
      bloodProductsCrossmatched: 1,
      implantRequired: true,
      priority: 'ELECTIVE',
    },
    {
      id: 'case-or-104',
      tenantId,
      caseNumber: 'OR-2026-0894',
      patientId: 'pat-1102',
      patientName: 'Lucas Vance',
      patientMRN: 'MRN-110284',
      patientAge: 29,
      patientGender: 'Male',
      procedureName: 'Emergency Craniotomy for Subdural Hematoma Evacuation',
      cptCode: '61154',
      icd10Diagnosis: 'S06.5X9A (Traumatic subdural hemorrhage)',
      suiteId: 'suite-or-4',
      suiteName: 'OR Suite 4 (Neuro & Trauma)',
      leadSurgeon: 'Dr. David Rodriguez, MD (Neurosurgery)',
      anesthesiologist: 'Dr. Priya Nair, MD',
      scrubNurse: 'Nurse Maya Patel, RN',
      circulatingNurse: 'Nurse David Kim, RN',
      stage: 'PACU_RECOVERY',
      scheduledStartTime: '06:00',
      estimatedDurationMinutes: 180,
      actualStartTime: '06:15',
      anesthesiaType: 'GENERAL_ENDOTRACHEAL',
      whoChecklist: {
        signInComplete: true,
        timeOutComplete: true,
        signOutComplete: true,
      },
      cssdTrays: [
        { trayId: 'TRAY-CRAN-01', trayName: 'Craniotomy Power Drill Kit', isSterile: true, barcode: 'CSSD-7712' },
      ],
      bloodProductsCrossmatched: 6,
      implantRequired: false,
      priority: 'STAT_EMERGENCY',
    },
  ]);

  // Comprehensive WHO Surgical Safety Checklist Compliance Calculations
  const whoMetrics = useMemo(() => {
    const totalCases = cases.length;
    if (totalCases === 0) {
      return {
        overallPercentage: 0,
        signInCount: 0,
        signInPct: 0,
        timeOutCount: 0,
        timeOutPct: 0,
        signOutCount: 0,
        signOutPct: 0,
        fullyCompliantCases: 0,
        roomStats: [],
      };
    }

    let completedChecklistSteps = 0;
    let totalPossibleSteps = totalCases * 3; // Sign-In, Time-Out, Sign-Out
    let signInCount = 0;
    let timeOutCount = 0;
    let signOutCount = 0;
    let fullyCompliantCases = 0;

    const roomMap: Record<string, { roomName: string; completed: number; total: number }> = {};

    cases.forEach((c) => {
      const si = c.whoChecklist?.signInComplete ? 1 : 0;
      const to = c.whoChecklist?.timeOutComplete ? 1 : 0;
      const so = c.whoChecklist?.signOutComplete ? 1 : 0;

      signInCount += si;
      timeOutCount += to;
      signOutCount += so;
      const caseSteps = si + to + so;
      completedChecklistSteps += caseSteps;

      if (si && to && so) {
        fullyCompliantCases += 1;
      }

      const rName = c.suiteName || c.suiteId || 'OR Room';
      if (!roomMap[rName]) {
        roomMap[rName] = { roomName: rName, completed: 0, total: 0 };
      }
      roomMap[rName].completed += caseSteps;
      roomMap[rName].total += 3;
    });

    const overallPercentage = Math.round((completedChecklistSteps / totalPossibleSteps) * 100);
    const signInPct = Math.round((signInCount / totalCases) * 100);
    const timeOutPct = Math.round((timeOutCount / totalCases) * 100);
    const signOutPct = Math.round((signOutCount / totalCases) * 100);

    const roomStats = Object.values(roomMap);

    return {
      overallPercentage,
      signInCount,
      signInPct,
      timeOutCount,
      timeOutPct,
      signOutCount,
      signOutPct,
      fullyCompliantCases,
      roomStats,
    };
  }, [cases]);

  // KPIs
  const stats = useMemo(() => {
    const total = cases.length;
    const active = cases.filter((c) => c.stage === 'SURGICAL_INCISION' || c.stage === 'ANESTHESIA_INDUCTION' || c.stage === 'intra_op').length;
    const preOp = cases.filter((c) => c.stage === 'PRE_OP_HOLDING' || c.stage === 'pre_op').length;
    const pacu = cases.filter((c) => c.stage === 'PACU_RECOVERY' || c.stage === 'post_op_pacu').length;
    return { total, active, preOp, pacu };
  }, [cases]);

  // Filtered cases
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (suiteFilter !== 'ALL' && c.suiteId !== suiteFilter) return false;
      if (stageFilter !== 'ALL' && c.stage !== stageFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          (c.caseNumber?.toLowerCase() || '').includes(q) ||
          (c.patientName?.toLowerCase() || '').includes(q) ||
          (c.patientMRN?.toLowerCase() || '').includes(q) ||
          (c.procedureName?.toLowerCase() || c.surgicalProcedureName?.toLowerCase() || '').includes(q) ||
          (c.leadSurgeon?.toLowerCase() || c.surgeonName?.toLowerCase() || '').includes(q)
        );
      }
      return true;
    });
  }, [cases, suiteFilter, stageFilter, searchQuery]);

  // Helper to check if a stage is active Intra-Op
  const isIntraOpActive = (stage?: string) => {
    return stage === 'SURGICAL_INCISION' || stage === 'intra_op';
  };

  // Status transition handler with STAT_EMERGENCY check
  const handleStageTransition = (targetCase: ORCase, targetStage: string) => {
    // If attempting to transition a STAT_EMERGENCY case to Intra-Op, require mandatory team acknowledgement
    if (
      targetCase.priority === 'STAT_EMERGENCY' &&
      (targetStage === 'SURGICAL_INCISION' || targetStage === 'intra_op') &&
      !isIntraOpActive(targetCase.stage)
    ) {
      setEmergencyModalCase(targetCase);
      setEmergencyChecks({
        surgeonScrubbed: false,
        anesthesiaReady: false,
        nursingSterileCount: false,
        bloodBankReady: false,
      });
      setEmergencyAcknowledgedBy('');
      setEmergencyBadgeId('');
      return;
    }

    // Direct transition for normal cases or other stages
    applyStageUpdate(targetCase.id, targetStage);
  };

  const applyStageUpdate = (caseId: string, newStage: string) => {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return {
          ...c,
          stage: newStage,
          status: newStage === 'SURGICAL_INCISION' ? 'intra_op' : (newStage.toLowerCase() as SurgicalCaseStatus),
          actualStartTime: c.actualStartTime || (newStage === 'SURGICAL_INCISION' ? now : c.actualStartTime),
        };
      })
    );
    showToast(`Case ${caseId} transitioned to ${newStage.replace(/_/g, ' ')}`);
  };

  // Confirm STAT_EMERGENCY acknowledgement
  const handleConfirmEmergencyAcknowledgement = () => {
    if (!emergencyModalCase) return;
    applyStageUpdate(emergencyModalCase.id, 'SURGICAL_INCISION');
    setEmergencyModalCase(null);
    showToast(
      `STAT EMERGENCY Authorized for ${emergencyModalCase.patientName}. Surgical team verified.`,
      'alert'
    );
  };

  const isEmergencyAuthReady =
    emergencyChecks.surgeonScrubbed &&
    emergencyChecks.anesthesiaReady &&
    emergencyChecks.nursingSterileCount &&
    emergencyChecks.bloodBankReady &&
    emergencyAcknowledgedBy.trim().length >= 3 &&
    emergencyBadgeId.trim().length >= 2;

  const getStageBadge = (stage?: string) => {
    switch (stage) {
      case 'SURGICAL_INCISION':
      case 'intra_op':
        return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800 font-black';
      case 'ANESTHESIA_INDUCTION':
        return 'bg-amber-100 text-amber-800 border-amber-200 font-semibold';
      case 'PRE_OP_HOLDING':
      case 'pre_op':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'PACU_RECOVERY':
      case 'post_op_pacu':
        return 'bg-purple-100 text-purple-800 border-purple-200 font-bold';
      case 'COMPLETED':
      case 'completed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'REVERSAL':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-xs font-bold ${
              toastMsg.type === 'alert'
                ? 'bg-rose-600 text-white border-rose-700 shadow-rose-600/30'
                : 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-600/30'
            }`}
          >
            {toastMsg.type === 'alert' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{toastMsg.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Banner Header */}
      <div className="border-b border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                <Scissors className="h-4 w-4" />
                <span>Operating Room Management & Surgical Ledger</span>
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                  Tenant: {tenantId}
                </span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                Master Operating Theater Surgical Schedule
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Live surgical telemetry, WHO safety checklist synchronization, CSSD sterile tray verification, and PACU transfers.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/${tenantId}/or/schedule`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 shadow-xs"
              >
                <Calendar className="h-4 w-4 text-blue-600" />
                <span>OR Grid Schedule</span>
              </Link>

              <Link
                href={`/${tenantId}/inpatient/bed-board`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 shadow-xs"
              >
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span>Bed Matrix Board</span>
              </Link>
            </div>
          </div>

          {/* DASHBOARD HEADER METRICS: Including WHO Surgical Safety Checklist Compliance Progress Card */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* CARD 1: WHO Surgical Safety Checklist Progress Card */}
            <div className="lg:col-span-2 rounded-2xl border border-purple-200/90 dark:border-purple-900/60 bg-gradient-to-br from-purple-50/70 via-white to-indigo-50/40 dark:from-purple-950/40 dark:via-slate-900 dark:to-indigo-950/20 p-4.5 shadow-xs relative overflow-hidden flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 dark:text-purple-300">
                    <ShieldCheck className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span>WHO Surgical Safety Compliance</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                      {whoMetrics.overallPercentage}%
                    </span>
                    <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-400">
                      Overall Theater Compliance Rate
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
                  {whoMetrics.fullyCompliantCases} / {cases.length} Fully Signed
                </span>
              </div>

              {/* Progress Bar with Phase Segments */}
              <div className="my-3 space-y-1.5">
                <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden flex p-0.5">
                  <div
                    style={{ width: `${whoMetrics.overallPercentage}%` }}
                    className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500 rounded-full transition-all duration-700 shadow-xs"
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    Sign-In: <strong className="text-slate-800 dark:text-slate-200">{whoMetrics.signInPct}%</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                    Time-Out: <strong className="text-slate-800 dark:text-slate-200">{whoMetrics.timeOutPct}%</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
                    Sign-Out: <strong className="text-slate-800 dark:text-slate-200">{whoMetrics.signOutPct}%</strong>
                  </span>
                </div>
              </div>

              {/* Room by Room Mini Matrix */}
              <div className="pt-2 border-t border-purple-100 dark:border-purple-900/40 flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-500">Theater Rooms Active:</span>
                <div className="flex items-center gap-1.5">
                  {cases.map((c, i) => {
                    const steps = (c.whoChecklist?.signInComplete ? 1 : 0) + (c.whoChecklist?.timeOutComplete ? 1 : 0) + (c.whoChecklist?.signOutComplete ? 1 : 0);
                    return (
                      <span
                        key={c.id}
                        title={`${c.suiteName || c.suiteId}: ${steps}/3 WHO items completed`}
                        className={`px-1.5 py-0.5 rounded font-mono font-bold text-[9px] ${
                          steps === 3
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : steps >= 1
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        OR-{i + 1}: {steps}/3
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* CARD 2: Daily Volume */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400 font-medium">Daily Surgical Volume</span>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.total} Cases</div>
              </div>
              <span className="text-[11px] text-slate-400">Master Scheduled Today</span>
            </div>

            {/* CARD 3: Active in Theater */}
            <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 shadow-xs dark:border-rose-900/40 dark:bg-rose-950/20 flex flex-col justify-between">
              <div>
                <span className="text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                  Active in Theater
                </span>
                <div className="text-2xl font-bold text-rose-800 dark:text-rose-200 mt-1">{stats.active} Cases</div>
              </div>
              <span className="text-[11px] text-rose-600 dark:text-rose-400">Incision / Induction Active</span>
            </div>

            {/* CARD 4: PACU Recovery */}
            <div className="rounded-2xl border border-purple-200 bg-purple-50/40 p-4 shadow-xs dark:border-purple-900/40 dark:bg-purple-950/20 flex flex-col justify-between">
              <div>
                <span className="text-xs text-purple-700 dark:text-purple-300 font-semibold">PACU Recovery</span>
                <div className="text-2xl font-bold text-purple-800 dark:text-purple-200 mt-1">{stats.pacu} Patients</div>
              </div>
              <span className="text-[11px] text-purple-600 dark:text-purple-400">Post-Anesthesia Monitoring</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search case #, patient, surgeon, procedure..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl w-full"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Suite:</span>
            <select
              value={suiteFilter}
              onChange={(e) => setSuiteFilter(e.target.value)}
              className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 font-semibold"
            >
              <option value="ALL">All OR Theaters</option>
              <option value="suite-or-1">OR 1 (Cardiovascular)</option>
              <option value="suite-or-2">OR 2 (Orthopedics / Robotics)</option>
              <option value="suite-or-3">OR 3 (GI / Laparoscopy)</option>
              <option value="suite-or-4">OR 4 (Neuro & Trauma)</option>
            </select>

            <span className="text-xs font-semibold text-slate-500 ml-2">Stage:</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="text-xs border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 font-semibold"
            >
              <option value="ALL">All Stages</option>
              <option value="PRE_OP_HOLDING">Pre-Op Holding</option>
              <option value="ANESTHESIA_INDUCTION">Anesthesia Induction</option>
              <option value="SURGICAL_INCISION">Surgical Incision (Intra-Op ACTIVE)</option>
              <option value="PACU_RECOVERY">PACU Recovery</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        </div>

        {/* Surgical Cases Grid */}
        <div className="grid grid-cols-1 gap-4">
          {filteredCases.map((c) => {
            const isIntraOp = isIntraOpActive(c.stage || c.status);
            const isEmergency = c.priority === 'STAT_EMERGENCY';

            return (
              <div
                key={c.id}
                className={`bg-white dark:bg-slate-900 rounded-2xl border p-5 shadow-xs hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-5 relative ${
                  isIntraOp
                    ? 'border-rose-300 dark:border-rose-900 ring-1 ring-rose-300/40 bg-gradient-to-r from-rose-50/30 via-white to-white dark:from-rose-950/20 dark:via-slate-900 dark:to-slate-900'
                    : 'border-slate-200/90 dark:border-slate-800'
                }`}
              >
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded">
                      {c.caseNumber || c.id}
                    </span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {c.suiteName || c.orRoomName || 'OR Suite'}
                    </span>

                    {/* FRAMER-MOTION ANIMATED STATUS BADGE FOR 'Intra-Op ACTIVE' */}
                    {isIntraOp ? (
                      <motion.div
                        animate={{
                          scale: [1, 1.05, 1],
                          boxShadow: [
                            '0 0 0px rgba(225, 29, 72, 0)',
                            '0 0 14px rgba(225, 29, 72, 0.45)',
                            '0 0 0px rgba(225, 29, 72, 0)',
                          ],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide bg-rose-600 text-white shadow-sm border border-rose-500"
                      >
                        <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                        <Activity className="w-3 h-3 text-white animate-pulse" />
                        <span>Intra-Op ACTIVE</span>
                      </motion.div>
                    ) : (
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStageBadge(c.stage || c.status)}`}>
                        {(c.stage || c.status || 'SCHEDULED').replace(/_/g, ' ')}
                      </span>
                    )}

                    {isEmergency && (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white animate-pulse flex items-center gap-1 shadow-xs">
                        <Flame className="w-3 h-3" />
                        <span>STAT EMERGENCY</span>
                      </span>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span>{c.procedureName || c.surgicalProcedureName}</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      CPT: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{c.cptCode || 'CPT-GEN'}</span> &bull; ICD-10: {c.icd10Diagnosis || c.preOpDiagnosis || 'N/A'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400 pt-1">
                    <span className="flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200">
                      <User className="w-3.5 h-3.5 text-blue-600" /> {c.patientName} ({c.patientAge || '—'}y {c.patientGender || ''}) - {c.patientMRN}
                    </span>
                    <span className="flex items-center gap-1">
                      <Stethoscope className="w-3.5 h-3.5 text-purple-600" /> Lead: {c.leadSurgeon || c.surgeonName || 'Assigned Surgeon'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-600" /> Start: {c.actualStartTime || c.scheduledStartTime} ({c.estimatedDurationMinutes}m)
                    </span>
                  </div>
                </div>

                {/* Right Checklist Status, Quick Stage Advance & Console CTA */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-3 md:pt-0 md:pl-5">
                  {/* WHO Checklist 3-Step Pill */}
                  <div className="text-xs space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      WHO Safety Checklist
                    </span>
                    <div className="flex items-center gap-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          c.whoChecklist?.signInComplete ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                        }`}
                      >
                        Sign-In
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          c.whoChecklist?.timeOutComplete ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                        }`}
                      >
                        Time-Out
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          c.whoChecklist?.signOutComplete ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                        }`}
                      >
                        Sign-Out
                      </span>
                    </div>
                  </div>

                  {/* Stage Advance Dropdown or Button */}
                  <div className="flex items-center gap-2">
                    {!isIntraOp && (
                      <button
                        onClick={() => handleStageTransition(c, 'SURGICAL_INCISION')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition active:scale-95 ${
                          isEmergency
                            ? 'bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-400 animate-pulse'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                        }`}
                        title="Move to Intra-Op Active"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{isEmergency ? 'Authorize Intra-Op' : 'Move to Intra-Op'}</span>
                      </button>
                    )}

                    <Link
                      href={`/${tenantId}/or/cases/${c.id}`}
                      className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition active:scale-95 shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Open OR Console</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MANDATORY STAT_EMERGENCY TEAM VERIFICATION & ACKNOWLEDGEMENT MODAL        */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {emergencyModalCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border-2 border-rose-500 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="bg-rose-600 text-white p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white/20 rounded-2xl animate-bounce">
                    <ShieldAlert className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest bg-black/20 px-2 py-0.5 rounded">
                      Mandatory Clinical Protocol
                    </span>
                    <h2 className="text-lg font-black tracking-tight mt-0.5">
                      STAT EMERGENCY Surgical Team Verification
                    </h2>
                  </div>
                </div>
                <button
                  onClick={() => setEmergencyModalCase(null)}
                  className="p-1.5 rounded-xl hover:bg-rose-700 text-white/80 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Case Alert Brief */}
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs">
                  <div className="flex items-center justify-between font-bold text-rose-900 dark:text-rose-200 mb-1">
                    <span className="text-sm">{emergencyModalCase.patientName} ({emergencyModalCase.patientMRN})</span>
                    <span className="font-mono bg-rose-200 dark:bg-rose-900 px-2 py-0.5 rounded text-rose-900 dark:text-rose-100">
                      {emergencyModalCase.caseNumber}
                    </span>
                  </div>
                  <p className="text-rose-800 dark:text-rose-300 font-semibold">
                    Procedure: {emergencyModalCase.procedureName || emergencyModalCase.surgicalProcedureName}
                  </p>
                  <p className="text-rose-600 dark:text-rose-400 mt-1">
                    Diagnosis: {emergencyModalCase.icd10Diagnosis || 'Acute Traumatic Emergency'} &bull; Suite: {emergencyModalCase.suiteName}
                  </p>
                </div>

                {/* Team Assignment Roster */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-purple-600" />
                      Assigned Surgical Emergency Team
                    </span>
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      Roster Deployed
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Lead Surgeon</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{emergencyModalCase.leadSurgeon || 'Dr. David Rodriguez, MD'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Anesthesiologist</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{emergencyModalCase.anesthesiologist || 'Dr. Priya Nair, MD'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Scrub Nurse</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{emergencyModalCase.scrubNurse || 'Nurse Maya Patel, RN'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Circulating Nurse</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{emergencyModalCase.circulatingNurse || 'Nurse David Kim, RN'}</span>
                    </div>
                  </div>
                </div>

                {/* Mandatory Checkbox Verifications */}
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                    Mandatory Pre-Incision Team Verification (All Required):
                  </span>

                  <label className="flex items-start gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={emergencyChecks.surgeonScrubbed}
                      onChange={(e) => setEmergencyChecks({ ...emergencyChecks, surgeonScrubbed: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">Attending Surgeon Present & Scrubbed</span>
                      <p className="text-slate-500 text-[11px]">Surgeon is physically in the theater and sterile drape confirmed.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={emergencyChecks.anesthesiaReady}
                      onChange={(e) => setEmergencyChecks({ ...emergencyChecks, anesthesiaReady: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">Anesthesia Airway & Hemodynamic Stability Confirmed</span>
                      <p className="text-slate-500 text-[11px]">Rapid sequence induction complete; baseline vitals and arterial line secured.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={emergencyChecks.nursingSterileCount}
                      onChange={(e) => setEmergencyChecks({ ...emergencyChecks, nursingSterileCount: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">Sterile Emergency Tray & Count Baseline Initialized</span>
                      <p className="text-slate-500 text-[11px]">CSSD sterile indicator verified; dual initial sponge/sharp count logged.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={emergencyChecks.bloodBankReady}
                      onChange={(e) => setEmergencyChecks({ ...emergencyChecks, bloodBankReady: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                    />
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">Emergency Blood Products & Rapid Infuser on Standby</span>
                      <p className="text-slate-500 text-[11px]">{emergencyModalCase.bloodProductsCrossmatched || 6} PRBC/FFP units confirmed with Blood Bank.</p>
                    </div>
                  </label>
                </div>

                {/* Staff Sign-off Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Authorizing Staff / Team Lead Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. David Rodriguez / Nurse Supervisor"
                      value={emergencyAcknowledgedBy}
                      onChange={(e) => setEmergencyAcknowledgedBy(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Staff Badge / ID Verification
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. OR-SURG-8819"
                      value={emergencyBadgeId}
                      onChange={(e) => setEmergencyBadgeId(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEmergencyModalCase(null)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={!isEmergencyAuthReady}
                    onClick={handleConfirmEmergencyAcknowledgement}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg transition ${
                      isEmergencyAuthReady
                        ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30 active:scale-95'
                        : 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>Acknowledge Team & Authorize Intra-Op Incision</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

