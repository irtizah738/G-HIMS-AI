'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { SurgicalOperationsConsole } from '@/components/clinical/surgical-operations-console';

export default function SurgicalCasePage() {
  const params = useParams();
  const tenantId = String(params?.tenantId || '');
  const caseId = String(params?.caseId || '');
  return (
    <div className="p-4 md:p-6">
      <SurgicalOperationsConsole tenantId={tenantId} caseId={caseId} mode="CASE" />
    </div>
  );
}
