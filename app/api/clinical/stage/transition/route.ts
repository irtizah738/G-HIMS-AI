import { NextResponse } from 'next/server';

/**
 * Retired P0 hardening endpoint.
 *
 * This legacy route trusted client-supplied stage evidence (for example
 * billingCleared/soapSigned) and performed direct Firestore writes. Stage mutations
 * must use POST /api/commands/execute with AdvanceStageCommand so actor and tenant
 * authority are derived server-side.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'LEGACY_MUTATION_ROUTE_RETIRED',
        message: 'Use /api/commands/execute with AdvanceStageCommand.',
      },
    },
    { status: 410 }
  );
}
