'use client';

import React, { useEffect, useState } from 'react';
import { TelehealthPatientJoin } from '@/components/telehealth/TelehealthPatientJoin';

type Invitation = { tenantId: string; roomToken: string; patientJoinToken: string };

export default function TelehealthJoinPage() {
  const [invitation, setInvitation] = useState<Invitation | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const patientJoinToken = String(fragment.get('join') || url.searchParams.get('join') || '').trim();
    const tenantId = String(url.searchParams.get('tenant') || '').trim().toLowerCase();
    const roomToken = String(url.searchParams.get('room') || '').trim();

    // Retain the invitation only in memory during this browser visit.
    window.history.replaceState(window.history.state, '', url.pathname);
    setInvitation({ tenantId, roomToken, patientJoinToken });
  }, []);

  if (!invitation) {
    return <div className="p-8 text-center text-sm">Preparing telehealth visit…</div>;
  }
  if (!invitation.tenantId || !invitation.roomToken || !invitation.patientJoinToken) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-lg font-black">Invalid telehealth join link</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ask the clinical team to send a fresh G-HIMS telehealth link.
        </p>
      </div>
    );
  }
  return <TelehealthPatientJoin {...invitation} />;
}
