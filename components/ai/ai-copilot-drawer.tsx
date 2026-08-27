'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Sparkles,
  X,
  Send,
  Stethoscope,
  Receipt,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Mic,
  MicOff,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function AiCopilotDrawer() {
  const { copilotOpen, setCopilotOpen, patients, selectedPatientId, addClinicalNote } = useHospital();
  const [noteInput, setNoteInput] = useState(
    'Patient arrived with 4-hour acute retrosternal chest pain. Bedside 2D Echocardiogram performed showing mild inferior wall hypokinesis. Started IV Nitroglycerin infusion 20mcg/min over 4 hours. Administered IV Morphine 4mg and ordered stat Troponin I panel.'
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);

  const patient = patients.find(p => p.id === selectedPatientId) || patients[0];

  if (!copilotOpen) return null;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/gemini/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteText: noteInput,
          patientContext: {
            name: patient?.fullName,
            mrn: patient?.mrn,
            age: patient?.age,
            allergies: patient?.allergies,
            chronicConditions: patient?.chronicConditions,
          },
        }),
      });
      const data = await res.json();
      setAnalysisResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyToPatient = () => {
    if (!patient || !analysisResult) return;
    addClinicalNote(patient.id, {
      author: 'Dr. Sarah Jenkins (via AI Copilot)',
      role: 'Attending Physician',
      category: 'SOAP',
      content: noteInput,
      aiStructuredData: analysisResult,
    });
    setCopilotOpen(false);
  };

  return (
    <>
      {/* Mobile / Tablet Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 transition-opacity cursor-pointer animate-in fade-in duration-200"
        onClick={() => setCopilotOpen(false)}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] max-w-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col font-sans transition-all animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">G-HIMS AI Clinical & Billing Copilot</h3>
              <p className="text-[10px] text-blue-200">Point-of-Care Scribe & Revenue Validator</p>
            </div>
          </div>
          <button
            onClick={() => setCopilotOpen(false)}
            className="min-w-[36px] min-h-[36px] p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center cursor-pointer"
            aria-label="Close AI Copilot"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Patient Context Tag */}
        <div className="px-4 py-2.5 bg-blue-50/70 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/50 flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            Target Patient: <strong className="text-slate-900 dark:text-slate-100">{patient?.fullName}</strong> ({patient?.mrn})
          </span>
          <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded">
            Age: {patient?.age}y • {patient?.gender}
          </span>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Ambient Dictation Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Doctor Dictation / Clinical Scribe Input
              </label>
              <button
                onClick={() => setIsRecording(!isRecording)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  isRecording ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {isRecording ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                {isRecording ? 'Listening...' : 'Voice Dictate'}
              </button>
            </div>

            <textarea
              rows={4}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Type or dictate clinical findings, procedures, and prescriptions..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-750 transition-all font-sans leading-relaxed"
            />

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !noteInput.trim()}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer min-h-[44px]"
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" /> Structuring SOAP & Billing Codes...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Parse Clinical Note & Cross-Audit Billing
                </span>
              )}
            </button>
          </div>

          {/* Structured Results */}
          {analysisResult && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider block">
                  Structured Clinical Extraction
                </span>

                {analysisResult.diagnoses && (
                  <div>
                    <span className="font-bold text-slate-700 dark:text-slate-300 block">Diagnoses (ICD-10):</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {analysisResult.diagnoses.map((d: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[11px] font-medium text-slate-800 dark:text-slate-200">
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {analysisResult.medicationsPrescribed && analysisResult.medicationsPrescribed.length > 0 && (
                  <div>
                    <span className="font-bold text-slate-700 dark:text-slate-300 block">Prescriptions:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {analysisResult.medicationsPrescribed.map((m: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded text-[11px]">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Auto-extracted Billing Codes */}
              {analysisResult.billingCodes && analysisResult.billingCodes.length > 0 && (
                <div className="p-3 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1">
                      <Receipt className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Detected Billable CPT Procedures
                    </span>
                    <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                      +{formatCurrency(analysisResult.billingCodes.reduce((sum: number, c: any) => sum + (c.fee || 0), 0))}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {analysisResult.billingCodes.map((code: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded border border-emerald-200 dark:border-emerald-800/80 text-xs">
                        <div>
                          <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">CPT {code.code}</span>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400">{code.description}</p>
                        </div>
                        <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(code.fee || 0)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Apply Button */}
              <button
                onClick={handleApplyToPatient}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer min-h-[44px]"
              >
                <CheckCircle2 className="w-4 h-4" /> Save Note & Push Unbilled Items to Audit Ledger
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
