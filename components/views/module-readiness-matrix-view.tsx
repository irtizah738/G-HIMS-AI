'use client';

import React, { useState } from 'react';
import {
  LayoutGrid,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Layers,
  Sparkles,
  Server,
  Database,
  Lock,
  Cpu,
  FileText,
  Activity,
  Stethoscope,
  HeartPulse,
  DollarSign,
  Receipt,
  Users,
  BedDouble,
  FlaskConical,
  Pill,
  Scissors,
  Droplet,
  Video,
  ShieldAlert,
} from 'lucide-react';

export type ReadinessTier = 'PRODUCTION' | 'CONTROLLED_BETA' | 'SCAFFOLD';

export interface ModuleRegistryEntry {
  id: string;
  name: string;
  category: 'Clinical Core' | 'Diagnostics' | 'Inpatient & Emergency' | 'Administrative & ERP' | 'AI & Analytics';
  tier: ReadinessTier;
  completionPercent: number;
  owner: string;
  keyCapabilities: string[];
  blockersResolved: string[];
  activeBlockers: string[];
  securityStatus: 'HARDENED' | 'AUDIT_READY' | 'UNDER_REVIEW';
  testEvidence: string;
}

const MODULE_REGISTRY: ModuleRegistryEntry[] = [
  {
    id: 'mpi-ehr',
    name: 'Master Patient Index (MPI) & Identity Ingress',
    category: 'Clinical Core',
    tier: 'PRODUCTION',
    completionPercent: 96,
    owner: 'Platform Engineering & Medical Records',
    keyCapabilities: ['SHA256 match keys', 'Institutional MRN generator', 'Collision-free atomic intake', 'Multi-tenant isolation'],
    blockersResolved: ['Enforced request.auth and tenant isolation', 'Zod schema validation', 'Atomic multi-document transaction'],
    activeBlockers: [],
    securityStatus: 'HARDENED',
    testEvidence: 'Unit tests + multi-document Firestore transaction integrity verified',
  },
  {
    id: 'opd-runtime',
    name: 'General OPD Workflow Runtime Engine',
    category: 'Clinical Core',
    tier: 'PRODUCTION',
    completionPercent: 94,
    owner: 'Clinical Informatics Lead',
    keyCapabilities: ['11-stage OPD journey', 'Deterministic state transitions', 'NEWS2 scoring engine', 'Role-based stage gating'],
    blockersResolved: ['Stage transition resolver verified', 'Frozen workflow snapshot hydration'],
    activeBlockers: [],
    securityStatus: 'HARDENED',
    testEvidence: 'Deterministic stage resolver & NEWS2 scoring test pass',
  },
  {
    id: 'diagnostic-lock',
    name: 'Tactical Verification: Diagnostic Revenue Gate',
    category: 'Diagnostics',
    tier: 'PRODUCTION',
    completionPercent: 92,
    owner: 'Revenue Cycle & Diagnostics Team',
    keyCapabilities: ['Locked worklist gate', 'Payment / Pre-auth settlement trigger', 'HL7 ORU^R01 payload sync', 'Real-time unlocking'],
    blockersResolved: ['Worklist execution lock verified', 'Double-entry settlement voucher posting'],
    activeBlockers: [],
    securityStatus: 'HARDENED',
    testEvidence: 'Order locking and cashier settlement simulation verified',
  },
  {
    id: 'pharmacy-fefo',
    name: 'Pharmacy FEFO Stock & Medication Management',
    category: 'Diagnostics',
    tier: 'PRODUCTION',
    completionPercent: 90,
    owner: 'Chief Hospital Pharmacist',
    keyCapabilities: ['First-Expiring-First-Out batch sorting', 'Known drug allergy cross-checks', 'e-Prescription dispensing', 'Stock reconciliation'],
    blockersResolved: ['Batch allocation logic', 'Penicillin/Sulfa allergy safety screening'],
    activeBlockers: [],
    securityStatus: 'HARDENED',
    testEvidence: 'FEFO batch sorting and allergy conflict unit tests passing',
  },
  {
    id: 'double-entry-gl',
    name: 'Finance & Double-Entry Accounting Ledger',
    category: 'Administrative & ERP',
    tier: 'PRODUCTION',
    completionPercent: 95,
    owner: 'Hospital Finance & Comptroller',
    keyCapabilities: ['80/20 insurance co-pay split', 'Sum(Debits) === Sum(Credits) validation', 'Immutable journal vouchers', 'Revenue leakage detection'],
    blockersResolved: ['Zero-discrepancy mathematical check', 'Standard chart of accounts 1010-5010 mapping'],
    activeBlockers: [],
    securityStatus: 'HARDENED',
    testEvidence: 'Double-entry balance validator verified ($0.00 discrepancy)',
  },
  {
    id: 'ipd-bed-mgmt',
    name: 'Inpatient Department (IPD) & Bed Census',
    category: 'Inpatient & Emergency',
    tier: 'CONTROLLED_BETA',
    completionPercent: 88,
    owner: 'Nursing Directorate',
    keyCapabilities: ['Bed occupancy visual matrix', 'Ward transfers', 'Admission & discharge orders', 'Isolation room tagging'],
    blockersResolved: ['Bed state synchronization'],
    activeBlockers: ['EMR discharge summary linkage'],
    securityStatus: 'AUDIT_READY',
    testEvidence: 'Bed allocation and telemetry sync verified',
  },
  {
    id: 'emergency-ed',
    name: 'Emergency Department & Triage Bay',
    category: 'Inpatient & Emergency',
    tier: 'CONTROLLED_BETA',
    completionPercent: 86,
    owner: 'Emergency Medicine Dept Head',
    keyCapabilities: ['ESI 5-level triage', 'Trauma bay allocation', 'Rapid order execution', 'Stat blood bank orders'],
    blockersResolved: ['NEWS2 / ESI score auto-escalation'],
    activeBlockers: ['Ambulance pre-arrival telemetry intake'],
    securityStatus: 'AUDIT_READY',
    testEvidence: 'Trauma bay state flow verified',
  },
  {
    id: 'operating-room-or',
    name: 'Operating Room (OR) Theater & Conflict Engine',
    category: 'Inpatient & Emergency',
    tier: 'CONTROLLED_BETA',
    completionPercent: 89,
    owner: 'Surgical Directorate',
    keyCapabilities: ['Double-booking conflict detector', 'Surgical checklist (WHO)', 'Anesthesia records', 'Sterile supply CSSD'],
    blockersResolved: ['Surgeon & Anesthesiologist double-booking check', 'OR Room collision validation'],
    activeBlockers: ['Post-Op PACU transition automation'],
    securityStatus: 'HARDENED',
    testEvidence: 'Conflict checker unit tests passing',
  },
  {
    id: 'ai-copilot-genkit',
    name: 'GenAI Clinical Documentation & Coding Assistant',
    category: 'AI & Analytics',
    tier: 'CONTROLLED_BETA',
    completionPercent: 85,
    owner: 'AI Research & Clinical NLP Lead',
    keyCapabilities: ['SOAP note structuring', 'ICD-10 & CPT auto-coding', 'Clinical summarization', 'PHI-safe redaction middleware'],
    blockersResolved: ['PHI-safe logging', 'Structured JSON output schema validation'],
    activeBlockers: ['Specialty-specific ontology tuning'],
    securityStatus: 'AUDIT_READY',
    testEvidence: 'GenAI prompt output format and PHI redaction verified',
  },
  {
    id: 'telemedicine-portal',
    name: 'Telemedicine & Remote Consultation Hub',
    category: 'Clinical Core',
    tier: 'CONTROLLED_BETA',
    completionPercent: 82,
    owner: 'Digital Health Operations',
    keyCapabilities: ['Encrypted WebRTC consultations', 'Remote e-Prescription signing', 'Patient portal timeline sync'],
    blockersResolved: ['Session token authentication'],
    activeBlockers: ['Bandwidth fallback optimization'],
    securityStatus: 'AUDIT_READY',
    testEvidence: 'WebRTC signaling and token validation verified',
  },
];

