import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { getAdminFirestore } from '@/server/firebase/admin';
import { mpiRegistryDocPath } from '@/lib/firestore/paths';
import {
  legacyCnicRegistryKey,
  mpiRegistryKey,
  normalizeMpiIdentifierValue,
  type AuthoritativeMpiIdentifierType,
} from '@/lib/clinical/mpi/mpi-identity';

const MPI_LOOKUP_ROLES = [
  'RECEPTIONIST',
  'REGISTRAR',
  'DOCTOR',
  'CONSULTANT',
  'ATTENDING_PHYSICIAN',
  'NURSE',
  'SYSTEM_ADMIN',
  'ADMINISTRATOR',
] as const;

type RegistryRecord = {
  patientId?: string;
  mrn?: string;
  identifierType?: string;
  identifierValue?: string;
};

function requestedType(req: NextRequest): AuthoritativeMpiIdentifierType | 'AUTO' {
  const raw = String(req.nextUrl.searchParams.get('type') || 'AUTO')
    .trim()
    .toUpperCase();
  if (raw === 'MRN' || raw === 'CNIC') return raw;
  return 'AUTO';
}

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();
    const value = String(req.nextUrl.searchParams.get('value') || '').trim();
    if (!value) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MPI_LOOKUP_VALUE_REQUIRED',
            message: 'An institutional MRN or CNIC is required.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const normalized = normalizeMpiIdentifierValue(value);
    if (normalized.length < 5) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MPI_LOOKUP_VALUE_INVALID',
            message: 'Enter a complete MRN or CNIC.',
          },
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { context } = await deriveAuthoritativeContext(
      req,
      requestedTenantId || undefined,
      { touchSessionActivity: false }
    );
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [...MPI_LOOKUP_ROLES],
    });
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: auth.code || 'MPI_LOOKUP_FORBIDDEN',
            message: auth.reason || 'Patient identity lookup authority required.',
          },
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const db = getAdminFirestore();
    if (!db) throw new Error('MPI_LOOKUP_STORE_UNAVAILABLE');

    const type = requestedType(req);
    const keys = new Map<string, AuthoritativeMpiIdentifierType>();
    if (type === 'AUTO' || type === 'MRN') {
      keys.set(mpiRegistryKey('MRN', value), 'MRN');
    }
    if (type === 'AUTO' || type === 'CNIC') {
      keys.set(mpiRegistryKey('CNIC', value), 'CNIC');
      keys.set(legacyCnicRegistryKey(value), 'CNIC');
    }

    const entries = Array.from(keys.entries());
    const snapshots = await Promise.all(
      entries.map(([key]) =>
        db.doc(mpiRegistryDocPath(context.tenantId, key)).get()
      )
    );

    const matches = snapshots
      .map((snapshot, index) => ({
        snapshot,
        key: entries[index][0],
        type: entries[index][1],
      }))
      .filter((item) => item.snapshot.exists);

    const patientIds = Array.from(
      new Set(
        matches
          .map((match) =>
            String((match.snapshot.data() as RegistryRecord | undefined)?.patientId || '').trim()
          )
          .filter(Boolean)
      )
    );

    if (patientIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MPI_PATIENT_NOT_FOUND',
            message: 'No patient matches that MRN/CNIC in the active tenant.',
          },
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (patientIds.length > 1) {
      throw new Error(
        'MPI_REGISTRY_INTEGRITY_FAILURE: identity resolves to multiple patients.'
      );
    }

    const patientId = patientIds[0];
    const patientSnapshot = await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('patients')
      .doc(patientId)
      .get();
    if (!patientSnapshot.exists) {
      throw new Error(
        'MPI_REGISTRY_DANGLING_REFERENCE: registry patient does not exist.'
      );
    }

    const patient = patientSnapshot.data() as Record<string, unknown>;
    const identifiers = Array.isArray(patient.identifiers)
      ? (patient.identifiers as Array<Record<string, unknown>>)
      : [];
    const cnic = identifiers.find(
      (identifier) =>
        String(identifier.type || '').trim().toUpperCase() === 'CNIC'
    );

    return NextResponse.json(
      {
        success: true,
        match: {
          patientId,
          mrn: String(patient.mrn || ''),
          cnic: cnic ? String(cnic.value || '') : '',
          fullName: String(patient.fullName || ''),
          dateOfBirth: String(patient.dateOfBirth || ''),
          gender: String(patient.gender || ''),
          status: String(patient.status || 'ACTIVE'),
          matchedBy: matches.some((match) => match.type === 'MRN')
            ? 'MRN'
            : 'CNIC',
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'MPI identity lookup failed.';
    const accessDenied =
      /AUTH|TENANT|SESSION|ACCESS|FORBIDDEN|PERMISSION|DENIED/i.test(message);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: accessDenied
            ? 'MPI_LOOKUP_ACCESS_DENIED'
            : 'MPI_LOOKUP_FAILED',
          message,
        },
      },
      {
        status: accessDenied ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
