'use client';

import React, { useState } from 'react';
import {
  Ambulance,
  Building2,
  PhoneCall,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  UserCheck,
  Activity,
  HeartPulse,
  Brain,
  Flame,
  ShieldAlert,
  Send,
  X,
  Printer,
  Download,
  Share2,
  Stethoscope,
  ArrowRight,
  Sparkles,
  Bed,
  Check,
  Radio,
  ExternalLink,
} from 'lucide-react';

export interface TransferRequestData {
  transferType: 'EXTERNAL_HOSPITAL' | 'INTERNAL_UNIT';
  urgency: 'STAT_EMERGENT' | 'URGENT' | 'PRIORITY';
  destinationFacility: string;
  destinationDepartment: string;
  receivingDoctor: string;
  receivingContactPhone: string;
  bedStatus: 'BED_CONFIRMED' | 'PRE_NOTIFIED' | 'EN_ROUTE_ACCEPTANCE';
  transportMode: 'ALS_AMBULANCE' | 'BLS_AMBULANCE' | 'AIR_AMBULANCE' | 'CRITICAL_CARE_ESCORT';
  transportUnitId: string;
  enRouteLifeSupport: {
    transportVentilator: boolean;
    inotropicInfusion: boolean;
    bloodTransfusion: boolean;
    cSpineImmobilization: boolean;
    cardiacDefibMonitor: boolean;
  };
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  gcsScore: number;
  vitalsSummary: string;
}

interface ERQuickTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: {
    id: string;
    patientName: string;
    mrn: string;
    age: number;
    gender: string;
    chiefComplaint: string;
    assignedBay: string;
    currentLocation?: string;
    attendingPhysician: string;
    vitals: { hr: number; bp: string; spo2: number; gcs: number };
    esiLevel?: number;
    codeAlert?: string | null;
  };
  onTransferComplete: (transferData: TransferRequestData, summary: any) => void;
}

const EXTERNAL_HOSPITAL_PRESETS = [
  {
    id: 'nicvd-cath',
    name: 'National Institute of Cardiovascular Diseases (NICVD)',
    type: 'Tertiary Cardiac Care & 24/7 Primary PCI Cath Lab',
    city: 'Metropolitan Center',
    contact: '+1 (555) 911-CATH (Ext. 101)',
    specialties: ['Primary Angioplasty', 'Aortic Dissection Repair', 'ECMO Support'],
    defaultDoctor: 'Dr. Z. Farooq, Interventional Cardiologist on Duty',
  },
  {
    id: 'trauma-lvl1',
    name: 'Metropolitan Regional Level-1 Trauma & Neurosurgical Center',
    type: 'Comprehensive Polytrauma, Spine & Craniotomy',
    city: 'Downtown Medical District',
    contact: '+1 (555) 911-TRMA (Ext. 204)',
    specialties: ['Emergency Craniotomy', 'Pelvic Embolization', 'Thoracotomy'],
    defaultDoctor: 'Dr. A. Vance, Trauma Surgery Director',
  },
  {
    id: 'childrens-picu',
    name: 'Children’s Specialized Hospital & Pediatric ICU',
    type: 'Tertiary Pediatric Critical Care & Neonatal Surgery',
    city: 'North Campus',
    contact: '+1 (555) 911-PEDS (Ext. 305)',
    specialties: ['Pediatric Mechanical Ventilation', 'Pediatric Surgery', 'Status Epilepticus'],
    defaultDoctor: 'Dr. M. Lindqvist, Pediatric Intensivist',
  },
  {
    id: 'burn-center',
    name: 'Provincial Burn Injury & Reconstructive Center',
    type: 'Major Burn Shock Resuscitation & Hyperbaric Unit',
    city: 'East Medical Park',
    contact: '+1 (555) 911-BURN (Ext. 408)',
    specialties: ['Thermal / Chemical Burns >20%', 'Inhalation Injury ICU', 'Skin Grafting'],
    defaultDoctor: 'Dr. K. Rashid, Burn Care Incharge',
  },
  {
    id: 'stroke-center',
    name: 'Comprehensive Stroke & Endovascular Neurovascular Institute',
    type: 'Rapid Mechanical Thrombectomy & Neuro-ICU',
    city: 'Central Health Sciences',
    contact: '+1 (555) 911-STRK (Ext. 509)',
    specialties: ['Endovascular Thrombectomy', 'tPA / Tenecteplase Protocol', 'Intracranial Hemorrhage'],
    defaultDoctor: 'Dr. H. Tanaka, Neuro-Interventionalist',
  },
];

