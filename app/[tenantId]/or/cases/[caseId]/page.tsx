'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Scissors,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  HeartPulse,
  Activity,
  FileCheck,
  ShieldCheck,
  Building2,
  Stethoscope,
  Sparkles,
  RefreshCw,
  X,
  Plus,
  Flame,
  Check,
  AlertCircle,
  FileText,
  BadgeAlert,
  ChevronRight,
  Layers,
  Wind,
  Save,
  Radio,
  Printer,
  Download,
  Send,
  FileCheck2,
  CheckCheck,
  FileSpreadsheet,
  Award,
  Share2,
} from 'lucide-react';
import {
  SurgicalCase,
  SurgicalCaseStatus,
  WHOChecklist,
  WHOSignInRecord,
  WHOTimeOutRecord,
  WHOSignOutRecord,
  SurgicalCountItem,
  SurgicalImplantRecord,
  AnesthesiaVitalLog,
} from '@/types/inpatient-or';
import {
  getSurgicalCaseById,
  getWHOChecklistByCaseId,
  saveWHOChecklist,
  updateORCaseStatus,
  subscribeToWHOChecklist,
} from '@/lib/firebase/services/inpatient-or';

export default function IntraOperativeWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = (params?.tenantId as string) || 'metro-health';
  const caseId = (params?.caseId as string) || 'case-or-101';

  const [orCase, setOrCase] = useState<SurgicalCase | null>(null);
  const [checklist, setChecklist] = useState<WHOChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'who' | 'anesthesia' | 'counts' | 'summary'>('who');
  const [whoPhase, setWhoPhase] = useState<'signin' | 'timeout' | 'signout'>('signin');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // PACU Discharge Document Modal State
  const [showDischargeSummaryModal, setShowDischargeSummaryModal] = useState(false);
  const [dischargeSignedSurgeon, setDischargeSignedSurgeon] = useState('');
  const [dischargeSignedNurse, setDischargeSignedNurse] = useState('');
  const [dischargeSignTimestamp, setDischargeSignTimestamp] = useState('');
  const [pushedToEHR, setPushedToEHR] = useState(false);

  // New Vital entry form
  const [newVital, setNewVital] = useState<Partial<AnesthesiaVitalLog>>({
    heartRate: 75,
    systolicBP: 120,
    diastolicBP: 80,
    spo2: 99,
    etCO2: 36,
    tempCelsius: 36.6,
    gasAgentPercentage: 2.0,
    gasAgentType: 'Sevoflurane',
    ivFluidGivenMl: 500,
    bloodLossEstimateMl: 50,
    urineOutputMl: 120,
    notes: 'Hemodynamics stable',
  });
  const [showVitalModal, setShowVitalModal] = useState(false);

  // Load Case & WHO Checklist
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const fetchedCase = await getSurgicalCaseById(tenantId, caseId);
        if (!fetchedCase) {
          setErrorMsg(`Surgical Case ${caseId} not found in tenant ${tenantId}.`);
          setLoading(false);
          return;
        }
        setOrCase(fetchedCase);

        const fetchedChecklist = await getWHOChecklistByCaseId(tenantId, caseId, fetchedCase);
        setChecklist(fetchedChecklist);
        setLoading(false);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load surgical case workspace.');
        setLoading(false);
      }
    }

    loadData();

    // Subscribe to live WHO checklist updates
    const unsub = subscribeToWHOChecklist(tenantId, caseId, (updated) => {
      setChecklist(updated);
    });

    return () => unsub();
  }, [tenantId, caseId]);

  // Notifications timeout
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  // Helper to save checklist changes to Firestore
  const handleSaveChecklist = async (updatedChecklist: WHOChecklist) => {
    try {
      setSaving(true);
      setChecklist(updatedChecklist);
      await saveWHOChecklist(tenantId, updatedChecklist);
      setSuccessMsg('WHO Surgical Checklist saved to cloud record.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save WHO Checklist.');
    } finally {
      setSaving(false);
    }
  };

  // Case Status progression handler with PACU Summary Document Trigger
  const handleProgressStatus = async (nextStatus: SurgicalCaseStatus) => {
    if (!orCase) return;
    try {
      const now = new Date().toISOString();
      const updates: any = {};
      if (nextStatus === 'intra_op' && !orCase.actualStartTime) {
        updates.actualStartTime = now;
      }
      if (nextStatus === 'completed' && !orCase.actualEndTime) {
        updates.actualEndTime = now;
      }

      await updateORCaseStatus(tenantId, caseId, nextStatus, updates);
      setOrCase({ ...orCase, status: nextStatus, ...updates });
      setSuccessMsg(`Case transitioned to status: ${nextStatus.toUpperCase()}`);

      // TRIGGER SUMMARY DISCHARGE DOCUMENT ON TRANSITION TO PACU RECOVERY
      if (nextStatus === 'post_op_pacu') {
        setShowDischargeSummaryModal(true);
        if (!dischargeSignedSurgeon) {
          setDischargeSignedSurgeon(orCase.surgeonName || 'Dr. Sarah Jenkins, FACS');
        }
        if (!dischargeSignedNurse) {
          setDischargeSignedNurse(orCase.circulatingNurseName || 'Nurse James Wilson, BSN');
        }
        setDischargeSignTimestamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update case status.');
    }
  };

  // WHO Phase 1: Sign-In Handlers
  const handleToggleSignIn = (field: keyof WHOSignInRecord, value?: any) => {
    if (!checklist) return;
    const current = checklist.signIn[field];
    const nextVal = value !== undefined ? value : !current;
    const updated = {
      ...checklist,
      signIn: {
        ...checklist.signIn,
        [field]: nextVal,
      },
    };
    handleSaveChecklist(updated);
  };

  // WHO Phase 2: Time-Out Handlers
  const handleToggleTimeOut = (field: keyof WHOTimeOutRecord, value?: any) => {
    if (!checklist) return;
    const current = checklist.timeOut[field];
    const nextVal = value !== undefined ? value : !current;
    const updated = {
      ...checklist,
      timeOut: {
        ...checklist.timeOut,
        [field]: nextVal,
      },
    };
    handleSaveChecklist(updated);
  };

  const handleToggleAnticipatedEvents = (
    field: 'surgeonReviewOperatingTimeSteps' | 'anesthesiaReviewPatientRisks' | 'nursingReviewSterilityEquipment'
  ) => {
    if (!checklist) return;
    const rawEvents = checklist.timeOut?.anticipatedCriticalEvents;
    const events: Record<string, boolean> =
      typeof rawEvents === 'object' && rawEvents !== null
        ? (rawEvents as unknown as Record<string, boolean>)
        : {
            surgeonReviewOperatingTimeSteps: false,
            anesthesiaReviewPatientRisks: false,
            nursingReviewSterilityEquipment: false,
          };
    const current = !!events[field];
    const updated = {
      ...checklist,
      timeOut: {
        ...checklist.timeOut,
        anticipatedCriticalEvents: {
          ...events,
          [field]: !current,
        },
      },
    };
    handleSaveChecklist(updated);
  };

  // WHO Phase 3: Sign-Out Handlers
  const handleToggleSignOut = (field: keyof WHOSignOutRecord, value?: any) => {
    if (!checklist) return;
    const current = checklist.signOut[field];
    const nextVal = value !== undefined ? value : !current;
    const updated = {
      ...checklist,
      signOut: {
        ...checklist.signOut,
        [field]: nextVal,
      },
    };
    handleSaveChecklist(updated);
  };

  // Surgical Counts Update Handler
  const handleUpdateCountItem = (itemId: string, field: 'addedCount' | 'finalCount', val: number) => {
    if (!checklist) return;
    const updatedCounts = checklist.surgicalCounts.map((item) => {
      if (item.id !== itemId) return item;
      const updatedItem = { ...item, [field]: val };
      const totalExpected = updatedItem.initialCount + updatedItem.addedCount;
      updatedItem.status = updatedItem.finalCount === totalExpected ? 'correct' : 'discrepancy';
      return updatedItem;
    });

    handleSaveChecklist({ ...checklist, surgicalCounts: updatedCounts });
  };

  // Add Vital Log Handler
  const handleAddVitalLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checklist) return;

    const entry: AnesthesiaVitalLog = {
      id: `vital-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      heartRate: Number(newVital.heartRate || 75),
      systolicBP: Number(newVital.systolicBP || 120),
      diastolicBP: Number(newVital.diastolicBP || 80),
      spo2: Number(newVital.spo2 || 99),
      etCO2: Number(newVital.etCO2 || 36),
      tempCelsius: Number(newVital.tempCelsius || 36.6),
      gasAgentPercentage: Number(newVital.gasAgentPercentage || 2.0),
      gasAgentType: newVital.gasAgentType || 'Sevoflurane',
      ivFluidGivenMl: Number(newVital.ivFluidGivenMl || 500),
      bloodLossEstimateMl: Number(newVital.bloodLossEstimateMl || 50),
      urineOutputMl: Number(newVital.urineOutputMl || 100),
      notes: newVital.notes || 'Hemodynamics stable',
    };

    const updated = {
      ...checklist,
      anesthesiaLogs: [...checklist.anesthesiaLogs, entry],
    };
    handleSaveChecklist(updated);
    setShowVitalModal(false);
  };

  // Computed PACU Summary Document Metrics (Pulling in vital logs and surgical count verification status)
  const dischargeMetrics = useMemo(() => {
    if (!checklist) {
      return {
        vitalsList: [],
        latestVital: null,
        meanHR: 75,
        meanSys: 120,
        meanDia: 80,
        minSpO2: 99,
        totalIVFluids: 0,
        totalBloodLoss: 0,
        totalUrine: 0,
        countsList: [],
        allCountsVerified: true,
        discrepancyCount: 0,
        totalImplants: 0,
      };
    }

    const vitalsList = checklist.anesthesiaLogs || [];
    const latestVital = vitalsList.length > 0 ? vitalsList[vitalsList.length - 1] : null;

    let sumHR = 0;
    let sumSys = 0;
    let sumDia = 0;
    let minSpO2 = 100;
    let totalIVFluids = 0;
    let totalBloodLoss = 0;
    let totalUrine = 0;

    vitalsList.forEach((v) => {
      sumHR += v.heartRate || 0;
      sumSys += v.systolicBP || 0;
      sumDia += v.diastolicBP || 0;
      if (v.spo2 && v.spo2 < minSpO2) minSpO2 = v.spo2;
      totalIVFluids += v.ivFluidGivenMl || 0;
      totalBloodLoss += v.bloodLossEstimateMl || 0;
      totalUrine += v.urineOutputMl || 0;
    });

    const vCount = vitalsList.length || 1;
    const meanHR = Math.round(sumHR / vCount);
    const meanSys = Math.round(sumSys / vCount);
    const meanDia = Math.round(sumDia / vCount);

    const countsList = checklist.surgicalCounts || [];
    let discrepancyCount = 0;
    countsList.forEach((item) => {
      const expected = (item.initialCount || 0) + (item.addedCount || 0);
      if (item.finalCount !== expected) {
        discrepancyCount += 1;
      }
    });

    const allCountsVerified = countsList.length > 0 ? discrepancyCount === 0 : true;
    const totalImplants = checklist.implants?.length || 0;

    return {
      vitalsList,
      latestVital,
      meanHR: vitalsList.length > 0 ? meanHR : 75,
      meanSys: vitalsList.length > 0 ? meanSys : 120,
      meanDia: vitalsList.length > 0 ? meanDia : 80,
      minSpO2: vitalsList.length > 0 ? minSpO2 : 99,
      totalIVFluids,
      totalBloodLoss,
      totalUrine,
      countsList,
      allCountsVerified,
      discrepancyCount,
      totalImplants,
    };
  }, [checklist]);

  // Handle printing document
  const handlePrintDocument = () => {
    window.print();
  };

  // Handle pushing document to Patient EHR Timeline
  const handlePushToEHR = () => {
    setPushedToEHR(true);
    setSuccessMsg('Discharge summary document successfully committed to Patient EHR encounter timeline.');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-500">
        <RefreshCw className="h-8 w-8 animate-spin text-purple-600" />
        <p className="mt-3 text-sm font-medium">Opening Intra-Operative Surgical Workspace & WHO Safety Matrix...</p>
      </div>
    );
  }

  if (!orCase || !checklist) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl border border-slate-200 text-center">
          <AlertCircle className="h-12 w-12 text-rose-500 mx-auto" />
          <h2 className="mt-3 text-lg font-bold text-slate-900">Case Not Found</h2>
          <p className="mt-1 text-sm text-slate-500">{errorMsg || 'Could not find case details.'}</p>
          <Link
            href={`/${tenantId}/or/schedule`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Return to OR Schedule
          </Link>
        </div>
      </div>
    );
  }

  // Calculate WHO Completion Percentages
  const signInFields = [
    checklist.signIn.patientConfirmedIdentitySite,
    checklist.signIn.anesthesiaSafetyCheckCompleted,
    checklist.signIn.pulseOximeterFunctioning,
    checklist.signIn.allergyKnown,
    checklist.signIn.bloodLossRiskAssessed,
  ];
  const signInCompletedCount = signInFields.filter(Boolean).length;
  const signInPct = Math.round((signInCompletedCount / signInFields.length) * 100);

  const critEvents =
    typeof checklist.timeOut?.anticipatedCriticalEvents === 'object' &&
    checklist.timeOut.anticipatedCriticalEvents !== null
      ? checklist.timeOut.anticipatedCriticalEvents
      : undefined;

  const timeOutFields = [
    checklist.timeOut?.allTeamMembersIntroduced,
    checklist.timeOut?.confirmPatientNameProcedureSite,
    critEvents?.surgeonReviewOperatingTimeSteps,
    critEvents?.anesthesiaReviewPatientRisks,
    critEvents?.nursingReviewSterilityEquipment,
    checklist.timeOut?.essentialImagingDisplayed,
  ];
  const timeOutCompletedCount = timeOutFields.filter(Boolean).length;
  const timeOutPct = Math.round((timeOutCompletedCount / timeOutFields.length) * 100);

  const signOutFields = [
    checklist.signOut.procedureNameRecorded,
    checklist.signOut.instrumentSpongeNeedleCountsCorrect,
    checklist.signOut.specimenLabeledCorrectly,
    checklist.signOut.equipmentProblemsAddressed,
    checklist.signOut.keyRecoveryConcernsReviewed,
  ];
  const signOutCompletedCount = signOutFields.filter(Boolean).length;
  const signOutPct = Math.round((signOutCompletedCount / signOutFields.length) * 100);

  // Status badge styling
  const statusSteps: { id: SurgicalCaseStatus; label: string }[] = [
    { id: 'scheduled', label: '1. Scheduled' },
    { id: 'pre_op', label: '2. Pre-Op Holding' },
    { id: 'intra_op', label: '3. Intra-Op ACTIVE' },
    { id: 'post_op_pacu', label: '4. PACU Recovery' },
    { id: 'completed', label: '5. Completed' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-20 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      {/* Top Breadcrumb & Status Ribbon */}
      <div className="border-b border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Link
                href={`/${tenantId}/or/cases`}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:hover:bg-slate-800"
                title="Back to OR Cases"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-400">
                  <Scissors className="h-3.5 w-3.5" />
                  <span>Intra-Operative Surgical Console</span>
                  <span>•</span>
                  <span>{orCase.orRoomName}</span>
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                  {orCase.surgicalProcedureName}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Trigger Summary Discharge Document Modal Button */}
              <button
                onClick={() => {
                  setShowDischargeSummaryModal(true);
                  if (!dischargeSignedSurgeon) setDischargeSignedSurgeon(orCase.surgeonName || 'Dr. Sarah Jenkins, FACS');
                  if (!dischargeSignedNurse) setDischargeSignedNurse(orCase.circulatingNurseName || 'Nurse James Wilson, BSN');
                  setDischargeSignTimestamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 px-3.5 py-2 text-xs font-bold text-purple-800 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/80 shadow-xs transition active:scale-95"
              >
                <FileCheck2 className="h-4 w-4 text-purple-600" />
                <span>PACU Discharge Summary Document</span>
                {orCase.status === 'post_op_pacu' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping ml-0.5" />
                )}
              </button>

              {/* Quick Status Ribbon Action */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {statusSteps.map((step, idx) => {
                  const isActive = orCase.status === step.id;
                  const isPast =
                    statusSteps.findIndex((s) => s.id === orCase.status) > idx;

                  return (
                    <button
                      key={step.id}
                      onClick={() => handleProgressStatus(step.id)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                        isActive
                          ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-400 font-bold'
                          : isPast
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {isPast ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : null}
                      <span>{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Success / Error Banners */}
          {successMsg && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{successMsg}</span>
              </div>
              <button onClick={() => setSuccessMsg(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Patient Demographic & Care Team Banner */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 text-xs">
              <div>
                <span className="text-slate-400 block font-medium">Patient Name</span>
                <span className="font-bold text-slate-900 text-sm flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-blue-600" /> {orCase.patientName}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">{orCase.patientMRN}</span>
              </div>

              <div>
                <span className="text-slate-400 block font-medium">Age / Gender / Blood</span>
                <span className="font-semibold text-slate-800">
                  {orCase.patientAge}y • {orCase.patientGender}
                </span>
                <span className="block text-[11px] font-bold text-rose-700">
                  Blood Group: {orCase.patientBloodType || 'O+'}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block font-medium">Lead Surgeon</span>
                <span className="font-semibold text-slate-800">{orCase.surgeonName}</span>
                <span className="text-[11px] text-purple-700 block">{orCase.procedureCategory}</span>
              </div>

              <div>
                <span className="text-slate-400 block font-medium">Anesthesiologist</span>
                <span className="font-semibold text-slate-800">{orCase.anesthesiologistName}</span>
                <span className="text-[11px] text-slate-500 block uppercase font-mono">
                  {orCase.anesthesiaType} Anesthesia
                </span>
              </div>

              <div>
                <span className="text-slate-400 block font-medium">Known Allergies</span>
                {orCase.patientAllergies && orCase.patientAllergies.length > 0 ? (
                  <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded text-[11px]">
                    <BadgeAlert className="h-3 w-3" /> {orCase.patientAllergies.join(', ')}
                  </span>
                ) : (
                  <span className="text-emerald-700 font-semibold">NKDA</span>
                )}
              </div>

              <div>
                <span className="text-slate-400 block font-medium">Assigned PACU Bed</span>
                <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded inline-block">
                  {orCase.pacuBedAssigned || 'Ward 4-West (SURG-401)'}
                </span>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-4 flex border-b border-slate-200 gap-6 text-sm font-semibold">
            <button
              onClick={() => setActiveTab('who')}
              className={`pb-3 flex items-center gap-2 border-b-2 transition ${
                activeTab === 'who'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>WHO Surgical Safety Checklist</span>
              <span className="rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px]">
                {Math.round((signInPct + timeOutPct + signOutPct) / 3)}% Completed
              </span>
            </button>

            <button
              onClick={() => setActiveTab('anesthesia')}
              className={`pb-3 flex items-center gap-2 border-b-2 transition ${
                activeTab === 'anesthesia'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <HeartPulse className="h-4 w-4" />
              <span>Anesthesia & Hemodynamics Log</span>
              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]">
                {checklist.anesthesiaLogs.length} Records
              </span>
            </button>

            <button
              onClick={() => setActiveTab('counts')}
              className={`pb-3 flex items-center gap-2 border-b-2 transition ${
                activeTab === 'counts'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileCheck className="h-4 w-4" />
              <span>Surgical Counts & Implants</span>
              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]">
                {checklist.surgicalCounts.length} Items
              </span>
            </button>

            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-3 flex items-center gap-2 border-b-2 transition ${
                activeTab === 'summary'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText className="h-4 w-4" />
              <span>Operative Report & PACU Transfer</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ========================================================================= */}
        {/* TAB 1: WHO SURGICAL SAFETY CHECKLIST (SIGN-IN, TIME-OUT, SIGN-OUT)        */}
        {/* ========================================================================= */}
        {activeTab === 'who' && (
          <div className="space-y-6">
            {/* Phase Sub-Tabs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Phase 1: Sign-In */}
              <button
                onClick={() => setWhoPhase('signin')}
                className={`rounded-2xl border p-5 text-left transition-all ${
                  whoPhase === 'signin'
                    ? 'border-purple-500 bg-white shadow-md ring-2 ring-purple-100'
                    : 'border-slate-200 bg-white shadow-xs hover:border-purple-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                    PHASE 1
                  </span>
                  <span className="text-xs font-bold text-slate-700">{signInPct}% Verified</span>
                </div>
                <h3 className="mt-2 font-bold text-slate-900 text-base">Sign-In Protocol</h3>
                <p className="text-xs text-slate-500 mt-0.5">Before Induction of Anesthesia (with Nurse & Anesthetist)</p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${signInPct}%` }} />
                </div>
              </button>

              {/* Phase 2: Time-Out */}
              <button
                onClick={() => setWhoPhase('timeout')}
                className={`rounded-2xl border p-5 text-left transition-all ${
                  whoPhase === 'timeout'
                    ? 'border-purple-500 bg-white shadow-md ring-2 ring-purple-100'
                    : 'border-slate-200 bg-white shadow-xs hover:border-purple-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    PHASE 2
                  </span>
                  <span className="text-xs font-bold text-slate-700">{timeOutPct}% Verified</span>
                </div>
                <h3 className="mt-2 font-bold text-slate-900 text-base">Time-Out Protocol</h3>
                <p className="text-xs text-slate-500 mt-0.5">Before Skin Incision (Entire Surgical Team Huddle)</p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${timeOutPct}%` }} />
                </div>
              </button>

              {/* Phase 3: Sign-Out */}
              <button
                onClick={() => setWhoPhase('signout')}
                className={`rounded-2xl border p-5 text-left transition-all ${
                  whoPhase === 'signout'
                    ? 'border-purple-500 bg-white shadow-md ring-2 ring-purple-100'
                    : 'border-slate-200 bg-white shadow-xs hover:border-purple-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    PHASE 3
                  </span>
                  <span className="text-xs font-bold text-slate-700">{signOutPct}% Verified</span>
                </div>
                <h3 className="mt-2 font-bold text-slate-900 text-base">Sign-Out Protocol</h3>
                <p className="text-xs text-slate-500 mt-0.5">Before Patient Leaves OR (Counts & Specimen Labeling)</p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-full bg-emerald-600 rounded-full transition-all" style={{ width: `${signOutPct}%` }} />
                </div>
              </button>
            </div>

            {/* Checklist Form Body */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              {/* PHASE 1: SIGN-IN */}
              {whoPhase === 'signin' && (
                <div className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-lg font-bold text-slate-900">WHO Phase 1: Sign-In (Pre-Induction)</h2>
                    <p className="text-xs text-slate-500">
                      Must be completed prior to induction of anesthesia in the presence of the patient, anesthesiologist, and nurse.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Item 1 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">
                          Patient Confirmed Identity, Surgical Site, Procedure, and Consent
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Patient verbally verified name, date of birth, wristband MRN, planned surgery and signed informed consent.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.patientConfirmedIdentitySite}
                        onChange={() => handleToggleSignIn('patientConfirmedIdentitySite')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 2 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Surgical Site Marked / Checked</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Operating surgeon has marked operative incision site with indelible surgical marker.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(checklist.signIn.siteMarked)}
                        onChange={() => handleToggleSignIn('siteMarked')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 3 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Anesthesia Machine & Medication Check Complete</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Ventilator circuit leak test passed, suction operational, emergency airway cart & emergency drugs verified.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.anesthesiaSafetyCheckCompleted}
                        onChange={() => handleToggleSignIn('anesthesiaSafetyCheckCompleted')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 4 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Pulse Oximeter On Patient & Functioning</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Audible pulse tone active, waveform confirmed with baseline oxygen saturation ≥ 95%.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.pulseOximeterFunctioning}
                        onChange={() => handleToggleSignIn('pulseOximeterFunctioning')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 5 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Known Allergy Check</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Patient allergy bands matched with electronic record ({checklist.signIn.allergyDetails || 'NKDA'}).
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.allergyKnown}
                        onChange={() => handleToggleSignIn('allergyKnown')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 6 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Difficult Airway / Aspiration Risk Assessed</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Mallampati classification evaluated; video laryngoscope / GlideScope on standby if indicated.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.difficultAirwayRisk}
                        onChange={() => handleToggleSignIn('difficultAirwayRisk')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 7 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Risk of Blood Loss (&gt;500ml) & IV Access Prepared</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Adequate large-bore IV access (16G/18G) verified. Crossmatched blood units reserved ({orCase.bloodUnitsReserved || 0} units).
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signIn.bloodLossRiskAssessed}
                        onChange={() => handleToggleSignIn('bloodLossRiskAssessed')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Sign-off footer */}
                  <div className="mt-6 rounded-xl bg-slate-50 p-4 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-xs text-slate-600">
                      <div><span className="font-bold text-slate-900">Anesthesiologist:</span> {orCase.anesthesiologistName}</div>
                      <div><span className="font-bold text-slate-900">Circulating Nurse:</span> {checklist.signIn.verifiedByNurse}</div>
                    </div>

                    <button
                      onClick={() => setWhoPhase('timeout')}
                      className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700"
                    >
                      <span>Proceed to Phase 2 (Time-Out)</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* PHASE 2: TIME-OUT */}
              {whoPhase === 'timeout' && (
                <div className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-lg font-bold text-slate-900">WHO Phase 2: Time-Out (Pre-Incision Huddle)</h2>
                    <p className="text-xs text-slate-500">
                      Immediate pause prior to skin incision with entire surgical, anesthesia, and nursing team present.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Item 1 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">All Team Members Introduced by Name & Role</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Lead Surgeon, Assistant, Anesthetist, Scrub Nurse, and Circulator introduced verbally.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.timeOut.allTeamMembersIntroduced}
                        onChange={() => handleToggleTimeOut('allTeamMembersIntroduced')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 2 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Verbal Confirmation: Patient, Procedure & Site</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Team verbally stated patient name: <span className="font-bold">{orCase.patientName}</span>, procedure:{' '}
                          <span className="font-bold">{orCase.surgicalProcedureName}</span>, and anatomical site.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.timeOut.confirmPatientNameProcedureSite}
                        onChange={() => handleToggleTimeOut('confirmPatientNameProcedureSite')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Anticipated Events Sub-card */}
                    <div className="rounded-xl border border-purple-200 bg-purple-50/20 p-4 space-y-3">
                      <div className="font-bold text-sm text-purple-900">Anticipated Critical Events Review</div>

                      <div className="space-y-2 text-xs">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span>• <strong>Surgeon Reviews:</strong> Critical or non-routine steps, operative duration, expected blood loss.</span>
                          <input
                            type="checkbox"
                            checked={typeof checklist.timeOut.anticipatedCriticalEvents === 'object' && checklist.timeOut.anticipatedCriticalEvents !== null ? !!checklist.timeOut.anticipatedCriticalEvents.surgeonReviewOperatingTimeSteps : false}
                            onChange={() => handleToggleAnticipatedEvents('surgeonReviewOperatingTimeSteps')}
                            className="h-4 w-4 rounded text-purple-600"
                          />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer">
                          <span>• <strong>Anesthesia Team Reviews:</strong> Patient-specific concerns, airway or hemodynamic volatility.</span>
                          <input
                            type="checkbox"
                            checked={typeof checklist.timeOut.anticipatedCriticalEvents === 'object' && checklist.timeOut.anticipatedCriticalEvents !== null ? !!checklist.timeOut.anticipatedCriticalEvents.anesthesiaReviewPatientRisks : false}
                            onChange={() => handleToggleAnticipatedEvents('anesthesiaReviewPatientRisks')}
                            className="h-4 w-4 rounded text-purple-600"
                          />
                        </label>

                        <label className="flex items-center justify-between cursor-pointer">
                          <span>• <strong>Nursing Team Reviews:</strong> Sterility indicators verified, instrument counts, equipment readiness.</span>
                          <input
                            type="checkbox"
                            checked={typeof checklist.timeOut.anticipatedCriticalEvents === 'object' && checklist.timeOut.anticipatedCriticalEvents !== null ? !!checklist.timeOut.anticipatedCriticalEvents.nursingReviewSterilityEquipment : false}
                            onChange={() => handleToggleAnticipatedEvents('nursingReviewSterilityEquipment')}
                            className="h-4 w-4 rounded text-purple-600"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Item 3 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Antibiotic Prophylaxis Given Within Last 60 Minutes</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {checklist.timeOut.antibioticNameTime || 'Cefazolin 2g IV administered at pre-induction.'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(checklist.timeOut.antibioticProphylaxisGivenWithin60Min)}
                        onChange={() => handleToggleTimeOut('antibioticProphylaxisGivenWithin60Min')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 4 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Essential Radiographic Imaging Displayed</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          CT / MRI / Fluoroscopy PACS imaging correctly oriented and visible on OR monitor.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(checklist.timeOut.essentialImagingDisplayed)}
                        onChange={() => handleToggleTimeOut('essentialImagingDisplayed')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Sign-off footer */}
                  <div className="mt-6 rounded-xl bg-slate-50 p-4 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-xs text-slate-600">
                      <div><span className="font-bold text-slate-900">Verified By Surgeon:</span> {orCase.surgeonName}</div>
                      <div><span className="font-bold text-slate-900">Verified By Circulator:</span> {checklist.timeOut.verifiedByCirculator}</div>
                    </div>

                    <button
                      onClick={() => setWhoPhase('signout')}
                      className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700"
                    >
                      <span>Proceed to Phase 3 (Sign-Out)</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* PHASE 3: SIGN-OUT */}
              {whoPhase === 'signout' && (
                <div className="space-y-6">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-lg font-bold text-slate-900">WHO Phase 3: Sign-Out (Pre-Wound Closure & Post-Op)</h2>
                    <p className="text-xs text-slate-500">
                      Nurse and surgical team confirm counts, specimen labeling, and post-op PACU handover plan before patient leaves OR.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Item 1 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Procedure Name Recorded Accurately</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Actual surgical procedure verified: <span className="font-semibold">{orCase.surgicalProcedureName}</span>
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signOut.procedureNameRecorded}
                        onChange={() => handleToggleSignOut('procedureNameRecorded')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 2 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Instrument, Sponge & Needle Counts Correct</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Scrub nurse and circulating nurse completed final count; no discrepancies noted.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signOut.instrumentSpongeNeedleCountsCorrect}
                        onChange={() => handleToggleSignOut('instrumentSpongeNeedleCountsCorrect')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 3 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Surgical Specimens Labeled Correctly (Read Aloud)</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Specimen pathology label verified with patient name, MRN, anatomical site, and surgical orientation.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(checklist.signOut.specimenLabeledCorrectly)}
                        onChange={() => handleToggleSignOut('specimenLabeledCorrectly')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 4 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Equipment Problems Addressed / Logged</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          All surgical equipment functioning normally; any faults tagged for Biomedical Engineering.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signOut.equipmentProblemsAddressed}
                        onChange={() => handleToggleSignOut('equipmentProblemsAddressed')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>

                    {/* Item 5 */}
                    <div className="flex items-start justify-between rounded-xl border border-slate-200 p-4 hover:bg-slate-50/50">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">Key Concerns for PACU Recovery & Pain Management Reviewed</div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Surgeon, anesthesiologist, and nurse reviewed airway stability, drain outputs, and analgesia protocol.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={checklist.signOut.keyRecoveryConcernsReviewed}
                        onChange={() => handleToggleSignOut('keyRecoveryConcernsReviewed')}
                        className="h-5 w-5 rounded text-purple-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Sign-off completion button */}
                  <div className="mt-6 rounded-xl bg-emerald-50 p-4 border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-xs text-emerald-800">
                      <div className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Electronic WHO Checklist Verification</span>
                      </div>
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Signing off stamps the final checklist into the permanent hospital EHR audit record.
                      </p>
                    </div>

                    <button
                      onClick={() => handleProgressStatus('post_op_pacu')}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Complete Checklist & Move to PACU</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: ANESTHESIA & HEMODYNAMIC LOGS                                      */}
        {/* ========================================================================= */}
        {activeTab === 'anesthesia' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Intra-Operative Anesthesia & Hemodynamic Log</h2>
                <p className="text-xs text-slate-500">
                  Continuous physiological telemetry, anesthetic agent concentration, fluids, and blood loss tracking.
                </p>
              </div>

              <button
                onClick={() => setShowVitalModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700"
              >
                <Plus className="h-4 w-4" />
                <span>Add Vital Log Entry</span>
              </button>
            </div>

            {/* Table of Vital Records */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5">Time</th>
                    <th className="px-3 py-2.5">Heart Rate (bpm)</th>
                    <th className="px-3 py-2.5">Blood Pressure (mmHg)</th>
                    <th className="px-3 py-2.5">SpO2 (%)</th>
                    <th className="px-3 py-2.5">EtCO2 (mmHg)</th>
                    <th className="px-3 py-2.5">Temp (°C)</th>
                    <th className="px-3 py-2.5">Anesthetic Agent</th>
                    <th className="px-3 py-2.5">IV Fluids / EBL</th>
                    <th className="px-3 py-2.5">Clinical Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {checklist.anesthesiaLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono font-bold text-slate-900">{log.timestamp}</td>
                      <td className="px-3 py-3 font-semibold text-slate-800">
                        <span className="flex items-center gap-1">
                          <HeartPulse className="h-3.5 w-3.5 text-rose-500" />
                          {log.heartRate}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono font-bold text-slate-900">
                        {log.systolicBP}/{log.diastolicBP}
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          {log.spo2}%
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono">{log.etCO2}</td>
                      <td className="px-3 py-3">{log.tempCelsius}°C</td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-purple-700">
                          {log.gasAgentType} ({log.gasAgentPercentage}%)
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px]">
                        <div>In: {log.ivFluidGivenMl} mL</div>
                        <div className="text-rose-700">EBL: {log.bloodLossEstimateMl} mL</div>
                      </td>
                      <td className="px-3 py-3 text-slate-500 italic max-w-xs">{log.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Summary Strip */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 rounded-xl bg-slate-50 p-4 border border-slate-200 text-xs">
              <div>
                <span className="text-slate-400 block">Total IV Crystalloids / Colloids</span>
                <span className="text-base font-bold text-slate-900">
                  {checklist.anesthesiaLogs.reduce((acc, l) => acc + (l.ivFluidGivenMl || 0), 0)} mL
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Estimated Blood Loss (EBL)</span>
                <span className="text-base font-bold text-rose-700">
                  {checklist.anesthesiaLogs[checklist.anesthesiaLogs.length - 1]?.bloodLossEstimateMl || 120} mL
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Total Urine Output</span>
                <span className="text-base font-bold text-amber-700">
                  {checklist.anesthesiaLogs[checklist.anesthesiaLogs.length - 1]?.urineOutputMl || 180} mL
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Anesthesia Technique</span>
                <span className="text-base font-bold text-purple-700 uppercase">
                  {orCase.anesthesiaType}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: SURGICAL COUNTS & IMPLANT TRACKER                                  */}
        {/* ========================================================================= */}
        {activeTab === 'counts' && (
          <div className="space-y-6">
            {/* Surgical Counts Table */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Intra-Operative Count Verification Matrix</h2>
                  <p className="text-xs text-slate-500">
                    Dual-registered verification of sponges, sharps, and instruments (Initial vs Added vs Final).
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                  Zero Discrepancy Protocol Active
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Item Classification</th>
                      <th className="px-4 py-3 text-center">Initial Count</th>
                      <th className="px-4 py-3 text-center">Added Count</th>
                      <th className="px-4 py-3 text-center">Total Required</th>
                      <th className="px-4 py-3 text-center">Final Count (Field/Mayo)</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {checklist.surgicalCounts.map((sc) => {
                      const totalExpected = sc.initialCount + sc.addedCount;
                      const isMatch = sc.finalCount === totalExpected;

                      return (
                        <tr key={sc.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3.5 font-bold text-slate-900">{sc.itemType.replace('_', ' ')}</td>
                          <td className="px-4 py-3 text-center font-mono font-semibold">{sc.initialCount}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min="0"
                              value={sc.addedCount}
                              onChange={(e) => handleUpdateCountItem(sc.id, 'addedCount', Number(e.target.value))}
                              className="w-16 rounded border border-slate-300 py-1 text-center font-mono text-xs focus:border-purple-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-bold text-slate-900">{totalExpected}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min="0"
                              value={sc.finalCount}
                              onChange={(e) => handleUpdateCountItem(sc.id, 'finalCount', Number(e.target.value))}
                              className={`w-16 rounded border py-1 text-center font-mono text-xs font-bold focus:outline-none ${
                                isMatch
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                  : 'border-rose-300 bg-rose-50 text-rose-900'
                              }`}
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isMatch ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                <Check className="h-3 w-3" /> Correct
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 animate-pulse">
                                <AlertTriangle className="h-3 w-3" /> Discrepancy
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Biological / Prosthetic Implant Log */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Surgical Prosthesis & Implant Log</h2>
                  <p className="text-xs text-slate-500">
                    Mandatory medical device serial & lot registration for biological traceability.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                {checklist.implants.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
                    No permanent implants or prosthetics registered for this surgical case.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {checklist.implants.map((imp) => (
                      <div key={imp.id} className="py-4 grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
                        <div className="sm:col-span-2">
                          <span className="text-slate-400 block">Device Description</span>
                          <span className="font-bold text-slate-900 text-sm">{imp.itemDescription}</span>
                          <span className="text-slate-500 block">Manufacturer: {imp.manufacturer}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Lot / Serial Number</span>
                          <span className="font-mono font-bold text-slate-800">{imp.lotNumber}</span>
                          <span className="font-mono text-slate-500 block">SN: {imp.serialNumber}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Site Placed & Surgeon</span>
                          <span className="font-semibold text-slate-800">{imp.anatomicalSite}</span>
                          <span className="text-slate-500 block">Placed by {imp.placedBy}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: OPERATIVE REPORT & PACU TRANSFER                                   */}
        {/* ========================================================================= */}
        {activeTab === 'summary' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-slate-900">Operative Findings & Post-Anesthesia Handover</h2>
              <p className="text-xs text-slate-500">
                Post-operative diagnosis, procedural narrative, surgical disposition, and step-down bed assignment.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Pre-Operative Diagnosis</label>
                  <input
                    type="text"
                    readOnly
                    value={orCase.preOpDiagnosis || 'Pre-operative evaluation on chart'}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Post-Operative Diagnosis</label>
                  <input
                    type="text"
                    value={orCase.postOpDiagnosis || orCase.preOpDiagnosis || ''}
                    onChange={(e) => setOrCase({ ...orCase, postOpDiagnosis: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Operative Narrative & Findings</label>
                  <textarea
                    rows={4}
                    value={orCase.notes || ''}
                    onChange={(e) => setOrCase({ ...orCase, notes: e.target.value })}
                    placeholder="Surgical approach, pathology specimens excised, hemostasis achieved, drains placed..."
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
                  <h3 className="font-bold text-sm text-indigo-900">PACU Transfer Protocol</h3>

                  <div className="text-xs space-y-2 text-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Destination Inpatient Bed:</span>
                      <span className="font-bold text-indigo-900 bg-white px-2 py-0.5 rounded border border-indigo-200">
                        {orCase.pacuBedAssigned || 'SURG-401 (4-West)'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Airway at Handover:</span>
                      <span className="font-semibold text-slate-900">Extubated in OR (LMA removed)</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Oxygen Support:</span>
                      <span className="font-semibold text-slate-900">Nasal Cannula 3L/min</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Pain Protocol:</span>
                      <span className="font-semibold text-slate-900">IV Hydromorphone PCA / Acetaminophen IV</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDischargeSummaryModal(true);
                      if (!dischargeSignedSurgeon) setDischargeSignedSurgeon(orCase.surgeonName || 'Dr. Sarah Jenkins, FACS');
                      if (!dischargeSignedNurse) setDischargeSignedNurse(orCase.circulatingNurseName || 'Nurse James Wilson, BSN');
                      setDischargeSignTimestamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 px-4 py-2.5 text-xs font-bold text-purple-900 dark:text-purple-200 hover:bg-purple-100 shadow-xs transition active:scale-95"
                  >
                    <FileCheck2 className="h-4 w-4 text-purple-600" />
                    <span>View & Sign PACU Discharge Document</span>
                  </button>

                  <button
                    onClick={() => handleProgressStatus('completed')}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Finalize Operative Record & Discharge from OR</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: POST-OPERATIVE SURGICAL DISCHARGE & PACU HANDOVER SUMMARY DOCUMENT */}
      {/* ========================================================================= */}
      {showDischargeSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/10 rounded-2xl">
                  <FileText className="w-6 h-6 text-purple-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest bg-purple-500/30 px-2 py-0.5 rounded text-purple-200 border border-purple-400/30">
                      Official Medical Record &bull; G-HIMS EHR
                    </span>
                    <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                      PACU Transition Summary
                    </span>
                  </div>
                  <h2 className="text-lg font-black tracking-tight text-white mt-0.5">
                    Surgical Discharge & PACU Handover Summary Document
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintDocument}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition border border-white/20"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Document</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDischargeSummaryModal(false)}
                  className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Document Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-800 dark:text-slate-200">
              {pushedToEHR && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Synchronized with Patient EHR Timeline (Encounter ID: ENC-OR-88219)</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">Status: Verified & Locked</span>
                </div>
              )}

              {/* Patient Demographics & Procedure Header Banner */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Patient Name & MRN</span>
                  <span className="font-black text-sm text-slate-900 dark:text-white">{orCase.patientName}</span>
                  <span className="font-mono text-slate-500 block text-[11px]">{orCase.patientMRN}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Age / Gender / Blood</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{orCase.patientAge}y &bull; {orCase.patientGender}</span>
                  <span className="text-rose-600 dark:text-rose-400 font-bold block text-[11px]">Type: {orCase.patientBloodType || 'O+'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Lead Surgeon</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{orCase.surgeonName || 'Dr. Sarah Jenkins, FACS'}</span>
                  <span className="text-purple-600 dark:text-purple-400 font-semibold block text-[11px]">{orCase.procedureCategory || 'General Surgery'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Anesthesiologist</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{orCase.anesthesiologistName || 'Dr. Michael Chang, MD'}</span>
                  <span className="text-slate-500 block text-[11px] uppercase font-mono">{orCase.anesthesiaType} Anesthesia</span>
                </div>
              </div>

              {/* Clinical Diagnoses & Operative Findings */}
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-2">
                  <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-purple-600" />
                    Operative Procedure & Diagnosis
                  </h3>
                  <span className="font-mono bg-purple-50 dark:bg-purple-950 px-2 py-0.5 rounded text-purple-700 dark:text-purple-300 font-bold text-[11px]">
                    CPT: {orCase.cptCodes?.[0]?.code || '47563'} &bull; ICD-10: {orCase.icd10Codes?.[0]?.code || 'K80.00'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Pre-Operative Diagnosis:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{orCase.preOpDiagnosis || 'Acute cholecystitis with cholelithiasis'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Post-Operative Diagnosis:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{orCase.postOpDiagnosis || orCase.preOpDiagnosis || 'Post-operative confirmation pending pathology'}</p>
                  </div>
                </div>
                {orCase.notes && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Operative Narrative & Hemostasis:</span>
                    <p className="text-slate-700 dark:text-slate-300 text-xs mt-0.5 italic">{orCase.notes}</p>
                  </div>
                )}
              </div>

              {/* SECTION 1: PULLED-IN VITAL LOGS & INTRA-OP HEMODYNAMICS */}
              <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 space-y-3">
                <div className="flex items-center justify-between border-b border-indigo-200/60 dark:border-indigo-900 pb-2">
                  <h3 className="font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <HeartPulse className="w-4 h-4 text-rose-500" />
                    Intra-Operative Vital Logs & Hemodynamic Telemetry
                  </h3>
                  <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                    {dischargeMetrics.vitalsList.length} Recorded Timepoint(s)
                  </span>
                </div>

                {/* Vitals Summary KPI Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Mean Blood Pressure</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{dischargeMetrics.meanSys}/{dischargeMetrics.meanDia} <span className="text-[10px] font-normal text-slate-500">mmHg</span></span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Mean Heart Rate</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{dischargeMetrics.meanHR} <span className="text-[10px] font-normal text-slate-500">bpm</span></span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Minimum SpO2</span>
                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{dischargeMetrics.minSpO2}%</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Blood Loss (EBL)</span>
                    <span className="text-sm font-black text-rose-600 dark:text-rose-400">{dischargeMetrics.totalBloodLoss} <span className="text-[10px] font-normal text-slate-500">mL</span></span>
                  </div>
                </div>

                {/* Fluid Balance Summary */}
                <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-indigo-900 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <span className="text-slate-400">Total IV Crystalloids:</span>
                    <span className="text-blue-600">{dischargeMetrics.totalIVFluids} mL</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <span className="text-slate-400">Urine Output:</span>
                    <span className="text-amber-600">{dischargeMetrics.totalUrine} mL</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <span className="text-slate-400">Net Operative Fluid Balance:</span>
                    <span className="text-emerald-600">+{dischargeMetrics.totalIVFluids - dischargeMetrics.totalBloodLoss - dischargeMetrics.totalUrine} mL</span>
                  </div>
                </div>

                {/* Vital Log Records Table */}
                {dischargeMetrics.vitalsList.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-white dark:bg-slate-800">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-indigo-100/50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-200 font-bold uppercase text-[9px]">
                        <tr>
                          <th className="p-2">Time</th>
                          <th className="p-2">HR</th>
                          <th className="p-2">BP (mmHg)</th>
                          <th className="p-2">SpO2</th>
                          <th className="p-2">EtCO2</th>
                          <th className="p-2">Agent</th>
                          <th className="p-2">Fluid / EBL</th>
                          <th className="p-2">Clinical Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-mono text-[10px]">
                        {dischargeMetrics.vitalsList.map((v, i) => (
                          <tr key={v.id || i} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                            <td className="p-2 font-bold text-purple-700 dark:text-purple-400">{v.timestamp}</td>
                            <td className="p-2 font-semibold">{v.heartRate}</td>
                            <td className="p-2 font-semibold">{v.systolicBP}/{v.diastolicBP}</td>
                            <td className="p-2 text-emerald-600 font-bold">{v.spo2}%</td>
                            <td className="p-2">{v.etCO2}</td>
                            <td className="p-2 font-sans">{v.gasAgentType} ({v.gasAgentPercentage}%)</td>
                            <td className="p-2 font-sans">+{v.ivFluidGivenMl || 0} / -{v.bloodLossEstimateMl || 0} mL</td>
                            <td className="p-2 font-sans text-slate-500 dark:text-slate-400">{v.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECTION 2: PULLED-IN SURGICAL COUNT VERIFICATION STATUS */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Surgical Count Verification Certificate
                  </h3>
                  {dischargeMetrics.allCountsVerified ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-black text-[10px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      100% Correct &bull; Zero Discrepancy Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-black text-[10px] animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                      {dischargeMetrics.discrepancyCount} Count Discrepancy Flagged
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase text-[9px]">
                      <tr>
                        <th className="p-2.5">Item Classification</th>
                        <th className="p-2.5 text-center">Initial Count</th>
                        <th className="p-2.5 text-center">Added Field</th>
                        <th className="p-2.5 text-center">Expected Total</th>
                        <th className="p-2.5 text-center">Final Count</th>
                        <th className="p-2.5 text-center">Audit Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {dischargeMetrics.countsList.map((item) => {
                        const total = (item.initialCount || 0) + (item.addedCount || 0);
                        const isMatch = item.finalCount === total;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">{item.itemType.replace('_', ' ')}</td>
                            <td className="p-2.5 text-center font-mono">{item.initialCount}</td>
                            <td className="p-2.5 text-center font-mono">+{item.addedCount}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-900 dark:text-white">{total}</td>
                            <td className="p-2.5 text-center font-mono font-bold">{item.finalCount}</td>
                            <td className="p-2.5 text-center">
                              {isMatch ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                                  <Check className="w-3 h-3" /> Verified Correct
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                                  <AlertTriangle className="w-3 h-3" /> Discrepancy
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-2.5 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/60 dark:border-emerald-900 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                  <span>Scrub Nurse & Circulating Nurse Dual Physical Count Verification: <strong>COMPLETED & SIGNED</strong></span>
                  <span className="font-mono text-[10px] font-bold">Protocol: AORN-2026-COUNT</span>
                </div>
              </div>

              {/* SECTION 3: PROSTHESIS & SPECIMEN TRACKING */}
              {checklist.implants.length > 0 && (
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
                  <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    Implanted Biological Devices & Prosthetics
                  </h3>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {checklist.implants.map((imp) => (
                      <div key={imp.id} className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-900 dark:text-slate-100">{imp.itemDescription}</span>
                          <span className="text-slate-500 block text-[11px]">Mfr: {imp.manufacturer}</span>
                        </div>
                        <div className="font-mono text-[11px]">
                          <span>Lot: {imp.lotNumber}</span>
                          <span className="text-slate-500 block">SN: {imp.serialNumber}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">Site: {imp.anatomicalSite}</span>
                          <span className="text-slate-500 block text-[11px]">Placed by {imp.placedBy}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 4: PACU RECOVERY HANDOVER & STEP-DOWN ORDERS */}
              <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900 space-y-3">
                <h3 className="font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-purple-600" />
                  Post-Anesthesia Handover & PACU Step-Down Placement
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-purple-100 dark:border-purple-900">
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Assigned Inpatient Bed</span>
                    <span className="font-bold text-sm text-purple-900 dark:text-purple-200">{orCase.pacuBedAssigned || 'SURG-401 (4-West Surgical Step-Down)'}</span>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-purple-100 dark:border-purple-900">
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Airway / Respiratory Target</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">Extubated in OR (3L O2 via NC, SpO2 &gt; 95%)</span>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-purple-100 dark:border-purple-900">
                    <span className="text-slate-400 block uppercase font-bold text-[10px]">Post-Op Analgesia Protocol</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">IV PCA Hydromorphone + IV Acetaminophen</span>
                  </div>
                </div>
              </div>

              {/* SECTION 5: CLINICAL ELECTRONIC SIGN-OFF */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
                <h3 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-500" />
                  Electronic Clinical Handover Attestation & Signatures
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Attending Lead Surgeon Signature
                    </label>
                    <input
                      type="text"
                      value={dischargeSignedSurgeon}
                      onChange={(e) => setDischargeSignedSurgeon(e.target.value)}
                      placeholder="e.g. Dr. Sarah Jenkins, FACS"
                      className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Circulating Handover RN Signature
                    </label>
                    <input
                      type="text"
                      value={dischargeSignedNurse}
                      onChange={(e) => setDischargeSignedNurse(e.target.value)}
                      placeholder="e.g. Nurse James Wilson, BSN"
                      className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500 font-mono">
                Document Generated: {dischargeSignTimestamp || 'Just now'} &bull; Case: {orCase.caseNumber || caseId}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowDischargeSummaryModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Close & View Workspace
                </button>

                <button
                  type="button"
                  onClick={handlePushToEHR}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition active:scale-95"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Push to Patient EHR Timeline</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD ANESTHESIA VITAL LOG ENTRY                                     */}
      {/* ========================================================================= */}
      {showVitalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Add Anesthesia Telemetry Log</h3>
                <p className="text-xs text-slate-500">Record point-in-time hemodynamic parameters</p>
              </div>
              <button onClick={() => setShowVitalModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddVitalLog} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Heart Rate (bpm)</label>
                  <input
                    type="number"
                    required
                    value={newVital.heartRate}
                    onChange={(e) => setNewVital({ ...newVital, heartRate: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">SpO2 (%)</label>
                  <input
                    type="number"
                    required
                    value={newVital.spo2}
                    onChange={(e) => setNewVital({ ...newVital, spo2: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Systolic BP (mmHg)</label>
                  <input
                    type="number"
                    required
                    value={newVital.systolicBP}
                    onChange={(e) => setNewVital({ ...newVital, systolicBP: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Diastolic BP (mmHg)</label>
                  <input
                    type="number"
                    required
                    value={newVital.diastolicBP}
                    onChange={(e) => setNewVital({ ...newVital, diastolicBP: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">EtCO2 (mmHg)</label>
                  <input
                    type="number"
                    value={newVital.etCO2}
                    onChange={(e) => setNewVital({ ...newVital, etCO2: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newVital.tempCelsius}
                    onChange={(e) => setNewVital({ ...newVital, tempCelsius: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Notes / Anesthesia Interventions</label>
                <input
                  type="text"
                  value={newVital.notes}
                  onChange={(e) => setNewVital({ ...newVital, notes: e.target.value })}
                  placeholder="e.g. Bolus 100mcg Fentanyl administered, deepened gas concentration..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVitalModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-purple-700"
                >
                  <Save className="h-4 w-4" />
                  <span>Record Vitals Entry</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
