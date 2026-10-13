import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';

export const dynamic = 'force-dynamic';

interface LoginFacilityDirectoryItem {
  tenantId: string;
  name: string;
  facilityCode: string;
}

const FALLBACK_FACILITIES: LoginFacilityDirectoryItem[] = [
  { tenantId: 'central-metro-hospital', name: 'Central Metro General Hospital', facilityCode: 'CMGH-01' },
  { tenantId: 'government-gynae-hospital', name: 'Government Gynae Hospital', facilityCode: 'GGH-01' },
  { tenantId: 'grace-valley-general', name: 'Grace Valley General', facilityCode: 'GVGH-02' },
  { tenantId: 'st-jude-trauma-center', name: 'St. Jude Academic Trauma Center', facilityCode: 'SJTC-04' },
  { tenantId: 'beacon-childrens-clinic', name: 'Beacon Children’s & Specialty Clinic', facilityCode: 'BCSC-09' },
];

export async function GET() {
  const db = getAdminFirestore();

  if (!db) {
    return NextResponse.json(
      { facilities: FALLBACK_FACILITIES },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  try {
    const snapshot = await db.collection('tenants').get();

    if (snapshot.empty) {
      return NextResponse.json(
        { facilities: FALLBACK_FACILITIES },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

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
    console.warn('[auth/facilities] returning fallback tenant directory:', error);

    return NextResponse.json(
      { facilities: FALLBACK_FACILITIES },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
