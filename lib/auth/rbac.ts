/**
 * G-HIMS Master Role-Based Access Control (RBAC) Engine
 * Implements granular permissions for:
 * 1. Administrator
 * 2. Doctor
 * 3. Nurse
 * 4. Receptionist
 * 5. Billing Clerk
 * 6. Patient
 */

export type {
  RoleId,
  ResourceId,
  ActionId,
  RoleDefinition,
  RbacEvaluationContext,
  PatientDataCategory,
  PatientDataCategoryDefinition,
  CrudPermission,
  SystemModulePermissionDefinition,
  PermissionRule,
} from '@/types/rbac';

import type {
  RoleId,
  ResourceId,
  ActionId,
  RoleDefinition,
  RbacEvaluationContext,
  PatientDataCategory,
  PatientDataCategoryDefinition,
  CrudPermission,
  SystemModulePermissionDefinition,
  PermissionRule,
} from '@/types/rbac';

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  administrator: {
    id: 'administrator',
    displayName: 'Administrator',
    category: 'administrative',
    badgeColor: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/60',
    badgeBorder: 'border-purple-200 dark:border-purple-800',
    iconName: 'ShieldCheck',
    summary: 'Full executive oversight across clinical, administrative, financial ERP, staff privileges, and audit governance.',
    permissions: {
      patient_records: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      staff_info: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      schedules: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      billing_data: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      clinical_notes: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      prescriptions: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      lab_orders: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      bed_census: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      ot_schedules: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      erp_gl: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      audit_logs: ['view', 'export', 'admin'],
      system_settings: ['view', 'create', 'update', 'delete', 'admin'],
      reporting_analytics: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      vitals_observations: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      diagnoses_problems: ['view', 'create', 'update', 'delete', 'export', 'admin'],
      discharge_summaries: ['view', 'create', 'update', 'delete', 'export', 'admin'],
    },
    accessibleModules: [
      'command',
      'directory',
      'matrix',
      'reporting',
      'rbac',
      'workflow-runtime',
      'disease-intake',
      'patients',
      'opd',
      'emergency',
      'surgery',
      'beds',
      'ancillary',
      'bloodbank',
      'telehealth',
      'interop',
      'sheets',
      'billing',
      'claims',
      'scm-pos',
      'erp-coa',
      'staff',
      'audit',
      'settings',
    ],
  },

  doctor: {
    id: 'doctor',
    displayName: 'Doctor',
    category: 'clinical',
    badgeColor: 'text-blue-700 dark:text-blue-300',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/60',
    badgeBorder: 'border-blue-200 dark:border-blue-800',
    iconName: 'Stethoscope',
    summary: 'Licensed Physician with credential-gated diagnostic, clinical ordering, surgical scheduling, and medication authority.',
    permissions: {
      patient_records: ['view', 'create', 'update', 'export'],
      staff_info: ['view'],
      schedules: ['view', 'create', 'update'],
      billing_data: ['view'],
      clinical_notes: ['view', 'create', 'update', 'export'],
      prescriptions: ['view', 'create', 'update', 'export'],
      lab_orders: ['view', 'create', 'update', 'export'],
      bed_census: ['view', 'update'],
      ot_schedules: ['view', 'create', 'update'],
      erp_gl: [],
      audit_logs: ['view'],
      system_settings: ['view'],
      reporting_analytics: ['view', 'export'],
      vitals_observations: ['view', 'create', 'update', 'export'],
      diagnoses_problems: ['view', 'create', 'update', 'export'],
      discharge_summaries: ['view', 'create', 'update', 'export'],
    },
    accessibleModules: [
      'command',
      'directory',
      'reporting',
      'rbac',
      'workflow-runtime',
      'disease-intake',
      'patients',
      'opd',
      'emergency',
      'surgery',
      'beds',
      'ancillary',
      'bloodbank',
      'telehealth',
      'interop',
      'sheets',
      'staff',
      'scm-pos',
    ],
    restrictedMessage: 'Financial ERP, tariff configuration, and administrative credentials management are restricted to Billing & Administrators.',
  },

  nurse: {
    id: 'nurse',
    displayName: 'Nurse',
    category: 'clinical',
    badgeColor: 'text-teal-700 dark:text-teal-300',
    badgeBg: 'bg-teal-50 dark:bg-teal-950/60',
    badgeBorder: 'border-teal-200 dark:border-teal-800',
    iconName: 'HeartPulse',
    summary: 'Inpatient & Triage Nurse managing bed census, vital observations, nursing care plans, and emergency triage.',
    permissions: {
      patient_records: ['view', 'create', 'update'],
      staff_info: ['view'],
      schedules: ['view', 'update'],
      billing_data: ['view'],
      clinical_notes: ['view', 'create', 'update'],
      prescriptions: ['view'],
      lab_orders: ['view', 'create'],
      bed_census: ['view', 'update'],
      ot_schedules: ['view'],
      erp_gl: [],
      audit_logs: [],
      system_settings: [],
      reporting_analytics: ['view'],
      vitals_observations: ['view', 'create', 'update'],
      diagnoses_problems: ['view'],
      discharge_summaries: ['view'],
    },
    accessibleModules: [
      'directory',
      'patients',
      'emergency',
      'beds',
      'opd',
      'disease-intake',
      'workflow-runtime',
      'bloodbank',
      'ancillary',
      'staff',
      'scm-pos',
    ],
    restrictedMessage: 'Prescribing medications, tariff modifications, and general ledger journal postings are restricted.',
  },

  receptionist: {
    id: 'receptionist',
    displayName: 'Receptionist',
    category: 'administrative',
    badgeColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/60',
    badgeBorder: 'border-amber-200 dark:border-amber-800',
    iconName: 'ClipboardList',
    summary: 'Front-desk Intake Officer managing patient demographics, queue tokens, appointment booking, and initial triage check-in.',
    permissions: {
      patient_records: ['view', 'create', 'update'],
      staff_info: ['view'],
      schedules: ['view', 'create', 'update', 'delete'],
      billing_data: ['view', 'create'],
      clinical_notes: [],
      prescriptions: [],
      lab_orders: [],
      bed_census: ['view'],
      ot_schedules: ['view'],
      erp_gl: [],
      audit_logs: [],
      system_settings: [],
      reporting_analytics: ['view'],
      vitals_observations: [],
      diagnoses_problems: [],
      discharge_summaries: [],
    },
    accessibleModules: [
      'directory',
      'patients',
      'opd',
      'beds',
      'telehealth',
      'staff',
    ],
    restrictedMessage: 'Clinical SOAP notes, pharmacy prescriptions, diagnostic orders, and General Ledger access are restricted to clinical & financial staff.',
  },

  billing_clerk: {
    id: 'billing_clerk',
    displayName: 'Billing Staff',
    category: 'financial',
    badgeColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800',
    iconName: 'DollarSign',
    summary: 'Revenue Cycle Officer handling charge capture, invoice generation, payer insurance claims, and tariff audits.',
    permissions: {
      patient_records: ['view', 'update'],
      staff_info: ['view'],
      schedules: ['view'],
      billing_data: ['view', 'create', 'update', 'export', 'admin'],
      clinical_notes: ['view'],
      prescriptions: ['view'],
      lab_orders: ['view'],
      bed_census: ['view'],
      ot_schedules: ['view'],
      erp_gl: ['view', 'create', 'update', 'export'],
      audit_logs: ['view'],
      system_settings: [],
      reporting_analytics: ['view', 'export'],
      vitals_observations: [],
      diagnoses_problems: ['view'],
      discharge_summaries: ['view'],
    },
    accessibleModules: [
      'command',
      'directory',
      'reporting',
      'rbac',
      'billing',
      'claims',
      'scm-pos',
      'erp-coa',
      'patients',
      'sheets',
      'audit',
    ],
    restrictedMessage: 'Direct clinical treatments, surgical schedules, and emergency triage edits are restricted to clinical practitioners.',
  },

  billing_staff: {
    id: 'billing_staff',
    displayName: 'Billing Staff',
    category: 'financial',
    badgeColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800',
    iconName: 'DollarSign',
    summary: 'Revenue Cycle Officer handling charge capture, invoice generation, payer insurance claims, and tariff audits.',
    permissions: {
      patient_records: ['view', 'update'],
      staff_info: ['view'],
      schedules: ['view'],
      billing_data: ['view', 'create', 'update', 'export', 'admin'],
      clinical_notes: ['view'],
      prescriptions: ['view'],
      lab_orders: ['view'],
      bed_census: ['view'],
      ot_schedules: ['view'],
      erp_gl: ['view', 'create', 'update', 'export'],
      audit_logs: ['view'],
      system_settings: [],
      reporting_analytics: ['view', 'export'],
      vitals_observations: [],
      diagnoses_problems: ['view'],
      discharge_summaries: ['view'],
    },
    accessibleModules: [
      'command',
      'directory',
      'reporting',
      'rbac',
      'billing',
      'claims',
      'scm-pos',
      'erp-coa',
      'patients',
      'sheets',
      'audit',
    ],
    restrictedMessage: 'Direct clinical treatments, surgical schedules, and emergency triage edits are restricted to clinical practitioners.',
  },

  patient: {
    id: 'patient',
    displayName: 'Patient',
    category: 'patient',
    badgeColor: 'text-indigo-700 dark:text-indigo-300',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/60',
    badgeBorder: 'border-indigo-200 dark:border-indigo-800',
    iconName: 'User',
    summary: 'Healthcare Consumer viewing personal medical charts, scheduled appointments, lab reports, and billing receipts.',
    permissions: {
      patient_records: ['view'], // restricted to own record
      staff_info: ['view'],
      schedules: ['view', 'create'], // own appointments only
      billing_data: ['view'], // own invoices only
      clinical_notes: ['view'], // own notes
      prescriptions: ['view'],
      lab_orders: ['view'],
      bed_census: [],
      ot_schedules: [],
      erp_gl: [],
      audit_logs: [],
      system_settings: [],
      reporting_analytics: [],
      vitals_observations: ['view'],
      diagnoses_problems: ['view'],
      discharge_summaries: ['view'],
    },
    accessibleModules: [
      'patient-portal',
      'telehealth',
      'opd',
      'billing',
      'patients',
    ],
    restrictedMessage: 'Enterprise command center, staff administrative portals, and clinical governance tools are restricted to hospital personnel.',
  },
};

