'use client';

import React, { useState, useEffect } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Users,
  Stethoscope,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  FileText,
  FlaskConical,
  Pill,
  Mic,
  MicOff,
  Sparkles,
  Send,
  UserCheck,
  Search,
  ChevronRight,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { OpdQueueToken } from '@/lib/types/ghims';
import { OpdMasterWorkspace } from '@/components/opd/OpdMasterWorkspace';
import { PatientConsultantRoutingModal, ConsultantDoctor } from '@/components/clinical/patient-consultant-routing-modal';
import { StandardPatientBanner } from '@/components/clinical/standard-patient-banner';
import { ConfirmPatientModal } from '@/components/clinical/confirm-patient-modal';
import { PatientContextSafetyBlock } from '@/components/clinical/patient-context-safety-block';

export interface OpdEncountersViewProps {
  initialViewMode?: 'master_suite' | 'consultation_desk';
}

export function OpdEncountersView({ initialViewMode = 'master_suite' }: OpdEncountersViewProps = {}) {
  const [viewMode, setViewMode] = useState<'master_suite' | 'consultation_desk'>(initialViewMode);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const {
    opdQueue,
    callNextOpdToken,
    completeOpdToken,
    patients,
    addClinicalNote,
    addVitals,
    selectedPatientId,
    setSelectedPatientId,
    clinicalContext,
    bindClinicalEncounter,
    setActiveTab,
  } = useHospital();

  const [selectedTokenId, setSelectedTokenId] = useState<string>('');

  // Auto-focus only when the shared patient/encounter context can be proven.
  useEffect(() => {
    const contextPatientId = clinicalContext?.patientId || selectedPatientId;
    if (!contextPatientId) return;

    const match = opdQueue.find((token) =>
      token.patientId === contextPatientId &&
      (!clinicalContext?.encounterId ||
        token.encounterId === clinicalContext.encounterId)
    );
    if (match) {
      setSelectedTokenId(match.id);
    }
  }, [
    clinicalContext?.encounterId,
    clinicalContext?.patientId,
    selectedPatientId,
    opdQueue,
  ]);

  const handleSelectToken = (token: OpdQueueToken) => {
    if (!token.encounterId) {
      setSuccessToast(
        'PATIENT_CONTEXT_UNRESOLVED: this queue token has no authoritative encounter binding.'
      );
      setTimeout(() => setSuccessToast(null), 5000);
      return;
    }
    bindClinicalEncounter({
      encounterId: token.encounterId,
      patientId: token.patientId,
      source: 'OPD_CONSULTATION_DESK',
    });
    setSelectedTokenId(token.id);
  };
  const [isRoutingModalOpen, setIsRoutingModalOpen] = useState<boolean>(false);
  const [routingPatientData, setRoutingPatientData] = useState<any>(null);
  const [chiefComplaint, setChiefComplaint] = useState<string>('');
  const [soapSubjective, setSoapSubjective] = useState<string>('');
  const [soapObjective, setSoapObjective] = useState<string>('');
  const [soapAssessment, setSoapAssessment] = useState<string>('');
  const [soapPlan, setSoapPlan] = useState<string>('');
  const [isAiStructuring, setIsAiStructuring] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Vitals entry
  const [hr, setHr] = useState<number | ''>('');
  const [bp, setBp] = useState<string>('');
  const [temp, setTemp] = useState<number | ''>('');
  const [spo2, setSpo2] = useState<number | ''>('');
  const [respiratoryRate, setRespiratoryRate] = useState<number | ''>('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedToken = selectedTokenId
    ? opdQueue.find((token) => token.id === selectedTokenId)
    : undefined;
  const patient = selectedToken
    ? patients.find((candidate) => candidate.id === selectedToken.patientId)
    : undefined;
  const patientContextReady = Boolean(
    selectedToken &&
      selectedToken.encounterId &&
      patient &&
      patient.id === selectedToken.patientId &&
      patient.mrn === selectedToken.mrn &&
      clinicalContext &&
      clinicalContext.encounterId === selectedToken.encounterId &&
      clinicalContext.patientId === patient.id
  );

  useEffect(() => {
    if (
      !selectedToken?.encounterId ||
      !selectedToken.patientId ||
      (clinicalContext?.encounterId === selectedToken.encounterId &&
        clinicalContext?.patientId === selectedToken.patientId)
    ) {
      return;
    }

    bindClinicalEncounter({
      encounterId: selectedToken.encounterId,
      patientId: selectedToken.patientId,
      source: 'OPD_CONSULTATION_DESK',
    });
  }, [
    bindClinicalEncounter,
    clinicalContext?.encounterId,
    clinicalContext?.patientId,
    selectedToken?.encounterId,
    selectedToken?.patientId,
  ]);

  const handleSaveConsultation = async () => {
    if (!patient || !selectedToken || isSaving) return;
    if (!patientContextReady) {
      setSuccessToast(
        'PATIENT_CONTEXT_MISMATCH: consultation signing is blocked until patient and encounter identity are reconciled.'
      );
      setTimeout(() => setSuccessToast(null), 5000);
      return;
    }

    const hasNarrative =
      soapSubjective.trim() ||
      soapObjective.trim() ||
      soapAssessment.trim() ||
      soapPlan.trim();

    if (!hasNarrative) {
      setSuccessToast(
        'Clinical documentation was not signed because the SOAP note is empty.'
      );
      setTimeout(() => setSuccessToast(null), 4000);
      return;
    }

    const fullContent =
      `SUBJECTIVE:\n${soapSubjective.trim()}\n\nOBJECTIVE:\n${soapObjective.trim()}\n\nASSESSMENT:\n${soapAssessment.trim()}\n\nPLAN:\n${soapPlan.trim()}`;

    const vitalsComplete =
      typeof hr === 'number' &&
      hr > 0 &&
      bp.trim().length > 0 &&
      typeof temp === 'number' &&
      temp > 0 &&
      typeof spo2 === 'number' &&
      spo2 > 0 &&
      typeof respiratoryRate === 'number' &&
      respiratoryRate > 0;

    const vitalsStarted =
      hr !== '' ||
      bp.trim().length > 0 ||
      temp !== '' ||
      spo2 !== '' ||
      respiratoryRate !== '';

    if (vitalsStarted && !vitalsComplete) {
      setSuccessToast(
        'Vitals were not recorded: complete HR, BP, temperature, respiratory rate and SpO₂, or clear the vitals fields.'
      );
      setTimeout(() => setSuccessToast(null), 5000);
      return;
    }

    try {
      setIsSaving(true);

      // Server identity/audit context owns signer identity. This UI never injects
      // diagnoses, medications, procedures or billing codes that the clinician
      // did not explicitly enter/accept.
      await addClinicalNote(patient.id, {
        author: selectedToken.assignedDoctor || 'Authenticated clinician',
        role: 'Clinician',
        category: 'SOAP',
        content: fullContent,
        aiStructuredData: {
          chiefComplaint: selectedToken.chiefComplaint,
          diagnoses: [],
          medicationsPrescribed: [],
          recommendedProcedures: [],
          billingCodes: [],
        },
      });

      if (vitalsComplete) {
        await addVitals(patient.id, {
          heartRate: hr,
          bloodPressure: bp.trim(),
          temperature: temp,
          respiratoryRate,
          oxygenSaturation: spo2,
        });
      }

      // Queue completion happens only after preceding governed clinical commands
      // have been accepted/queued successfully.
      await completeOpdToken(selectedToken.id);

      setSuccessToast(
        `Consultation signed for ${patient.fullName || 'Patient'}. No diagnosis, medication, procedure or charge code was auto-accepted.`
      );
      setTimeout(() => setSuccessToast(null), 6000);
    } catch (error) {
      setSuccessToast(
        error instanceof Error
          ? error.message
          : 'Consultation could not be finalized.'
      );
      setTimeout(() => setSuccessToast(null), 6000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickLabOrder = () => {
    setActiveTab('ancillary');
    setSuccessToast(
      'Diagnostics ordering opened. Select an authoritative catalog item and clinical indication before placing the order.'
    );
    setTimeout(() => setSuccessToast(null), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {successToast && (
        <div className="bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold transition-all">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successToast}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (patient) {
                  setSelectedPatientId(patient.id);
                  setActiveTab('patients');
                }
              }}
              className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-[11px] underline cursor-pointer transition-colors"
            >
              View in Patient EHR Index →
            </button>
            <button
              type="button"
              onClick={() => setSuccessToast(null)}
              className="text-white/80 hover:text-white p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* OPD Mode Switcher */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setViewMode('master_suite')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'master_suite'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            OPD Master Operational Runtime Suite (11-Stage Journey)
          </button>
          <button
            onClick={() => setViewMode('consultation_desk')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'consultation_desk'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            Single-Bay Clinical Consultation Desk
          </button>
        </div>
      </div>

      {viewMode === 'master_suite' ? (
        <OpdMasterWorkspace />
      ) : (
        <>
          {/* OPD Header & Stats Banner */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold shadow-2xs">
                  <Stethoscope className="w-4 h-4" />
                </span>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Outpatient (OPD) & Triage Consultation Suite</h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Authoritative token queue, clinician-entered SOAP documentation, governed diagnostics and explicit charge validation
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs">
                <span className="text-slate-500 dark:text-slate-400">Queue Waiting:</span>{' '}
                <strong className="text-slate-900 dark:text-slate-100">{opdQueue.filter(t => t.status === 'waiting').length} Patients</strong>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded-xl text-xs">
                <span className="text-blue-700 dark:text-blue-300">In Consult:</span>{' '}
                <strong className="text-blue-900 dark:text-blue-200">{opdQueue.filter(t => t.status === 'in_consultation').length} Active</strong>
              </div>
            </div>
          </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: OPD Token Queue */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Live OPD Token Queue
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                Cardiology & General
              </span>
            </div>

            <div className="space-y-2.5">
              {opdQueue.map((token) => (
                <div
                  key={token.id}
                  onClick={() => handleSelectToken(token)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedTokenId === token.id
                      ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 ring-2 ring-blue-500/20'
                      : 'bg-slate-50/60 dark:bg-slate-850/50 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded font-mono font-extrabold text-xs bg-slate-800 dark:bg-slate-700 text-white">
                        {token.tokenNumber}
                      </span>
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{token.patientName}</span>
                    </div>

                    <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                      token.priority === 'stat_emergency'
                        ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                        : token.priority === 'urgent'
                        ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}>
                      {token.priority.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 flex items-center justify-between">
                    <span>{token.gender}, {token.age}y • MRN: {token.mrn}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{token.arrivalTime}</span>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 font-medium italic">
                    &ldquo;{token.chiefComplaint}&rdquo;
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                    <span className={`text-[10px] font-bold ${
                      token.status === 'in_consultation' ? 'text-blue-600 dark:text-blue-400' : token.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                    }`}>
                      ● {token.status === 'in_consultation' ? 'In Consultation' : token.status === 'completed' ? 'Completed' : 'Waiting'}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRoutingPatientData({
                            patientId: token.patientId,
                            encounterId: token.encounterId,
                            patientName: token.patientName,
                            mrn: token.mrn,
                            chiefComplaint: token.chiefComplaint,
                            triageCategory: 'Outpatient Triage / OPD',
                            currentAttending: token.assignedDoctor || 'Unassigned',
                          });
                          setIsRoutingModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold transition-all cursor-pointer"
                        title="Route to Specialist Consultant"
                      >
                        Route Spec.
                      </button>

                      {token.status === 'waiting' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void callNextOpdToken(token.id).catch((error) => {
                              setSuccessToast(
                                error instanceof Error
                                  ? error.message
                                  : 'Unable to call OPD patient.'
                              );
                              setTimeout(() => setSuccessToast(null), 4000);
                            });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold shadow-xs transition-all cursor-pointer"
                        >
                          Call In
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Active Consultation Suite */}
        <div className="lg:col-span-8 space-y-4">
          {!patientContextReady && (
            <PatientContextSafetyBlock
              code={
                !selectedToken
                  ? 'CLINICAL_CONTEXT_REQUIRED'
                  : !patient ||
                      patient.mrn !== selectedToken.mrn
                    ? 'PATIENT_CONTEXT_MISMATCH'
                    : 'CLINICAL_CONTEXT_RESOLVING'
              }
              encounterId={selectedToken?.encounterId}
              patientId={selectedToken?.patientId}
              detail={
                !selectedToken
                  ? 'Select an OPD queue token with an authoritative encounter before documenting a consultation.'
                  : 'The consultation desk remains read-only until its patient identity matches the shared encounter-bound clinical context.'
              }
            />
          )}

          {/* Standard Patient Safety Header Banner */}
          {patientContextReady && patient && (
            <StandardPatientBanner
              patient={patient}
              encounterType="OPD"
              encounterStage="CLINICAL_CONSULTATION"
              encounterId={`OPD-${selectedToken?.tokenNumber}`}
              attendingDoctor={selectedToken?.assignedDoctor || "Unassigned"}
              bedNumber="OPD Consultation"
            />
          )}

          {patientContextReady && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5 transition-colors">
            {/* Consultation Header Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 block">
                  Active OPD Consultation
                </span>
                <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                  Chief Complaint: <span className="text-blue-600 dark:text-blue-400">{selectedToken?.chiefComplaint}</span>
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedToken) {
                      setRoutingPatientData({
                        patientId: selectedToken.patientId,
                        encounterId: selectedToken.encounterId,
                        patientName: selectedToken.patientName,
                        mrn: selectedToken.mrn,
                        chiefComplaint: selectedToken.chiefComplaint,
                        triageCategory: 'Outpatient Triage / OPD',
                        currentAttending: selectedToken?.assignedDoctor || 'Unassigned',
                      });
                      setIsRoutingModalOpen(true);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Route to Specialist
                </button>
                <button
                  type="button"
                  onClick={handleQuickLabOrder}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1 transition-all cursor-pointer"
                >
                  <FlaskConical className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> Open Diagnostic Orders
                </button>
                <button
                  type="button"
                  id="btn-save-consultation-gate"
                  onClick={() => setIsConfirmModalOpen(true)}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" /> Finalize Consultation & Sign
                </button>
              </div>
            </div>

            {/* Vitals Capture Strip */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                Point-of-Care Triage Vitals
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">Heart Rate (bpm)</label>
                  <input
                    type="number"
                    value={hr}
                    onChange={(e) => setHr(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">Blood Pressure</label>
                  <input
                    type="text"
                    value={bp}
                    onChange={(e) => setBp(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={temp}
                    onChange={(e) => setTemp(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">Respiratory Rate</label>
                  <input
                    type="number"
                    value={respiratoryRate}
                    onChange={(e) =>
                      setRespiratoryRate(
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">SpO2 (%)</label>
                  <input
                    type="number"
                    value={spo2}
                    onChange={(e) => setSpo2(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* SOAP Note Fields */}
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  Subjective (Chief Complaint & History of Present Illness):
                </label>
                <textarea
                  rows={2}
                  value={soapSubjective}
                  onChange={(e) => setSoapSubjective(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 transition-all font-sans outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  Objective (Physical Exam & Diagnostic Findings):
                </label>
                <textarea
                  rows={2}
                  value={soapObjective}
                  onChange={(e) => setSoapObjective(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 transition-all font-sans outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  Assessment (ICD-10 Clinical Impressions):
                </label>
                <textarea
                  rows={2}
                  value={soapAssessment}
                  onChange={(e) => setSoapAssessment(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 transition-all font-sans outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  Plan / Orders / Follow-up:
                </label>
                <textarea
                  rows={2}
                  value={soapPlan}
                  onChange={(e) => setSoapPlan(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 transition-all font-sans outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-slate-700 dark:text-slate-300">
              Structured diagnoses, medications, procedures and charge codes are not inferred or accepted from this form. Use their governed catalog/order workflows and explicit clinician acceptance.
            </div>
          </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Patient Consultant Routing Modal */}
      {routingPatientData && (
        <PatientConsultantRoutingModal
          isOpen={isRoutingModalOpen}
          onClose={() => setIsRoutingModalOpen(false)}
          patientId={routingPatientData.patientId}
          encounterId={routingPatientData.encounterId}
          patientName={routingPatientData.patientName}
          mrn={routingPatientData.mrn}
          chiefComplaint={routingPatientData.chiefComplaint}
          triageCategory={routingPatientData.triageCategory}
          currentAttending={routingPatientData.currentAttending}
          onRoutedSuccess={(consultant, details) => {
            setSuccessToast(`Patient ${routingPatientData.patientName} successfully routed to ${consultant.name} (${consultant.subSpecialty || consultant.department})`);
            setTimeout(() => setSuccessToast(null), 5000);
          }}
        />
      )}

      {/* RULE 10: Explicit Clinical Safety Identity Confirmation Gate */}
      {patientContextReady && patient && (
        <ConfirmPatientModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={() => {
            setIsConfirmModalOpen(false);
            void handleSaveConsultation();
          }}
          patient={patient}
          actionTitle="Finalize and Sign Clinical Consultation"
          actionDescription={`Signing the clinician-entered outpatient SOAP note for ${patient.fullName || (patient as any).name} (${patient.mrn}). No medication, diagnosis, procedure or charge code will be auto-accepted.`}
          actionRiskLevel="HIGH"
        />
      )}
    </div>
  );
}
