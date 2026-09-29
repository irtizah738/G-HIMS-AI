'use client';

import React, { useState, useEffect } from 'react';
import {
  WorkflowDefinition,
  ClinicalStageType,
  PatientMpiRecord,
  EncounterRuntimePlan,
  WorkflowSnapshot,
  ClinicalEventEnvelope,
  OutboxEventRecord,
  PatientTimelineProjection,
  StageTransitionResult,
} from '@/types/clinical-workflow';
import { CompiledGeneralOpdWorkflow } from '@/lib/clinical/workflow/compiler';
import { GlobalStageTransitionResolver } from '@/lib/clinical/workflow/transition-resolver';
import { generateDeterministicMatchKeys, generateInstitutionalMrn, calculateSoundex } from '@/lib/clinical/mpi/patient-mpi';
import { TimelineProjector } from '@/lib/clinical/projections/timeline';
import { createPatientRegisteredEvent, createEncounterCreatedEvent } from '@/lib/clinical/events/envelope';
import { SpecialtyClinicalEnrichmentPipeline } from '@/components/workflow/SpecialtyClinicalEnrichmentPipeline';
import {
  Sparkles,
  GitFork,
  ArrowRight,
  ShieldCheck,
  Clock,
  UserPlus,
  Send,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Layers,
  FileText,
  Activity,
  Zap,
  Server,
  Lock,
  Search,
  Database,
  Sliders,
  ChevronRight,
  Stethoscope,
  Receipt,
  HeartPulse,
} from 'lucide-react';

export interface WorkflowRuntimeViewProps {
  embeddedInOpd?: boolean;
  activePatient?: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    gender?: 'Male' | 'Female' | 'Other';
    phone?: string;
    nationalId?: string;
    chiefComplaint?: string;
    department?: string;
    mrn?: string;
  };
  onClose?: () => void;
}

