import { NextRequest, NextResponse } from 'next/server';

/**
 * Retired legacy client-supplied timeline projection endpoint.
 *
 * Production timeline authority is /api/opd/timeline, which derives tenant,
 * patient, encounter, event and audit lineage from authenticated server state.
 * This endpoint deliberately fails closed so callers cannot submit fabricated
 * patient/event metadata and receive a projection that appears authoritative.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: 'LEGACY_CLINICAL_TIMELINE_RETIRED',
      replacement: '/api/opd/timeline',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