/**
 * Standard Demo Personas for Quick Role Evaluation & Demonstration
 */
export const DEMO_PERSONAS: Record<RoleId, { name: string; title: string; email: string; avatarBg: string; patientId?: string }> = {
  administrator: {
    name: 'Dr. Arthur Pendelton',
    title: 'Chief Medical Officer & Hospital Administrator',
    email: 'admin@centralmetro.health',
    avatarBg: 'bg-purple-600',
  },
  doctor: {
    name: 'Dr. Sarah Jenkins, MD',
    title: 'Lead Attending Cardiologist',
    email: 's.jenkins@centralmetro.health',
    avatarBg: 'bg-blue-600',
  },
  nurse: {
    name: 'Nurse Clara Oswald, RN',
    title: 'Inpatient Ward Head Nurse',
    email: 'c.oswald@centralmetro.health',
    avatarBg: 'bg-teal-600',
  },
  receptionist: {
    name: 'Maria Santos',
    title: 'Front-Desk Patient Intake & Scheduling Officer',
    email: 'm.santos@centralmetro.health',
    avatarBg: 'bg-amber-600',
  },
  billing_clerk: {
    name: 'Robert Hastings',
    title: 'Senior Revenue Cycle & Billing Auditor',
    email: 'r.hastings@centralmetro.health',
    avatarBg: 'bg-emerald-600',
  },
  billing_staff: {
    name: 'Robert Hastings',
    title: 'Senior Revenue Cycle & Billing Auditor',
    email: 'r.hastings@centralmetro.health',
    avatarBg: 'bg-emerald-600',
  },
  patient: {
    name: 'Elena Rostova (Patient)',
    title: 'Verified Patient (MRN: GH-2026-9812)',
    email: 'elena.rostova@example.com',
    avatarBg: 'bg-indigo-600',
    patientId: 'p-1001',
  },
};

