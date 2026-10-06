import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { OpdAppointmentDomainService } from '@/lib/backend/services/opd-appointment-domain-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();
    const facilityId = String(
      req.nextUrl.searchParams.get('facilityId') || ''
    ).trim();
    const departmentId = String(
      req.nextUrl.searchParams.get('departmentId') || ''
    ).trim();
    const date = String(req.nextUrl.searchParams.get('date') || '').trim();
    const timeZone = String(
      req.nextUrl.searchParams.get('timeZone') || ''
    ).trim();
    const durationMinutes = Number(
      req.nextUrl.searchParams.get('durationMinutes') || 20
    );

    if (
      !requestedTenantId ||
      !facilityId ||
      !departmentId ||
      !date ||
      !timeZone
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'OPD_AVAILABILITY_QUERY_REQUIRED',
            message:
              'tenantId, facilityId, departmentId, date and timeZone are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { context } = await deriveAuthoritativeContext(
      req,
      requestedTenantId
    );
    const availability =
      await OpdAppointmentDomainService.listAvailability(context, {
        facilityId,
        departmentId,
        date,
        timeZone,
        durationMinutes,
      });

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        ...availability,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    const candidate = error as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    const message =
      candidate?.message || 'Unable to resolve OPD provider availability.';
    const unauthorized = /AUTH|ROLE|TENANT|SESSION|ACCOUNT|SCOPE/i.test(
      `${candidate?.code || ''} ${message}`
    );

    return NextResponse.json(
      {
        success: false,
        error: {
          code:
            candidate?.code ||
            (unauthorized
              ? 'OPD_AVAILABILITY_UNAUTHORIZED'
              : 'OPD_AVAILABILITY_FAILED'),
          message,
          details: candidate?.details,
        },
      },
      {
        status: unauthorized ? 403 : 400,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
