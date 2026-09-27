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

export function OpdEncountersView() {
  const [viewMode, setViewMode] = useState<'master_suite' | 'consultation_desk'>('master_suite');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const {
    opdQueue,
    callNextOpdToken,
    completeOpdToken,
    patients,
    addClinicalNote,
    addLabOrder,
    addVitals,
    selectedPatientId,
    setSelectedPatientId,
    setActiveTab,
  } = useHospital();

  const [selectedTokenId, setSelectedTokenId] = useState<string>('tok-01');

  // Auto-focus on matching OPD token if global selected patient matches
  useEffect(() => {
    if (selectedPatientId) {
      const match = opdQueue.find((t) => t.patientId === selectedPatientId);
      if (match) {
        setSelectedTokenId(match.id);
      }
    }
  }, [selectedPatientId, opdQueue]);

  const handleSelectToken = (token: OpdQueueToken) => {
    setSelectedTokenId(token.id);
    if (token.patientId) {
      setSelectedPatientId(token.patientId);
    }
  };
  const [isRoutingModalOpen, setIsRoutingModalOpen] = useState<boolean>(false);
  const [routingPatientData, setRoutingPatientData] = useState<any>(null);
  const [chiefComplaint, setChiefComplaint] = useState<string>('');
  const [soapSubjective, setSoapSubjective] = useState<string>('Patient reports 3-day history of worsening chest pressure following physical exertion. Denies diaphoresis.');
  const [soapObjective, setSoapObjective] = useState<string>('BP: 138/88 mmHg, HR: 98 bpm regular, SpO2: 96% on room air. Lungs clear to auscultation bilaterally.');
  const [soapAssessment, setSoapAssessment] = useState<string>('Post-PCI Angina Pectoris (ICD-10 I20.9), Essential Hypertension.');
  const [soapPlan, setSoapPlan] = useState<string>('1. Continue Ticagrelor 90mg BID. 2. Order High-Sensitivity Troponin I and 12-Lead ECG. 3. Bedside Echocardiogram.');
  const [isAiStructuring, setIsAiStructuring] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Vitals entry
  const [hr, setHr] = useState<number>(98);
  const [bp, setBp] = useState<string>('138/88');
  const [temp, setTemp] = useState<number>(37.2);
  const [spo2, setSpo2] = useState<number>(96);

  const selectedToken = opdQueue.find(t => t.id === selectedTokenId) || opdQueue[0];
  const patient = patients.find(p => p.id === selectedToken?.patientId) || patients[0];

  const handleSaveConsultation = () => {
    if (!patient) return;

    // Build full SOAP note
    const fullContent = `SUBJECTIVE:\n${soapSubjective}\n\nOBJECTIVE:\n${soapObjective}\n\nASSESSMENT:\n${soapAssessment}\n\nPLAN:\n${soapPlan}`;

    addClinicalNote(patient.id, {
      author: 'Dr. Sarah Jenkins',
      role: 'Consultant Cardiologist',
      category: 'SOAP',
      content: fullContent,
      aiStructuredData: {
        chiefComplaint: selectedToken.chiefComplaint,
        diagnoses: ['Post-PCI Angina Pectoris (I20.9)', 'Essential Hypertension (I10)'],
        medicationsPrescribed: ['Ticagrelor 90mg PO BID', 'Atorvastatin 80mg QHS'],
        recommendedProcedures: ['12-Lead ECG (CPT 93000)', 'Echocardiogram (CPT 93306)'],
        followUpDays: 7,
        billingCodes: [
          { code: '99214', description: 'Outpatient Clinic Visit - Moderate/High Complexity', fee: 185 },
          { code: '93000', description: '12-Lead Electrocardiogram w/ Interpretation', fee: 120 },
        ],
      },
    });

    // Record vitals
    addVitals(patient.id, {
      heartRate: hr,
      bloodPressure: bp,
      temperature: temp,
      respiratoryRate: 18,
      oxygenSaturation: spo2,
    });

    completeOpdToken(selectedToken.id);
    setSuccessToast(`Consultation saved for ${patient.fullName || 'Patient'}! Clinical note committed to Encounter Stage: Complete. AI extracted CPT 99214 & 93000 to billing validation queue.`);
    setTimeout(() => setSuccessToast(null), 6000);
  };

  const handleQuickLabOrder = () => {
    if (!patient) return;
    addLabOrder(patient.id, {
      testName: 'High-Sensitivity Troponin I & Complete Blood Count',
      category: 'Biochemistry',
      status: 'ordered',
      sampleId: `SMP-${Math.floor(1000 + Math.random() * 9000)}`,
      cost: 120,
    });
    setSuccessToast('Stat Diagnostic Lab Order dispatched via HL7 ORM^O01 to LIS!');
    setTimeout(() => setSuccessToast(null), 3000);
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
                Real-time token queue, digital SOAP charting, and automated point-of-care CPT charge capture
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
                            patientName: token.patientName,
                            mrn: token.mrn,
                            chiefComplaint: token.chiefComplaint,
                            triageCategory: 'Outpatient Triage / OPD',
                            currentAttending: 'Dr. Sarah Jenkins',
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
                            callNextOpdToken(token.id);
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
          {/* Standard Patient Safety Header Banner */}
          {patient && (
            <StandardPatientBanner
              patient={patient}
              encounterType="OPD"
              encounterStage="CLINICAL_CONSULTATION"
              encounterId={`OPD-${selectedToken?.tokenNumber}`}
              attendingDoctor="Dr. Sarah Jenkins, MD (Cardiology)"
              bedNumber="Consultation Bay 104"
            />
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5 transition-colors">
            {/* Consultation Header Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 block">
                  Active Consultation Room 104
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
                        patientName: selectedToken.patientName,
                        mrn: selectedToken.mrn,
                        chiefComplaint: selectedToken.chiefComplaint,
                        triageCategory: 'Outpatient Triage / OPD',
                        currentAttending: 'Dr. Sarah Jenkins',
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
                  <FlaskConical className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> Order Stat Labs
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
                    onChange={(e) => setHr(Number(e.target.value))}
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
                    onChange={(e) => setTemp(Number(e.target.value))}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">SpO2 (%)</label>
                  <input
                    type="number"
                    value={spo2}
                    onChange={(e) => setSpo2(Number(e.target.value))}
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
                  Plan & Prescriptions (Auto-coded for Charge Sheet):
                </label>
                <textarea
                  rows={2}
                  value={soapPlan}
                  onChange={(e) => setSoapPlan(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 transition-all font-sans outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Bottom Point-of-Care CPT Auto-Suggestion Preview */}
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-slate-700 dark:text-slate-300">
                  AI Real-Time Charge Suggester: <strong className="text-blue-900 dark:text-blue-200">CPT 99214 ($185) + CPT 93000 ($120)</strong>
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white shadow-2xs">
                +$305 Estimated
              </span>
            </div>
          </div>
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
      {patient && (
        <ConfirmPatientModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={() => {
            setIsConfirmModalOpen(false);
            handleSaveConsultation();
          }}
          patient={patient}
          actionTitle="Finalize Clinical Consultation, Prescribe Rx & Capture CPT Charges"
          actionDescription={`Signing outpatient evaluation for ${patient.fullName || (patient as any).name} (${patient.mrn}). Medications: Ticagrelor 90mg BID, Atorvastatin 80mg QHS. CPT: 99214, 93000.`}
          actionRiskLevel="HIGH"
        />
      )}
    </div>
  );
}
