import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import { ClinicalDeteriorationService } from '@/lib/clinical/intelligence/clinical-deterioration-service';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import { ConsultantVisibilityService } from '@/lib/clinical/intelligence/consultant-visibility-service';
import { normalizeCareSetting, selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';

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

    const requestedCareSettingRaw = String(
      req.nextUrl.searchParams.get('careSetting') || ''
    ).trim();
    const requestedCareSetting = requestedCareSettingRaw
      ? normalizeCareSetting(requestedCareSettingRaw)
      : undefined;
    if (requestedCareSettingRaw && requestedCareSetting === 'UNKNOWN') {
      return NextResponse.json(
        { success: false, error: 'INVALID_CARE_SETTING' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const requestedEncounterId = String(
      req.nextUrl.searchParams.get('encounterId') || ''
    ).trim();

    const accessEncounterId =
      requestedEncounterId ||
      String(
        patient.activeEncounterId || patient.currentEncounterId || ''
      ).trim();
    const accessEncounter = accessEncounterId
      ? await DomainStateRepository.getById<Record<string, unknown>>(
          context.tenantId,
          'encounters',
          accessEncounterId
        )
      : null;

    if (
      accessEncounter &&
      String(accessEncounter.patientId || '').trim() !== normalizedPatientId
    ) {
      return NextResponse.json(
        { success: false, error: 'ENCOUNTER_PATIENT_MISMATCH' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (requestedEncounterId && !accessEncounter) {
      return NextResponse.json(
        { success: false, error: 'ENCOUNTER_NOT_FOUND' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    assertPatient360PatientAccess(context, patient, accessEncounter);

    const timelineLimit = Math.max(
      1,
      Math.min(500, Number(req.nextUrl.searchParams.get('timelineLimit') || 200))
    );

    const {
      projection,
      timeline,
      repairedMissingProjection,
    } = await Patient360ProjectionService.readOrRebuildClinicalView(
      context.tenantId,
      normalizedPatientId,
      timelineLimit
    );

    const selectedCareContext =
      requestedEncounterId
        ? projection.recentEncounters.find(
            (item) => item.encounterId === requestedEncounterId
          )
        : selectCareContextEncounter(
            projection.careContexts,
            requestedCareSetting
          );

    const consultantRoles = new Set(
      context.roles.map((role) => String(role).toUpperCase())
    );
    const canUseConsultantVisibility = [
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
      'ADMINISTRATOR',
    ].some((role) => consultantRoles.has(role));

    const [
      dischargeReadiness,
      deterioration,
      medicationSafety,
      consultantVisibility,
    ] = await Promise.all([
        selectedCareContext?.careSetting === 'IPD'
          ? DischargeReadinessService.getProjection(
              context.tenantId,
              selectedCareContext.encounterId
            )
          : Promise.resolve(null),
        selectedCareContext
          ? ClinicalDeteriorationService.getProjection(
              context.tenantId,
              selectedCareContext.encounterId
            )
          : Promise.resolve(null),
        MedicationSafetyService.getProjection(
          context.tenantId,
          normalizedPatientId
        ),
        canUseConsultantVisibility
          ? ConsultantVisibilityService.buildForActor(
              context,
              normalizedPatientId,
              {
                encounterId: selectedCareContext?.encounterId,
                careSetting:
                  requestedCareSetting || selectedCareContext?.careSetting,
                timelineLimit,
              }
            )
          : Promise.resolve(null),
      ]);

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        patientId: normalizedPatientId,
        projection,
        timeline,
        selectedCareContext: selectedCareContext || null,
        dischargeReadiness,
        deterioration,
        medicationSafety,
        consultantVisibility,
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
          'X-GHIMS-Patient360-Repaired': repairedMissingProjection
            ? 'true'
            : 'false',
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Patient 360 read failed';

    const unauthorized =
      /AUTH|TENANT|SESSION|ACCOUNT|DEVICE|PERMISSION|ACCESS|FORBIDDEN|DENIED/i.test(
        message
      );

    return NextResponse.json(
      {
        success: false,
        error: unauthorized
          ? 'PATIENT360_ACCESS_DENIED'
          : 'PATIENT360_READ_FAILED',
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
