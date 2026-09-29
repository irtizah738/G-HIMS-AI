import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';

const ALLOWED_ROLES = new Set([
  'DOCTOR',
  'CONSULTANT',
  'PHARMACIST',
  'SYSTEM_ADMIN',
  'ADMINISTRATOR',
]);

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, tenantId || undefined);
    if (!context.roles.some((role) => ALLOWED_ROLES.has(role.toUpperCase()))) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_ROLE', message: 'Clinical/pharmacy formulary access required.' },
        { status: 403 }
      );
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { error: 'FIRESTORE_ADMIN_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const [itemSnapshot, balanceSnapshot] = await Promise.all([
      tenantRef.collection('items').limit(500).get(),
      tenantRef.collection('inventoryBalances').limit(2000).get(),
    ]);

    const now = Date.now();
    const balances = balanceSnapshot.docs
      .map((doc) => doc.data())
      .filter((balance) => {
        const expiry = new Date(String(balance.expiryDate || '')).getTime();
        return Number(balance.available || 0) > 0 && Number.isFinite(expiry) && expiry > now;
      });

    const medications = itemSnapshot.docs
      .map((doc) => doc.data())
      .filter((item) => item.itemType === 'MEDICATION' && item.isActive !== false)
      .map((item) => {
        const itemBalances = balances
          .filter((balance) => balance.itemId === item.itemId)
          .sort(
            (a, b) =>
              new Date(String(a.expiryDate)).getTime() -
              new Date(String(b.expiryDate)).getTime()
          );

        return {
          itemId: item.itemId,
          itemCode: item.itemCode,
          drugName: item.name,
          genericName: item.genericName,
          description: item.description,
          unitOfMeasure: item.unitOfMeasure,
          sellingPrice: item.sellingPrice,
          currency: item.currency || 'PKR',
          totalAvailable: itemBalances.reduce(
            (sum, balance) => sum + Number(balance.available || 0),
            0
          ),
          nextFefoBatch: itemBalances[0]
            ? {
                batchNumber: itemBalances[0].batchNumber,
                expiryDate: itemBalances[0].expiryDate,
                available: itemBalances[0].available,
                locationId: itemBalances[0].locationId,
                locationName: itemBalances[0].locationName,
              }
            : null,
        };
      })
      .filter((item) => item.totalAvailable > 0);

    return NextResponse.json(
      {
        tenantId: context.tenantId,
        medications,
        generatedAt: Date.now(),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Formulary lookup failed.';
    const status = /AUTH|SESSION|TENANT|UNAUTHORIZED|ACCESS/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
