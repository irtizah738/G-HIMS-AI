'use client';

import { AuthClient } from '@/lib/auth/auth-client';

export interface TelehealthIceConfig {
  iceServers: RTCIceServer[];
  relayConfigured: boolean;
  credentialExpiresAt: number | null;
}

/** Ephemeral credentials are fetched only when a participant joins, never embedded in a static bundle. */
export async function loadTelehealthIceConfiguration(input: {
  tenantId: string;
  roomToken: string;
  role: 'CLINICIAN' | 'PATIENT';
}): Promise<TelehealthIceConfig> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(input),
  };
  const response = input.role === 'CLINICIAN'
    ? await AuthClient.authorizedFetch('/api/telehealth/ice-config', init, input.tenantId)
    : await fetch('/api/telehealth/ice-config', init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'TELEHEALTH_ICE_CONFIG_UNAVAILABLE'
    );
  }
  if (!data || !Array.isArray(data.iceServers) || typeof data.relayConfigured !== 'boolean') {
    throw new Error('TELEHEALTH_ICE_RESPONSE_INVALID');
  }
  // No credentials are logged, cached, serialized into patient links, or stored offline.
  return {
    iceServers: data.iceServers as RTCIceServer[],
    relayConfigured: data.relayConfigured,
    credentialExpiresAt: typeof data.credentialExpiresAt === 'number'
      ? data.credentialExpiresAt : null,
  };
}
