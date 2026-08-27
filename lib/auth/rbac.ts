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

import { RoleId, ResourceId, ActionId, RoleDefinition, RbacEvaluationContext } from '@/types/rbac';

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
    },
    accessibleModules: [
      'command',
      'directory',
      'patients',
      'opd',
      'emergency',
      'surgery',
      'beds',
      'disease-intake',
      'workflow-runtime',
      'telehealth',
      'ancillary',
      'bloodbank',
      'interop',
      'billing',
      'claims',
      'scm-pos',
      'erp-coa',
      'staff',
      'audit',
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
    },
    accessibleModules: [
      'command',
      'directory',
      'patients',
      'opd',
      'emergency',
      'surgery',
      'beds',
      'disease-intake',
      'workflow-runtime',
      'telehealth',
      'ancillary',
      'bloodbank',
      'interop',
      'staff',
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
    },
    accessibleModules: [
      'command',
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
      billing_data: ['view'],
      clinical_notes: [],
      prescriptions: [],
      lab_orders: [],
      bed_census: ['view'],
      ot_schedules: ['view'],
      erp_gl: [],
      audit_logs: [],
      system_settings: [],
    },
    accessibleModules: [
      'command',
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
    displayName: 'Billing Clerk',
    category: 'financial',
    badgeColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60',
    badgeBorder: 'border-emerald-200 dark:border-emerald-800',
    iconName: 'DollarSign',
    summary: 'Revenue Cycle Officer handling charge capture, invoice generation, payer insurance claims, and tariff audits.',
    permissions: {
      patient_records: ['view'],
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
    },
    accessibleModules: [
      'command',
      'directory',
      'billing',
      'claims',
      'scm-pos',
      'erp-coa',
      'patients',
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
    },
    accessibleModules: [
      'patients',
      'opd',
      'telehealth',
      'billing',
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
  if (clean === 'admin' || clean === 'administrator' || clean === 'system_admin' || clean === 'medical_director') return 'administrator';
  if (clean === 'doctor' || clean === 'physician' || clean === 'surgeon') return 'doctor';
  if (clean === 'nurse' || clean === 'head_nurse') return 'nurse';
  if (clean === 'reception' || clean === 'receptionist' || clean === 'intake') return 'receptionist';
  if (clean === 'billing' || clean === 'billing_clerk' || clean === 'finance') return 'billing_clerk';
  if (clean === 'patient') return 'patient';
  return 'doctor';
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
