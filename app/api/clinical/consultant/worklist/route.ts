import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { ConsultantAttentionProjectionService } from '@/lib/clinical/intelligence/consultant-attention-projection-service';

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();

    const { context } = await deriveAuthoritativeContext(
      req,
      requestedTenantId
    );
    const worklist =
      await ConsultantAttentionProjectionService.getWorklist(context);

    return NextResponse.json(
      {
        success: true,
        worklist,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'CONSULTANT_WORKLIST_FAILED';
    const unauthorized =
      message.includes('UNAUTHORIZED') ||
      message.includes('AUTHORIZATION') ||
      message.includes('UNAUTHENTICATED');

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
