import { NextResponse } from 'next/server';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { classifyFirebaseModuleLoadFailure } from '@/lib/runtime/firebase-module-health-classifier';

export const dynamic = 'force-dynamic';

export async function GET() {
  const blockers: string[] = [];
  const runtime = getRuntimeMode();
  // Initialization may throw before the connectivity probes execute.
  // Never expose raw SDK errors, project configuration, or credentials in HTTP.
  type AdminModule = typeof import('@/server/firebase/admin');
  let admin: AdminModule | null = null;
  try {
    // Import within GET so failures in Firebase SDK module evaluation are
    // contained, not converted by Next.js into an unclassified HTTP 500.
    admin = await import('@/server/firebase/admin');
  } catch (error) {
    blockers.push('FIREBASE_ADMIN_MODULE_LOAD_FAILED');
    blockers.push(classifyFirebaseModuleLoadFailure(error));
  }

  let auth: ReturnType<AdminModule['getAdminAuth']> = null;
  let db: ReturnType<AdminModule['getAdminFirestore']> = null;
  if (admin) try {
    auth = admin.getAdminAuth();
  } catch {
    blockers.push('FIREBASE_ADMIN_AUTH_INITIALIZATION_FAILED');
  }
  if (admin) try {
    db = admin.getAdminFirestore();
  } catch {
    blockers.push('FIRESTORE_ADMIN_INITIALIZATION_FAILED');
  }

  if (!auth && !blockers.includes('FIREBASE_ADMIN_AUTH_INITIALIZATION_FAILED')) {
    blockers.push('FIREBASE_ADMIN_AUTH_UNAVAILABLE');
  }
  if (!db && !blockers.includes('FIRESTORE_ADMIN_INITIALIZATION_FAILED')) {
    blockers.push('FIRESTORE_ADMIN_UNAVAILABLE');
  }

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
