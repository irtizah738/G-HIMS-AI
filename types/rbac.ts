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
  | 'system_settings';

export type ActionId = 'view' | 'create' | 'update' | 'delete' | 'export' | 'admin';

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
