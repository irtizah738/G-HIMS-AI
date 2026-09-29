'use client';

import React, { useState } from 'react';
import {
  FileCheck,
  CheckCircle2,
  Calendar,
  ArrowRightLeft,
  Building,
  AlertTriangle,
  Send,
  Bed,
  ShieldAlert,
  FileText,
  Printer,
  Sparkles,
} from 'lucide-react';
import {
  ComprehensiveOpdEncounter,
  EncounterDisposition,
  OpdDispositionType,
  InternalReferral,
  ExternalReferral,
} from '@/types/opd-domain';

interface OpdDispositionReferralsProps {
  encounter: ComprehensiveOpdEncounter;
  onCommitDisposition: (disposition: EncounterDisposition) => void;
}

export function OpdDispositionReferrals({
  encounter,
  onCommitDisposition,
}: OpdDispositionReferralsProps) {
  const [dispositionType, setDispositionType] = useState<OpdDispositionType>('DISCHARGED_HOME');
  const [dischargeInstructions, setDischargeInstructions] = useState<string>(
    '1. Continue prescribed medications as directed. 2. Maintain low-sodium diet (<2g/day). 3. Restrict heavy physical exertion. 4. Daily morning weight monitoring.'
  );
  const [warningSigns, setWarningSigns] = useState<string>(
    'Seek immediate Emergency Room care if you experience: Sudden acute chest pressure radiating to left arm/jaw, severe shortness of breath at rest, fainting (syncope), or blue discoloration of lips.'
  );

  // Follow-up
  const [followUpDate, setFollowUpDate] = useState<string>(
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [followUpDept, setFollowUpDept] = useState<string>(encounter.department || 'Cardiology');
  const [followUpReason, setFollowUpReason] = useState<string>('Clinical review of therapy response & repeat serum RFT/BNP');

  // Internal Referral
  const [internalTargetDept, setInternalTargetDept] = useState<string>('Cardiology');
  const [internalTargetDoc, setInternalTargetDoc] = useState<string>('Dr. Sarah Jenkins');
  const [internalPriority, setInternalPriority] = useState<'ROUTINE' | 'URGENT' | 'STAT'>('URGENT');
  const [internalReason, setInternalReason] = useState<string>('Detailed Transthoracic Echocardiogram and 24h Holter assessment');

  // External Referral / SBAR
  const [extHospital, setExtHospital] = useState<string>('Armed Forces Institute of Cardiology (AFIC / NIHD)');
  const [extPhysician, setExtPhysician] = useState<string>('Consultant Electrophysiologist');
  const [sbarSituation, setSbarSituation] = useState<string>('36yo female with NYHA Class II Heart Failure for advanced cardiac imaging.');
  const [sbarBackground, setSbarBackground] = useState<string>('Essential hypertension for 4 years. On ARB therapy. Baseline ECG completed.');
  const [sbarAssessment, setSbarAssessment] = useState<string>('Decompensated heart failure responsive to initial loop diuretic.');
  const [sbarRecommendation, setSbarRecommendation] = useState<string>('Evaluate for cardiac MRI / Coronary Angiography.');

  // Inpatient Admission
  const [admissionWard, setAdmissionWard] = useState<string>('General Medical Inpatient Ward (Ward 4B)');
  const [admissionBedId, setAdmissionBedId] = useState<string>('');
  const [admissionReason, setAdmissionReason] = useState<string>('IV Inotropic titration & close hemodynamic monitoring');

  const [signingDoctor, setSigningDoctor] = useState<string>('Dr. Sarah Jenkins (Cardiology Specialist)');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let internalRef: InternalReferral | undefined;
    if (dispositionType === 'INTERNAL_REFERRAL') {
      internalRef = {
        id: `ref-int-${Date.now()}`,
        targetDepartment: internalTargetDept,
        targetDoctor: internalTargetDoc,
        priority: internalPriority,
        clinicalReason: internalReason,
        targetQueueGenerated: true,
      };
    }

    let externalRef: ExternalReferral | undefined;
    if (dispositionType === 'EXTERNAL_REFERRAL') {
      externalRef = {
        id: `ref-ext-${Date.now()}`,
        receivingHospitalName: extHospital,
        receivingDoctorName: extPhysician,
        sbarHandover: {
          situation: sbarSituation,
          background: sbarBackground,
          assessment: sbarAssessment,
          recommendation: sbarRecommendation,
        },
        transportMode: 'PATIENT_OWN_TRANSPORT',
      };
    }

    const disposition: EncounterDisposition = {
      type: dispositionType,
      patientInstructions: dischargeInstructions,
      warningSignsRedFlags: warningSigns,
      followUpScheduledDate: dispositionType === 'FOLLOW_UP_SCHEDULED' ? followUpDate : undefined,
      followUpDepartment: dispositionType === 'FOLLOW_UP_SCHEDULED' ? followUpDept : undefined,
      internalReferral: internalRef,
      externalReferral: externalRef,
      inpatientAdmissionRequest:
        dispositionType === 'INPATIENT_ADMISSION_RECOMMENDED'
          ? {
              targetWard: admissionWard,
              targetBedId: admissionBedId.trim() || undefined,
              clinicalIndication: admissionReason,
              admittingService: 'Cardiology Services',
            }
          : undefined,
      completedAt: Date.now(),
      completedBy: signingDoctor,
    };

    onCommitDisposition(disposition);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-emerald-600" />
            Outpatient Encounter Disposition, Referrals & Clinical Sign-off
          </h2>
          <p className="text-xs text-slate-500">
            Designate definitive outpatient disposition, schedule follow-up, dispatch internal specialist queues, or generate SBAR referral documents.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Disposition Selector */}
        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
            Definitive Disposition Pathway *
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { type: 'DISCHARGED_HOME', label: 'Discharge Home', color: 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300' },
              { type: 'FOLLOW_UP_SCHEDULED', label: 'Follow-Up Clinic', color: 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300' },
              { type: 'INTERNAL_REFERRAL', label: 'Internal Specialist', color: 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300' },
              { type: 'EXTERNAL_REFERRAL', label: 'External Hospital (SBAR)', color: 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30 text-purple-800 dark:text-purple-300' },
              { type: 'INPATIENT_ADMISSION_RECOMMENDED', label: 'Inpatient Admission', color: 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300' },
              { type: 'EMERGENCY_TRANSFER', label: 'Emergency Room', color: 'border-red-500 bg-red-50/50 dark:bg-red-950/30 text-red-800 dark:text-red-300' },
            ].map((p) => (
              <button
                type="button"
                key={p.type}
                onClick={() => setDispositionType(p.type as OpdDispositionType)}
                className={`p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer ${
                  dispositionType === p.type ? `${p.color} ring-2 ring-blue-500 shadow-xs` : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Branching Context based on selected Disposition */}

        {/* 1. Follow-up Branch */}
        {dispositionType === 'FOLLOW_UP_SCHEDULED' && (
          <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-3">
            <h3 className="text-xs font-bold uppercase text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Follow-Up Clinic Booking Engine
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Target Date</label>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Department / Clinic</label>
                <select
                  value={followUpDept}
                  onChange={(e) => setFollowUpDept(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900"
                >
                  <option value="Cardiology">Cardiology</option>
                  <option value="General Medicine">General Medicine</option>
                  <option value="Pediatrics">Pediatrics</option>
                  <option value="Orthopedics">Orthopedics</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Visit Goal / Reason</label>
                <input
                  type="text"
                  value={followUpReason}
                  onChange={(e) => setFollowUpReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* 2. Internal Referral Branch */}
        {dispositionType === 'INTERNAL_REFERRAL' && (
          <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 space-y-3">
            <h3 className="text-xs font-bold uppercase text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4" />
              Internal Specialty Referral & Automated Queue Ingress
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Target Department</label>
                <select
                  value={internalTargetDept}
                  onChange={(e) => setInternalTargetDept(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900"
                >
                  <option value="Cardiology">Cardiology</option>
                  <option value="Orthopedics">Orthopedics</option>
                  <option value="Neurology">Neurology</option>
                  <option value="Ophthalmology">Ophthalmology</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Priority</label>
                <select
                  value={internalPriority}
                  onChange={(e) => setInternalPriority(e.target.value as any)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 font-bold"
                >
                  <option value="ROUTINE">Routine</option>
                  <option value="URGENT">Urgent (Same Day Queue)</option>
                  <option value="STAT">STAT Emergency Evaluation</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Referral Indication</label>
                <input
                  type="text"
                  value={internalReason}
                  onChange={(e) => setInternalReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. External Referral SBAR Branch */}
        {dispositionType === 'EXTERNAL_REFERRAL' && (
          <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 space-y-3">
            <h3 className="text-xs font-bold uppercase text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              Structured SBAR Clinical Transfer Documentation
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Receiving Institution</label>
                <input
                  type="text"
                  value={extHospital}
                  onChange={(e) => setExtHospital(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Target Specialist / Unit</label>
                <input
                  type="text"
                  value={extPhysician}
                  onChange={(e) => setExtPhysician(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold mb-1">S — Situation</label>
                <textarea
                  rows={2}
                  value={sbarSituation}
                  onChange={(e) => setSbarSituation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">B — Background</label>
                <textarea
                  rows={2}
                  value={sbarBackground}
                  onChange={(e) => setSbarBackground(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">A — Assessment</label>
                <textarea
                  rows={2}
                  value={sbarAssessment}
                  onChange={(e) => setSbarAssessment(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">R — Recommendation</label>
                <textarea
                  rows={2}
                  value={sbarRecommendation}
                  onChange={(e) => setSbarRecommendation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* 4. Inpatient Admission Branch */}
        {dispositionType === 'INPATIENT_ADMISSION_RECOMMENDED' && (
          <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-3">
            <h3 className="text-xs font-bold uppercase text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <Bed className="w-4 h-4" />
              Inpatient Admission Handoff Protocol
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Target Inpatient Ward</label>
                <input
                  type="text"
                  value={admissionWard}
                  onChange={(e) => setAdmissionWard(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Target Bed ID *</label>
                <input
                  type="text"
                  required={dispositionType === 'INPATIENT_ADMISSION_RECOMMENDED'}
                  value={admissionBedId}
                  onChange={(e) => setAdmissionBedId(e.target.value)}
                  placeholder="e.g. bed-gen-201"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900"
                />
                <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                  Admission executes only against an authoritative available bed identifier.
                </p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Admission Clinical Indication</label>
                <input
                  type="text"
                  value={admissionReason}
                  onChange={(e) => setAdmissionReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* Universal Patient Instructions & Red Flags */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Patient Care & Discharge Instructions
            </label>
            <textarea
              rows={3}
              value={dischargeInstructions}
              onChange={(e) => setDischargeInstructions(e.target.value)}
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-red-600 dark:text-red-400">
              Mandatory Red-Flag Warning Signs (Emergency Triggers)
            </label>
            <textarea
              rows={3}
              value={warningSigns}
              onChange={(e) => setWarningSigns(e.target.value)}
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-950/20 text-red-900 dark:text-red-200"
            />
          </div>
        </div>

        {/* Doctor Digital Signature */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label className="block text-xs font-semibold mb-1">Attending Physician Electronic Signature</label>
            <input
              type="text"
              value={signingDoctor}
              onChange={(e) => setSigningDoctor(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
            />
          </div>

          <div className="flex items-end justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              Finalize Clinical Closure & Seal Encounter
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
