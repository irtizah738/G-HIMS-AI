import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_SSO_CONFIG } from '@/lib/auth/sso-service';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || 'central-metro-hospital';

    return NextResponse.json({
      success: true,
      tenantId,
      config: { ...DEFAULT_SSO_CONFIG, tenantId },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch SSO config' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, config } = body;

    return NextResponse.json({
      success: true,
      tenantId: tenantId || 'central-metro-hospital',
      config: {
        ...config,
        updatedAt: new Date().toISOString(),
      },
      message: 'SSO provider configuration updated successfully.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update SSO config' },
      { status: 500 }
    );
  }
}