/**
 * Helper to normalize role strings from Firestore/Auth into standard RoleId
 */
export function normalizeRole(roleStr?: string): RoleId {
  if (!roleStr) return 'doctor';
  const clean = roleStr.toLowerCase().trim().replace(/\s+/g, '_');
  if (clean === 'admin' || clean === 'administrator' || clean === 'system_admin') return 'administrator';
  if (clean === 'medical_director') return 'doctor';
  if (clean === 'doctor' || clean === 'physician' || clean === 'surgeon') return 'doctor';
  if (clean === 'nurse' || clean === 'head_nurse') return 'nurse';
  if (clean === 'reception' || clean === 'receptionist' || clean === 'intake') return 'receptionist';
  if (clean === 'billing' || clean === 'billing_clerk' || clean === 'billing_staff' || clean === 'finance') return 'billing_staff';
  if (clean === 'patient') return 'patient';
  return 'doctor';
}

/**
 * Patient Data Categories Definition
 */
export const PATIENT_DATA_CATEGORIES: PatientDataCategoryDefinition[] = [
  {
    id: 'demographics',
    name: 'Patient Demographics & MPI Identity',
    description: 'Master patient index, legal name, DOB, address, contact, emergency contacts, national ID & MRN.',
    phiSensitivity: 'MEDIUM',
    applicableStandards: ['HIPAA Privacy Rule', 'ISO 27799', 'HL7 FHIR Patient'],
  },
  {
    id: 'clinical_notes',
    name: 'Clinical SOAP Notes & Progress Reports',
    description: 'Subjective, Objective, Assessment, Plan notes, clinical impressions, attending ward progress notes.',
    phiSensitivity: 'STRICTLY_CONFIDENTIAL',
    applicableStandards: ['HIPAA Security Rule', 'HL7 FHIR Composition', 'Joint Commission'],
  },
  {
    id: 'diagnoses',
    name: 'Diagnoses & Problem Lists (ICD-10)',
    description: 'Active chronic and acute diagnoses, differential problem lists, comorbidities, ICD-10-CM codes.',
    phiSensitivity: 'HIGH',
    applicableStandards: ['ICD-10-CM', 'SNOMED CT', 'HL7 FHIR Condition'],
  },
  {
    id: 'prescriptions',
    name: 'Prescriptions & Medication Orders (CPOE)',
    description: 'Legend medications, controlled substances, dosage titrations, administration routes, active MAR entries.',
    phiSensitivity: 'HIGH',
    applicableStandards: ['DEA Schedule Gating', 'NCPDP SCRIPT', 'HL7 FHIR MedicationRequest'],
  },
  {
    id: 'vitals',
    name: 'Vital Signs & Nursing Observations',
    description: 'Systolic/Diastolic BP, Heart Rate, SpO2, Respiratory Rate, Temperature, Glasgow Coma Scale, NEWS2 score.',
    phiSensitivity: 'MEDIUM',
    applicableStandards: ['LOINC', 'NEWS2 Protocol', 'HL7 FHIR Observation'],
  },
  {
    id: 'billing_data',
    name: 'Billing, Invoices, Tariffs & Claims',
    description: 'Service item charges, insurance claim EDI 837, co-pay receipts, AR open balances, payment vouchers.',
    phiSensitivity: 'HIGH',
    applicableStandards: ['HIPAA EDI X12 837/835', 'GAAP Financial Invariance', 'PCI-DSS'],
  },
  {
    id: 'lab_results',
    name: 'Lab Orders & Diagnostic Results',
    description: 'Biochemistry, hematology, microbiology, pathology cultures, radiology PACS impressions, blood type.',
    phiSensitivity: 'HIGH',
    applicableStandards: ['CLIA Standards', 'DICOM PS3.x', 'HL7 FHIR DiagnosticReport'],
  },
  {
    id: 'discharge_summaries',
    name: 'Discharge Summaries & Care Transfers',
    description: 'Inpatient discharge instructions, course of hospitalization, follow-up plan, outbound continuity of care.',
    phiSensitivity: 'STRICTLY_CONFIDENTIAL',
    applicableStandards: ['HL7 CDA / C-CDA', 'Joint Commission Discharge Gating'],
  },
];

