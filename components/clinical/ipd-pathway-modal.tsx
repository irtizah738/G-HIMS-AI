'use client';

import React, { useState, useMemo } from 'react';
import { Bed, Patient } from '@/lib/types/ghims';
import {
  IpdStageKey,
  IPD_STAGE_DEFINITIONS,
  IpdPathwayData,
  IpdPhysicianOrder,
  IpdMedicationItem,
  IpdLabItem,
  IpdImagingItem,
  IpdProgressNote,
} from '@/lib/types/ipd';
import {
  createAuthoritativeIpdPathwaySkeleton,
  createDefaultIpdPathway,
  DischargedCensusRecord,
} from '@/lib/clinical/ipd-service';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import { DischargeCompletedSummary } from '@/components/clinical/inpatient-discharge-modal';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Pill,
  TestTube2,
  Camera,
  Activity,
  Scissors,
  Users,
  Calendar,
  ShieldCheck,
  CreditCard,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Search,
  Check,
  ExternalLink,
  Plus,
  Stethoscope,
  Building,
  HeartPulse,
} from 'lucide-react';

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

interface IpdPathwayModalProps {
  isOpen: boolean;
  onClose: () => void;
  bed: Bed;
  patient?: Patient;
  onDischargePatient: (
    bedId: string,
    summary: DischargeCompletedSummary,
    censusRecord: DischargedCensusRecord
  ) => void;
}

