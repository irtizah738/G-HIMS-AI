import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { AuthError } from '@/lib/auth/auth-errors';

export const dynamic = 'force-dynamic';

/**
 * Authenticated, tenant-scoped authoritative replica probe.
 *
 * This endpoint is intentionally read-only and non-PHI. It verifies the same
 * server/session boundary used by protected commands and performs a real
 * Firestore round-trip against the tenant document so the client can report
 * an honest cloud-replica status instead of a hard-coded latency.
 */
export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const startedAt = performance.now();
    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        {
          status: 'unavailable',
          tenantId: context.tenantId,
          error: 'AUTHORITATIVE_STORE_UNAVAILABLE',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const storeStartedAt = performance.now();
    await db.collection('tenants').doc(context.tenantId).get();
    const storeLatencyMs = Math.max(0, Math.round(performance.now() - storeStartedAt));
    const serverLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    return NextResponse.json(
      {
        status: 'ready',
        tenantId: context.tenantId,
        storeLatencyMs,
        serverLatencyMs,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const authError = error instanceof AuthError
      ? error
      : new AuthError({
          code: 'INTERNAL_AUTH_ERROR',
          message: error instanceof Error ? error.message : 'Unable to verify authoritative sync replica',
          statusCode: 503,
        });

    return NextResponse.json(
      {
        status: 'unavailable',
        error: authError.code,
      },
      {
        status: authError.statusCode,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