/**
 * Authoritative Granular CRUD Permission Matrix by Role & Patient Data Type
 * Designed strictly on the Principle of Least Privilege
 */
export const PATIENT_DATA_CRUD_MATRIX: Record<PatientDataCategory, Record<RoleId, CrudPermission>> = {
  demographics: {
    administrator: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false, // Soft-archive only under HIPAA retention mandates
      canExport: true,
      restrictionReason: 'Hard deletion forbidden by medical record retention laws. Demographics may only be archived with audit trail.',
    },
    doctor: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Physicians can update emergency contacts or clinical identifiers, but cannot permanently delete patient charts.',
    },
    nurse: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses may register emergency trauma arrivals and update triage demographics. Bulk export restricted.',
    },
    receptionist: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Primary registrar role. Can intake, verify IDs, and update contact info. Deletions require administrative compliance.',
    },
    billing_clerk: {
      canView: true,
      canCreate: false,
      canEdit: true, // billing address and insurance policy
      canDelete: false,
      canExport: true,
      restrictionReason: 'Billing staff may edit guarantor and insurance coverage details. Intake is delegated to front desk.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Billing staff may edit guarantor and insurance coverage details. Intake is delegated to front desk.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: true, // own contact info
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can view their own identity record and request demographic profile updates.',
    },
  },

  clinical_notes: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Non-clinical administrators have read-only access for accreditation and peer review; cannot author or alter medical notes.',
    },
    doctor: {
      canView: true,
      canCreate: true,
      canEdit: true, // addendum / clinical correction within 24h
      canDelete: false,
      canExport: true,
      restrictionReason: 'Attending physicians author notes. Historical notes are immutable; corrections require timestamped addenda.',
    },
    nurse: {
      canView: true,
      canCreate: true,
      canEdit: true, // nursing shift notes only
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses author shift progress and triage observations. Cannot modify physician notes or delete entries.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'HIPAA Minimum Necessary Rule: Administrative front-desk staff have zero operational need for clinical medical notes.',
    },
    billing_clerk: {
      canView: true, // medical necessity coding audit
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'View-only access for medical necessity verification and diagnosis code abstraction. Modifying notes is strictly prohibited.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'View-only access for medical necessity verification and diagnosis code abstraction. Modifying notes is strictly prohibited.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: '21st Century Cures Act Open Notes compliance: Patients can view and download their finalized physician notes.',
    },
  },

  diagnoses: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Auditing and epidemiology review only. Medical diagnosis requires physician licensure.',
    },
    doctor: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Licensed physicians hold statutory diagnostic privilege. Problem list items may be resolved or updated, never expunged.',
    },
    nurse: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses observe diagnoses to align care plans. Diagnostic establishment is legally reserved for physicians.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Protected health information: Receptionists do not need diagnostic condition details to schedule visits.',
    },
    billing_clerk: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Coders review diagnoses for ICD-10 DRG mapping. Establishing or changing medical diagnoses is prohibited.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Coders review diagnoses for ICD-10 DRG mapping. Establishing or changing medical diagnoses is prohibited.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can review confirmed diagnoses and problem lists in their personal health record.',
    },
  },

  prescriptions: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Formulary compliance oversight. Prescribing requires state medical board license and DEA registration.',
    },
    doctor: {
      canView: true,
      canCreate: true,
      canEdit: true, // titrate, discontinue, renew
      canDelete: false, // cancellation event required
      canExport: true,
      restrictionReason: 'Prescribing authority gated by clinical credentials. Discontinued orders generate cancellation events.',
    },
    nurse: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses execute medication administration (MAR) but cannot prescribe drugs or titrate without verbal/written physician order.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Strictly restricted: Front-desk administrative staff have zero access to medication regimens or controlled substance orders.',
    },
    billing_clerk: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Pharmacy revenue reconciliation and NDC code cross-referencing. Cannot alter medication orders.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Pharmacy revenue reconciliation and NDC code cross-referencing. Cannot alter medication orders.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can view active prescriptions, dosages, refill status, and pharmacy instructions.',
    },
  },

  vitals: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Quality metrics and early warning score epidemiology audit.',
    },
    doctor: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Physicians record examination vitals. Measurements are auditable historical points in time.',
    },
    nurse: {
      canView: true,
      canCreate: true,
      canEdit: true, // correction with audit reason
      canDelete: false,
      canExport: false,
      restrictionReason: 'Primary nursing duty for triage and inpatient shift observation. Corrections log a compensating audit record.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Clinical telemetry and vital observations are outside the scope of administrative desk intake.',
    },
    billing_clerk: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Vital signs are clinical observations irrelevant to claim adjudication and financial journal posting.',
    },
    billing_staff: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Vital signs are clinical observations irrelevant to claim adjudication and financial journal posting.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can view their recorded vitals history and trends in their personal health portal.',
    },
  },

  billing_data: {
    administrator: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false, // double-entry GL invariance
      canExport: true,
      restrictionReason: 'Financial oversight and fiscal governance. Debits and credits must balance; deletions require credit notes.',
    },
    doctor: {
      canView: true, // procedural fee and tariff transparency
      canCreate: true, // service charge capture for completed procedures
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Doctors capture clinical service charges but cannot manipulate financial ledgers or cancel invoices.',
    },
    nurse: {
      canView: true, // consumable item usage check
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses verify clinical consumable items; financial tariffs and invoicing are handled by billing.',
    },
    receptionist: {
      canView: true, // co-pay fee schedules
      canCreate: true, // intake deposit receipting
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Receptionists collect standard visit co-pays and issue payment receipts at check-in.',
    },
    billing_clerk: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Primary billing role. Manages charges, EDI 837 claims, discounts, and payments. Follows GAAP reversal standards.',
    },
    billing_staff: {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Primary billing role. Manages charges, EDI 837 claims, discounts, and payments. Follows GAAP reversal standards.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can view their itemized invoices, co-pay receipts, and payment transaction history.',
    },
  },

  lab_results: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Laboratory accreditation, quality control, and turnaround time analytics.',
    },
    doctor: {
      canView: true,
      canCreate: true, // CPOE lab order entry
      canEdit: true, // amend order tests
      canDelete: false,
      canExport: true,
      restrictionReason: 'Physicians order diagnostic lab panels and radiology exams, and review validated lab impressions.',
    },
    nurse: {
      canView: true,
      canCreate: true, // standing emergency triage orders & specimen draw confirmation
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses track specimen status and critical panic values; diagnostic ordering is protocol-bounded.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Diagnostic reports contain sensitive clinical pathology data with zero operational need for front desk.',
    },
    billing_clerk: {
      canView: true, // charge code audit against lab charge master
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Billing staff view diagnostic test codes to ensure accurate procedural charge capture.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Billing staff view diagnostic test codes to ensure accurate procedural charge capture.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients can review physician-verified diagnostic lab and imaging test results.',
    },
  },

  discharge_summaries: {
    administrator: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Clinical documentation improvement and length of stay audit.',
    },
    doctor: {
      canView: true,
      canCreate: true, // physician discharge summary
      canEdit: true, // addendum
      canDelete: false,
      canExport: true,
      restrictionReason: 'Attending physicians sign off medical discharge summaries, discharge medications, and transfer summaries.',
    },
    nurse: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Nurses review discharge summaries to prepare nursing departure packets and medication reconciliation.',
    },
    receptionist: {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Discharge clinical narratives contain detailed medical summaries restricted from administrative front desk.',
    },
    billing_clerk: {
      canView: true, // verify discharge date and final DRG coding
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Billing verifies formal discharge timestamp to close room census charges and finalize the invoice.',
    },
    billing_staff: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      restrictionReason: 'Billing verifies formal discharge timestamp to close room census charges and finalize the invoice.',
    },
    patient: {
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: true,
      restrictionReason: 'Patients receive their discharge instructions, home medication plan, and follow-up consultation dates.',
    },
  },
};

