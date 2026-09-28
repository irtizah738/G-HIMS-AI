import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { OutboxDispatcher } from '@/lib/backend/outbox/dispatcher';

function authorized(req: NextRequest): boolean {
  const expected = process.env.GHIMS_INTERNAL_WORKER_KEY || '';
  const provided = req.headers.get('x-ghims-worker-key') || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized worker.' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(
      req.headers.get('x-ghims-tenant-id') ||
      body.tenantId ||
      ''
    ).trim().toLowerCase();

    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: { code: 'TENANT_REQUIRED', message: 'Tenant scope is required for outbox relay.' } },
        { status: 400 }
      );
    }

    const dispatchSummary = await OutboxDispatcher.relayPendingOutbox(tenantId);
    return NextResponse.json({ success: true, tenantId, ...dispatchSummary });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RELAY_ERROR',
          message: error instanceof Error ? error.message : 'Internal relay error',
        },
      },
      { status: 500 }
    );
  }
}
