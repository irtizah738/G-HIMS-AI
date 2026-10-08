import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import type { TelehealthSession } from '@/lib/types/ghims';

const CALL_LEASE_MS = 2 * 60 * 60 * 1000;
const MAX_SIGNAL_PAYLOAD_BYTES = 256_000;

type SignalRole = 'CLINICIAN' | 'PATIENT';
type SignalType = 'START' | 'OFFER' | 'ANSWER' | 'ICE' | 'LEAVE';

function clean(value: unknown): string {
  return String(value || '').trim();
}

function hospital0Tenant(): string {
  return clean(process.env.GHIMS_HOSPITAL0_TENANT_ID).toLowerCase();
}

function assertTenant(tenantId: string): void {
  const configured = hospital0Tenant();
  if (configured && tenantId !== configured) {
    throw new Error('TELEHEALTH_TENANT_ACCESS_DENIED');
  }
}

function assertRoomToken(roomToken: string): void {
  // New governed media rooms use a full UUID-backed token. Short historical
  // demo tokens are intentionally not accepted as patient join capabilities.
  if (!roomToken.startsWith('ROOM-') || roomToken.length < 35) {
    throw new Error('TELEHEALTH_MEDIA_ROOM_TOKEN_INVALID');
  }
}

async function findSession(
  tenantId: string,
  roomToken: string
): Promise<TelehealthSession | null> {
  const db = getAdminFirestore();
  if (!db) throw new Error('TELEHEALTH_SIGNALING_STORE_UNAVAILABLE');

  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('telehealthSessions')
    .where('roomToken', '==', roomToken)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as TelehealthSession;
}

