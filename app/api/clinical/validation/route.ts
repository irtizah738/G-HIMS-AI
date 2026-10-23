import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import {
  ClinicalValidationWorkspaceService,
  validationRole,
} from '@/lib/clinical/validation/clinical-validation-workspace-service';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'CIQP_VALIDATION_REQUEST_FAILED';
  // Do not disclose source data or identifying staff information in errors.
  const forbidden = /AUTH|SESSION|TENANT|ROLE|REVIEWER_REQUIRED|ADMIN_REQUIRED|ACCESS|NOT_ASSIGNED/i.test(message);
  const conflict = /ALREADY_INITIALIZED|IMMUTABLE_SUBMISSION|PRIMARY_REVIEWS_NOT_LOCKED/i.test(message);
  const notReady = /TEST_EMULATOR_REQUIRED|FIRESTORE_UNAVAILABLE/i.test(message);
  const invalid = /INVALID|UNKNOWN|THREE_DISTINCT|CONFLICT|INTEGRITY/i.test(message);
  const code = /^(CIQP_VALIDATION_[A-Z_]+)$/.test(message) ? message : 'CIQP_VALIDATION_REQUEST_FAILED';
  return NextResponse.json({ success: false, error: { code } }, {
    status: forbidden ? 403 : conflict ? 409 : notReady ? 503 : invalid ? 400 : 500,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    const { context } = await deriveAuthoritativeContext(req, tenantId || undefined, { touchSessionActivity: false });
    const role = validationRole(context);
    if (!role) throw new Error('CIQP_VALIDATION_ACCESS_DENIED');
    const cases = await ClinicalValidationWorkspaceService.list(context);
    return NextResponse.json({
      success: true,
      study: { id: 'renal-ciqp-synthetic-v1', source: 'CURATED_SYNTHETIC_ONLY', blinded: true,
        clinicalPolicyApproved: false, retrospectiveValidationAuthorized: false },
      role,
      cases,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // 8 KiB request ceiling; no uploaded patient records or model predictions.
    const bodyText = await req.text();
    if (bodyText.length > 8192) throw new Error('CIQP_VALIDATION_REQUEST_INVALID');
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();
    const { context } = await deriveAuthoritativeContext(req, tenantId || undefined);
    const action = String(body.action || '');
    if (action === 'INITIALIZE_STUDY') {
      const result = await ClinicalValidationWorkspaceService.seed(
        context, body.reviewerAUid, body.reviewerBUid, body.adjudicatorUid
      );
      return NextResponse.json({ success: true, result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'SUBMIT_ASSESSMENT') {
      const result = await ClinicalValidationWorkspaceService.submit(context, body);
      return NextResponse.json({ success: true, result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    throw new Error('CIQP_VALIDATION_ACTION_INVALID');
  } catch (error) {
    return failure(error);
  }
}
