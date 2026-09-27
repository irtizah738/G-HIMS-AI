/**
 * G-HIMS Finance Universal Journal API Route
 * Identity and authority are derived server-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { FinancialLedgerDomainService, PostJournalPayload } from '@/lib/backend/services/financial-ledger-domain-service';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload: PostJournalPayload = body.journal;
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId || !payload || !Array.isArray(payload.lines)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_JOURNAL', message: 'tenantId and journal lines are required.' } },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID());
    const commandId = String(body.commandId || `cmd_${crypto.randomUUID()}`);

    const result = await FinancialLedgerDomainService.postUniversalJournal(
      context,
      commandId,
      idempotencyKey,
      payload
    );

    return NextResponse.json(result, { status: result.success ? 200 : 403 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Finance request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json(
      { success: false, error: { code: unauthorized ? 'UNAUTHORIZED' : 'FINANCE_ERROR', message } },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
