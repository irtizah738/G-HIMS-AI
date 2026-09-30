import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { assertPatient360ReadAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalDeteriorationService } from '@/lib/clinical/intelligence/clinical-deterioration-service';

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const { context } = await deriveAuthoritativeContext(
      req,
      requestedTenantId
    );
    assertPatient360ReadAccess(context);

    const projections =
      await ClinicalDeteriorationService.listActiveForTenant(
        context.tenantId
      );

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        projections,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Active deterioration intelligence could not be loaded.';
    const unauthorized =
      /AUTH|TENANT|SESSION|ACCOUNT|DEVICE/i.test(message);

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
