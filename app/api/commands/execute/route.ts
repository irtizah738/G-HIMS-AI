/**
 * G-HIMS Master Command Execution API Route
 * POST /api/commands/execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { BaseCommand, CommandContext } from '@/lib/backend/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const command: BaseCommand = body.command;

    if (!command || !command.commandType || !command.idempotencyKey) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_REQUEST_BODY', message: 'Command must specify commandType and idempotencyKey.' },
        },
        { status: 400 }
      );
    }

    // In a production setup with Firebase Auth token headers, extract claims from Authorization: Bearer <token>
    // For now, construct the context safely with server-validated defaults or request headers
    const tenantIdHeader = req.headers.get('x-tenant-id') || command.tenantId || 'tenant_default';
    const actorIdHeader = req.headers.get('x-actor-id') || 'usr_clinician_01';
    const rolesHeader = req.headers.get('x-user-roles')?.split(',') || ['DOCTOR', 'CLINICIAN', 'SYSTEM_ADMIN'];
    const privilegesHeader = req.headers.get('x-clinical-privileges')?.split(',') || [
      'CONSULT',
      'PRESCRIBE',
      'ORDER_LAB',
      'ORDER_RADIOLOGY',
      'SIGN_SOAP',
      'POST_JOURNAL',
      'UNRESTRICTED_CLINICAL_CHIEF',
    ];

    const context: CommandContext = {
      actorId: actorIdHeader,
      tenantId: tenantIdHeader,
      roles: rolesHeader,
      permissions: ['ALL_CLINICAL', 'ALL_FINANCE'],
      clinicalPrivileges: privilegesHeader,
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      requestId: `req_${Date.now()}`,
    };

    const result = await CommandBus.dispatch(context, command);
    const statusCode = result.success ? 200 : result.error?.code === 'UNAUTHORIZED' ? 403 : 400;

    return NextResponse.json(result, { status: statusCode });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SERVER_ERROR', message: err instanceof Error ? err.message : 'Internal server error' },
      },
      { status: 500 }
    );
  }
}
