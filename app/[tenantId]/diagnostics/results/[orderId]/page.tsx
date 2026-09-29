import React from 'react';
import { DiagnosticResultView } from '@/components/diagnostics/DiagnosticResultView';

interface PageProps {
  params: Promise<{
    tenantId: string;
    orderId: string;
  }>;
}

export default async function DiagnosticsResultPage({ params }: PageProps) {
  const { tenantId, orderId } = await params;
  return <DiagnosticResultView tenantId={tenantId} orderId={orderId} />;
}
