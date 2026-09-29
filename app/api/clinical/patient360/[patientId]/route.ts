import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth/auth-errors';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { assertPatient360ReadAccess } from '@/lib/clinical/patient360/patient360-access';
import { Patient360ReadService } from '@/lib/clinical/patient360/patient360-read-service';

interface RouteContext {
  params: Promise<{ patientId: string }>;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.userMessage,
        },
      },
      {
        status: error.statusCode,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message === 'PATIENT360_PATIENT_NOT_FOUND') {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'PATIENT360_PATIENT_NOT_FOUND',
          message: 'Patient not found in the authenticated hospital tenant.',
        },
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (message.startsWith('PATIENT360_PATIENT_MERGED:')) {
    const canonicalPatientId = message.split(':').slice(1).join(':');
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'PATIENT360_PATIENT_MERGED',
          message: 'This patient record has been merged. Open the authoritative patient record.',
          ...(canonicalPatientId && canonicalPatientId !== 'UNKNOWN'
            ? { canonicalPatientId }
            : {}),
        },
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (message === 'PATIENT360_PROJECTION_NOT_READY') {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'PATIENT360_PROJECTION_NOT_READY',
          message: 'Patient 360 is still building from authoritative clinical events.',
        },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': '2',
        },
      }
    );
  }

  const unavailable =
    message === 'PATIENT360_READ_STORE_UNAVAILABLE' ||
    message === 'PATIENT360_PROJECTION_STORE_UNAVAILABLE';

  return NextResponse.json(
    {
      success: false,
      error: {
        code: unavailable
          ? 'PATIENT360_SERVICE_UNAVAILABLE'
          : 'PATIENT360_READ_FAILED',
        message: unavailable
          ? 'Patient 360 is temporarily unavailable.'
          : 'Unable to read Patient 360.',
      },
    },
    {
      status: unavailable ? 503 : 500,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { patientId } = await params;
    const normalizedPatientId = String(patientId || '').trim();
    if (!normalizedPatientId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PATIENT360_PATIENT_ID_REQUIRED',
            message: 'patientId is required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { context } = await deriveAuthoritativeContext(req);
    assertPatient360ReadAccess(context);

    const result = await Patient360ReadService.getProjection(
      context.tenantId,
      normalizedPatientId
    );

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-GHIMS-Patient360-Version': String(result.projection.projectionVersion),
        'X-GHIMS-Patient360-Revision': String(result.projection.revision),
        'X-GHIMS-Patient360-Freshness': result.freshness.status,
        'X-GHIMS-Patient360-Checkpoint': result.projection.sourceCheckpoint,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
