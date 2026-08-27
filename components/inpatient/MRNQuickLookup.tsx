'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  User,
  Building2,
  HeartPulse,
  LogOut,
  Sparkles,
  ArrowRightLeft,
  X,
  ChevronRight,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Stethoscope,
} from 'lucide-react';
import { Bed, Ward } from '@/types/inpatient-or';
import { getNEWS2BadgeClasses, NEWS2RiskLevel } from '@/lib/clinical/news2';

interface MRNQuickLookupProps {
  beds: Bed[];
  wards: Ward[];
  onSelectBed: (bed: Bed) => void;
  onQuickSanitize: (bed: Bed) => void;
  onDischarge: (bed: Bed) => void;
  onTransfer: (bed: Bed) => void;
}

export const MRNQuickLookup: React.FC<MRNQuickLookupProps> = ({
  beds,
  wards,
  onSelectBed,
  onQuickSanitize,
  onDischarge,
  onTransfer,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // All admitted/occupied beds with patients
  const occupiedBeds = useMemo(() => {
    return beds.filter((b) => b.status === 'occupied' && (b.patientName || b.patientMRN));
  }, [beds]);

  // Filter matching records
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    return occupiedBeds.filter((b) => {
      const matchMRN = b.patientMRN?.toLowerCase().includes(q);
      const matchName = b.patientName?.toLowerCase().includes(q);
      const matchBed = b.bedNumber.toLowerCase().includes(q);
      const matchWard = b.wardName.toLowerCase().includes(q);
      const matchDoc = b.assignedDoctor?.toLowerCase().includes(q);
      const matchDiag = b.primaryDiagnosis?.toLowerCase().includes(q);
      return matchMRN || matchName || matchBed || matchWard || matchDoc || matchDiag;
    });
  }, [occupiedBeds, query]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (bed: Bed) => {
    onSelectBed(bed);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search Input Bar */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-blue-600 dark:text-blue-400">
          <Search className="h-4 w-4" />
        </div>

        <input
          id="mrn-quick-lookup-input"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="MRN Quick Lookup across all wards (e.g. GH-2026-1042, patient name, or bed #)..."
          className="w-full rounded-xl border-2 border-blue-200 bg-white py-2.5 pl-10 pr-24 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-xs focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-blue-900/60 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500"
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1.5">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <span className="hidden sm:inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {occupiedBeds.length} Patients
          </span>
        </div>
      </div>

      {/* Dropdown Results */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
          {query.trim() === '' ? (
            <div>
              <div className="flex items-center justify-between px-2 pb-2 text-xs font-semibold text-slate-500 border-b border-slate-100 dark:border-slate-800 dark:text-slate-400">
                <span>Active Inpatient Records Across All Wards</span>
                <span>Click MRN to inspect</span>
              </div>

              {occupiedBeds.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No patients currently admitted across hospital wards.
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5 p-1">
                  {occupiedBeds.map((bed) => (
                    <button
                      key={bed.id}
                      type="button"
                      onClick={() => {
                        setQuery(bed.patientMRN || bed.patientName || '');
                        handleSelect(bed);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-750"
                    >
                      <User className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                      <span className="font-bold">{bed.patientName}</span>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        ({bed.patientMRN})
                      </span>
                      <span className="rounded bg-slate-200 px-1 py-0.2 text-[9px] font-semibold dark:bg-slate-700">
                        {bed.bedNumber}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-6 text-center">
              <User className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                No active inpatient found for &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Try searching by exact MRN (e.g. GH-2026-...), patient surname, or assigned ward bed.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>{searchResults.length} Matching Patient Records Found</span>
              </div>

              {searchResults.map((bed) => {
                const acuityScore = bed.acuityScore ?? (bed.vitalAlert ? 7 : 2);
                const acuityLevel: NEWS2RiskLevel = (bed.acuityLevel as NEWS2RiskLevel) ?? (bed.vitalAlert ? 'High' : 'Low');
                const newsBadge = getNEWS2BadgeClasses(acuityScore, acuityLevel);

                return (
                  <div
                    key={bed.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 hover:border-blue-300 hover:bg-blue-50/30 dark:border-slate-800 dark:bg-slate-850 dark:hover:bg-slate-800 transition-all"
                  >
                    {/* Patient Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {bed.patientName}
                        </span>
                        <span className="rounded-md bg-blue-100 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                          {bed.patientMRN}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${newsBadge.bg}`}
                        >
                          <HeartPulse className="h-3 w-3" />
                          NEWS2: {acuityScore}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {bed.wardName} — Bed {bed.bedNumber} ({bed.roomNumber})
                        </span>
                        <span>•</span>
                        <span>{bed.patientAge || 52}y • {bed.patientGender || 'Male'}</span>
                        <span>•</span>
                        <span>Dr: {bed.assignedDoctor || 'Dr. Jenkins'}</span>
                        {bed.primaryDiagnosis && (
                          <>
                            <span>•</span>
                            <span className="text-slate-500 italic truncate max-w-xs">
                              {bed.primaryDiagnosis}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSelect(bed)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-2xs cursor-pointer"
                        title="Jump to Ward & Focus Bed"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        <span>Focus Bed</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen(false);
                          onQuickSanitize(bed);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 cursor-pointer"
                        title="Immediately transition to housekeeping cleaning"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        <span>Sanitize</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen(false);
                          onDischarge(bed);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 cursor-pointer"
                        title="Open Discharge Checklist Modal"
                      >
                        <LogOut className="h-3.5 w-3.5 text-rose-600" />
                        <span>Discharge</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
