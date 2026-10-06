import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import { mpiRegistryDocPath, patientDocPath } from '@/lib/firestore/paths';
import { buildMpiRegistryKey } from '@/lib/clinical/mpi/patient-mpi';
import type { PatientMPI } from '@/types/mpi';

type LookupResult = {
  type: 'MRN' | 'CNIC';
  key: string;
  patientId: string;
};

async function resolveIdentifier(
  tenantId: string,
  type: 'MRN' | 'CNIC',
  value: string
): Promise<LookupResult | null> {
  const db = getAdminFirestore();
  if (!db) throw new Error('MPI_STORE_UNAVAILABLE');

  const key = buildMpiRegistryKey(type, value);
  const registry = await db.doc(mpiRegistryDocPath(tenantId, key)).get();
  if (!registry.exists) return null;

  const patientId = String(registry.data()?.patientId || '').trim();
  if (!patientId) throw new Error('MPI_REGISTRY_CORRUPT');

  return { type, key, patientId };
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '')
      .trim()
      .toLowerCase();
    const mrn = String(req.nextUrl.searchParams.get('mrn') || '').trim();
    const cnic = String(req.nextUrl.searchParams.get('cnic') || '').trim();

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }
    if (!mrn && !cnic) {
      return NextResponse.json(
        { error: 'Provide MRN or CNIC for exact MPI lookup.' },
        { status: 400 }
      );
    }

    await deriveAuthoritativeContext(req, tenantId);

    const lookups = (
      await Promise.all([
        mrn ? resolveIdentifier(tenantId, 'MRN', mrn) : Promise.resolve(null),
        cnic ? resolveIdentifier(tenantId, 'CNIC', cnic) : Promise.resolve(null),
      ])
    ).filter((item): item is LookupResult => Boolean(item));

    if (lookups.length === 0) {
      return NextResponse.json(
        { success: false, error: 'PATIENT_NOT_FOUND' },
        { status: 404 }
      );
    }

    const patientIds = new Set(lookups.map((item) => item.patientId));
    if (patientIds.size > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'MPI_IDENTIFIER_MISMATCH',
          message: 'The supplied MRN and CNIC resolve to different patient records.',
        },
        { status: 409 }
      );
    }

    const patientId = lookups[0].patientId;
    const db = getAdminFirestore();
    if (!db) throw new Error('MPI_STORE_UNAVAILABLE');

    const patientSnapshot = await db.doc(patientDocPath(tenantId, patientId)).get();
    if (!patientSnapshot.exists) {
      throw new Error('MPI_REGISTRY_PATIENT_MISSING');
    }

    const patient = patientSnapshot.data() as PatientMPI;
    return NextResponse.json({
      success: true,
      matchType:
        lookups.length === 2 ? 'MRN_AND_CNIC' : lookups[0].type,
      patient,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MPI lookup failed';
    const unauthorized = /AUTH|TENANT|UNAUTH/i.test(message);
    return NextResponse.json(
      { success: false, error: message },
      { status: unauthorized ? 403 : 500 }
    );
  }
}
