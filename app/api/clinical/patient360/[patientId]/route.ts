import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { assertPatient360ReadAccess } from '@/lib/clinical/patient360/patient360-access';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';

interface RouteContext {
  params: Promise<{ patientId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { patientId } = await params;
    const normalizedPatientId = String(patientId || '').trim();
    if (!normalizedPatientId) {
      return NextResponse.json(
        { success: false, error: 'patientId is required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    assertPatient360ReadAccess(context);
    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      normalizedPatientId
    );

    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'PATIENT_NOT_FOUND' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const timelineLimit = Math.max(
      1,
      Math.min(500, Number(req.nextUrl.searchParams.get('timelineLimit') || 200))
    );

    const { projection, timeline } =
      await Patient360ProjectionService.readClinicalView(
        context.tenantId,
        normalizedPatientId,
        timelineLimit
      );

    if (!projection) {
      return NextResponse.json(
        {
          success: false,
          error: 'PATIENT360_PROJECTION_NOT_READY',
          patientId: normalizedPatientId,
        },
        {
          status: 409,
          headers: {
            'Cache-Control': 'no-store',
            'X-GHIMS-Patient360-Status': 'NOT_READY',
          },
        }
      );
    }

    const dischargeReadiness =
      await DischargeReadinessService.getForPatient(
        context.tenantId,
        normalizedPatientId
      );

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        patientId: normalizedPatientId,
        projection,
        timeline,
        dischargeReadiness,
        freshness: {
          projectionVersion: projection.projectionVersion,
          revision: projection.revision,
          projectedAt: projection.projectedAt,
          sourceCheckpoint: projection.sourceCheckpoint,
          lastEventId: projection.lastEventId,
          lastEventRecordedAt: projection.lastEventRecordedAt,
          contentHash: projection.contentHash,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-GHIMS-Patient360-Revision': String(projection.revision),
          'X-GHIMS-Patient360-Projection-Version': String(
            projection.projectionVersion
          ),
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Patient 360 read failed';

    const unauthorized =
      /AUTH|TENANT|SESSION|ACCOUNT|DEVICE/i.test(message);

    return NextResponse.json(
      { success: false, error: message },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