/**
 * System Modules Access Mapping on Least-Privilege Basis
 */
export const SYSTEM_MODULES_PERMISSIONS: SystemModulePermissionDefinition[] = [
  {
    moduleId: 'patients',
    name: 'Patient Records (MPI)',
    category: 'Clinical Core',
    description: 'Master Patient Index, longitudinal medical chart, demographic ingress, and duplicate resolution.',
    allowedRoles: ['administrator', 'doctor', 'nurse', 'receptionist', 'billing_clerk', 'billing_staff', 'patient'],
    leastPrivilegeRationale: 'All clinical and administrative roles require identity lookup; field-level masking restricts clinical notes from non-clinical staff.',
  },
  {
    moduleId: 'opd',
    name: 'Scheduling & OPD Appointments',
    category: 'Clinical Core',
    description: 'Outpatient clinic bookings, token queues, doctor availability calendars, and encounter initiation.',
    allowedRoles: ['administrator', 'doctor', 'nurse', 'receptionist', 'patient'],
    leastPrivilegeRationale: 'Receptionists manage booking logistics; doctors conduct encounters; nurses manage vital queues; billing staff have read-only view.',
  },
  {
    moduleId: 'beds',
    name: 'Inpatient Bed Census & Wards',
    category: 'Clinical Core',
    description: 'Real-time bed occupancy, room allocation, ward transfers, and environmental infection control.',
    allowedRoles: ['administrator', 'doctor', 'nurse', 'receptionist'],
    leastPrivilegeRationale: 'Nurses and doctors control patient bed assignment; receptionists view room numbers for family inquiries; billing views bed tariff days.',
  },
  {
    moduleId: 'emergency',
    name: 'Emergency & Trauma (ER)',
    category: 'Clinical Core',
    description: 'Rapid triage intake, ESI score assessment, resuscitation suites, STAT orders, and fast-track admission.',
    allowedRoles: ['administrator', 'doctor', 'nurse'],
    leastPrivilegeRationale: 'Critical clinical care environment reserved for licensed physicians and triage nurses. Administrative staff check-in at front triage.',
  },
  {
    moduleId: 'surgery',
    name: 'Operating Theaters (OT)',
    category: 'Clinical Core',
    description: 'Surgical suite scheduling, WHO surgical safety checklist, anesthesia documentation, and post-op PACU recovery.',
    allowedRoles: ['administrator', 'doctor'],
    leastPrivilegeRationale: 'Restricted strictly to surgeons, anesthesiologists, and surgical administrators due to high-risk operative procedures.',
  },
  {
    moduleId: 'ancillary',
    name: 'Diagnostics & Lab Orders (LIS/RIS)',
    category: 'Diagnostics',
    description: 'Laboratory analyzer interfaces, CPOE specimen draw queues, radiology PACS DICOM viewer, and verified reports.',
    allowedRoles: ['administrator', 'doctor', 'nurse'],
    leastPrivilegeRationale: 'Laboratory and diagnostic ordering is clinical; billing staff view charges through the financial billing module.',
  },
  {
    moduleId: 'billing',
    name: 'Billing, Tariffs & Patient Invoicing',
    category: 'Operations, Finance & ERP',
    description: 'Charge master tariff catalog, patient invoice generation, payment receipting, co-pay tracking, and refunds.',
    allowedRoles: ['administrator', 'billing_clerk', 'billing_staff', 'patient'],
    leastPrivilegeRationale: 'Segregation of duties: Revenue cycle officers manage monetary transactions; doctors capture clinical charges without editing ledgers.',
  },
  {
    moduleId: 'claims',
    name: 'Claims Scrubber (EDI 837/835)',
    category: 'Operations, Finance & ERP',
    description: 'Payer clearinghouse integration, EDI 837P/837I scrubbers, pre-authorization verification, and ERA 835 remittance.',
    allowedRoles: ['administrator', 'billing_clerk', 'billing_staff'],
    leastPrivilegeRationale: 'Insurance claim adjudication and payer communication is restricted to professional billing and revenue cycle auditors.',
  },
  {
    moduleId: 'erp-coa',
    name: 'Universal General Ledger (ERP)',
    category: 'Operations, Finance & ERP',
    description: 'Double-entry accounting journal vouchers, chart of accounts, balance sheet, trial balance, and fiscal closing.',
    allowedRoles: ['administrator', 'billing_clerk', 'billing_staff'],
    leastPrivilegeRationale: 'Financial controllers and senior billing auditors only. Clinical staff are strictly blocked from general ledger postings.',
  },
  {
    moduleId: 'reporting',
    name: 'Advanced Reporting & Analytics',
    category: 'Executive & Analytics',
    description: 'Hospital KPIs: patient admission rates, 30-day readmissions, ALOS benchmarks, department revenue, and bed trends.',
    allowedRoles: ['administrator', 'doctor', 'billing_clerk', 'billing_staff'],
    leastPrivilegeRationale: 'Executive administrators view full hospital analytics; doctors review clinical quality and ALOS; billing views departmental revenue.',
  },
  {
    moduleId: 'rbac',
    name: 'RBAC Management & Permission Matrix',
    category: 'Executive & Analytics',
    description: 'Role-based access control engine, granular CRUD permissions, least-privilege audits, and live security simulation.',
    allowedRoles: ['administrator', 'doctor', 'billing_clerk', 'billing_staff'],
    leastPrivilegeRationale: 'Auditors and leadership can review permissions; only administrators hold authority to alter credential policies.',
  },
  {
    moduleId: 'audit',
    name: 'HIPAA Audit Ledger & Edge Outbox',
    category: 'System & Governance',
    description: 'Immutable cryptographic access log, PHI disclosure records, failed access attempts, and distributed outbox sync.',
    allowedRoles: ['administrator', 'billing_clerk', 'billing_staff'],
    leastPrivilegeRationale: 'Compliance officers and system administrators monitor audit trails; general clinical staff cannot inspect system audit records.',
  },
  {
    moduleId: 'settings',
    name: 'Enterprise Settings & Config',
    category: 'System & Governance',
    description: 'Hospital facility configuration, multi-tenant isolation, clinical protocol definitions, and master system toggles.',
    allowedRoles: ['administrator'],
    leastPrivilegeRationale: 'System configuration is exclusively reserved for the Hospital Administrator / Chief Medical Officer.',
  },
];

