'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  INTAKE_TEMPLATES,
  LOCALIZATION_CONFIGS,
  HOSPITAL_TIER_CONFIGS,
} from '@/lib/clinical/intake-templates-data';
import {
  DiseaseIntakeTemplate,
  SymptomTreeNode,
  GuidedQuestion,
  LocalizationConfig,
  HospitalTierConfig,
  AiOptimizationResult,
  RiskSeverity,
} from '@/lib/types/disease-intake';
import {
  HeartPulse,
  Brain,
  Flame,
  Activity,
  Baby,
  Sparkles,
  ShieldAlert,
  Sliders,
  Globe,
  Building2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  GitBranch,
  Stethoscope,
  Clock,
  Send,
  FileText,
  FileCheck2,
  Layers,
  Settings2,
  RefreshCw,
  Plus,
  ArrowRight,
  ShieldCheck,
  Zap,
  Info,
  ListOrdered,
  Workflow,
  Download,
} from 'lucide-react';
import { AuthClient } from '@/lib/auth/auth-client';
import { PatientConsultantRoutingModal } from '@/components/clinical/patient-consultant-routing-modal';
import { saveDiseaseIntakeArtifact } from '@/lib/clinical/intelligence/consultant-worklist-client';
import { computeGovernedDiseaseIntakeRisk } from '@/lib/clinical/disease-intake/governed-risk-engine';