const INTERNAL_UNITS = [
  { id: 'icu-main', name: 'Main Intensive Care Unit (ICU)', bay: 'ICU Bed 04 (Negative Pressure)', doctor: 'Dr. R. Sterling (Intensivist)', contact: 'Ext. 8801' },
  { id: 'ccu-cardiac', name: 'Coronary Care Unit (CCU)', bay: 'CCU Bed 02 (Telemetry Monitored)', doctor: 'Dr. S. Jenkins (Cardiologist)', contact: 'Ext. 8802' },
  { id: 'cath-lab', name: 'Emergency Cardiac Cath Lab Suite 1', bay: 'Cath Lab Table 1 (Fluoroscopy Ready)', doctor: 'Dr. S. Jenkins / On-Call Team', contact: 'Ext. 8805' },
  { id: 'or-trauma', name: 'Emergency Operation Theater (OR Suite 3)', bay: 'Emergency Trauma OR 03', doctor: 'Dr. K. Baig (General Surgeon)', contact: 'Ext. 8809' },
  { id: 'hdu-stepdown', name: 'High Dependency Unit (HDU / Step-Down)', bay: 'HDU Bed 07', doctor: 'Dr. M. Chang (Internal Med)', contact: 'Ext. 8812' },
  { id: 'picu-resus', name: 'Pediatric Intensive Care Unit (PICU)', bay: 'PICU Bay 02', doctor: 'Dr. E. Gomez (Pediatrician)', contact: 'Ext. 8815' },
];

