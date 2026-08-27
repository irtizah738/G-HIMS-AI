'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { RoleId, ResourceId, ActionId, RoleDefinition } from '@/types/rbac';
import { ROLE_DEFINITIONS, DEMO_PERSONAS, hasRbacPermission, canRoleAccessModule, normalizeRole } from '@/lib/auth/rbac';
import { useAuth } from '@/lib/firebase/auth-context';

interface RbacContextType {
  currentRole: RoleId;
  setRole: (role: RoleId) => void;
  roleDefinition: RoleDefinition;
  demoPersona: typeof DEMO_PERSONAS[RoleId];
  allRoles: RoleId[];
  hasPermission: (resource: ResourceId, action: ActionId, targetPatientId?: string) => boolean;
  canAccessModule: (moduleId: string) => boolean;
  isRbacModalOpen: boolean;
  setIsRbacModalOpen: (open: boolean) => void;
  activePatientId: string;
  setActivePatientId: (patientId: string) => void;
}

const RbacContext = createContext<RbacContextType | undefined>(undefined);

export function RbacProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [currentRole, setCurrentRole] = useState<RoleId>('doctor');
  const [isRbacModalOpen, setIsRbacModalOpen] = useState<boolean>(false);
  const [activePatientId, setActivePatientId] = useState<string>('p-1001');

  // Initialize role from localStorage or default
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRole = localStorage.getItem('ghims_active_rbac_role') as RoleId | null;
      if (savedRole && ROLE_DEFINITIONS[savedRole]) {
        setCurrentRole(savedRole);
      }
    }
  }, []);

  const setRole = useCallback((newRole: RoleId) => {
    setCurrentRole(newRole);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ghims_active_rbac_role', newRole);
    }
  }, []);

  const roleDefinition = useMemo(() => {
    return ROLE_DEFINITIONS[currentRole] || ROLE_DEFINITIONS.doctor;
  }, [currentRole]);

  const demoPersona = useMemo(() => {
    return DEMO_PERSONAS[currentRole] || DEMO_PERSONAS.doctor;
  }, [currentRole]);

  const allRoles = useMemo(() => {
    return Object.keys(ROLE_DEFINITIONS) as RoleId[];
  }, []);

  const hasPermission = useCallback(
    (resource: ResourceId, action: ActionId, targetPatientId?: string) => {
      return hasRbacPermission(currentRole, resource, action, {
        role: currentRole,
        targetPatientId,
        userPatientId: activePatientId,
      });
    },
    [currentRole, activePatientId]
  );

  const canAccessModule = useCallback(
    (moduleId: string) => {
      return canRoleAccessModule(currentRole, moduleId);
    },
    [currentRole]
  );

  return (
    <RbacContext.Provider
      value={{
        currentRole,
        setRole,
        roleDefinition,
        demoPersona,
        allRoles,
        hasPermission,
        canAccessModule,
        isRbacModalOpen,
        setIsRbacModalOpen,
        activePatientId,
        setActivePatientId,
      }}
    >
      {children}
    </RbacContext.Provider>
  );
}

export function useRBAC() {
  const context = useContext(RbacContext);
  if (!context) {
    throw new Error('useRBAC must be used within an RbacProvider');
  }
  return context;
}