/**
 * Evaluates whether a role can perform a CRUD action on a specific patient data category
 */
export function getPatientDataPermission(
  role: RoleId,
  category: PatientDataCategory,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
): { allowed: boolean; restrictionReason: string } {
  const normRole = normalizeRole(role);
  const matrixCategory = PATIENT_DATA_CRUD_MATRIX[category];
  if (!matrixCategory) {
    return { allowed: false, restrictionReason: 'Unknown patient data category' };
  }
  const rolePerm = matrixCategory[normRole] || matrixCategory.doctor;
  
  let allowed = false;
  switch (action) {
    case 'view': allowed = rolePerm.canView; break;
    case 'create': allowed = rolePerm.canCreate; break;
    case 'edit': allowed = rolePerm.canEdit; break;
    case 'delete': allowed = rolePerm.canDelete; break;
    case 'export': allowed = rolePerm.canExport; break;
  }

  return {
    allowed,
    restrictionReason: rolePerm.restrictionReason || (allowed ? 'Action authorized under active role credentials.' : 'Action restricted under least-privilege policy.'),
  };
}

/**
 * Detailed permission simulation test result for compliance officers and UI tester
 */
export interface PermissionTestResult {
  role: RoleId;
  roleDisplayName: string;
  resourceOrCategory: string;
  action: string;
  allowed: boolean;
  policy: string;
  regulatoryStandard: string;
  leastPrivilegeRationale: string;
  riskAssessment: 'SAFE' | 'LOW_RISK' | 'HIGH_RISK_BLOCKED' | 'CRITICAL_SECURITY_GATE';
}

