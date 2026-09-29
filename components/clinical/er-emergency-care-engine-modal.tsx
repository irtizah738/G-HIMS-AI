'use client';

import React, { useState } from 'react';
import {
  EDWorkflowStage,
  ED_WORKFLOW_STAGES,
  EDOptimizedCase,
} from '@/lib/types/emergency';
import { useHospital } from '@/lib/context/hospital-context';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  Zap,
  Activity,
  Heart,
  Flame,
  ShieldAlert,
  AlertTriangle,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  UserCheck,
  FileText,
  DollarSign,
  ArrowRight,
  Sparkles,
  Bed,
  Ambulance,
  PhoneCall,
  Plus,
  X,
  Stethoscope,
  TestTube2,
  Share2,
  Send,
} from 'lucide-react';

interface EDEmergencyEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
  edCase: EDOptimizedCase;
  onUpdateCase: (updatedCase: EDOptimizedCase) => void;
}

export function EDEmergencyEngineModal({
  isOpen,
  onClose,
  edCase,
  onUpdateCase,
}: EDEmergencyEngineModalProps) {
  const { addAuditLog, patients, beds } = useHospital();
  const [currentStage, setCurrentStage] = useState<EDWorkflowStage>(edCase.currentStage || 'TREATMENT');
  const [activeTab, setActiveTab] = useState<'WORKFLOW' | 'STAT_ORDERS' | 'DIAGNOSTICS' | 'TREATMENT' | 'SBAR' | 'DISPOSITION'>('WORKFLOW');

  // Override Dialogs
  const [showBreakGlassModal, setShowBreakGlassModal] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [showBillingBypassModal, setShowBillingBypassModal] = useState(false);
  const [billingBypassReason, setBillingBypassReason] = useState('');

  // SBAR form
  const [sbarHandoffTo, setSbarHandoffTo] = useState(edCase.sbar?.handoffToDoctor || '');
  const [sbarHandoffNotes, setSbarHandoffNotes] = useState(edCase.sbar?.handoffNotes || '');

  // STAT Order Form
  const [newOrderText, setNewOrderText] = useState('');
  const [newOrderType, setNewOrderType] = useState<'MEDICATION' | 'FLUID' | 'BLOOD' | 'IMAGING' | 'LAB'>('MEDICATION');

  // Treatment Form
  const [newTreatmentText, setNewTreatmentText] = useState('');

  // Reassessment Form
  const [reassessPain, setReassessPain] = useState<number>(5);
  const [reassessImpression, setReassessImpression] = useState('');

  // Disposition
  const [dispositionType, setDispositionType] = useState<string>('ADMIT_ICU');
  const [dispositionDestination, setDispositionDestination] = useState<string>('Cardiac ICU');
  const [selectedDispositionBedId, setSelectedDispositionBedId] = useState<string>('');

  // Alert Toast
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentStageIndex = ED_WORKFLOW_STAGES.findIndex((s) => s.key === currentStage);
  const currentStageDef = ED_WORKFLOW_STAGES[currentStageIndex] || ED_WORKFLOW_STAGES[0];

  const triggerAuditNotification = (msg: string) => {
    setStatusNotification(msg);
    setTimeout(() => setStatusNotification(null), 4000);
  };

  const handleStageAdvance = (nextStage: EDWorkflowStage) => {
    const updatedStages = {
      ...edCase.stageStatuses,
      [currentStage]: 'COMPLETED' as const,
      [nextStage]: 'IN_PROGRESS' as const,
    };

    const updated: EDOptimizedCase = {
      ...edCase,
      currentStage: nextStage,
      stageStatuses: updatedStages,
    };

    onUpdateCase(updated);
    setCurrentStage(nextStage);
    addAuditLog(
      'ED_WORKFLOW_STAGE_TRANSITION',
      `Patient ${edCase.mrn}`,
      `Advanced workflow from ${currentStage} to ${nextStage} for ${edCase.patientName} (Bay ${edCase.assignedBay}).`
    );
    triggerAuditNotification(`Advanced to stage: ${nextStage}`);
  };

  // Break-Glass Override Execution
  const handleConfirmBreakGlass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!breakGlassReason.trim()) return;

    const timestamp = new Date().toLocaleTimeString();
    const updated: EDOptimizedCase = {
      ...edCase,
      breakGlassActive: true,
      breakGlassReason: breakGlassReason.trim(),
      breakGlassAuthorizedBy: 'Dr. Sarah Jenkins (Attending)',
      breakGlassTimestamp: timestamp,
    };

    onUpdateCase(updated);
    setShowBreakGlassModal(false);
    setBreakGlassReason('');

    // Immutable Audit Log
    addAuditLog(
      'BREAK_GLASS_ACCESS_OVERRIDE',
      `Emergency Patient ${edCase.mrn}`,
      `EMERGENCY OVERRIDE: Break-glass authorized by Dr. Sarah Jenkins for ${edCase.patientName}. Justification: "${updated.breakGlassReason}". Unrestricted EMR access granted.`,
      'SECURITY_ALERT'
    );
    triggerAuditNotification('BREAK-GLASS ACTIVE: Auditable security override logged.');
  };

  // Emergency Billing Bypass Execution
  const handleConfirmBillingBypass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!billingBypassReason.trim()) return;

    const timestamp = new Date().toLocaleTimeString();
    const updated: EDOptimizedCase = {
      ...edCase,
      emergencyBillingBypassed: true,
      emergencyBillingBypassReason: billingBypassReason.trim(),
      emergencyBillingBypassAuthorizedBy: 'Dr. Sarah Jenkins (Attending)',
      emergencyBillingBypassTimestamp: timestamp,
    };

    onUpdateCase(updated);
    setShowBillingBypassModal(false);
    setBillingBypassReason('');

    // Immutable Audit Log
    addAuditLog(
      'EMERGENCY_BILLING_BYPASS',
      `Financial Ledger / Enc ${edCase.mrn}`,
      `EMTALA OVERRIDE: Emergency billing bypass authorized for ${edCase.patientName}. Upfront payment, copay, and insurance locks waived. Justification: "${updated.emergencyBillingBypassReason}".`,
      'WARNING'
    );
    triggerAuditNotification('BILLING BYPASS GRANTED: Emergency clinical care unblocked.');
  };

  // Resuscitation Trigger
  const handleToggleResuscitation = () => {
    const nextState = !edCase.resuscitationInitiated;
    const timestamp = new Date().toLocaleTimeString();
    const updated: EDOptimizedCase = {
      ...edCase,
      resuscitationInitiated: nextState,
      resuscitationTimestamp: nextState ? timestamp : undefined,
      esiLevel: 1,
    };

    onUpdateCase(updated);
    addAuditLog(
      'EMERGENCY_RESUSCITATION_PROTOCOL',
      `Trauma / Resus Bay ${edCase.assignedBay}`,
      `Code Resuscitation ${nextState ? 'ACTIVATED' : 'TERMINATED'} for ${edCase.patientName} (MRN: ${edCase.mrn}). Priority set to STAT ESI-1.`,
      nextState ? 'SECURITY_ALERT' : 'INFO'
    );
    triggerAuditNotification(nextState ? 'RESUSCITATION ACTIVATED: Code Team alerted' : 'Resuscitation protocol stood down.');
  };

  // Add STAT Order
  const handleAddStatOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderText.trim()) return;

    const newOrd = {
      id: `ord-stat-${Date.now()}`,
      type: newOrderType,
      description: newOrderText.trim(),
      orderedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      orderedBy: 'Dr. Sarah Jenkins',
      priority: 'STAT' as const,
      status: 'ADMINISTERED' as const,
      administeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updated: EDOptimizedCase = {
      ...edCase,
      statOrders: [newOrd, ...edCase.statOrders],
    };

    onUpdateCase(updated);
    setNewOrderText('');
    addAuditLog(
      'STAT_ORDER_EMERGENCY_DISPATCH',
      `Pharmacy / Diagnostics: ${edCase.mrn}`,
      `STAT Order placed & executed: [${newOrd.type}] ${newOrd.description} for ${edCase.patientName}.`
    );
    triggerAuditNotification(`STAT Order Dispatched: ${newOrd.description}`);
  };

  // Add Treatment
  const handleAddTreatment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTreatmentText.trim()) return;

    const newTx = {
      id: `tx-${Date.now()}`,
      action: newTreatmentText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      performedBy: 'Nurse John Davis, RN',
      outcome: 'Completed successfully, hemodynamic parameters monitored',
    };

    const updated: EDOptimizedCase = {
      ...edCase,
      treatments: [newTx, ...edCase.treatments],
    };

    onUpdateCase(updated);
    setNewTreatmentText('');
    addAuditLog(
      'ED_ACUTE_TREATMENT_LOGGED',
      `Bay ${edCase.assignedBay}`,
      `Acute treatment administered: ${newTx.action} by ${newTx.performedBy} on ${edCase.patientName}.`
    );
  };

  // Log Reassessment
  const handleLogReassessment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassessImpression.trim()) return;

    const newRe = {
      id: `re-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      clinician: 'Dr. Sarah Jenkins',
      vitalsSummary: `BP ${edCase.vitals.bp}, HR ${edCase.vitals.hr}, SpO2 ${edCase.vitals.spo2}%, Shock Index ${edCase.vitals.shockIndex}`,
      gcs: edCase.vitals.gcs,
      painScore: reassessPain,
      clinicalImpression: reassessImpression.trim(),
    };

    const updated: EDOptimizedCase = {
      ...edCase,
      reassessments: [newRe, ...edCase.reassessments],
    };

    onUpdateCase(updated);
    setReassessImpression('');
    addAuditLog(
      'ED_PATIENT_REASSESSMENT',
      `Patient ${edCase.mrn}`,
      `Clinical Reassessment recorded: Pain ${reassessPain}/10, Impression: "${newRe.clinicalImpression}".`
    );
    triggerAuditNotification('Reassessment saved to emergency record.');
  };

  // Save SBAR Handoff
  const handleSaveSbarHandoff = (e: React.FormEvent) => {
    e.preventDefault();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const updated: EDOptimizedCase = {
      ...edCase,
      sbar: {
        ...edCase.sbar,
        handoffFromDoctor: 'Dr. Sarah Jenkins (ED Attending)',
        handoffToDoctor: sbarHandoffTo || 'Accepting Physician',
        handoffTimestamp: timestamp,
        handoffNotes: sbarHandoffNotes,
      },
    };

    onUpdateCase(updated);
    addAuditLog(
      'PHYSICIAN_SBAR_HANDOFF',
      `Patient ${edCase.mrn}`,
      `Structured physician handoff from Dr. Sarah Jenkins to ${updated.sbar.handoffToDoctor}. SBAR notes: "${sbarHandoffNotes}".`,
      'INFO'
    );
    triggerAuditNotification(`Physician handoff completed to ${updated.sbar.handoffToDoctor}`);
  };

  const availableDispositionBeds = beds.filter(
    (candidate) => candidate.status === 'available' && !candidate.patientId
  );

  // Complete Disposition through the authoritative care-transition domain.
  const handleSaveDisposition = async (e: React.FormEvent) => {
    e.preventDefault();

    const patient =
      patients.find((candidate) => candidate.id === edCase.patientId) ||
      patients.find((candidate) => candidate.mrn === edCase.mrn);
    const patientId = edCase.patientId || patient?.id;
    const sourceEncounterId = edCase.encounterId || patient?.activeEncounterId;
    const requiresInpatientAdmission =
      dispositionType === 'ADMIT_ICU' || dispositionType === 'ADMIT_WARD';

    let authoritativeDestination = dispositionDestination;

    if (requiresInpatientAdmission) {
      if (!patientId || !sourceEncounterId) {
        throw new Error(
          'ED_AUTHORITATIVE_LINK_REQUIRED: emergency admission requires patient and source encounter identity.'
        );
      }
      if (!selectedDispositionBedId) {
        throw new Error('TARGET_BED_REQUIRED: select an authoritative available inpatient bed.');
      }

      const targetBed = availableDispositionBeds.find(
        (candidate) => candidate.id === selectedDispositionBedId
      );
      if (!targetBed) {
        throw new Error('BED_UNAVAILABLE: selected inpatient bed is no longer available.');
      }

      const admissionResult = await executeActiveTenantCommand<{
        encounter: { encounterId: string };
      }>(
        'AdmitPatientToInpatientCareCommand',
        {
          patientId,
          bedId: targetBed.id,
          sourceEncounterId,
          admittingDiagnosis: edCase.chiefComplaint,
          targetWard: targetBed.ward,
          assignedDoctor: edCase.attendingPhysician,
          priority: edCase.esiLevel <= 2 ? 'STAT' : 'URGENT',
        },
        { idempotencyKey: `ed-ipd-admission:${sourceEncounterId}` }
      );

      if (!admissionResult.success) {
        throw new Error(
          admissionResult.error?.message || 'Emergency inpatient admission failed.'
        );
      }

      authoritativeDestination = `${targetBed.ward} — ${targetBed.bedNumber}`;
    } else if (sourceEncounterId) {
      const dispositionTypeForEncounter =
        dispositionType === 'TRANSFER_EXTERNAL'
          ? 'EXTERNAL_REFERRAL'
          : dispositionType === 'DISCHARGE_HOME'
            ? 'DISCHARGED_HOME'
            : 'EMERGENCY_TRANSFER';

      const dispositionResult = await executeActiveTenantCommand(
        'CommitEncounterDispositionCommand',
        {
          encounterId: sourceEncounterId,
          dispositionType: dispositionTypeForEncounter,
          patientInstructions:
            dispositionType === 'DISCHARGE_HOME'
              ? edCase.disposition?.dischargeInstructions || 'Emergency safety-net instructions provided.'
              : undefined,
        },
        { idempotencyKey: `ed-disposition:${sourceEncounterId}:${dispositionType}` }
      );

      if (!dispositionResult.success) {
        throw new Error(
          dispositionResult.error?.message || 'Emergency disposition could not be committed.'
        );
      }
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updated: EDOptimizedCase = {
      ...edCase,
      patientId,
      encounterId: sourceEncounterId,
      currentStage: 'DISPOSITION',
      stageStatuses: {
        ...edCase.stageStatuses,
        DISPOSITION: 'COMPLETED',
      },
      disposition: {
        type: dispositionType as any,
        destinationBedOrFacility: authoritativeDestination,
        authorizedBy: 'Authenticated Emergency Clinician',
        decidedAt: timestamp,
        transportMode: 'STAT Critical Care Transport Team',
      },
    };

    onUpdateCase(updated);
    addAuditLog(
      'ED_DEFINITIVE_DISPOSITION',
      `Patient ${edCase.mrn}`,
      `Definitive ED disposition committed: ${dispositionType} to ${authoritativeDestination}.`
    );
    triggerAuditNotification(
      `Disposition finalized: ${dispositionType} (${authoritativeDestination})`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl text-slate-100 overflow-hidden">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-400">
              <Zap className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                  Emergency Department Care Engine
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40">
                  STAT HIGH-VELOCITY RUNTIME
                </span>
              </div>
              <p className="text-xs text-slate-400">
                10-Stage Sequential Emergency Protocol &bull; Zero-Delay Life Saving Overrides &bull; Full Regulatory Audit Trail
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Notification Toast */}
            {statusNotification && (
              <div className="px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold animate-fadeIn">
                {statusNotification}
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

        {/* Patient Identity & Critical Emergency Strip */}
        <div className="px-6 py-3 bg-slate-850 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Patient</span>
              <span className="text-sm font-bold text-white">{edCase.patientName}</span>
              <span className="text-[11px] text-slate-400 ml-1.5">({edCase.age}y / {edCase.gender})</span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">MRN & Bay</span>
              <span className="font-mono text-amber-400 font-bold">{edCase.mrn}</span>
              <span className="text-slate-300 font-semibold ml-2">Bay: {edCase.assignedBay}</span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Acuity Stratum</span>
              <span className="inline-flex items-center gap-1 font-black text-xs px-2 py-0.5 rounded bg-rose-600 text-white">
                ESI Level {edCase.esiLevel} (Resuscitation)
              </span>
            </div>
            <div className="border-l border-slate-700/80 pl-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Attending Clinician</span>
              <span className="text-slate-200 font-bold">{edCase.attendingPhysician}</span>
            </div>
          </div>

          {/* Rapid Override Switches */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Break-Glass */}
            <button
              type="button"
              onClick={() => setShowBreakGlassModal(true)}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                edCase.breakGlassActive
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
              title="Break-glass unconsented clinical record access override"
            >
              {edCase.breakGlassActive ? <Unlock className="w-3.5 h-3.5 text-rose-400" /> : <Lock className="w-3.5 h-3.5" />}
              <span>{edCase.breakGlassActive ? 'Break-Glass ACTIVE' : 'Break-Glass Override'}</span>
            </button>

            {/* Emergency Billing Bypass */}
            <button
              type="button"
              onClick={() => setShowBillingBypassModal(true)}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                edCase.emergencyBillingBypassed
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
              title="Waive upfront co-pay, pre-auth, and financial barriers per EMTALA"
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>{edCase.emergencyBillingBypassed ? 'Billing Bypassed' : 'Bypass Billing (EMTALA)'}</span>
            </button>

            {/* Resuscitation Protocol Toggle */}
            <button
              type="button"
              onClick={handleToggleResuscitation}
              className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer ${
                edCase.resuscitationInitiated
                  ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                  : 'bg-slate-800 hover:bg-rose-900 text-rose-300 border border-rose-800/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{edCase.resuscitationInitiated ? 'RESUSCITATION ACTIVE' : 'Initiate Resuscitation'}</span>
            </button>
          </div>
        </div>

        {/* 10-Stage Sequential Workflow Pipeline Track */}
        <div className="px-6 py-2.5 bg-slate-950/80 border-b border-slate-800 overflow-x-auto scrollbar-thin">
          <div className="flex items-center min-w-max gap-1">
            {ED_WORKFLOW_STAGES.map((st, idx) => {
              const isCurrent = st.key === currentStage;
              const status = edCase.stageStatuses[st.key];
              const isCompleted = status === 'COMPLETED';

              return (
                <div key={st.key} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setCurrentStage(st.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                        : isCompleted
                        ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 hover:bg-emerald-900/50'
                        : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black bg-black/30">
                      {isCompleted ? '✓' : st.step}
                    </span>
                    <span>{st.shortLabel}</span>
                  </button>
                  {idx < ED_WORKFLOW_STAGES.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-slate-600 mx-1 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Middle Navigation Tabs & Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Stage Overview Banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-850/80 border border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase">
                  Stage {currentStageDef.step} of 10 &bull; {currentStageDef.category}
                </span>
                <h2 className="text-base font-bold text-white">{currentStageDef.label}</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">{currentStageDef.description}</p>
            </div>

            <div className="flex items-center gap-2">
              {currentStageIndex < ED_WORKFLOW_STAGES.length - 1 && (
                <button
                  type="button"
                  onClick={() => handleStageAdvance(ED_WORKFLOW_STAGES[currentStageIndex + 1].key)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <span>Mark Complete & Advance &rarr;</span>
                </button>
              )}
            </div>
          </div>

          {/* Action Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('WORKFLOW')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'WORKFLOW' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stage Details & Vitals
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('STAT_ORDERS')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                activeTab === 'STAT_ORDERS' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>STAT Orders ({edCase.statOrders.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DIAGNOSTICS')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                activeTab === 'DIAGNOSTICS' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Diagnostics ({edCase.diagnostics.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TREATMENT')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                activeTab === 'TREATMENT' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Treatments ({edCase.treatments.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SBAR')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                activeTab === 'SBAR' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>SBAR Handoff</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DISPOSITION')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                activeTab === 'DISPOSITION' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Disposition Decision</span>
            </button>
          </div>

          {/* TAB 1: WORKFLOW & TELEMETRY */}
          {activeTab === 'WORKFLOW' && (
            <div className="space-y-6">
              {/* Telemetry Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Heart Rate</span>
                  <span className="text-xl font-black text-rose-400 font-mono mt-0.5 block">{edCase.vitals.hr}</span>
                  <span className="text-[10px] text-slate-500">bpm</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Blood Pressure</span>
                  <span className="text-xl font-black text-amber-400 font-mono mt-0.5 block">{edCase.vitals.bp}</span>
                  <span className="text-[10px] text-slate-500">mmHg</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">SpO2 Oxygen</span>
                  <span className="text-xl font-black text-emerald-400 font-mono mt-0.5 block">{edCase.vitals.spo2}%</span>
                  <span className="text-[10px] text-slate-500">Non-rebreather</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Resp Rate</span>
                  <span className="text-xl font-black text-blue-400 font-mono mt-0.5 block">{edCase.vitals.rr}</span>
                  <span className="text-[10px] text-slate-500">breaths/min</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Temperature</span>
                  <span className="text-xl font-black text-slate-200 font-mono mt-0.5 block">{edCase.vitals.tempC}°C</span>
                  <span className="text-[10px] text-slate-500">Normothermic</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Glasgow Coma</span>
                  <span className="text-xl font-black text-purple-400 font-mono mt-0.5 block">GCS {edCase.vitals.gcs}</span>
                  <span className="text-[10px] text-slate-500">/ 15</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Shock Index</span>
                  <span className="text-xl font-black text-rose-500 font-mono mt-0.5 block">{edCase.vitals.shockIndex}</span>
                  <span className="text-[10px] text-rose-400 font-bold">&gt; 0.9 High Risk</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">MEWS Score</span>
                  <span className="text-xl font-black text-amber-400 font-mono mt-0.5 block">{edCase.vitals.mewsScore}</span>
                  <span className="text-[10px] text-slate-500">Critical Esc</span>
                </div>
              </div>

              {/* Chief Complaint & Clinical Presentation */}
              <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  Chief Complaint & Emergency Mechanism
                </span>
                <p className="text-sm font-semibold text-slate-200 leading-relaxed">
                  {edCase.chiefComplaint}
                </p>
              </div>

              {/* Reassessment Log Section */}
              <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    Continuous Emergency Reassessment Log
                  </h3>
                  <span className="text-xs text-slate-400">
                    {edCase.reassessments.length} recorded reassessments
                  </span>
                </div>

                {edCase.reassessments.map((re) => (
                  <div key={re.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-bold text-slate-200">{re.clinician} &bull; {re.timestamp}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono font-bold">
                        Pain: {re.painScore}/10 &bull; GCS: {re.gcs}
                      </span>
                    </div>
                    <p className="text-slate-300 font-medium">{re.clinicalImpression}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{re.vitalsSummary}</p>
                  </div>
                ))}

                {/* Add Reassessment Inline */}
                <form onSubmit={handleLogReassessment} className="pt-2 border-t border-slate-800 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 font-semibold block mb-1">
                        Patient Pain Score (0-10)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={reassessPain}
                        onChange={(e) => setReassessPain(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                        <span>0 (None)</span>
                        <span className="font-bold text-indigo-400">{reassessPain} / 10</span>
                        <span>10 (Worst)</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 font-semibold block mb-1">
                        Clinical Response & Vital Trend Impression
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Pain improving with analgesia; SpO2 stable on nasal cannula..."
                        value={reassessImpression}
                        onChange={(e) => setReassessImpression(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Record Reassessment</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: STAT ORDERS */}
          {activeTab === 'STAT_ORDERS' && (
            <div className="space-y-4">
              <form onSubmit={handleAddStatOrder} className="p-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-slate-300 block">
                  STAT Emergency Order Entry (Zero-Delay CPOE)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Type</label>
                    <select
                      value={newOrderType}
                      onChange={(e) => setNewOrderType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      <option value="MEDICATION">STAT Medication</option>
                      <option value="FLUID">Intravenous Fluid</option>
                      <option value="BLOOD">Blood Product (MTP)</option>
                      <option value="IMAGING">Emergency Imaging</option>
                      <option value="LAB">Point-of-Care Lab</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Order Directives</label>
                    <input
                      type="text"
                      placeholder="e.g. Fentanyl 50 mcg IV STAT, or Normal Saline 1L bolus..."
                      value={newOrderText}
                      onChange={(e) => setNewOrderText(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/30 cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Dispatch STAT</span>
                    </button>
                  </div>
                </div>
              </form>

              {/* Order List */}
              <div className="space-y-2">
                {edCase.statOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          {ord.priority}
                        </span>
                        <span className="font-bold text-white">{ord.description}</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Ordered by {ord.orderedBy} at {ord.orderedAt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        {ord.status} ({ord.administeredAt || 'Just now'})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: DIAGNOSTICS */}
          {activeTab === 'DIAGNOSTICS' && (
            <div className="space-y-3">
              {edCase.diagnostics.map((diag) => (
                <div
                  key={diag.id}
                  className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TestTube2 className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-white text-sm">{diag.name}</span>
                      <span className="text-[10px] text-slate-400">({diag.category})</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                        diag.status === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {diag.status}
                    </span>
                  </div>

                  {diag.resultSummary && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-750 font-mono text-slate-200">
                      {diag.resultSummary}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Ordered: {diag.orderedAt}</span>
                    <span>Resulted: {diag.resultedAt || 'Pending'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 4: TREATMENT */}
          {activeTab === 'TREATMENT' && (
            <div className="space-y-4">
              <form onSubmit={handleAddTreatment} className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex gap-3">
                <input
                  type="text"
                  placeholder="Record immediate acute intervention (e.g. Endotracheal intubation, Defibrillation 200J, Chest tube insertion)..."
                  value={newTreatmentText}
                  onChange={(e) => setNewTreatmentText(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Log Treatment</span>
                </button>
              </form>

              <div className="space-y-2">
                {edCase.treatments.map((tx) => (
                  <div key={tx.id} className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-bold text-white text-sm">{tx.action}</span>
                      <span className="font-mono text-[10px] text-slate-400">{tx.timestamp}</span>
                    </div>
                    <p className="text-slate-300">{tx.outcome}</p>
                    <p className="text-[11px] text-slate-500 font-medium">Logged by {tx.performedBy}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: SBAR HANDOFF */}
          {activeTab === 'SBAR' && (
            <form onSubmit={handleSaveSbarHandoff} className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-indigo-400" />
                    Structured SBAR Emergency Physician Handoff
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Situation, Background, Assessment, Recommendation verified for seamless transition
                  </p>
                </div>
                {edCase.sbar.handoffTimestamp && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                    Handoff Recorded: {edCase.sbar.handoffTimestamp}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-black text-rose-400 text-xs uppercase tracking-wider block">
                    [S] Situation
                  </span>
                  <p className="text-slate-200 font-medium">{edCase.sbar.situation}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-black text-amber-400 text-xs uppercase tracking-wider block">
                    [B] Background
                  </span>
                  <p className="text-slate-200 font-medium">{edCase.sbar.background}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-black text-blue-400 text-xs uppercase tracking-wider block">
                    [A] Assessment
                  </span>
                  <p className="text-slate-200 font-medium">{edCase.sbar.assessment}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-black text-emerald-400 text-xs uppercase tracking-wider block">
                    [R] Recommendation
                  </span>
                  <p className="text-slate-200 font-medium">{edCase.sbar.recommendation}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800">
                <div>
                  <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">
                    Accepting Specialist / Inpatient Physician
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. Marcus Vance (Interventional Cardiology)"
                    value={sbarHandoffTo}
                    onChange={(e) => setSbarHandoffTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">
                    Verbal Handoff Notes & Critical Closed-Loop Agreement
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Verbal report given in person; Cath Lab team scrubbed and ready."
                    value={sbarHandoffNotes}
                    onChange={(e) => setSbarHandoffNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/30"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Sign Off SBAR Handoff</span>
              </button>
            </form>
          )}

          {/* TAB 6: DISPOSITION */}
          {activeTab === 'DISPOSITION' && (
            <form onSubmit={handleSaveDisposition} className="p-5 rounded-2xl bg-slate-850 border border-slate-800 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Send className="w-4 h-4 text-emerald-400" />
                    Definitive Emergency Disposition Order
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Direct Admission, Urgent Surgery, Critical Care Transfer, or Discharge
                  </p>
                </div>
                {edCase.disposition && (
                  <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                    Disposition Complete: {edCase.disposition.type}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                    Disposition Route
                  </label>
                  <select
                    value={dispositionType}
                    onChange={(e) => setDispositionType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                  >
                    <option value="ADMIT_ICU">Direct Admission to Intensive Care Unit (ICU)</option>
                    <option value="EMERGENCY_OR">Immediate Emergency Operating Theater (OR)</option>
                    <option value="ADMIT_WARD">Inpatient Ward Admission (Telemetry / Step-down)</option>
                    <option value="TRANSFER_EXTERNAL">External Tertiary Facility Transfer</option>
                    <option value="DISCHARGE_HOME">Emergency Discharge with Safety-Net Follow-up</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                    {dispositionType === 'ADMIT_ICU' || dispositionType === 'ADMIT_WARD'
                      ? 'Authoritative Available Bed'
                      : 'Destination Unit / Facility'}
                  </label>
                  {dispositionType === 'ADMIT_ICU' || dispositionType === 'ADMIT_WARD' ? (
                    <select
                      required
                      value={selectedDispositionBedId}
                      onChange={(e) => setSelectedDispositionBedId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      <option value="">Select available bed...</option>
                      {availableDispositionBeds.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.ward} — {candidate.bedNumber} ({candidate.id})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={dispositionDestination}
                      onChange={(e) => setDispositionDestination(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                    />
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-slate-300">
                <span className="font-bold text-white text-xs block">Quality & Safety Invariants Verified:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Continuous vitals telemetry stable during transfer</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Critical diagnostics reported to accepting physician</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Emergency overrides logged to immutable security ledger</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Receiving bed confirmed and nurse-to-nurse report complete</span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Execute Final Emergency Disposition</span>
              </button>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-300">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              G-HIMS Emergency Engine active
            </span>
            <span>&bull;</span>
            <span className="font-mono text-[10px]">Case ID: {edCase.id}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors cursor-pointer"
          >
            Close Engine
          </button>
        </div>
      </div>

      {/* Break-Glass Authorization Modal */}
      {showBreakGlassModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <form
            onSubmit={handleConfirmBreakGlass}
            className="w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-rose-500/50 shadow-2xl text-slate-100 space-y-4"
          >
            <div className="flex items-center gap-3 text-rose-400">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
              <h3 className="text-base font-black text-white">Break-Glass Emergency Access</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              You are requesting immediate, unconsented access to protected health information for emergency patient{' '}
              <strong>{edCase.patientName}</strong>. This override is audited and permanently reported to the hospital privacy compliance committee.
            </p>
            <div>
              <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">
                Clinical Justification (Mandatory)
              </label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Unconscious patient with acute STEMI requiring emergency surgical history & allergy verification..."
                value={breakGlassReason}
                onChange={(e) => setBreakGlassReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBreakGlassModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-rose-600/30"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Authorize Break-Glass</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Emergency Billing Bypass Modal */}
      {showBillingBypassModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <form
            onSubmit={handleConfirmBillingBypass}
            className="w-full max-w-md p-6 rounded-3xl bg-slate-900 border border-amber-500/50 shadow-2xl text-slate-100 space-y-4"
          >
            <div className="flex items-center gap-3 text-amber-400">
              <DollarSign className="w-6 h-6" />
              <h3 className="text-base font-black text-white">Emergency Billing Bypass (EMTALA)</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Federal EMTALA mandates that emergency stabilization must never be delayed by financial clearance, copay collection, or insurance pre-authorization.
            </p>
            <div>
              <label className="text-[11px] text-slate-400 font-bold uppercase block mb-1">
                Clinical Justification for Financial Waiver
              </label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Immediate emergent cardiac catheterization / trauma surgery required for life-threatening condition..."
                value={billingBypassReason}
                onChange={(e) => setBillingBypassReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBillingBypassModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-600/30"
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>Confirm Billing Bypass</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
