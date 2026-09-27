import { NextRequest, NextResponse } from 'next/server';
import { isDemoRuntime } from '@/lib/runtime/runtime-mode';

function unavailable() {
  return NextResponse.json(
    {
      success: false,
      code: 'SSO_CONFIG_ERROR',
      error: 'Enterprise SSO configuration is disabled until a verified OIDC/SAML implementation is installed.',
    },
    { status: 501 }
  );
}

export async function GET(req: NextRequest) {
  if (!isDemoRuntime()) return unavailable();
  const tenantId = req.nextUrl.searchParams.get('tenantId') || 'demo-hospital';
  return NextResponse.json({
    success: true,
    tenantId,
    config: { providerType: 'DEMO', enabled: true },
  });
}

export async function POST() {
  if (!isDemoRuntime()) return unavailable();
  return NextResponse.json({
    success: true,
    message: 'Demo SSO configuration accepted in DEMO runtime only.',
  });
}
