'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { RoleId, ResourceId, ActionId, RoleDefinition } from '@/types/rbac';
import { ROLE_DEFINITIONS, DEMO_PERSONAS, hasRbacPermission, canRoleAccessModule, normalizeRole } from '@/lib/auth/rbac';
import { useAuth as useFirebaseAuth } from '@/lib/firebase/auth-context';
import { useAuth as useEnterpriseAuth } from '@/lib/auth/auth-context';

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
  const { user: firebaseUser } = useFirebaseAuth();
  const enterpriseAuth = useEnterpriseAuth();
  
  const [currentRole, setCurrentRole] = useState<RoleId>('doctor');
  const [isRbacModalOpen, setIsRbacModalOpen] = useState<boolean>(false);
  const [activePatientId, setActivePatientId] = useState<string>('p-1001');

  // Initialize role from localStorage or enterprise auth on mount
  useEffect(() => {
    if (enterpriseAuth?.roles && enterpriseAuth.roles.length > 0) {
      const mappedRole = normalizeRole(enterpriseAuth.roles[0]);
      setCurrentRole(mappedRole);
      return;
    }

    if (typeof window !== 'undefined') {
      const savedRole = localStorage.getItem('ghims_active_rbac_role') as RoleId | null;
      if (savedRole && ROLE_DEFINITIONS[savedRole]) {
        setCurrentRole(savedRole);
      }
    }
  }, [enterpriseAuth?.roles]);

  // Synchronize when enterprise authenticated user changes
  useEffect(() => {
    if (enterpriseAuth?.user) {
      const userRole = enterpriseAuth.roles?.[0] || (enterpriseAuth.user.roles && enterpriseAuth.user.roles[0]) || 'doctor';
      const mapped = normalizeRole(userRole);
      setCurrentRole(mapped);
    }
  }, [enterpriseAuth?.user, enterpriseAuth?.roles]);

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
    const basePersona = DEMO_PERSONAS[currentRole] || DEMO_PERSONAS.doctor;
    
    // If enterprise user is signed in and role matches
    if (enterpriseAuth?.user && normalizeRole(enterpriseAuth.roles?.[0]) === currentRole) {
      return {
        ...basePersona,
        name: enterpriseAuth.user.displayName || basePersona.name,
        email: enterpriseAuth.user.email || basePersona.email,
        title: roleDefinition.displayName,
      };
    }

    // If Firebase SSO is signed in
    if (firebaseUser) {
      return {
        ...basePersona,
        name: firebaseUser.displayName || basePersona.name,
        email: firebaseUser.email || basePersona.email,
        title: roleDefinition.displayName,
      };
    }

    return basePersona;
  }, [currentRole, enterpriseAuth?.user, enterpriseAuth?.roles, firebaseUser, roleDefinition]);

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
