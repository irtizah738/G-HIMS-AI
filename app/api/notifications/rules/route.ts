import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_NOTIFICATION_RULES } from '@/lib/notifications/notification-service';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

function canAdmin(roles: string[]): boolean {
  return roles.some((role) => ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMINISTRATOR', 'HOSPITAL_ADMIN'].includes(role));
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    await deriveAuthoritativeContext(req, tenantId);

    return NextResponse.json({
      success: true,
      tenantId,
      rules: DEFAULT_NOTIFICATION_RULES.map((rule) => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        channel: rule.channel,
        tenantId,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rules';
    return NextResponse.json({ success: false, error: message }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!canAdmin(context.roles)) {
      return NextResponse.json({ error: 'Administrator role required.' }, { status: 403 });
    }

    // Persistence is intentionally deferred to a server-owned configuration service.
    return NextResponse.json(
      { success: false, code: 'CONFIG_PERSISTENCE_NOT_IMPLEMENTED', error: 'Notification rule mutation is disabled until server-side configuration persistence is implemented.' },
      { status: 501 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save rule';
    return NextResponse.json({ success: false, error: message }, { status: 403 });
  }
}
