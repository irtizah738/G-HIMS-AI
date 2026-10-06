import { getAdminFirestore } from '../../server/firebase/admin';
import {
  mpiRegistryKey,
  normalizeMpiIdentifierValue,
  type AuthoritativeMpiIdentifierType,
} from '../../lib/clinical/mpi/mpi-identity';
import { mpiRegistryDocPath } from '../../lib/firestore/paths';

const tenantId = String(process.env.GHIMS_MPI_BACKFILL_TENANT_ID || '')
  .trim()
  .toLowerCase();
const confirmedTenant = String(
  process.env.GHIMS_MPI_BACKFILL_CONFIRM_TENANT || ''
)
  .trim()
  .toLowerCase();
const apply =
  String(process.env.GHIMS_MPI_BACKFILL_APPLY || '').toLowerCase() === 'true';

if (!tenantId || confirmedTenant !== tenantId) {
  throw new Error(
    'MPI_BACKFILL_TENANT_CONFIRMATION_REQUIRED: GHIMS_MPI_BACKFILL_CONFIRM_TENANT must exactly match GHIMS_MPI_BACKFILL_TENANT_ID.'
  );
}

const db = getAdminFirestore();
if (!db) throw new Error('MPI_BACKFILL_FIREBASE_ADMIN_UNAVAILABLE');

type RegistryEntry = {
  mpiKey: string;
  identifierType: AuthoritativeMpiIdentifierType;
  identifierValue: string;
  patientId: string;
  mrn: string;
  fullName: string;
  dateOfBirth: string;
};

const patientSnapshot = await db
  .collection('tenants')
  .doc(tenantId)
  .collection('patients')
  .get();

const byKey = new Map<string, RegistryEntry>();

for (const document of patientSnapshot.docs) {
  const patient = document.data() as Record<string, any>;
  const patientId = String(patient.patientId || patient.id || document.id).trim();
  const mergedIntoPatientId = String(
    patient.mergedIntoPatientId || patient.mergedInto || ''
  ).trim();
  const canonicalPatientId =
    String(patient.status || '').toUpperCase() === 'MERGED' &&
    mergedIntoPatientId
      ? mergedIntoPatientId
      : patientId;
  const mrn = String(patient.mrn || '').trim();
  const identifiers = Array.isArray(patient.identifiers)
    ? patient.identifiers
    : [];
  const cnic = String(
    identifiers.find(
      (identifier: any) =>
        String(identifier?.type || '').trim().toUpperCase() === 'CNIC'
    )?.value || ''
  ).trim();

  const identities: Array<{
    type: AuthoritativeMpiIdentifierType;
    value: string;
  }> = [
    ...(mrn ? [{ type: 'MRN' as const, value: mrn }] : []),
    ...(cnic ? [{ type: 'CNIC' as const, value: cnic }] : []),
  ];

  for (const identity of identities) {
    if (!normalizeMpiIdentifierValue(identity.value)) continue;
    const mpiKey = mpiRegistryKey(identity.type, identity.value);
    const entry: RegistryEntry = {
      mpiKey,
      identifierType: identity.type,
      identifierValue: identity.value,
      patientId: canonicalPatientId,
      mrn,
      fullName: String(patient.fullName || ''),
      dateOfBirth: String(patient.dateOfBirth || patient.dob || ''),
    };
    const existing = byKey.get(mpiKey);
    if (existing && existing.patientId !== entry.patientId) {
      throw new Error(
        `MPI_BACKFILL_SOURCE_CONFLICT:${mpiKey} maps to both ${existing.patientId} and ${entry.patientId}`
      );
    }
    byKey.set(mpiKey, entry);
  }
}

const entries = Array.from(byKey.values()).sort((a, b) =>
  a.mpiKey.localeCompare(b.mpiKey)
);
let created = 0;
let alreadyValid = 0;

if (apply) {
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk = entries.slice(offset, offset + 100);
    const chunkResult = await db.runTransaction(async (transaction) => {
      const refs = chunk.map((entry) =>
        db.doc(mpiRegistryDocPath(tenantId, entry.mpiKey))
      );
      const snapshots = await Promise.all(
        refs.map((ref) => transaction.get(ref))
      );
      let chunkCreated = 0;
      let chunkAlreadyValid = 0;

      for (let index = 0; index < chunk.length; index += 1) {
        const entry = chunk[index];
        const snapshot = snapshots[index];
        if (snapshot.exists) {
          const currentPatientId = String(
            (snapshot.data() || {}).patientId || ''
          ).trim();
          if (currentPatientId !== entry.patientId) {
            throw new Error(
              `MPI_BACKFILL_REGISTRY_CONFLICT:${entry.mpiKey} existing=${currentPatientId} expected=${entry.patientId}`
            );
          }
          chunkAlreadyValid += 1;
          continue;
        }

        transaction.create(refs[index], {
          ...entry,
          backfilledAt: new Date().toISOString(),
          backfillSource: 'G-HIMS_MPI_IDENTITY_BACKFILL_V1',
        });
        chunkCreated += 1;
      }

      return {
        created: chunkCreated,
        alreadyValid: chunkAlreadyValid,
      };
    });
    created += chunkResult.created;
    alreadyValid += chunkResult.alreadyValid;
  }
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      tenantId,
      dryRun: !apply,
      patientDocumentsScanned: patientSnapshot.size,
      canonicalRegistryEntries: entries.length,
      created,
      alreadyValid,
      message: apply
        ? 'Canonical MRN/CNIC MPI registry backfill completed.'
        : 'Dry run only. Set GHIMS_MPI_BACKFILL_APPLY=true after reviewing this count.',
    },
    null,
    2
  ) + '\n'
);
