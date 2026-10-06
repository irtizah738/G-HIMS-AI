import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';

const ALLOWED_ROLES = new Set([
  'DOCTOR',
  'CONSULTANT',
  'PHARMACIST',
  'SCM_MANAGER',
  'INVENTORY_OFFICER',
  'STORE_KEEPER',
  'SYSTEM_ADMIN',
  'ADMINISTRATOR',
]);

const ADMIN_ROLES = new Set([
  'SYSTEM_ADMIN',
  'ADMINISTRATOR',
]);

const INVENTORY_DETAIL_ROLES = new Set([
  'PHARMACIST',
  'SCM_MANAGER',
  'INVENTORY_OFFICER',
  'STORE_KEEPER',
]);

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();

    const { context } = await deriveAuthoritativeContext(
      req,
      tenantId || undefined
    );
    const roles = new Set(
      context.roles.map((role) => String(role || '').trim().toUpperCase())
    );
    if (![...roles].some((role) => ALLOWED_ROLES.has(role))) {
      return noStore(
        {
          error: 'INSUFFICIENT_ROLE',
          message: 'Clinical/pharmacy formulary access required.',
        },
        403
      );
    }

    const isAdmin = [...roles].some((role) => ADMIN_ROLES.has(role));
    const canViewInventoryDetail =
      isAdmin ||
      [...roles].some((role) => INVENTORY_DETAIL_ROLES.has(role));
    const facilityIds = new Set(
      (context.facilityIds || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );

    if (!isAdmin && facilityIds.size === 0) {
      return noStore(
        {
          error: 'FORMULARY_FACILITY_SCOPE_REQUIRED',
          message:
            'Formulary availability requires an authoritative facility assignment.',
        },
        403
      );
    }

    const db = getAdminFirestore();
    if (!db) {
      return noStore({ error: 'FIRESTORE_ADMIN_UNAVAILABLE' }, 503);
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const [itemSnapshot, balanceSnapshot] = await Promise.all([
      tenantRef.collection('items').limit(500).get(),
      tenantRef.collection('inventoryBalances').limit(2000).get(),
    ]);

    const now = Date.now();
    const balances = balanceSnapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as Record<string, unknown>
      )
      .filter((balance) => {
        const facilityId = String(balance.facilityId || '').trim();
        const expiry = new Date(String(balance.expiryDate || '')).getTime();
        return (
          (isAdmin || (facilityId && facilityIds.has(facilityId))) &&
          Number(balance.available || 0) > 0 &&
          Number.isFinite(expiry) &&
          expiry > now
        );
      });

    const medications = itemSnapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as Record<string, unknown>
      )
      .filter(
        (item) => item.itemType === 'MEDICATION' && item.isActive !== false
      )
      .map((item) => {
        const itemId = String(item.itemId || item.id || '').trim();
        const itemBalances = balances
          .filter(
            (balance) =>
              String(balance.itemId || '').trim() === itemId
          )
          .sort(
            (left, right) =>
              Date.parse(String(left.expiryDate || '')) -
              Date.parse(String(right.expiryDate || ''))
          );
        const totalAvailable = itemBalances.reduce(
          (sum, balance) => sum + Number(balance.available || 0),
          0
        );

        const base = {
          itemCode: String(item.itemCode || ''),
          drugName: String(item.name || ''),
          genericName: item.genericName
            ? String(item.genericName)
            : undefined,
          unitOfMeasure: String(
            item.issueUOM || item.unitOfMeasure || 'Unit'
          ),
          available: totalAvailable > 0,
        };

        if (!canViewInventoryDetail) {
          return base;
        }

        return {
          ...base,
          itemId,
          totalAvailable,
          nextFefoBatch: itemBalances[0]
            ? {
                batchNumber: String(itemBalances[0].batchNumber || ''),
                expiryDate: String(itemBalances[0].expiryDate || ''),
                available: Number(itemBalances[0].available || 0),
                facilityId: String(itemBalances[0].facilityId || ''),
                locationId: String(itemBalances[0].locationId || ''),
                locationName: String(itemBalances[0].locationName || ''),
              }
            : null,
        };
      })
      .filter((item) => item.available);

    return noStore({
      tenantId: context.tenantId,
      scope: {
        facilities: isAdmin ? ['*'] : [...facilityIds].sort(),
        inventoryDetail: canViewInventoryDetail,
      },
      medications,
      generatedAt: Date.now(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Formulary lookup failed.';
    const unauthorized =
      /AUTH|SESSION|TENANT|UNAUTHORIZED|ACCESS|FACILITY|SCOPE/i.test(message);
    return noStore(
      {
        error: unauthorized
          ? 'FORMULARY_ACCESS_DENIED'
          : 'FORMULARY_LOOKUP_FAILED',
      },
      unauthorized ? 403 : 500
    );
  }
}
