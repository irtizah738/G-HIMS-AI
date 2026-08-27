import { NextRequest, NextResponse } from 'next/server';
import { dispatchOutboxEvent } from '@/lib/events/outbox';
import { OutboxEventRecord } from '@/types/clinical-workflow';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events: OutboxEventRecord[] = body.events || [];

    const results = [];
    for (const evt of events) {
      const outcome = await dispatchOutboxEvent(evt);
      results.push({
        id: evt.id,
        eventType: evt.eventType,
        destinationQueue: evt.destinationQueue,
        status: outcome.success ? 'DISPATCHED' : 'FAILED',
        error: outcome.error,
      });
    }

    return NextResponse.json({
      success: true,
      processedCount: results.length,
      results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
