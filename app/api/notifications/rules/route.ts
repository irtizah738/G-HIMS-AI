import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_NOTIFICATION_RULES } from '@/lib/notifications/notification-service';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || 'central-metro-hospital';

    return NextResponse.json({
      success: true,
      tenantId,
      rules: DEFAULT_NOTIFICATION_RULES.map((r) => ({ ...r, tenantId })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch rules' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, rule } = body;

    return NextResponse.json({
      success: true,
      tenantId: tenantId || 'central-metro-hospital',
      rule: {
        ...rule,
        id: rule.id || `rule_${Date.now()}`,
        updatedAt: new Date().toISOString(),
      },
      message: 'Notification rule successfully updated.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save rule' },
      { status: 500 }
    );
  }
}
