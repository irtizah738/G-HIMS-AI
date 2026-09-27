import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { isDemoRuntime } from '@/lib/runtime/runtime-mode';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const isAdmin = context.roles.some((role) =>
      ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMINISTRATOR', 'HOSPITAL_ADMIN'].includes(role)
    );

    if (!isAdmin) {
      return NextResponse.json({ error: 'Administrator role required.' }, { status: 403 });
    }

    if (!isDemoRuntime()) {
      return NextResponse.json(
        {
          success: false,
          code: 'NOTIFICATION_TEST_DISABLED',
          error: 'Synthetic notification dispatch is disabled outside DEMO runtime.',
        },
        { status: 501 }
      );
    }

    return NextResponse.json({
      success: true,
      simulated: true,
      tenantId,
      message: 'Demo notification test completed. No external message was sent.',
      dispatchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notification test failed';
    return NextResponse.json({ success: false, error: message }, { status: 403 });
  }
}
