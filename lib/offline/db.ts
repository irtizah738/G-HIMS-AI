import Dexie, { Table } from 'dexie';
import {
  SyncMutation,
  OfflineCacheEntry,
  ClinicalPatientEntity,
  BedOccupancyEntity,
  SurgicalCaseEntity,
  MutationAction,
  MutationStatus,
  EdgeEntityRecord,
  EdgeEntityMapping,
  EdgeSyncMetadata,
} from '@/types/offline';
import { mergeClocks } from '@/lib/offline/vector-clock';
import { auth } from '@/lib/firebase/client';
import {
  decryptEdgeJson,
  encryptEdgeJson,
  type EncryptedEdgeEnvelope,
} from '@/lib/offline/crypto';

export class GHIMSDatabase extends Dexie {
  mutations!: Table<SyncMutation, string>;
  offline_cache!: Table<OfflineCacheEntry, string>;
  clinical_patients!: Table<ClinicalPatientEntity, string>;
  bed_occupancy!: Table<BedOccupancyEntity, string>;
  surgical_cases!: Table<SurgicalCaseEntity, string>;
  edge_entities!: Table<EdgeEntityRecord, string>;
  entity_map!: Table<EdgeEntityMapping, string>;
  sync_metadata!: Table<EdgeSyncMetadata, string>;

  constructor() {
    super('ghims_clinical_dexie_db');

    this.version(1).stores({
      mutations: 'id, tenantId, collection, docId, status, timestamp',
      offline_cache: 'key, tenantId, collection, updatedAt',
      clinical_patients: 'id, tenantId, mrn, name, bedId, acuityScore',
      bed_occupancy: 'id, tenantId, wardId, bedNumber, status',
      surgical_cases: 'id, tenantId, patientId, theaterId, status',
    });

    this.version(2).stores({
      mutations: 'id, tenantId, collection, docId, status, timestamp',
      offline_cache: 'key, tenantId, collection, updatedAt',
      clinical_patients: 'id, tenantId, mrn, name, bedId, acuityScore',
      bed_occupancy: 'id, tenantId, wardId, bedNumber, status',
      surgical_cases: 'id, tenantId, patientId, theaterId, status',
      edge_entities: 'key, [tenantId+collection], tenantId, collection, entityId, updatedAt',
      entity_map: 'key, tenantId, localId, canonicalId, entityType, status, updatedAt',
      sync_metadata: 'key, tenantId, scope, lastHydratedAt',
    });

    this.version(3)
      .stores({
        mutations: 'id, tenantId, collection, docId, status, timestamp, actorId',
        offline_cache: 'key, tenantId, collection, updatedAt, ownerUid',
        clinical_patients: 'id, tenantId, mrn, name, bedId, acuityScore',
        bed_occupancy: 'id, tenantId, wardId, bedNumber, status',
        surgical_cases: 'id, tenantId, patientId, theaterId, status',
        edge_entities: 'key, [tenantId+collection], tenantId, collection, entityId, updatedAt, ownerUid',
        entity_map: 'key, tenantId, localId, canonicalId, entityType, status, updatedAt',
        sync_metadata: 'key, tenantId, scope, lastHydratedAt',
      })
      .upgrade(async (transaction) => {
        // Legacy read caches were plaintext. They are disposable projections, so
        // remove them rather than preserving PHI across the encryption migration.
        await transaction.table('offline_cache').clear();
        await transaction.table('edge_entities').clear();
      });
  }
}

// Singleton database instance
export const localDb = new GHIMSDatabase();

// ----------------------------------------------------------------------
// Convenience Helpers for Clinical Entities & Mutations
// ----------------------------------------------------------------------

function currentOwnerUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('EDGE_ENCRYPTION_AUTH_REQUIRED');
  return uid;
}

async function decryptStoredMutation(row: SyncMutation): Promise<SyncMutation> {
  if (!row.encryptedPayload) return row;
  const uid = auth.currentUser?.uid;
  if (!uid || row.actorId !== uid) return { ...row, payload: {} };
  const payload = await decryptEdgeJson<Record<string, any>>(
    row.tenantId,
    uid,
    row.encryptedPayload as EncryptedEdgeEnvelope
  );
  return { ...row, payload };
}

async function decryptStoredCacheEntry(row: OfflineCacheEntry): Promise<OfflineCacheEntry> {
  if (!row.encryptedData) return row;
  const uid = auth.currentUser?.uid;
  if (!uid || row.ownerUid !== uid) return { ...row, data: {} };
  const data = await decryptEdgeJson<Record<string, unknown>>(
    row.tenantId,
    uid,
    row.encryptedData as EncryptedEdgeEnvelope
  );
  return { ...row, data };
}

