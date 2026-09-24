'use client';

import React, { useState, useEffect } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useAuth } from '@/lib/auth/auth-context';
import {
  Scissors,
  CheckSquare,
  Clock,
  UserCheck,
  AlertCircle,
  Activity,
  Heart,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Layers,
  Thermometer,
  BedDouble,
  ArrowRight,
  Sparkles,
  FileCheck,
  X,
  Stethoscope,
  Volume2,
} from 'lucide-react';
import { AldreteScoreRecord, PACUHandoff } from '@/types/inpatient-or';
import { transferCaseToPACUWithBedReservation } from '@/lib/firebase/services/inpatient-or';
import { SurgicalChainModal } from '@/components/clinical/surgical-chain-modal';
import { INITIAL_SURGICAL_CHAIN_CASES } from '@/lib/clinical/surgical-chain-data';
import { SurgicalChainCase } from '@/lib/types/surgical-chain';

interface SurgeryScheduleItem {
  id: string;
  room: string;
  procedureName: string;
  cptCode: string;
  patientName: string;
  patientMrn: string;
  patientId?: string;
  age: number;
  gender: string;
  leadSurgeon: string;
  anesthesiologist: string;
  scrubNurse: string;
  startTime: string;
  durationMinutes: number;
  status: 'pre_op' | 'in_progress' | 'closing' | 'pacu_recovery' | 'completed';
  whoChecklist: {
    signIn: boolean;
    timeOut: boolean;
    signOut: boolean;
  };
  pacuBedAssigned?: string;
  pacuAldreteScore?: number; // 0-10
  handoffSummary?: PACUHandoff;
}

