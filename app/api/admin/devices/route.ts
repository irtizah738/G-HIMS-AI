import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { revokeDevice } from '@/server/auth/device-service';
import { logAuthEvent } from '@/server/auth/audit-service';

const DEVICE_ADMIN_ROLES = new Set([
  'ADMIN',
  'ADMINISTRATOR',
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
]);

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const deviceId = String(body.deviceId || '').trim();
    const reason = String(body.reason || '').trim();

    if (!tenantId || !deviceId || reason.length < 8) {
      return NextResponse.json(
        { error: 'tenantId, deviceId and a substantive revocation reason are required.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!context.roles.some((role) => DEVICE_ADMIN_ROLES.has(role))) {
      return NextResponse.json({ error: 'IAM_ADMIN_REQUIRED' }, { status: 403 });
    }

    await revokeDevice(tenantId, deviceId, context.actorId, reason);
    await logAuthEvent({
      eventType: 'SESSION_REVOKED',
      tenantId,
      userId: context.actorId,
      deviceId,
      reason,
      metadata: { action: 'DEVICE_REVOKED' },
    });

    return NextResponse.json({ success: true, tenantId, deviceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Device revocation failed';
    return NextResponse.json(
      { error: message },
      { status: /AUTH|TENANT|SESSION|DEVICE_REVOKED/i.test(message) ? 403 : 500 }
    );
  }
}
