'use client';

import React, { useState, useMemo } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useRouter } from 'next/navigation';
import { useRBAC } from '@/lib/auth/rbac-context';
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
  HeartPulse,
  Settings,
  Pill,
  Lock,
  Unlock,
  AlertCircle,
  Clock,
  LayoutGrid,
  Table,
  Check,
  Zap,
} from 'lucide-react';

export interface DomainModuleItem {
  domainNumber: number; // 1 to 52
  id: string;
  name: string;
  category:
    | 'Clinical & Patient Care'
    | 'Emergency & Critical Care'
    | 'Diagnostics & Laboratory'
    | 'Supply Chain & CSSD'
    | 'Universal ERP & General Ledger'
    | 'Human Capital Management'
    | 'Specialty Clinics'
    | 'Interop & Governance';
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  primaryMetric: string;
  primaryMetricLabel: string;
  isAiEnhanced?: boolean;
  targetTab?: string;
  directHref?: string;
  standards: string[];
  status: 'PRODUCTION' | 'ACTIVE' | 'INTEGRATED' | 'AUDIT_READY';
}

export function AllModulesDirectory() {
  const { setActiveTab, stats, mismatches, beds, staff, patients } = useHospital();
  const { currentRole, canAccessModule, roleDefinition } = useRBAC();
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const pendingLeakage = mismatches.filter((m) => m.status === 'pending_review').length;
  const occupiedBeds = beds.filter((b) => b.status === 'occupied').length;

  // Comprehensive, Canonical 52 Domains of G-HIMS Operating System
  const all52Domains: DomainModuleItem[] = useMemo(
    () => [
      // -------------------------------------------------------------
      // PILLAR 1: Clinical & Patient Care (Domains 1 - 8)
      // -------------------------------------------------------------
      {
        domainNumber: 1,
        id: 'mpi-patients',
        name: 'Master Patient Index (MPI) & Longitudinal EHR',
        category: 'Clinical & Patient Care',
        badge: 'Longitudinal EHR',
        description:
          'Demographic index, deterministic SHA-256 deduplication, vital sign trends, clinical notes & admissions.',
        icon: Users,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: `${patients.length || 4820} Patients`,
        primaryMetricLabel: 'Active Identity Graph',
        targetTab: 'patients',
        standards: ['FHIR R4 Patient', 'HIPAA §164.312', 'SHA-256 Keying'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 2,
        id: 'opd-consultations',
        name: 'Outpatient (OPD) & Clinical Consultation Suite',
        category: 'Clinical & Patient Care',
        badge: 'Live Token Queue',
        description:
          'Digital SOAP notes, live token queue, quick vital sign capture, diagnostic ordering & ambient dictation.',
        icon: Stethoscope,
        accentColor: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800',
        primaryMetric: '8 Tokens',
        primaryMetricLabel: 'Active Consultation Queue',
        isAiEnhanced: true,
        targetTab: 'opd',
        standards: ['SNOMED-CT', 'ICD-10-CM', 'Ambient Speech'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 3,
        id: 'disease-intake',
        name: 'Disease-Centric Guided Protocols & Specialist Intake',
        category: 'Clinical & Patient Care',
        badge: 'Clinical Protocol Engine',
        description:
          'Symptom trees, protocolized guided questions, real-time hemodynamic risk signals & specialist briefings.',
        icon: HeartPulse,
        accentColor: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800',
        primaryMetric: '5 Clinical Trees',
        primaryMetricLabel: 'AHA / ESC / NICE / ICMR',
        isAiEnhanced: true,
        targetTab: 'disease-intake',
        standards: ['AHA/ACC', 'ESC Guidelines', 'NICE CG50'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 5,
        id: 'nursing-emar',
        name: 'Inpatient Nursing Care Plans & eMAR Administration',
        category: 'Clinical & Patient Care',
        badge: '5-Rights Medication',
        description:
          'Nurse shift handoffs, bedside vitals capture, eMAR 5-Rights medication administration & pain re-evaluations.',
        icon: BedDouble,
        accentColor: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800',
        primaryMetric: '100% eMAR Match',
        primaryMetricLabel: '5-Rights Verification',
        targetTab: 'beds',
        standards: ['5-Rights Verification', 'ANA Guidelines'],
        status: 'ACTIVE',
      },
      {
        domainNumber: 6,
        id: 'telehealth-virtual',
        name: 'Telehealth, Remote Monitoring & Virtual Clinic',
        category: 'Clinical & Patient Care',
        badge: 'WebRTC Encrypted',
        description:
          'Virtual video consultation room, ambient speech transcription stream, remote patient vitals & e-Prescriptions.',
        icon: Video,
        accentColor: 'text-teal-600 bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800',
        primaryMetric: 'AES-256',
        primaryMetricLabel: 'Encrypted Stream',
        isAiEnhanced: true,
        targetTab: 'telehealth',
        standards: ['WebRTC', 'HL7 FHIR PHR', 'AES-256 E2EE'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 7,
        id: 'clinical-cds',
        name: 'Clinical Decision Support & NEWS2 Risk Stratifier',
        category: 'Clinical & Patient Care',
        badge: 'Real-Time Early Warning',
        description:
          'Real-time NEWS2 sepsis early warning calculations, drug-drug interaction screening & QTc interval alerts.',
        icon: Activity,
        accentColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800',
        primaryMetric: 'NEWS2 Active',
        primaryMetricLabel: 'Continuous Hemodynamic CDS',
        isAiEnhanced: true,
        targetTab: 'consultant-command',
        standards: ['NEWS2 Score', 'CDS Hooks', 'NICE Guidelines'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 8,
        id: 'patient-portal',
        name: 'Patient Self-Service Portal & FHIR PHR Access',
        category: 'Clinical & Patient Care',
        badge: 'Patient Portal',
        description:
          'Patient personal health record access, diagnostic report downloads, telehealth access & online copay settlement.',
        icon: Users,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: 'HIPAA 256-Bit',
        primaryMetricLabel: 'Secure Patient Gate',
        targetTab: 'patient-portal',
        standards: ['ONC 21st Century Cures Act', 'FHIR R4 Patient'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 2: Emergency & Critical Care (Domains 9 - 15)
      // -------------------------------------------------------------
      {
        domainNumber: 9,
        id: 'emergency-triage',
        name: 'Emergency & Trauma Resuscitation Center (ER)',
        category: 'Emergency & Critical Care',
        badge: 'ESI 1-5 Triage',
        description:
          'Emergency Severity Index triage board, rapid ambulance telemetry, STEMI / Stroke code alerts & critical bays.',
        icon: ShieldAlert,
        accentColor: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800',
        primaryMetric: '4 Resus Bays',
        primaryMetricLabel: 'Level 1 Trauma Ready',
        targetTab: 'emergency',
        standards: ['ESI Triage v4', 'AHA Code STEMI', 'ATLS Protocol'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 10,
        id: 'pre-hospital-ems',
        name: 'Pre-Hospital Radio & Ambulance Telemetry Dispatch',
        category: 'Emergency & Critical Care',
        badge: 'Closed-Loop Radio',
        description:
          'Closed-loop verbal medical order confirmation, Lead II ECG telemetry transmission & ambulance ETA tracking.',
        icon: Radio,
        accentColor: 'text-orange-600 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800',
        primaryMetric: 'Live Dispatch',
        primaryMetricLabel: 'Radio Intercom & Lead II',
        targetTab: 'emergency',
        standards: ['NEMSIS v3.5', 'FCC Part 90 Public Safety'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 11,
        id: 'inpatient-census',
        name: 'Inpatient Bed Census & Ward Management',
        category: 'Emergency & Critical Care',
        badge: 'Bed Matrix',
        description:
          'Real-time ward telemetry across ICU, CCU, Surgical, Maternity, and Pediatric beds with nurse staffing ratios.',
        icon: BedDouble,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: `${stats.occupancyRate}% Occupancy`,
        primaryMetricLabel: `${occupiedBeds} / 120 Beds Filled`,
        targetTab: 'beds',
        directHref: '/metro-health/inpatient/bed-board',
        standards: ['AHRQ Hospital Survey', 'Joint Commission EMR'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 12,
        id: 'surgery-theater',
        name: 'Operating Theater & Surgical Suite Scheduling (OT/OR)',
        category: 'Emergency & Critical Care',
        badge: '4 Active Suites',
        description:
          'Multi-room surgical scheduling, credential-gated surgeon assignments, WHO Surgical Safety Checklists.',
        icon: Scissors,
        accentColor: 'text-purple-600 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800',
        primaryMetric: '4 Suites Active',
        primaryMetricLabel: 'OR Schedule Matrix',
        targetTab: 'surgery',
        directHref: '/metro-health/or/schedule',
        standards: ['WHO Surgical Safety', 'AORN Perioperative'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 13,
        id: 'anesthesia-pacu',
        name: 'Anesthesia Station & PACU Aldrete Recovery Scoring',
        category: 'Emergency & Critical Care',
        badge: 'Aldrete Scoring',
        description:
          'Pre-operative anesthetic assessment, volatile gas logs, and Post-Anesthesia Care Unit (PACU) Aldrete scoring.',
        icon: Activity,
        accentColor: 'text-violet-600 bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800',
        primaryMetric: 'Aldrete ≥ 9',
        primaryMetricLabel: 'Discharge Readiness Score',
        targetTab: 'surgery',
        standards: ['ASA Physical Status', 'Modified Aldrete PACU'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 14,
        id: 'icu-critical-care',
        name: 'Intensive Care (ICU/CCU/NICU) Hemodynamic Monitoring',
        category: 'Emergency & Critical Care',
        badge: 'Critical Care ICU',
        description:
          'Continuous arterial line telemetry, mechanical ventilator parameters & central-line bundle checklists.',
        icon: HeartPulse,
        accentColor: 'text-red-600 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800',
        primaryMetric: '12 ICU Bays',
        primaryMetricLabel: 'Ventilator & Art-Line Telemetry',
        targetTab: 'beds',
        standards: ['CLABSI / CAUTI Bundle', 'Surviving Sepsis'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 15,
        id: 'infection-control',
        name: 'Infection Prevention, Antimicrobial Stewardship & Isolation',
        category: 'Emergency & Critical Care',
        badge: 'Infection Shield',
        description:
          'Airborne/droplet isolation tracking, negative-pressure room monitoring, and antimicrobial stewardship tracking.',
        icon: ShieldCheck,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Zero Outbreak',
        primaryMetricLabel: 'Negative-Pressure Verified',
        targetTab: 'beds',
        standards: ['CDC NHSN Protocol', 'WHO Infection Control'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 3: Diagnostics & Laboratory (Domains 16 - 22)
      // -------------------------------------------------------------
      {
        domainNumber: 16,
        id: 'lis-laboratory',
        name: 'Laboratory Information System (LIS) & Specimen Barcoding',
        category: 'Diagnostics & Laboratory',
        badge: 'CLIA / CAP Ready',
        description:
          'Analyzer bidirectional interfaces, tube barcode tracking, critical panic-value alerts & clinical pathology.',
        icon: FlaskConical,
        accentColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800',
        primaryMetric: '440 Tests / Day',
        primaryMetricLabel: 'Specimen Barcode Tracking',
        targetTab: 'ancillary',
        standards: ['CLIA 88', 'CAP Accredited', 'HL7 ORU^R01'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 17,
        id: 'diagnostic-revenue-gate',
        name: 'Tactical Diagnostic Worklist & Revenue Verification Gate',
        category: 'Diagnostics & Laboratory',
        badge: 'Revenue Lock Guard',
        description:
          'Point-of-service payment verification gate preventing unbilled lab and radiology sample processing.',
        icon: DollarSign,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Zero Leakage',
        primaryMetricLabel: 'Pre-Pay Diagnostic Lockout',
        targetTab: 'ancillary',
        standards: ['Double-Entry Lock', 'Pre-Auth Gate'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 18,
        id: 'ris-pacs',
        name: 'Radiology Information System (RIS) & PACS DICOM Hub',
        category: 'Diagnostics & Laboratory',
        badge: 'DICOM 3.0 / WADO-RS',
        description:
          'Modality worklists, DICOM image web viewer, radiologist structured reporting & emergency STAT reads.',
        icon: Cpu,
        accentColor: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800',
        primaryMetric: 'DICOM Viewer',
        primaryMetricLabel: 'CT, MRI & X-Ray Web PACS',
        targetTab: 'ancillary',
        standards: ['DICOM 3.0', 'HL7 ORM', 'IHE Scheduled Workflow'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 19,
        id: 'blood-bank',
        name: 'Blood Bank & Transfusion Medicine Ledger',
        category: 'Diagnostics & Laboratory',
        badge: 'ABO/Rh Reserve',
        description:
          'ABO/Rh cold-chain inventory monitoring, compatibility cross-matching ledger & emergency O- release protocol.',
        icon: Droplet,
        accentColor: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800',
        primaryMetric: '116 Units',
        primaryMetricLabel: 'PRBC Reserve Ledger',
        targetTab: 'bloodbank',
        standards: ['AABB Standards', 'FDA 21 CFR 606', 'ISBT 128'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 20,
        id: 'anatomic-pathology',
        name: 'Anatomic Pathology, Biopsy & Frozen Section Tracking',
        category: 'Diagnostics & Laboratory',
        badge: 'Histopathology',
        description:
          'Surgical grossing logs, histological tissue cassette tracking, intra-operative frozen section tele-consultation.',
        icon: FlaskConical,
        accentColor: 'text-purple-600 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800',
        primaryMetric: 'STAT Frozen Loop',
        primaryMetricLabel: 'Intra-Op Tissue Diagnosis',
        targetTab: 'ancillary',
        standards: ['CAP Histology Guidelines', 'TNM Staging 8th Ed'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 21,
        id: 'poct-testing',
        name: 'Point-of-Care Testing (POCT) & Bedside Device Sync',
        category: 'Diagnostics & Laboratory',
        badge: 'POCT1-A2 Protocol',
        description:
          'Bedside glucometers, blood gas analyzers (ABG) & cardiac troponin POCT devices synced to patient charts.',
        icon: Activity,
        accentColor: 'text-teal-600 bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800',
        primaryMetric: 'Instant Sync',
        primaryMetricLabel: 'Docking Station Telemetry',
        targetTab: 'ancillary',
        standards: ['CLSI POCT1-A2', 'FDA Waived Testing'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 22,
        id: 'pharmacy-dispensing',
        name: 'Hospital Pharmacy Formulary & Dispensing Engine',
        category: 'Diagnostics & Laboratory',
        badge: 'FEFO / e-Prescriptions',
        description:
          'Inpatient unit-dose dispensing, computerized order entry (CPOE), drug allergy screening & FEFO batch control.',
        icon: Pill,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'FEFO Enforced',
        primaryMetricLabel: 'Automated Drug Allergy Screening',
        targetTab: 'ancillary',
        standards: ['USP 797 / 800', 'FDA NDC Formulary'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 4: Supply Chain & CSSD (Domains 23 - 29)
      // -------------------------------------------------------------
      {
        domainNumber: 23,
        id: 'scm-procurement',
        name: 'Supply Chain, Procurement & Inventory OS',
        category: 'Supply Chain & CSSD',
        badge: 'FEFO / UDI / GRN',
        description:
          'Hospital-wide inventory control, FEFO expiry tracking, cold-chain excursions, 3-way match & purchase orders.',
        icon: ShoppingCart,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: 'FEFO & UDI',
        primaryMetricLabel: 'Traceability & Ledger',
        isAiEnhanced: true,
        targetTab: 'scm-pos',
        standards: ['GS1 Healthcare', 'EDI 850 / 810', '3-Way Match'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 24,
        id: 'scm-par-replenish',
        name: 'PAR Level Management & Department Replenishment',
        category: 'Supply Chain & CSSD',
        badge: 'Min/Max Engine',
        description:
          'Real-time department inventory monitoring, automated stock requisition triggers & intra-hospital transfers.',
        icon: Boxes,
        accentColor: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800',
        primaryMetric: 'PAR & Safety',
        primaryMetricLabel: 'Inventory Health Index',
        targetTab: 'scm-pos',
        directHref: '/metro-health/scm/par-management',
        standards: ['Lean Hospital Logistics', 'Automated Reorder'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 25,
        id: 'scm-cssd-sterilization',
        name: 'CSSD & Autoclave Sterilization Engine',
        category: 'Supply Chain & CSSD',
        badge: 'AAMI / ISO 11138',
        description:
          'Autoclave cycle tracking, biological indicator (BI) spore validation & surgical tray dispatch to operating suites.',
        icon: Flame,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'BI Tested',
        primaryMetricLabel: 'Sterility Assurance Level 10^-6',
        targetTab: 'scm-pos',
        directHref: '/metro-health/scm/cssd',
        standards: ['AAMI ST79', 'ISO 11138 Sterilization'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 26,
        id: 'biomedical-engineering',
        name: 'Biomedical Equipment Lifecycle & Calibration Lockout',
        category: 'Supply Chain & CSSD',
        badge: 'Calibration Lock Guard',
        description:
          'Equipment maintenance tracking, electrical safety tests & automated procedure lockouts for uncalibrated gear.',
        icon: Settings,
        accentColor: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800',
        primaryMetric: '100% Calibrated',
        primaryMetricLabel: 'Preventative Maintenance Certified',
        targetTab: 'resources',
        directHref: '/metro-health/hcm/resources',
        standards: ['NFPA 99', 'FDA 21 CFR 820 Quality System'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 27,
        id: 'implant-traceability',
        name: 'Surgical Implant Traceability & UDI Recall Graph',
        category: 'Supply Chain & CSSD',
        badge: 'FDA UDI System',
        description:
          'End-to-end implant tracking (cardiac pacemakers, orthopedic joints, surgical mesh) from vendor to patient MRN.',
        icon: CheckCircle2,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: '100% UDI Traced',
        primaryMetricLabel: 'Zero Recall Defect',
        targetTab: 'scm-pos',
        standards: ['FDA Unique Device ID (UDI)', 'GS1-128'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 28,
        id: 'cold-chain-logistics',
        name: 'Vaccine & Biologics Cold-Chain Excursion Engine',
        category: 'Supply Chain & CSSD',
        badge: '2°C to 8°C IoT Ledger',
        description:
          'Continuous temperature data logger telemetry, automated cold-chain breach alarms & quarantined biologics.',
        icon: Droplet,
        accentColor: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800',
        primaryMetric: '2°C - 8°C Safe',
        primaryMetricLabel: 'Automated IoT Sensor Telemetry',
        targetTab: 'bloodbank',
        standards: ['CDC Vaccine Storage Guidelines', 'WHO PQS'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 29,
        id: 'hazardous-waste',
        name: 'Biomedical Waste, Cytotoxic Spill & Radiation Safety',
        category: 'Supply Chain & CSSD',
        badge: 'OSHA / EPA Compliant',
        description:
          'Sharps waste management, cytotoxic chemotherapy spill kits & nuclear medicine radiopharmaceutical containment.',
        icon: AlertCircle,
        accentColor: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800',
        primaryMetric: 'EPA Certified',
        primaryMetricLabel: 'Biohazard Manifest Tracking',
        targetTab: 'resources',
        standards: ['OSHA 1910.1030 Bloodborne Pathogens'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 5: Universal ERP & General Ledger (Domains 30 - 36)
      // -------------------------------------------------------------
      {
        domainNumber: 30,
        id: 'erp-coa',
        name: 'Universal Chart of Accounts (COA) & GL Structure',
        category: 'Universal ERP & General Ledger',
        badge: 'SAP-Style COA',
        description:
          'Standard 5-tier hospital accounting chart with multi-branch rollup, debit/credit rules & trial balance.',
        icon: BookOpen,
        accentColor: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800',
        primaryMetric: '5 Root Classes',
        primaryMetricLabel: '1000-5000 COA Architecture',
        targetTab: 'billing',
        directHref: '/metro-health/erp/chart-of-accounts',
        standards: ['GAAP / IFRS', 'SAP FI/CO Alignment'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 31,
        id: 'erp-double-entry',
        name: 'Double-Entry General Ledger & Real-Time Journal Vouchers',
        category: 'Universal ERP & General Ledger',
        badge: 'Balanced GL',
        description:
          'Real-time double-entry journal vouchers with source module tracking (Payroll, SCM, Billing, Fixed Assets).',
        icon: ReceiptText,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: 'ΣDebits == ΣCredits',
        primaryMetricLabel: 'Zero Discrepancy Invariance',
        targetTab: 'billing',
        directHref: '/metro-health/erp/journal-entries',
        standards: ['Double-Entry Invariance', 'Audit Trail Immutable'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 32,
        id: 'revenue-leakage',
        name: 'Revenue Leakage & Clinical Note Reconciliation',
        category: 'Universal ERP & General Ledger',
        badge: 'Leakage Validator',
        description:
          'Instant point-of-care audit detecting mismatches between physician SOAP notes and billed charge entries.',
        icon: DollarSign,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: `${pendingLeakage} Alerts`,
        primaryMetricLabel: 'Actionable Audit Items',
        isAiEnhanced: true,
        targetTab: 'billing',
        standards: ['ICD-10 to CPT Crosswalk', 'OIG Compliance'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 33,
        id: 'claims-scrubber',
        name: 'Insurance Claims & Pre-Authorization Scrubber (EDI 837)',
        category: 'Universal ERP & General Ledger',
        badge: 'EDI 837/835',
        description:
          'Real-time EDI claim validation, NCCI edit checking, denial root-cause analysis & AI appeal generator.',
        icon: FileCheck,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: '97.4%',
        primaryMetricLabel: 'Clean Claim Rate',
        isAiEnhanced: true,
        targetTab: 'claims',
        directHref: '/metro-health/billing/claims',
        standards: ['ASC X12 EDI 837/835', 'CMS-1500 / UB-04'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 34,
        id: 'multi-tariff-pricing',
        name: 'Multi-Tariff Administration & Fee Schedules',
        category: 'Universal ERP & General Ledger',
        badge: 'Multi-Payer',
        description:
          'Private insurer, corporate, cash, and government tariff management with custom discount rules and copay caps.',
        icon: Tag,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: '4 Tiers',
        primaryMetricLabel: 'Active Tariff Schedules',
        targetTab: 'billing',
        directHref: '/metro-health/billing/tariffs',
        standards: ['CMS RVU Base', 'Contract Pricing Engine'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 35,
        id: 'split-billing-pos',
        name: 'Interactive Split Billing & POS Cashier Terminal',
        category: 'Universal ERP & General Ledger',
        badge: 'Split Billing POS',
        description:
          'Point-of-sale copay collection, 80/20 payer coverage allocation, patient settlements & receipt slips.',
        icon: FileSpreadsheet,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Real-Time',
        primaryMetricLabel: 'Copay Settlement Slip',
        targetTab: 'billing',
        directHref: '/metro-health/billing/invoices/inv-enc-8092-441',
        standards: ['PCI-DSS Level 1', 'Itemized Patient Slip'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 36,
        id: 'fixed-assets-depr',
        name: 'Fixed Assets & Straight-Line Depreciation Engine',
        category: 'Universal ERP & General Ledger',
        badge: 'Auto-Depreciation',
        description:
          'Hospital capital asset lifecycle management, RFID asset tagging, monthly depreciation runs & GL postings.',
        icon: Landmark,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Straight-Line',
        primaryMetricLabel: 'Automated Monthly Posting',
        targetTab: 'billing',
        directHref: '/metro-health/erp/fixed-assets',
        standards: ['IAS 16 Property & Equipment', 'MACRS Tables'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 6: Human Capital Management & Workforce (Domains 37 - 42)
      // -------------------------------------------------------------
      {
        domainNumber: 37,
        id: 'hcm-workforce',
        name: 'Hospital Workforce & HR Operating System',
        category: 'Human Capital Management',
        badge: 'Core HR Directory',
        description:
          'Full-scale healthcare employee directory, department organizational hierarchy & credential-gated privileges.',
        icon: Building2,
        accentColor: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800',
        primaryMetric: `${staff.length || 420} Staff`,
        primaryMetricLabel: 'Active Healthcare Staff',
        targetTab: 'hcm',
        directHref: '/metro-health/hcm',
        standards: ['EEOC Guidelines', 'Joint Commission HR Standards'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 38,
        id: 'clinical-credentialing',
        name: 'Medical Licensing & Credentials Registry',
        category: 'Human Capital Management',
        badge: 'Roster Lock Guard',
        description:
          'Automated monitoring of state medical licenses, DEA registrations, and board certifications with automated lockouts.',
        icon: Award,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Automated Lock',
        primaryMetricLabel: 'Credential Expiry Protection',
        targetTab: 'hcm',
        directHref: '/metro-health/hcm/credentials',
        standards: ['NPDB Querying', 'State Medical Board Sync'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 39,
        id: 'clinical-privileges',
        name: 'Clinical Privileges & Procedure Authorization Gate',
        category: 'Human Capital Management',
        badge: 'Medical Director Privileges',
        description:
          'Gated approval workflows for surgical privileges, intubation, high-risk interventions & credential verification.',
        icon: ShieldCheck,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: '100% Gated',
        primaryMetricLabel: 'Verified Scope of Practice',
        targetTab: 'staff',
        standards: ['Medical Staff Bylaws', 'Joint Commission MS.06'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 40,
        id: 'roster-shifts',
        name: 'Clinical Staff Rostering & Shift Matrix Engine',
        category: 'Human Capital Management',
        badge: '11h Rest Rule',
        description:
          'Departmental shift matrix enforcing mandatory 11-hour rest intervals, overtime thresholds & license validation.',
        icon: CalendarDays,
        accentColor: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800',
        primaryMetric: '11h Mandate',
        primaryMetricLabel: 'Fatigue Protection Engine',
        targetTab: 'hcm',
        directHref: '/metro-health/hcm/roster',
        standards: ['ACGME Resident Duty Hours', 'European Working Time'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 41,
        id: 'attendance-time',
        name: 'Biometric Attendance & Time Tracking Ledger',
        category: 'Human Capital Management',
        badge: 'Biometric Sync',
        description:
          'Electronic clock-in/out, biometric shift logging & immutable supervisor time correction audit trails.',
        icon: Clock,
        accentColor: 'text-slate-700 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700',
        primaryMetric: 'Immutable',
        primaryMetricLabel: 'Supervisory Time Audit Ledger',
        targetTab: 'staff',
        standards: ['FLSA Healthcare Provisions', 'Biometric Security'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 42,
        id: 'payroll-labor',
        name: 'Healthcare Staff Payroll & Labor Cost Accruals',
        category: 'Human Capital Management',
        badge: 'GL Auto-Accrual',
        description:
          'Shift-differential pay calculation, overtime multipliers, statutory withholdings & automated GL journal accruals.',
        icon: Banknote,
        accentColor: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800',
        primaryMetric: 'GL Integrated',
        primaryMetricLabel: 'Labor Accounting & Accruals',
        targetTab: 'hcm',
        directHref: '/metro-health/hcm/payroll',
        standards: ['IRS Section 125', 'Statutory Tax Withholding'],
        status: 'PRODUCTION',
      },

      // -------------------------------------------------------------
      // PILLAR 7: Specialty Clinics & Centers of Excellence (Domains 43 - 47)
      // -------------------------------------------------------------
      {
        domainNumber: 43,
        id: 'dialysis-nephrology',
        name: 'Renal Care, Hemodialysis & Dialyzer Reprocessing',
        category: 'Specialty Clinics',
        badge: 'Dialysis Station',
        description:
          'Hemodialysis run monitoring, dry weight calculations, dialyzer reprocessing & vascular access surveillance.',
        icon: Droplet,
        accentColor: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800',
        primaryMetric: 'KDOQI Compliant',
        primaryMetricLabel: 'Vascular Access & Dialysis Run',
        targetTab: 'opd',
        standards: ['KDOQI Guidelines', 'CMS ESRD Conditions'],
        status: 'ACTIVE',
      },
      {
        domainNumber: 44,
        id: 'cath-lab-cardiology',
        name: 'Cardiac Catheterization Lab & Interventional Registry',
        category: 'Specialty Clinics',
        badge: 'Cath Lab',
        description:
          'Fluoroscopy radiation logging, balloon angioplasty stent documentation & door-to-balloon emergency metrics.',
        icon: HeartPulse,
        accentColor: 'text-red-600 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800',
        primaryMetric: '< 60 Min',
        primaryMetricLabel: 'Door-to-Balloon STEMI Standard',
        targetTab: 'surgery',
        standards: ['ACC NCDR CathPCI Registry', 'AHA STEMI Protocol'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 45,
        id: 'maternity-labor-delivery',
        name: 'Labor, Delivery & Obstetric Partogram Tracker',
        category: 'Specialty Clinics',
        badge: 'WHO Partogram',
        description:
          'Digital WHO partogram, fetal heart rate monitoring, APGAR newborn scoring & infant security RFID tracking.',
        icon: HeartPulse,
        accentColor: 'text-pink-600 bg-pink-50 dark:bg-pink-950/50 border-pink-200 dark:border-pink-800',
        primaryMetric: 'WHO Partogram',
        primaryMetricLabel: 'Cervical Dilation & Fetal Heart',
        targetTab: 'beds',
        standards: ['WHO Labor Care Guide', 'ACOG Guidelines'],
        status: 'ACTIVE',
      },
      {
        domainNumber: 46,
        id: 'oncology-tumor-board',
        name: 'Multidisciplinary Tumor Board & Chemotherapy Regimens',
        category: 'Specialty Clinics',
        badge: 'TNM Staging',
        description:
          'Multidisciplinary oncology reviews, TNM cancer staging, BSA-based chemotherapy dose calculations & toxicity checks.',
        icon: Activity,
        accentColor: 'text-purple-600 bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800',
        primaryMetric: 'NCCN Compliant',
        primaryMetricLabel: 'BSA Chemotherapy Calculator',
        targetTab: 'opd',
        standards: ['NCCN Clinical Guidelines', 'ASCO Oncology'],
        status: 'ACTIVE',
      },
      {
        domainNumber: 47,
        id: 'rehab-physical-therapy',
        name: 'Physical Therapy, Occupational Rehab & Functional Scoring',
        category: 'Specialty Clinics',
        badge: 'FIM Mobility Score',
        description:
          'Range of motion documentation, functional independence measure (FIM) scoring & personalized outpatient rehab programs.',
        icon: Stethoscope,
        accentColor: 'text-teal-600 bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800',
        primaryMetric: 'FIM Certified',
        primaryMetricLabel: 'Functional Independence Tracker',
        targetTab: 'opd',
        standards: ['FIM Instrument', 'Barthel ADL Index'],
        status: 'ACTIVE',
      },

      // -------------------------------------------------------------
      // PILLAR 8: Interop & Governance (Domains 48 - 52)
      // -------------------------------------------------------------
      {
        domainNumber: 48,
        id: 'hl7-fhir-interop',
        name: 'HL7 v2 & FHIR R4 Clinical Interoperability Hub',
        category: 'Interop & Governance',
        badge: 'ADT / ORM / ORU',
        description:
          'Live socket event emitter, MSH parser for HL7 v2 and FHIR R4 JSON standard clinical resource bundles.',
        icon: Cpu,
        accentColor: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800',
        primaryMetric: '100% Pass',
        primaryMetricLabel: 'FHIR R4 Schema Validator',
        targetTab: 'interop',
        standards: ['HL7 v2.5.1', 'FHIR R4 US-Core', 'SMART on FHIR'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 49,
        id: 'google-workspace-sync',
        name: 'Google Sheets & Drive Live Interoperability Hub',
        category: 'Interop & Governance',
        badge: 'Sheets API v4',
        description:
          'Bidirectional clinical sync, 1-click patient/census/billing exports & live Drive spreadsheet viewer.',
        icon: FileSpreadsheet,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Live Sync',
        primaryMetricLabel: 'Drive & Sheets Interop Hub',
        isAiEnhanced: true,
        targetTab: 'sheets',
        standards: ['Google Workspace API v4', 'OAuth 2.0 PKCE'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 50,
        id: 'dual-edge-sync',
        name: 'Dual-Engine Local Edge Vector Clock & Offline Sync',
        category: 'Interop & Governance',
        badge: 'Vector Clocks',
        description:
          'Deterministic vector clock offline synchronization, mutation queue & immutable transaction ledger.',
        icon: Server,
        accentColor: 'text-slate-600 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        primaryMetric: '0 Lag',
        primaryMetricLabel: 'Edge Consensus Engine',
        targetTab: 'audit',
        standards: ['Vector Clocks CRDT', 'IndexedDB Level 3'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 51,
        id: 'hipaa-audit-ledger',
        name: 'Immutable Cryptographic Audit Trail & HIPAA Ledger',
        category: 'Interop & Governance',
        badge: 'Chained SHA-256',
        description:
          'SHA-256 chained transaction audit log tracking all clinical chart views, medication orders & billing edits.',
        icon: ShieldCheck,
        accentColor: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
        primaryMetric: 'Chained SHA-256',
        primaryMetricLabel: 'Zero-Tamper HIPAA Ledger',
        targetTab: 'audit',
        standards: ['HIPAA §164.312(b)', 'NIST SP 800-92 Audit'],
        status: 'PRODUCTION',
      },
      {
        domainNumber: 52,
        id: 'enterprise-governance',
        name: 'Enterprise Settings, Break-Glass & Zero-Trust Governance',
        category: 'Interop & Governance',
        badge: 'Zero-Trust RBAC',
        description:
          'Clinician profiles, workstation timeouts, emergency break-glass life-safety overrides & tenant isolation.',
        icon: Settings,
        accentColor: 'text-slate-700 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700',
        primaryMetric: '6 Domains',
        primaryMetricLabel: 'Security & Governance Matrix',
        targetTab: 'settings',
        standards: ['NIST SP 800-207 Zero Trust', 'Emergency Break-Glass'],
        status: 'PRODUCTION',
      },
    ],
    [patients.length, pendingLeakage, stats.occupancyRate, occupiedBeds, staff.length]
  );

  const categories = [
    'All (52)',
    'Clinical & Patient Care',
    'Emergency & Critical Care',
    'Diagnostics & Laboratory',
    'Supply Chain & CSSD',
    'Universal ERP & General Ledger',
    'Human Capital Management',
    'Specialty Clinics',
    'Interop & Governance',
  ];

  const filteredDomains = useMemo(() => {
    return all52Domains.filter((d) => {
      const q = searchFilter.toLowerCase().trim();
      const numMatch =
        q.length > 0 &&
        (d.domainNumber.toString() === q ||
          `#${d.domainNumber}` === q ||
          `domain ${d.domainNumber}`.includes(q) ||
          `domain #${d.domainNumber}`.includes(q));

      const matchesSearch =
        !q ||
        numMatch ||
        d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.standards.some((s) => s.toLowerCase().includes(q)) ||
        d.primaryMetricLabel.toLowerCase().includes(q);

      const matchesCategory =
        categoryFilter === 'All (52)' || categoryFilter === 'All' || d.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [all52Domains, searchFilter, categoryFilter]);

  const handleLaunch = (domain: DomainModuleItem) => {
    if (domain.directHref) {
      router.push(domain.directHref);
    } else if (domain.targetTab) {
      setActiveTab(domain.targetTab);
    } else {
      setActiveTab(domain.id);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner: Master 52 Domains of G-HIMS OS */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-5 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
              <Layers className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  All 52 Enterprise Domains of G-HIMS OS
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  52 Domains Registered
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Complete architectural registry spanning Clinical Care, Emergency & Trauma, Diagnostics, Supply Chain & CSSD, Universal ERP, HCM, Specialty Clinics & Interoperability.
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher & Search Bar */}
        <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
          {/* Grid vs Matrix Table Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Bento Card Grid"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="52-Domain Matrix Table"
            >
              <Table className="w-3.5 h-3.5" />
              <span>Matrix</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by domain #, name, standard..."
              className="text-xs pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-850 focus:ring-1 focus:ring-blue-500 outline-none w-56 sm:w-72 shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Quick Summary Pill Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Domains</div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">52 Domains</div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
            <Check className="w-3 h-3" /> Architecture Registry
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Operational Pillars</div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">8 Pillars</div>
          <div className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold mt-0.5">
            Full-Stack Integrated
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Zero-Trust RBAC</div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">Role-Gated</div>
          <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
            Active: {roleDefinition.displayName}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Qualification Evidence</div>
          <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">CI + Staging Gates</div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Evidence-driven readiness
          </div>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
        {categories.map((cat) => {
          const isSelected = categoryFilter === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Showing count */}
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>
          Showing <span className="text-blue-600 dark:text-blue-400 font-bold">{filteredDomains.length}</span> of 52 domains
        </span>
        {searchFilter && (
          <button
            onClick={() => setSearchFilter('')}
            className="text-blue-600 dark:text-blue-400 hover:underline font-bold text-xs"
          >
            Clear Search
          </button>
        )}
      </div>

      {/* VIEW MODE 1: Bento Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDomains.map((domain) => {
            const Icon = domain.icon;
            const isAllowed = canAccessModule(domain.id) || canAccessModule(domain.targetTab || '');

            return (
              <div
                key={domain.id}
                onClick={() => handleLaunch(domain)}
                className={`bg-white dark:bg-slate-900 p-5 rounded-2xl border ${
                  isAllowed
                    ? 'border-slate-200/80 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600'
                    : 'border-amber-200/60 dark:border-amber-900/40 opacity-80 hover:opacity-100 hover:border-amber-400'
                } shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group space-y-4 relative`}
              >
                <div className="space-y-3">
                  {/* Top Bar: Icon, Domain Number & Status Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${domain.accentColor}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          Domain #{domain.domainNumber < 10 ? `0${domain.domainNumber}` : domain.domainNumber}
                        </span>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                          {domain.category}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {isAllowed ? (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                          <Unlock className="w-2.5 h-2.5" /> Authorized
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" /> Gate Required
                        </span>
                      )}
                      {domain.isAiEnhanced && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/60 dark:to-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-amber-500" /> AI-Ready
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {domain.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {domain.description}
                    </p>
                  </div>

                  {/* Standards Tags */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {domain.standards.map((st) => (
                      <span
                        key={st}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-750"
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Footer: Metric & Action CTA */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-semibold">
                      {domain.primaryMetricLabel}
                    </span>
                    <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                      {domain.primaryMetric}
                    </span>
                  </div>

                  <div
                    className={`flex items-center gap-1 text-xs font-bold ${
                      isAllowed ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                    } group-hover:translate-x-0.5 transition-transform`}
                  >
                    {isAllowed ? 'Launch Domain' : 'Gate Required'} <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: 52-Domain Architecture Matrix Table */}
      {viewMode === 'table' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4 w-16">Domain #</th>
                  <th className="py-3 px-4">Domain Subsystem</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Technical Standards</th>
                  <th className="py-3 px-4">Primary Metric / Status</th>
                  <th className="py-3 px-4">Zero-Trust Access</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredDomains.map((domain) => {
                  const Icon = domain.icon;
                  const isAllowed = canAccessModule(domain.id) || canAccessModule(domain.targetTab || '');

                  return (
                    <tr
                      key={domain.id}
                      onClick={() => handleLaunch(domain)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono font-black text-blue-600 dark:text-blue-400">
                        #{domain.domainNumber < 10 ? `0${domain.domainNumber}` : domain.domainNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${domain.accentColor}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <span>{domain.name}</span>
                              {domain.isAiEnhanced && (
                                <span title="AI Enhanced">
                                  <Sparkles className="w-3 h-3 text-amber-500" />
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 max-w-md">
                              {domain.description}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {domain.category}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {domain.standards.map((st) => (
                            <span
                              key={st}
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              {st}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100 block">
                          {domain.primaryMetric}
                        </span>
                        <span className="text-[10px] text-slate-400">{domain.primaryMetricLabel}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isAllowed ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 inline-flex items-center gap-1">
                            <Unlock className="w-2.5 h-2.5" /> Authorized
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 inline-flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> Gated
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunch(domain);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 dark:border-blue-800 transition-colors inline-flex items-center gap-1 cursor-pointer"
                        >
                          Launch <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
