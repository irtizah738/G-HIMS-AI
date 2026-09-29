'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { Tenant, TenantContextType, UserRole } from '@/types/tenant';
import { useAuth } from '@/lib/auth/auth-context';

export const DEFAULT_TENANTS: Tenant[] = [
  {
    id: 'government-gynae-hospital',
    name: 'Government Gynae Hospital',
    facilityCode: 'GGH-01',
    brandColor: '#ec4899',
    secondaryColor: '#db2777',
    activeStatus: 'active',
    region: 'asia-south1',
    tier: 'enterprise',
    address: {
      street: '108 Maternity Care Boulevard',
      city: 'Capital District',
      state: 'CD',
      zipCode: '500001',
      country: 'India',
    },
    contactEmail: 'admin@govtgynae.health',
    contactPhone: '+91 (040) 2473-9000',
    licenseNumber: 'GOVT-GYN-99104',
    settings: {
      emergencyBypassEnabled: true,
      requireMfa: false,
      hipaaAuditRetentionDays: 2555,
      defaultTimezone: 'Asia/Kolkata',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'grace-valley-general',
    name: 'Grace Valley General',
    facilityCode: 'GVGH-02',
    brandColor: '#0284c7',
    secondaryColor: '#0369a1',
    activeStatus: 'active',
    region: 'us-east1',
    tier: 'enterprise',
    address: {
      street: '3400 Valley Parkway, Suite 100',
      city: 'Grace Valley',
      state: 'VA',
      zipCode: '22030',
      country: 'USA',
    },
    contactEmail: 'info@gracevalley.health',
    contactPhone: '+1 (555) 349-8800',
    licenseNumber: 'VA-GEN-HOSP-4421',
    settings: {
      emergencyBypassEnabled: true,
      requireMfa: false,
      hipaaAuditRetentionDays: 2555,
      defaultTimezone: 'America/New_York',
    },
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'central-metro-hospital',
    name: 'Central Metro General Hospital',
    facilityCode: 'CMGH-01',
    brandColor: '#2563eb',
    secondaryColor: '#1d4ed8',
    activeStatus: 'active',
    region: 'asia-east1',
    tier: 'enterprise',
    address: {
      street: '742 Healthcare Ave, Metro Center',
      city: 'Metropolis',
      state: 'Metro',
      zipCode: '10001',
      country: 'USA',
    },
    contactEmail: 'admin@centralmetro.health',
    contactPhone: '+1 (555) 839-4400',
    licenseNumber: 'HOSP-MED-99420-A',
    settings: {
      emergencyBypassEnabled: true,
      requireMfa: false,
      hipaaAuditRetentionDays: 2555,
      defaultTimezone: 'America/New_York',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'st-jude-trauma-center',
    name: 'St. Jude Academic Trauma Center',
    facilityCode: 'SJTC-04',
    brandColor: '#dc2626',
    secondaryColor: '#b91c1c',
    activeStatus: 'active',
    region: 'us-east1',
    tier: 'enterprise',
    address: {
      street: '120 Emergency Blvd, East Wing',
      city: 'St. Jude City',
      state: 'ST',
      zipCode: '38105',
      country: 'USA',
    },
    contactEmail: 'trauma-ops@stjude-trauma.health',
    contactPhone: '+1 (555) 911-2000',
    licenseNumber: 'TRAUMA-LVL1-00812',
    settings: {
      emergencyBypassEnabled: true,
      requireMfa: true,
      hipaaAuditRetentionDays: 3650,
      defaultTimezone: 'America/Chicago',
    },
    createdAt: '2024-06-15T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    id: 'beacon-childrens-clinic',
    name: 'Beacon Children’s & Specialty Clinic',
    facilityCode: 'BCSC-09',
    brandColor: '#059669',
    secondaryColor: '#047857',
    activeStatus: 'active',
    region: 'asia-east1',
    tier: 'professional',
    address: {
      street: '45 Sunshine Way, Pediatric Pavilion',
      city: 'Beacon',
      state: 'BC',
      zipCode: '90210',
      country: 'USA',
    },
    contactEmail: 'pediatrics@beaconclinic.health',
    contactPhone: '+1 (555) 733-4271',
    licenseNumber: 'PEDI-CLINIC-44129',
    settings: {
      emergencyBypassEnabled: false,
      requireMfa: false,
      hipaaAuditRetentionDays: 2555,
      defaultTimezone: 'America/Los_Angeles',
    },
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
];

const TenantContext = createContext<TenantContextType>({
  currentTenant: DEFAULT_TENANTS[0],
  tenantId: DEFAULT_TENANTS[0].id,
  role: 'doctor',
  userTenants: DEFAULT_TENANTS,
  isLoading: false,
  error: null,
  switchTenant: async () => {},
});

interface TenantProviderProps {
  children: React.ReactNode;
  initialTenantId?: string;
}

export function TenantProvider({ children, initialTenantId }: TenantProviderProps) {
  const {
    user,
    activeTenant,
    accessibleTenants,
    roles,
    switchTenant: switchAuthoritativeTenant,
    loading: authLoading,
    error: authError,
  } = useAuth();

  const authoritativeTenantId =
    activeTenant?.tenantId || user?.tenantId || initialTenantId || 'central-metro-hospital';

  const [tenantId, setTenantId] = useState<string>(authoritativeTenantId);
  const [isSwitchingTenant, setIsSwitchingTenant] = useState(false);

  const roleMap: Record<string, UserRole> = {
    administrator: 'admin',
    admin: 'admin',
    doctor: 'doctor',
    physician: 'doctor',
    nurse: 'nurse',
    receptionist: 'reception',
    reception: 'reception',
    pharmacist: 'pharmacy',
    pharmacy: 'pharmacy',
    lab_tech: 'lab',
    lab: 'lab',
    billing_clerk: 'billing',
    billing_staff: 'billing',
    billing: 'billing',
  };

  const role = useMemo<UserRole>(() => {
    const canonicalRole = String(roles[0] || user?.roles?.[0] || '').toLowerCase();
    return roleMap[canonicalRole] || 'doctor';
  }, [roles, user?.roles]);

  const userTenants = useMemo<Tenant[]>(() => {
    if (!user) return [];

    return accessibleTenants.map((tenant) => {
      const known = DEFAULT_TENANTS.find((candidate) => candidate.id === tenant.tenantId);
      if (known) {
        return {
          ...known,
          name: tenant.name || known.name,
          facilityCode: tenant.facilityCode || known.facilityCode,
        };
      }

      return {
        id: tenant.tenantId,
        name: tenant.name || tenant.tenantId.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
        facilityCode: tenant.facilityCode || tenant.tenantId.substring(0, 4).toUpperCase(),
        brandColor: '#2563eb',
        secondaryColor: '#1d4ed8',
        activeStatus: 'active' as const,
        region: tenant.region || 'unknown',
        tier: (tenant.tier as Tenant['tier']) || 'enterprise',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    });
  }, [accessibleTenants, user]);

  useEffect(() => {
    const nextTenantId = activeTenant?.tenantId || user?.tenantId;
    if (!nextTenantId) {
      if (initialTenantId) setTenantId(initialTenantId);
      return;
    }

    setTenantId(nextTenantId);

    if (typeof window !== 'undefined') {
      localStorage.setItem('ghims_active_tenant_id', nextTenantId);
      document.cookie = `ghims_tenant_id=${nextTenantId}; path=/; max-age=31536000; SameSite=Lax`;
    }
  }, [activeTenant?.tenantId, user?.tenantId, initialTenantId]);

  const currentTenant = useMemo(() => {
    const authorized = userTenants.find((tenant) => tenant.id === tenantId);
    if (authorized) return authorized;

    const known = DEFAULT_TENANTS.find((tenant) => tenant.id === tenantId);
    if (known) return known;

    return {
      id: tenantId,
      name: tenantId.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      facilityCode: tenantId.substring(0, 4).toUpperCase(),
      brandColor: '#2563eb',
      secondaryColor: '#1d4ed8',
      activeStatus: 'active' as const,
      region: 'unknown',
      tier: 'enterprise' as const,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }, [tenantId, userTenants]);

  const switchTenant = useCallback(
    async (newTenantId: string) => {
      if (!user) {
        throw new Error('AUTHENTICATION_REQUIRED: establish a G-HIMS session before switching tenant.');
      }

      const normalizedTenantId = newTenantId.trim().toLowerCase();
      const authorized = accessibleTenants.some(
        (tenant) => tenant.tenantId.trim().toLowerCase() === normalizedTenantId
      );

      if (!authorized) {
        throw new Error('TENANT_ACCESS_DENIED: tenant is not present in the authenticated access list.');
      }

      setIsSwitchingTenant(true);
      try {
        // AuthClient.switchTenant performs the authoritative membership check,
        // creates the new server session and refreshes Firebase custom claims.
        await switchAuthoritativeTenant(normalizedTenantId);
      } finally {
        setIsSwitchingTenant(false);
      }
    },
    [user, accessibleTenants, switchAuthoritativeTenant]
  );

  return (
    <TenantContext.Provider
      value={{
        currentTenant,
        tenantId,
        role,
        userTenants,
        isLoading: authLoading || isSwitchingTenant,
        error: authError,
        switchTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    return {
      currentTenant: DEFAULT_TENANTS[0],
      tenantId: DEFAULT_TENANTS[0].id,
      role: 'doctor' as UserRole,
      userTenants: DEFAULT_TENANTS,
      isLoading: false,
      error: null,
      switchTenant: async () => {},
    };
  }
  return context;
}
