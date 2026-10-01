'use client';

import React from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { SurgicalOperationsConsole } from '@/components/clinical/surgical-operations-console';

export function SurgeryTheaterView() {
  const { activeTenant } = useAuth();

  if (!activeTenant?.tenantId) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-sm text-slate-500">
        An active authenticated hospital tenant is required to open surgical operations.
      </div>
    );
  }

  return (
    <SurgicalOperationsConsole
      tenantId={activeTenant.tenantId}
      mode="LIST"
    />
  );
}
