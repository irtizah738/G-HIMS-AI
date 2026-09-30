import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { CommandBus } from '@/lib/backend/commands/command-bus';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const action = String(body.action || '');
    const payload = body.payload;

    if (!tenantId || !payload) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'tenantId and payload are required.' } },
        { status: 400 }
      );
    }

    const commandType =
      action === 'VERIFY_CREDENTIAL'
        ? 'VerifyCredentialCommand'
        : action === 'GRANT_PRIVILEGE'
          ? 'GrantClinicalPrivilegeCommand'
          : action === 'CHANGE_PRIVILEGE_STATUS'
            ? 'ChangeClinicalPrivilegeStatusCommand'
            : '';

    if (!commandType) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ACTION', message: 'Action must be VERIFY_CREDENTIAL, GRANT_PRIVILEGE, or CHANGE_PRIVILEGE_STATUS.' } },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const result = await CommandBus.dispatch(context, {
      commandId: String(body.commandId || `cmd_${crypto.randomUUID()}`),
      idempotencyKey: String(body.idempotencyKey || crypto.randomUUID()),
      tenantId: context.tenantId,
      commandType,
      schemaVersion: 1,
      payload,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 403 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HCM request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH|SESSION/i.test(message);
    return NextResponse.json(
      { success: false, error: { code: unauthorized ? 'UNAUTHORIZED' : 'HCM_ERROR', message } },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
