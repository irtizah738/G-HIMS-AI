'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SurgicalOperationsConsole } from '@/components/clinical/surgical-operations-console';

export default function SurgicalCasesPage() {
  const params = useParams();
  const tenantId = String(params?.tenantId || '');
  return (
    <div className="p-4 md:p-6">
      <SurgicalOperationsConsole tenantId={tenantId} mode="LIST" />
    </div>
  );
}