async function decryptStoredEdgeEntity(row: EdgeEntityRecord): Promise<EdgeEntityRecord> {
  if (!row.encryptedData) return row;
  const uid = auth.currentUser?.uid;
  if (!uid || row.ownerUid !== uid) return { ...row, data: {} };
  const data = await decryptEdgeJson<Record<string, unknown>>(
    row.tenantId,
    uid,
    row.encryptedData as EncryptedEdgeEnvelope
  );
  return { ...row, data };
}

export async function getLocalMutations(tenantId?: string): Promise<SyncMutation[]> {
  try {
    if (tenantId) {
      const rows = await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .sortBy('timestamp');
      return Promise.all(rows.map(decryptStoredMutation));
    }
    const rows = await localDb.mutations.orderBy('timestamp').toArray();
    return Promise.all(rows.map(decryptStoredMutation));
  } catch (error) {
    console.warn('Failed to retrieve mutations from Dexie:', error);
    return [];
  }
}

export async function getPendingMutationsFromDb(tenantId?: string): Promise<SyncMutation[]> {
  try {
    if (tenantId) {
      const rows = await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .filter((m) => m.status === 'pending' || m.status === 'failed')
        .sortBy('timestamp');
      return Promise.all(rows.map(decryptStoredMutation));
    }
    const rows = await localDb.mutations
      .filter((m) => m.status === 'pending' || m.status === 'failed')
      .sortBy('timestamp');
    return Promise.all(rows.map(decryptStoredMutation));
  } catch (error) {
    console.warn('Failed to retrieve pending mutations from Dexie:', error);
    return [];
  }
}

export async function getPendingVectorClock(
  tenantId?: string
): Promise<Record<string, number>> {
  try {
    const mutations = tenantId
      ? await localDb.mutations.where('tenantId').equals(tenantId).toArray()
      : await localDb.mutations.toArray();

    return mutations
      .filter((mutation) => mutation.status !== 'syncing' || Boolean(mutation.vectorClock))
      .reduce<Record<string, number>>(
        (clock, mutation) => mergeClocks(clock, mutation.vectorClock),
        {}
      );
  } catch (error) {
    console.warn('Failed to derive pending vector clock from Dexie:', error);
    return {};
  }
}

export async function measureLocalStoreLatency(
  tenantId?: string
): Promise<number | null> {
  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const startedAt = now();
  try {
    if (tenantId) {
      await localDb.mutations.where('tenantId').equals(tenantId).count();
    } else {
      await localDb.mutations.count();
    }
    return Math.max(0, Number((now() - startedAt).toFixed(2)));
  } catch (error) {
    console.warn('Failed to measure local IndexedDB latency:', error);
    return null;
  }
}

export async function putLocalCacheEntry(entry: OfflineCacheEntry): Promise<string> {
  const ownerUid = currentOwnerUid();
  const encryptedData = await encryptEdgeJson(entry.tenantId, ownerUid, entry.data);
  return localDb.offline_cache.put({
    ...entry,
    ownerUid,
    data: {},
    encryptedData,
  });
}

export async function getLocalCacheEntry(key: string): Promise<OfflineCacheEntry | undefined> {
  const row = await localDb.offline_cache.get(key);
  return row ? decryptStoredCacheEntry(row) : undefined;
}

function assertDemoSeedAllowed(): void {
  const mode = String(
    process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE ||
    process.env.GHIMS_RUNTIME_MODE ||
    ''
  ).trim().toUpperCase();

  if (mode !== 'DEMO' && process.env.NODE_ENV !== 'test') {
    throw new Error('DEMO_SEED_FORBIDDEN: synthetic clinical data is DEMO-only.');
  }
}

