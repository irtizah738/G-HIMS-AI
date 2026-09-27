import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { dispatchOutboxEvent } from '@/lib/events/outbox';
import { OutboxEventRecord } from '@/types/clinical-workflow';

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
    const body = await req.json();
    const events: OutboxEventRecord[] = Array.isArray(body.events) ? body.events : [];

    const results = [];
    for (const event of events) {
      const outcome = await dispatchOutboxEvent(event);
      results.push({
        id: event.id,
        eventType: event.eventType,
        destinationQueue: event.destinationQueue,
        status: outcome.success ? 'DISPATCHED' : 'FAILED',
        error: outcome.error,
      });
    }

    return NextResponse.json({ success: true, processedCount: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Outbox processing failed' },
      { status: 500 }
    );
  }
}
