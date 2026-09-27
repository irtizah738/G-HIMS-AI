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
    const dispatchSummary = await OutboxDispatcher.relayPendingOutbox();
    return NextResponse.json({ success: true, ...dispatchSummary });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: 'RELAY_ERROR', message: error instanceof Error ? error.message : 'Internal relay error' } },
      { status: 500 }
    );
  }
}
