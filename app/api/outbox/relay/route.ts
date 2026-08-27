/**
 * G-HIMS Background Outbox Relay Trigger API Route
 * POST /api/outbox/relay
 */

import { NextRequest, NextResponse } from 'next/server';
import { OutboxDispatcher } from '@/lib/backend/outbox/dispatcher';

export async function POST(req: NextRequest) {
  try {
    const dispatchSummary = await OutboxDispatcher.relayPendingOutbox();
    return NextResponse.json({ success: true, ...dispatchSummary }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'RELAY_ERROR', message: err instanceof Error ? err.message : 'Internal relay error' },
      },
      { status: 500 }
    );
  }
}