export async function seedDefaultBedOccupancy(tenantId: string): Promise<void> {
  assertDemoSeedAllowed();
  const existing = await localDb.bed_occupancy.where('tenantId').equals(tenantId).count();
  if (existing > 0) return;

  const defaultBeds: BedOccupancyEntity[] = [
    {
      id: `bed-icu-101`,
      tenantId,
      wardId: 'ward-icu',
      wardName: 'ICU',
      bedNumber: 'ICU-01',
      roomNumber: 'Suite 101',
      status: 'Occupied',
      patientId: 'pat-101',
      patientName: 'Robert Martinez',
      patientMrn: 'GH-2026-1042',
      primaryDiagnosis: 'Post-CABG Hemodynamic Monitoring',
      acuityScore: 7,
      acuityLevel: 'High',
      attendingDoctor: 'Dr. Sarah Jenkins, FACS',
      assignedNurse: 'Sister Clara Oswald, RN',
      admissionDate: '2026-08-14',
      lengthOfStayDays: 3,
      isolationType: 'none',
      oxygenPort: true,
      telemetryEnabled: true,
      notes: 'Requires 1:1 telemetry arterial line monitoring',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-icu-102`,
      tenantId,
      wardId: 'ward-icu',
      wardName: 'ICU',
      bedNumber: 'ICU-02',
      roomNumber: 'Suite 102',
      status: 'Occupied',
      patientId: 'pat-102',
      patientName: 'Eleanor Vance',
      patientMrn: 'GH-2026-3391',
      primaryDiagnosis: 'Acute Hypoxemic Respiratory Distress (COPD)',
      acuityScore: 5,
      acuityLevel: 'Medium',
      attendingDoctor: 'Dr. Marcus Vance, FCCP',
      assignedNurse: 'Nurse David K., BSN',
      admissionDate: '2026-08-15',
      lengthOfStayDays: 2,
      isolationType: 'droplet',
      oxygenPort: true,
      telemetryEnabled: true,
      notes: 'BiPAP nocturnal support, SpO2 scale 2 target 88-92%',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-icu-103`,
      tenantId,
      wardId: 'ward-icu',
      wardName: 'ICU',
      bedNumber: 'ICU-03',
      roomNumber: 'Suite 103',
      status: 'Available',
      oxygenPort: true,
      telemetryEnabled: true,
      isolationType: 'none',
      notes: 'Decontaminated & terminal clean complete. Ready for admission.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-icu-104`,
      tenantId,
      wardId: 'ward-icu',
      wardName: 'ICU',
      bedNumber: 'ICU-04',
      roomNumber: 'Suite 104',
      status: 'Housekeeping',
      notes: 'Discharged at 08:30. UV-C sterilization cycle in progress.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-ccu-201`,
      tenantId,
      wardId: 'ward-ccu',
      wardName: 'CCU',
      bedNumber: 'CCU-01',
      roomNumber: 'Suite 201',
      status: 'Occupied',
      patientId: 'pat-201',
      patientName: 'Sofia Chen',
      patientMrn: 'GH-2026-7731',
      primaryDiagnosis: 'STEMI Status Post Primary PCI to LAD',
      acuityScore: 4,
      acuityLevel: 'Low-Medium',
      attendingDoctor: 'Dr. Kamran Baig, FACC',
      assignedNurse: 'Nurse Emma Watson',
      admissionDate: '2026-08-16',
      lengthOfStayDays: 1,
      isolationType: 'none',
      oxygenPort: true,
      telemetryEnabled: true,
      notes: 'Radial sheath removed. Distal pulses 2+ symmetric.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-ccu-202`,
      tenantId,
      wardId: 'ward-ccu',
      wardName: 'CCU',
      bedNumber: 'CCU-02',
      roomNumber: 'Suite 202',
      status: 'Available',
      oxygenPort: true,
      telemetryEnabled: true,
      isolationType: 'none',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-medsurg-301`,
      tenantId,
      wardId: 'ward-medsurg',
      wardName: 'Med-Surg',
      bedNumber: 'MS-301',
      roomNumber: 'Room 301-A',
      status: 'Occupied',
      patientId: 'pat-301',
      patientName: 'Zubair Ahmed',
      patientMrn: 'GH-2026-3108',
      primaryDiagnosis: 'Post-Op Splenorrhaphy & Laparotomy',
      acuityScore: 2,
      acuityLevel: 'Low',
      attendingDoctor: 'Dr. Sarah Jenkins',
      assignedNurse: 'Nurse Rachel Green',
      admissionDate: '2026-08-15',
      lengthOfStayDays: 2,
      isolationType: 'none',
      oxygenPort: true,
      telemetryEnabled: false,
      notes: 'Tolerating clear liquids. Drain output <50mL serosanguinous.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-medsurg-302`,
      tenantId,
      wardId: 'ward-medsurg',
      wardName: 'Med-Surg',
      bedNumber: 'MS-302',
      roomNumber: 'Room 301-B',
      status: 'Available',
      oxygenPort: true,
      telemetryEnabled: false,
      isolationType: 'none',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-medsurg-303`,
      tenantId,
      wardId: 'ward-medsurg',
      wardName: 'Med-Surg',
      bedNumber: 'MS-303',
      roomNumber: 'Room 302-A',
      status: 'Isolation',
      patientId: 'pat-303',
      patientName: 'Hannah Abbott',
      patientMrn: 'GH-2026-9012',
      primaryDiagnosis: 'Clostridioides Difficile Colitis',
      acuityScore: 3,
      acuityLevel: 'Low',
      attendingDoctor: 'Dr. Michael Chang',
      assignedNurse: 'Nurse Rachel Green',
      admissionDate: '2026-08-16',
      lengthOfStayDays: 1,
      isolationType: 'contact',
      oxygenPort: true,
      telemetryEnabled: false,
      notes: 'Strict enteric contact precautions. Soap & water hand hygiene only.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-peds-401`,
      tenantId,
      wardId: 'ward-peds',
      wardName: 'Pediatrics',
      bedNumber: 'PED-401',
      roomNumber: 'Room 401',
      status: 'Occupied',
      patientId: 'pat-401',
      patientName: 'Leo Morrison',
      patientMrn: 'GH-2026-5521',
      primaryDiagnosis: 'Acute Bronchiolitis (RSV+)',
      acuityScore: 3,
      acuityLevel: 'Low',
      attendingDoctor: 'Dr. Elena Drake, FAAP',
      assignedNurse: 'Nurse Maya Patel, CPN',
      admissionDate: '2026-08-16',
      lengthOfStayDays: 1,
      isolationType: 'droplet',
      oxygenPort: true,
      telemetryEnabled: true,
      notes: 'High-flow nasal cannula at 4L/min 30% FiO2. Parents rooming-in.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-mat-501`,
      tenantId,
      wardId: 'ward-mat',
      wardName: 'Maternity',
      bedNumber: 'MAT-501',
      roomNumber: 'Suite 501',
      status: 'Occupied',
      patientId: 'pat-501',
      patientName: 'Amira Tariq',
      patientMrn: 'GH-2026-6411',
      primaryDiagnosis: 'Postpartum Day 1 (Normal Spontaneous Vaginal Delivery)',
      acuityScore: 0,
      acuityLevel: 'Low',
      attendingDoctor: 'Dr. Ayesha Malik, FACOG',
      assignedNurse: 'Midwife Clara Oswald',
      admissionDate: '2026-08-16',
      lengthOfStayDays: 1,
      isolationType: 'none',
      oxygenPort: true,
      telemetryEnabled: false,
      notes: 'Mother and neonate rooming-in. Exclusive breastfeeding established.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: `bed-mat-502`,
      tenantId,
      wardId: 'ward-mat',
      wardName: 'Maternity',
      bedNumber: 'MAT-502',
      roomNumber: 'Suite 502',
      status: 'Maintenance',
      notes: 'Hydraulic bed motor replacement in progress. Bio-Med ticket #BM-884.',
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
  ];

  await localDb.bed_occupancy.bulkPut(defaultBeds);
}

export async function seedDefaultSurgicalCases(tenantId: string): Promise<void> {
  assertDemoSeedAllowed();
  const existing = await localDb.surgical_cases.where('tenantId').equals(tenantId).count();
  if (existing > 0) return;

  const defaultCases: SurgicalCaseEntity[] = [
    {
      id: 'case-or-101',
      tenantId,
      patientId: 'pat-101',
      patientName: 'Robert Martinez',
      patientMrn: 'GH-2026-1042',
      patientAge: 63,
      patientGender: 'Male',
      theaterId: 'or-suite-1',
      theaterRoom: 'OR Suite 1 (Cardiothoracic)',
      procedureName: 'Off-Pump Coronary Artery Bypass Graft (CABG x3)',
      cptCode: 'CPT 33512',
      leadSurgeon: 'Dr. Sarah Jenkins, FACS',
      anesthesiologist: 'Dr. Marcus Vance, MD',
      scrubNurse: 'Sister Clara Oswald, RN',
      circulatingNurse: 'Nurse David K., RN',
      scheduledTime: '08:30 AM',
      status: 'intra_op',
      whoChecklist: {
        signIn: {
          completed: true,
          completedAt: '2026-08-17T08:15:00Z',
          verifiedBy: 'Dr. Marcus Vance',
          patientIdentityConfirmed: true,
          siteMarked: true,
          anesthesiaSafetyCheckComplete: true,
          pulseOximeterFunctioning: true,
          allergyKnown: true,
          allergyDetails: 'Penicillin (Anaphylaxis)',
          difficultAirwayRisk: false,
          bloodLossRiskOver500ml: true,
          adequateIVAccessAndFluids: true,
        },
        timeOut: {
          completed: true,
          completedAt: '2026-08-17T08:45:00Z',
          verifiedBy: 'Dr. Sarah Jenkins',
          teamIntroducedWithRoles: true,
          patientNameAndProcedureConfirmed: true,
          antibioticProphylaxisGivenWithin60Min: true,
          prophylaxisNameAndDose: 'Cefazolin 2g IV at 08:05',
          surgeonCriticalStepsReview: true,
          anesthesiaReview: true,
          nursingSterilityReview: true,
          essentialImagingDisplayed: true,
        },
        signOut: {
          completed: false,
          procedureRecordedVerbal: false,
          instrumentCountsExact: false,
          spongeCountsExact: false,
          needleCountsExact: false,
          specimenLabeledCorrectly: false,
          equipmentProblemsFlagged: false,
          recoveryAndPostOpPlanReviewed: false,
        },
      },
      surgicalCountReconciliation: {
        spongesInitial: 20,
        spongesAdded: 10,
        spongesFinal: 30,
        needlesInitial: 15,
        needlesAdded: 5,
        needlesFinal: 20,
        instrumentsInitial: 84,
        instrumentsAdded: 0,
        instrumentsFinal: 84,
        scrubNurseSigned: true,
        scrubNurseName: 'Sister Clara Oswald',
        scrubNurseSignedAt: '2026-08-17T08:30:00Z',
        circulatingNurseSigned: false,
        countsReconciled: false,
      },
      aldreteScore: undefined,
      updatedAt: Date.now(),
      vectorClock: { localNode: 1 },
    },
    {
      id: 'case-or-102',
      tenantId,
      patientId: 'pat-102',
      patientName: 'Eleanor Vance',
      patientMrn: 'GH-2026-3391',
      patientAge: 71,
      patientGender: 'Female',
      theaterId: 'or-suite-2',
      theaterRoom: 'OR Suite 2 (Orthopedics & Robotic)',
      procedureName: 'Robotic-Assisted Total Knee Arthroplasty (TKA)',
      cptCode: 'CPT 27447',
      leadSurgeon: 'Dr. Kamran Baig, FAAOS',
      anesthesiologist: 'Dr. Elena Drake, MD',
      scrubNurse: 'Nurse Maya Patel, RN',
      circulatingNurse: 'Nurse Rachel Green, RN',
      scheduledTime: '10:00 AM',
      status: 'pacu_recovery',
      whoChecklist: {
        signIn: {
          completed: true,
          completedAt: '2026-08-17T09:45:00Z',
          verifiedBy: 'Dr. Elena Drake',
          patientIdentityConfirmed: true,
          siteMarked: true,
          anesthesiaSafetyCheckComplete: true,
          pulseOximeterFunctioning: true,
          allergyKnown: false,
          difficultAirwayRisk: false,
          bloodLossRiskOver500ml: false,
        },
        timeOut: {
          completed: true,
          completedAt: '2026-08-17T10:10:00Z',
          verifiedBy: 'Dr. Kamran Baig',
          teamIntroducedWithRoles: true,
          patientNameAndProcedureConfirmed: true,
          antibioticProphylaxisGivenWithin60Min: true,
          prophylaxisNameAndDose: 'Vancomycin 1g IV at 09:15',
          surgeonCriticalStepsReview: true,
          anesthesiaReview: true,
          nursingSterilityReview: true,
          essentialImagingDisplayed: true,
        },
        signOut: {
          completed: true,
          completedAt: '2026-08-17T11:55:00Z',
          verifiedBy: 'Nurse Maya Patel',
          procedureRecordedVerbal: true,
          instrumentCountsExact: true,
          spongeCountsExact: true,
          needleCountsExact: true,
          specimenLabeledCorrectly: true,
          equipmentProblemsFlagged: false,
          recoveryAndPostOpPlanReviewed: true,
        },
      },
      surgicalCountReconciliation: {
        spongesInitial: 15,
        spongesAdded: 0,
        spongesFinal: 15,
        needlesInitial: 10,
        needlesAdded: 0,
        needlesFinal: 10,
        instrumentsInitial: 62,
        instrumentsAdded: 0,
        instrumentsFinal: 62,
        scrubNurseSigned: true,
        scrubNurseName: 'Nurse Maya Patel',
        scrubNurseSignedAt: '2026-08-17T11:45:00Z',
        circulatingNurseSigned: true,
        circulatingNurseName: 'Nurse Rachel Green',
        circulatingNurseSignedAt: '2026-08-17T11:50:00Z',
        countsReconciled: true,
      },
      aldreteScore: {
        activity: 2,
        respiration: 2,
        circulation: 2,
        consciousness: 2,
        oxygenSaturation: 2,
        totalScore: 10,
        assessedAt: '2026-08-17T12:30:00Z',
        assessedBy: 'Nurse David K., PACU RN',
        dischargeReady: true,
        notes: 'Alert, oriented x4. Stable hemodynamics. Cleared for Ortho Ward 3 transfer.',
      },
      updatedAt: Date.now(),
      vectorClock: { localNode: 2 },
    },
  ];

  await localDb.surgical_cases.bulkPut(defaultCases);
}

// ----------------------------------------------------------------------
// Compatibility aliases & mutation helpers
// ----------------------------------------------------------------------

export type OfflineMutation = SyncMutation;
export type { MutationAction, MutationStatus } from '@/types/offline';

export interface SyncConflict {
  id: string;
  mutationId?: string;
  tenantId: string;
  collection: string;
  resourceId?: string;
  serverData?: Record<string, any>;
  clientData?: Record<string, any>;
  strategy?: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE';
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  timestamp?: number;
  [key: string]: any;
}

export async function getPendingMutations(tenantId?: string): Promise<SyncMutation[]> {
  return getPendingMutationsFromDb(tenantId);
}

export async function addMutation(
  mutationOrParams:
    | SyncMutation
    | {
        tenantId: string;
        actorId?: string;
        collection: string;
        action: MutationAction;
        resourceId?: string;
        docId?: string;
        payload: Record<string, any>;
        commandType?: string;
        idempotencyKey?: string;
        schemaVersion?: number;
        baseEntityVersion?: number;
        id?: string;
        vectorClock?: Record<string, number>;
        clientTimestamp?: number;
      }
): Promise<SyncMutation> {
  const docId = mutationOrParams.docId || (mutationOrParams as any).resourceId || `doc_${Date.now()}`;
  const resourceId = (mutationOrParams as any).resourceId || docId;
  const now = Date.now();
  const mutation: SyncMutation = {
    id: mutationOrParams.id || `mut_${now}_${Math.random().toString(36).substring(2, 9)}`,
    tenantId: mutationOrParams.tenantId,
    actorId: (mutationOrParams as any).actorId,
    collection: mutationOrParams.collection,
    docId,
    resourceId,
    action: mutationOrParams.action,
    commandType: (mutationOrParams as any).commandType,
    idempotencyKey: (mutationOrParams as any).idempotencyKey,
    schemaVersion: (mutationOrParams as any).schemaVersion || 1,
    baseEntityVersion: (mutationOrParams as any).baseEntityVersion,
    payload: mutationOrParams.payload || {},
    vectorClock: (mutationOrParams as any).vectorClock || { localNode: 1 },
    timestamp: (mutationOrParams as any).timestamp || now,
    clientTimestamp: (mutationOrParams as any).clientTimestamp || now,
    retryCount: (mutationOrParams as any).retryCount || 0,
    status: (mutationOrParams as any).status || 'pending',
    errorMessage: (mutationOrParams as any).errorMessage,
    conflictDetails: (mutationOrParams as any).conflictDetails,
  };

  await localDb.mutations.put(mutation);
  return mutation;
}

export async function updateMutationStatus(
  id: string,
  status: SyncMutation['status'],
  error?: string
): Promise<void> {
  const existing = await localDb.mutations.get(id);
  if (existing) {
    await localDb.mutations.update(id, {
      status,
      errorMessage: error || existing.errorMessage,
      retryCount: (existing.retryCount || 0) + (status === 'failed' ? 1 : 0),
    });
  }
}

export async function deleteMutation(id: string): Promise<void> {
  await localDb.mutations.delete(id);
}

export async function saveToOfflineCache(
  arg1: string,
  arg2: any,
  arg3?: string | any,
  arg4?: any
): Promise<void> {
  // Support both saveToOfflineCache(key, data, tenantId?, collection?)
  // and saveToOfflineCache(tenantId, collection, resourceId, data)
  let key: string;
  let tenantId: string;
  let collection: string;
  let data: any;

  if (arg4 !== undefined) {
    // 4 args: (tenantId, collection, resourceId, data)
    tenantId = arg1;
    collection = arg2;
    key = `${tenantId}:${collection}:${arg3}`;
    data = arg4;
  } else {
    key = arg1;
    data = arg2;
    tenantId = typeof arg3 === 'string' ? arg3 : 'default';
    collection = 'general';
  }

  await localDb.offline_cache.put({
    key,
    tenantId,
    collection,
    data,
    updatedAt: Date.now(),
    vectorClock: {},
  });
}

export async function recordSyncConflict(conflict: any): Promise<void> {
  const conflictKey = `conflict_${conflict.mutationId || conflict.id || Date.now()}`;
  await localDb.offline_cache.put({
    key: conflictKey,
    tenantId: conflict.tenantId || 'default',
    collection: 'conflicts',
    data: conflict,
    updatedAt: Date.now(),
    vectorClock: {},
  });
}

export async function getSyncConflicts(tenantId?: string): Promise<SyncConflict[]> {
  const entries = await localDb.offline_cache
    .where('collection')
    .equals('conflicts')
    .toArray();
  if (tenantId) {
    return entries.filter((e) => e.tenantId === tenantId).map((e) => e.data as SyncConflict);
  }
  return entries.map((e) => e.data as SyncConflict);
}

export async function resolveSyncConflict(
  _conflictId: string,
  _strategy?: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE',
  _resolvedBy?: string
): Promise<void> {
  throw new Error(
    'SERVER_RECONCILIATION_REQUIRED: clinical sync conflicts cannot be resolved or discarded by the browser.'
  );
}



/**
 * Clear PHI-bearing read caches for a tenant when a user leaves a shared workstation.
 * Pending governed mutations are deliberately preserved and remain bound to their
 * originating Firebase UID for later replay by that same user.
 */
export async function clearOfflineReadModelsForTenant(tenantId: string): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) return;

  await localDb.transaction(
    'rw',
    localDb.offline_cache,
    localDb.clinical_patients,
    localDb.bed_occupancy,
    localDb.surgical_cases,
    async () => {
      await localDb.offline_cache.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.clinical_patients.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.bed_occupancy.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.surgical_cases.where('tenantId').equals(normalizedTenantId).delete();
    }
  );
}


