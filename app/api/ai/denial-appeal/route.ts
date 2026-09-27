import { NextRequest, NextResponse } from 'next/server';
import { generateDenialAppealFlow } from '@/lib/ai/flows/denial-appeal';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

const ALLOWED_ROLES = new Set([
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
  'ADMINISTRATOR',
  'HOSPITAL_ADMIN',
  'BILLING_CLERK',
  'FINANCE_MANAGER',
  'REVENUE_CYCLE_MANAGER',
  'CLAIMS_SPECIALIST',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || !body.claimId || !body.denialReasonCode) {
      return NextResponse.json(
        { error: 'tenantId, Claim ID and Denial Reason Code are required.' },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    if (!context.roles.some((role) => ALLOWED_ROLES.has(role))) {
      return NextResponse.json(
        { error: 'Revenue-cycle or finance role required.' },
        { status: 403 }
      );
    }

    const result = await generateDenialAppealFlow.run(
      {
        claimId: String(body.claimId),
        denialReasonCode: String(body.denialReasonCode),
        denialDescription: String(body.denialDescription || ''),
        patientDemographics:
          body.patientDemographics && typeof body.patientDemographics === 'object'
            ? body.patientDemographics
            : {},
        clinicalProcedure: String(body.clinicalProcedure || ''),
        doctorAttestation: String(body.doctorAttestation || ''),
      },
      { tenantId }
    );

    return NextResponse.json({
      status: 'DRAFT_REQUIRES_HUMAN_REVIEW',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate denial appeal draft';
    const unauthorized = /AUTH|TENANT|SESSION|DEVICE/i.test(message);
    const aiUnavailable = /AI_UNAVAILABLE/i.test(message);

    return NextResponse.json(
      {
        error: aiUnavailable ? 'AI_UNAVAILABLE' : message,
        message: aiUnavailable
          ? 'Denial appeal AI is unavailable. No fallback appeal or guideline citations were generated.'
          : undefined,
      },
      { status: unauthorized ? 403 : aiUnavailable ? 503 : 500 }
    );
  }
}
