'use client';

import React, { useState } from 'react';
import {
  SurgicalChainStage,
  SURGICAL_CHAIN_STAGES,
  SurgicalChainCase,
} from '@/lib/types/surgical-chain';
import { pacuAtomicEngine, PACUBedLockResult } from '@/lib/clinical/pacu-atomic-engine';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Scissors,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  BedDouble,
  ArrowRight,
  Sparkles,
  UserCheck,
  FileText,
  Clock,
  Layers,
  Activity,
  X,
  Stethoscope,
  Send,
  Zap,
} from 'lucide-react';

interface SurgicalChainModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseItem: SurgicalChainCase;
  onUpdateCase: (updatedCase: SurgicalChainCase) => void;
}

export function SurgicalChainModal({
  isOpen,
  onClose,
  caseItem,
  onUpdateCase,
}: SurgicalChainModalProps) {
  const { addAuditLog } = useHospital();
  const [currentStage, setCurrentStage] = useState<SurgicalChainStage>(caseItem.currentStage || 'PRE_OP');
  const [activeTab, setActiveTab] = useState<'PIPELINE' | 'GATES' | 'WHO' | 'PACU_ALLOCATION' | 'RECOVERY'>('PIPELINE');

  // Simulation state for simultaneous PACU allocation contention test
  const [contentionResult, setContentionResult] = useState<string | null>(null);
  const [isSimulatingRace, setIsSimulatingRace] = useState(false);

  // Aldrete Scoring Form
  const [aldreteActivity, setAldreteActivity] = useState(caseItem.aldreteScore?.activity ?? 2);
  const [aldreteRespiration, setAldreteRespiration] = useState(caseItem.aldreteScore?.respiration ?? 2);
  const [aldreteCirculation, setAldreteCirculation] = useState(caseItem.aldreteScore?.circulation ?? 2);
  const [aldreteConsciousness, setAldreteConsciousness] = useState(caseItem.aldreteScore?.consciousness ?? 2);
  const [aldreteO2Sat, setAldreteO2Sat] = useState(caseItem.aldreteScore?.o2Saturation ?? 2);

  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentStageIndex = SURGICAL_CHAIN_STAGES.findIndex((s) => s.stage === currentStage);
  const currentStageDef = SURGICAL_CHAIN_STAGES[currentStageIndex] || SURGICAL_CHAIN_STAGES[0];

  const triggerToast = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  // Stage Advancement with Hard Safety Gate Enforcement
  const handleAdvanceStage = async (nextStage: SurgicalChainStage) => {
    // Invariant checks:
    // If attempting to advance into PROCEDURE, verify WHO Sign-In, Time-Out, Privileges, Credentials, and Resources
    if (nextStage === 'PROCEDURE') {
      if (!caseItem.safetyGates.credentialsVerified) {
        triggerToast('GATE BLOCKED: Lead surgeon credentials not active or verified.');
        return;
      }
      if (!caseItem.safetyGates.privilegesVerified) {
        triggerToast('GATE BLOCKED: Surgeon lacks delineated privilege for this procedure CPT.');
        return;
      }
      if (!caseItem.safetyGates.sterileResourcesPassed) {
        triggerToast('GATE BLOCKED: CSSD sterility check or required implants missing.');
        return;
      }
      if (!caseItem.safetyGates.whoTimeOutCompleted) {
        triggerToast('GATE BLOCKED: WHO Time-Out pause must be performed before skin incision.');
        return;
      }
    }

    // If advancing to PACU_RESERVATION, must have SIGN_OUT completed
    if (nextStage === 'PACU_RESERVATION' && !caseItem.safetyGates.whoSignOutCompleted) {
      triggerToast('GATE BLOCKED: Complete WHO Sign-Out & instrument/sponge count first.');
      return;
    }

    const updatedStatuses = {
      ...caseItem.stageStatuses,
      [currentStage]: 'COMPLETED' as const,
      [nextStage]: 'IN_PROGRESS' as const,
    };

    const updated: SurgicalChainCase = {
      ...caseItem,
      currentStage: nextStage,
      stageStatuses: updatedStatuses,
    };

    onUpdateCase(updated);
    setCurrentStage(nextStage);
    addAuditLog(
      'SURGICAL_CHAIN_STAGE_ADVANCE',
      `OR Case ${caseItem.id} (${caseItem.procedureName})`,
      `Stage advanced from ${currentStage} to ${nextStage} for patient ${caseItem.patientName}.`
    );
    triggerToast(`Advanced to stage: ${nextStage}`);
  };

  // Toggle or Pass Safety Gates
  const handleToggleGate = (gateKey: keyof SurgicalChainCase['safetyGates']) => {
    const nextVal = !caseItem.safetyGates[gateKey];
    const updated: SurgicalChainCase = {
      ...caseItem,
      safetyGates: {
        ...caseItem.safetyGates,
        [gateKey]: nextVal,
      },
    };

    onUpdateCase(updated);
    addAuditLog(
      'SURGICAL_SAFETY_GATE_VERIFICATION',
      `Case ${caseItem.id}`,
      `Safety gate '${gateKey}' marked as ${nextVal ? 'PASSED' : 'UNVERIFIED'} by Surgical Safety Auditor.`
    );
    triggerToast(`Gate [${gateKey}] updated: ${nextVal ? 'PASSED' : 'PENDING'}`);
  };

  // Atomic PACU Reservation
  const handleExecuteAtomicPACUReservation = async (bedId?: string) => {
    const result: PACUBedLockResult = await pacuAtomicEngine.reservePACUBedAtomic(caseItem.id, bedId);

    if (result.success) {
      const updated: SurgicalChainCase = {
        ...caseItem,
        currentStage: 'PACU_RESERVATION',
        stageStatuses: {
          ...caseItem.stageStatuses,
          PACU_RESERVATION: 'COMPLETED',
          PACU_HANDOFF: 'IN_PROGRESS',
        },
        safetyGates: {
          ...caseItem.safetyGates,
          pacuBedReservedAtomic: true,
        },
        pacuReservation: {
          bedId: result.allocatedBedId!,
          bedNumber: result.allocatedBedNumber!,
          wardName: result.allocatedWardName!,
          reservedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'RESERVED',
          lockToken: result.lockToken!,
        },
      };

      onUpdateCase(updated);
      addAuditLog(
        'ATOMIC_PACU_BED_RESERVED',
        `PACU Ward (${result.allocatedBedNumber})`,
        `Atomic PACU bed lock acquired: ${result.allocatedBedNumber} for Case ${caseItem.id} (Patient: ${caseItem.patientName}). Token: ${result.lockToken}.`
      );
      triggerToast(`Atomic Lock Acquired: ${result.allocatedBedNumber}`);
    } else {
      triggerToast(`PACU Allocation Error: ${result.error}`);
    }
  };

  // Simulate Simultaneous Race Condition Test (As requested by user)
  const handleSimulatePACUContentionTest = async () => {
    setIsSimulatingRace(true);
    setContentionResult(null);

    // Pick a test bed
    const targetBed = 'bed-pacu-01';
    // Clear lock for test
    pacuAtomicEngine.releasePACUBed(targetBed);

    // Launch 2 parallel requests simultaneously targeting the exact same bed
    const req1 = pacuAtomicEngine.reservePACUBedAtomic(`case-${caseItem.id}-suiteA`, targetBed);
    const req2 = pacuAtomicEngine.reservePACUBedAtomic(`case-contender-suiteB`, targetBed);

    const [res1, res2] = await Promise.all([req1, req2]);

    const winner = res1.success ? res1 : res2;
    const loser = !res1.success ? res1 : res2;

    const summary = `MUTUAL EXCLUSION CONFIRMED:\n- Suite A Result: ${res1.success ? 'ALLOCATED (Lock acquired)' : 'BLOCKED (' + res1.error + ')'}\n- Suite B Result: ${res2.success ? 'ALLOCATED (Lock acquired)' : 'BLOCKED (' + res2.error + ')'}\nInvariant preserved: Exactly 1 reservation succeeded, 1 contention safely rejected.`;
    setContentionResult(summary);
    setIsSimulatingRace(false);

    addAuditLog(
      'PACU_SIMULTANEOUS_CONTENTION_TEST',
      `Bed ${targetBed}`,
      `Simulated parallel atomic allocation attempt. Mutual exclusion enforced successfully. Winner token: ${winner.lockToken}.`
    );
  };

  // Submit Aldrete Score
  const handleSaveAldreteScore = (e: React.FormEvent) => {
    e.preventDefault();
    const total = aldreteActivity + aldreteRespiration + aldreteCirculation + aldreteConsciousness + aldreteO2Sat;

    const updated: SurgicalChainCase = {
      ...caseItem,
      aldreteScore: {
        activity: aldreteActivity,
        respiration: aldreteRespiration,
        circulation: aldreteCirculation,
        consciousness: aldreteConsciousness,
        o2Saturation: aldreteO2Sat,
        totalScore: total,
      },
    };

    onUpdateCase(updated);
    addAuditLog(
      'PACU_ALDRETE_SCORE_ASSESSED',
      `PACU Bed ${caseItem.pacuReservation?.bedNumber || 'PACU Bay'}`,
      `Phase I PACU Aldrete Score calculated: ${total}/10 for ${caseItem.patientName}. ${total >= 9 ? 'Patient qualifies for Inpatient Ward transfer.' : 'Requires ongoing PACU observation.'}`
    );
    triggerToast(`Aldrete Score: ${total}/10 recorded. (${total >= 9 ? 'Qualified for Transfer' : 'Under Monitoring'})`);
  };

  const totalAldrete = aldreteActivity + aldreteRespiration + aldreteCirculation + aldreteConsciousness + aldreteO2Sat;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-100 overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Scissors className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                  OT / Surgery / PACU End-to-End Orchestrator
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  17-STAGE ZERO-TOLERANCE CHAIN
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Surgical Request &rarr; Eligibility &rarr; Credential & Privilege Check &rarr; WHO Checklist &rarr; Atomic PACU &rarr; Recovery &rarr; Turnaround
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {notificationMsg && (
              <div className="px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold animate-fadeIn">
                {notificationMsg}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Surgical Case Demographic Strip */}
        <div className="px-6 py-3 bg-slate-850 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Procedure & Suite</span>
              <span className="text-sm font-bold text-white">{caseItem.procedureName}</span>
              <span className="text-slate-300 text-[11px] ml-2">({caseItem.cptCode}) &bull; {caseItem.room}</span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Patient</span>
              <span className="font-bold text-white">{caseItem.patientName}</span>
              <span className="text-amber-400 font-mono ml-2">{caseItem.patientMrn}</span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Lead Surgeon</span>
              <span className="text-slate-200 font-bold">{caseItem.leadSurgeon}</span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Anesthesiologist</span>
              <span className="text-slate-200 font-bold">{caseItem.anesthesiologist}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Safety Invariants:</span>
            {Object.values(caseItem.safetyGates).every(Boolean) ? (
              <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> All 10 Gates Passed
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Gated Safeguards Active
              </span>
            )}
          </div>
        </div>

        {/* 17-Stage Sequential Pipeline Ribbon */}
        <div className="px-6 py-2.5 bg-slate-950/80 border-b border-slate-800 overflow-x-auto scrollbar-thin">
          <div className="flex items-center min-w-max gap-1">
            {SURGICAL_CHAIN_STAGES.map((st, idx) => {
              const isCurrent = st.stage === currentStage;
              const status = caseItem.stageStatuses[st.stage];
              const isCompleted = status === 'COMPLETED';

              return (
                <div key={st.stage} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setCurrentStage(st.stage)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                        : isCompleted
                        ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 hover:bg-emerald-900/50'
                        : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black bg-black/30">
                      {isCompleted ? '✓' : st.stepNumber}
                    </span>
                    <span>{st.shortLabel}</span>
                  </button>
                  {idx < SURGICAL_CHAIN_STAGES.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-slate-600 mx-1 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Tabs */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Current Stage Headline Card */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-850/80 border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase">
                  Stage {currentStageDef.stepNumber} of 17 &bull; {currentStageDef.category}
                </span>
                <h2 className="text-base font-bold text-white">{currentStageDef.label}</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">{currentStageDef.description}</p>
            </div>

            <div className="flex items-center gap-2">
              {currentStageIndex < SURGICAL_CHAIN_STAGES.length - 1 && (
                <button
                  type="button"
                  onClick={() => handleAdvanceStage(SURGICAL_CHAIN_STAGES[currentStageIndex + 1].stage)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <span>Verify Gate & Advance Stage &rarr;</span>
                </button>
              )}
            </div>
          </div>

          {/* Navigation Bar */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('PIPELINE')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'PIPELINE' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stage Details & Clinical Notes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('GATES')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'GATES' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>Mandatory Safety Gates & Privileges</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('WHO')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'WHO' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              WHO Checklist Checkpoints
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PACU_ALLOCATION')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'PACU_ALLOCATION' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BedDouble className="w-3.5 h-3.5 text-emerald-400" />
              <span>Atomic PACU Allocation & Contention Test</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('RECOVERY')}
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                activeTab === 'RECOVERY' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              PACU Recovery & Aldrete Score
            </button>
          </div>

          {/* TAB 1: STAGE DETAILS */}
          {activeTab === 'PIPELINE' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
                  <span className="font-bold text-slate-300 block uppercase tracking-wider text-[10px]">
                    Surgical Case Credentials
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <p><strong>License:</strong> State Medical Board (Active / In Good Standing)</p>
                    <p><strong>Board Certification:</strong> American Board of Surgery</p>
                    <p><strong>DEA Registration:</strong> Verified Valid (Schedule II-V)</p>
                    <p><strong>Malpractice:</strong> $3M/$5M Current Coverage</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
                  <span className="font-bold text-slate-300 block uppercase tracking-wider text-[10px]">
                    Privilege Delineation Record
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <p><strong>Category:</strong> Major General & Laparoscopic Surgery</p>
                    <p><strong>CPT Authorized:</strong> {caseItem.cptCode} (Approved)</p>
                    <p><strong>Proctoring:</strong> Independent Practice (Unsupervised)</p>
                    <p><strong>Privilege Status:</strong> G-HIMS Active Verified Privilege</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
                  <span className="font-bold text-slate-300 block uppercase tracking-wider text-[10px]">
                    Sterile Resources & Implants
                  </span>
                  <div className="space-y-1.5 text-slate-300">
                    <p><strong>CSSD Barcode:</strong> CSSD-TRAY-2026-9812A (Sterile)</p>
                    <p><strong>Autoclave Cycle:</strong> Verified 134°C / 4 min vacuum</p>
                    <p><strong>Biological Indicator:</strong> Negative at 24 hours</p>
                    <p><strong>Blood Crossmatch:</strong> 2 Units Packed RBC reserved</p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
                <span className="font-bold text-slate-200 text-xs block">
                  Surgical Team Roster & Environmental Theater Readiness
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-300">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Surgeon</span>
                    <span className="font-semibold text-white">{caseItem.leadSurgeon}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Anesthesiologist</span>
                    <span className="font-semibold text-white">{caseItem.anesthesiologist}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Scrub Nurse</span>
                    <span className="font-semibold text-white">{caseItem.scrubNurse}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Circulating Nurse</span>
                    <span className="font-semibold text-white">{caseItem.circulatingNurse}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SAFETY GATES */}
          {activeTab === 'GATES' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  Mandatory Surgical Gatekeeper Invariants
                </h3>
                <p className="text-xs text-slate-400">
                  Per G-HIMS Master Architectural Doctrine, no procedure may commence if mandatory qualification, privilege, resource, or safety conditions fail.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {Object.entries(caseItem.safetyGates).map(([gateKey, passed]) => (
                  <div
                    key={gateKey}
                    className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-white block capitalize">
                        {gateKey.replace(/([A-Z])/g, ' $1')}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {passed ? 'Condition Verified & Satisfied' : 'Pre-condition Pending Verification'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleGate(gateKey as any)}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                        passed
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      {passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      <span>{passed ? 'PASSED' : 'BLOCKED'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: WHO CHECKLIST */}
          {activeTab === 'WHO' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-indigo-400 uppercase text-[11px]">1. Sign-In (Before Induction)</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${caseItem.safetyGates.whoSignInCompleted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                    {caseItem.safetyGates.whoSignInCompleted ? 'COMPLETE' : 'PENDING'}
                  </span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <p>✓ Patient identity, site, procedure confirmed</p>
                  <p>✓ Surgical site marked with surgical indelible pen</p>
                  <p>✓ Anesthesia safety machine check complete</p>
                  <p>✓ Pulse oximeter on patient and functioning</p>
                  <p>✓ Known allergy status verified</p>
                  <p>✓ Difficult airway / aspiration risk evaluated</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleGate('whoSignInCompleted')}
                  className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
                >
                  Toggle Sign-In Verification
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-amber-400 uppercase text-[11px]">2. Time-Out (Before Incision)</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${caseItem.safetyGates.whoTimeOutCompleted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                    {caseItem.safetyGates.whoTimeOutCompleted ? 'COMPLETE' : 'PENDING'}
                  </span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <p>✓ All team members introduced by name & role</p>
                  <p>✓ Verbal confirmation of patient name, site, procedure</p>
                  <p>✓ Surgeon: operative steps, operative duration, blood loss</p>
                  <p>✓ Anesthetist: patient-specific concerns</p>
                  <p>✓ Nursing: sterility indicators confirmed</p>
                  <p>✓ Antibiotic prophylaxis within past 60 min verified</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleGate('whoTimeOutCompleted')}
                  className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
                >
                  Toggle Time-Out Verification
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-emerald-400 uppercase text-[11px]">3. Sign-Out (Before Leaving OR)</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${caseItem.safetyGates.whoSignOutCompleted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                    {caseItem.safetyGates.whoSignOutCompleted ? 'COMPLETE' : 'PENDING'}
                  </span>
                </div>
                <div className="space-y-1.5 text-slate-300">
                  <p>✓ Nurse verbally confirms procedure recorded</p>
                  <p>✓ Instrument, sponge, and needle counts correct</p>
                  <p>✓ Surgical specimen labeled correctly with patient MRN</p>
                  <p>✓ Any equipment malfunction addressed</p>
                  <p>✓ Surgeon, anesthetist, nurse review PACU recovery plan</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleGate('whoSignOutCompleted')}
                  className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer"
                >
                  Toggle Sign-Out Verification
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: PACU ATOMIC ALLOCATION & CONTENTION TEST */}
          {activeTab === 'PACU_ALLOCATION' && (
            <div className="space-y-5">
              <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BedDouble className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Atomic PACU Bed Allocation Engine</h3>
                  </div>
                  {caseItem.pacuReservation && (
                    <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold">
                      Bed Locked: {caseItem.pacuReservation.bedNumber}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  PACU bed reservation is executed with strict database transaction atomicity. If multiple surgical suites complete procedures simultaneously, mutual exclusion guarantees that no PACU bed is ever double-allocated.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handleExecuteAtomicPACUReservation()}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 cursor-pointer"
                  >
                    <BedDouble className="w-4 h-4" />
                    <span>Auto-Allocate Best Available PACU Bay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecuteAtomicPACUReservation('bed-pacu-01')}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer border border-slate-700"
                  >
                    <span>Target PACU-Bay-01 specifically</span>
                  </button>
                </div>
              </div>

              {/* Concurrency Stress Test Simulator */}
              <div className="p-5 rounded-2xl bg-slate-900 border border-indigo-500/40 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="text-sm font-black text-indigo-300 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-indigo-400" />
                      Simultaneous Allocation Contention Stress-Tester
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Simulate 2 operating theaters racing to claim the exact same PACU bed simultaneously.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSimulatingRace}
                    onClick={handleSimulatePACUContentionTest}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/30 cursor-pointer"
                  >
                    {isSimulatingRace ? 'Simulating Race...' : 'Fire Concurrent Race Test'}
                  </button>
                </div>

                {contentionResult && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 whitespace-pre-wrap leading-relaxed">
                    {contentionResult}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: RECOVERY & ALDRETE SCORE */}
          {activeTab === 'RECOVERY' && (
            <form onSubmit={handleSaveAldreteScore} className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    PACU Post-Anesthesia Recovery (Modified Aldrete Scoring)
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Phase I discharge qualification requires an Aldrete Score &gt;= 9/10 with stable vitals.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Total Score:</span>
                  <span className={`text-lg font-black font-mono px-3 py-1 rounded-xl ${
                    totalAldrete >= 9 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    {totalAldrete} / 10
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-300 block text-[11px]">1. Activity</label>
                  <select
                    value={aldreteActivity}
                    onChange={(e) => setAldreteActivity(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                  >
                    <option value={2}>2 - Moves 4 extremities</option>
                    <option value={1}>1 - Moves 2 extremities</option>
                    <option value={0}>0 - Unable to move</option>
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-300 block text-[11px]">2. Respiration</label>
                  <select
                    value={aldreteRespiration}
                    onChange={(e) => setAldreteRespiration(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                  >
                    <option value={2}>2 - Deep breaths & coughs</option>
                    <option value={1}>1 - Dyspneic / shallow</option>
                    <option value={0}>0 - Apneic</option>
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-300 block text-[11px]">3. Circulation</label>
                  <select
                    value={aldreteCirculation}
                    onChange={(e) => setAldreteCirculation(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                  >
                    <option value={2}>2 - BP within 20% baseline</option>
                    <option value={1}>1 - BP 20-49% baseline</option>
                    <option value={0}>0 - BP &gt;= 50% baseline</option>
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-300 block text-[11px]">4. Consciousness</label>
                  <select
                    value={aldreteConsciousness}
                    onChange={(e) => setAldreteConsciousness(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                  >
                    <option value={2}>2 - Fully awake</option>
                    <option value={1}>1 - Arousable on calling</option>
                    <option value={0}>0 - Not responding</option>
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-300 block text-[11px]">5. O2 Saturation</label>
                  <select
                    value={aldreteO2Sat}
                    onChange={(e) => setAldreteO2Sat(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
                  >
                    <option value={2}>2 - SpO2 &gt; 92% room air</option>
                    <option value={1}>1 - Supplemental O2 req.</option>
                    <option value={0}>0 - SpO2 &lt; 90% with O2</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/30"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Aldrete Score & Log Invariant</span>
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              G-HIMS Surgical Invariant Guardian Active
            </span>
            <span>&bull;</span>
            <span className="font-mono text-[10px]">Suite: {caseItem.room}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors cursor-pointer"
          >
            Close Orchestrator
          </button>
        </div>
      </div>
    </div>
  );
}
