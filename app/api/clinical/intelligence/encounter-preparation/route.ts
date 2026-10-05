import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalEncounterPreparationService } from '@/lib/clinical/intelligence/clinical-encounter-preparation-service';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ClinicalEncounterPreparationBrief,
  EncounterPreparationEvidenceIndexItem,
} from '@/types/clinical-encounter-preparation';

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

async function assertEncounterAccess(
  context: CommandContext,
  patientId: string,
  encounterId: string
): Promise<void> {
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

  if (!patient) throw new Error('PATIENT_NOT_FOUND');
  if (!encounter) throw new Error('ENCOUNTER_NOT_FOUND');
  if (String(encounter.patientId || '') !== patientId) {
    throw new Error('ENCOUNTER_PATIENT_MISMATCH');
  }

  assertPatient360PatientAccess(context, patient, encounter);
}

function evidenceIndex(
  snapshot: Awaited<ReturnType<typeof ClinicalEvidenceService.getSnapshot>>
): EncounterPreparationEvidenceIndexItem[] {
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
    const encounterId = String(body?.encounterId || '').trim();
    if (!patientId || !encounterId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10C_SCOPE_REQUIRED',
            message: 'patientId and encounterId are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertEncounterAccess(context, patientId, encounterId);

    const result =
      await ClinicalEncounterPreparationService.generateAuthoritatively(
        context,
        patientId,
        encounterId
      );

    return NextResponse.json(
      { success: true, ...result },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Encounter preparation generation failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);
    const notReady = /PATIENT360_PROJECTION_NOT_READY/i.test(message);
    const notFound = /PATIENT_NOT_FOUND|ENCOUNTER_NOT_FOUND/i.test(message);
    const mismatch = /ENCOUNTER_PATIENT_MISMATCH|ENCOUNTER_CONTEXT_NOT_FOUND/i.test(
      message
    );

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10C_UNAUTHORIZED'
            : notReady
              ? 'CI10C_PATIENT360_NOT_READY'
              : notFound
                ? 'CI10C_SCOPE_NOT_FOUND'
                : mismatch
                  ? 'CI10C_SCOPE_MISMATCH'
                  : 'CI10C_GENERATION_FAILED',
          message,
        },
      },
      {
        status: unauthorized
          ? 403
          : notReady || mismatch
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
    const briefId = String(
      req.nextUrl.searchParams.get('briefId') || ''
    ).trim();

    if (!briefId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10C_BRIEF_ID_REQUIRED',
            message: 'briefId is required.',
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

    const brief = await ClinicalEncounterPreparationService.get(
      context.tenantId,
      briefId
    );
    if (!brief) {
      return NextResponse.json(
        { success: false, error: { code: 'CI10C_BRIEF_NOT_FOUND' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertEncounterAccess(
      context,
      brief.patientId,
      brief.encounterId
    );

    const snapshot = await ClinicalEvidenceService.getSnapshot(
      context.tenantId,
      brief.evidenceSnapshotId
    );
    if (
      !snapshot ||
      snapshot.patientId !== brief.patientId ||
      snapshot.scope?.encounterId !== brief.encounterId ||
      snapshot.snapshotHash !== brief.evidenceSnapshotHash
    ) {
      throw new Error('CI10C_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE');
    }

    return NextResponse.json(
      {
        success: true,
        brief: brief as ClinicalEncounterPreparationBrief,
        evidenceIndex: evidenceIndex(snapshot),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Encounter preparation retrieval failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10C_UNAUTHORIZED'
            : 'CI10C_READ_FAILED',
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