export async function replaceTenantEdgeSnapshot(
  tenantId: string,
  collections: Record<string, Array<Record<string, unknown>>>,
  metadata: Omit<EdgeSyncMetadata, 'key' | 'tenantId' | 'scope'> & { scope?: string }
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId) throw new Error('EDGE_TENANT_REQUIRED');

  const records: EdgeEntityRecord[] = [];
  for (const [collection, entities] of Object.entries(collections || {})) {
    for (const entity of entities || []) {
      const entityId = String(
        (entity as any).id ||
        (entity as any).patientId ||
        (entity as any).encounterId ||
        (entity as any).orderId ||
        (entity as any).tokenId ||
        (entity as any).evidenceId ||
        (entity as any).findingId ||
        ''
      ).trim();
      if (!entityId) continue;
      records.push({
        key: `${normalizedTenantId}:${collection}:${entityId}`,
        tenantId: normalizedTenantId,
        collection,
        entityId,
        data: entity,
        updatedAt: Date.now(),
        serverVersion: Number(
          (entity as any)._serverVersion ??
          (entity as any).serverVersion ??
          (entity as any).version ??
          0
        ),
      });
    }
  }

  const collectionNames = Object.keys(collections || {});
  await localDb.transaction(
    'rw',
    localDb.edge_entities,
    localDb.sync_metadata,
    async () => {
      for (const collection of collectionNames) {
        await localDb.edge_entities
          .where('[tenantId+collection]')
          .equals([normalizedTenantId, collection])
          .delete();
      }
      if (records.length > 0) await localDb.edge_entities.bulkPut(records);
      const scope = metadata.scope || 'clinical-core';
      await localDb.sync_metadata.put({
        key: `${normalizedTenantId}:${scope}`,
        tenantId: normalizedTenantId,
        scope,
        snapshotVersion: metadata.snapshotVersion,
        lastHydratedAt: metadata.lastHydratedAt,
        serverGeneratedAt: metadata.serverGeneratedAt,
      });
    }
  );
}

