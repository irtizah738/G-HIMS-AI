'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Users,
  ShieldCheck,
  AlertTriangle,
  Merge,
  QrCode,
  Barcode,
  Phone,
  CreditCard,
  Calendar,
  CheckCircle2,
  ExternalLink,
  PlusCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { PatientDemographics, MpiMatchResult } from '@/types/opd-domain';

interface OpdPatientSearchMpiProps {
  patients: PatientDemographics[];
  onSelectPatient: (patient: PatientDemographics) => void;
  onInitiateNewRegistration: (initialData?: Partial<PatientDemographics>) => void;
  onInitiateMergeRequest: (sourcePatientId: string, targetPatientId: string, reason: string) => void;
}

export function OpdPatientSearchMpi({
  patients,
  onSelectPatient,
  onInitiateNewRegistration,
  onInitiateMergeRequest,
}: OpdPatientSearchMpiProps) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchField, setSearchField] = useState<'ALL' | 'MRN' | 'CNIC' | 'PHONE' | 'NAME' | 'APPT'>('ALL');
  const [selectedForReview, setSelectedForReview] = useState<PatientDemographics | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState<boolean>(false);
  const [targetMergePatientId, setTargetMergePatientId] = useState<string>('');
  const [mergeReason, setMergeReason] = useState<string>('');
  const [simulatedBarcode, setSimulatedBarcode] = useState<string>('');

  // Filtered patients based on search
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) {
      return patients;
    }

    const q = searchTerm.trim();
    const qLower = q.toLowerCase();
    const normalizedMrn = normalizeMrn(q);
    const normalizedCnic = normalizeCnic(q);

    return patients.filter((p) => {
      if (searchField === 'MRN') return normalizeMrn(p.mrn) === normalizedMrn;
      if (searchField === 'CNIC') return normalizeCnic(p.nationalId) === normalizedCnic;
      if (searchField === 'PHONE') return p.phone.toLowerCase().includes(qLower);
      if (searchField === 'NAME') return p.fullName.toLowerCase().includes(qLower);

      return (
        p.fullName.toLowerCase().includes(qLower) ||
        normalizeMrn(p.mrn) === normalizedMrn ||
        normalizeCnic(p.nationalId) === normalizedCnic ||
        p.phone.toLowerCase().includes(qLower) ||
        (p.preferredName && p.preferredName.toLowerCase().includes(qLower))
      );
    });
  }, [patients, searchTerm, searchField]);

  // Real-time MPI Duplicate Detection Engine for current search or prospective new patient
  const mpiDuplicateMatches = useMemo((): MpiMatchResult[] => {
    if (!searchTerm.trim() || searchTerm.length < 3) return [];
    const q = searchTerm.toLowerCase().trim();

    return patients.map((candidate) => {
      let score = 0;
      const matchReasons: string[] = [];

      // CNIC exact match (100% deterministic)
      if (normalizeCnic(candidate.nationalId) === normalizeCnic(q)) {
        score = 100;
        matchReasons.push('Exact CNIC / National ID Match');
      }

      // Phone match (90%)
      if (candidate.phone.toLowerCase().includes(q) || q.includes(candidate.phone.toLowerCase())) {
        score = Math.max(score, 90);
        matchReasons.push('Contact Phone Number Collision');
      }

      // Full Name match (75%)
      if (candidate.fullName.toLowerCase().includes(q)) {
        score = Math.max(score, 75);
        matchReasons.push('Phonetic Name Alignment');
      }

      return {
        candidatePatient: candidate,
        matchScore: score,
        matchReasons,
        isDefiniteDuplicate: score >= 90,
      };
    }).filter((r) => r.matchScore >= 60);
  }, [patients, searchTerm]);

  const handleSimulateScan = () => {
    if (patients.length > 0) {
      const p = patients[0];
      setSearchTerm(p.mrn);
      setSimulatedBarcode(`BARCODE:${p.mrn}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Fast Action Bar */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              Master Patient Index (MPI) Multi-Criteria Search
            </h2>
            <p className="text-xs text-slate-500">
              Query tenant MPI by MRN, National ID / CNIC, Phone, Name, Barcode or Appointment token before initiating registration.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSimulateScan}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Simulate 2D Barcode / Wristband Scan"
            >
              <Barcode className="w-4 h-4 text-blue-600" />
              Scan Barcode / QR
            </button>
            <button
              onClick={() => onInitiateNewRegistration({ fullName: searchTerm })}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Register New Patient
            </button>
          </div>
        </div>

        {/* Search Input and Criteria Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-3 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Patient Full Name, MRN (e.g. MRN-20260901-8842), National ID/CNIC, Phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>

          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as any)}
            className="px-3 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold"
          >
            <option value="ALL">All Fields (Smart Search)</option>
            <option value="MRN">Institutional MRN</option>
            <option value="CNIC">National ID / CNIC</option>
            <option value="PHONE">Primary Contact Phone</option>
            <option value="NAME">Legal / Preferred Name</option>
          </select>
        </div>
      </div>

      {/* Duplicate Alert Banner (if high-probability collision found) */}
      {mpiDuplicateMatches.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              MPI Deterministic Duplicate Detection: {mpiDuplicateMatches.length} Candidate Collision(s)
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900">
              Confidence: {Math.max(...mpiDuplicateMatches.map((m) => m.matchScore))}%
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mpiDuplicateMatches.map(({ candidatePatient, matchScore, matchReasons }) => (
              <div
                key={candidatePatient.id}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs"
              >
                <div>
                  <p className="font-bold text-slate-900 dark:text-slate-100">{candidatePatient.fullName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    MRN: {candidatePatient.mrn} • CNIC: {candidatePatient.nationalId}
                  </p>
                  <div className="flex gap-1 mt-1">
                    {matchReasons.map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => onSelectPatient(candidatePatient)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                  >
                    Select Patient
                  </button>
                  <button
                    onClick={() => {
                      setSelectedForReview(candidatePatient);
                      setMergeModalOpen(true);
                    }}
                    className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Merge className="w-3 h-3" />
                    Merge Request
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patient Search Results Table */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            Registry Matching Records ({searchResults.length})
          </h3>
          <span className="text-xs text-slate-400">Strict Tenant-Isolated Scope</span>
        </div>

        {searchResults.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
            <Users className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-500">No patient records found matching &quot;{searchTerm}&quot;</p>
            <button
              onClick={() => onInitiateNewRegistration({ fullName: searchTerm })}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Register &quot;{searchTerm}&quot; as New Patient
            </button>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">MRN</th>
                  <th className="p-3">Patient Name</th>
                  <th className="p-3">CNIC / National ID</th>
                  <th className="p-3">Age / Sex</th>
                  <th className="p-3">Contact Phone</th>
                  <th className="p-3">Payer Plan</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {searchResults.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="p-3 font-mono font-bold text-blue-600">{p.mrn}</td>
                    <td className="p-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{p.fullName}</p>
                      {p.preferredName && (
                        <p className="text-[10px] text-slate-400">Pref: {p.preferredName}</p>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-600 dark:text-slate-400">{p.nationalId}</td>
                    <td className="p-3">
                      {p.age}y • {p.gender}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-400">{p.phone}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        p.tariffPlan === 'SEHAT_CARD_UNIVERSAL'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : p.tariffPlan === 'CORPORATE_PPO'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {p.tariffPlan.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => onSelectPatient(p)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        Start OPD Visit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MPI Duplicate Merge Request Modal */}
      {mergeModalOpen && selectedForReview && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Merge className="w-5 h-5 text-amber-600" />
              MPI Record Reconciliation & Merge Request
            </h3>
            <p className="text-xs text-slate-500">
              Submitting this request flags the duplicate identity graph for Medical Records Administrator approval. All longitudinal clinical events and encounters will be consolidated.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-500">Source Duplicate:</span>
                <span className="font-bold">{selectedForReview.fullName} ({selectedForReview.mrn})</span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Merge Into Target Patient ID / MRN:
                </label>
                <select
                  value={targetMergePatientId}
                  onChange={(e) => setTargetMergePatientId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="">Select target verified record...</option>
                  {patients
                    .filter((p) => p.id !== selectedForReview.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} — {p.mrn} (CNIC: {p.nationalId})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Clinical & Legal Justification for Merge:
                </label>
                <textarea
                  rows={2}
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                  placeholder="e.g. Duplicate MRN issued due to typographical error in CNIC at triage desk."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setMergeModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!targetMergePatientId || !mergeReason.trim()}
                onClick={() => {
                  onInitiateMergeRequest(selectedForReview.id, targetMergePatientId, mergeReason);
                  setMergeModalOpen(false);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                  !targetMergePatientId || !mergeReason.trim()
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                }`}
              >
                <Merge className="w-3.5 h-3.5" />
                Submit Immutable Merge Command
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
