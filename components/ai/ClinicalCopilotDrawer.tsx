'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Send,
  Stethoscope,
  Receipt,
  FileText,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Tag,
  BookOpen,
  Activity,
} from 'lucide-react';
import { SoapDrafterOutput, RecommendedIcd10 } from '@/lib/ai/flows/soap-drafter';
import { Icd10CrosswalkOutput, MappedIcd10Code } from '@/lib/ai/flows/icn10-crosswalk';
import { DenialAppealOutput } from '@/lib/ai/flows/denial-appeal';

interface ClinicalCopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
  patientContext?: {
    patientId?: string;
    mrn?: string;
    fullName?: string;
    age?: number;
    gender?: string;
    ward?: string;
    bed?: string;
    chiefComplaint?: string;
    vitals?: Record<string, string | number>;
  };
  onApplySoap?: (soap: SoapDrafterOutput) => void;
  onApplyIcd10?: (code: string, description: string) => void;
}

type CopilotTab = 'soap' | 'icd10' | 'denial';

export function ClinicalCopilotDrawer({
  isOpen,
  onClose,
  tenantId = 'default',
  patientContext,
  onApplySoap,
  onApplyIcd10,
}: ClinicalCopilotDrawerProps) {
  const [activeTab, setActiveTab] = useState<CopilotTab>('soap');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // SOAP State
  const [chiefComplaint, setChiefComplaint] = useState(
    patientContext?.chiefComplaint || 'Acute retrosternal chest pain with diaphoresis'
  );
  const [doctorNotes, setDoctorNotes] = useState(
    'Patient arrived with 4-hour acute retrosternal chest pain radiating to left arm. Bedside 2D Echocardiogram showing mild inferior wall hypokinesis. Started IV Nitroglycerin infusion 20mcg/min. Administered IV Morphine 4mg and ordered stat Troponin I panel.'
  );
  const [isGeneratingSoap, setIsGeneratingSoap] = useState(false);
  const [soapResult, setSoapResult] = useState<SoapDrafterOutput | null>(null);

  // ICD-10 State
  const [icdPrimaryDiag, setIcdPrimaryDiag] = useState('Acute ST-elevation myocardial infarction');
  const [icdSummary, setIcdSummary] = useState(
    'Patient presenting with acute chest tightness, elevated Troponin I (0.84 ng/mL), ST elevation in leads II, III, aVF. Underwent emergency cardiac catheterization.'
  );
  const [isGeneratingIcd, setIsGeneratingIcd] = useState(false);
  const [icdResult, setIcdResult] = useState<Icd10CrosswalkOutput | null>(null);

  // Denial Appeal State
  const [claimId, setClaimId] = useState('CLM-2026-8942');
  const [denialCode, setDenialCode] = useState('CO-50');
  const [denialDesc, setDenialDesc] = useState(
    'These are non-covered services because this is not deemed a medical necessity by the payer.'
  );
  const [procedure, setProcedure] = useState(
    'Emergency Percutaneous Coronary Intervention (PCI) with Drug-Eluting Stent Placement'
  );
  const [doctorAttestation, setDoctorAttestation] = useState(
    'Patient presented with acute inferolateral STEMI in cardiogenic shock. Immediate revascularization was required to prevent fatal myocardial necrosis.'
  );
  const [isGeneratingAppeal, setIsGeneratingAppeal] = useState(false);
  const [appealResult, setAppealResult] = useState<DenialAppealOutput | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, sectionKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionKey);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  // Generate SOAP Note
  const handleGenerateSoap = async () => {
    setIsGeneratingSoap(true);
    try {
      const res = await fetch('/api/ai/soap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          patientId: patientContext?.mrn || patientContext?.patientId || 'PT-UNKNOWN',
          chiefComplaint,
          vitals: patientContext?.vitals || {
            BP: '148/92 mmHg',
            HR: '104 bpm',
            SpO2: '94% on room air',
            Temp: '37.1 °C',
            RR: '22 /min',
          },
          doctorNotes,
        }),
      });

      const data = await res.json();
      setSoapResult(data);
    } catch (err) {
      console.error('SOAP Generation error:', err);
    } finally {
      setIsGeneratingSoap(false);
    }
  };

  // Generate ICD-10 Crosswalk
  const handleGenerateIcd = async () => {
    setIsGeneratingIcd(true);
    try {
      const res = await fetch('/api/ai/icd10', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          primaryDiagnosis: icdPrimaryDiag,
          clinicalSummary: icdSummary,
        }),
      });

      const data = await res.json();
      setIcdResult(data);
    } catch (err) {
      console.error('ICD-10 Generation error:', err);
    } finally {
      setIsGeneratingIcd(false);
    }
  };

  // Generate Denial Appeal
  const handleGenerateAppeal = async () => {
    setIsGeneratingAppeal(true);
    try {
      const res = await fetch('/api/ai/denial-appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          claimId,
          denialReasonCode: denialCode,
          denialDescription: denialDesc,
          patientDemographics: {
            Name: patientContext?.fullName || 'John Doe',
            MRN: patientContext?.mrn || 'MRN-89021',
            Age: patientContext?.age || 58,
          },
          clinicalProcedure: procedure,
          doctorAttestation,
        }),
      });

      const data = await res.json();
      setAppealResult(data);
    } catch (err) {
      console.error('Denial Appeal generation error:', err);
    } finally {
      setIsGeneratingAppeal(false);
    }
  };

  return (
    <div
      id="clinical-copilot-overlay"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in"
    >
      <div
        id="clinical-copilot-container"
        className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                G-HIMS Clinical AI Copilot
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium">
                  Gemini 3.7 Pro
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {patientContext?.fullName
                  ? `Active Patient: ${patientContext.fullName} (${patientContext.mrn || 'No MRN'})`
                  : 'Active Clinical Decision Support & Billing Intelligence'}
              </p>
            </div>
          </div>
          <button
            id="close-copilot-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Close Assistant"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-2 gap-2">
          <button
            id="tab-soap"
            onClick={() => setActiveTab('soap')}
            className={`pb-3 px-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'soap'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            SOAP Drafter
          </button>
          <button
            id="tab-icd10"
            onClick={() => setActiveTab('icd10')}
            className={`pb-3 px-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'icd10'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Tag className="w-4 h-4" />
            ICD-10 Helper
          </button>
          <button
            id="tab-denial"
            onClick={() => setActiveTab('denial')}
            className={`pb-3 px-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'denial'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Denial Appeal Generator
          </button>
        </div>

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: SOAP DRAFTER */}
          {activeTab === 'soap' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Chief Complaint
                </label>
                <input
                  id="soap-chief-complaint"
                  type="text"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Acute chest pain, shortness of breath"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Physician Dictation / Clinical Notes
                </label>
                <textarea
                  id="soap-doctor-notes"
                  rows={4}
                  value={doctorNotes}
                  onChange={(e) => setDoctorNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter raw encounter observations, exam findings, or dictation..."
                />
              </div>

              <button
                id="btn-generate-soap"
                onClick={handleGenerateSoap}
                disabled={isGeneratingSoap}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isGeneratingSoap ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Synthesizing Clinical SOAP Note...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Draft Clinical SOAP Note with Gemini
                  </>
                )}
              </button>

              {/* Render Structured SOAP Note Result */}
              {soapResult && (
                <div className="mt-4 space-y-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      Generated SOAP Documentation
                    </h3>
                    {onApplySoap && (
                      <button
                        id="btn-apply-soap"
                        onClick={() => onApplySoap(soapResult)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md flex items-center gap-1 shadow-xs transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Apply to Clinical Record
                      </button>
                    )}
                  </div>

                  {/* S - Subjective */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                        [S] SUBJECTIVE
                      </span>
                      <button
                        onClick={() => handleCopy(soapResult.subjective, 'subj')}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                      >
                        {copiedSection === 'subj' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      {soapResult.subjective}
                    </p>
                  </div>

                  {/* O - Objective */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                        [O] OBJECTIVE
                      </span>
                      <button
                        onClick={() => handleCopy(soapResult.objective, 'obj')}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                      >
                        {copiedSection === 'obj' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      {soapResult.objective}
                    </p>
                  </div>

                  {/* A - Assessment */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                        [A] ASSESSMENT
                      </span>
                      <button
                        onClick={() => handleCopy(soapResult.assessment, 'assess')}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                      >
                        {copiedSection === 'assess' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      {soapResult.assessment}
                    </p>
                  </div>

                  {/* P - Plan */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                        [P] PLAN
                      </span>
                      <button
                        onClick={() => handleCopy(soapResult.plan, 'plan')}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                      >
                        {copiedSection === 'plan' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                      {soapResult.plan}
                    </p>
                  </div>

                  {/* Recommended ICD-10 */}
                  {soapResult.recommendedIcd10 && soapResult.recommendedIcd10.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-indigo-600" />
                        Recommended WHO ICD-10-CM Codes
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {soapResult.recommendedIcd10.map((icd, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs shadow-2xs"
                          >
                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {icd.code}
                            </span>
                            <span className="text-slate-600 dark:text-slate-400 max-w-xs truncate">
                              {icd.description}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold">
                              {Math.round(icd.confidence * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ICD-10 HELPER */}
          {activeTab === 'icd10' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Primary Clinical Diagnosis
                </label>
                <input
                  id="icd-primary-input"
                  type="text"
                  value={icdPrimaryDiag}
                  onChange={(e) => setIcdPrimaryDiag(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Acute Appendicitis, STEMI, Pneumonia"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Clinical Summary & Encounter Narrative
                </label>
                <textarea
                  id="icd-summary-input"
                  rows={4}
                  value={icdSummary}
                  onChange={(e) => setIcdSummary(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  placeholder="Paste physician documentation, operative notes, or discharge summary..."
                />
              </div>

              <button
                id="btn-generate-icd"
                onClick={handleGenerateIcd}
                disabled={isGeneratingIcd}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isGeneratingIcd ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Cross-walking ICD-10 Taxonomy...
                  </>
                ) : (
                  <>
                    <Tag className="w-4 h-4" />
                    Map ICD-10-CM Codes with Rationale
                  </>
                )}
              </button>

              {/* Render ICD-10 Results */}
              {icdResult && (
                <div className="space-y-3 mt-4">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                        Primary Billable Code
                      </span>
                      <div className="text-lg font-mono font-bold text-indigo-950 dark:text-white">
                        {icdResult.primaryCode}
                      </div>
                    </div>
                    {onApplyIcd10 && (
                      <button
                        onClick={() =>
                          onApplyIcd10(
                            icdResult.primaryCode,
                            icdResult.mappedCodes[0]?.description || ''
                          )
                        }
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1"
                      >
                        Apply Primary Code
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Mapped Comorbidities & Secondary Diagnoses
                    </span>
                    {icdResult.mappedCodes.map((code, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">
                              {code.icd10Code}
                            </span>
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {code.description}
                            </span>
                          </div>
                          {onApplyIcd10 && (
                            <button
                              onClick={() => onApplyIcd10(code.icd10Code, code.description)}
                              className="text-xs text-indigo-600 hover:underline font-medium"
                            >
                              Use Code
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                          Rationale: {code.clinicalRationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DENIAL APPEAL GENERATOR */}
          {activeTab === 'denial' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Claim ID / Number
                  </label>
                  <input
                    id="appeal-claim-id"
                    type="text"
                    value={claimId}
                    onChange={(e) => setClaimId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Payer Denial Code
                  </label>
                  <input
                    id="appeal-denial-code"
                    type="text"
                    value={denialCode}
                    onChange={(e) => setDenialCode(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Denial Reason Description
                </label>
                <input
                  id="appeal-denial-desc"
                  type="text"
                  value={denialDesc}
                  onChange={(e) => setDenialDesc(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Clinical Procedure / Service Contested
                </label>
                <input
                  id="appeal-procedure"
                  type="text"
                  value={procedure}
                  onChange={(e) => setProcedure(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Doctor Attestation & Clinical Justification
                </label>
                <textarea
                  id="appeal-attestation"
                  rows={3}
                  value={doctorAttestation}
                  onChange={(e) => setDoctorAttestation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <button
                id="btn-generate-appeal"
                onClick={handleGenerateAppeal}
                disabled={isGeneratingAppeal}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isGeneratingAppeal ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Drafting Legal Necessity Appeal...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Generate Formal Denial Appeal Letter
                  </>
                )}
              </button>

              {/* Render Appeal Letter Result */}
              {appealResult && (
                <div className="space-y-3 mt-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {appealResult.appealLetterSubject}
                    </span>
                    <button
                      onClick={() => handleCopy(appealResult.appealLetterBody, 'appeal-body')}
                      className="px-2.5 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-md flex items-center gap-1 shadow-2xs hover:bg-slate-100"
                    >
                      {copiedSection === 'appeal-body' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      Copy Appeal Letter
                    </button>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                      {appealResult.appealLetterBody}
                    </p>
                  </div>

                  {/* Cited Medical Necessity Guidelines */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                      Cited Medical Necessity Standards
                    </span>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                      {appealResult.citedMedicalNecessityGuidelines.map((g, idx) => (
                        <li key={idx}>{g}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Required Supporting Documentation */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-amber-600" />
                      Evidence Attachments Checklist
                    </span>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                      {appealResult.supportingEvidenceRequired.map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