export async function listEdgeEntities<T extends Record<string, unknown> = Record<string, unknown>>(
  tenantId: string,
  collection: string
): Promise<T[]> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId || !collection) return [];
  const rows = await localDb.edge_entities
    .where('[tenantId+collection]')
    .equals([normalizedTenantId, collection])
    .toArray();
  return rows
    .filter((row) => !row.deleted)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .map((row) => row.data as T);
}

export async function getEdgeEntity<T extends Record<string, unknown> = Record<string, unknown>>(
  tenantId: string,
  collection: string,
  entityId: string
): Promise<T | null> {
  const key = `${String(tenantId || '').trim().toLowerCase()}:${collection}:${entityId}`;
  const row = await localDb.edge_entities.get(key);
  return row && !row.deleted ? (row.data as T) : null;
}

export async function getEdgeEntityRecord(
  tenantId: string,
  collection: string,
  entityId: string
): Promise<EdgeEntityRecord | null> {
  const key = `${String(tenantId || '').trim().toLowerCase()}:${collection}:${entityId}`;
  return (await localDb.edge_entities.get(key)) || null;
}

export async function getEdgeSyncMetadata(
  tenantId: string,
  scope = 'clinical-core'
): Promise<EdgeSyncMetadata | null> {
  const key = `${String(tenantId || '').trim().toLowerCase()}:${scope}`;
  return (await localDb.sync_metadata.get(key)) || null;
}