export function evaluatePermissionSimulation(
  role: RoleId,
  categoryOrResource: string,
  action: 'view' | 'create' | 'edit' | 'delete' | 'export'
): PermissionTestResult {
  const normRole = normalizeRole(role);
  const roleDef = ROLE_DEFINITIONS[normRole] || ROLE_DEFINITIONS.doctor;

  // Check if it's one of the 8 patient data categories
  const matchedCategory = PATIENT_DATA_CATEGORIES.find((c) => c.id === categoryOrResource || c.name.toLowerCase().includes(categoryOrResource.toLowerCase()));
  
  if (matchedCategory) {
    const permResult = getPatientDataPermission(normRole, matchedCategory.id, action);
    const standards = matchedCategory.applicableStandards.join(', ');
    
    let risk: PermissionTestResult['riskAssessment'] = 'SAFE';
    if (!permResult.allowed) {
      risk = action === 'delete' ? 'CRITICAL_SECURITY_GATE' : 'HIGH_RISK_BLOCKED';
    } else if (action === 'export' || action === 'delete') {
      risk = 'LOW_RISK';
    }

    return {
      role: normRole,
      roleDisplayName: roleDef.displayName,
      resourceOrCategory: matchedCategory.name,
      action: action.toUpperCase(),
      allowed: permResult.allowed,
      policy: permResult.allowed ? 'POLICY_ALLOW_LEAST_PRIVILEGE' : 'POLICY_DENY_LEAST_PRIVILEGE',
      regulatoryStandard: standards,
      leastPrivilegeRationale: permResult.restrictionReason,
      riskAssessment: risk,
    };
  }

  // Fallback to ResourceId check
  const resourceKey = categoryOrResource as ResourceId;
  const allowed = hasRbacPermission(normRole, resourceKey, action as ActionId);
  return {
    role: normRole,
    roleDisplayName: roleDef.displayName,
    resourceOrCategory: formatResourceName(resourceKey),
    action: action.toUpperCase(),
    allowed,
    policy: allowed ? 'POLICY_ALLOW_ROLE_SCOPE' : 'POLICY_DENY_ROLE_SCOPE',
    regulatoryStandard: 'HIPAA Security Rule 45 CFR § 164.312',
    leastPrivilegeRationale: allowed
      ? `Authorized for role ${roleDef.displayName} based on institutional scope.`
      : `Restricted from role ${roleDef.displayName} under separation of duties and least-privilege standards.`,
    riskAssessment: allowed ? 'SAFE' : 'HIGH_RISK_BLOCKED',
  };
}

