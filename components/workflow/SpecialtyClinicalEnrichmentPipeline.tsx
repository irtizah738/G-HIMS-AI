'use client';

import React, { useState, useMemo } from 'react';
import {
  ClinicalSpecialty,
  LongitudinalEncounterRecord,
  SpecialInvestigationItem,
  ReconciledMedicationItem,
  ClinicalRoutingDecision,
  CardiologyStructuredIntake,
} from '@/types/specialty-clinical-workflow';
import { SpecialtyWorkflowEngine } from '@/lib/clinical/workflow/specialty-workflow-engine';
import {
  HeartPulse,
  Stethoscope,
  Activity,
  ClipboardList,
  UserCheck,
  FileCheck2,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Clock,
  Pill,
  FlaskConical,
  Flame,
  CheckCircle2,
  Send,
  Zap,
  RotateCcw,
  Sliders,
  ChevronRight,
  TrendingUp,
  GitFork,
  Radio,
  FileText,
  BadgeAlert,
  Layers,
  Thermometer,
  Eye,
  Crosshair,
  Calendar,
  Building,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function SpecialtyClinicalEnrichmentPipeline() {
  // State for active encounter record
  const [selectedEncounterType, setSelectedEncounterType] = useState<'cardio' | 'pulm'>('cardio');
  const [encounter, setEncounter] = useState<LongitudinalEncounterRecord>(() =>
    SpecialtyWorkflowEngine.createInitialDemoEncounter()
  );

  // Active Stage in the Enrichment Pipeline
  const [activeStageIndex, setActiveStageIndex] = useState<number>(3); // 0=Triage, 1=General/MO, 2=Specialty Intake, 3=Consultant Specialist, 4=Longitudinal & Routing

  // Memoized cardiology intake
  const cardioIntake = encounter.specialtyIntake?.specialty === 'CARDIOLOGY' ? (encounter.specialtyIntake as CardiologyStructuredIntake) : null;

  // Toast / notification feedback
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type: 'success' | 'info' | 'alert' } | null>(null);

  // AI Generation loading state
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  // Trigger toast helper
  const triggerToast = (message: string, type: 'success' | 'info' | 'alert' = 'success') => {
    setFeedbackToast({ message, type });
    setTimeout(() => setFeedbackToast(null), 4500);
  };

  // Switch demo encounters
  const handleSwitchEncounter = (type: 'cardio' | 'pulm') => {
    setSelectedEncounterType(type);
    if (type === 'cardio') {
      setEncounter(SpecialtyWorkflowEngine.createInitialDemoEncounter());
      triggerToast('Loaded Longitudinal Cardiology Encounter for Tariq Mehmood (MRN-9124)');
    } else {
      setEncounter(SpecialtyWorkflowEngine.createPulmonologyDemoEncounter());
      triggerToast('Loaded Longitudinal Pulmonology Encounter for Khadija Bibi (MRN-3391)');
    }
  };

  // Stage 1: Update Vitals Handler
  const handleUpdateVitals = (field: string, value: any) => {
    if (!encounter.nursingTriage) return;
    setEncounter((prev) => {
      const updated = { ...prev };
      if (updated.nursingTriage) {
        updated.nursingTriage = {
          ...updated.nursingTriage,
          vitals: {
            ...updated.nursingTriage.vitals,
            [field]: value,
          },
        };
      }
      return updated;
    });
  };

  // Stage 3: Cardiology PQRST chest pain toggler
  const handleUpdateCardiacPqrst = (field: string, value: any) => {
    if (!encounter.specialtyIntake || encounter.specialtyIntake.specialty !== 'CARDIOLOGY') return;
    setEncounter((prev) => {
      const updated = { ...prev };
      if (updated.specialtyIntake && updated.specialtyIntake.specialty === 'CARDIOLOGY') {
        const cardioIntake = updated.specialtyIntake as CardiologyStructuredIntake;
        cardioIntake.symptoms.chestPain = {
          ...cardioIntake.symptoms.chestPain,
          [field]: value,
        };
      }
      return updated;
    });
  };

  // Stage 4: Add New Investigation Order
  const handleAddInvestigation = (modality: SpecialInvestigationItem['modality'], name: string, code: string) => {
    if (!encounter.consultantDocumentation) return;
    const invId = `inv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newItem: SpecialInvestigationItem = {
      id: invId,
      code,
      name,
      modality,
      indication: 'Specialist Workup & Diagnostic Rule-Out',
      urgency: 'URGENT',
      status: 'FINALIZED',
      orderedAt: Date.now(),
      resultSummary: 'STAT Worklist Dispatched; Baseline telemetry captured.',
      criticalAlert: false,
    };

    setEncounter((prev) => {
      if (!prev.consultantDocumentation) return prev;
      const currentInvestigations = prev.consultantDocumentation.specialInvestigations || [];
      // Prevent duplicates if already present
      if (currentInvestigations.some((item) => item.id === invId)) {
        return prev;
      }
      const updatedConsultantDoc = {
        ...prev.consultantDocumentation,
        specialInvestigations: [...currentInvestigations, newItem],
      };
      const updatedEvents = [
        ...prev.lifecycleEvents,
        {
          eventId: `evt-${invId}`,
          eventType: 'clinical.special_investigation.ordered',
          stageName: 'Consultant Specialist',
          timestamp: Date.now(),
          actor: prev.consultantDocumentation?.soap.consultantName || 'Attending Specialist',
          summary: `Ordered special investigation: ${name} (${code})`,
        },
      ];
      return {
        ...prev,
        consultantDocumentation: updatedConsultantDoc,
        lifecycleEvents: updatedEvents,
      };
    });

    triggerToast(`Added Special Investigation: ${name}`);
  };

  // Stage 4: AI Copilot SOAP Generator
  const handleAiGenerateSoap = () => {
    setIsAiGenerating(true);
    setTimeout(() => {
      setIsAiGenerating(false);
      setEncounter((prev) => {
        if (!prev.consultantDocumentation) return prev;
        return {
          ...prev,
          consultantDocumentation: {
            ...prev.consultantDocumentation,
            soap: {
              ...prev.consultantDocumentation.soap,
              assessment: `[AI-Synthesized Evidence Protocol]\n1. Unstable Angina / Intermediate-to-High Risk NSTE-ACS (ICD-10 I20.0) in patient with prior LAD stent.\n2. Suboptimally controlled Essential Hypertension (I10) and Mixed Dyslipidemia.\n3. Dynamic lateral ST changes with mildly elevated hs-cTnI (0.042 ng/mL) warrants urgent coronary angiographic re-evaluation.`,
              plan: `[AI-Assisted Multi-Disciplinary Action Plan]\n1. Urgent diagnostic coronary angiogram & PCI readiness in Cath Lab.\n2. Dual antiplatelet therapy switch to Ticagrelor 90mg BID (Loading 180mg).\n3. Titrate Metoprolol to 50mg daily & Atorvastatin 80mg QHS.\n4. Close telemetry in CCU with cardiac rehabilitation post-discharge.`,
            },
          },
        };
      });
      triggerToast('AI Clinical Copilot successfully synthesized structured SOAP documentation.', 'info');
    }, 900);
  };

  // Stage 4: Medication Reconciliation Action Toggler
  const handleUpdateMedAction = (medId: string, action: ReconciledMedicationItem['reconciliationAction']) => {
    setEncounter((prev) => {
      if (!prev.consultantDocumentation) return prev;
      return {
        ...prev,
        consultantDocumentation: {
          ...prev.consultantDocumentation,
          medications: prev.consultantDocumentation.medications.map((m) =>
            m.id === medId ? { ...m, reconciliationAction: action } : m
          ),
        },
      };
    });
    triggerToast(`Updated Medication Action to: ${action}`);
  };

  // Stage 4: Route Patient Decision
  const handleExecuteRouting = (decision: ClinicalRoutingDecision['destinationType'], deptName: string, priority: 'ROUTINE' | 'PRIORITY' | 'STAT_EMERGENCY') => {
    setEncounter((prev) => {
      const newRouting: ClinicalRoutingDecision = {
        destinationType: decision,
        targetDepartment: deptName,
        targetSpecialistName: prev.consultantDocumentation?.soap.consultantName,
        routingPriority: priority,
        clinicalHandoffSummary: `Patient routed to ${deptName} with priority ${priority}. Immediate clinical handoff acknowledged.`,
        routedAt: Date.now(),
        routedBy: prev.consultantDocumentation?.soap.consultantName || 'Consultant Specialist',
      };
      const updatedConsultantDoc = prev.consultantDocumentation
        ? { ...prev.consultantDocumentation, routing: newRouting }
        : undefined;

      const eventId = `evt-route-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const updatedEvents = [
        ...prev.lifecycleEvents,
        {
          eventId,
          eventType: `clinical.patient_routed.${decision.toLowerCase()}`,
          stageName: 'Clinical Routing',
          timestamp: Date.now(),
          actor: newRouting.routedBy,
          summary: newRouting.clinicalHandoffSummary,
        },
      ];

      return {
        ...prev,
        consultantDocumentation: updatedConsultantDoc,
        currentWorkflowStage: 'ROUTING_COMPLETED',
        lifecycleEvents: updatedEvents,
      };
    });
    triggerToast(`Patient successfully routed to ${deptName} (${priority})!`);
  };

  // Stage Navigation Headers
  const STAGES_META = [
    {
      id: 'TRIAGE',
      index: 0,
      name: '1. Nursing Care / Triage',
      badge: 'Nurse Intake',
      icon: Activity,
      desc: 'General history, vital signs & NEWS2 risk score',
    },
    {
      id: 'MO_ASSESSMENT',
      index: 1,
      name: '2. General Assessment',
      badge: 'Medical Officer',
      icon: Stethoscope,
      desc: 'Comprehensive history, ROS & baseline labs',
    },
    {
      id: 'SPECIALTY_INTAKE',
      index: 2,
      name: '3. Disease-Centric Intake',
      badge: encounter.specialty,
      icon: HeartPulse,
      desc: 'Specialty-aware symptoms & disease schema',
    },
    {
      id: 'CONSULTANT_EVALUATION',
      index: 3,
      name: '4. Consultant Specialist',
      badge: 'Specialist MD',
      icon: UserCheck,
      desc: 'Investigations, SOAP, Lifestyle & Med Rec',
    },
    {
      id: 'LONGITUDINAL_ROUTING',
      index: 4,
      name: '5. Longitudinal & Routing',
      badge: 'Handoff & History',
      icon: GitFork,
      desc: 'Patient timeline, outbox events & department routing',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Toast Banner */}
      {feedbackToast && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold shadow-md animate-in fade-in slide-in-from-top-2 duration-200 ${
            feedbackToast.type === 'alert'
              ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : feedbackToast.type === 'info'
              ? 'bg-purple-50 dark:bg-purple-950/70 border-purple-300 dark:border-purple-800 text-purple-900 dark:text-purple-200'
              : 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedbackToast.message}</span>
          </div>
          <button
            onClick={() => setFeedbackToast(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Clinical Header & Specialty Switcher */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs shrink-0">
              <HeartPulse className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  G-HIMS Clinical Enrichment Pipeline
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 uppercase tracking-wider">
                  Specialty-Aware v2.4
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Active Encounter: {encounter.mrn}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Workflow-driven multi-stage clinical architecture with structured disease schemas, longitudinal timeline & deterministic event routing.
              </p>
            </div>
          </div>

          {/* Specialty Encounter Presets */}
          <div className="flex items-center gap-2 self-end lg:self-center">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 hidden sm:inline">Specialty Presets:</span>
            <button
              onClick={() => handleSwitchEncounter('cardio')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                selectedEncounterType === 'cardio'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <HeartPulse className="w-3.5 h-3.5" />
              Cardiology (Tariq M.)
            </button>
            <button
              onClick={() => handleSwitchEncounter('pulm')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                selectedEncounterType === 'pulm'
                  ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Pulmonology (Khadija B.)
            </button>
          </div>
        </div>

        {/* Patient Summary Card Strip */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Patient Legal Name</span>
            <span className="text-xs font-black text-slate-900 dark:text-white truncate block">{encounter.patientName}</span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Demographics</span>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{encounter.age} yrs • {encounter.gender}</span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Specialty</span>
            <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <Stethoscope className="w-3 h-3" />
              {encounter.specialty}
            </span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Triage Status</span>
            <span className={`text-xs font-black ${
              encounter.nursingTriage?.vitals.triageCategory === 'ORANGE_VERY_URGENT'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-yellow-600 dark:text-yellow-400'
            }`}>
              {encounter.nursingTriage?.vitals.triageCategory || 'YELLOW_URGENT'}
            </span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">NEWS2 Score</span>
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
              Score: {encounter.nursingTriage?.vitals.news2Score ?? 3} ({encounter.nursingTriage?.vitals.clinicalRisk || 'LOW'})
            </span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Workflow Progress</span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Stage {activeStageIndex + 1} of 5
            </span>
          </div>
        </div>
      </div>

      {/* 5-Stage Clinical Pipeline Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {STAGES_META.map((stg) => {
          const isCurrent = activeStageIndex === stg.index;
          const isPassed = activeStageIndex > stg.index;
          const Icon = stg.icon;

          return (
            <button
              key={stg.id}
              onClick={() => setActiveStageIndex(stg.index)}
              className={`p-3.5 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
                isCurrent
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-400/30'
                  : isPassed
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-slate-800 dark:text-slate-200 hover:bg-emerald-100/60'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${
                    isCurrent
                      ? 'bg-blue-700 text-blue-100'
                      : isPassed
                      ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {stg.badge}
                </span>
                {isPassed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <Icon className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-white' : 'text-slate-400'}`} />
                )}
              </div>

              <div>
                <h4 className={`text-xs font-black leading-tight ${isCurrent ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}>
                  {stg.name}
                </h4>
                <p className={`text-[11px] mt-1 line-clamp-1 ${isCurrent ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>
                  {stg.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Multi-Stage Workspace Content Panels */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs min-h-[500px]">
        {/* ========================================================================= */}
        {/* STAGE 1: NURSING CARE / TRIAGE */}
        {/* ========================================================================= */}
        {activeStageIndex === 0 && encounter.nursingTriage && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  Stage 1 Intake Module
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Nursing Care & Triage Assessment
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span>Assessed By: {encounter.nursingTriage.nurseName}</span>
              </div>
            </div>

            {/* Chief Complaint & Pain Scale */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Presenting Chief Complaint</label>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200">
                  {encounter.nursingTriage.chiefComplaint}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  <span>Duration: {encounter.nursingTriage.symptomDuration}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Pain Scale & Fall Risk
                </label>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Numeric Pain Rating:</span>
                    <span className="font-black text-rose-600 dark:text-rose-400">{encounter.nursingTriage.painScale} / 10 (Moderate)</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">GCS Scale (Glasgow Coma Scale):</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                      GCS {encounter.nursingTriage.glasgowComaScale} / 15 ({encounter.nursingTriage.consciousnessAvpu})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Vital Signs Grid with Real-time NEWS2 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Vital Signs Panel & Real-time NEWS2 Trigger
                </h4>
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  Calculated NEWS2: {encounter.nursingTriage.vitals.news2Score} ({encounter.nursingTriage.vitals.clinicalRisk} Risk)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Heart Rate</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {encounter.nursingTriage.vitals.heartRate}
                    </span>
                    <span className="text-[10px] text-slate-500">bpm</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Blood Pressure</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-black text-rose-600 dark:text-rose-400">
                      {encounter.nursingTriage.vitals.systolicBp}/{encounter.nursingTriage.vitals.diastolicBp}
                    </span>
                    <span className="text-[10px] text-slate-500">mmHg</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Respiratory Rate</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {encounter.nursingTriage.vitals.respiratoryRate}
                    </span>
                    <span className="text-[10px] text-slate-500">/min</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Temperature</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {encounter.nursingTriage.vitals.temperatureCelsius}
                    </span>
                    <span className="text-[10px] text-slate-500">°C</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Oxygen Saturation</span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-black text-sky-600 dark:text-sky-400">
                      {encounter.nursingTriage.vitals.spo2Percent}%
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {encounter.nursingTriage.vitals.onSupplementalOxygen ? 'O2 Supp' : 'Room Air'}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Triage Protocol</span>
                  <div className="mt-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      {encounter.nursingTriage.vitals.triageCategory}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Allergies & Red Flags */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/60 rounded-xl">
                <span className="text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center gap-1.5 mb-2">
                  <ShieldCheck className="w-4 h-4 text-rose-600" />
                  Known Allergies & Drug Adverse Reactions
                </span>
                <div className="space-y-1.5">
                  {encounter.nursingTriage.knownAllergies.map((alg, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 p-2 rounded-lg border border-rose-200 dark:border-rose-900">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{alg.allergen}</span>
                      <span className="text-slate-500">{alg.reaction}</span>
                      <span className="text-[10px] font-extrabold text-rose-600 uppercase">{alg.severity}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Active Clinical Red Flags & Alerts
                </span>
                <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                  {encounter.nursingTriage.redFlagAlerts.map((flag, idx) => (
                    <li key={idx} className="flex items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-lg border border-amber-200 dark:border-amber-900">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Advance to Stage 2 CTA */}
            <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => {
                  setActiveStageIndex(1);
                  triggerToast('Advanced to Stage 2: General Assessment & MO Intake');
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-sm flex items-center gap-2 transition-all"
              >
                Proceed to Stage 2: General Assessment (MO Intake)
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 2: GENERAL ASSESSMENT / MO INTAKE */}
        {/* ========================================================================= */}
        {activeStageIndex === 1 && encounter.generalAssessment && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  Stage 2 Assessment Module
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Medical Officer Comprehensive Intake
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Stethoscope className="w-3.5 h-3.5" />
                <span>Assessed By: {encounter.generalAssessment.moName}</span>
              </div>
            </div>

            {/* HPI Box */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                History of Present Illness (HPI)
              </label>
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-mono">
                {encounter.generalAssessment.historyOfPresentIllness}
              </div>
            </div>

            {/* PMHx, PSHx, Social History Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Past Medical History</span>
                <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-300 list-disc list-inside">
                  {encounter.generalAssessment.pastMedicalHistory.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Past Surgical History</span>
                <ul className="text-xs space-y-1 text-slate-600 dark:text-slate-300 list-disc list-inside">
                  {encounter.generalAssessment.pastSurgicalHistory.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">Social History</span>
                <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
                  <p><strong>Smoking:</strong> {encounter.generalAssessment.socialHistory.smokingStatus} ({encounter.generalAssessment.socialHistory.packYears || 0} pack-years)</p>
                  <p><strong>Alcohol:</strong> {encounter.generalAssessment.socialHistory.alcoholUse}</p>
                  <p><strong>Occupation:</strong> {encounter.generalAssessment.socialHistory.occupation}</p>
                  <p><strong>Exercise:</strong> {encounter.generalAssessment.socialHistory.exerciseLevel}</p>
                </div>
              </div>
            </div>

            {/* Baseline Investigations & Review of Systems */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  General Baseline Investigations (CBC, BMP, Sugar, ECG)
                </span>
                <div className="space-y-2">
                  {encounter.generalAssessment.baselineInvestigations.map((inv, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{inv.testName}</span>
                        {inv.value && <p className="text-[11px] text-slate-500 font-mono mt-0.5">{inv.value}</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        inv.isAbnormal
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}>
                        {inv.isAbnormal ? 'Abnormal Flag' : 'Within Normal Range'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Provisional Diagnoses & Specialty Routing
                </span>
                <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/60 rounded-xl space-y-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">Provisional ICD-10 Codes</span>
                    <div className="space-y-1 mt-1">
                      {encounter.generalAssessment.provisionalDiagnoses.map((d, i) => (
                        <div key={i} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          • [{d.code}] {d.description}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-blue-200 dark:border-blue-800/60 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Recommended Specialty:</span>
                    <span className="font-black text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">
                      {encounter.generalAssessment.recommendedSpecialty} (Priority: {encounter.generalAssessment.urgencyLevel})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Advance to Stage 3 CTA */}
            <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveStageIndex(0)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl"
              >
                Back to Stage 1
              </button>
              <button
                onClick={() => {
                  setActiveStageIndex(2);
                  triggerToast(`Advanced to Stage 3: ${encounter.specialty} Disease-Centric Intake`);
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-sm flex items-center gap-2 transition-all"
              >
                Proceed to Stage 3: Disease-Centric Intake ({encounter.specialty})
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 3: DISEASE-CENTRIC STRUCTURED INTAKE (CARDIOLOGY SCHEMA) */}
        {/* ========================================================================= */}
        {activeStageIndex === 2 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                  Stage 3 Disease-Centric Module
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <HeartPulse className="w-5 h-5 text-rose-600" />
                  Cardiology Disease-Centric Intake Schema
                </h3>
              </div>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-xl">
                Specialty: {encounter.specialty}
              </span>
            </div>

            {cardioIntake ? (
              <div className="space-y-6">
                {/* 1. Cardiac History & 2. Symptoms PQRST */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Cardiac History */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      1. Structured Cardiac History
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Prior MI</span>
                        <span className="font-black text-rose-600">
                          {cardioIntake.cardiacHistory.priorMyocardialInfarction ? `Yes (${cardioIntake.cardiacHistory.priorMiYear})` : 'No'}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Known CAD</span>
                        <span className="font-black text-slate-800 dark:text-slate-200">
                          {cardioIntake.cardiacHistory.knownCoronaryArteryDisease ? 'Confirmed (Stented)' : 'No'}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Heart Failure Baseline</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          NYHA Class {cardioIntake.cardiacHistory.nyhaBaselineClass || 'I'}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">HTN / DM Duration</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          HTN: {cardioIntake.cardiacHistory.hypertensionYears}y • DM: {cardioIntake.cardiacHistory.diabetesMellitusYears}y
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cardiac Symptoms PQRST Profile */}
                  <div className="p-4 bg-rose-50/40 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-800/60 space-y-3">
                    <h4 className="text-xs font-black uppercase text-rose-800 dark:text-rose-300 tracking-wider flex items-center gap-2">
                      <Flame className="w-4 h-4 text-rose-600" />
                      2. Cardiac Symptoms & PQRST Chest Pain
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-rose-100 dark:border-rose-900">
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Provocation & Palliation:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200 text-right">
                          {cardioIntake.symptoms.chestPain.provocation}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-rose-100 dark:border-rose-900">
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Quality & Pain Severity:</span>
                        <span className="font-black text-rose-600">
                          {cardioIntake.symptoms.chestPain.quality} (Severity: {cardioIntake.symptoms.chestPain.severityScale}/10)
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-rose-100 dark:border-rose-900">
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Radiation:</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.symptoms.chestPain.regionAndRadiation.join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Cardiac Questions & 4. Surgical History */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Cardiac Specific Questions */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-blue-600" />
                      3. Cardiac-Specific Questionnaire
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Orthopnea</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.cardiacQuestions.orthopneaPillowsCount} Pillow(s)
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Paroxysmal Nocturnal Dyspnea</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.cardiacQuestions.paroxysmalNocturnalDyspnea ? 'Positive' : 'Negative'}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Bilateral Pedal Edema</span>
                        <span className="font-bold text-amber-600">
                          {cardioIntake.cardiacQuestions.bilateralPedalEdema}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Exercise METs</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.cardiacQuestions.exerciseToleranceEquivalentMets} METs (Moderate)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Surgical & Intervention History */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                      <Zap className="w-4 h-4 text-purple-600" />
                      4. Surgical & Intervention History
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Prior PCI & Stents</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.surgicalHistory.pciVessels?.join(', ') || 'None'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-400 block text-[10px]">Prior CABG</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {cardioIntake.surgicalHistory.priorCabg ? 'Yes' : 'No'}
                          </span>
                        </div>
                        <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-400 block text-[10px]">Implanted Device</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {cardioIntake.surgicalHistory.cardiacDeviceImplants}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Medication History & 6. Family Cardiac History */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Prior Medication History */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                      <Pill className="w-4 h-4 text-emerald-600" />
                      5. Cardiac Medication History & Adherence
                    </h4>
                    <div className="space-y-1.5 text-xs">
                      {cardioIntake.medicationHistory.antiplateletDrugs?.map((d, i) => (
                        <div key={i} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{d}</span>
                          <span className="text-[10px] text-emerald-600 font-extrabold uppercase">Antiplatelet</span>
                        </div>
                      ))}
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.medicationHistory.betaBlockerDrug}
                        </span>
                        <span className="text-[10px] text-blue-600 font-extrabold uppercase">Beta Blocker</span>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {cardioIntake.medicationHistory.statinDrug}
                        </span>
                        <span className="text-[10px] text-purple-600 font-extrabold uppercase">Statin</span>
                      </div>
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200 dark:border-emerald-900 flex justify-between text-emerald-800 dark:text-emerald-300">
                        <span>Reported Drug Adherence Rate:</span>
                        <span className="font-black">{cardioIntake.medicationHistory.selfReportedAdherencePercent}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Family Cardiac History */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-rose-600" />
                      6. Family Cardiac History & Genetics
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between">
                        <span>Premature CAD in 1st Degree Relative (&lt;55m / &lt;65f):</span>
                        <span className="font-black text-rose-600">
                          {cardioIntake.familyCardiacHistory.prematureCadFirstDegreeRelative ? 'POSITIVE' : 'NEGATIVE'}
                        </span>
                      </div>
                      <div className="p-3 bg-rose-50/50 dark:bg-rose-950/30 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200 text-xs">
                        <strong>Affected Relatives:</strong> {cardioIntake.familyCardiacHistory.affectedRelativesDetails}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-sky-50 dark:bg-sky-950/30 rounded-xl border border-sky-200 dark:border-sky-800 text-xs space-y-2">
                <span className="font-extrabold text-sky-900 dark:text-sky-200 block">
                  Pulmonology Disease-Centric Intake Active
                </span>
                <p className="text-slate-700 dark:text-slate-300">
                  Capturing mMRC dyspnea grading, cough purulence profile, nocturnal triggers, and inhaler technique assessment.
                </p>
              </div>
            )}

            {/* Advance to Stage 4 CTA */}
            <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveStageIndex(1)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl"
              >
                Back to Stage 2
              </button>
              <button
                onClick={() => {
                  setActiveStageIndex(3);
                  triggerToast('Advanced to Stage 4: Consultant Specialist Evaluation');
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-sm flex items-center gap-2 transition-all"
              >
                Proceed to Stage 4: Consultant Specialist (Cardiologist)
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 4: CONSULTANT SPECIALIST (CARDIOLOGIST) */}
        {/* ========================================================================= */}
        {activeStageIndex === 3 && encounter.consultantDocumentation && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                  Stage 4 Specialist Master Desk
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-purple-600" />
                  Consultant Specialist ({encounter.consultantDocumentation.soap.consultantSpecialty})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAiGenerateSoap}
                  disabled={isAiGenerating}
                  className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isAiGenerating ? 'Synthesizing SOAP...' : 'AI Clinical Copilot'}
                </button>
              </div>
            </div>

            {/* 1. Special Investigations Panel */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-600" />
                  1. Special Investigations (ECG, Echo, hs-Troponin, NT-proBNP)
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAddInvestigation('ANGIOGRAM', 'Coronary Angiography (Diagnostic)', 'CATH-ANGIO-01')}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    + Add Coronary Angiogram
                  </button>
                  <button
                    onClick={() => handleAddInvestigation('STRESS_TEST', 'Dobutamine Stress Echo', 'CARD-STRESS-02')}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    + Add Stress Test
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {encounter.consultantDocumentation.specialInvestigations.map((inv) => (
                  <div
                    key={inv.id}
                    className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                      inv.criticalAlert
                        ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-extrabold uppercase">
                          [{inv.code}] • {inv.modality}
                        </span>
                        <h5 className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{inv.name}</h5>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                        inv.criticalAlert
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                      }`}>
                        {inv.status}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300 font-mono">
                      <strong>Result:</strong> {inv.resultSummary || 'Worklist queued for analysis.'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Structured SOAP Documentation */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                2. Structured SOAP Documentation & Diagnostic Coding
              </h4>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400 block">Subjective (S) & Objective (O)</span>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs text-slate-800 dark:text-slate-200">
                    <p><strong>[Subjective]:</strong> {encounter.consultantDocumentation.soap.subjective}</p>
                    <p className="pt-2 border-t border-slate-200 dark:border-slate-700"><strong>[Objective]:</strong> {encounter.consultantDocumentation.soap.objective}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400 block">Assessment (A) & Plan (P)</span>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs text-slate-800 dark:text-slate-200">
                    <p className="whitespace-pre-line font-mono text-[11px]"><strong>[Assessment]:</strong>\n{encounter.consultantDocumentation.soap.assessment}</p>
                    <p className="pt-2 border-t border-slate-200 dark:border-slate-700 whitespace-pre-line font-mono text-[11px]"><strong>[Plan]:</strong>\n{encounter.consultantDocumentation.soap.plan}</p>
                  </div>
                </div>
              </div>

              {/* Clinical Risk Scores Strip */}
              <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase">ASCVD 10-Yr Risk</span>
                  <span className="text-sm font-black text-rose-600 block">
                    {encounter.consultantDocumentation.soap.clinicalRiskScores.ascvd10YearRiskPercent}% (High Risk)
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase">NYHA Class</span>
                  <span className="text-sm font-black text-slate-900 dark:text-white block">
                    {encounter.consultantDocumentation.soap.clinicalRiskScores.nyhaFunctionalClass}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase">CHA2DS2-VASc</span>
                  <span className="text-sm font-black text-slate-900 dark:text-white block">
                    {encounter.consultantDocumentation.soap.clinicalRiskScores.cha2ds2VascScore ?? 3} Points
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase">Cryptographic Signature</span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 block flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Signed by {encounter.consultantDocumentation.soap.consultantName}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Lifestyle Modification & 4. Medication Reconciliation */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Lifestyle Modification */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  3. Lifestyle Prescription
                </h4>
                <div className="text-xs space-y-2 text-slate-700 dark:text-slate-300">
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Sodium & Fluid Restriction</span>
                    <span className="font-bold">
                      Sodium &lt;{encounter.consultantDocumentation.lifestyleModification.dietaryPlan.sodiumRestrictionGramsPerDay}g/day • Fluid &lt;{encounter.consultantDocumentation.lifestyleModification.dietaryPlan.fluidRestrictionLitersPerDay || 2}L
                    </span>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Supervised Cardiac Rehab</span>
                    <span className="font-bold text-emerald-600">
                      {encounter.consultantDocumentation.lifestyleModification.exerciseAndRehab.prescribedIntensity} ({encounter.consultantDocumentation.lifestyleModification.exerciseAndRehab.exerciseFrequencyDaysPerWeek}x/wk)
                    </span>
                  </div>
                </div>
              </div>

              {/* Medication Plan & Medication Reconciliation */}
              <div className="lg:col-span-2 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                    <Pill className="w-4 h-4 text-rose-600" />
                    4. Medication Plan & Clinical Reconciliation
                  </h4>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded">
                    Drug-Drug Safety Checked
                  </span>
                </div>

                <div className="space-y-2">
                  {encounter.consultantDocumentation.medications.map((med) => (
                    <div
                      key={med.id}
                      className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 dark:text-white">{med.drugName}</span>
                          <span className="text-slate-500 font-mono">({med.dosage} • {med.route})</span>
                        </div>
                        <span className="text-[11px] text-slate-500 block">{med.frequency} • {med.indication}</span>
                        {med.potentialInteractionsAlert && (
                          <span className="text-[10px] text-amber-600 font-bold block mt-0.5">⚠️ {med.potentialInteractionsAlert}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            med.reconciliationAction === 'NEWLY_PRESCRIBED'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                              : med.reconciliationAction === 'MODIFIED_DOSE'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : med.reconciliationAction === 'DISCONTINUED_HOLD'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {med.reconciliationAction}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Advance to Stage 5 CTA */}
            <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveStageIndex(2)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl"
              >
                Back to Stage 3
              </button>
              <button
                onClick={() => {
                  setActiveStageIndex(4);
                  triggerToast('Advanced to Stage 5: Longitudinal Timeline & Clinical Routing');
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-sm flex items-center gap-2 transition-all"
              >
                Proceed to Stage 5: Longitudinal Timeline & Routing
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 5: LONGITUDINAL TIMELINE & CLINICAL ROUTING */}
        {/* ========================================================================= */}
        {activeStageIndex === 4 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Stage 5 Orchestration Module
                </span>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <GitFork className="w-5 h-5 text-emerald-600" />
                  Longitudinal History & Multi-Department Routing
                </h3>
              </div>
              <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-3 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800">
                Current Handoff Status: {encounter.consultantDocumentation?.routing.destinationType || 'ROUTED'}
              </span>
            </div>

            {/* Seamless Department Routing Controls */}
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-2xl border border-blue-200 dark:border-blue-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-blue-900 dark:text-blue-200 tracking-wider flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-600" />
                  Execute Multi-Department & Inter-Specialty Clinical Routing
                </h4>
                <span className="text-[10px] font-extrabold uppercase text-blue-600 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  Zero-Loss Data Handoff
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  onClick={() => handleExecuteRouting('CATH_LAB_ADMISSION', 'Cardiac Catheterization & Interventional Suite', 'STAT_EMERGENCY')}
                  className="p-3 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 hover:border-rose-300 rounded-xl text-left transition-all shadow-xs group"
                >
                  <span className="text-[10px] font-black text-rose-600 uppercase block">STAT EMERGENCY</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-rose-600 block mt-0.5">
                    Route to Cath Lab (PCI)
                  </span>
                </button>

                <button
                  onClick={() => handleExecuteRouting('INPATIENT_WARD', 'Coronary Care Unit (CCU Stepdown)', 'PRIORITY')}
                  className="p-3 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200 dark:border-slate-800 hover:border-blue-300 rounded-xl text-left transition-all shadow-xs group"
                >
                  <span className="text-[10px] font-black text-blue-600 uppercase block">INPATIENT ADMIT</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 block mt-0.5">
                    Admit to CCU Bed 304
                  </span>
                </button>

                <button
                  onClick={() => handleExecuteRouting('INTER_SPECIALTY_REFERRAL', 'Pulmonology / Cardiopulmonary Rehab', 'PRIORITY')}
                  className="p-3 bg-white dark:bg-slate-900 hover:bg-purple-50 dark:hover:bg-purple-950/40 border border-slate-200 dark:border-slate-800 hover:border-purple-300 rounded-xl text-left transition-all shadow-xs group"
                >
                  <span className="text-[10px] font-black text-purple-600 uppercase block">INTER-SPECIALTY</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-purple-600 block mt-0.5">
                    Refer to Pulmonology
                  </span>
                </button>

                <button
                  onClick={() => handleExecuteRouting('REVISIT_OPD', 'Cardiology Outpatient Clinic', 'ROUTINE')}
                  className="p-3 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-slate-800 hover:border-emerald-300 rounded-xl text-left transition-all shadow-xs group"
                >
                  <span className="text-[10px] font-black text-emerald-600 uppercase block">AMBULATORY REVISIT</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 block mt-0.5">
                    Schedule 2-Week Revisit
                  </span>
                </button>
              </div>

              {encounter.consultantDocumentation?.routing && (
                <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-blue-200 dark:border-blue-900 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Destination: {encounter.consultantDocumentation.routing.targetDepartment}
                    </span>
                    <span className="text-[10px] font-extrabold text-blue-600 uppercase">
                      Priority: {encounter.consultantDocumentation.routing.routingPriority}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">
                    <strong>Handoff Summary:</strong> {encounter.consultantDocumentation.routing.clinicalHandoffSummary}
                  </p>
                </div>
              )}
            </div>

            {/* Event-Derived Outbox & Longitudinal Lifecycle Audit Stream */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-600" />
                  Event-Derived Outbox & System Lifecycle Events Stream
                </h4>
                <span className="text-xs text-slate-500 font-mono">
                  {encounter.lifecycleEvents.length} Events Dispatched to Outbox
                </span>
              </div>

              <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3.5 space-y-4 pl-4 py-2">
                {encounter.lifecycleEvents.map((evt, idx) => (
                  <div key={evt.eventId} className="relative group">
                    <div className="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-black text-slate-900 dark:text-white">{evt.stageName}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-bold block">
                        {evt.eventType}
                      </span>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{evt.summary}</p>
                      <span className="text-[10px] text-slate-400 block pt-1">Actor: {evt.actor}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Back Navigation */}
            <div className="flex justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setActiveStageIndex(3)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl"
              >
                Back to Stage 4 (Consultant)
              </button>
              <button
                onClick={() => {
                  setActiveStageIndex(0);
                  triggerToast('Reset view to Stage 1: Triage Intake');
                }}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Return to Pipeline Start
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