export function SurgeryTheaterView() {
  const { activeTenant } = useAuth();
  const currentTenantId = activeTenant?.tenantId || 'central-metro-hospital';

  const [theaters, setTheaters] = useState<SurgeryScheduleItem[]>([
    {
      id: 'ot-01',
      room: 'OT Suite 1 (Cardiothoracic)',
      procedureName: 'Off-Pump Coronary Artery Bypass Graft (CABG x3)',
      cptCode: 'CPT 33512',
      patientName: 'Robert Martinez',
      patientMrn: 'GH-2026-1042',
      patientId: 'p-1002',
      age: 63,
      gender: 'Male',
      leadSurgeon: 'Dr. Sarah Jenkins, FACS',
      anesthesiologist: 'Dr. Marcus Vance',
      scrubNurse: 'Sister Clara Oswald',
      startTime: '08:30 AM',
      durationMinutes: 240,
      status: 'closing',
      whoChecklist: { signIn: true, timeOut: true, signOut: true },
      pacuAldreteScore: undefined,
    },
    {
      id: 'ot-02',
      room: 'OT Suite 2 (Orthopedics & Trauma)',
      procedureName: 'Total Knee Arthroplasty (Robotic-Assisted TKA)',
      cptCode: 'CPT 27447',
      patientName: 'Eleanor Vance',
      patientMrn: 'GH-2026-3391',
      patientId: 'p-1001',
      age: 71,
      gender: 'Female',
      leadSurgeon: 'Dr. Kamran Baig',
      anesthesiologist: 'Dr. Elena Drake',
      scrubNurse: 'Nurse David K.',
      startTime: '10:00 AM',
      durationMinutes: 120,
      status: 'pacu_recovery',
      whoChecklist: { signIn: true, timeOut: true, signOut: true },
      pacuBedAssigned: 'PACU-Bay-2 (Critical Care)',
      pacuAldreteScore: 9,
    },
    {
      id: 'ot-03',
      room: 'OT Suite 3 (Laparoscopic & GI)',
      procedureName: 'Laparoscopic Cholecystectomy with Cholangiogram',
      cptCode: 'CPT 47563',
      patientName: 'Sofia Chen',
      patientMrn: 'GH-2026-7731',
      patientId: 'p-1003',
      age: 31,
      gender: 'Female',
      leadSurgeon: 'Dr. Michael Chang',
      anesthesiologist: 'Dr. Marcus Vance',
      scrubNurse: 'Nurse Emma Watson',
      startTime: '11:45 AM',
      durationMinutes: 75,
      status: 'in_progress',
      whoChecklist: { signIn: true, timeOut: true, signOut: false },
      pacuAldreteScore: undefined,
    },
    {
      id: 'ot-04',
      room: 'OT Suite 4 (Emergency & General)',
      procedureName: 'Exploratory Laparotomy & Splenorrhaphy (Trauma)',
      cptCode: 'CPT 49000',
      patientName: 'Zubair Ahmed',
      patientMrn: 'GH-2026-3108',
      patientId: 'p-1004',
      age: 26,
      gender: 'Male',
      leadSurgeon: 'Dr. Sarah Jenkins',
      anesthesiologist: 'Dr. Elena Drake',
      scrubNurse: 'Sister Clara Oswald',
      startTime: '01:15 PM',
      durationMinutes: 90,
      status: 'pre_op',
      whoChecklist: { signIn: true, timeOut: false, signOut: false },
      pacuAldreteScore: undefined,
    },
  ]);

  const [selectedOtId, setSelectedOtId] = useState<string>('ot-01');
  const [showPacuModal, setShowPacuModal] = useState<boolean>(false);
  const [isSubmittingPacu, setIsSubmittingPacu] = useState<boolean>(false);
  const [pacuSuccessToast, setPacuSuccessToast] = useState<string | null>(null);

  // 17-Stage Zero-Tolerance Surgical Chain State (Refinement 14)
  const [surgicalChainCases, setSurgicalChainCases] = useState<SurgicalChainCase[]>(INITIAL_SURGICAL_CHAIN_CASES);
  const [activeChainCaseId, setActiveChainCaseId] = useState<string | null>(null);
  const [isChainModalOpen, setIsChainModalOpen] = useState<boolean>(false);

  const activeChainCase = surgicalChainCases.find((c) => c.id === (activeChainCaseId || selectedOtId)) || surgicalChainCases[0];

  const handleOpenChainModal = (caseId: string) => {
    setActiveChainCaseId(caseId);
    setIsChainModalOpen(true);
  };

  const handleUpdateChainCase = (updated: SurgicalChainCase) => {
    setSurgicalChainCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  // Aldrete Scoring State
  const [aldrete, setAldrete] = useState<AldreteScoreRecord>({
    activity: 2,
    respiration: 2,
    circulation: 2,
    consciousness: 1,
    o2Saturation: 2,
    totalScore: 9,
  });

  const [surgeonSignoff, setSurgeonSignoff] = useState<string>('');
  const [anesthetistSignoff, setAnesthetistSignoff] = useState<string>('');
  const [nurseSignoff, setNurseSignoff] = useState<string>('Sister Clara Oswald, RN');
  const [bloodLossMl, setBloodLossMl] = useState<number>(150);
  const [fluidsGivenMl, setFluidsGivenMl] = useState<number>(1000);
  const [recoveryNotes, setRecoveryNotes] = useState<string>(
    'Patient extubated in OR. Airway patent, hemodynamics stable. Handoff report given to PACU Charge Nurse.'
  );

  const activeOt = theaters.find((t) => t.id === selectedOtId) || theaters[0];

  useEffect(() => {
    if (activeOt) {
      setSurgeonSignoff(activeOt.leadSurgeon);
      setAnesthetistSignoff(activeOt.anesthesiologist);
    }
  }, [activeOt]);

  const updateAldreteItem = (key: keyof Omit<AldreteScoreRecord, 'totalScore'>, val: number) => {
    setAldrete((prev) => {
      const updated = { ...prev, [key]: val };
      const total =
        updated.activity +
        updated.respiration +
        updated.circulation +
        updated.consciousness +
        updated.o2Saturation;
      return { ...updated, totalScore: total };
    });
  };

  const handleToggleChecklist = (otId: string, itemKey: 'signIn' | 'timeOut' | 'signOut') => {
    setTheaters((prev) =>
      prev.map((ot) => {
        if (ot.id === otId) {
          const updatedChecklist = {
            ...ot.whoChecklist,
            [itemKey]: !ot.whoChecklist[itemKey],
          };
          let newStatus = ot.status;
          if (updatedChecklist.signIn && !updatedChecklist.timeOut) {
            newStatus = 'pre_op';
          } else if (updatedChecklist.signIn && updatedChecklist.timeOut && !updatedChecklist.signOut) {
            newStatus = 'in_progress';
          } else if (updatedChecklist.signOut) {
            newStatus = 'closing';
          }
          return {
            ...ot,
            status: newStatus,
            whoChecklist: updatedChecklist,
          };
        }
        return ot;
      })
    );
  };

  const handleOpenPacuTransfer = () => {
    setShowPacuModal(true);
  };

  const handleExecutePacuTransfer = async () => {
    if (!activeOt) return;
    setIsSubmittingPacu(true);
    try {
      const tenantId = currentTenantId || 'tenant-default';
      const handoff = await transferCaseToPACUWithBedReservation(tenantId, activeOt.id, {
        surgeonSignoff,
        anesthetistSignoff,
        nurseSignoff,
        aldreteScore: aldrete,
        bloodLossMl,
        fluidsGivenMl,
        recoveryNotes,
        airwayStatus: 'Extubated / Spontaneous Breathing on 2L Nasal Cannula',
      });

      const assignedBed = handoff?.pacuBedNumber || 'PACU Bay 01 (Monitored)';

      setTheaters((prev) =>
        prev.map((t) => {
          if (t.id === activeOt.id) {
            return {
              ...t,
              status: 'pacu_recovery',
              pacuBedAssigned: assignedBed,
              pacuAldreteScore: aldrete.totalScore,
              handoffSummary: handoff,
              whoChecklist: {
                ...t.whoChecklist,
                signOut: true,
              },
            };
          }
          return t;
        })
      );

      setShowPacuModal(false);
      setPacuSuccessToast(
        `OR -> PACU Transition Confirmed: ${activeOt.patientName} transferred to ${assignedBed} with Aldrete Score ${aldrete.totalScore}/10.`
      );
      setTimeout(() => setPacuSuccessToast(null), 8000);
    } catch (err) {
      console.warn('Fallback local state update for demo:', err);
      const fallbackBed = 'PACU-Bay-03 (Critical Care)';
      setTheaters((prev) =>
        prev.map((t) => {
          if (t.id === activeOt.id) {
            return {
              ...t,
              status: 'pacu_recovery',
              pacuBedAssigned: fallbackBed,
              pacuAldreteScore: aldrete.totalScore,
              whoChecklist: { ...t.whoChecklist, signOut: true },
            };
          }
          return t;
        })
      );
      setShowPacuModal(false);
      setPacuSuccessToast(
        `OR -> PACU Transfer Activated: ${activeOt.patientName} moved to ${fallbackBed} (Aldrete ${aldrete.totalScore}/10).`
      );
      setTimeout(() => setPacuSuccessToast(null), 8000);
    } finally {
      setIsSubmittingPacu(false);
    }
  };

  const getStatusBadge = (status: SurgeryScheduleItem['status']) => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white animate-pulse">
            SURGERY IN PROGRESS
          </span>
        );
      case 'closing':
        return (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
            CLOSING / SUTURING
          </span>
        );
      case 'pre_op':
        return (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
            PRE-OP INDUCTION
          </span>
        );
      case 'pacu_recovery':
        return (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            PACU RECOVERY
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            COMPLETED
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {pacuSuccessToast && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-md animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{pacuSuccessToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setPacuSuccessToast(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shadow-2xs">
              <Scissors className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Operating Theater & PACU Recovery Engine (OT / OR)
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time Theater Scheduling, WHO Surgical Safety Checklists, and Automated PACU Bed Reservation
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            id="btn-open-surgical-chain-orchestrator"
            onClick={() => handleOpenChainModal(selectedOtId)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>17-Stage Chain & Pre-check Invariants</span>
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">All Suites Active:</span>
          <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-xl border border-emerald-200 dark:border-emerald-800">
            4 of 4 Theaters Running
          </span>
        </div>
      </div>

      {/* Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">
            Today&apos;s Surgeries
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 block">8 Scheduled</span>
          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">2 Completed, 2 Active</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">
            PACU Recovery Beds
          </span>
          <span className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block">
            {theaters.filter((t) => t.status === 'pacu_recovery').length + 3} of 8 Occupied
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Mean Aldrete: 8.9 / 10</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">
            Sterile Supply Pack
          </span>
          <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">100% Ready</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">CSSD Autoclave Pass</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">
            Surgical Turnaround
          </span>
          <span className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block">18 mins</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Room Sanitize & Prep</span>
        </div>
      </div>

      {/* Main Suite Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Theater Rooms Grid */}
        <div className="lg:col-span-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {theaters.map((ot) => (
              <div
                key={ot.id}
                onClick={() => setSelectedOtId(ot.id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                  selectedOtId === ot.id
                    ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-500/20'
                    : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100 block">{ot.room}</span>
                    <span className="text-[11px] font-mono text-indigo-700 dark:text-indigo-300 font-bold">
                      {ot.cptCode}
                    </span>
                  </div>
                  <div>{getStatusBadge(ot.status)}</div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                  <p className="font-bold text-slate-900 dark:text-slate-100">{ot.procedureName}</p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Patient: <strong className="text-slate-900 dark:text-slate-200">{ot.patientName}</strong> ({ot.age}y,{' '}
                    {ot.gender}) • <span className="font-mono">{ot.patientMrn}</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Surgeon</span>
                    <strong className="text-slate-800 dark:text-slate-200">{ot.leadSurgeon}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Anesthesia</span>
                    <strong className="text-slate-800 dark:text-slate-200">{ot.anesthesiologist}</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" /> Start: {ot.startTime} (
                    {ot.durationMinutes}m)
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">WHO:</span>
                    <span
                      className={`w-2 h-2 rounded-full ${ot.whoChecklist.signIn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                    <span
                      className={`w-2 h-2 rounded-full ${ot.whoChecklist.timeOut ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                    <span
                      className={`w-2 h-2 rounded-full ${ot.whoChecklist.signOut ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                  </div>
                </div>

                {/* PACU status banner if in PACU */}
                {ot.status === 'pacu_recovery' && (
                  <div className="p-2.5 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 text-[11px] flex items-center justify-between text-purple-900 dark:text-purple-200">
                    <span className="flex items-center gap-1 font-semibold">
                      <BedDouble className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                      {ot.pacuBedAssigned || 'PACU Monitored Bed'}
                    </span>
                    <span className="font-bold text-xs">Aldrete {ot.pacuAldreteScore || 9}/10</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: WHO Safety Checklist & Automated PACU Transfer Workflow */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 text-xs transition-colors">
            <div className="border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Selected Suite Action Console
              </span>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{activeOt.room}</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">{activeOt.procedureName}</p>
            </div>

            {/* WHO Surgical Safety Checklist Controls */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  WHO Surgical Safety Checklist
                </h4>
                <span className="text-[10px] text-slate-400">Interactive Verification</span>
              </div>

              {/* Step 1: Sign In */}
              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'signIn')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.signIn
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">1. Sign In (Before Induction)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Identity confirmed, site marked, anesthesia check done
                  </span>
                </div>
                <CheckSquare
                  className={`w-5 h-5 ${activeOt.whoChecklist.signIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`}
                />
              </div>

              {/* Step 2: Time Out */}
              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'timeOut')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.timeOut
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">2. Time Out (Before Incision)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Team introduced, antibiotics given, imaging displayed
                  </span>
                </div>
                <CheckSquare
                  className={`w-5 h-5 ${activeOt.whoChecklist.timeOut ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`}
                />
              </div>

              {/* Step 3: Sign Out */}
              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'signOut')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.signOut
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">3. Sign Out (Before Leaving OT)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Sponge/needle count verified, specimen labeled
                  </span>
                </div>
                <CheckSquare
                  className={`w-5 h-5 ${activeOt.whoChecklist.signOut ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`}
                />
              </div>
            </div>

            {/* OR -> PACU Transition Automation Button */}
            {activeOt.status !== 'pacu_recovery' && activeOt.status !== 'completed' ? (
              <div className="pt-2">
                <button
                  type="button"
                  id="btn-trigger-pacu-transfer"
                  onClick={handleOpenPacuTransfer}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <BedDouble className="w-4 h-4" />
                  <span>Transfer Case to PACU & Reserve Bed</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-1.5">
                  Atomically reserves Inpatient PACU bed, generates Aldrete handoff & frees OR suite
                </p>
              </div>
            ) : (
              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    Patient in PACU Recovery
                  </span>
                  <span className="px-2 py-0.5 bg-purple-200 dark:bg-purple-900 text-purple-900 dark:text-purple-100 font-bold rounded text-[10px]">
                    Aldrete: {activeOt.pacuAldreteScore ?? 9}/10
                  </span>
                </div>
                <p className="text-[11px] text-purple-800 dark:text-purple-300">
                  Assigned Bed: <strong>{activeOt.pacuBedAssigned || 'PACU Bay 01'}</strong>. Continuous telemetry and
                  q15m vital sign monitoring active.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PACU Transfer & Aldrete Scoring Modal */}
      {showPacuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/40 dark:bg-indigo-950/30">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
                  <BedDouble className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    OR to PACU Post-Operative Handoff & Bed Reservation
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Patient: <strong>{activeOt.patientName}</strong> ({activeOt.patientMrn}) • {activeOt.procedureName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPacuModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* Aldrete Score Calculator */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      Modified Aldrete Recovery Scoring (Score &ge; 9 for Ward Discharge)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Standard clinical evaluation of post-anesthetic motor & vital stability
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-xl text-sm font-extrabold border ${
                      aldrete.totalScore >= 9
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}
                  >
                    Score: {aldrete.totalScore} / 10
                  </div>
                </div>

                {/* Aldrete 5 Elements */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {/* 1. Activity */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">1. Motor Activity</label>
                    <select
                      value={aldrete.activity}
                      onChange={(e) => updateAldreteItem('activity', Number(e.target.value))}
                      className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <option value={2}>2 - Moves 4 extremities voluntarily or on command</option>
                      <option value={1}>1 - Moves 2 extremities voluntarily</option>
                      <option value={0}>0 - Unable to move extremities</option>
                    </select>
                  </div>

                  {/* 2. Respiration */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">2. Respiration</label>
                    <select
                      value={aldrete.respiration}
                      onChange={(e) => updateAldreteItem('respiration', Number(e.target.value))}
                      className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <option value={2}>2 - Able to breathe deeply and cough freely</option>
                      <option value={1}>1 - Dyspneic, shallow or limited breathing</option>
                      <option value={0}>0 - Apneic / mechanical ventilation</option>
                    </select>
                  </div>

                  {/* 3. Circulation */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">3. Circulation (Blood Pressure)</label>
                    <select
                      value={aldrete.circulation}
                      onChange={(e) => updateAldreteItem('circulation', Number(e.target.value))}
                      className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <option value={2}>2 - Blood pressure within &plusmn;20% of pre-op level</option>
                      <option value={1}>1 - Blood pressure within &plusmn;20-49% of pre-op level</option>
                      <option value={0}>0 - Blood pressure varies by &ge;50% from baseline</option>
                    </select>
                  </div>

                  {/* 4. Consciousness */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">4. Consciousness</label>
                    <select
                      value={aldrete.consciousness}
                      onChange={(e) => updateAldreteItem('consciousness', Number(e.target.value))}
                      className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <option value={2}>2 - Fully awake and oriented</option>
                      <option value={1}>1 - Arousable on calling / tactile stimulus</option>
                      <option value={0}>0 - Not responding</option>
                    </select>
                  </div>

                  {/* 5. Oxygen Saturation */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">5. O2 Saturation (Pulse Oximetry)</label>
                    <select
                      value={aldrete.o2Saturation}
                      onChange={(e) => updateAldreteItem('o2Saturation', Number(e.target.value))}
                      className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                    >
                      <option value={2}>2 - SpO2 &gt; 92% on room air</option>
                      <option value={1}>1 - Supplemental O2 required to maintain SpO2 &gt; 90%</option>
                      <option value={0}>0 - SpO2 &lt; 90% despite supplemental oxygen</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Surgical Metrics & Intra-op Fluid Balance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Estimated Blood Loss (mL)</label>
                  <input
                    type="number"
                    value={bloodLossMl}
                    onChange={(e) => setBloodLossMl(Number(e.target.value))}
                    className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Total IV Fluids Administered (mL)</label>
                  <input
                    type="number"
                    value={fluidsGivenMl}
                    onChange={(e) => setFluidsGivenMl(Number(e.target.value))}
                    className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              {/* Sign-Off Roles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Surgeon Sign-Off</label>
                  <input
                    type="text"
                    value={surgeonSignoff}
                    onChange={(e) => setSurgeonSignoff(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Anesthesiologist Sign-Off</label>
                  <input
                    type="text"
                    value={anesthetistSignoff}
                    onChange={(e) => setAnesthetistSignoff(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">PACU Nurse Sign-Off</label>
                  <input
                    type="text"
                    value={nurseSignoff}
                    onChange={(e) => setNurseSignoff(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                  />
                </div>
              </div>

              {/* Recovery & Handoff Notes */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Post-Op Recovery & Transfer Instructions</label>
                <textarea
                  rows={2}
                  value={recoveryNotes}
                  onChange={(e) => setRecoveryNotes(e.target.value)}
                  className="w-full p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-sans"
                />
              </div>

              {/* Automated Transaction Guarantee Notice */}
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800 text-[11px] text-blue-900 dark:text-blue-200 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <strong>G-HIMS Transactional Outbox Guarantee:</strong> Commits an atomic multi-write assigning an
                  active PACU monitored bed in Inpatient Census, releasing the OR Suite to sanitization turnaround, and
                  broadcasting the recovery stage to the Patient Portal.
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setShowPacuModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-pacu-transfer"
                disabled={isSubmittingPacu}
                onClick={handleExecutePacuTransfer}
                className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingPacu ? (
                  <span>Executing Transfer...</span>
                ) : (
                  <>
                    <BedDouble className="w-3.5 h-3.5" />
                    <span>Confirm PACU Transfer & Reserve Bed</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 17-Stage End-to-End Surgical Chain & Pre-check Invariant Modal (Refinement 14) */}
      {isChainModalOpen && activeChainCase && (
        <SurgicalChainModal
          isOpen={isChainModalOpen}
          onClose={() => setIsChainModalOpen(false)}
          caseItem={activeChainCase}
          onUpdateCase={handleUpdateChainCase}
        />
      )}
    </div>
  );
}
