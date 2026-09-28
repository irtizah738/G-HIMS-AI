/**
 * G-HIMS Master Command Execution API Route
 * POST /api/commands/execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { BaseCommand } from '@/lib/backend/types';
import { deriveAuthoritativeContext, verifyCommandIntegrity } from '@/lib/backend/security/authoritative-context';
import { findActiveBreakGlassGrant } from '@/server/auth/break-glass-service';

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

    // Server-Side Authoritative Security Derivation (Rule 6: Global Data Integrity Rule)
    // Never trust client-asserted roles, permissions, privileges, or credential statuses
    const { context } = await deriveAuthoritativeContext(req, command.tenantId);

    // Verify command integrity against authoritative context
    verifyCommandIntegrity(context, command);

    const patientId = String((command.payload as any)?.patientId || '').trim();
    const encounterId = String((command.payload as any)?.encounterId || '').trim();
    const breakGlassGrant =
      patientId && encounterId
        ? await findActiveBreakGlassGrant({
            tenantId: context.tenantId,
            userId: context.actorId,
            patientId,
            encounterId,
          })
        : null;

    const commandContext = breakGlassGrant
      ? {
          ...context,
          isEmergencyOverride: true,
          breakGlassGrantId: breakGlassGrant.grantId,
          breakGlassPatientId: breakGlassGrant.patientId,
          breakGlassEncounterId: breakGlassGrant.encounterId,
        }
      : context;

    const result = await CommandBus.dispatch(commandContext, command);
    const statusCode = result.success ? 200 : result.error?.code === 'UNAUTHORIZED' ? 403 : 400;

    return NextResponse.json(result, { status: statusCode });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const isAuthError = message.includes('UNAUTHENTICATED') || message.includes('AUTHORIZATION_FAILURE') || message.includes('TENANT_ISOLATION_VIOLATION');
    return NextResponse.json(
      {
        success: false,
        error: { code: isAuthError ? 'UNAUTHORIZED' : 'SERVER_ERROR', message },
      },
      { status: isAuthError ? 403 : 500 }
    );
  }
}
