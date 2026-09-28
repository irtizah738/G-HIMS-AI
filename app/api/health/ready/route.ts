import { NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export const dynamic = 'force-dynamic';

export async function GET() {
  const blockers: string[] = [];
  const runtime = getRuntimeMode();
  const auth = getAdminAuth();
  const db = getAdminFirestore();

  if (!auth) blockers.push('FIREBASE_ADMIN_AUTH_UNAVAILABLE');
  if (!db) blockers.push('FIRESTORE_ADMIN_UNAVAILABLE');

  if (auth) {
    try {
      // Performs a real credentialed Auth API call without returning identity data.
      await auth.listUsers(1);
    } catch {
      blockers.push('FIREBASE_ADMIN_AUTH_CONNECTIVITY_FAILED');
    }
  }

  if (db) {
    try {
      // Server-only non-PHI connectivity probe.
      await db.collection('_ghims_operational').limit(1).get();
    } catch {
      blockers.push('FIRESTORE_CONNECTIVITY_FAILED');
    }
  }

  const ready = blockers.length === 0;
  return NextResponse.json(
    {
      status: ready ? 'ready' : 'not_ready',
      service: 'g-hims',
      runtime,
      blockers,
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
