import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalDraftService } from '@/lib/clinical/intelligence/clinical-draft-service';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { observeClinicalIntelligenceOperation } from '@/lib/clinical/intelligence/clinical-intelligence-observability';
import { CLINICAL_DRAFT_TYPES, type ClinicalDraftType } from '@/types/clinical-draft';
import type { CommandContext } from '@/lib/backend/types';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

function authorize(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN'],
    requiredPrivilege: 'SIGN_CLINICAL_NOTES',
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
  if (!patient) throw new Error('CI10F_PATIENT_NOT_FOUND');
  if (!encounter || String(encounter.patientId || '') !== patientId) {
    throw new Error('CI10F_ENCOUNTER_PATIENT_MISMATCH');
  }
  assertPatient360PatientAccess(context, patient, encounter);
}

function tenantFrom(req: NextRequest, body?: Record<string, unknown>) {
  return String(
    body?.tenantId ||
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
  ).trim().toLowerCase();
}

function statusFor(message: string) {
  if (/CI10H_SAFETY_GATE_REJECTED|CI10H_STALE_DRAFT_EVIDENCE/i.test(message)) return 422;
  if (/AUTH|SESSION|TENANT|ACCESS|PRIVILEGE|UNAUTHORIZED/i.test(message)) return 403;
  if (/NOT_FOUND|PATIENT_NOT_FOUND|ENCOUNTER_PATIENT_MISMATCH/i.test(message)) return 404;
  if (/PATIENT360|ACTIVE_ENCOUNTER|NOT_READY|INTEGRATION_NOT_LIVE/i.test(message)) return 409;
  if (/REQUIRED|INVALID|DRAFT_TYPE/i.test(message)) return 400;
  if (/AI_PROVIDER|AI_INTEGRATION|DRAFT_STORE|EVIDENCE_STORE/i.test(message)) return 503;
  return 500;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const tenantId = tenantFrom(req, body);
    const { context } = await deriveAuthoritativeContext(req, tenantId || undefined);
    const auth = authorize(context);
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: { code: auth.code || 'CI10F_UNAUTHORIZED', message: auth.reason } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const patientId = String(body.patientId || '').trim();
    const encounterId = String(body.encounterId || '').trim();
    const careSetting = String(body.careSetting || 'UNKNOWN').trim().toUpperCase() as ClinicalCareSetting;
    const draftType = String(body.draftType || '').trim().toUpperCase() as ClinicalDraftType;
    const idempotencyKey = String(
      body.idempotencyKey || req.headers.get('x-idempotency-key') || ''
    ).trim();

    if (!patientId || !encounterId || !idempotencyKey || !CLINICAL_DRAFT_TYPES.includes(draftType)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CI10F_CONTEXT_REQUIRED',
            message: 'patientId, encounterId, idempotencyKey and a supported draftType are required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await assertAccess(context, patientId, encounterId);
    const result = await observeClinicalIntelligenceOperation(
      {
        operation: 'GENERATE_GOVERNED_DRAFT',
        purpose: 'CLINICAL_DRAFT',
        tenantId: context.tenantId,
        correlationId: context.correlationId,
      },
      () =>
        ClinicalDraftService.generateAuthoritatively(
          context,
          patientId,
          encounterId,
          careSetting,
          draftType,
          idempotencyKey
        )
    );

    return NextResponse.json(
      { success: true, ...result },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Governed clinical draft generation failed.';
    return NextResponse.json(
      { success: false, error: { code: 'CI10F_GENERATION_FAILED', message } },
      { status: statusFor(message), headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = tenantFrom(req);
    const draftId = String(req.nextUrl.searchParams.get('draftId') || '').trim();
    if (!draftId) {
      return NextResponse.json(
        { success: false, error: { code: 'CI10F_DRAFT_ID_REQUIRED', message: 'draftId is required.' } },
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
        { success: false, error: { code: auth.code || 'CI10F_UNAUTHORIZED', message: auth.reason } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const draft = await ClinicalDraftService.get(context.tenantId, draftId);
    if (!draft) {
      return NextResponse.json(
        { success: false, error: { code: 'CI10F_DRAFT_NOT_FOUND' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    await assertAccess(context, draft.patientId, draft.encounterId);

    const [revision, evidenceSnapshot] = await Promise.all([
      ClinicalDraftService.getRevision(context.tenantId, draft.currentRevisionId),
      ClinicalEvidenceService.getSnapshot(context.tenantId, draft.evidenceSnapshotId),
    ]);

    if (
      !revision ||
      revision.draftId !== draft.draftId ||
      revision.contentHash !== draft.currentContentHash ||
      !evidenceSnapshot ||
      evidenceSnapshot.snapshotHash !== draft.evidenceSnapshotHash ||
      evidenceSnapshot.patientId !== draft.patientId
    ) {
      throw new Error('CI10F_DRAFT_INTEGRITY_FAILURE');
    }

    return NextResponse.json(
      {
        success: true,
        draft,
        revision,
        evidenceIndex: evidenceSnapshot.evidenceRefs.map((item) => ({
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
    const message = error instanceof Error ? error.message : 'Governed clinical draft retrieval failed.';
    return NextResponse.json(
      { success: false, error: { code: 'CI10F_READ_FAILED', message } },
      { status: statusFor(message), headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
