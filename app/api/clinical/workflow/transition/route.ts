import { NextResponse } from 'next/server';

/**
 * Retired during Core Trust Boundary hardening. The legacy endpoint accepted
 * caller-provided workflow snapshots and actor identity and wrote directly to Firestore.
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
