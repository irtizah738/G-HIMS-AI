import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { CommandBus } from '@/lib/backend/commands/command-bus';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const journal = body.journal;

    if (!tenantId || !journal || !Array.isArray(journal.lines)) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_JOURNAL', message: 'tenantId and journal lines are required.' } },
        { status: 400 }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);
    const result = await CommandBus.dispatch(context, {
      commandId: String(body.commandId || `cmd_${crypto.randomUUID()}`),
      idempotencyKey: String(body.idempotencyKey || crypto.randomUUID()),
      tenantId: context.tenantId,
      commandType: 'PostJournalCommand',
      schemaVersion: 1,
      payload: journal,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 403 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Finance request failed';
    const unauthorized = /AUTH|TENANT|UNAUTH|SESSION/i.test(message);
    return NextResponse.json(
      { success: false, error: { code: unauthorized ? 'UNAUTHORIZED' : 'FINANCE_ERROR', message } },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