/**
 * Checks if a given role has permission to execute an action on a resource
 */
export function hasRbacPermission(
  role: RoleId,
  resource: ResourceId,
  action: ActionId,
  context?: RbacEvaluationContext
): boolean {
  const roleDef = ROLE_DEFINITIONS[role];
  if (!roleDef) return false;

  // Administrator has unrestricted permission across all domains
  if (role === 'administrator') return true;

  // Emergency override bypass
  if (context?.isEmergencyOverride && (role === 'doctor' || role === 'nurse')) {
    return true;
  }

  // Patient scoped checks: Patient can ONLY access their own records
  if (role === 'patient') {
    if (context?.targetPatientId && context?.userPatientId) {
      if (context.targetPatientId !== context.userPatientId) {
        return false;
      }
    }
  }

  const allowedActions = roleDef.permissions[resource] || [];
  return allowedActions.includes(action);
}

/**
 * Checks if a module is accessible by a given role
 */
export function canRoleAccessModule(role: RoleId, moduleId: string): boolean {
  const roleDef = ROLE_DEFINITIONS[role];
  if (!roleDef) return false;
  if (role === 'administrator') return true;
  return roleDef.accessibleModules.includes(moduleId);
}

/**
 * Formats resource names for human-readable display
 */
export function formatResourceName(resource: ResourceId): string {
  switch (resource) {
    case 'patient_records': return 'Patient Records & EHR';
    case 'staff_info': return 'Staff & Specialist Info';
    case 'schedules': return 'Schedules & Appointments';
    case 'billing_data': return 'Billing & Invoices';
    case 'clinical_notes': return 'Clinical SOAP Notes';
    case 'prescriptions': return 'Prescriptions & Rx';
    case 'lab_orders': return 'Lab & Diagnostic Orders';
    case 'bed_census': return 'Inpatient Bed Census';
    case 'ot_schedules': return 'Operating Theater Cases';
    case 'erp_gl': return 'Enterprise General Ledger';
    case 'audit_logs': return 'HIPAA Audit Logs';
    case 'system_settings': return 'System Settings';
    default: return resource;
  }
}
