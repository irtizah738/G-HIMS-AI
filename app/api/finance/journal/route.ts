/**
 * G-HIMS Finance Universal Journal API Route
 * POST /api/finance/journal
 */

import { NextRequest, NextResponse } from 'next/server';
import { FinancialLedgerDomainService, PostJournalPayload } from '@/lib/backend/services/financial-ledger-domain-service';
import { CommandContext } from '@/lib/backend/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload: PostJournalPayload = body.journal;
    const idempotencyKey = body.idempotencyKey || `je_${Date.now()}`;
    const commandId = body.commandId || `cmd_${Date.now()}`;

    if (!payload || !Array.isArray(payload.lines)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_JOURNAL', message: 'Journal lines are required.' } },
        { status: 400 }
      );
    }

    const context: CommandContext = {
      actorId: req.headers.get('x-actor-id') || 'usr_finance_officer',
      tenantId: req.headers.get('x-tenant-id') || 'tenant_default',
      roles: ['FINANCE_MANAGER', 'ACCOUNTANT'],
      permissions: ['ALL_FINANCE'],
      correlationId: `fin_corr_${Date.now()}`,
      requestId: `req_${Date.now()}`,
    };

    const result = await FinancialLedgerDomainService.postUniversalJournal(context, commandId, idempotencyKey, payload);
    const statusCode = result.success ? 200 : 400;

    return NextResponse.json(result, { status: statusCode });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'FINANCE_ERROR', message: err instanceof Error ? err.message : 'Internal finance error' },
      },
      { status: 500 }
    );
  }
}