async function authorizeClinician(
  req: NextRequest,
  tenantId: string,
  session: TelehealthSession
): Promise<string> {
  const { context } = await deriveAuthoritativeContext(req, tenantId);
  const clinicalRole = context.roles.some((role) =>
    ['DOCTOR', 'CONSULTANT', 'NURSE', 'SYSTEM_ADMIN'].includes(
      String(role || '').toUpperCase()
    )
  );
  if (!clinicalRole) throw new Error('TELEHEALTH_CLINICIAN_AUTHORITY_REQUIRED');

  const db = getAdminFirestore();
  if (!db) throw new Error('TELEHEALTH_SIGNALING_STORE_UNAVAILABLE');
  const encounter = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('encounters')
    .doc(session.encounterId)
    .get();

  if (!encounter.exists) throw new Error('TELEHEALTH_ENCOUNTER_NOT_FOUND');
  const assignedProviderId = clean(encounter.data()?.assignedProviderId);
  if (
    assignedProviderId &&
    assignedProviderId !== context.actorId &&
    !context.roles.includes('SYSTEM_ADMIN')
  ) {
    throw new Error('TELEHEALTH_CLINICIAN_ASSIGNMENT_MISMATCH');
  }
  return context.actorId;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'TELEHEALTH_SIGNALING_ERROR';
  const status =
    message.includes('AUTH') ||
    message.includes('ACCESS_DENIED') ||
    message.includes('ASSIGNMENT_MISMATCH')
      ? 403
      : message.includes('NOT_FOUND')
        ? 404
        : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = clean(body.tenantId).toLowerCase();
    const roomToken = clean(body.roomToken);
    const senderRole = clean(body.senderRole).toUpperCase() as SignalRole;
    const type = clean(body.type).toUpperCase() as SignalType;
    const payload = body.payload ?? null;

    if (!tenantId || !roomToken || !['CLINICIAN', 'PATIENT'].includes(senderRole)) {
      throw new Error('TELEHEALTH_SIGNALING_REQUEST_INVALID');
    }
    if (!['START', 'OFFER', 'ANSWER', 'ICE', 'LEAVE'].includes(type)) {
      throw new Error('TELEHEALTH_SIGNAL_TYPE_INVALID');
    }
    assertTenant(tenantId);
    assertRoomToken(roomToken);

    const session = await findSession(tenantId, roomToken);
    if (!session) throw new Error('TELEHEALTH_SESSION_NOT_FOUND');
    if (['COMPLETED', 'CANCELLED'].includes(session.status)) {
      throw new Error('TELEHEALTH_SESSION_FINAL');
    }

    const serializedPayload = JSON.stringify(payload);
    if (Buffer.byteLength(serializedPayload, 'utf8') > MAX_SIGNAL_PAYLOAD_BYTES) {
      throw new Error('TELEHEALTH_SIGNAL_PAYLOAD_TOO_LARGE');
    }

    const db = getAdminFirestore();
    if (!db) throw new Error('TELEHEALTH_SIGNALING_STORE_UNAVAILABLE');
    const roomRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('telehealthSignaling')
      .doc(roomToken);
    const now = Date.now();
    const roomSnapshot = await roomRef.get();
    const room = roomSnapshot.data() as
      | { active?: boolean; expiresAt?: number; clinicianId?: string }
      | undefined;

    let senderId = 'PATIENT_CAPABILITY';
    if (senderRole === 'CLINICIAN') {
      senderId = await authorizeClinician(req, tenantId, session);
      if (type === 'START') {
        await roomRef.set(
          {
            roomToken,
            sessionId: session.id,
            encounterId: session.encounterId,
            patientId: session.patientId,
            active: true,
            clinicianId: senderId,
            startedAt: now,
            expiresAt: now + CALL_LEASE_MS,
            updatedAt: now,
          },
          { merge: true }
        );
        return NextResponse.json({
          ok: true,
          expiresAt: now + CALL_LEASE_MS,
        });
      }
    } else {
      if (
        !room?.active ||
        !room.expiresAt ||
        room.expiresAt <= now
      ) {
        throw new Error('TELEHEALTH_CALL_NOT_ACTIVE');
      }
    }

    if (senderRole === 'CLINICIAN' && type !== 'START') {
      if (!room?.active || !room.expiresAt || room.expiresAt <= now) {
        throw new Error('TELEHEALTH_CALL_NOT_ACTIVE');
      }
    }

    if (type === 'LEAVE') {
      if (senderRole === 'CLINICIAN') {
        await roomRef.set(
          { active: false, endedAt: now, updatedAt: now },
          { merge: true }
        );
      }
    }

    const messageRef = roomRef.collection('messages').doc();
    await messageRef.set({
      messageId: messageRef.id,
      senderRole,
      senderId,
      type,
      payload,
      createdAt: now,
      expiresAt: Math.min(room?.expiresAt || now + CALL_LEASE_MS, now + CALL_LEASE_MS),
    });

    return NextResponse.json({ ok: true, messageId: messageRef.id, createdAt: now });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = clean(req.nextUrl.searchParams.get('tenantId')).toLowerCase();
    const roomToken = clean(req.nextUrl.searchParams.get('roomToken'));
    const receiverRole = clean(
      req.nextUrl.searchParams.get('receiverRole')
    ).toUpperCase() as SignalRole;
    const after = Math.max(
      0,
      Number(req.nextUrl.searchParams.get('after') || 0) || 0
    );

    if (!tenantId || !roomToken || !['CLINICIAN', 'PATIENT'].includes(receiverRole)) {
      throw new Error('TELEHEALTH_SIGNALING_REQUEST_INVALID');
    }
    assertTenant(tenantId);
    assertRoomToken(roomToken);

    const session = await findSession(tenantId, roomToken);
    if (!session) throw new Error('TELEHEALTH_SESSION_NOT_FOUND');
    if (['COMPLETED', 'CANCELLED'].includes(session.status)) {
      throw new Error('TELEHEALTH_SESSION_FINAL');
    }

    const db = getAdminFirestore();
    if (!db) throw new Error('TELEHEALTH_SIGNALING_STORE_UNAVAILABLE');
    const roomRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('telehealthSignaling')
      .doc(roomToken);
    const roomSnapshot = await roomRef.get();
    const room = roomSnapshot.data() as
      | { active?: boolean; expiresAt?: number }
      | undefined;
    const now = Date.now();

    if (!room?.active || !room.expiresAt || room.expiresAt <= now) {
      throw new Error('TELEHEALTH_CALL_NOT_ACTIVE');
    }

    if (receiverRole === 'CLINICIAN') {
      await authorizeClinician(req, tenantId, session);
    }

    const messages = await roomRef
      .collection('messages')
      .where('createdAt', '>', after)
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();

    return NextResponse.json({
      active: true,
      expiresAt: room.expiresAt,
      messages: messages.docs
        .map((doc) => doc.data())
        .filter((message) => message.senderRole !== receiverRole)
        .map((message) => ({
          messageId: message.messageId,
          type: message.type,
          payload: message.payload,
          createdAt: message.createdAt,
        })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