export function ERQuickTransferModal({
  isOpen,
  onClose,
  patient,
  onTransferComplete,
}: ERQuickTransferModalProps) {
  const [transferType, setTransferType] = useState<'EXTERNAL_HOSPITAL' | 'INTERNAL_UNIT'>('EXTERNAL_HOSPITAL');
  const [urgency, setUrgency] = useState<'STAT_EMERGENT' | 'URGENT' | 'PRIORITY'>('STAT_EMERGENT');
  
  // External Destination
  const [selectedHospitalPreset, setSelectedHospitalPreset] = useState<string>(EXTERNAL_HOSPITAL_PRESETS[0].id);
  const [customHospitalName, setCustomHospitalName] = useState<string>('');
  const [receivingDoctor, setReceivingDoctor] = useState<string>(EXTERNAL_HOSPITAL_PRESETS[0].defaultDoctor);
  const [receivingPhone, setReceivingPhone] = useState<string>(EXTERNAL_HOSPITAL_PRESETS[0].contact);
  const [bedStatus, setBedStatus] = useState<'BED_CONFIRMED' | 'PRE_NOTIFIED' | 'EN_ROUTE_ACCEPTANCE'>('BED_CONFIRMED');

  // Internal Destination
  const [selectedInternalUnit, setSelectedInternalUnit] = useState<string>(INTERNAL_UNITS[0].id);

  // Transport & En Route Life Support
  const [transportMode, setTransportMode] = useState<'ALS_AMBULANCE' | 'BLS_AMBULANCE' | 'AIR_AMBULANCE' | 'CRITICAL_CARE_ESCORT'>('ALS_AMBULANCE');
  const [transportUnitId, setTransportUnitId] = useState<string>('ALS-Medic-08 (Advanced Critical Care)');
  const [lifeSupport, setLifeSupport] = useState({
    transportVentilator: (patient?.vitals?.spo2 ?? 98) < 92,
    inotropicInfusion: (patient?.vitals?.bp ?? '').startsWith('8') || (patient?.vitals?.bp ?? '').startsWith('7'),
    bloodTransfusion: false,
    cSpineImmobilization: (patient?.chiefComplaint ?? '').toLowerCase().includes('fall') || (patient?.chiefComplaint ?? '').toLowerCase().includes('accident'),
    cardiacDefibMonitor: true,
  });

  // Clinical SBAR
  const [sbarSituation, setSbarSituation] = useState<string>(
    `${patient?.patientName ?? 'Patient'} (${patient?.age ?? 0}y ${patient?.gender ?? ''}, MRN: ${patient?.mrn ?? ''}) presenting with ${patient?.chiefComplaint ?? 'acute emergency'}. Requires immediate transfer for definitive specialized care.`
  );
  const [sbarBackground, setSbarBackground] = useState<string>(
    `Arrived in ED with ESI-${patient?.esiLevel || 1} acuity. Initial vitals: HR ${patient?.vitals?.hr ?? 0} bpm, BP ${patient?.vitals?.bp ?? '120/80'} mmHg, SpO2 ${patient?.vitals?.spo2 ?? 98}%, GCS ${patient?.vitals?.gcs ?? 15}/15. Emergency resuscitation initiated in ${patient?.assignedBay ?? 'Resus 1'}.`
  );
  const [sbarAssessment, setSbarAssessment] = useState<string>(
    `High risk of deterioration. Hemodynamically ${parseInt(patient?.vitals?.bp ?? '120') < 90 ? 'unstable / guarded' : 'stabilized with support'}. Glasgow Coma Scale (GCS) evaluated at ${patient?.vitals?.gcs ?? 15}/15. Immediate tertiary intervention necessary.`
  );
  const [sbarRecommendation, setSbarRecommendation] = useState<string>(
    `Transfer via ${transportMode.replace('_', ' ')} with continuous vital telemetry. Handover direct to ${receivingDoctor}. Maintain oxygenation & IV patency.`
  );

  const [activeTab, setActiveTab] = useState<'CONFIG' | 'SBAR_PREVIEW'>('CONFIG');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transferDispatched, setTransferDispatched] = useState<any>(null);

  if (!isOpen || !patient) return null;

  const handleSelectPreset = (presetId: string) => {
    setSelectedHospitalPreset(presetId);
    const preset = EXTERNAL_HOSPITAL_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setReceivingDoctor(preset.defaultDoctor);
      setReceivingPhone(preset.contact);
    }
  };

  const handleSelectInternal = (unitId: string) => {
    setSelectedInternalUnit(unitId);
    const unit = INTERNAL_UNITS.find((u) => u.id === unitId);
    if (unit) {
      setReceivingDoctor(unit.doctor);
      setReceivingPhone(unit.contact);
    }
  };

  const destinationFacilityName =
    transferType === 'EXTERNAL_HOSPITAL'
      ? selectedHospitalPreset === 'custom'
        ? customHospitalName || 'Custom Tertiary Referral Hospital'
        : EXTERNAL_HOSPITAL_PRESETS.find((p) => p.id === selectedHospitalPreset)?.name || 'Tertiary Center'
      : INTERNAL_UNITS.find((u) => u.id === selectedInternalUnit)?.name || 'Internal Intensive Care';

  const destinationBayOrDept =
    transferType === 'EXTERNAL_HOSPITAL'
      ? EXTERNAL_HOSPITAL_PRESETS.find((p) => p.id === selectedHospitalPreset)?.type || 'Specialized Emergency Unit'
      : INTERNAL_UNITS.find((u) => u.id === selectedInternalUnit)?.bay || 'Assigned ICU Bed';

  const handleExecuteTransfer = () => {
    setIsSubmitting(true);

    const dispatchId = `TRF-${transferType === 'EXTERNAL_HOSPITAL' ? 'EXT' : 'INT'}-${Date.now().toString().slice(-6)}`;
    const transferPayload: TransferRequestData = {
      transferType,
      urgency,
      destinationFacility: destinationFacilityName,
      destinationDepartment: destinationBayOrDept,
      receivingDoctor,
      receivingContactPhone: receivingPhone,
      bedStatus,
      transportMode,
      transportUnitId,
      enRouteLifeSupport: lifeSupport,
      sbar: {
        situation: sbarSituation,
        background: sbarBackground,
        assessment: sbarAssessment,
        recommendation: sbarRecommendation,
      },
      gcsScore: patient.vitals.gcs,
      vitalsSummary: `HR ${patient.vitals.hr} bpm, BP ${patient.vitals.bp} mmHg, SpO2 ${patient.vitals.spo2}%, GCS ${patient.vitals.gcs}/15`,
    };

    const summary = {
      dispatchId,
      dispatchedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      transferData: transferPayload,
      patient,
    };

    setTimeout(() => {
      setIsSubmitting(false);
      setTransferDispatched(summary);
      onTransferComplete(transferPayload, summary);
    }, 900);
  };

  const handlePrintTransferSlip = () => {
    window.print();
  };

  return (
    <div
      id="er-quick-transfer-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        id="er-quick-transfer-modal-container"
        className="relative w-full max-w-4xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-amber-600 via-rose-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner font-black">
              <Ambulance className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight">
                  Emergency Quick Transfer & Referral Engine
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-white/20 text-white font-extrabold text-[10px] tracking-wider uppercase">
                  STAT PROTOCOL
                </span>
              </div>
              <p className="text-xs text-rose-100 font-medium mt-0.5">
                Rapid inter-hospital tertiary referral & direct internal critical care escalation with SBAR digital handover
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close transfer modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Patient Vital Context Banner */}
        <div className="px-6 py-3 bg-slate-100 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-slate-900 dark:text-slate-100">{patient.patientName}</span>
            <span className="text-slate-500 dark:text-slate-400">({patient.gender}, {patient.age}y)</span>
            <span className="font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
              {patient.mrn}
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              Current Bay: <strong className="text-slate-900 dark:text-slate-200">{patient.assignedBay}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              HR: <strong className={patient.vitals.hr > 100 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}>{patient.vitals.hr}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              BP: <strong className="text-slate-800 dark:text-slate-200">{patient.vitals.bp}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              SpO2: <strong className={patient.vitals.spo2 < 95 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}>{patient.vitals.spo2}%</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold">
              GCS: {patient.vitals.gcs} / 15
            </span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 pt-3 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('CONFIG')}
            className={`px-4 py-2 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'CONFIG'
                ? 'border-rose-600 text-rose-600 dark:text-rose-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            1. Transfer Destination & Transport Protocol
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('SBAR_PREVIEW')}
            className={`px-4 py-2 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'SBAR_PREVIEW'
                ? 'border-rose-600 text-rose-600 dark:text-rose-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            2. SBAR Handover & Digital Referral Document
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-900 dark:text-slate-100">
          {transferDispatched ? (
            /* Transfer Completed Confirmation View */
            <div className="space-y-6 py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-10 h-10 animate-bounce" />
              </div>

              <div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Transfer Dispatch Initiated Successfully!
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Dispatch Reference ID: <strong className="font-mono text-rose-600 dark:text-rose-400">{transferDispatched.dispatchId}</strong> • Logged at {transferDispatched.dispatchedAt}
                </p>
              </div>

              <div className="max-w-xl mx-auto bg-slate-50 dark:bg-slate-850 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-left text-xs space-y-2.5">
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Destination:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{transferDispatched.transferData.destinationFacility}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Receiving Physician / Unit:</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">{transferDispatched.transferData.receivingDoctor}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                  <span className="text-slate-500">Transport Vehicle:</span>
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-400">{transferDispatched.transferData.transportUnitId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Glasgow Coma Scale at Dispatch:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">GCS {transferDispatched.transferData.gcsScore} / 15</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handlePrintTransferSlip}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  Print STAT Transfer Handover Letter
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs"
                >
                  Return to Live ED Board
                </button>
              </div>
            </div>
          ) : activeTab === 'CONFIG' ? (
            /* Configuration Step */
            <div className="space-y-6">
              {/* 1. Transfer Scope Toggle */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Transfer Scope & Destination Type
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTransferType('EXTERNAL_HOSPITAL')}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      transferType === 'EXTERNAL_HOSPITAL'
                        ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-400 dark:border-rose-600 ring-2 ring-rose-500/20'
                        : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${transferType === 'EXTERNAL_HOSPITAL' ? 'bg-rose-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                          External Inter-Hospital Referral
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Tertiary center transfer for PCI, Level-1 Trauma, Burn, or Neuro
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTransferType('INTERNAL_UNIT')}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      transferType === 'INTERNAL_UNIT'
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/20'
                        : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${transferType === 'INTERNAL_UNIT' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                        <Bed className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                          Rapid Internal Unit Escalation
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Direct bedside handoff to ICU, CCU, Emergency Cath Lab, or OR
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* 2. Urgency Tier */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Dispatch Urgency Level
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setUrgency('STAT_EMERGENT')}
                    className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      urgency === 'STAT_EMERGENT'
                        ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-black text-xs flex items-center justify-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> STAT &lt; 5 mins
                    </div>
                    <div className={`text-[10px] mt-0.5 ${urgency === 'STAT_EMERGENT' ? 'text-rose-100' : 'text-slate-400'}`}>
                      Immediate Life Threat
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency('URGENT')}
                    className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      urgency === 'URGENT'
                        ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Urgent &lt; 15 mins
                    </div>
                    <div className={`text-[10px] mt-0.5 ${urgency === 'URGENT' ? 'text-amber-100' : 'text-slate-400'}`}>
                      Rapid Intervention Needed
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrgency('PRIORITY')}
                    className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      urgency === 'PRIORITY'
                        ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Priority &lt; 30 mins
                    </div>
                    <div className={`text-[10px] mt-0.5 ${urgency === 'PRIORITY' ? 'text-blue-100' : 'text-slate-400'}`}>
                      Sub-acute Stable Transfer
                    </div>
                  </button>
                </div>
              </div>

              {/* 3. Destination Facility Selection */}
              {transferType === 'EXTERNAL_HOSPITAL' ? (
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Select Receiving Referral Hospital
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {EXTERNAL_HOSPITAL_PRESETS.map((hosp) => (
                      <div
                        key={hosp.id}
                        onClick={() => handleSelectPreset(hosp.id)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                          selectedHospitalPreset === hosp.id
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-600 ring-2 ring-rose-500/20'
                            : 'bg-slate-50/70 dark:bg-slate-850/70 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-xs text-slate-900 dark:text-slate-100">{hosp.name}</div>
                            <div className="text-[11px] text-rose-700 dark:text-rose-400 font-medium mt-0.5">{hosp.type}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                              <PhoneCall className="w-3 h-3 text-slate-400" /> {hosp.contact}
                            </div>
                          </div>
                          {selectedHospitalPreset === hosp.id && (
                            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shrink-0">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {hosp.specialties.map((spec, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                              {spec}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Doctor & Phone coordination */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Receiving Attending Doctor
                      </label>
                      <input
                        type="text"
                        value={receivingDoctor}
                        onChange={(e) => setReceivingDoctor(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Receiving Hotline / Phone
                      </label>
                      <input
                        type="text"
                        value={receivingPhone}
                        onChange={(e) => setReceivingPhone(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Receiving Bed Acceptance
                      </label>
                      <select
                        value={bedStatus}
                        onChange={(e) => setBedStatus(e.target.value as any)}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-emerald-700 dark:text-emerald-400"
                      >
                        <option value="BED_CONFIRMED">✓ Bed Confirmed & Reserved</option>
                        <option value="PRE_NOTIFIED">⏳ Pre-Notified (Accepting En Route)</option>
                        <option value="EN_ROUTE_ACCEPTANCE">⚡ STAT Emergency Transit Notice</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                /* Internal Units Directory */
                <div className="space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Select Target Critical Care Unit / Bed
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {INTERNAL_UNITS.map((unit) => (
                      <div
                        key={unit.id}
                        onClick={() => handleSelectInternal(unit.id)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                          selectedInternalUnit === unit.id
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/20'
                            : 'bg-slate-50/70 dark:bg-slate-850/70 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-xs text-slate-900 dark:text-slate-100">{unit.name}</div>
                            <div className="text-[11px] text-indigo-700 dark:text-indigo-400 font-bold mt-0.5">Assigned: {unit.bay}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                              Charge Physician: {unit.doctor} • {unit.contact}
                            </div>
                          </div>
                          {selectedInternalUnit === unit.id && (
                            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Transport Mode & In-Transit Life Support Equipment */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/70 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Ambulance className="w-4 h-4 text-amber-600" />
                    Transport Vehicle & In-Transit Critical Care Support
                  </h4>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                    Telemetry Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Transport Mode
                    </label>
                    <select
                      value={transportMode}
                      onChange={(e) => setTransportMode(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
                    >
                      <option value="ALS_AMBULANCE">🚑 Advanced Life Support (ALS) Mobile ICU</option>
                      <option value="BLS_AMBULANCE">🚐 Basic Life Support (BLS) Ambulance</option>
                      <option value="AIR_AMBULANCE">🚁 Air Ambulance / Helicopter Medevac</option>
                      <option value="CRITICAL_CARE_ESCORT">👨‍⚕️ Internal Rapid Critical Care Escort</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Assigned Vehicle / Crew ID
                    </label>
                    <input
                      type="text"
                      value={transportUnitId}
                      onChange={(e) => setTransportUnitId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    En Route Life Support & Monitoring Checklist
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lifeSupport.transportVentilator}
                        onChange={(e) => setLifeSupport({ ...lifeSupport, transportVentilator: e.target.checked })}
                        className="rounded text-rose-600"
                      />
                      <span>Transport Ventilator</span>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lifeSupport.inotropicInfusion}
                        onChange={(e) => setLifeSupport({ ...lifeSupport, inotropicInfusion: e.target.checked })}
                        className="rounded text-rose-600"
                      />
                      <span>Inotropic / Vasopressor Infusion</span>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lifeSupport.cardiacDefibMonitor}
                        onChange={(e) => setLifeSupport({ ...lifeSupport, cardiacDefibMonitor: e.target.checked })}
                        className="rounded text-rose-600"
                      />
                      <span>Continuous Defib / ECG Monitor</span>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lifeSupport.cSpineImmobilization}
                        onChange={(e) => setLifeSupport({ ...lifeSupport, cSpineImmobilization: e.target.checked })}
                        className="rounded text-rose-600"
                      />
                      <span>C-Spine / Spine Board</span>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lifeSupport.bloodTransfusion}
                        onChange={(e) => setLifeSupport({ ...lifeSupport, bloodTransfusion: e.target.checked })}
                        className="rounded text-rose-600"
                      />
                      <span>Blood Infusion En Route</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* SBAR Clinical Handover Document Step */
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-950/40 rounded-2xl border border-blue-200 dark:border-blue-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h4 className="text-xs font-bold text-blue-950 dark:text-blue-200">
                      Standardized SBAR Clinical Handover Protocol
                    </h4>
                    <p className="text-[11px] text-blue-800 dark:text-blue-300">
                      Situation • Background • Assessment (GCS {patient.vitals.gcs}/15) • Recommendation
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handlePrintTransferSlip}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print SBAR Handover Slip
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-rose-700 dark:text-rose-400 mb-1 uppercase tracking-wider">
                    S — Situation (Reason for Transfer)
                  </label>
                  <textarea
                    rows={2}
                    value={sbarSituation}
                    onChange={(e) => setSbarSituation(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-amber-700 dark:text-amber-400 mb-1 uppercase tracking-wider">
                    B — Background (Clinical Context & Resuscitation)
                  </label>
                  <textarea
                    rows={2}
                    value={sbarBackground}
                    onChange={(e) => setSbarBackground(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-indigo-700 dark:text-indigo-400 mb-1 uppercase tracking-wider">
                    A — Assessment (Glasgow Coma Scale GCS & Vitals Telemetry)
                  </label>
                  <textarea
                    rows={2}
                    value={sbarAssessment}
                    onChange={(e) => setSbarAssessment(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-emerald-700 dark:text-emerald-400 mb-1 uppercase tracking-wider">
                    R — Recommendation (Transport Directives & En Route Safety)
                  </label>
                  <textarea
                    rows={2}
                    value={sbarRecommendation}
                    onChange={(e) => setSbarRecommendation(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        {!transferDispatched && (
          <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>
                Target: <strong className="text-slate-900 dark:text-slate-100">{destinationFacilityName}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>

              {activeTab === 'CONFIG' ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('SBAR_PREVIEW')}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <span>Review SBAR Handover</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExecuteTransfer}
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md active:scale-98 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Radio className="w-4 h-4 animate-spin" />
                      <span>Dispatching Transfer...</span>
                    </>
                  ) : (
                    <>
                      <Ambulance className="w-4 h-4" />
                      <span>Authorize & Dispatch STAT Transfer</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
