import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { ConsultantDirectoryService } from '@/lib/clinical/intelligence/consultant-directory-service';

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.reason || 'Consultant directory access denied.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const departmentId = String(req.nextUrl.searchParams.get('departmentId') || '').trim();
    const specialty = String(req.nextUrl.searchParams.get('specialty') || '').trim();
    const consultants = await ConsultantDirectoryService.listEligible(context, {
      departmentId: departmentId || undefined,
      specialty: specialty || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        generatedAt: Date.now(),
        consultants,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Consultant directory read failed.';
    const unauthorized = /AUTH|TENANT|SESSION|ACCOUNT|DEVICE/i.test(message);
    return NextResponse.json(
      { success: false, error: message },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
