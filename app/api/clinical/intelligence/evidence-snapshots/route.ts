import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';
import type { ClinicalIntelligencePurpose } from '@/types/clinical-intelligence-evidence';

const PURPOSES = new Set<ClinicalIntelligencePurpose>([
  'LONGITUDINAL_SUMMARY',
  'ENCOUNTER_PREP',
  'TREND_EXPLANATION',
  'MEDICATION_RECONCILIATION',
  'CLINICAL_DRAFT',
]);

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
      requiredRoles: [
        'DOCTOR',
        'CONSULTANT',
        'ATTENDING_PHYSICIAN',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: auth.code || 'UNAUTHORIZED',
            message:
              auth.reason ||
              'Clinician chart-review authority is required.',
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patientId = String(body?.patientId || '').trim();
    const purpose = String(body?.purpose || '').trim().toUpperCase() as
      | ClinicalIntelligencePurpose
      | '';

    if (!patientId || !PURPOSES.has(purpose as ClinicalIntelligencePurpose)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10_EVIDENCE_REQUEST_INVALID',
            message: 'A patientId and supported intelligence purpose are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      patientId
    );
    if (!patient) {
      return NextResponse.json(
        { success: false, error: { code: 'PATIENT_NOT_FOUND' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const projection = await Patient360ProjectionService.getProjection(
      context.tenantId,
      patientId
    );
    if (!projection) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PATIENT360_PROJECTION_NOT_READY' },
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const careContext =
      selectCareContextEncounter(projection.careContexts) ||
      projection.activeEncounter;
    const accessEncounter = careContext?.encounterId
      ? await DomainStateRepository.getById<Record<string, unknown>>(
          context.tenantId,
          'encounters',
          careContext.encounterId
        )
      : null;

    if (
      accessEncounter &&
      String(accessEncounter.patientId || '') !== patientId
    ) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'ENCOUNTER_PATIENT_MISMATCH' },
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    assertPatient360PatientAccess(context, patient, accessEncounter);

    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      purpose as ClinicalIntelligencePurpose
    );

    return NextResponse.json(
      { success: true, snapshot },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Evidence snapshot creation failed.';
    const unauthorized = /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10_EVIDENCE_UNAUTHORIZED'
            : 'CI10_EVIDENCE_CREATION_FAILED',
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