export async function clearTenantEdgeEntities(tenantId: string): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId) return;
  await localDb.transaction(
    'rw',
    localDb.edge_entities,
    localDb.sync_metadata,
    async () => {
      await localDb.edge_entities.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.sync_metadata.where('tenantId').equals(normalizedTenantId).delete();
    }
  );
}


export async function putEdgeEntity(
  tenantId: string,
  collection: string,
  entityId: string,
  data: Record<string, unknown>,
  serverVersion?: number
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedEntityId = String(entityId || '').trim();
  if (!normalizedTenantId || !collection || !normalizedEntityId) {
    throw new Error('EDGE_ENTITY_IDENTITY_REQUIRED');
  }
  await localDb.edge_entities.put({
    key: `${normalizedTenantId}:${collection}:${normalizedEntityId}`,
    tenantId: normalizedTenantId,
    collection,
    entityId: normalizedEntityId,
    data,
    updatedAt: Date.now(),
    serverVersion,
  });
}

export async function putEntityMapping(
  tenantId: string,
  entityType: string,
  localId: string,
  canonicalId?: string
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const now = Date.now();
  await localDb.entity_map.put({
    key: `${normalizedTenantId}:${entityType}:${localId}`,
    tenantId: normalizedTenantId,
    localId,
    canonicalId,
    entityType,
    status: canonicalId ? 'MAPPED' : 'LOCAL_ONLY',
    createdAt: now,
    updatedAt: now,
  });
}

