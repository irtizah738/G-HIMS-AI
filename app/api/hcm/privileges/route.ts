/**
 * G-HIMS HCM Clinical Privileges API Route
 * The caller's role is resolved from authoritative tenant membership.
 */
import { NextRequest, NextResponse } from 'next/server';
import { HcmPrivilegeDomainService } from '@/lib/backend/services/hcm-privilege-domain-service';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || '');
    const payload = body.payload;
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || !payload) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'tenantId and payload are required.' } },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
    const commandId = String(body.commandId || `cmd_${crypto.randomUUID()}`);

    const result =
      action === 'VERIFY_CREDENTIAL'
        ? await HcmPrivilegeDomainService.verifyCredential(context, commandId, idempotencyKey, payload)
        : action === 'GRANT_PRIVILEGE'
          ? await HcmPrivilegeDomainService.grantClinicalPrivilege(context, commandId, idempotencyKey, payload)
          : null;

    if (!result) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ACTION', message: 'Action must be VERIFY_CREDENTIAL or GRANT_PRIVILEGE.' } },
        { status: 400 }
      );
    }

    return NextResponse.json(result, { status: result.success ? 200 : 403 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HCM request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json(
      { success: false, error: { code: unauthorized ? 'UNAUTHORIZED' : 'HCM_ERROR', message } },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
