'use client';

import React from 'react';
import { AuthProvider as FirebaseAuthProvider } from '@/lib/firebase/auth-context';
import { AuthProvider as EnterpriseAuthProvider } from '@/lib/auth/auth-context';
import { RbacProvider } from '@/lib/auth/rbac-context';
import { HospitalProvider } from '@/lib/context/hospital-context';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <EnterpriseAuthProvider>
        <RbacProvider>
          <HospitalProvider>
            {children}
          </HospitalProvider>
        </RbacProvider>
      </EnterpriseAuthProvider>
    </FirebaseAuthProvider>
  );
}
