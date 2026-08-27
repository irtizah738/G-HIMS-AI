'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  TrendingUp,
  DollarSign,
  Stethoscope,
  BedDouble,
  FlaskConical,
  Radio,
  Cpu,
  Server,
  Users,
  Building2,
  ShieldAlert,
  Scissors,
  Droplet,
  Video,
  FileCheck,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Activity,
  ShoppingCart,
  Boxes,
  Flame,
  BookOpen,
  ReceiptText,
  Landmark,
  CalendarDays,
  Award,
  Banknote,
  Tag,
  FileSpreadsheet,
  GitFork,
  HeartPulse,
} from 'lucide-react';
import Link from 'next/link';

interface ModuleItem {
  id: string;
  name: string;
  category: 'Clinical & Patient Care' | 'Surgery & Critical Care' | 'Diagnostics & Pharmacy' | 'Financial & Billing' | 'Strategy & Governance' | 'Interop & Infrastructure' | 'Supply Chain & CSSD' | 'Enterprise ERP & General Ledger' | 'Human Capital Management';
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  primaryMetric: string;
  primaryMetricLabel: string;
  isAiEnhanced?: boolean;
  directHref?: string;
}

import { useRouter } from 'next/navigation';

export function AllModulesDirectory() {
  const { setActiveTab, stats, mismatches, beds, staff, patients } = useHospital();
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const pendingLeakage = mismatches.filter((m) => m.status === 'pending_review').length;
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length;

  const modules: ModuleItem[] = [
    {
      id: 'disease-intake',
      name: 'Disease-Centric Intake & Specialist Preparation',
      category: 'Clinical & Patient Care',
      badge: 'Event-Driven AI Protocol',
      description: 'Symptom trees, protocolized guided questions, real-time hemodynamic risk signals, country guidelines & AI specialist briefings.',
      icon: HeartPulse,
      accentColor: 'text-rose-600 bg-rose-50 border-rose-200',
      primaryMetric: '5 Disease Protocols',
      primaryMetricLabel: 'AHA/ESC/NICE/ICMR',
      isAiEnhanced: true,
    },
    {
      id: 'workflow-runtime',
      name: 'Clinical Workflow Runtime & DAG Engine',
      category: 'Clinical & Patient Care',
      badge: 'DAG Orchestrator',
      description: 'Directed Acyclic Graph (DAG) for General OPD, Deterministic MPI Deduplication, Atomic Transactions & Outbox Orchestration.',
      icon: GitFork,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: '7 Stages',
      primaryMetricLabel: 'Active Graph DAG',
      isAiEnhanced: true,
    },
    {
      id: 'command',
      name: 'Executive Command Hub',
      category: 'Strategy & Governance',
      badge: 'Core Analytics',
      description: 'Hospital unit economics, $38,650 blended ACV model, $6.8T TAM market thesis & bed census analytics.',
      icon: TrendingUp,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: '$38,650',
      primaryMetricLabel: 'Blended ACV',
    },
    {
      id: 'billing',
      name: 'Revenue Leakage & Clinical Note Reconciliation',
      category: 'Financial & Billing',
      badge: 'Leakage Validator',
      description: 'Instant point-of-care audit detecting mismatches between physician SOAP notes and charge entries.',
      icon: DollarSign,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: `${pendingLeakage} Alerts`,
      primaryMetricLabel: 'Actionable Items',
      isAiEnhanced: true,
    },
    {
      id: 'claims',
      name: 'Insurance Claims & Pre-Authorization Scrubber',
      category: 'Financial & Billing',
      badge: 'EDI 837/835',
      description: 'Real-time EDI claim validation, NCCI edit checking, denial root-cause analysis & AI appeal generator.',
      icon: FileCheck,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: '97.4%',
      primaryMetricLabel: 'Clean Claim Rate',
      isAiEnhanced: true,
    },
    {
      id: 'opd',
      name: 'Outpatient (OPD) & Triage Consultation Suite',
      category: 'Clinical & Patient Care',
      badge: 'Live Queue',
      description: 'Digital SOAP notes, live token queue, quick vital sign capture, diagnostic ordering & ambient dictation.',
      icon: Stethoscope,
      accentColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      primaryMetric: '8 Tokens',
      primaryMetricLabel: 'Current Queue',
      isAiEnhanced: true,
    },
    {
      id: 'emergency',
      name: 'Emergency & Trauma Resuscitation Center',
      category: 'Surgery & Critical Care',
      badge: 'ESI 1-5 Triage',
      description: 'Emergency Severity Index triage board, rapid ambulance telemetry, STEMI / Stroke code alerts.',
      icon: ShieldAlert,
      accentColor: 'text-rose-600 bg-rose-50 border-rose-200',
      primaryMetric: '4 Resus',
      primaryMetricLabel: 'Critical Bays',
    },
    {
      id: 'beds',
      name: 'Inpatient Bed Census & Ward Management',
      category: 'Clinical & Patient Care',
      badge: 'Bed Matrix',
      description: 'Real-time ward telemetry across ICU, CCU, Surgical, Maternity, and Pediatric beds with nurse ratios.',
      icon: BedDouble,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: `${stats.occupancyRate}%`,
      primaryMetricLabel: 'Occupancy Rate',
    },
    {
      id: 'surgery',
      name: 'Operating Theater & Surgical Scheduling (OT / OR)',
      category: 'Surgery & Critical Care',
      badge: '4 Active Suites',
      description: 'Multi-room surgical scheduling, WHO Surgical Safety Checklists, and PACU Aldrete recovery scoring.',
      icon: Scissors,
      accentColor: 'text-purple-600 bg-purple-50 border-purple-200',
      primaryMetric: '4 Suites',
      primaryMetricLabel: 'OT Active',
    },
    {
      id: 'ancillary',
      name: 'Ancillary Diagnostics (LIS / RIS / Pharmacy)',
      category: 'Diagnostics & Pharmacy',
      badge: 'Core Labs',
      description: 'Laboratory analyzer results with reference flags, Radiology PACS viewer, and Pharmacy formulary.',
      icon: FlaskConical,
      accentColor: 'text-amber-600 bg-amber-50 border-amber-200',
      primaryMetric: '3 Units',
      primaryMetricLabel: 'Lab / Rad / Rx',
    },
    {
      id: 'bloodbank',
      name: 'Blood Bank & Transfusion Medicine',
      category: 'Diagnostics & Pharmacy',
      badge: 'ABO/Rh Reserve',
      description: 'ABO/Rh cold-chain inventory monitoring, compatibility testing ledger, and emergency O- release.',
      icon: Droplet,
      accentColor: 'text-rose-600 bg-rose-50 border-rose-200',
      primaryMetric: '116 Units',
      primaryMetricLabel: 'PRBC Reserve',
    },
    {
      id: 'telehealth',
      name: 'Telehealth & Remote Care Clinic',
      category: 'Clinical & Patient Care',
      badge: 'WebRTC Encrypted',
      description: 'Virtual video consultation room, ambient speech transcription stream, and digital e-Prescriptions.',
      icon: Video,
      accentColor: 'text-teal-600 bg-teal-50 border-teal-200',
      primaryMetric: 'AES-256',
      primaryMetricLabel: 'Encrypted Stream',
      isAiEnhanced: true,
    },
    {
      id: 'interop',
      name: 'HL7 v2 & FHIR R4 Interoperability Hub',
      category: 'Interop & Infrastructure',
      badge: 'ADT / ORM / ORU',
      description: 'Live socket event emitter, MSH parser for HL7 v2 and FHIR R4 JSON standard clinical bundles.',
      icon: Cpu,
      accentColor: 'text-cyan-600 bg-cyan-50 border-cyan-200',
      primaryMetric: '100% Pass',
      primaryMetricLabel: 'FHIR R4 Schema',
    },
    {
      id: 'sheets',
      name: 'Google Sheets & Drive Live Interop',
      category: 'Interop & Infrastructure',
      badge: 'Sheets API v4',
      description: 'Bidirectional clinical sync, 1-click patient/census/billing spreadsheet exports, and live Drive spreadsheet viewer.',
      icon: FileSpreadsheet,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: 'Live Sync',
      primaryMetricLabel: 'Drive & Sheets Hub',
      isAiEnhanced: true,
    },
    {
      id: 'audit',
      name: 'Dual-Engine Local Edge Sync & HIPAA Ledger',
      category: 'Interop & Infrastructure',
      badge: 'Vector Clocks',
      description: 'Deterministic vector clock offline synchronization, mutation queue & immutable audit trail.',
      icon: Server,
      accentColor: 'text-slate-600 bg-slate-100 border-slate-200',
      primaryMetric: '0 Lag',
      primaryMetricLabel: 'Edge Consensus',
    },
    {
      id: 'patients',
      name: 'Master Patient Index (MPI) & Longitudinal EHR',
      category: 'Clinical & Patient Care',
      badge: 'Longitudinal EHR',
      description: 'Demographic index, vital sign trends, medication history, clinical progress notes, and new admissions.',
      icon: Users,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: `${patients.length}`,
      primaryMetricLabel: 'Active Patients',
    },
    {
      id: 'staff',
      name: 'Clinical Staff Rosters & Caseload Management',
      category: 'Strategy & Governance',
      badge: 'Duty Shifts',
      description: 'Physician, nursing, surgical, and technician shift scheduling with active patient caseload monitoring.',
      icon: Building2,
      accentColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      primaryMetric: `${staff.length}`,
      primaryMetricLabel: 'Staff on Duty',
    },
    {
      id: 'scm-pos',
      name: 'Purchase Orders & GRN Receiving Workbench',
      category: 'Supply Chain & CSSD',
      badge: 'Vendor SCM',
      description: 'Vendor procurement, automated 3-way match, goods receipt notes (GRN), and digital invoice reconciliation.',
      icon: ShoppingCart,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: '3-Way Match',
      primaryMetricLabel: 'Procurement Cycle',
      directHref: '/metro-health/scm/purchase-orders',
    },
    {
      id: 'scm-par',
      name: 'PAR Level Management & Department Replenishment',
      category: 'Supply Chain & CSSD',
      badge: 'Min/Max Engine',
      description: 'Real-time department inventory monitoring, automated stock requisition triggers, and intra-hospital transfers.',
      icon: Boxes,
      accentColor: 'text-amber-600 bg-amber-50 border-amber-200',
      primaryMetric: 'PAR & Safety',
      primaryMetricLabel: 'Inventory Health',
      directHref: '/metro-health/scm/par-management',
    },
    {
      id: 'scm-cssd',
      name: 'CSSD & Autoclave Sterilization Engine',
      category: 'Supply Chain & CSSD',
      badge: 'AAMI / ISO 11138',
      description: 'Autoclave cycle tracking, biological indicator (BI) spore validation, and surgical tray dispatch to operating suites.',
      icon: Flame,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: 'BI Tested',
      primaryMetricLabel: 'Sterility Assurance',
      directHref: '/metro-health/scm/cssd',
    },
    {
      id: 'erp-coa',
      name: 'Chart of Accounts (COA) & General Ledger Structure',
      category: 'Enterprise ERP & General Ledger',
      badge: 'Double-Entry',
      description: 'Standard 5-tier hospital accounting chart with multi-branch rollup, debit/credit rules, and real-time trial balance.',
      icon: BookOpen,
      accentColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      primaryMetric: '5 Root Classes',
      primaryMetricLabel: 'COA Architecture',
      directHref: '/metro-health/erp/chart-of-accounts',
    },
    {
      id: 'erp-je',
      name: 'Journal Entries & Multi-Department GL Posting',
      category: 'Enterprise ERP & General Ledger',
      badge: 'Balanced GL',
      description: 'Real-time double-entry journal vouchers with source module tracking (Payroll, SCM, Billing, Fixed Assets).',
      icon: ReceiptText,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: 'Real-Time',
      primaryMetricLabel: 'Ledger Posting',
      directHref: '/metro-health/erp/journal-entries',
    },
    {
      id: 'erp-assets',
      name: 'Fixed Assets & Straight-Line Depreciation',
      category: 'Enterprise ERP & General Ledger',
      badge: 'Auto-Depreciation',
      description: 'Hospital capital asset lifecycle management, RFID asset tagging, monthly depreciation runs, and GL journal generation.',
      icon: Landmark,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: 'Straight-Line',
      primaryMetricLabel: 'Depreciation Engine',
      directHref: '/metro-health/erp/fixed-assets',
    },
    {
      id: 'hcm-roster',
      name: 'Clinical Staff Rostering & Shift Matrix Engine',
      category: 'Human Capital Management',
      badge: '11h Rest Rule',
      description: 'Departmental shift matrix enforcing mandatory 11-hour rest intervals, overtime thresholds, and license validation.',
      icon: CalendarDays,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: 'AAMI / ACGME',
      primaryMetricLabel: 'Fatigue Protection',
      directHref: '/metro-health/hcm/roster',
    },
    {
      id: 'hcm-credentials',
      name: 'Medical Licensing & Credentials Registry',
      category: 'Human Capital Management',
      badge: 'Roster Lock Guard',
      description: 'Automated monitoring of state medical licenses, DEA registrations, and board certifications with automated roster lockouts.',
      icon: Award,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: 'Automated Lock',
      primaryMetricLabel: 'Compliance Shield',
      directHref: '/metro-health/hcm/credentials',
    },
    {
      id: 'hcm-payroll',
      name: 'Healthcare Staff Payroll & Labor Cost Accruals',
      category: 'Human Capital Management',
      badge: 'GL Auto-Accrual',
      description: 'Shift-differential pay calculation, overtime multipliers, statutory withholdings, and automated double-entry GL accrual generation.',
      icon: Banknote,
      accentColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      primaryMetric: 'GL Integrated',
      primaryMetricLabel: 'Labor Accounting',
      directHref: '/metro-health/hcm/payroll',
    },
    {
      id: 'billing-tariffs',
      name: 'Multi-Tariff Administration & Fee Schedules',
      category: 'Financial & Billing',
      badge: 'Multi-Payer',
      description: 'Private insurer, corporate, cash, and government tariff management with custom discount rules, copay caps, and CPT/LOINC line overrides.',
      icon: Tag,
      accentColor: 'text-blue-600 bg-blue-50 border-blue-200',
      primaryMetric: '4 Tiers',
      primaryMetricLabel: 'Active Tariffs',
      directHref: '/metro-health/billing/tariffs',
    },
    {
      id: 'billing-invoices',
      name: 'Interactive Split Billing & POS Terminal',
      category: 'Financial & Billing',
      badge: 'Split Billing',
      description: 'Point-of-sale copay collection, payer coverage allocation, ad-hoc itemized charges, and patient settlement slip generation.',
      icon: FileSpreadsheet,
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      primaryMetric: 'Real-Time',
      primaryMetricLabel: 'Copay POS',
      directHref: '/metro-health/billing/invoices/inv-enc-8092-441',
    },
    {
      id: 'billing-claims-wb',
      name: 'Payer Claims Builder & Adjudication Workbench',
      category: 'Financial & Billing',
      badge: 'EDI 837 / 835',
      description: 'Automated ICD-10 to CPT cross-walking, clearinghouse batch transmission, and ERA 835 electronic remittance advice settlement.',
      icon: ShieldCheck,
      accentColor: 'text-purple-600 bg-purple-50 border-purple-200',
      primaryMetric: 'EDI 837',
      primaryMetricLabel: 'Batch Export',
      directHref: '/metro-health/billing/claims',
    },
  ];

  const categories = [
    'All',
    'Clinical & Patient Care',
    'Surgery & Critical Care',
    'Diagnostics & Pharmacy',
    'Supply Chain & CSSD',
    'Enterprise ERP & General Ledger',
    'Human Capital Management',
    'Financial & Billing',
    'Strategy & Governance',
    'Interop & Infrastructure',
  ];

  const filteredModules = modules.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.description.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.category.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesCategory = categoryFilter === 'All' || m.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-2xs">
              <Layers className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Hospital Enterprise Modules & Department Launchpad</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Access all 20 clinical, surgical, diagnostic, supply chain, general ledger ERP, HCM rostering, financial, and interoperability subsystems across G-HIMS OS
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search module or workflow..."
              className="text-xs pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-850 focus:ring-1 focus:ring-blue-500 outline-none w-56 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
              categoryFilter === cat
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Modules Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredModules.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.id}
              onClick={() => {
                if (m.directHref) {
                  router.push(m.directHref);
                } else {
                  setActiveTab(m.id);
                }
              }}
              className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600 transition-all cursor-pointer flex flex-col justify-between group space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${m.accentColor}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.isAiEnhanced && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-black bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/60 dark:to-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-amber-500" /> AI-Ready
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {m.badge}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 block tracking-wider">
                    {m.category}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mt-0.5">
                    {m.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {m.description}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-semibold">{m.primaryMetricLabel}</span>
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200">{m.primaryMetric}</span>
                </div>

                <div className="flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform">
                  Launch Module <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
