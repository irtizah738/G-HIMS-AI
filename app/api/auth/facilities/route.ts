import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';

export const dynamic = 'force-dynamic';

type FacilityDirectoryItem = {
  tenantId: string;
  name: string;
  facilityCode?: string;
};

export async function GET() {
  try {
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        {
          facilities: [],
          error: 'Facility directory is temporarily unavailable.',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const snapshot = await db.collection('tenants').get();

    const facilities: FacilityDirectoryItem[] = snapshot.docs
      .map((document) => {
        const data = (document.data() || {}) as Record<string, unknown>;
        const tenantId = String(document.id || '').trim().toLowerCase();
        if (!tenantId) return null;

        const name =
          typeof data.name === 'string' && data.name.trim()
            ? data.name.trim()
            : typeof data.tenantName === 'string' && data.tenantName.trim()
              ? data.tenantName.trim()
              : `Hospital Organization (${tenantId})`;

        const facilityCode =
          typeof data.facilityCode === 'string' && data.facilityCode.trim()
            ? data.facilityCode.trim()
            : undefined;

        return {
          tenantId,
          name,
          ...(facilityCode ? { facilityCode } : {}),
        };
      })
      .filter((facility): facility is FacilityDirectoryItem => Boolean(facility))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(
      { facilities },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        facilities: [],
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load hospital facilities.',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
