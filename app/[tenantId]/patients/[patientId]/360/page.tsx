import React from 'react';
import { Patient360View } from '@/components/patient360/Patient360View';

interface PageProps {
  params: Promise<{
    tenantId: string;
    patientId: string;
  }>;
}

export default async function Patient360Page({ params }: PageProps) {
  const { tenantId, patientId } = await params;
  return <Patient360View tenantId={tenantId} patientId={patientId} />;
}
