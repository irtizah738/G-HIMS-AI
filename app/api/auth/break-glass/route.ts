import { NextRequest, NextResponse } from 'next/server';
import { logAuthEvent } from '@/server/auth/audit-service';
import { AuthError } from '@/lib/auth/auth-errors';

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const body = await req.json().catch(() => ({}));
    const { userId, tenantId, reason, patientId, encounterId } = body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return NextResponse.json(
        { error: 'Emergency Break-Glass access elevation requires a clinical justification reason (min 5 chars)' },
        { status: 400 }
      );
    }

    await logAuthEvent({
      eventType: 'BREAK_GLASS_ELEVATED',
      tenantId: tenantId || 'central-metro-hospital',
      userId: userId || 'anonymous',
      ip: clientIp,
      userAgent,
      reason: reason.trim(),
      metadata: {
        patientId,
        encounterId,
        elevationLevel: 'EMERGENCY_CLINICAL_OVERRIDE',
      },
    });

    return NextResponse.json({
      success: true,
      elevated: true,
      message: 'Emergency Break-Glass clinical privileges elevated successfully.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to trigger emergency break-glass' },
      { status: 500 }
    );
  }
}
