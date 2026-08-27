export type UserRole = 
  | 'admin'
  | 'doctor'
  | 'nurse'
  | 'reception'
  | 'pharmacy'
  | 'lab'
  | 'billing';

export interface Tenant {
  id: string;
  name: string;
  facilityCode: string;
  brandColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  activeStatus: 'active' | 'suspended' | 'provisioning' | 'maintenance';
  domain?: string;
  customDomain?: string;
  region: string;
  tier: 'starter' | 'professional' | 'enterprise';
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  contactEmail?: string;
  contactPhone?: string;
  licenseNumber?: string;
  settings?: {
    emergencyBypassEnabled?: boolean;
    requireMfa?: boolean;
    hipaaAuditRetentionDays?: number;
    defaultTimezone?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TenantUser {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: UserRole;
  department?: string;
  licenseId?: string;
  assignedWards?: string[];
  status: 'active' | 'invited' | 'disabled';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantContextType {
  currentTenant: Tenant | null;
  tenantId: string;
  role: UserRole;
  userTenants: Tenant[];
  isLoading: boolean;
  error: string | null;
  switchTenant: (tenantId: string) => Promise<void>;
  updateTenantSettings?: (settings: Partial<Tenant['settings']>) => Promise<void>;
}
