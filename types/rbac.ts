/**
 * G-HIMS Role-Based Access Control (RBAC) System
 * Defines standard healthcare enterprise roles, resources, actions, and permissions.
 */

export type RoleId = 
  | 'administrator'
  | 'doctor'
  | 'nurse'
  | 'receptionist'
  | 'billing_clerk'
  | 'billing_staff'
  | 'patient';

export type ResourceId = 
  | 'patient_records'
  | 'staff_info'
  | 'schedules'
  | 'billing_data'
  | 'clinical_notes'
  | 'prescriptions'
  | 'lab_orders'
  | 'bed_census'
  | 'ot_schedules'
  | 'erp_gl'
  | 'audit_logs'
  | 'system_settings'
  | 'reporting_analytics'
  | 'vitals_observations'
  | 'diagnoses_problems'
  | 'discharge_summaries';

export type ActionId = 'view' | 'create' | 'update' | 'delete' | 'export' | 'admin';

export type PatientDataCategory =
  | 'demographics'
  | 'clinical_notes'
  | 'diagnoses'
  | 'prescriptions'
  | 'vitals'
  | 'billing_data'
  | 'lab_results'
  | 'discharge_summaries';

export interface CrudPermission {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  restrictionReason?: string;
}

export interface PatientDataCategoryDefinition {
  id: PatientDataCategory;
  name: string;
  description: string;
  phiSensitivity: 'LOW' | 'MEDIUM' | 'HIGH' | 'STRICTLY_CONFIDENTIAL';
  applicableStandards: string[];
}

export interface SystemModulePermissionDefinition {
  moduleId: string;
  name: string;
  category: 'Clinical Core' | 'Diagnostics' | 'Operations, Finance & ERP' | 'Executive & Analytics' | 'System & Governance';
  description: string;
  allowedRoles: RoleId[];
  leastPrivilegeRationale: string;
}

export interface PermissionRule {
  resource: ResourceId;
  actions: ActionId[];
  scope?: 'all' | 'own' | 'department' | 'assigned';
  description: string;
}

export interface RoleDefinition {
  id: RoleId;
  displayName: string;
  category: 'clinical' | 'administrative' | 'financial' | 'patient';
  badgeColor: string;
  badgeBg: string;
  badgeBorder: string;
  iconName: string;
  summary: string;
  permissions: Record<ResourceId, ActionId[]>;
  accessibleModules: string[];
  restrictedMessage?: string;
}

export interface RbacEvaluationContext {
  role: RoleId;
  userId?: string;
  targetPatientId?: string;
  departmentId?: string;
  userPatientId?: string;
  isEmergencyOverride?: boolean;
}
