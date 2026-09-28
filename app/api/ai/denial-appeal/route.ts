import { NextRequest, NextResponse } from 'next/server';
import { generateDenialAppealFlow } from '@/lib/ai/flows/denial-appeal';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AIDraftRepository } from '@/server/ai/ai-draft-repository';

const ALLOWED_ROLES = new Set([
  'SYSTEM_ADMIN','SUPER_ADMIN','ADMINISTRATOR','HOSPITAL_ADMIN','BILLING_CLERK',
  'FINANCE_MANAGER','REVENUE_CYCLE_MANAGER','CLAIMS_SPECIALIST',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    if (!tenantId || !body.claimId || !body.denialReasonCode) {
      return NextResponse.json({ error: 'tenantId, Claim ID and Denial Reason Code are required.' }, { status: 400 });
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!context.roles.some((role) => ALLOWED_ROLES.has(role))) {
      return NextResponse.json({ error: 'Revenue-cycle or finance role required.' }, { status: 403 });
    }

    const input = {
      claimId: String(body.claimId),
      denialReasonCode: String(body.denialReasonCode),
      denialDescription: String(body.denialDescription || ''),
      patientDemographics: body.patientDemographics && typeof body.patientDemographics === 'object' ? body.patientDemographics : {},
      clinicalProcedure: String(body.clinicalProcedure || ''),
      doctorAttestation: String(body.doctorAttestation || ''),
    };

    const result = await generateDenialAppealFlow.run(input);
    const draft = await AIDraftRepository.create(context, {
      purpose: 'DENIAL_APPEAL_DRAFT',
      status: 'DRAFT_REQUIRES_HUMAN_REVIEW',
      patientId: body.patientId ? String(body.patientId) : undefined,
      encounterId: body.encounterId ? String(body.encounterId) : undefined,
      sourceEvidenceIds: Array.isArray(body.sourceEvidenceIds) ? body.sourceEvidenceIds.map(String) : [],
      input,
      output: result,
      provenance: result.aiProvenance,
    });

    return NextResponse.json({
      status: draft.status,
      draftId: draft.draftId,
      result: { ...result, draftId: draft.draftId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate denial appeal draft';
    const unauthorized = /AUTH|TENANT|SESSION|DEVICE/i.test(message);
    const unavailable = /AI_|DRAFT_STORE/i.test(message);
    return NextResponse.json(
      {
        error: unavailable ? 'AI_UNAVAILABLE' : message,
        message: unavailable
          ? 'Denial appeal AI is unavailable. No fallback appeal or guideline citations were generated.'
          : message,
      },
      { status: unauthorized ? 403 : unavailable ? 503 : 500 }
    );
  }
}
