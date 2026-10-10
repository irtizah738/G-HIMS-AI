import { NextRequest, NextResponse } from 'next/server';
import { assertTelehealthPatientJoinToken } from '@/lib/backend/security/telehealth-patient-capability';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { buildTelehealthIceConfiguration } from '@/lib/backend/services/telehealth-ice-configuration';
import type { TelehealthSession } from '@/lib/types/ghims';

export const dynamic = 'force-dynamic';
const ROOM_TOKEN = /^ROOM-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const NO_CACHE = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' };

function reject(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_CACHE });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reject('TELEHEALTH_ICE_REQUEST_INVALID', 400);
    }
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim().toLowerCase() : '';
    const roomToken = typeof body.roomToken === 'string' ? body.roomToken.trim() : '';
    const patientJoinToken = typeof body.patientJoinToken === 'string' ? body.patientJoinToken.trim() : '';
    const role = body.role;
    if (!/^[a-z0-9_-]{3,128}$/.test(tenantId) || !ROOM_TOKEN.test(roomToken) ||
        (role !== 'CLINICIAN' && role !== 'PATIENT')) {
      return reject('TELEHEALTH_ICE_REQUEST_INVALID', 400);
    }
    const restrictedTenant = String(process.env.GHIMS_HOSPITAL0_TENANT_ID || '').trim().toLowerCase();
    if (restrictedTenant && restrictedTenant !== tenantId) {
      return reject('TELEHEALTH_TENANT_ACCESS_DENIED', 403);
    }
    const db = getAdminFirestore();
    if (!db) return reject('TELEHEALTH_ICE_STORE_UNAVAILABLE', 503);
    const tenant = db.collection('tenants').doc(tenantId);
    const sessions = await tenant.collection('telehealthSessions')
      .where('roomToken', '==', roomToken).limit(2).get();
    if (sessions.size !== 1) return reject('TELEHEALTH_SESSION_NOT_FOUND_OR_AMBIGUOUS', 404);
    const session = sessions.docs[0].data() as TelehealthSession;
    if (!session.id || !session.encounterId || !session.patientId ||
        (session.tenantId && session.tenantId !== tenantId) ||
        ['CANCELLED', 'COMPLETED'].includes(session.status)) {
      return reject('TELEHEALTH_SESSION_NOT_ACTIVE', 409);
    }
    const encounter = await tenant.collection('encounters').doc(session.encounterId).get();
    if (!encounter.exists || encounter.data()?.patientId !== session.patientId ||
        String(encounter.data()?.encounterType || encounter.data()?.type || '').toUpperCase() !== 'TELEHEALTH') {
      return reject('TELEHEALTH_ENCOUNTER_SCOPE_INVALID', 409);
    }
    const room = await tenant.collection('telehealthSignaling').doc(roomToken).get();
    const data = room.data();
    if (!room.exists || data?.active !== true ||
        !Number.isFinite(data?.expiresAt) || data.expiresAt <= Date.now() ||
        data.sessionId !== session.id || data.encounterId !== session.encounterId ||
        data.patientId !== session.patientId || data.roomToken !== roomToken) {
      return reject('TELEHEALTH_CALL_NOT_ACTIVE', 403);
    }
    if (role === 'CLINICIAN') {
      const { context } = await deriveAuthoritativeContext(req, tenantId);
      if (!context.roles.some(r => ['DOCTOR', 'CONSULTANT'].includes(String(r).toUpperCase())) ||
          !context.clinicalPrivileges?.some(p =>
            ['SIGN_CLINICAL_NOTES', 'UNRESTRICTED_CLINICAL_CHIEF'].includes(String(p).toUpperCase()))) {
        return reject('TELEHEALTH_CLINICIAN_AUTHORITY_REQUIRED', 403);
      }
      const assignedProvider = String(encounter.data()?.assignedProviderId || '');
      if (!assignedProvider || assignedProvider !== context.actorId ||
          !context.facilityIds?.includes(String(encounter.data()?.facilityId || ''))) {
        return reject('TELEHEALTH_CLINICIAN_ASSIGNMENT_MISMATCH', 403);
      }
    } else {
      // Room ID alone is not a patient capability; never issue TURN without the 256-bit join token.
      assertTelehealthPatientJoinToken(patientJoinToken, data.patientJoinTokenHash);
    }
    const configuration = buildTelehealthIceConfiguration(roomToken);
    return NextResponse.json(configuration, { headers: NO_CACHE });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TELEHEALTH_ICE_CONFIG_UNAVAILABLE';
    // Never echo provider secrets or raw untrusted values to callers.
    if (code.startsWith('TELEHEALTH_ICE_CONFIG_INVALID') ||
        code === 'TELEHEALTH_TURN_SECRET_NOT_CONFIGURED') {
      return reject('TELEHEALTH_ICE_INFRASTRUCTURE_MISCONFIGURED', 503);
    }
    return reject('TELEHEALTH_ICE_AUTHORIZATION_FAILED', 403);
  }
}
