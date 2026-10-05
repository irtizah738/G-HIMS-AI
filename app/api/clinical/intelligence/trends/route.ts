import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalTrendIntelligenceService } from '@/lib/clinical/intelligence/clinical-trend-intelligence-service';
import type { CommandContext } from '@/lib/backend/types';

function authorize(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
    ],
  });
}

async function assertTrendAccess(
  context: CommandContext,
  patientId: string
): Promise<void> {
  const [patient, projection] = await Promise.all([
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      patientId
    ),
    Patient360ProjectionService.getProjection(
      context.tenantId,
      patientId
    ),
  ]);

  if (!patient) throw new Error('PATIENT_NOT_FOUND');
  if (!projection) throw new Error('PATIENT360_PROJECTION_NOT_READY');

  const careContext =
    selectCareContextEncounter(projection.careContexts) ||
    projection.activeEncounter;
  const encounter = careContext?.encounterId
    ? await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        careContext.encounterId
      )
    : null;

  if (
    encounter &&
    String(encounter.patientId || '') !== patientId
  ) {
    throw new Error('ENCOUNTER_PATIENT_MISMATCH');
  }

  assertPatient360PatientAccess(context, patient, encounter);
}

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
    const auth = authorize(context);
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
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const patientId = String(body?.patientId || '').trim();
    if (!patientId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10D_PATIENT_REQUIRED',
            message: 'patientId is required.',
          },
        },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    await assertTrendAccess(context, patientId);
    const result =
      await ClinicalTrendIntelligenceService.generateAuthoritatively(
        context,
        patientId
      );

    return NextResponse.json(
      { success: true, ...result },
      {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Clinical trend generation failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);
    const notFound = /PATIENT_NOT_FOUND/i.test(message);
    const notReady = /PATIENT360_PROJECTION_NOT_READY/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10D_UNAUTHORIZED'
            : notReady
              ? 'CI10D_PATIENT360_NOT_READY'
              : notFound
                ? 'PATIENT_NOT_FOUND'
                : 'CI10D_GENERATION_FAILED',
          message,
        },
      },
      {
        status: unauthorized
          ? 403
          : notReady
            ? 409
            : notFound
              ? 404
              : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();
    const artifactId = String(
      req.nextUrl.searchParams.get('artifactId') || ''
    ).trim();

    if (!artifactId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10D_ARTIFACT_ID_REQUIRED',
            message: 'artifactId is required.',
          },
        },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const { context } = await deriveAuthoritativeContext(
      req,
      tenantId || undefined,
      { touchSessionActivity: false }
    );
    const auth = authorize(context);
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
        {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const artifact =
      await ClinicalTrendIntelligenceService.get(
        context.tenantId,
        artifactId
      );
    if (!artifact) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'CI10D_ARTIFACT_NOT_FOUND' },
        },
        {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    await assertTrendAccess(context, artifact.patientId);
    const snapshot = await ClinicalEvidenceService.getSnapshot(
      context.tenantId,
      artifact.evidenceSnapshotId
    );

    if (
      !snapshot ||
      snapshot.patientId !== artifact.patientId ||
      snapshot.snapshotHash !== artifact.evidenceSnapshotHash
    ) {
      throw new Error('CI10D_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE');
    }

    const evidenceIndex = snapshot.evidenceRefs.map((item) => ({
      evidenceId: item.evidenceId,
      sourceType: item.sourceType,
      sourceEntityId: item.sourceEntityId,
      label: item.label,
      status: item.status,
      occurredAt: item.occurredAt,
      provenanceStatus: item.provenanceStatus,
      sourceEventIds: item.sourceEventIds,
      contentHash: item.contentHash,
      content: item.content,
    }));

    return NextResponse.json(
      {
        success: true,
        artifact,
        evidenceIndex,
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
        : 'Clinical trend retrieval failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10D_UNAUTHORIZED'
            : 'CI10D_READ_FAILED',
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
