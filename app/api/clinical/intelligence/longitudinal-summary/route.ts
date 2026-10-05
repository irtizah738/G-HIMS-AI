import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { selectCareContextEncounter } from '@/lib/clinical/patient360/care-context';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalLongitudinalSummaryService } from '@/lib/clinical/intelligence/clinical-longitudinal-summary-service';
import { observeClinicalIntelligenceOperation } from '@/lib/clinical/intelligence/clinical-intelligence-observability';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalLongitudinalSummary,
  LongitudinalEvidenceIndexItem,
} from '@/types/clinical-longitudinal-summary';

async function assertSummaryPatientAccess(
  context: CommandContext,
  patientId: string
): Promise<void> {
  const [patient, projection] = await Promise.all([
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      patientId
    ),
    Patient360ProjectionService.getProjection(context.tenantId, patientId),
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

function evidenceIndex(
  snapshot: Awaited<ReturnType<typeof ClinicalEvidenceService.getSnapshot>>
): LongitudinalEvidenceIndexItem[] {
  if (!snapshot) return [];
  return snapshot.evidenceRefs.map((item) => ({
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
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patientId = String(body?.patientId || '').trim();
    if (!patientId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10B_PATIENT_REQUIRED',
            message: 'patientId is required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertSummaryPatientAccess(context, patientId);
    const result = await observeClinicalIntelligenceOperation(
      {
        operation: 'GENERATE_LONGITUDINAL_SUMMARY',
        purpose: 'LONGITUDINAL_SUMMARY',
        tenantId: context.tenantId,
        correlationId: context.correlationId,
      },
      () =>
        ClinicalLongitudinalSummaryService.generateAuthoritatively(
          context,
          patientId
        )
    );

    return NextResponse.json(
      { success: true, ...result },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Longitudinal clinical summary generation failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);
    const notReady = /PATIENT360_PROJECTION_NOT_READY/i.test(message);
    const notFound = /PATIENT_NOT_FOUND/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10B_UNAUTHORIZED'
            : notReady
              ? 'CI10B_PATIENT360_NOT_READY'
              : notFound
                ? 'PATIENT_NOT_FOUND'
                : 'CI10B_GENERATION_FAILED',
          message,
        },
      },
      {
        status: unauthorized ? 403 : notReady ? 409 : notFound ? 404 : 500,
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
    const summaryId = String(
      req.nextUrl.searchParams.get('summaryId') || ''
    ).trim();

    if (!summaryId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10B_SUMMARY_ID_REQUIRED',
            message: 'summaryId is required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
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
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const summary =
      await ClinicalLongitudinalSummaryService.get(
        context.tenantId,
        summaryId
      );
    if (!summary) {
      return NextResponse.json(
        { success: false, error: { code: 'CI10B_SUMMARY_NOT_FOUND' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertSummaryPatientAccess(context, summary.patientId);

    const snapshot = await ClinicalEvidenceService.getSnapshot(
      context.tenantId,
      summary.evidenceSnapshotId
    );
    if (
      !snapshot ||
      snapshot.patientId !== summary.patientId ||
      snapshot.snapshotHash !== summary.evidenceSnapshotHash
    ) {
      throw new Error('CI10B_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE');
    }

    return NextResponse.json(
      {
        success: true,
        summary: summary as ClinicalLongitudinalSummary,
        evidenceIndex: evidenceIndex(snapshot),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Longitudinal clinical summary retrieval failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10B_UNAUTHORIZED'
            : 'CI10B_READ_FAILED',
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
