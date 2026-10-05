import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(
      body?.tenantId ||
        req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();

    const { context } = await deriveAuthoritativeContext(
      req,
      tenantId || undefined
    );
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'PRESCRIBE',
    });
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: auth.code || 'UNAUTHORIZED',
            message:
              auth.reason ||
              'Active credentialed prescribing authority is required.',
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patientId = String(body?.patientId || '').trim();
    const encounterId = String(body?.encounterId || '').trim();
    const drugCode = String(body?.drugCode || '').trim();
    const drugName = String(body?.drugName || '').trim();
    if (!patientId || !encounterId || !drugCode || !drugName) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MEDICATION_SAFETY_PRECHECK_INVALID',
            message:
              'Patient, encounter, drug code and drug name are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const [patient, encounter] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        encounterId
      ),
    ]);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: { code: 'PATIENT_NOT_FOUND' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (!encounter || String(encounter.patientId || '') !== patientId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ENCOUNTER_PATIENT_MISMATCH',
            message: 'Encounter does not belong to the supplied patient.',
          },
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    assertPatient360PatientAccess(context, patient, encounter);

    const evaluation =
      await MedicationSafetyService.evaluateCandidateAuthoritatively(
        context.tenantId,
        patientId,
        encounterId,
        {
          drugCode,
          drugName,
          system: body?.system ? String(body.system) : undefined,
        }
      );

    return NextResponse.json(
      {
        success: true,
        evaluation,
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
        : 'Medication safety precheck failed.';
    const unauthorized = /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'MEDICATION_SAFETY_PRECHECK_UNAUTHORIZED'
            : 'MEDICATION_SAFETY_PRECHECK_FAILED',
          message,
        },
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