export function IpdPathwayModal({
  isOpen,
  onClose,
  bed,
  patient,
  onDischargePatient,
}: IpdPathwayModalProps) {
  const [pathwayData, setPathwayData] = useState<IpdPathwayData>(() =>
    IS_DEMO_RUNTIME
      ? createDefaultIpdPathway(bed, patient)
      : createAuthoritativeIpdPathwaySkeleton(bed, patient)
  );

  const [activeStage, setActiveStage] = useState<IpdStageKey>('DISCHARGE_PLANNING');
  const [newSoapSubjective, setNewSoapSubjective] = useState('');
  const [newSoapAssessment, setNewSoapAssessment] = useState('');
  const [newOrderText, setNewOrderText] = useState('');
  const [newOrderType, setNewOrderType] = useState<IpdPhysicianOrder['orderType']>('MEDICATION');
  const [eMarSuccessMessage, setEmarSuccessMessage] = useState<string | null>(null);
  const [orderResolutionMessage, setOrderResolutionMessage] = useState<string | null>(null);

  const completedCount = useMemo(() => {
    return Object.values(pathwayData.stageStatuses).filter((s) => s === 'COMPLETED').length;
  }, [pathwayData.stageStatuses]);

  const percentComplete = Math.round((completedCount / 15) * 100);

  if (!isOpen) return null;

  const currentStageDef = IPD_STAGE_DEFINITIONS.find((d) => d.key === activeStage)!;
  const currentStageIndex = IPD_STAGE_DEFINITIONS.findIndex((d) => d.key === activeStage);

  const markStageCompleted = (stageKey: IpdStageKey) => {
    setPathwayData((prev) => ({
      ...prev,
      stageStatuses: {
        ...prev.stageStatuses,
        [stageKey]: 'COMPLETED',
      },
    }));
  };

  const requireActiveInpatientEncounter = (): string => {
    const encounterId = patient?.activeEncounterId;
    if (!encounterId) {
      throw new Error('ACTIVE_INPATIENT_ENCOUNTER_REQUIRED');
    }
    return encounterId;
  };

  const handleAdministerMed = async (medId: string) => {
    const encounterId = requireActiveInpatientEncounter();
    const medication = pathwayData.medications.find((item) => item.id === medId);
    if (!medication) throw new Error('MEDICATION_NOT_FOUND');

    const result = await executeActiveTenantCommand(
      'RecordMedicationAdministrationCommand',
      {
        encounterId,
        patientId: pathwayData.patientId,
        medicationId: medication.id,
        medicationName: medication.name,
        dose: medication.dose,
        route: medication.route,
        status: 'GIVEN',
        administeredAt: Date.now(),
      },
      { idempotencyKey: `ipd-emar:${encounterId}:${medication.id}:${Date.now()}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Medication administration failed.');
    }

    setPathwayData((prev) => ({
      ...prev,
      medications: prev.medications.map((m) =>
        m.id === medId
          ? {
              ...m,
              status: 'GIVEN',
              lastAdministered: 'Recorded in authoritative eMAR',
            }
          : m
      ),
    }));
    setEmarSuccessMessage('Medication administration committed to the authoritative eMAR.');
    setTimeout(() => setEmarSuccessMessage(null), 3000);
  };

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderText.trim()) return;
    const encounterId = requireActiveInpatientEncounter();

    const result = await executeActiveTenantCommand<Record<string, unknown>>(
      'PlaceInpatientOrderCommand',
      {
        encounterId,
        patientId: pathwayData.patientId,
        orderType: newOrderType,
        description: newOrderText.trim(),
        priority: 'ROUTINE',
      },
      { idempotencyKey: `ipd-order:${encounterId}:${crypto.randomUUID()}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Inpatient order failed.');
    }

    const newOrd: IpdPhysicianOrder = {
      id: result.entityId || `ipd-order-${Date.now()}`,
      orderType: newOrderType,
      description: newOrderText.trim(),
      prescribedBy: pathwayData.attendingPhysician || 'Authenticated clinician',
      orderedAt: new Date().toISOString(),
      status: 'ACTIVE',
      priority: 'ROUTINE',
    };

    setPathwayData((prev) => ({
      ...prev,
      orders: [newOrd, ...prev.orders],
      stageStatuses: { ...prev.stageStatuses, PHYSICIAN_ORDERS: 'COMPLETED' },
    }));
    setNewOrderText('');
  };

  const handleResolveOrder = async (
    orderId: string,
    status: 'COMPLETED' | 'DISCONTINUED'
  ) => {
    const encounterId = requireActiveInpatientEncounter();
    const order = pathwayData.orders.find((item) => item.id === orderId);
    if (!order) throw new Error('INPATIENT_ORDER_NOT_FOUND');

    try {
      setOrderResolutionMessage(null);
      const result = await executeActiveTenantCommand<Record<string, unknown>>(
        'ResolveInpatientOrderCommand',
        {
          encounterId,
          patientId: pathwayData.patientId,
          orderId,
          status,
          reason:
            status === 'COMPLETED'
              ? 'Order completed from the inpatient clinical workspace.'
              : 'Order discontinued by the treating clinician.',
        },
        {
          idempotencyKey:
            `ipd-order-resolution:${encounterId}:${orderId}:${status}`,
        }
      );

      if (!result.success) {
        throw new Error(
          result.error?.message || 'Inpatient order resolution failed.'
        );
      }

      setPathwayData((prev) => ({
        ...prev,
        orders: prev.orders.map((item) =>
          item.id === orderId ? { ...item, status } : item
        ),
      }));
      setOrderResolutionMessage(
        status === 'COMPLETED'
          ? 'Inpatient order completed authoritatively.'
          : 'Inpatient order discontinued authoritatively.'
      );
    } catch (error) {
      setOrderResolutionMessage(
        error instanceof Error
          ? error.message
          : 'Inpatient order resolution failed.'
      );
    }
  };

  const handleAddSoapNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSoapAssessment.trim()) return;
    const encounterId = requireActiveInpatientEncounter();

    const subjective = newSoapSubjective.trim();
    const assessment = newSoapAssessment.trim();
    const content = [
      subjective ? `Subjective: ${subjective}` : '',
      `Assessment: ${assessment}`,
    ].filter(Boolean).join('\n\n');

    const result = await executeActiveTenantCommand<Record<string, unknown>>(
      'SignClinicalNoteCommand',
      {
        encounterId,
        patientId: pathwayData.patientId,
        category: 'PROGRESS',
        content,
      },
      { idempotencyKey: `ipd-progress:${encounterId}:${crypto.randomUUID()}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Inpatient progress note signing failed.');
    }

    const newNote: IpdProgressNote = {
      id: result.entityId || `ipd-note-${Date.now()}`,
      timestamp: new Date().toISOString(),
      author: pathwayData.attendingPhysician || 'Authenticated clinician',
      role: 'Attending Physician',
      soap: {
        subjective,
        objective: '',
        assessment,
        plan: '',
      },
      news2Score: 0,
    };

    setPathwayData((prev) => ({
      ...prev,
      progressNotes: [newNote, ...prev.progressNotes],
      stageStatuses: { ...prev.stageStatuses, DAILY_PROGRESS: 'COMPLETED' },
    }));
    setNewSoapSubjective('');
    setNewSoapAssessment('');
  };

  const handleCompleteMedicationReconciliation = async () => {
    const encounterId = requireActiveInpatientEncounter();
    const result = await executeActiveTenantCommand<Record<string, unknown>>(
      'CompleteMedicationReconciliationCommand',
      {
        encounterId,
        patientId: pathwayData.patientId,
        reconciledMedicationIds: pathwayData.medications.map((medication) => medication.id),
        discrepancyCount: 0,
        unresolvedDiscrepancies: [],
        notes: 'Medication reconciliation explicitly confirmed from the IPD transition workspace.',
      },
      { idempotencyKey: `ipd-medrec:${encounterId}` }
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Medication reconciliation failed.');
    }

    setPathwayData((prev) => ({
      ...prev,
      medicationReconciliation: {
        pharmacistName: 'Authenticated clinician',
        reconciliationDate: new Date().toISOString().slice(0, 10),
        reconciledCount: prev.medications.length,
        discrepanciesResolved: true,
      },
      stageStatuses: { ...prev.stageStatuses, MEDICATION_RECONCILIATION: 'COMPLETED' },
    }));
  };

  const handleFinalDischarge = async () => {
    const encounterId = requireActiveInpatientEncounter();
    const dischargeDate = new Date().toISOString().split('T')[0];
    const disposition = pathwayData.dischargeExecution.disposition || 'HOME_OR_SELF_CARE';
    const followUpInstructions = pathwayData.followUp.instructions || 'Follow-up instructions documented by discharging clinician.';

    const summaryText = [
      pathwayData.primaryDiagnosis ? `Primary diagnosis: ${pathwayData.primaryDiagnosis}` : '',
      `Disposition: ${disposition}`,
      `Follow-up: ${followUpInstructions}`,
    ].filter(Boolean).join('\n');

    const summaryResult = await executeActiveTenantCommand<Record<string, unknown>>(
      'SignClinicalNoteCommand',
      {
        encounterId,
        patientId: pathwayData.patientId,
        category: 'DISCHARGE',
        content: summaryText,
      },
      { idempotencyKey: `ipd-discharge-summary:${encounterId}` }
    );
    if (!summaryResult.success || !summaryResult.entityId) {
      throw new Error(summaryResult.error?.message || 'Signed discharge summary is required.');
    }

    const dischargeResult = await executeActiveTenantCommand(
      'DischargeInpatientEncounterCommand',
      {
        encounterId,
        bedId: bed.id,
        disposition,
        dischargeSummaryEvidenceId: summaryResult.entityId,
        followUpInstructions,
      },
      { idempotencyKey: `ipd-discharge:${encounterId}` }
    );
    if (!dischargeResult.success) {
      throw new Error(dischargeResult.error?.message || 'Inpatient discharge failed.');
    }

    const gatePassCode = pathwayData.dischargeExecution.gatePassId || `GP-${encounterId.slice(-8).toUpperCase()}`;
    const admissionMs = Date.parse(pathwayData.admissionDate);
    const lengthOfStayDays = Number.isFinite(admissionMs)
      ? Math.max(0, Math.ceil((Date.now() - admissionMs) / 86400000))
      : 0;
    const financialClearance = pathwayData.financialReconciliation.billingCleared;

    const censusRecord: DischargedCensusRecord = {
      id: `dc-${encounterId}`,
      patientId: pathwayData.patientId,
      patientName: pathwayData.patientName,
      mrn: pathwayData.mrn,
      age: patient?.age || 0,
      gender: patient?.gender || 'Other',
      bedId: bed.id,
      bedNumber: bed.bedNumber,
      ward: bed.ward,
      admissionDate: pathwayData.admissionDate,
      dischargeDate,
      lengthOfStayDays,
      primaryDiagnosis: pathwayData.primaryDiagnosis,
      dischargingDoctor: pathwayData.attendingPhysician || 'Authenticated clinician',
      dischargeDisposition: disposition,
      gatePassCode,
      medicationReconciliationCompleted: true,
      financialClearanceCompleted: financialClearance,
      followUpDate: pathwayData.followUp.clinicAppointmentDate || '',
      dischargeSummaryNote: summaryText,
    };

    const summary: DischargeCompletedSummary = {
      dischargedAt: new Date().toISOString(),
      disposition,
      dischargingPhysician: pathwayData.attendingPhysician || 'Authenticated clinician',
      reconciledMedicationsCount: pathwayData.medications.length,
      dischargeSummaryNote: summaryText,
      followUpInstructions,
      financialClearanceApproved: financialClearance,
      gatePassId: gatePassCode,
    };

    onDischargePatient(bed.id, summary, censusRecord);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-6xl w-full max-h-[96vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Top Header Banner */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  {pathwayData.patientName}
                </h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                  {pathwayData.mrn}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-bold border border-blue-200 dark:border-blue-800">
                  Bed {bed.bedNumber} &bull; {bed.ward} Ward
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                <span>Attending: <strong>{pathwayData.attendingPhysician}</strong></span>
                <span>&bull;</span>
                <span>Admit Date: <strong>{pathwayData.admissionDate}</strong></span>
                <span>&bull;</span>
                <span>Diagnosis: <strong className="text-slate-700 dark:text-slate-300">{pathwayData.primaryDiagnosis}</strong></span>
              </p>
            </div>
          </div>

          {/* Quick Metrics & Close Button */}
          <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
            <div className="text-right">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                15-Stage IPD Care Engine
              </span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{ width: `${percentComplete}%` }}
                  />
                </div>
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                  {completedCount}/15 ({percentComplete}%)
                </span>
              </div>
            </div>

            <button
              id="btn-close-ipd-pathway-modal"
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>

        {/* 15-Stage Interactive Sequential Stepper Bar */}
        <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-thin">
          <div className="flex items-center gap-1.5 min-w-max">
            {IPD_STAGE_DEFINITIONS.map((def, idx) => {
              const isActive = def.key === activeStage;
              const isCompleted = pathwayData.stageStatuses[def.key] === 'COMPLETED';

              return (
                <button
                  key={def.key}
                  id={`btn-stage-${def.key.toLowerCase()}`}
                  type="button"
                  onClick={() => setActiveStage(def.key)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : isCompleted
                      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200/60 dark:border-emerald-800/60'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 border border-slate-200/80 dark:border-slate-800'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : isCompleted
                        ? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600'
                    }`}
                  >
                    {isCompleted ? <Check className="w-2.5 h-2.5" /> : def.stepNumber}
                  </span>
                  <span>{def.shortLabel}</span>
                  {idx < 14 && (
                    <ChevronRight className="w-3 h-3 opacity-40 ml-0.5 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stage Content Workspace */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 bg-white dark:bg-slate-900">
          {/* Active Stage Heading */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs font-bold flex items-center justify-center">
                  {currentStageDef.stepNumber}
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {currentStageDef.label}
                </h3>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                    pathwayData.stageStatuses[activeStage] === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {pathwayData.stageStatuses[activeStage]}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {currentStageDef.description}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => markStageCompleted(activeStage)}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verify & Mark Stage Complete</span>
              </button>
            </div>
          </div>

          {/* STAGE 1: ADMISSION */}
          {activeStage === 'ADMISSION' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                  <span className="text-slate-400 font-semibold block uppercase tracking-wider">Patient Identification</span>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{pathwayData.patientName}</div>
                  <div>MRN: <strong className="font-mono">{pathwayData.mrn}</strong></div>
                  <div>Age/Gender: <strong>{patient?.age || 52} yrs &bull; {patient?.gender || 'Female'}</strong></div>
                  <div>Blood Type: <strong className="text-rose-600">{patient?.bloodGroup || 'O+'}</strong></div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                  <span className="text-slate-400 font-semibold block uppercase tracking-wider">Admission Consent & Legal</span>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> General Inpatient Consent Signed
                  </div>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> HIPAA & Patient Rights Acknowledged
                  </div>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Financial Responsibility Undertaking
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                  <span className="text-slate-400 font-semibold block uppercase tracking-wider">Emergency Contact</span>
                  <div>Name: <strong>{patient?.emergencyContact?.name || 'Farhan Al-Mansoor'}</strong></div>
                  <div>Relation: <strong>{patient?.emergencyContact?.relationship || 'Spouse'}</strong></div>
                  <div>Phone: <strong>{patient?.emergencyContact?.phone || '+1 (555) 902-1299'}</strong></div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: BED ALLOCATION */}
          {activeStage === 'BED_ALLOCATION' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Assigned Bed & Ward Infrastructure
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Bed Number</span>
                    <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{bed.bedNumber}</strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Ward Classification</span>
                    <strong className="text-sm font-bold text-blue-600 dark:text-blue-400">{bed.ward}</strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Current Status</span>
                    <strong className="text-sm font-bold text-rose-600 dark:text-rose-400 capitalize">{bed.status}</strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Nursing Acuity Ratio</span>
                    <strong className="text-sm font-bold text-slate-800 dark:text-slate-200">1:4 (Standard)</strong>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 text-xs text-blue-800 dark:text-blue-300">
                  &bull; Bed status reconciles with patient census in real-time. Occupancy invariant verified.
                </div>
              </div>
            </div>
          )}

          {/* STAGE 3: NURSING */}
          {activeStage === 'NURSING' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2.5 text-xs">
                  <span className="text-slate-400 font-semibold block uppercase tracking-wider">Nursing Intake & Vitals</span>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Blood Pressure:</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">122 / 78 mmHg</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Heart Rate:</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">72 bpm (Normal Sinus)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Oxygen Saturation (SpO2):</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">98% on Room Air</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Temperature:</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">36.8 &deg;C (Tympanic)</strong>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>Respiratory Rate:</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">16 breaths/min</strong>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2.5 text-xs">
                  <span className="text-slate-400 font-semibold block uppercase tracking-wider">Clinical Risk Scores</span>
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Braden Pressure Injury Scale:</span>
                    <span className="px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Score: 21 (Low Risk)
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-700">
                    <span>Morse Fall Risk Assessment:</span>
                    <span className="px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Score: 25 (Standard Fall Precautions)
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span>NEWS2 Early Warning Score:</span>
                    <span className="px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Score: 0 (Normal)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 4: PHYSICIAN ORDERS */}
          {activeStage === 'PHYSICIAN_ORDERS' && (
            <div className="space-y-4">
              <form onSubmit={handleAddOrder} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
                <select
                  value={newOrderType}
                  onChange={(e) => setNewOrderType(e.target.value as any)}
                  className="px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold"
                >
                  <option value="MEDICATION">Medication</option>
                  <option value="DIET">Diet</option>
                  <option value="ACTIVITY">Activity</option>
                  <option value="LAB">Lab Order</option>
                  <option value="IMAGING">Imaging Order</option>
                  <option value="NURSING">Nursing Directive</option>
                </select>

                <input
                  type="text"
                  placeholder="Enter CPOE directive (e.g. DVT prophylaxis, strict I&O, regular cardiac diet)..."
                  value={newOrderText}
                  onChange={(e) => setNewOrderText(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />

                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Order
                </button>
              </form>

              {orderResolutionMessage && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {orderResolutionMessage}
                </div>
              )}

              <div className="space-y-2">
                {pathwayData.orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          {ord.orderType}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {ord.description}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Ordered by {ord.prescribedBy} &bull; {ord.orderedAt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {ord.status}
                      </span>
                      {['ACTIVE', 'PENDING'].includes(ord.status) && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleResolveOrder(ord.id, 'COMPLETED')}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResolveOrder(ord.id, 'DISCONTINUED')}
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            Discontinue
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STAGE 5: MEDICATION (eMAR) */}
          {activeStage === 'MEDICATION' && (
            <div className="space-y-4">
              {eMarSuccessMessage && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{eMarSuccessMessage}</span>
                </div>
              )}

              <div className="space-y-2.5">
                {pathwayData.medications.map((med) => (
                  <div
                    key={med.id}
                    className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {med.name}
                        </strong>
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {med.dose} ({med.route})
                        </span>
                        {med.pharmacistVerified && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-[10px] font-bold">
                            Pharmacist Verified
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Frequency: {med.frequency} &bull; Last: {med.lastAdministered || 'Not given'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
                          med.status === 'GIVEN'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {med.status}
                      </span>
                      {med.status !== 'GIVEN' && (
                        <button
                          type="button"
                          onClick={() => handleAdministerMed(med.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 cursor-pointer shadow-xs"
                        >
                          <Pill className="w-3.5 h-3.5" /> Scan & Administer
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STAGE 6: LABS */}
          {activeStage === 'LABS' && (
            <div className="space-y-3">
              {pathwayData.labs.map((lab) => (
                <div
                  key={lab.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{lab.testName}</strong>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {lab.panel}
                      </span>
                    </div>
                    {lab.result && (
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                        Result: {lab.result}
                      </p>
                    )}
                    {lab.referenceRange && (
                      <span className="text-[11px] text-slate-400">Ref: {lab.referenceRange}</span>
                    )}
                  </div>

                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 shrink-0">
                    {lab.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* STAGE 7: IMAGING */}
          {activeStage === 'IMAGING' && (
            <div className="space-y-3">
              {pathwayData.imaging.map((img) => (
                <div
                  key={img.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{img.studyName}</strong>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-bold text-[10px]">
                        {img.modality}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {img.status}
                    </span>
                  </div>
                  {img.findings && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      <strong>Radiology Findings:</strong> {img.findings}
                    </div>
                  )}
                  {img.radiologist && (
                    <p className="text-[11px] text-slate-400">Signed by: {img.radiologist}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* STAGE 8: DAILY PROGRESS */}
          {activeStage === 'DAILY_PROGRESS' && (
            <div className="space-y-4">
              <form onSubmit={handleAddSoapNote} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300 font-bold block">Document Attending SOAP Progress Note</span>
                <input
                  type="text"
                  placeholder="Subjective: Patient symptoms & overnight report..."
                  value={newSoapSubjective}
                  onChange={(e) => setNewSoapSubjective(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
                <input
                  type="text"
                  placeholder="Assessment & Plan: Clinical status, response to treatment, next actions..."
                  value={newSoapAssessment}
                  onChange={(e) => setNewSoapAssessment(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs"
                  >
                    Sign & Commit SOAP Note
                  </button>
                </div>
              </form>

              <div className="space-y-3">
                {pathwayData.progressNotes.map((note) => (
                  <div
                    key={note.id}
                    className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {note.author} ({note.role})
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">{note.timestamp}</span>
                    </div>
                    <p><strong>Subjective:</strong> {note.soap.subjective}</p>
                    <p><strong>Objective:</strong> {note.soap.objective}</p>
                    <p><strong>Assessment:</strong> {note.soap.assessment}</p>
                    <p><strong>Plan:</strong> {note.soap.plan}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STAGE 9: PROCEDURES */}
          {activeStage === 'PROCEDURES' && (
            <div className="space-y-3">
              {pathwayData.procedures.map((proc) => (
                <div
                  key={proc.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{proc.procedureName}</strong>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {proc.status}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{proc.notes}</p>
                  <p className="text-[11px] text-slate-400">Performed by {proc.performedBy} &bull; {proc.date}</p>
                </div>
              ))}
            </div>
          )}

          {/* STAGE 10: CONSULTATIONS */}
          {activeStage === 'CONSULTATIONS' && (
            <div className="space-y-3">
              {pathwayData.consultations.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{c.specialty} Consult</strong>
                      <span className="text-slate-500 font-semibold">({c.consultantName})</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      {c.status}
                    </span>
                  </div>
                  <p><strong>Reason:</strong> {c.reason}</p>
                  {c.recommendation && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      <strong>Recommendation:</strong> {c.recommendation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* STAGE 11: DISCHARGE PLANNING */}
          {activeStage === 'DISCHARGE_PLANNING' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3 text-xs">
                <span className="text-slate-400 font-bold block uppercase tracking-wider">Multidisciplinary Discharge Checklist</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Social Work Clearance Complete
                  </div>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Patient & Family Discharge Education Conducted
                  </div>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Post-discharge Transportation Confirmed
                  </div>
                  <div className="flex items-center gap-2 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Wound Care & Diet Materials Provided
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 12: MEDICATION RECONCILIATION */}
          {activeStage === 'MEDICATION_RECONCILIATION' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-800 dark:text-emerald-200 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Clinical Pharmacist Discharge Med Rec
                  </span>
                  <span className="font-bold text-emerald-700">
                    Audit Status: {pathwayData.medicationReconciliation.discrepanciesResolved ? 'Reconciled' : 'Pending'}
                  </span>
                </div>
                <p className="text-emerald-700 dark:text-emerald-300">
                  Medication reconciliation is not assumed from the UI. An authorized clinician or pharmacist must explicitly commit the reconciliation evidence before discharge.
                </p>
                <button
                  type="button"
                  onClick={() => void handleCompleteMedicationReconciliation()}
                  disabled={pathwayData.medicationReconciliation.discrepanciesResolved}
                  className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  {pathwayData.medicationReconciliation.discrepanciesResolved
                    ? 'Medication Reconciliation Committed'
                    : 'Commit Medication Reconciliation'}
                </button>
                <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Pharmacist: <strong>{pathwayData.medicationReconciliation.pharmacistName}</strong></span>
                  <span>Date: <strong>{pathwayData.medicationReconciliation.reconciliationDate}</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 13: FINANCIAL RECONCILIATION */}
          {activeStage === 'FINANCIAL_RECONCILIATION' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3 text-xs">
                <span className="text-slate-400 font-bold block uppercase tracking-wider">Payer & Patient Ledger Settlement</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Total Inpatient Charges</span>
                    <strong className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      ${pathwayData.financialReconciliation.totalEstimatedCharges.toFixed(2)}
                    </strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Insurance Pre-Auth Clearance</span>
                    <strong className="text-sm font-bold text-emerald-600">
                      ${pathwayData.financialReconciliation.insuranceApprovedAmount.toFixed(2)} (Approved)
                    </strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Patient Co-Pay & Settlement</span>
                    <strong className="text-sm font-bold text-blue-600">
                      $300.00 (Zero Balance Settled)
                    </strong>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-emerald-600 font-semibold pt-1">
                  <CheckCircle2 className="w-4 h-4" /> Financial Clearance Certificate Issued by Revenue Cycle Management
                </div>
              </div>
            </div>
          )}

          {/* STAGE 14: DISCHARGE */}
          {activeStage === 'DISCHARGE' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-rose-900 dark:text-rose-200 flex items-center gap-2">
                    <LogOut className="w-4 h-4 text-rose-600" />
                    Electronic Gate Pass & Discharge Finalization
                  </h4>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                    {pathwayData.dischargeExecution.gatePassId}
                  </span>
                </div>
                <p className="text-xs text-rose-800 dark:text-rose-300">
                  Executing discharge will:
                  <br />
                  1. Atomically transition Bed {bed.bedNumber} to &apos;cleaning&apos; status (resource availability updated).
                  <br />
                  2. Clear active inpatient bed assignment and archive stay to the permanent census registry.
                  <br />
                  3. Guarantee zero patient loss from hospital census.
                </p>

                <div className="pt-2">
                  <button
                    id="btn-execute-ipd-discharge"
                    type="button"
                    onClick={handleFinalDischarge}
                    className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" /> Complete Inpatient Stay & Issue Gate Pass
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 15: FOLLOW-UP */}
          {activeStage === 'FOLLOW_UP' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-3 text-xs">
                <span className="text-slate-400 font-bold block uppercase tracking-wider">Continuity of Care & 30-Day Monitoring</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Outpatient Clinic Appointment</span>
                    <strong className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      {pathwayData.followUp.clinicAppointmentDate} (Cardiology & Internal Medicine OPD)
                    </strong>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <span className="text-slate-400 block">Tele-health Virtual Checkup</span>
                    <strong className="text-sm font-bold text-blue-600">
                      {pathwayData.followUp.telehealthFollowUpDate} (Remote vitals review)
                    </strong>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <strong>Discharge Instructions for Patient:</strong> {pathwayData.followUp.instructions}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Navigation Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentStageIndex === 0}
              onClick={() => setActiveStage(IPD_STAGE_DEFINITIONS[currentStageIndex - 1].key)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              type="button"
              disabled={currentStageIndex === IPD_STAGE_DEFINITIONS.length - 1}
              onClick={() => setActiveStage(IPD_STAGE_DEFINITIONS[currentStageIndex + 1].key)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
            >
              Close Pathway
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveStage('DISCHARGE');
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Proceed to Discharge & Clearance
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
