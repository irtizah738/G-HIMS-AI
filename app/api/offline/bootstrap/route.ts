import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';

export const dynamic = 'force-dynamic';

const CLINICAL_COLLECTIONS = [
  'patients',
  'encounters',
  'encounterEvidence',
  'orders',
  'prescriptions',
  'opd_queue',
  'beds',
] as const;

const BILLING_COLLECTIONS = [
  'billingMismatches',
  'encounterCharges',
  'journalEntries',
] as const;

const ADMIN_COLLECTIONS = [
  'telehealthSessions',
  'employees',
] as const;

function authorizedCollections(roles: string[]): string[] {
  const normalized = new Set(roles.map((role) => String(role || '').trim().toUpperCase()));
  if (normalized.has('SYSTEM_ADMIN') || normalized.has('ADMINISTRATOR') || normalized.has('ADMIN')) {
    return [...CLINICAL_COLLECTIONS, ...BILLING_COLLECTIONS, ...ADMIN_COLLECTIONS];
  }

  const selected = new Set<string>();
  if (
    ['DOCTOR', 'CONSULTANT', 'NURSE', 'ADMISSION_OFFICER', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST']
      .some((role) => normalized.has(role))
  ) {
    CLINICAL_COLLECTIONS.forEach((collection) => selected.add(collection));
  }

  if (
    ['BILLING_CLERK', 'BILLING_ADMIN', 'FINANCE', 'REVENUE_CYCLE']
      .some((role) => normalized.has(role))
  ) {
    BILLING_COLLECTIONS.forEach((collection) => selected.add(collection));
    selected.add('patients');
    selected.add('encounters');
  }

  return [...selected];
}

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { success: false, error: { code: 'EDGE_BOOTSTRAP_STORE_UNAVAILABLE' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const collections = authorizedCollections(context.roles);
    const generatedAt = Date.now();

    const entries = await Promise.all(
      collections.map(async (collection) => {
        const snapshot = await tenantRef.collection(collection).limit(1000).get();
        return [
          collection,
          snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          })),
        ] as const;
      })
    );

    const snapshotVersion = `${context.tenantId}:${generatedAt}`;

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        generatedAt,
        snapshotVersion,
        collections: Object.fromEntries(entries),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-GHIMS-Edge-Snapshot': snapshotVersion,
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to hydrate offline read models';
    const unauthorized = /AUTH|TENANT|SESSION|ACCOUNT/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized ? 'EDGE_BOOTSTRAP_UNAUTHORIZED' : 'EDGE_BOOTSTRAP_FAILED',
          message,
        },
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
