'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TelehealthPatientJoin } from '@/components/telehealth/TelehealthPatientJoin';

function JoinContent() {
  const searchParams = useSearchParams();
  const tenantId = String(searchParams.get('tenant') || '').trim().toLowerCase();
  const roomToken = String(searchParams.get('room') || '').trim();

  if (!tenantId || !roomToken) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-lg font-black">Invalid telehealth join link</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ask the clinical team to send a fresh G-HIMS telehealth link.
        </p>
      </div>
    );
  }

  return <TelehealthPatientJoin tenantId={tenantId} roomToken={roomToken} />;
}

export default function TelehealthJoinPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm">Preparing telehealth visit…</div>}>
      <JoinContent />
    </Suspense>
  );
}
