import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  FieldPath,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

const CLINICAL_COLLECTIONS = [
  'patients',
  'encounters',
  'encounterEvidence',
  'orders',
  'prescriptions',
  'opd_queue',
  'beds',
  'patient360Projections',
  'dischargeReadinessProjections',
] as const;

const BILLING_COLLECTIONS = [
  'billingMismatches',
  'encounterCharges',
  'journalEntries',
  'cashReceipts',
] as const;

const ADMIN_COLLECTIONS = [
  'telehealthSessions',
  'employees',
] as const;

const SCM_COLLECTIONS = [
  'items',
  'inventoryBalances',
  'batches',
  'stockTransactions',
  'patientConsumptions',
  'purchaseRequisitions',
  'inventoryLocations',
  'scmPurchaseOrders',
  'goodsReceiptNotes',
  'stockTransfers',
  'recallCases',
  'suppliers',
  'threeWayMatches',
] as const;

const EDGE_PAGE_SIZE = 500;
const EDGE_COLLECTION_MAX = 10000;

async function readCollectionSnapshot(
  tenantRef: DocumentReference,
  collection: string
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let lastDocument: QueryDocumentSnapshot | null = null;

  while (true) {
    let query = tenantRef
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(EDGE_PAGE_SIZE);

    if (lastDocument) query = query.startAfter(lastDocument);

    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      rows.push({ id: document.id, ...document.data() });
    }

    if (rows.length > EDGE_COLLECTION_MAX) {
      throw new Error(
        `EDGE_SNAPSHOT_COLLECTION_LIMIT_EXCEEDED:${collection}:${EDGE_COLLECTION_MAX}`
      );
    }

    if (snapshot.size < EDGE_PAGE_SIZE) break;
    lastDocument = snapshot.docs[snapshot.docs.length - 1] || null;
    if (!lastDocument) break;
  }

  return rows;
}

function authorizedCollections(roles: string[]): string[] {
  const normalized = new Set(roles.map((role) => String(role || '').trim().toUpperCase()));

  if (
    normalized.has('SYSTEM_ADMIN') ||
    normalized.has('ADMINISTRATOR') ||
    normalized.has('ADMIN')
  ) {
    return [
      ...CLINICAL_COLLECTIONS,
      ...BILLING_COLLECTIONS,
      ...ADMIN_COLLECTIONS,
      ...SCM_COLLECTIONS,
    ];
  }

  const selected = new Set<string>();
  const add = (...collections: readonly string[]) =>
    collections.forEach((collection) => selected.add(collection));

  // Clinicians need the complete clinical working set while disconnected.
  if (['DOCTOR', 'CONSULTANT', 'NURSE'].some((role) => normalized.has(role))) {
    add(...CLINICAL_COLLECTIONS);
  }

  // Front desk/admissions should not receive notes, prescriptions or results.
  if (['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some((role) => normalized.has(role))) {
    add('patients', 'encounters', 'opd_queue', 'beds');
  }

  // Diagnostics need identity/encounter/order context, not the whole chart.
  if (['LAB_TECHNICIAN', 'LAB_TECH'].some((role) => normalized.has(role))) {
    add('patients', 'encounters', 'orders');
  }

  // Pharmacy needs prescription + patient context and its stock working set.
  if (normalized.has('PHARMACIST')) {
    add('patients', 'encounters', 'prescriptions');
    add(...SCM_COLLECTIONS);
  }

  if (
    ['BILLING_CLERK', 'BILLING_ADMIN', 'FINANCE', 'REVENUE_CYCLE']
      .some((role) => normalized.has(role))
  ) {
    add(...BILLING_COLLECTIONS);
    add('patients', 'encounters');
  }

  if (
    ['SCM_MANAGER', 'INVENTORY_OFFICER', 'STORE_KEEPER', 'PROCUREMENT']
      .some((role) => normalized.has(role))
  ) {
    add(...SCM_COLLECTIONS);
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
      collections.map(async (collection) => [
        collection,
        await readCollectionSnapshot(tenantRef, collection),
      ] as const)
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
