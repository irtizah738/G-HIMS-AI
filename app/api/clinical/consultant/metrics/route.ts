import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { ConsultantBlindnessMetricsService } from '@/lib/clinical/intelligence/consultant-blindness-metrics-service';

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();
    const scope = String(req.nextUrl.searchParams.get('scope') || 'actor')
      .trim()
      .toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    const metrics =
      scope === 'tenant'
        ? await ConsultantBlindnessMetricsService.forTenant(context)
        : await ConsultantBlindnessMetricsService.forActor(context);

    return NextResponse.json(
      { success: true, metrics },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'CONSULTANT_BLINDNESS_METRICS_FAILED';
    const unauthorized = /UNAUTHORIZED|AUTHORIZATION|UNAUTHENTICATED/.test(message);
    return NextResponse.json(
      { success: false, error: message },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