export function DiseaseCentricIntakeView() {
  const { patients, selectedPatientId, setSelectedPatientId } = useHospital();
  const [localPatientId, setLocalPatientId] = useState<string>(selectedPatientId || '');

  // Synchronize with global hospital context patient
  useEffect(() => {
    if (selectedPatientId) {
      setLocalPatientId(selectedPatientId);
    }
  }, [selectedPatientId]);

  const activePatientId = localPatientId;
  const setActivePatientId = (id: string) => {
    setLocalPatientId(id);
    setSelectedPatientId(id);
  };

  // Selected Template
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('cardiac');
  const [activeTabMode, setActiveTabMode] = useState<'intake' | 'tree' | 'ai_optimize' | 'customize' | 'localization'>('intake');

  // Active Template Object
  const currentTemplate = useMemo(() => {
    return INTAKE_TEMPLATES.find((t) => t.id === selectedTemplateId) || INTAKE_TEMPLATES[0];
  }, [selectedTemplateId]);

  // Selected Patient
  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === activePatientId);
  }, [patients, activePatientId]);

  // Localization and Facility Configuration
  const [selectedLocalizationId, setSelectedLocalizationId] = useState<string>('us_aha_nih');
  const [selectedTierId, setSelectedTierId] = useState<string>('tier_quaternary');

  const currentLocalization = useMemo(() => {
    return LOCALIZATION_CONFIGS.find((l) => l.id === selectedLocalizationId) || LOCALIZATION_CONFIGS[0];
  }, [selectedLocalizationId]);

  const currentHospitalTier = useMemo(() => {
    return HOSPITAL_TIER_CONFIGS.find((h) => h.id === selectedTierId) || HOSPITAL_TIER_CONFIGS[0];
  }, [selectedTierId]);

  // Intake State: Tree branch navigation, answers, specialty history
  const [selectedTreeNodeIds, setSelectedTreeNodeIds] = useState<string[]>([
    INTAKE_TEMPLATES[0]?.symptomTree?.id || 'cardiac_root',
  ]);
  const [guidedAnswers, setGuidedAnswers] = useState<Record<string, any>>({});
  const [specialtyHistoryAnswers, setSpecialtyHistoryAnswers] = useState<Record<string, any>>({});

  // AI Optimization State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiOptimizationResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [committedSuccess, setCommittedSuccess] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [showRoutingModal, setShowRoutingModal] = useState(false);
  const [savedIntakeArtifact, setSavedIntakeArtifact] = useState<{
    intakeArtifactId: string;
    patient360Revision: number;
    patient360SourceCheckpoint: string;
  } | null>(null);

  // Template Customization / Studio state
  const [customQuestions, setCustomQuestions] = useState<GuidedQuestion[]>([]);
  const [customWeightMultiplier, setCustomWeightMultiplier] = useState<number>(1.0);
  const [autoDispatchOnCritical, setAutoDispatchOnCritical] = useState<boolean>(false);

  // Reset Tree / Answers on template change
  useEffect(() => {
    if (currentTemplate.symptomTree) {
      setSelectedTreeNodeIds([currentTemplate.symptomTree.id]);
    }
    setGuidedAnswers({});
    setSpecialtyHistoryAnswers({});
    setAiResult(null);
    setCommittedSuccess(false);
    setCommitError(null);
    setSavedIntakeArtifact(null);
  }, [selectedTemplateId, currentTemplate]);

  // Any clinician input change invalidates the previously finalized artifact.
  // Routing must always reference the exact reviewed intake version.
  useEffect(() => {
    setSavedIntakeArtifact(null);
  }, [guidedAnswers, specialtyHistoryAnswers, selectedTreeNodeIds]);

  // Real-time display uses the exact governed calculator used by the server.
  const { totalRiskScore, activeRiskSignals, maxRiskSeverity } = useMemo(() => {
    const governed = computeGovernedDiseaseIntakeRisk(
      currentTemplate,
      guidedAnswers,
      specialtyHistoryAnswers,
      selectedTreeNodeIds
    );
    const signalIds = new Set(governed.signalIds);
    return {
      totalRiskScore: governed.score,
      activeRiskSignals: currentTemplate.riskSignals.filter((signal) =>
        signalIds.has(signal.id)
      ),
      maxRiskSeverity: governed.severity,
    };
  }, [
    currentTemplate,
    guidedAnswers,
    specialtyHistoryAnswers,
    selectedTreeNodeIds,
  ]);

  // Handle Symptom Tree node toggle
  const handleTreeNodeToggle = (nodeId: string) => {
    setSelectedTreeNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId);
      } else {
        return [...prev, nodeId];
      }
    });
  };

  // Run AI Optimization via authenticated server route.
  const handleRunAiOptimization = async () => {
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      if (!selectedPatient) {
        throw new Error('Select a patient before requesting clinical intelligence.');
      }

      const tenantId = await AuthClient.getActiveTenantId();
      const activeBranchLabels = selectedTreeNodeIds.map((id) => id.replace(/_/g, ' ').toUpperCase());
      const latestVitals = selectedPatient.encounters?.[0]?.vitalsHistory?.[0];

      const payload = {
        tenantId,
        templateId: currentTemplate.id,
        diseaseName: currentTemplate.name,
        guidedAnswers,
        activeBranch: {
          nodeIds: selectedTreeNodeIds,
          label: activeBranchLabels.join(' -> '),
        },
        specialtyHistory: specialtyHistoryAnswers,
        riskSignals: {
          score: totalRiskScore,
          overallRisk: maxRiskSeverity,
          primaryAlert: activeRiskSignals[0]?.title,
          flags: activeRiskSignals.map((signal) => signal.title),
        },
        patientContext: {
          id: selectedPatient.id,
          name: selectedPatient.fullName,
          age: selectedPatient.age,
          gender: selectedPatient.gender,
          mrn: selectedPatient.mrn,
          ...(latestVitals
            ? {
                vitals: {
                  heartRate: latestVitals.heartRate,
                  bp: latestVitals.bloodPressure,
                  spO2: latestVitals.oxygenSaturation,
                  temp: String(latestVitals.temperature),
                },
              }
            : {}),
        },
        localization: currentLocalization.name,
        facilityTier: currentHospitalTier.name,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      try {
        const res = await AuthClient.authorizedFetch(
          '/api/clinical/intake-optimize',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
          tenantId
        );

        const data = await res.json();
        if (!res.ok || !data.executiveSummary) {
          throw new Error(data.message || data.error || 'Clinical intelligence is unavailable.');
        }

        setAiResult(data);
        setActiveTabMode('ai_optimize');
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      setAiResult(null);
      setAiError(
        error instanceof Error
          ? error.message
          : 'Clinical intelligence is unavailable. No fallback clinical recommendations were generated.'
      );
      setActiveTabMode('ai_optimize');
    } finally {
      setAiLoading(false);
    }
  };

  // Save the clinician-reviewed intake through the authoritative note command.
  const handleCommitToLongitudinalEhr = async () => {
    if (!selectedPatient) {
      setCommitError('Select a patient before saving the intake.');
      return;
    }

    const encounterId =
      selectedPatient.activeEncounterId ||
      selectedPatient.encounters.find((encounter) => encounter.status === 'active')?.id;
    if (!encounterId) {
      setCommitError('An active encounter is required before finalizing disease intake.');
      return;
    }

    setCommitError(null);
    setSavedIntakeArtifact(null);

    try {
      const tenantId = await AuthClient.getActiveTenantId();
      const patient360Response = await AuthClient.authorizedFetch(
        `/api/clinical/patient360/${encodeURIComponent(selectedPatient.id)}?tenantId=${encodeURIComponent(tenantId)}&encounterId=${encodeURIComponent(encounterId)}`,
        { method: 'GET', cache: 'no-store' },
        tenantId
      );
      const patient360Payload = await patient360Response.json();
      if (
        !patient360Response.ok ||
        !patient360Payload?.success ||
        !patient360Payload?.projection
      ) {
        throw new Error(
          patient360Payload?.error ||
            'Patient 360 could not be loaded for clinician-reviewed intake finalization.'
        );
      }

      const patient360Revision = Number(patient360Payload.projection.revision);
      const patient360SourceCheckpoint = String(
        patient360Payload.projection.sourceCheckpoint || ''
      ).trim();
      if (
        !Number.isInteger(patient360Revision) ||
        patient360Revision < 0 ||
        !patient360SourceCheckpoint
      ) {
        throw new Error('Patient 360 did not return a valid review checkpoint.');
      }

      const result = await saveDiseaseIntakeArtifact(tenantId, {
        patientId: selectedPatient.id,
        encounterId,
        templateId: currentTemplate.id,
        templateName: currentTemplate.name,
        clinicalGuidelines: currentTemplate.clinicalGuidelines,
        guidedAnswers,
        specialtyHistory: specialtyHistoryAnswers,
        selectedTreeNodeIds,
        observedRiskScore: totalRiskScore,
        observedRiskSeverity: maxRiskSeverity,
        observedRiskSignalIds: activeRiskSignals.map((signal) => signal.id),
        observedRiskSignalTitles: activeRiskSignals.map((signal) => signal.title),
        specialistTargets: currentTemplate.typicalSpecialists,
        sourceRefs: [],
        patient360Revision,
        patient360SourceCheckpoint,
        clinicianAttestation: true,
      });

      const intakeArtifactId = String(result.entityId || '').trim();
      if (!intakeArtifactId) {
        throw new Error('Disease intake finalized without a canonical artifact identifier.');
      }

      setSavedIntakeArtifact({
        intakeArtifactId,
        patient360Revision,
        patient360SourceCheckpoint,
      });
      setCommittedSuccess(true);
      setTimeout(() => {
        setCommittedSuccess(false);
      }, 4000);
    } catch (error) {
      setCommitError(
        error instanceof Error ? error.message : 'Intake could not be finalized.'
      );
    }
  };

  const activeEncounterId =
    selectedPatient?.activeEncounterId ||
    selectedPatient?.encounters.find((encounter) => encounter.status === 'active')?.id;
  const activeEncounter = selectedPatient?.encounters.find(
    (encounter) => encounter.id === activeEncounterId
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner: G-HIMS Progressive Identity & Disease-Centric Overview */}
      <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 text-white p-6 rounded-2xl border border-blue-800/60 shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -z-0 pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Disease-Centric Clinical Intelligence
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Source-limited • clinician reviewed
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Disease-Centric Intake & Specialist Preparation Platform
            </h1>
            <p className="text-sm text-slate-300 font-normal leading-relaxed">
              Structured specialty intake that captures explicit findings, surfaces governed protocol signals, prepares a source-limited handoff, and lets the clinician explicitly route the case to an eligible specialist.
            </p>
          </div>

          {/* Quick AI Optimize Action Button */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              id="btn-trigger-ai-optimize-top"
              onClick={handleRunAiOptimization}
              disabled={aiLoading || !selectedPatient}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-sm flex items-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {aiLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
                  <span>Preparing specialist brief...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
                  <span>Generate Specialist Brief</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Disease Template Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {INTAKE_TEMPLATES.map((tmpl) => {
          const isSelected = tmpl.id === selectedTemplateId;
          const getIcon = () => {
            switch (tmpl.id) {
              case 'cardiac':
                return <HeartPulse className="w-5 h-5" />;
              case 'stroke':
                return <Brain className="w-5 h-5" />;
              case 'diabetic':
                return <Flame className="w-5 h-5" />;
              case 'ortho_trauma':
                return <Activity className="w-5 h-5" />;
              case 'obgyn':
                return <Baby className="w-5 h-5" />;
              default:
                return <Stethoscope className="w-5 h-5" />;
            }
          };

          return (
            <button
              key={tmpl.id}
              id={`tab-intake-${tmpl.id}`}
              onClick={() => setSelectedTemplateId(tmpl.id)}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                isSelected
                  ? 'bg-white dark:bg-slate-900 border-blue-600 dark:border-blue-500 shadow-sm ring-2 ring-blue-500/20'
                  : 'bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {getIcon()}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  {tmpl.id.replace('_', ' ')}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 leading-tight">
                  {tmpl.name.split('&')[0]}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1 font-medium">
                  {tmpl.specialty.split('&')[0]}
                </p>
              </div>
              {isSelected && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 dark:bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Patient Header & Quick Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-sm border border-blue-200 dark:border-blue-800">
            {selectedPatient?.fullName?.charAt(0) || 'P'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                {selectedPatient?.fullName || 'Selected Patient'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                ({selectedPatient?.age || 54}y/o {selectedPatient?.gender || 'M'})
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-slate-600 dark:text-slate-300">
                MRN: {selectedPatient?.mrn || 'MRN-1049'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span>HR: <strong className="text-slate-800 dark:text-slate-200">{selectedPatient?.encounters?.[0]?.vitalsHistory?.[0]?.heartRate ?? '—'}</strong>{selectedPatient?.encounters?.[0]?.vitalsHistory?.[0]?.heartRate != null ? ' bpm' : ''}</span>
              <span>BP: <strong className="text-slate-800 dark:text-slate-200">{selectedPatient?.encounters?.[0]?.vitalsHistory?.[0]?.bloodPressure || '—'}</strong></span>
              <span>SpO2: <strong className="text-slate-800 dark:text-slate-200">{selectedPatient?.encounters?.[0]?.vitalsHistory?.[0]?.oxygenSaturation ?? '—'}</strong>{selectedPatient?.encounters?.[0]?.vitalsHistory?.[0]?.oxygenSaturation != null ? '%' : ''}</span>
            </div>
          </div>
        </div>

        {/* Change Patient Selector */}
        <div className="flex items-center gap-2">
          <select
            id="select-intake-patient"
            value={selectedPatient?.id}
            onChange={(e) => setActivePatientId(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.mrn})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Real-time Dynamic Risk HUD Bar */}
      <div
        className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all shadow-xs ${
          maxRiskSeverity === 'CRITICAL'
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100'
            : maxRiskSeverity === 'HIGH'
            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100'
            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0 ${
              maxRiskSeverity === 'CRITICAL'
                ? 'bg-rose-600 text-white animate-pulse'
                : maxRiskSeverity === 'HIGH'
                ? 'bg-amber-600 text-white'
                : 'bg-emerald-600 text-white'
            }`}
          >
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm uppercase tracking-wide">
                Risk Status: {maxRiskSeverity} (Score: {totalRiskScore} pts)
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-current">
                {activeRiskSignals.length} Active Protocol Alerts
              </span>
            </div>
            <p className="text-xs opacity-90 mt-0.5">
              {activeRiskSignals[0]?.title || 'Protocolized risk rules within normal operating bounds.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeRiskSignals.map((signal) => (
            <span
              key={signal.id}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 shadow-2xs border border-current flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              {signal.title.split('/')[0]}
            </span>
          ))}
        </div>
      </div>

      {/* Main Mode Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            id="tab-mode-intake"
            onClick={() => setActiveTabMode('intake')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTabMode === 'intake'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>Guided Clinical Intake & Vitals</span>
          </button>

          <button
            id="tab-mode-tree"
            onClick={() => setActiveTabMode('tree')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTabMode === 'tree'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>Symptom Tree Navigator</span>
          </button>

          <button
            id="tab-mode-ai"
            onClick={() => setActiveTabMode('ai_optimize')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTabMode === 'ai_optimize'
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Source-Limited Specialist Brief</span>
            {aiResult && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
          </button>

        </div>

        {/* Explicit clinical actions: save first, route separately. */}
        <div className="flex items-center gap-2">
          <button
            id="btn-commit-longitudinal-ehr"
            onClick={() => void handleCommitToLongitudinalEhr()}
            disabled={!selectedPatient}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileCheck2 className="w-4 h-4" />
            <span>Save Reviewed Intake</span>
          </button>
          <button
            id="btn-route-specialist"
            onClick={() => setShowRoutingModal(true)}
            disabled={!selectedPatient || !activeEncounterId || !savedIntakeArtifact}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            <span>{savedIntakeArtifact ? 'Route Finalized Intake' : 'Finalize Intake First'}</span>
          </button>
        </div>
      </div>

      {/* Success Commitment Banner */}
      {committedSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Clinician-reviewed disease intake finalized as an immutable artifact and linked to Patient 360. It is now eligible for source-linked specialist routing.</span>
          </div>
        </div>
      )}

      {commitError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-xl text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{commitError}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 1: GUIDED CLINICAL INTAKE & SPECIALTY HISTORIES */}
      {/* ========================================================================= */}
      {activeTabMode === 'intake' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns: Protocol Guided Questions */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ListOrdered className="w-4 h-4 text-blue-600" />
                    Protocol Guided Questionnaire: {currentTemplate.name}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Structured assessment adhering to {currentTemplate.clinicalGuidelines}
                  </p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {currentTemplate.guidedQuestions.length} Clinical Criteria
                </span>
              </div>

              {/* Guided Questions Form */}
              <div className="space-y-5">
                {currentTemplate.guidedQuestions.map((q, index) => {
                  const currentValue = guidedAnswers[q.id];

                  return (
                    <div
                      key={q.id}
                      className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                              {index + 1}
                            </span>
                            {q.label}
                            {q.required && <span className="text-rose-500 font-bold">*</span>}
                          </label>
                          {q.helperText && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {q.helperText}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {q.category.replace('_', ' ')}
                        </span>
                      </div>

                      {/* Question Inputs */}
                      {q.type === 'scale' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                            <span>Mild ({q.min || 0})</span>
                            <span className="text-sm text-blue-600 dark:text-blue-400 font-black px-3 py-0.5 rounded bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                              Score: {currentValue ?? q.defaultValue ?? 5} / {q.max || 10}
                            </span>
                            <span>Severe ({q.max || 10})</span>
                          </div>
                          <input
                            type="range"
                            id={`input-scale-${q.id}`}
                            min={q.min || 0}
                            max={q.max || 10}
                            value={currentValue ?? q.defaultValue ?? 5}
                            onChange={(e) =>
                              setGuidedAnswers((prev) => ({
                                ...prev,
                                [q.id]: parseInt(e.target.value, 10),
                              }))
                            }
                            className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                        </div>
                      )}

                      {q.type === 'select' && q.options && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {q.options.map((opt) => {
                            const isSelected = currentValue === opt.value;
                            return (
                              <button
                                key={opt.value}
                                id={`opt-${q.id}-${opt.value}`}
                                onClick={() =>
                                  setGuidedAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: opt.value,
                                  }))
                                }
                                className={`p-2.5 rounded-lg border text-left text-xs font-medium transition-all cursor-pointer flex items-start gap-2 ${
                                  isSelected
                                    ? opt.isRedFlag
                                      ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-800 text-rose-900 dark:text-rose-100 font-bold'
                                      : 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-800 text-blue-900 dark:text-blue-100 font-bold'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded-full mt-0.5 flex items-center justify-center border ${
                                    isSelected
                                      ? 'border-current bg-current'
                                      : 'border-slate-400 dark:border-slate-600'
                                  }`}
                                >
                                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <span>{opt.label}</span>
                                    {opt.isRedFlag && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.2 bg-rose-600 text-white rounded shrink-0">
                                        RED FLAG
                                      </span>
                                    )}
                                  </div>
                                  {opt.alertMessage && isSelected && (
                                    <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-semibold">
                                      {opt.alertMessage}
                                    </p>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {q.type === 'multiselect' && q.options && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {q.options.map((opt) => {
                            const isSelected = Array.isArray(currentValue) && currentValue.includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                id={`opt-multi-${q.id}-${opt.value}`}
                                onClick={() => {
                                  const currentArr = Array.isArray(currentValue) ? currentValue : [];
                                  const newArr = isSelected
                                    ? currentArr.filter((v) => v !== opt.value)
                                    : [...currentArr, opt.value];
                                  setGuidedAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: newArr,
                                  }));
                                }}
                                className={`p-2.5 rounded-lg border text-left text-xs font-medium transition-all cursor-pointer flex items-start gap-2 ${
                                  isSelected
                                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-800 text-blue-900 dark:text-blue-100 font-bold'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center border ${
                                    isSelected
                                      ? 'border-blue-600 bg-blue-600 text-white'
                                      : 'border-slate-400 dark:border-slate-600'
                                  }`}
                                >
                                  {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                                </div>
                                <div className="flex-1">
                                  <span>{opt.label}</span>
                                  {opt.isRedFlag && isSelected && (
                                    <span className="ml-1 text-[10px] font-bold px-1.5 py-0.2 bg-rose-600 text-white rounded">
                                      ALERT
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {q.type === 'number' && (
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            id={`input-number-${q.id}`}
                            value={currentValue ?? q.defaultValue ?? 0}
                            onChange={(e) =>
                              setGuidedAnswers((prev) => ({
                                ...prev,
                                [q.id]: parseFloat(e.target.value),
                              }))
                            }
                            className="w-36 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono font-bold"
                          />
                          {q.unit && (
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                              {q.unit}
                            </span>
                          )}
                        </div>
                      )}

                      {q.type === 'text' && (
                        <input
                          type="text"
                          id={`input-text-${q.id}`}
                          value={currentValue ?? q.defaultValue ?? ''}
                          onChange={(e) =>
                            setGuidedAnswers((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Specialty History & Active Branch Summary */}
          <div className="space-y-6">
            {/* Active Symptom Path Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-blue-600" />
                  Active Symptom Tree Branch
                </h3>
                <button
                  onClick={() => setActiveTabMode('tree')}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold cursor-pointer"
                >
                  Explore Tree
                </button>
              </div>

              <div className="space-y-2">
                {selectedTreeNodeIds.map((nodeId, idx) => (
                  <div
                    key={nodeId}
                    className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"
                  >
                    <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                    <span className="truncate">{nodeId.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Specialty Histories Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Stethoscope className="w-3.5 h-3.5 text-indigo-600" />
                  Specialty Medical History
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Domain-specific baseline metrics & contraindication screening
                </p>
              </div>

              {currentTemplate.specialtyHistory.map((group) => (
                <div key={group.id} className="space-y-3">
                  {group.fields.map((field) => {
                    const fieldValue = specialtyHistoryAnswers[field.key];

                    return (
                      <div key={field.key} className="space-y-1">
                        <label className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                          {field.label}
                        </label>

                        {field.type === 'select' && field.options && (
                          <select
                            id={`select-spec-${field.key}`}
                            value={fieldValue ?? field.defaultValue ?? field.options[0]}
                            onChange={(e) =>
                              setSpecialtyHistoryAnswers((prev) => ({
                                ...prev,
                                [field.key]: e.target.value,
                              }))
                            }
                            className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 text-slate-900 dark:text-slate-100 font-medium"
                          >
                            {field.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.type === 'multiselect' && field.options && (
                          <div className="space-y-1.5 pt-1">
                            {field.options.map((opt) => {
                              const isChecked = Array.isArray(fieldValue) && fieldValue.includes(opt);
                              return (
                                <label
                                  key={opt}
                                  className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const currentList = Array.isArray(fieldValue) ? fieldValue : [];
                                      const updatedList = e.target.checked
                                        ? [...currentList, opt]
                                        : currentList.filter((x) => x !== opt);
                                      setSpecialtyHistoryAnswers((prev) => ({
                                        ...prev,
                                        [field.key]: updatedList,
                                      }));
                                    }}
                                    className="rounded text-blue-600 accent-blue-600"
                                  />
                                  <span>{opt}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {field.clinicalImpact && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium italic">
                            Impact: {field.clinicalImpact}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Typical Specialist Team Dispatch Readiness */}
            <div className="bg-slate-50 dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Workflow className="w-3.5 h-3.5 text-blue-600" />
                Suggested Specialist Destination
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {currentTemplate.typicalSpecialists.map((spec) => (
                  <span
                    key={spec}
                    className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 shadow-2xs"
                  >
                    {spec}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Hospital Tier: <strong>{currentHospitalTier.name}</strong> ({currentHospitalTier.specialistEscalationTime})
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: INTERACTIVE SYMPTOM TREE NAVIGATOR */}
      {/* ========================================================================= */}
      {activeTabMode === 'tree' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-blue-600" />
                Interactive Symptom Tree: {currentTemplate.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Click clinical branch nodes to explore diagnostic divergence, risk weights, and red flag triggers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                {selectedTreeNodeIds.length} Nodes Active in Current Presentation
              </span>
            </div>
          </div>

          {/* Visual Symptom Tree Renderer */}
          <div className="space-y-6">
            {/* Level 0: Root Node */}
            <div
              onClick={() => handleTreeNodeToggle(currentTemplate.symptomTree.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                selectedTreeNodeIds.includes(currentTemplate.symptomTree.id)
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 ring-2 ring-blue-500/20'
                  : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                    0
                  </div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                    {currentTemplate.symptomTree.label}
                  </h3>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                  Base Weight: +{currentTemplate.symptomTree.riskWeight}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {currentTemplate.symptomTree.description}
              </p>
            </div>

            {/* Level 1 & 2 Branches */}
            <div className="pl-6 border-l-2 border-dashed border-blue-300 dark:border-blue-800 space-y-6">
              {currentTemplate.symptomTree.children?.map((childNode, idx) => {
                const isSelected = selectedTreeNodeIds.includes(childNode.id);

                return (
                  <div key={childNode.id} className="space-y-4">
                    {/* Primary Branch Node */}
                    <div
                      onClick={() => handleTreeNodeToggle(childNode.id)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                        isSelected
                          ? childNode.isRedFlag
                            ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-800 ring-2 ring-rose-500/20'
                            : 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-400 dark:border-indigo-800 ring-2 ring-indigo-500/20'
                          : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center">
                            1.{idx + 1}
                          </span>
                          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {childNode.label}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {childNode.isRedFlag && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-rose-600 text-white">
                              RED FLAG
                            </span>
                          )}
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                            +{childNode.riskWeight} pts
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        {childNode.description}
                      </p>
                      {childNode.alertText && isSelected && (
                        <div className="mt-2 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-100/80 dark:bg-rose-900/40 p-2 rounded-lg border border-rose-200 dark:border-rose-800">
                          {childNode.alertText}
                        </div>
                      )}
                    </div>

                    {/* Sub-Children (Level 2) */}
                    {childNode.children && childNode.children.length > 0 && (
                      <div className="pl-6 border-l-2 border-dashed border-indigo-200 dark:border-indigo-900/60 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {childNode.children.map((subChild) => {
                          const isSubSelected = selectedTreeNodeIds.includes(subChild.id);

                          return (
                            <div
                              key={subChild.id}
                              onClick={() => handleTreeNodeToggle(subChild.id)}
                              className={`p-3 rounded-xl border text-xs transition-all cursor-pointer ${
                                isSubSelected
                                  ? subChild.isRedFlag
                                    ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 text-rose-900 dark:text-rose-100 font-bold ring-1 ring-rose-500'
                                    : 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-900 dark:text-blue-100 font-bold ring-1 ring-blue-500'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold">{subChild.label}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                                  +{subChild.riskWeight}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {subChild.description}
                              </p>
                              {subChild.alertText && isSubSelected && (
                                <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-semibold">
                                  {subChild.alertText}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 3: AI CLINICAL SPECIALIST PREPARATION BRIEFING */}
      {/* ========================================================================= */}
      {activeTabMode === 'ai_optimize' && (
        <div className="space-y-6">
          {/* AI Trigger Header Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Source-Limited Specialist Preparation Brief
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Generates a source-limited specialist brief from the reviewed intake, including SBAR context, observed protocol signals, missing information, and handoff preparation. It does not diagnose, prescribe, or place orders.
              </p>
            </div>

            <button
              id="btn-re-run-ai-optimization"
              onClick={handleRunAiOptimization}
              disabled={aiLoading}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {aiLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />
                  <span>Synthesizing Clinical Intelligence...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Generate Updated Specialist Briefing</span>
                </>
              )}
            </button>
          </div>

          {aiError && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{aiError}</span>
            </div>
          )}

          {aiResult ? (
            <div className="space-y-6">
              {/* Executive Summary Card */}
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-6 rounded-2xl border border-indigo-800/60 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-extrabold tracking-wider text-amber-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Specialist Executive Briefing
                  </span>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/30">
                    {currentLocalization.name.split('(')[0]} Guidelines
                  </span>
                </div>
                <p className="text-sm text-slate-200 font-medium leading-relaxed">
                  {aiResult.executiveSummary}
                </p>
              </div>

              {/* SBAR Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider">
                    Situation (S)
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-normal">
                    {aiResult.sbar.situation}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-black uppercase text-purple-600 dark:text-purple-400 tracking-wider">
                    Background (B)
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-normal">
                    {aiResult.sbar.background}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider">
                    Assessment (A)
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-normal">
                    {aiResult.sbar.assessment}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 shadow-2xs">
                  <span className="text-[11px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider">
                    Recommendation (R)
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-medium leading-normal">
                    {aiResult.sbar.recommendation}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Observed Protocol Risk Signals
                  </h3>
                  {aiResult.observedRiskSignals?.length ? (
                    <div className="space-y-2">
                      {aiResult.observedRiskSignals.map((item, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-100"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No additional source-limited risk signal was returned.
                    </p>
                  )}
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Missing or Unverified Information
                  </h3>
                  {aiResult.missingOrUnverifiedInformation?.length ? (
                    <div className="space-y-2">
                      {aiResult.missingOrUnverifiedInformation.map((item, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-100"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No missing-information item was returned by the source-limited brief.
                    </p>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-100 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Draft for clinician review only. This view does not diagnose, prescribe, place orders, or automatically dispatch a specialist.
                </span>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 space-y-3">
              <Sparkles className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                No AI Briefing Generated Yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Click &quot;Generate Updated Specialist Briefing&quot; above to synthesize the current symptom tree, guided questionnaire, and specialty history into an actionable briefing.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 4: CONFIGURABLE STUDIO (HOSPITAL-CUSTOMIZABLE) */}
      {/* ========================================================================= */}
      {activeTabMode === 'customize' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sliders className="w-5 h-5 text-blue-600" />
              Configurable Template Studio & Hospital Rules Engine
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize risk weights, add institutional custom clinical questions, and configure automated dispatch triggers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Risk Weight Multiplier */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Institutional Risk Weight Multiplier
                </label>
                <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                  {customWeightMultiplier.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={customWeightMultiplier}
                onChange={(e) => setCustomWeightMultiplier(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Adjusts the sensitivity threshold for triggering critical and high risk alarms across all intake templates.
              </p>
            </div>

            {/* Auto Dispatch Trigger */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Automated Specialist Paging on Critical Risk
                </label>
                <input
                  type="checkbox"
                  checked={autoDispatchOnCritical}
                  onChange={(e) => setAutoDispatchOnCritical(e.target.checked)}
                  className="rounded text-blue-600 accent-blue-600 w-4 h-4 cursor-pointer"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                When enabled, automatically triggers hospital paging and prep commands when severe criteria (e.g. STEMI, LVO, DKA) are detected.
              </p>
            </div>
          </div>

          {/* Current Template Customization Details */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Active Template Metadata: {currentTemplate.name}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Specialty</span>
                <strong className="text-slate-900 dark:text-slate-100">{currentTemplate.specialty}</strong>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Guidelines</span>
                <strong className="text-slate-900 dark:text-slate-100">{currentTemplate.clinicalGuidelines}</strong>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Risk Rules</span>
                <strong className="text-slate-900 dark:text-slate-100">{currentTemplate.riskSignals.length} Active Rules</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 5: COUNTRY & HOSPITAL LOCALIZATION */}
      {/* ========================================================================= */}
      {activeTabMode === 'localization' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600" />
              Country Guidelines & Hospital Tier Localization
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select national clinical practice standards, emergency codes, units of measurement, and facility tier capabilities.
            </p>
          </div>

          <div className="space-y-6">
            {/* Country Guideline Selectors */}
            <div className="space-y-3">
              <label className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                1. Select Country Clinical Practice Guidelines
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {LOCALIZATION_CONFIGS.map((loc) => {
                  const isLocSelected = loc.id === selectedLocalizationId;

                  return (
                    <button
                      key={loc.id}
                      id={`btn-loc-${loc.id}`}
                      onClick={() => setSelectedLocalizationId(loc.id)}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isLocSelected
                          ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-600 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/20'
                          : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{loc.flagEmoji}</span>
                        <div className="font-bold text-xs">{loc.name}</div>
                      </div>
                      <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <div>Agency: <strong>{loc.guidelineAgency}</strong></div>
                        <div>Triage: <strong>{loc.triageSystem}</strong></div>
                        <div>Units: {loc.units.glucose}, {loc.units.temperature}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hospital Tier Selectors */}
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <label className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                2. Select Hospital Facility Tier & Capabilities
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {HOSPITAL_TIER_CONFIGS.map((tier) => {
                  const isTierSelected = tier.id === selectedTierId;

                  return (
                    <button
                      key={tier.id}
                      id={`btn-tier-${tier.id}`}
                      onClick={() => setSelectedTierId(tier.id)}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isTierSelected
                          ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-600 text-purple-900 dark:text-purple-100 ring-2 ring-purple-500/20'
                          : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="font-bold text-xs mb-2">{tier.name}</div>
                      <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <div>Cath Lab: {tier.cathLabAvailable ? '✅ 24/7' : '❌ Transfer'}</div>
                        <div>Thrombectomy: {tier.thrombectomyAvailable ? '✅ Yes' : '❌ Transfer'}</div>
                        <div>Response: <strong>{tier.specialistEscalationTime}</strong></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedPatient && (
        <PatientConsultantRoutingModal
          isOpen={showRoutingModal}
          onClose={() => setShowRoutingModal(false)}
          patientId={selectedPatient.id}
          encounterId={activeEncounterId}
          patientName={selectedPatient.fullName}
          mrn={selectedPatient.mrn}
          chiefComplaint={
            activeEncounter?.chiefComplaint ||
            `${currentTemplate.name} specialist review requested`
          }
          triageCategory={`${currentTemplate.specialty} / ${maxRiskSeverity}`}
          currentAttending={activeEncounter?.attendingPhysician || 'Unassigned'}
          sourceRefs={
            savedIntakeArtifact ? [savedIntakeArtifact.intakeArtifactId] : []
          }
          sourceArtifactId={savedIntakeArtifact?.intakeArtifactId}
          sourceArtifactType={savedIntakeArtifact ? 'DISEASE_INTAKE' : undefined}
          onRoutedSuccess={() => setShowRoutingModal(false)}
        />
      )}
    </div>
  );
}
