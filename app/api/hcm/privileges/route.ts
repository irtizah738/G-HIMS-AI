/**
 * G-HIMS HCM Clinical Privileges & Credentials API Route
 * POST /api/hcm/privileges
 */

import { NextRequest, NextResponse } from 'next/server';
import { HcmPrivilegeDomainService } from '@/lib/backend/services/hcm-privilege-domain-service';
import { CommandContext } from '@/lib/backend/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action; // 'VERIFY_CREDENTIAL' | 'GRANT_PRIVILEGE'
    const payload = body.payload;
    const idempotencyKey = body.idempotencyKey || `hcm_${Date.now()}`;
    const commandId = body.commandId || `cmd_${Date.now()}`;

    const context: CommandContext = {
      actorId: req.headers.get('x-actor-id') || 'usr_medical_director',
      tenantId: req.headers.get('x-tenant-id') || 'tenant_default',
      roles: ['MEDICAL_DIRECTOR', 'HR_ADMIN'],
      permissions: ['ALL_HCM', 'CREDENTIAL_GOVERNANCE'],
      correlationId: `hcm_corr_${Date.now()}`,
      requestId: `req_${Date.now()}`,
    };

    let result;
    if (action === 'VERIFY_CREDENTIAL') {
      result = await HcmPrivilegeDomainService.verifyCredential(context, commandId, idempotencyKey, payload);
    } else if (action === 'GRANT_PRIVILEGE') {
      result = await HcmPrivilegeDomainService.grantClinicalPrivilege(context, commandId, idempotencyKey, payload);
    } else {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ACTION', message: 'Action must be VERIFY_CREDENTIAL or GRANT_PRIVILEGE.' } },
        { status: 400 }
      );
    }

    const statusCode = result.success ? 200 : 400;
    return NextResponse.json(result, { status: statusCode });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'HCM_ERROR', message: err instanceof Error ? err.message : 'Internal HCM error' },
      },
      { status: 500 }
    );
  }
}
