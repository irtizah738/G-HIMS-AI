'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  ShieldAlert,
  Activity,
  Ambulance,
  HeartCrack,
  Flame,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Plus,
  Stethoscope,
  Users,
  Zap,
  Bed,
  PhoneCall,
  Sparkles,
  UserCheck,
  Send,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { PatientConsultantRoutingModal, ConsultantDoctor } from '@/components/clinical/patient-consultant-routing-modal';

interface EmergencyCase {
  id: string;
  patientName: string;
  age: number;
  gender: string;
  mrn: string;
  esiLevel: 1 | 2 | 3 | 4 | 5;
  chiefComplaint: string;
  arrivalTime: string;
  assignedBay: string;
  attendingPhysician: string;
  vitals: { hr: number; bp: string; spo2: number; gcs: number };
  status: 'triage' | 'resuscitation' | 'stabilized' | 'admitted_icu' | 'discharged';
  ambulanceInbound?: { etaMinutes: number; paramedicUnit: string; mechanism: string };
  codeAlert?: 'STEMI' | 'STROKE' | 'TRAUMA_ALPHA' | 'CODE_BLUE' | null;
}

export function EmergencyTriageView() {
  const { patients, setSelectedPatientId, setActiveTab } = useHospital();

  const [emergencyCases, setEmergencyCases] = useState<EmergencyCase[]>([
    {
      id: 'er-101',
      patientName: 'Elena Rostova',
      age: 44,
      gender: 'Female',
      mrn: 'GH-2026-9812',
      esiLevel: 1,
      chiefComplaint: 'Acute retrosternal crushing pain, diaphoresis, impending syncope',
      arrivalTime: '10 mins ago',
      assignedBay: 'Resus Bay 01 (Red)',
      attendingPhysician: 'Dr. Sarah Jenkins',
      vitals: { hr: 112, bp: '84/52', spo2: 92, gcs: 14 },
      status: 'resuscitation',
      codeAlert: 'STEMI',
    },
    {
      id: 'er-102',
      patientName: 'Tariq Al-Mansoor',
      age: 58,
      gender: 'Male',
      mrn: 'GH-2026-4419',
      esiLevel: 2,
      chiefComplaint: 'Acute focal neurological deficit: Left-sided hemiparesis & dysarthria',
      arrivalTime: '24 mins ago',
      assignedBay: 'Trauma Bay 02',
      attendingPhysician: 'Dr. Kamran Baig',
      vitals: { hr: 88, bp: '178/104', spo2: 97, gcs: 13 },
      status: 'triage',
      codeAlert: 'STROKE',
    },
    {
      id: 'er-103',
      patientName: 'Sofia Chen',
      age: 31,
      gender: 'Female',
      mrn: 'GH-2026-7731',
      esiLevel: 3,
      chiefComplaint: 'Right lower quadrant abdominal rebound tenderness, nausea, fever 38.6°C',
      arrivalTime: '42 mins ago',
      assignedBay: 'Urgent Care Bay 04',
      attendingPhysician: 'Dr. Michael Chang',
      vitals: { hr: 94, bp: '122/78', spo2: 99, gcs: 15 },
      status: 'triage',
      codeAlert: null,
    },
    {
      id: 'er-104',
      patientName: 'Zubair Ahmed',
      age: 26,
      gender: 'Male',
      mrn: 'GH-2026-3108',
      esiLevel: 2,
      chiefComplaint: 'Motor vehicle accident, open tibial fracture with moderate hemorrhage',
      arrivalTime: '5 mins ago',
      assignedBay: 'Trauma Bay 01',
      attendingPhysician: 'Dr. Sarah Jenkins',
      vitals: { hr: 128, bp: '102/64', spo2: 95, gcs: 15 },
      status: 'resuscitation',
      codeAlert: 'TRAUMA_ALPHA',
    },
  ]);

  const [inboundAmbulances, setInboundAmbulances] = useState([
    {
      id: 'amb-11',
      unit: 'Paramedic Medic-04 (Advanced Life Support)',
      eta: '4 mins',
      chiefComplaint: 'Pediatric Status Epilepticus (age 5)',
      crewLeader: 'Capt. R. Wilson',
      vitals: 'SpO2 88%, Active Seizure >15m',
      preparedBay: 'Pediatric Resus Bay P1',
    },
    {
      id: 'amb-12',
      unit: 'Rescue 1122 Trauma Response',
      eta: '11 mins',
      chiefComplaint: 'Industrial fall from height (4m), suspected pelvic disruption',
      crewLeader: 'Paramedic H. Tariq',
      vitals: 'HR 134, BP 90/58',
      preparedBay: 'Trauma Bay 03',
    },
  ]);

  const [activeCodeBroadcast, setActiveCodeBroadcast] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('er-101');
  const [isRoutingModalOpen, setIsRoutingModalOpen] = useState(false);
  const [routingPatientData, setRoutingPatientData] = useState<any>(null);

  const selectedCase = emergencyCases.find((c) => c.id === selectedCaseId) || emergencyCases[0];

  const handleOpenRouting = (c: EmergencyCase) => {
    setRoutingPatientData({
      patientId: c.mrn.replace('GH-2026-', 'p-'),
      patientName: c.patientName,
      mrn: c.mrn,
      chiefComplaint: c.chiefComplaint,
      triageCategory: c.codeAlert ? `Emergency Code: ${c.codeAlert}` : `ESI-${c.esiLevel} Emergency`,
      currentAttending: c.attendingPhysician,
    });
    setIsRoutingModalOpen(true);
  };

  const handleConsultantRouted = (consultant: ConsultantDoctor, details: any) => {
    setEmergencyCases((prev) =>
      prev.map((c) => {
        if (c.mrn === details.mrn || c.patientName === details.patientName) {
          return {
            ...c,
            attendingPhysician: consultant.name,
            assignedBay: details.assignedRoom,
          };
        }
        return c;
      })
    );
  };

  const handleBroadcastCode = (codeType: string) => {
    setActiveCodeBroadcast(codeType);
    setTimeout(() => {
      setActiveCodeBroadcast(null);
    }, 6000);
  };

  const getEsiBadge = (level: number) => {
    switch (level) {
      case 1:
        return <span className="px-2.5 py-1 rounded-md text-[10px] font-black bg-rose-600 text-white animate-pulse">ESI-1 RESUSCITATION</span>;
      case 2:
        return <span className="px-2.5 py-1 rounded-md text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">ESI-2 EMERGENT</span>;
      case 3:
        return <span className="px-2.5 py-1 rounded-md text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">ESI-3 URGENT</span>;
      case 4:
        return <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800">ESI-4 LESS URGENT</span>;
      case 5:
        return <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">ESI-5 NON-URGENT</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Code Broadcast Alert Banner */}
      {activeCodeBroadcast && (
        <div className="p-4 bg-rose-600 text-white rounded-2xl shadow-xl border-2 border-rose-300 flex items-center justify-between animate-bounce">
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 animate-spin" />
            <div>
              <h3 className="text-base font-black tracking-wider uppercase">
                EMERGENCY ALERT ACTIVATED: {activeCodeBroadcast}
              </h3>
              <p className="text-xs text-rose-100 font-medium">
                Paging Emergency Physician Team, Anesthesia, Interventional Lab & Blood Bank Stat!
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveCodeBroadcast(null)}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold"
          >
            Acknowledge
          </button>
        </div>
      )}

      {/* Main ED Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold shadow-2xs">
              <ShieldAlert className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Emergency Department & Trauma Resuscitation Center</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Emergency Severity Index (ESI) Triage, Rapid Ambulance Telemetry & Hospital-wide Code Broadcasts
          </p>
        </div>

        {/* Code Activation Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleBroadcastCode('CODE STEMI (Cath Lab Alert)')}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5" /> STEMI Alert
          </button>
          <button
            type="button"
            onClick={() => handleBroadcastCode('CODE STROKE (CT Neuro Alert)')}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" /> Stroke Alert
          </button>
          <button
            type="button"
            onClick={() => handleBroadcastCode('CODE TRAUMA ALPHA')}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" /> Trauma Alpha
          </button>
        </div>
      </div>

      {/* ED Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Active ED Census</span>
          <span className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 block">18 Patients</span>
          <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">4 Critical Resuscitation</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Door-to-Doctor Time</span>
          <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">6.4 mins</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Benchmark: &lt;15 mins</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Inbound EMS En Route</span>
          <span className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 block">2 Ambulances</span>
          <span className="text-[11px] text-amber-700 dark:text-amber-300">Next ETA: 4 minutes</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Resus Bays Available</span>
          <span className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block">2 of 6 Bays</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Fast-Track Beds: 5 Open</span>
        </div>
      </div>

      {/* Main Grid: Live Cases & Inbound Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Active Triage Cases */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  Live Emergency Severity Index (ESI) Triage Board
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Sorted by acuity priority & physiological deterioration risk</p>
              </div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                4 Priority Cases
              </span>
            </div>

            <div className="space-y-3">
              {emergencyCases.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedCaseId === c.id
                      ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-700 ring-2 ring-rose-500/20'
                      : 'bg-slate-50/50 dark:bg-slate-850/50 border-slate-200 dark:border-slate-800 hover:bg-slate-100/60 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {getEsiBadge(c.esiLevel)}
                        <span className="font-extrabold text-sm text-slate-900 dark:text-slate-100">{c.patientName}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">({c.gender}, {c.age}y)</span>
                        <span className="text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.2 rounded text-slate-700 dark:text-slate-300">
                          {c.mrn}
                        </span>
                        {c.codeAlert && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white">
                            CODE {c.codeAlert}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200 italic">
                        &ldquo;{c.chiefComplaint}&rdquo;
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 mt-1">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                          <span>Bay: <strong className="text-slate-900 dark:text-slate-200">{c.assignedBay}</strong></span>
                          <span>Attending: <strong className="text-indigo-700 dark:text-indigo-300 font-bold">{c.attendingPhysician}</strong></span>
                          <span className="text-slate-400 dark:text-slate-500">Arrived: {c.arrivalTime}</span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRouting(c);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer shrink-0"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Route to Consultant</span>
                        </button>
                      </div>
                    </div>

                    {/* Vitals Quick Pill */}
                    <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs shrink-0 font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block">HR</span>
                        <span className={`font-bold ${c.vitals.hr > 100 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {c.vitals.hr}
                        </span>
                      </div>
                      <div className="border-l border-slate-200 dark:border-slate-700 pl-2">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block">BP</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{c.vitals.bp}</span>
                      </div>
                      <div className="border-l border-slate-200 dark:border-slate-700 pl-2">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block">SpO2</span>
                        <span className={`font-bold ${c.vitals.spo2 < 95 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {c.vitals.spo2}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Inbound EMS & Fast Action Deck */}
        <div className="lg:col-span-4 space-y-4">
          {/* Inbound Ambulances */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Ambulance className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Inbound EMS Telemetry
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                2 Units In Transit
              </span>
            </div>

            <div className="space-y-3">
              {inboundAmbulances.map((amb) => (
                <div key={amb.id} className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-950 dark:text-amber-200">{amb.unit}</span>
                    <span className="px-2 py-0.5 bg-amber-500 text-white font-extrabold rounded text-[10px]">
                      ETA {amb.eta}
                    </span>
                  </div>

                  <p className="text-slate-800 dark:text-slate-200 font-semibold">{amb.chiefComplaint}</p>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    <div>Crew: {amb.crewLeader}</div>
                    <div className="text-rose-700 dark:text-rose-400 font-mono font-bold">Field Vitals: {amb.vitals}</div>
                    <div className="text-blue-700 dark:text-blue-400 font-bold mt-1">Staged at: {amb.preparedBay}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rapid Order Actions */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 text-xs transition-colors">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Emergency Protocol Orders</h3>
            <p className="text-slate-500 dark:text-slate-400">Execute immediate standing orders for selected patient ({selectedCase.patientName}):</p>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => handleOpenRouting(selectedCase)}
                className="w-full text-left p-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold flex items-center justify-between shadow-xs cursor-pointer transition-all active:scale-98"
              >
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-200" />
                  <span>Route Patient to Specialist Consultant</span>
                </div>
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded text-white font-black">
                  MATCH & DISPATCH
                </span>
              </button>
              <button
                type="button"
                onClick={() => alert(`Stat Portable Chest X-Ray & 12-Lead ECG ordered for ${selectedCase.patientName}`)}
                className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span>Stat Portable Chest X-Ray & 12-Lead ECG</span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">CPT 71045 + 93000</span>
              </button>
              <button
                type="button"
                onClick={() => alert(`Type & Crossmatch 4 Units PRBCs ordered from Blood Bank for ${selectedCase.patientName}`)}
                className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span>Type & Screen + Crossmatch 4 Units PRBCs</span>
                <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">Blood Bank Stat</span>
              </button>
              <button
                type="button"
                onClick={() => alert(`ICU Bed Bedside Transfer initiated for ${selectedCase.patientName}`)}
                className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span>Direct Transfer to Intensive Care Unit (ICU)</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">Bed Admit</span>
              </button>
            </div>
          </div>
        </div>
      </div>

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
          onRoutedSuccess={handleConsultantRouted}
        />
      )}
    </div>
  );
}
