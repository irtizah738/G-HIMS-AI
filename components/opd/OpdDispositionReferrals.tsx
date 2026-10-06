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

const IS_DEMO_RUNTIME =
  process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

interface OpdDispositionReferralsProps {
  encounter: ComprehensiveOpdEncounter;
  onCommitDisposition: (
    disposition: EncounterDisposition
  ) => Promise<void> | void;
}

export function OpdDispositionReferrals({
  encounter,
  onCommitDisposition,
}: OpdDispositionReferralsProps) {
  const [dispositionType, setDispositionType] = useState<OpdDispositionType>('DISCHARGED_HOME');
  const [dischargeInstructions, setDischargeInstructions] = useState<string>(
    IS_DEMO_RUNTIME
      ? 'Continue prescribed medications as directed and follow the documented care plan.'
      : ''
  );
  const [warningSigns, setWarningSigns] = useState<string>(
    IS_DEMO_RUNTIME
      ? 'Seek urgent care for new severe symptoms or clinical deterioration.'
      : ''
  );

  // Follow-up
  const [followUpDate, setFollowUpDate] = useState<string>(
    IS_DEMO_RUNTIME
      ? new Date(Date.now() + 7 * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10)
      : ''
  );
  const [followUpDept, setFollowUpDept] = useState<string>(
    encounter.department || ''
  );
  const [followUpReason, setFollowUpReason] = useState<string>(
    IS_DEMO_RUNTIME ? 'Clinical review' : ''
  );

  // Internal Referral
  const [internalTargetDept, setInternalTargetDept] = useState<string>(
    IS_DEMO_RUNTIME ? 'Cardiology' : ''
  );
  const [internalTargetDoc, setInternalTargetDoc] = useState<string>('');
  const [internalPriority, setInternalPriority] =
    useState<'ROUTINE' | 'URGENT' | 'STAT'>('ROUTINE');
  const [internalReason, setInternalReason] = useState<string>('');

  // External Referral / SBAR
  const [extHospital, setExtHospital] = useState<string>('');
  const [extPhysician, setExtPhysician] = useState<string>('');
  const [sbarSituation, setSbarSituation] = useState<string>('');
  const [sbarBackground, setSbarBackground] = useState<string>('');
  const [sbarAssessment, setSbarAssessment] = useState<string>('');
  const [sbarRecommendation, setSbarRecommendation] = useState<string>('');

  // Inpatient Admission
  const [admissionBedId, setAdmissionBedId] = useState<string>('');
  const [admissionReason, setAdmissionReason] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

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
              targetBedId: admissionBedId.trim() || undefined,
              clinicalIndication: admissionReason,
              admittingService: 'Cardiology Services',
            }
          : undefined,
      completedAt: Date.now(),
      completedBy: 'SERVER_AUTHENTICATED_ACTOR',
    };

    setSubmitting(true);
    try {
      await onCommitDisposition(disposition);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Encounter disposition could not be committed.'
      );
    } finally {
      setSubmitting(false);
    }
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
                <input
                  type="text"
                  value={followUpDept}
                  onChange={(e) => setFollowUpDept(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900"
                  placeholder="Receiving clinic / department"
                />
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
                  required={dispositionType === 'INPATIENT_ADMISSION_RECOMMENDED'}
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
              required
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
              required
              value={warningSigns}
              onChange={(e) => setWarningSigns(e.target.value)}
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-950/20 text-red-900 dark:text-red-200"
            />
          </div>
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? 'Committing…' : 'Commit Disposition'}
          </button>
        </div>
      </form>
    </div>
  );
}
