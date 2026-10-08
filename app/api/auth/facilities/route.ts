import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';

export const dynamic = 'force-dynamic';

interface LoginFacilityDirectoryItem {
  tenantId: string;
  name: string;
  facilityCode: string;
}

export async function GET() {
  const db = getAdminFirestore();

  if (!db) {
    return NextResponse.json(
      {
        facilities: [],
        error: 'Facility directory is unavailable.',
        code: 'FACILITY_DIRECTORY_UNAVAILABLE',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  try {
    const snapshot = await db.collection('tenants').get();

    const facilities: LoginFacilityDirectoryItem[] = snapshot.docs
      .map((doc) => {
        const data = (doc.data() || {}) as Record<string, unknown>;
        const name =
          typeof data.name === 'string' && data.name.trim()
            ? data.name.trim()
            : doc.id;
        const facilityCode =
          typeof data.facilityCode === 'string' && data.facilityCode.trim()
            ? data.facilityCode.trim()
            : doc.id;

        return {
          tenantId: doc.id,
          name,
          facilityCode,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(
      { facilities },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    console.error('[auth/facilities] failed to read tenant directory', error);

    return NextResponse.json(
      {
        facilities: [],
        error: 'Unable to load hospital facility directory.',
        code: 'FACILITY_DIRECTORY_READ_FAILED',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