export function ModuleReadinessMatrixView() {
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterTier, setFilterTier] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtered = MODULE_REGISTRY.filter((mod) => {
    if (filterCategory !== 'ALL' && mod.category !== filterCategory) return false;
    if (filterTier !== 'ALL' && mod.tier !== filterTier) return false;
    if (
      searchQuery &&
      !mod.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !mod.category.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !mod.owner.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const prodCount = MODULE_REGISTRY.filter((m) => m.tier === 'PRODUCTION').length;
  const betaCount = MODULE_REGISTRY.filter((m) => m.tier === 'CONTROLLED_BETA').length;
  const scaffoldCount = MODULE_REGISTRY.filter((m) => m.tier === 'SCAFFOLD').length;

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                G-HIMS OS Master Module Readiness & Production Audit Matrix
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Production-grade tracking across Clinical Core, Diagnostics, Ancillary, ERP, and AI Governance sub-systems.
              </p>
            </div>
          </div>
        </div>

        {/* Readiness Tier Badges */}
        <div className="flex items-center gap-3 shrink-0 text-xs font-bold">
          <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{prodCount} Production Ready</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>{betaCount} Controlled Beta</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search module, owner, or capability..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold"
          >
            <option value="ALL">All Categories</option>
            <option value="Clinical Core">Clinical Core</option>
            <option value="Diagnostics">Diagnostics</option>
            <option value="Inpatient & Emergency">Inpatient & Emergency</option>
            <option value="Administrative & ERP">Administrative & ERP</option>
            <option value="AI & Analytics">AI & Analytics</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold"
          >
            <option value="ALL">All Readiness Tiers</option>
            <option value="PRODUCTION">Production Only</option>
            <option value="CONTROLLED_BETA">Controlled Beta Only</option>
            <option value="SCAFFOLD">Scaffold Only</option>
          </select>
        </div>
      </div>

      {/* Module Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filtered.map((mod) => (
          <div
            key={mod.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    {mod.category}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">{mod.name}</h3>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${
                    mod.tier === 'PRODUCTION'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : mod.tier === 'CONTROLLED_BETA'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  }`}
                >
                  {mod.tier.replace('_', ' ')}
                </span>
              </div>

              {/* Progress bar */}
              <div className="my-3">
                <div className="flex justify-between items-center text-[11px] mb-1">
                  <span className="text-slate-500 font-semibold">Readiness Score</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{mod.completionPercent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      mod.completionPercent >= 90 ? 'bg-emerald-500' : mod.completionPercent >= 80 ? 'bg-blue-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${mod.completionPercent}%` }}
                  />
                </div>
              </div>

              {/* Key Capabilities */}
              <div className="space-y-1.5 mt-3">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Key Capabilities:</span>
                <div className="flex flex-wrap gap-1.5">
                  {mod.keyCapabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-400"
                    >
                      ✓ {cap}
                    </span>
                  ))}
                </div>
              </div>

              {/* Blockers Resolved */}
              {mod.blockersResolved.length > 0 && (
                <div className="space-y-1 mt-3">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                    Audit Blockers Closed:
                  </span>
                  <p className="text-[11px] text-slate-500">{mod.blockersResolved.join(' • ')}</p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Users className="w-3.5 h-3.5" />
                <span>{mod.owner}</span>
              </div>
              <div className="flex items-center gap-1 text-emerald-600 font-semibold font-mono text-[10px]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{mod.securityStatus}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
