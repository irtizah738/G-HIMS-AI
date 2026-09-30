import { NextResponse } from 'next/server';

/**
 * Retired P8 compatibility endpoint.
 *
 * Caller-supplied event bodies must never be dispatchable, even with an internal
 * worker credential. All publication now starts from an authoritative persisted
 * transactional outbox record via /api/outbox/relay.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'LEGACY_OUTBOX_ROUTE_RETIRED',
        message:
          'Direct clinical event dispatch is retired. Use the authoritative transactional outbox relay.',
      },
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
