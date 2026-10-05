import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { MedicationReconciliationCopilotService } from '@/lib/clinical/intelligence/medication-reconciliation-copilot-service';
import type { CommandContext } from '@/lib/backend/types';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

function authorize(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'PHARMACIST',
      'SYSTEM_ADMIN',
    ],
  });
}

async function assertAccess(
  context: CommandContext,
  patientId: string,
  encounterId: string
) {
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
  if (!encounter || String(encounter.patientId || '') !== patientId) {
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
              'Clinician/pharmacist medication-review authority is required.',
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patientId = String(body?.patientId || '').trim();
    const encounterId = String(body?.encounterId || '').trim();
    const careSetting = String(body?.careSetting || '')
      .trim()
      .toUpperCase() as ClinicalCareSetting | '';

    if (!patientId || !encounterId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10E_CONTEXT_REQUIRED',
            message: 'patientId and encounterId are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertAccess(context, patientId, encounterId);
    const result =
      await MedicationReconciliationCopilotService.generateAuthoritatively(
        context,
        patientId,
        encounterId,
        careSetting || 'UNKNOWN'
      );

    return NextResponse.json(
      { success: true, ...result },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Medication reconciliation review failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);
    const notFound =
      /PATIENT_NOT_FOUND|ENCOUNTER_PATIENT_MISMATCH/i.test(message);
    const notReady =
      /PATIENT360|ACTIVE_ENCOUNTER_REQUIRED/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10E_UNAUTHORIZED'
            : notFound
              ? 'CI10E_CONTEXT_NOT_FOUND'
              : notReady
                ? 'CI10E_NOT_READY'
                : 'CI10E_GENERATION_FAILED',
          message,
        },
      },
      {
        status: unauthorized ? 403 : notFound ? 404 : notReady ? 409 : 500,
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
            code: 'CI10E_ARTIFACT_ID_REQUIRED',
            message: 'artifactId is required.',
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
              'Clinician/pharmacist medication-review authority is required.',
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const artifact =
      await MedicationReconciliationCopilotService.get(
        context.tenantId,
        artifactId
      );
    if (!artifact) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'CI10E_ARTIFACT_NOT_FOUND' },
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertAccess(
      context,
      artifact.patientId,
      artifact.encounterId
    );

    const snapshot = await ClinicalEvidenceService.getSnapshot(
      context.tenantId,
      artifact.evidenceSnapshotId
    );
    if (
      !snapshot ||
      snapshot.patientId !== artifact.patientId ||
      snapshot.snapshotHash !== artifact.evidenceSnapshotHash
    ) {
      throw new Error('CI10E_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE');
    }

    return NextResponse.json(
      {
        success: true,
        artifact,
        evidenceIndex: snapshot.evidenceRefs.map((item) => ({
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
        })),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Medication reconciliation artifact retrieval failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|ACCESS|PRIVILEGE/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'CI10E_UNAUTHORIZED'
            : 'CI10E_READ_FAILED',
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