export async function getCanonicalEntityId(
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<string> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const mapping = await localDb.entity_map.get(
    `${normalizedTenantId}:${entityType}:${entityId}`
  );
  return mapping?.canonicalId || entityId;
}

function replaceMappedIds(
  value: unknown,
  mappings: Map<string, string>
): unknown {
  if (typeof value === 'string') return mappings.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => replaceMappedIds(item, mappings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        replaceMappedIds(nested, mappings),
      ])
    );
  }
  return value;
}

export async function applyCanonicalEntityMappings(
  tenantId: string,
  mappings: Array<{
    entityType: string;
    localId: string;
    canonicalId: string;
    collection?: string;
  }>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId || mappings.length === 0) return;

  const replacementMap = new Map(
    mappings.map((mapping) => [mapping.localId, mapping.canonicalId])
  );

  await localDb.transaction(
    'rw',
    localDb.entity_map,
    localDb.edge_entities,
    localDb.mutations,
    localDb.offline_cache,
    async () => {
      for (const mapping of mappings) {
        const key = `${normalizedTenantId}:${mapping.entityType}:${mapping.localId}`;
        const previous = await localDb.entity_map.get(key);
        await localDb.entity_map.put({
          key,
          tenantId: normalizedTenantId,
          localId: mapping.localId,
          canonicalId: mapping.canonicalId,
          entityType: mapping.entityType,
          status: 'MAPPED',
          createdAt: previous?.createdAt || Date.now(),
          updatedAt: Date.now(),
        });

        if (mapping.collection) {
          const localKey = `${normalizedTenantId}:${mapping.collection}:${mapping.localId}`;
          const existing = await localDb.edge_entities.get(localKey);
          if (existing) {
            await localDb.edge_entities.delete(localKey);
            await localDb.edge_entities.put({
              ...existing,
              key: `${normalizedTenantId}:${mapping.collection}:${mapping.canonicalId}`,
              entityId: mapping.canonicalId,
              data: replaceMappedIds(existing.data, replacementMap) as Record<string, unknown>,
              updatedAt: Date.now(),
            });
          }
        }
      }

      const tenantMutations = await localDb.mutations.where('tenantId').equals(normalizedTenantId).toArray();
      for (const mutation of tenantMutations) {
        const rewrittenPayload = replaceMappedIds(mutation.payload, replacementMap) as Record<string, unknown>;
        const rewrittenDocId = replacementMap.get(mutation.docId) || mutation.docId;
        const rewrittenResourceId = mutation.resourceId
          ? replacementMap.get(mutation.resourceId) || mutation.resourceId
          : mutation.resourceId;
        if (
          rewrittenDocId !== mutation.docId ||
          rewrittenResourceId !== mutation.resourceId ||
          JSON.stringify(rewrittenPayload) !== JSON.stringify(mutation.payload)
        ) {
          await localDb.mutations.update(mutation.id, {
            docId: rewrittenDocId,
            resourceId: rewrittenResourceId,
            payload: rewrittenPayload,
          });
        }
      }

      const cached = await localDb.offline_cache.where('tenantId').equals(normalizedTenantId).toArray();
      for (const entry of cached) {
        const rewrittenData = replaceMappedIds(entry.data, replacementMap) as Record<string, unknown>;
        if (JSON.stringify(rewrittenData) !== JSON.stringify(entry.data)) {
          await localDb.offline_cache.update(entry.key, {
            data: rewrittenData,
            updatedAt: Date.now(),
          });
        }
      }
    }
  );
}
