import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { logAuthEvent } from '@/server/auth/audit-service';

const ELIGIBLE_ROLES = new Set(['DOCTOR', 'CONSULTANT', 'MEDICAL_DIRECTOR', 'ATTENDING_PHYSICIAN']);

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const reason = String(body.reason || '').trim();
    const patientId = String(body.patientId || '').trim();
    const encounterId = String(body.encounterId || '').trim();

    if (!tenantId || !patientId || !encounterId) {
      return NextResponse.json(
        { error: 'tenantId, patientId and encounterId are required.' },
        { status: 400 }
      );
    }

    if (reason.length < 10) {
      return NextResponse.json(
        { error: 'Emergency Break-Glass requires a clinical justification of at least 10 characters.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!context.roles.some((role) => ELIGIBLE_ROLES.has(role))) {
      return NextResponse.json(
        { error: 'Clinical role is not eligible for emergency Break-Glass.' },
        { status: 403 }
      );
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ error: 'Security store unavailable.' }, { status: 503 });
    }

    const grantId = `bg_${crypto.randomUUID()}`;
    const now = Date.now();
    const expiresAt = now + 15 * 60 * 1000;

    await db.collection('tenants').doc(context.tenantId).collection('break_glass_grants').doc(grantId).set({
      grantId,
      tenantId: context.tenantId,
      userId: context.actorId,
      patientId,
      encounterId,
      reason,
      scope: ['EMERGENCY_CLINICAL_OVERRIDE'],
      status: 'ACTIVE',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    });

    await logAuthEvent({
      eventType: 'BREAK_GLASS_ELEVATED',
      tenantId: context.tenantId,
      userId: context.actorId,
      ip: clientIp,
      userAgent,
      reason,
      metadata: { grantId, patientId, encounterId, expiresAt },
    });

    return NextResponse.json({
      success: true,
      grantId,
      patientId,
      encounterId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to trigger emergency Break-Glass';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json({ error: message }, { status: unauthorized ? 403 : 500 });
  }
}