export function WorkflowRuntimeView({ embeddedInOpd = false, activePatient, onClose }: WorkflowRuntimeViewProps = {}) {
  const [activeSubTab, setActiveSubTab] = useState<'specialty_pipeline' | 'dag' | 'intake' | 'resolver' | 'timeline' | 'outbox'>('specialty_pipeline');

  // Intake Form State
  const [firstName, setFirstName] = useState(activePatient?.firstName || 'Eleanor');
  const [lastName, setLastName] = useState(activePatient?.lastName || 'Vance');
  const [dob, setDob] = useState(activePatient?.dob || '1984-06-12');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>(activePatient?.gender || 'Female');
  const [phone, setPhone] = useState(activePatient?.phone || '+1 (555) 234-8901');
  const [nationalId, setNationalId] = useState(activePatient?.nationalId || 'NAT-8492041');
  const [chiefComplaint, setChiefComplaint] = useState(activePatient?.chiefComplaint || 'Persistent thoracic pain and shortness of breath upon mild exertion');
  const [department, setDepartment] = useState(activePatient?.department || 'Cardiology OPD');
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT' | 'EMERGENCY'>('URGENT');
  const [selectedPhysician, setSelectedPhysician] = useState('Dr. Sarah Jenkins, MD (Cardiologist)');
  const [tariffPlan, setTariffPlan] = useState('Commercial PPO Tier-1');
  const [copayPercent, setCopayPercent] = useState(15);

  // Sync if activePatient changes
  useEffect(() => {
    if (activePatient) {
      if (activePatient.firstName) setFirstName(activePatient.firstName);
      if (activePatient.lastName) setLastName(activePatient.lastName);
      if (activePatient.dob) setDob(activePatient.dob);
      if (activePatient.gender) setGender(activePatient.gender);
      if (activePatient.phone) setPhone(activePatient.phone);
      if (activePatient.nationalId) setNationalId(activePatient.nationalId);
      if (activePatient.chiefComplaint) setChiefComplaint(activePatient.chiefComplaint);
      if (activePatient.department) setDepartment(activePatient.department);
    }
  }, [activePatient]);

  // Transition Resolver State
  const [currentStage, setCurrentStage] = useState<ClinicalStageType>('TRIAGE');
  const [targetStage, setTargetStage] = useState<ClinicalStageType>('CONSULTATION');
  const [resolverRole, setResolverRole] = useState('practitioner');
  const [vitalsEntered, setVitalsEntered] = useState(true);
  const [news2Score, setNews2Score] = useState(4);
  const [soapSigned, setSoapSigned] = useState(false);
  const [billingCleared, setBillingCleared] = useState(false);
  const [emergencyOverride, setEmergencyOverride] = useState(false);
  const [resolutionResult, setResolutionResult] = useState<StageTransitionResult | null>(null);

  // Execution & Transaction History
  const [isExecuting, setIsExecuting] = useState(false);
  const [createdBundle, setCreatedBundle] = useState<any>(null);
  const [eventsStream, setEventsStream] = useState<ClinicalEventEnvelope[]>([]);
  const [outboxItems, setOutboxItems] = useState<OutboxEventRecord[]>([]);
  const [timelineProjection, setTimelineProjection] = useState<PatientTimelineProjection | null>(null);
  const [isProcessingOutbox, setIsProcessingOutbox] = useState(false);
  const [outboxProcessedCount, setOutboxProcessedCount] = useState(0);

  // Real-time Match Keys Preview
  const matchKeys = generateDeterministicMatchKeys({
    nationalId,
    firstName,
    lastName,
    dateOfBirth: dob,
    phone,
  });

  // Evaluate Resolution whenever test parameters change
  useEffect(() => {
    try {
      const res = GlobalStageTransitionResolver.resolve({
        tenantId: 'central-metro-hospital',
        encounterId: createdBundle?.encounter?.id || 'enc-demo-01',
        currentStage,
        targetStage,
        initiatorUserId: 'usr-sarah-jenkins',
        initiatorUserRole: resolverRole,
        vitals: vitalsEntered ? { news2Score } : undefined,
        soapSigned,
        billingCleared,
        overrideEmergency: emergencyOverride,
      });
      setResolutionResult(res);
    } catch (e) {
      console.error(e);
    }
  }, [currentStage, targetStage, resolverRole, vitalsEntered, news2Score, soapSigned, billingCleared, emergencyOverride, createdBundle]);

  // Handle Encounter Creation Transaction
  const handleExecuteTransaction = async () => {
    setIsExecuting(true);
    try {
      const res = await fetch('/api/clinical/encounter/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'central-metro-hospital',
          facilityCode: 'METRO',
          firstName,
          lastName,
          dateOfBirth: dob,
          gender,
          phone,
          nationalId,
          chiefComplaint,
          department,
          priority,
          attendingPhysicianName: selectedPhysician,
          tariffPlanName: tariffPlan,
          copayPercent,
          initiatorUserId: 'staff-registrar-01',
          initiatorUserName: 'Elena Vance (Registrar)',
          initiatorUserRole: 'practitioner',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCreatedBundle(data.data);

        // Project Initial Timeline
        const regEvent = createPatientRegisteredEvent({
          tenantId: 'central-metro-hospital',
          patientId: data.data.patient.id,
          mrn: data.data.patient.mrn,
          fullName: data.data.patient.fullName,
          dob: data.data.patient.dateOfBirth,
          gender: data.data.patient.gender,
          contactNumber: data.data.patient.contactNumber || '555-0199',
          producer: {
            facilityCode: 'METRO',
            userId: 'staff-registrar-01',
            userName: 'Elena Vance',
            userRole: 'practitioner',
          },
        });

        const encEvent = createEncounterCreatedEvent({
          tenantId: 'central-metro-hospital',
          encounterId: data.data.encounter.id,
          patientId: data.data.patient.id,
          patientMrn: data.data.patient.mrn,
          encounterType: data.data.encounter.encounterType,
          department: data.data.encounter.department,
          chiefComplaint: data.data.encounter.chiefComplaint,
          assignedDoctor: data.data.encounter.assignedDoctor || 'Dr. Arthur Pendelton',
          tokenNumber: data.data.queueToken.tokenNumber,
          producer: {
            facilityCode: 'METRO',
            userId: 'staff-registrar-01',
            userName: 'Elena Vance',
            userRole: 'practitioner',
          },
        });

        const proj = TimelineProjector.project({
          patientId: data.data.patient.id,
          patientMrn: data.data.patient.mrn,
          patientName: data.data.patient.fullName,
          encounterId: data.data.encounter.id,
          encounterType: data.data.encounter.encounterType,
          events: [regEvent, encEvent],
        });
        setTimelineProjection(proj);

        // Add to simulated outbox queue
        setOutboxItems((prev) => [
          {
            id: `obx_hl7_${Date.now()}`,
            tenantId: 'central-metro-hospital',
            destinationQueue: 'HL7_V2_BROKER',
            eventType: 'clinical.encounter.created',
            aggregateType: 'Encounter',
            aggregateId: data.data.encounter.id,
            payload: { mrn: data.data.patient.mrn, department: data.data.encounter.department } as any,
            status: 'PENDING',
            retryCount: 0,
            maxRetries: 5,
            scheduledFor: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            id: `obx_fhir_${Date.now()}`,
            tenantId: 'central-metro-hospital',
            destinationQueue: 'FHIR_SERVER',
            eventType: 'clinical.patient.registered',
            aggregateType: 'Patient',
            aggregateId: data.data.patient.id,
            payload: { mrn: data.data.patient.mrn, name: data.data.patient.fullName } as any,
            status: 'PENDING',
            retryCount: 0,
            maxRetries: 5,
            scheduledFor: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            id: `obx_bill_${Date.now()}`,
            tenantId: 'central-metro-hospital',
            destinationQueue: 'BILLING_SYSTEM',
            eventType: 'clinical.encounter.created',
            aggregateType: 'Encounter',
            aggregateId: data.data.encounter.id,
            payload: { tariffPlan, copayPercent } as any,
            status: 'PENDING',
            retryCount: 0,
            maxRetries: 5,
            scheduledFor: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsExecuting(false);
    }
  };

  // Process Outbox Queue
  const handleProcessOutbox = async () => {
    setIsProcessingOutbox(true);
    try {
      const res = await fetch('/api/clinical/outbox/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: outboxItems }),
      });
      const data = await res.json();
      if (data.success) {
        setOutboxProcessedCount((c) => c + data.processedCount);
        setOutboxItems((prev) =>
          prev.map((item) => ({ ...item, status: 'DISPATCHED' as any }))
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessingOutbox(false);
    }
  };

  const stagesList = Object.values(CompiledGeneralOpdWorkflow.stageNodes).sort(
    (a, b) => a.sequenceOrder - b.sequenceOrder
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-md shrink-0">
            <GitFork className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                {embeddedInOpd ? 'OPD Backend — Clinical Workflow Runtime Studio' : 'Clinical Workflow Runtime Studio'}
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                v1.2.0 DAG Engine {embeddedInOpd ? '• OPD Backend Orchestrator' : ''}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              General OPD Directed Acyclic Graph (DAG), Deterministic MPI Deduplication, Atomic Transactions & Outbox Orchestration
              {embeddedInOpd ? ' (Powering Outpatient Consultations Stage Machine)' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-400">Target Clinical SLA</p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {CompiledGeneralOpdWorkflow.totalEstimatedSlaMinutes} min End-to-End
            </p>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-2 hidden sm:block" />
          {onClose && (
            <button
              onClick={onClose}
              className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span>Back to Desk</span>
            </button>
          )}
          <button
            onClick={() => setActiveSubTab('intake')}
            className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>Launch Intake Flow</span>
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('specialty_pipeline')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'specialty_pipeline'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <HeartPulse className="w-4 h-4" />
          <span>Specialty Clinical Enrichment Pipeline</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-white/20">NEW</span>
        </button>

        <button
          onClick={() => setActiveSubTab('dag')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'dag'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <GitFork className="w-4 h-4" />
          <span>Workflow DAG Definition</span>
        </button>

        <button
          onClick={() => setActiveSubTab('intake')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'intake'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>MPI & Encounter Creation Flow</span>
        </button>

        <button
          onClick={() => setActiveSubTab('resolver')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'resolver'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Stage Transition & Guard Resolver</span>
        </button>

        <button
          onClick={() => setActiveSubTab('timeline')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'timeline'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Patient Timeline Projection</span>
        </button>

        <button
          onClick={() => setActiveSubTab('outbox')}
          className={`h-9 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'outbox'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Outbox Queue & Messaging</span>
          {outboxItems.filter((i) => i.status === 'PENDING').length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />
          )}
        </button>
      </div>

      {/* TAB 0: SPECIALTY CLINICAL ENRICHMENT PIPELINE */}
      {activeSubTab === 'specialty_pipeline' && (
        <SpecialtyClinicalEnrichmentPipeline />
      )}

      {/* TAB 1: WORKFLOW DAG DEFINITION */}
      {activeSubTab === 'dag' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <GitFork className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Compiled General OPD Workflow Stages (DAG)
                  </h2>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  Total Stages: {stagesList.length}
                </span>
              </div>

              <div className="space-y-3">
                {stagesList.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-emerald-500/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-black text-sm flex items-center justify-center shrink-0">
                        {stage.sequenceOrder}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {stage.title}
                          </span>
                          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {stage.id}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="text-[11px] text-slate-500">
                            Roles:{' '}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {stage.requiredRoles.join(', ')}
                            </strong>
                          </span>
                          {stage.guardList.length > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">
                              Guards: {stage.guardList.map((g) => g.name).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                      <div className="text-right">
                        <span className="text-[11px] text-slate-400 block">Target SLA</span>
                        <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3" />
                          {stage.targetSlaMinutes} min
                        </span>
                      </div>
                      {idx < stagesList.length - 1 && (
                        <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-700 hidden md:block" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Workflow Graph Metadata & Rules */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Clinical Governance & Guard Engine
                  </h3>
                </div>
                <div className="text-xs space-y-2.5 text-slate-600 dark:text-slate-400">
                  <div className="p-2.5 rounded-lg bg-blue-50/60 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900">
                    <strong className="text-blue-700 dark:text-blue-300 block">NEWS2 Vital Guard:</strong>
                    Requires complete systolic, pulse, respiratory rate, and SpO2. Scores &gt;= 5 trigger high-urgency escalation.
                  </div>
                  <div className="p-2.5 rounded-lg bg-purple-50/60 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900">
                    <strong className="text-purple-700 dark:text-purple-300 block">SOAP Note Signature Guard:</strong>
                    Blocks progression to diagnostics and dispensary until an attending physician digitally seals clinical documentation.
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900">
                    <strong className="text-amber-700 dark:text-amber-300 block">Billing Settlement Guard:</strong>
                    Prevents patient discharge without co-pay receipt or institutional financial waiver exception.
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-6 border border-slate-800 shadow-md space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    HIPAA §164.312(b) Cryptographic Seal
                  </h4>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Every stage transition in this workflow is cryptographically hashed with SHA-256 and immutably appended to the tenant audit ledger.
                </p>
                <div className="font-mono text-[10px] bg-slate-950 p-2 rounded border border-slate-800 text-slate-400 break-all">
                  SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PATIENT MPI & ENCOUNTER CREATION */}
      {activeSubTab === 'intake' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Master Patient Index Intake & Encounter Instantiation
                  </h2>
                  <p className="text-xs text-slate-500">
                    Atomic transaction writes MPI profile, Deterministic Keys, OPD Token, Initial Stage, Outbox & Audit Ledger.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Date of Birth (YYYY-MM-DD)</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Contact Telephone</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">National ID / Social Security</label>
                <input
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Chief Complaint</label>
                <input
                  type="text"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="Obstetrics & Gynecology (OB/GYN) OPD">Obstetrics & Gynecology (OB/GYN) OPD</option>
                  <option value="Cardiology OPD">Cardiology OPD</option>
                  <option value="General OPD">General OPD</option>
                  <option value="Pediatrics OPD">Pediatrics OPD</option>
                  <option value="Orthopedics OPD">Orthopedics OPD</option>
                  <option value="Neurology & Stroke OPD">Neurology & Stroke OPD</option>
                  <option value="Endocrinology & Metabolism OPD">Endocrinology & Metabolism OPD</option>
                  <option value="Oncology OPD">Oncology OPD</option>
                  <option value="Gastroenterology OPD">Gastroenterology OPD</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Priority Triage</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="ROUTINE">ROUTINE (Standard)</option>
                  <option value="URGENT">URGENT (Accelerated Care)</option>
                  <option value="EMERGENCY">EMERGENCY (Immediate Triage)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                id="btn-execute-encounter-transaction"
                onClick={handleExecuteTransaction}
                disabled={isExecuting}
                className="h-11 px-6 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center gap-2 shadow-md cursor-pointer active:scale-95 transition-all disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Executing Atomic Transaction...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-amber-300" />
                    <span>Execute Atomic Encounter Creation</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Deterministic Match Preview & Execution Feedback */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  MPI Deduplication Match Keys
                </h3>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">DOB + Name Hash</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400 break-all">
                    {matchKeys.dobNameHash}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Soundex (Surname)</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {matchKeys.soundexLastName} (Phonetic: &quot;{lastName}&quot;)
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">National ID Registry</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {matchKeys.nationalIdHash || 'None'}
                  </span>
                </div>
              </div>
            </div>

            {createdBundle && (
              <div className="bg-emerald-50/60 dark:bg-emerald-950/40 rounded-2xl p-6 border border-emerald-200 dark:border-emerald-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Encounter Created Atomically!</span>
                </div>
                <div className="text-xs space-y-1 text-slate-700 dark:text-slate-300">
                  <p>
                    <strong>Assigned MRN:</strong> {createdBundle.patient?.mrn || 'N/A'}
                  </p>
                  <p>
                    <strong>Queue Token:</strong> {createdBundle.queueToken?.tokenNumber || createdBundle.encounter?.tokenNumber || 'N/A'}
                  </p>
                  <p>
                    <strong>Encounter ID:</strong> {createdBundle.encounter?.id || 'N/A'}
                  </p>
                  <p>
                    <strong>Initial Stage:</strong> {createdBundle.initialStage?.stageType || createdBundle.workflowSnapshot?.currentStageId || createdBundle.encounter?.currentStageId || 'REGISTRATION'} (Active)
                  </p>
                  <p>
                    <strong>Outbox Events Generated:</strong> {createdBundle.outboxEventsCount ?? (createdBundle.outbox ? 1 : 0)}
                  </p>
                </div>
                <button
                  onClick={() => setActiveSubTab('timeline')}
                  className="w-full mt-2 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>View Longitudinal Timeline</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: STAGE TRANSITION & GUARD RESOLVER */}
      {activeSubTab === 'resolver' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
            <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Stage Transition Resolver & Guard Evaluation Workbench
                </h2>
                <p className="text-xs text-slate-500">
                  Test workflow DAG transitions against clinical prerequisites, RBAC permissions, NEWS2 thresholds, and financial gates.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Current Stage</label>
                <select
                  value={currentStage}
                  onChange={(e) => setCurrentStage(e.target.value as ClinicalStageType)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="REGISTRATION">REGISTRATION</option>
                  <option value="TRIAGE">TRIAGE</option>
                  <option value="CONSULTATION">CONSULTATION</option>
                  <option value="DIAGNOSTICS_LAB_RAD">DIAGNOSTICS_LAB_RAD</option>
                  <option value="PHARMACY_DISPENSARY">PHARMACY_DISPENSARY</option>
                  <option value="BILLING_SETTLEMENT">BILLING_SETTLEMENT</option>
                  <option value="DISCHARGE_OR_REFERRAL">DISCHARGE_OR_REFERRAL</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Target Stage</label>
                <select
                  value={targetStage}
                  onChange={(e) => setTargetStage(e.target.value as ClinicalStageType)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="REGISTRATION">REGISTRATION</option>
                  <option value="TRIAGE">TRIAGE</option>
                  <option value="CONSULTATION">CONSULTATION</option>
                  <option value="DIAGNOSTICS_LAB_RAD">DIAGNOSTICS_LAB_RAD</option>
                  <option value="PHARMACY_DISPENSARY">PHARMACY_DISPENSARY</option>
                  <option value="BILLING_SETTLEMENT">BILLING_SETTLEMENT</option>
                  <option value="DISCHARGE_OR_REFERRAL">DISCHARGE_OR_REFERRAL</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">Initiator Role</label>
                <select
                  value={resolverRole}
                  onChange={(e) => setResolverRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="practitioner">Practitioner (Doctor / Nurse)</option>
                  <option value="nurse">Nurse</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="biller">Biller / Cashier</option>
                  <option value="lab_tech">Lab Technician</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400 block mb-1">
                  NEWS2 Score (0-20)
                </label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={news2Score}
                  onChange={(e) => setNews2Score(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>

            {/* Boolean Guard Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vitalsEntered}
                  onChange={(e) => setVitalsEntered(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600"
                />
                <span>Vitals Complete (BP, HR, SpO2 recorded)</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soapSigned}
                  onChange={(e) => setSoapSigned(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600"
                />
                <span>Physician SOAP Note Digitally Signed</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={billingCleared}
                  onChange={(e) => setBillingCleared(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600"
                />
                <span>Invoice / Copay Settled</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emergencyOverride}
                  onChange={(e) => setEmergencyOverride(e.target.checked)}
                  className="w-4 h-4 rounded text-rose-600"
                />
                <span>Clinical Emergency Override (Bypass non-critical)</span>
              </label>
            </div>
          </div>

          {/* Resolution Result Panel */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Guard Evaluation Outcome
                </h3>
                {resolutionResult?.allowed ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ALLOWED
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> BLOCKED
                  </span>
                )}
              </div>

              {((resolutionResult?.failedGuards && resolutionResult.failedGuards.length > 0) || (resolutionResult?.unmetPrerequisites && resolutionResult.unmetPrerequisites.length > 0)) && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-rose-600 uppercase">Blocking Reasons:</span>
                  {resolutionResult.failedGuards?.map((fg, idx) => (
                    <div
                      key={`fg_${idx}`}
                      className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300"
                    >
                      <strong className="block font-semibold">{fg.name}</strong>
                      {fg.message}
                    </div>
                  ))}
                  {resolutionResult.unmetPrerequisites?.map((pr, idx) => (
                    <div
                      key={`pr_${idx}`}
                      className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300"
                    >
                      Missing Required Prerequisite: {pr}
                    </div>
                  ))}
                </div>
              )}

              {resolutionResult?.warnings && resolutionResult.warnings.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-amber-600 uppercase">Clinical Alerts:</span>
                  {resolutionResult.warnings.map((w: string, idx: number) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-300"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PATIENT TIMELINE PROJECTION */}
      {activeSubTab === 'timeline' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Longitudinal Patient Journey Timeline Projection
                </h2>
                <p className="text-xs text-slate-500">
                  Event-sourced milestone aggregation and real-time stage dwell duration analysis against target SLAs.
                </p>
              </div>
            </div>

            {timelineProjection && (
              <div className="flex items-center gap-3">
                <span className="text-xs px-3 py-1 rounded-full font-bold bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  Patient: {timelineProjection.patientName} ({timelineProjection.patientMrn})
                </span>
              </div>
            )}
          </div>

          {timelineProjection ? (
            <div className="space-y-6">
              {/* Dwell Analysis Bar */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Stage Dwell Metrics vs Target SLA
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {timelineProjection.dwellMetrics.map((dm) => (
                    <div
                      key={dm.stage}
                      className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                        {dm.stage}
                      </span>
                      <div className="flex items-center justify-between mt-1 text-slate-500">
                        <span>Dwell: {dm.durationMinutes}m</span>
                        <span className={dm.withinSla ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                          SLA: {dm.slaTargetMinutes}m
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chronological Milestones */}
              <div className="space-y-4 relative pl-6 border-l-2 border-slate-200 dark:border-slate-800">
                {timelineProjection.milestones.map((ms) => (
                  <div key={ms.id} className="relative group">
                    <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-blue-600 border-2 border-white dark:border-slate-900" />
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                          {ms.category}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(ms.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {ms.title}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {ms.summary}
                      </p>
                      <div className="text-[10px] text-slate-400 pt-1">
                        Author: {ms.authorName} ({ms.authorRole})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-xs">
              No active encounter projection loaded. Launch an intake flow from the &quot;MPI &amp; Encounter Creation Flow&quot; tab to populate.
            </div>
          )}
        </div>
      )}

      {/* TAB 5: OUTBOX QUEUE & MESSAGING */}
      {activeSubTab === 'outbox' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Transactional Outbox Queue (HL7 v2 &amp; FHIR Dispatcher)
                </h2>
                <p className="text-xs text-slate-500">
                  Guaranteed-delivery broker for asynchronous EHR messages, billing claims, and downstream analytics.
                </p>
              </div>
            </div>

            <button
              onClick={handleProcessOutbox}
              disabled={isProcessingOutbox || outboxItems.length === 0}
              className="h-9 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all disabled:opacity-50"
            >
              {isProcessingOutbox ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Process Pending Outbox ({outboxItems.filter((i) => i.status === 'PENDING').length})</span>
            </button>
          </div>

          <div className="space-y-3">
            {outboxItems.length > 0 ? (
              outboxItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {item.eventType}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.status === 'DISPATCHED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Destination Queue: <strong className="text-slate-700 dark:text-slate-300">{item.destinationQueue}</strong> | Aggregate: {item.aggregateType} ({item.aggregateId})
                    </p>
                  </div>
                  <div className="text-slate-400 font-mono text-[10px]">
                    Created: {new Date(item.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                Outbox queue is empty. Triggering an encounter intake writes transactional outbox records.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
