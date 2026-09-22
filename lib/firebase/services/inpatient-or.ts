import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  runTransaction,
  writeBatch,
  where,
  orderBy,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from '../config';
import { handleFirestoreError, OperationType } from '../errors';
import {
  Ward,
  Bed,
  BedStatus,
  BedTransfer,
  SurgicalCase,
  SurgicalCaseStatus,
  WHOChecklist,
  ORRoom,
  SurgicalStaff,
  IsolationType,
  PACUHandoff,
  AldreteScoreRecord,
} from '@/types/inpatient-or';

// ============================================================================
// 1. WARDS SERVICE
// ============================================================================

export async function getWards(tenantId: string): Promise<Ward[]> {
  const path = `tenants/${tenantId}/wards`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'wards'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInpatientORData(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as Ward);
    }
    return snapshot.docs.map((d) => d.data() as Ward);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToWards(
  tenantId: string,
  onUpdate: (wards: Ward[]) => void,
  onError?: (err: Error) => void
) {
  const path = `tenants/${tenantId}/wards`;
  const q = query(collection(db, 'tenants', tenantId, 'wards'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        // Trigger seed if empty
        seedInitialInpatientORData(tenantId).catch(console.error);
      }
      const wards = snapshot.docs.map((d) => d.data() as Ward);
      onUpdate(wards);
    },
    (error) => {
      console.error('Wards subscription error:', error);
      if (onError) onError(error);
    }
  );
}

// ============================================================================
// 2. BEDS & INPATIENT CENSUS SERVICE (ATOMIC TRANSACTIONS)
// ============================================================================

export async function getBeds(tenantId: string): Promise<Bed[]> {
  const path = `tenants/${tenantId}/beds`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'beds'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInpatientORData(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as Bed);
    }
    return snapshot.docs.map((d) => d.data() as Bed);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToBeds(
  tenantId: string,
  onUpdate: (beds: Bed[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'beds'));
  return onSnapshot(
    q,
    (snapshot) => {
      const beds = snapshot.docs.map((d) => d.data() as Bed);
      onUpdate(beds);
    },
    (error) => {
      console.error('Beds subscription error:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Combined subscription for real-time Bed Board
 */
export function subscribeToWardsAndBeds(
  tenantId: string,
  callback: (data: { wards: Ward[]; beds: Bed[] }) => void
) {
  let latestWards: Ward[] = [];
  let latestBeds: Bed[] = [];

  const unsubWards = subscribeToWards(tenantId, (wards) => {
    latestWards = wards;
    callback({ wards: latestWards, beds: latestBeds });
  });

  const unsubBeds = subscribeToBeds(tenantId, (beds) => {
    latestBeds = beds;
    callback({ wards: latestWards, beds: latestBeds });
  });

  return () => {
    unsubWards();
    unsubBeds();
  };
}

/**
 * Assigns a patient to a bed atomically using Firestore runTransaction.
 * Validates bed availability and updates both the bed and patient records.
 */
export async function assignBedToPatient(
  tenantId: string,
  params: {
    bedId: string;
    patientId: string;
    patientName: string;
    patientMRN: string;
    patientAge?: number;
    patientGender?: 'Male' | 'Female' | 'Other';
    assignedDoctor?: string;
    assignedNurse?: string;
    isolationType?: IsolationType;
    oxygenPort?: boolean;
    telemetryEnabled?: boolean;
    notes?: string;
    expectedDischargeDate?: string;
  }
): Promise<void> {
  const bedPath = `tenants/${tenantId}/beds/${params.bedId}`;
  try {
    await runTransaction(db, async (transaction) => {
      const bedRef = doc(db, 'tenants', tenantId, 'beds', params.bedId);
      const bedDoc = await transaction.get(bedRef);

      if (!bedDoc.exists()) {
        throw new Error(`Bed with ID ${params.bedId} does not exist.`);
      }

      const bedData = bedDoc.data() as Bed;
      if (bedData.status === 'occupied') {
        throw new Error(`Bed ${bedData.bedNumber} is already occupied by ${bedData.patientName || 'another patient'}.`);
      }

      const now = new Date().toISOString();

      // Update Bed to Occupied
      transaction.update(bedRef, {
        status: 'occupied',
        currentPatientId: params.patientId,
        patientName: params.patientName,
        patientMRN: params.patientMRN,
        patientAge: params.patientAge || null,
        patientGender: params.patientGender || null,
        admissionDate: now,
        expectedDischargeDate: params.expectedDischargeDate || null,
        assignedDoctor: params.assignedDoctor || bedData.assignedDoctor || 'Attending Physician',
        assignedNurse: params.assignedNurse || bedData.assignedNurse || 'Floor Charge Nurse',
        isolationType: params.isolationType || bedData.isolationType || 'none',
        oxygenPort: params.oxygenPort !== undefined ? params.oxygenPort : bedData.oxygenPort,
        telemetryEnabled: params.telemetryEnabled !== undefined ? params.telemetryEnabled : bedData.telemetryEnabled,
        notes: params.notes || bedData.notes || '',
        vitalAlert: false,
        updatedAt: now,
      });

      // Update Patient record if exists
      const patientRef = doc(db, 'tenants', tenantId, 'patients', params.patientId);
      const patientDoc = await transaction.get(patientRef);
      if (patientDoc.exists()) {
        transaction.update(patientRef, {
          activeBedId: params.bedId,
          activeBedNumber: bedData.bedNumber,
          activeWardName: bedData.wardName,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, bedPath);
  }
}

/**
 * Transfers a patient from one bed to another atomically using Firestore runTransaction.
 * Validates that source bed is occupied and target bed is available.
 * Vacates source bed (sets to cleaning), occupies target bed, updates patient, and logs transfer.
 */
export async function transferPatientBed(
  tenantId: string,
  params: {
    sourceBedId: string;
    targetBedId: string;
    requestedBy: string;
    approvedBy?: string;
    reason: string;
    clinicalIndication?: string;
  }
): Promise<BedTransfer> {
  const path = `tenants/${tenantId}/beds`;
  try {
    let transferRecord: BedTransfer | null = null;

    await runTransaction(db, async (transaction) => {
      const sourceRef = doc(db, 'tenants', tenantId, 'beds', params.sourceBedId);
      const targetRef = doc(db, 'tenants', tenantId, 'beds', params.targetBedId);

      const [sourceDoc, targetDoc] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(targetRef),
      ]);

      if (!sourceDoc.exists()) throw new Error(`Source bed ${params.sourceBedId} not found.`);
      if (!targetDoc.exists()) throw new Error(`Target bed ${params.targetBedId} not found.`);

      const source = sourceDoc.data() as Bed;
      const target = targetDoc.data() as Bed;

      if (source.status !== 'occupied' || !source.currentPatientId) {
        throw new Error(`Source bed ${source.bedNumber} is not currently occupied.`);
      }

      if (target.status !== 'available') {
        throw new Error(`Target bed ${target.bedNumber} is not available (Current status: ${target.status}).`);
      }

      const now = new Date().toISOString();
      const transferId = `trf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      transferRecord = {
        id: transferId,
        tenantId,
        patientId: source.currentPatientId,
        patientName: source.patientName || 'Unknown Patient',
        patientMRN: source.patientMRN || '',
        sourceBedId: source.id,
        sourceBedNumber: source.bedNumber,
        sourceWardId: source.wardId,
        sourceWardName: source.wardName,
        targetBedId: target.id,
        targetBedNumber: target.bedNumber,
        targetWardId: target.wardId,
        targetWardName: target.wardName,
        requestedBy: params.requestedBy,
        approvedBy: params.approvedBy || params.requestedBy,
        reason: params.reason,
        clinicalIndication: params.clinicalIndication || '',
        status: 'completed',
        timestamp: now,
        completedAt: now,
      };

      // 1. Vacate Source Bed & Mark as Cleaning
      transaction.update(sourceRef, {
        status: 'cleaning',
        currentPatientId: null,
        patientName: null,
        patientMRN: null,
        patientAge: null,
        patientGender: null,
        admissionDate: null,
        expectedDischargeDate: null,
        vitalAlert: false,
        notes: `Vacated via patient transfer to ${target.bedNumber} on ${new Date().toLocaleDateString()}`,
        updatedAt: now,
      });

      // 2. Occupy Target Bed with Patient details
      transaction.update(targetRef, {
        status: 'occupied',
        currentPatientId: source.currentPatientId,
        patientName: source.patientName,
        patientMRN: source.patientMRN,
        patientAge: source.patientAge || null,
        patientGender: source.patientGender || null,
        admissionDate: source.admissionDate || now,
        expectedDischargeDate: source.expectedDischargeDate || null,
        assignedDoctor: source.assignedDoctor || target.assignedDoctor,
        assignedNurse: target.assignedNurse || source.assignedNurse,
        isolationType: source.isolationType || 'none',
        oxygenPort: target.oxygenPort,
        telemetryEnabled: target.telemetryEnabled,
        vitalAlert: source.vitalAlert || false,
        notes: `Transferred from ${source.bedNumber}: ${params.reason}`,
        updatedAt: now,
      });

      // 3. Update Patient record
      const patientRef = doc(db, 'tenants', tenantId, 'patients', source.currentPatientId);
      const patientDoc = await transaction.get(patientRef);
      if (patientDoc.exists()) {
        transaction.update(patientRef, {
          activeBedId: target.id,
          activeBedNumber: target.bedNumber,
          activeWardName: target.wardName,
          updatedAt: now,
        });
      }

      // 4. Save Transfer Record
      const transferRef = doc(db, 'tenants', tenantId, 'bedTransfers', transferId);
      transaction.set(transferRef, transferRecord);
    });

    return transferRecord!;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Releases a bed upon patient discharge and sets status to 'cleaning' atomically.
 */
export async function dischargePatientBed(
  tenantId: string,
  bedId: string,
  dischargedBy: string,
  dischargeNotes?: string
): Promise<void> {
  const path = `tenants/${tenantId}/beds/${bedId}`;
  try {
    await runTransaction(db, async (transaction) => {
      const bedRef = doc(db, 'tenants', tenantId, 'beds', bedId);
      const bedDoc = await transaction.get(bedRef);

      if (!bedDoc.exists()) throw new Error(`Bed ${bedId} not found.`);
      const bed = bedDoc.data() as Bed;

      const now = new Date().toISOString();
      const patientId = bed.currentPatientId;

      // Update Bed to cleaning
      transaction.update(bedRef, {
        status: 'cleaning',
        currentPatientId: null,
        patientName: null,
        patientMRN: null,
        patientAge: null,
        patientGender: null,
        admissionDate: null,
        expectedDischargeDate: null,
        vitalAlert: false,
        notes: `Discharged by ${dischargedBy} on ${new Date().toLocaleString()}. Terminal sanitation required. ${dischargeNotes || ''}`,
        updatedAt: now,
      });

      // Update Patient if valid
      if (patientId) {
        const patientRef = doc(db, 'tenants', tenantId, 'patients', patientId);
        const patientDoc = await transaction.get(patientRef);
        if (patientDoc.exists()) {
          transaction.update(patientRef, {
            activeBedId: null,
            activeBedNumber: null,
            activeWardName: null,
            lastDischargeDate: now,
            updatedAt: now,
          });
        }
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Marks a bed clean and sanitized, resetting status to 'available'.
 */
export async function markBedCleaned(
  tenantId: string,
  bedId: string,
  sanitizedBy: string
): Promise<void> {
  const path = `tenants/${tenantId}/beds/${bedId}`;
  try {
    const bedRef = doc(db, 'tenants', tenantId, 'beds', bedId);
    const now = new Date().toISOString();
    await updateDoc(bedRef, cleanFirestoreData({
      status: 'available',
      lastCleanedAt: now,
      notes: `Terminal cleaning & disinfection verified by ${sanitizedBy} at ${new Date().toLocaleTimeString()}`,
      updatedAt: now,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Updates bed operational status (e.g. maintenance, reserved, available).
 */
export async function updateBedStatus(
  tenantId: string,
  bedId: string,
  status: BedStatus,
  notes?: string
): Promise<void> {
  const path = `tenants/${tenantId}/beds/${bedId}`;
  try {
    const bedRef = doc(db, 'tenants', tenantId, 'beds', bedId);
    const now = new Date().toISOString();
    await updateDoc(bedRef, cleanFirestoreData({
      status,
      notes: notes || '',
      updatedAt: now,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 3. BED TRANSFERS LOGS
// ============================================================================

export async function getBedTransfers(tenantId: string): Promise<BedTransfer[]> {
  const path = `tenants/${tenantId}/bedTransfers`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'bedTransfers'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as BedTransfer);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToBedTransfers(
  tenantId: string,
  onUpdate: (transfers: BedTransfer[]) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'bedTransfers'));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => d.data() as BedTransfer);
    onUpdate(list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  });
}

// ============================================================================
// 4. OPERATING ROOM SUITES & SURGICAL CASES SERVICE
// ============================================================================

export async function getORRooms(tenantId: string): Promise<ORRoom[]> {
  const path = `tenants/${tenantId}/orRooms`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'orRooms'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInpatientORData(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as ORRoom);
    }
    return snapshot.docs.map((d) => d.data() as ORRoom);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getSurgicalStaff(tenantId: string): Promise<SurgicalStaff[]> {
  const path = `tenants/${tenantId}/surgicalStaff`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'surgicalStaff'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInpatientORData(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as SurgicalStaff);
    }
    return snapshot.docs.map((d) => d.data() as SurgicalStaff);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getSurgicalCases(tenantId: string): Promise<SurgicalCase[]> {
  const path = `tenants/${tenantId}/surgicalCases`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'surgicalCases'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInpatientORData(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as SurgicalCase);
    }
    return snapshot.docs.map((d) => d.data() as SurgicalCase);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getSurgicalCaseById(tenantId: string, caseId: string): Promise<SurgicalCase | null> {
  const path = `tenants/${tenantId}/surgicalCases/${caseId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'surgicalCases', caseId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return null;
    }
    return snap.data() as SurgicalCase;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToSurgicalCases(
  tenantId: string,
  onUpdate: (cases: SurgicalCase[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'surgicalCases'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        seedInitialInpatientORData(tenantId).catch(console.error);
      }
      const cases = snapshot.docs.map((d) => d.data() as SurgicalCase);
      onUpdate(cases);
    },
    (err) => {
      console.error('Surgical cases subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export async function scheduleSurgicalCase(
  tenantId: string,
  caseData: Omit<SurgicalCase, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
): Promise<SurgicalCase> {
  const caseId = `or-case-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const path = `tenants/${tenantId}/surgicalCases/${caseId}`;
  try {
    const now = new Date().toISOString();
    const newCase: SurgicalCase = {
      ...caseData,
      id: caseId,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = doc(db, 'tenants', tenantId, 'surgicalCases', caseId);
    await setDoc(docRef, cleanFirestoreData(newCase));

    // Initialize blank WHO Checklist for this case
    await initializeWHOChecklist(tenantId, caseId, newCase);

    return newCase;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateORCaseStatus(
  tenantId: string,
  caseId: string,
  status: SurgicalCaseStatus,
  additionalData?: {
    actualStartTime?: string;
    actualEndTime?: string;
    pacuBedAssigned?: string;
    postOpDiagnosis?: string;
    notes?: string;
  }
): Promise<void> {
  const path = `tenants/${tenantId}/surgicalCases/${caseId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'surgicalCases', caseId);
    const now = new Date().toISOString();
    await updateDoc(docRef, cleanFirestoreData({
      status,
      ...additionalData,
      updatedAt: now,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSurgicalCase(
  tenantId: string,
  caseId: string,
  updates: Partial<SurgicalCase>
): Promise<void> {
  const path = `tenants/${tenantId}/surgicalCases/${caseId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'surgicalCases', caseId);
    await updateDoc(docRef, cleanFirestoreData({
      ...updates,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface PACUTransferParams {
  surgeonSignoff?: string;
  anesthetistSignoff?: string;
  nurseSignoff?: string;
  aldreteScore?: AldreteScoreRecord;
  bloodLossMl?: number;
  fluidsGivenMl?: number;
  postOpOrders?: string[];
  preferredBedId?: string;
  recoveryNotes?: string;
  airwayStatus?: string;
}

/**
 * Automates the OR to PACU transition:
 * 1. Atomically locates and reserves/occupies an available PACU or Surgical ICU bed.
 * 2. Updates surgical case status to 'post_op_pacu', records end time, and assigns the PACU bed.
 * 3. Marks WHO checklist signOut as completed.
 * 4. Generates an immutable PACUHandoff document.
 * 5. Transitions OR room to 'turnaround'.
 * 6. Emits an immutable clinicalEvent and transactional outbox message.
 */
export async function transferCaseToPACUWithBedReservation(
  tenantId: string,
  caseId: string,
  params: PACUTransferParams
): Promise<PACUHandoff> {
  const path = `tenants/${tenantId}/surgicalCases/${caseId}`;
  try {
    const now = new Date().toISOString();
    let handoffRecord: PACUHandoff | null = null;

    await runTransaction(db, async (transaction) => {
      // 1. Fetch Surgical Case
      const caseRef = doc(db, 'tenants', tenantId, 'surgicalCases', caseId);
      const caseDoc = await transaction.get(caseRef);
      if (!caseDoc.exists()) {
        throw new Error(`Surgical Case ${caseId} not found.`);
      }
      const orCase = caseDoc.data() as SurgicalCase;

      // 2. Locate Best Available Bed for PACU recovery
      let targetBedRef: any = null;
      let targetBedData: Bed | null = null;

      if (params.preferredBedId) {
        const prefRef = doc(db, 'tenants', tenantId, 'beds', params.preferredBedId);
        const prefDoc = await transaction.get(prefRef);
        if (prefDoc.exists()) {
          const bedData = prefDoc.data() as Bed;
          if (bedData.status === 'available') {
            targetBedRef = prefRef;
            targetBedData = bedData;
          } else {
            throw new Error(`PACU BED CONFLICT: Bed ${bedData.bedNumber} is already ${bedData.status}. Simultaneous reservation blocked.`);
          }
        }
      }

      if (!targetBedRef) {
        // Find available bed in Surgical ward or ICU
        const bedsColl = collection(db, 'tenants', tenantId, 'beds');
        const bedsSnap = await getDocs(query(bedsColl, where('status', '==', 'available')));
        if (!bedsSnap.empty) {
          // Prioritize ICU or General Surgery wards
          const sorted = bedsSnap.docs.map((d) => d.data() as Bed);
          const best = sorted.find((b) => b.wardId?.includes('icu') || b.wardId?.includes('surg') || b.wardName?.includes('ICU') || b.wardName?.includes('Surgery')) || sorted[0];
          
          // Re-verify the bed atomically inside the transaction
          const liveBedRef = doc(db, 'tenants', tenantId, 'beds', best.id);
          const liveBedDoc = await transaction.get(liveBedRef);
          if (liveBedDoc.exists() && (liveBedDoc.data() as Bed).status === 'available') {
            targetBedRef = liveBedRef;
            targetBedData = liveBedDoc.data() as Bed;
          }
        }
      }

      // If no bed available, create/fallback to dedicated PACU Bay
      if (!targetBedRef || !targetBedData) {
        const pacuBedId = `bed-pacu-${Date.now().toString().slice(-4)}`;
        targetBedRef = doc(db, 'tenants', tenantId, 'beds', pacuBedId);
        targetBedData = {
          id: pacuBedId,
          tenantId,
          wardId: 'ward-pacu',
          wardName: 'Post-Anesthesia Care Unit (PACU)',
          bedNumber: `PACU-Bay-${Math.floor(Math.random() * 8) + 1}`,
          roomNumber: 'PACU Main Floor',
          class: 'icu',
          status: 'available',
          oxygenPort: true,
          telemetryEnabled: true,
          isolationType: 'none',
          updatedAt: now,
        };
      }

      const allocatedBedNumber = targetBedData.bedNumber;
      const allocatedWardName = targetBedData.wardName || 'PACU Unit';

      // 3. Update Target Bed to Occupied by Surgical Patient
      transaction.set(
        targetBedRef,
        cleanFirestoreData({
          ...targetBedData,
          status: 'occupied',
          currentPatientId: orCase.patientId,
          patientName: orCase.patientName,
          patientMRN: orCase.patientMRN,
          patientAge: orCase.patientAge || 0,
          patientGender: orCase.patientGender || 'Other',
          admissionDate: now,
          assignedDoctor: orCase.surgeonName || orCase.leadSurgeon,
          assignedNurse: params.nurseSignoff || 'PACU Recovery Nurse',
          primaryDiagnosis: orCase.postOpDiagnosis || orCase.preOpDiagnosis || orCase.surgicalProcedureName,
          vitalAlert: false,
          oxygenPort: true,
          telemetryEnabled: true,
          notes: `Post-Operative Recovery from ${orCase.surgicalProcedureName || 'Surgery'}. Handed off at ${new Date().toLocaleTimeString()}.`,
          updatedAt: now,
        }),
        { merge: true }
      );

      // 4. Update Surgical Case Status
      transaction.update(
        caseRef,
        cleanFirestoreData({
          status: 'post_op_pacu',
          actualEndTime: orCase.actualEndTime || now,
          pacuBedAssigned: allocatedBedNumber,
          pacuBedId: targetBedData.id,
          'whoChecklist.signOut': true,
          'whoChecklistStatus.signOut': true,
          updatedAt: now,
        })
      );

      // 5. Update WHO Checklist if it exists
      const whoRef = doc(db, 'tenants', tenantId, 'whoChecklists', `who-${caseId}`);
      const whoDoc = await transaction.get(whoRef);
      if (whoDoc.exists()) {
        transaction.update(
          whoRef,
          cleanFirestoreData({
            'signOut.completed': true,
            'signOut.pacuTransferPlanConfirmed': true,
            'signOut.actualProcedureName': orCase.surgicalProcedureName || 'Surgical Procedure',
            'signOut.verifiedAt': now,
            status: 'completed',
            updatedAt: now,
          })
        );
      }

      // 6. Set OR Room to Turnaround/Sanitization
      if (orCase.orRoomId) {
        const roomRef = doc(db, 'tenants', tenantId, 'orRooms', orCase.orRoomId);
        const roomDoc = await transaction.get(roomRef);
        if (roomDoc.exists()) {
          transaction.update(roomRef, {
            status: 'turnaround',
            currentCaseId: null,
            updatedAt: now,
          });
        }
      }

      // 7. Create PACUHandoff Record
      const handoffId = `handoff-${caseId}`;
      const handoffRef = doc(db, 'tenants', tenantId, 'pacuHandoffs', handoffId);
      handoffRecord = {
        id: handoffId,
        caseId,
        tenantId,
        patientId: orCase.patientId,
        patientName: orCase.patientName,
        patientMRN: orCase.patientMRN,
        procedureName: orCase.surgicalProcedureName || orCase.procedureName || 'Surgical Procedure',
        orRoomName: orCase.orRoomName || orCase.suiteName || 'Operating Theater',
        pacuBedId: targetBedData.id,
        pacuBedNumber: allocatedBedNumber,
        pacuWardName: allocatedWardName,
        surgeonSignoff: params.surgeonSignoff || orCase.surgeonName || 'Lead Surgeon',
        anesthetistSignoff: params.anesthetistSignoff || orCase.anesthesiologistName || 'Lead Anesthesiologist',
        nurseSignoff: params.nurseSignoff || 'PACU Circulator',
        aldreteScore: params.aldreteScore || {
          activity: 2,
          respiration: 2,
          circulation: 2,
          consciousness: 1,
          o2Saturation: 2,
          totalScore: 9,
        },
        bloodLossMl: params.bloodLossMl ?? 100,
        fluidsGivenMl: params.fluidsGivenMl ?? 1200,
        postOpOrders: params.postOpOrders || [
          'Vital signs q15m x 1hr, then q30m x 2hr',
          'Titrate O2 via nasal cannula to maintain SpO2 >= 95%',
          'Strict I&O monitoring; notify surgeon if urine output < 30 mL/hr',
          'Post-op analgesia per acute pain service protocol',
          'Surgical wound dressing inspection for active strike-through bleeding',
        ],
        recoveryNotes: params.recoveryNotes || 'Extubated smoothly in OR. Hemodynamically stable upon PACU transfer.',
        airwayStatus: params.airwayStatus || 'Extubated / Spontaneous Breathing on 2L NC',
        transferredAt: now,
        status: 'active_recovery',
      };
      transaction.set(handoffRef, cleanFirestoreData(handoffRecord));

      // 8. Immutable Clinical Event
      const eventId = `evt-pacu-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const eventRef = doc(db, 'tenants', tenantId, 'clinicalEvents', eventId);
      transaction.set(eventRef, {
        id: eventId,
        tenantId,
        eventType: 'OR_TO_PACU_TRANSFER_COMPLETED',
        patientId: orCase.patientId,
        patientMRN: orCase.patientMRN,
        payload: {
          caseId,
          procedureName: orCase.surgicalProcedureName,
          pacuBedNumber: allocatedBedNumber,
          aldreteTotal: handoffRecord.aldreteScore.totalScore,
        },
        timestamp: now,
      });

      // 9. Transactional Outbox Record
      const outboxId = `outbox-pacu-${Date.now()}`;
      const outboxRef = doc(db, 'tenants', tenantId, 'outbox', outboxId);
      transaction.set(outboxRef, {
        id: outboxId,
        tenantId,
        topic: 'clinical.surgery.pacu-transferred',
        eventType: 'SURGERY_PACU_TRANSFER',
        payload: {
          caseId,
          patientId: orCase.patientId,
          pacuBedNumber: allocatedBedNumber,
        },
        status: 'PENDING',
        createdAt: now,
        attempts: 0,
      });
    });

    return handoffRecord!;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getPACUHandoff(tenantId: string, caseId: string): Promise<PACUHandoff | null> {
  const path = `tenants/${tenantId}/pacuHandoffs/handoff-${caseId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'pacuHandoffs', `handoff-${caseId}`);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as PACUHandoff;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ============================================================================
// 5. WHO SURGICAL SAFETY CHECKLIST & INTRA-OPERATIVE SERVICE
// ============================================================================

export async function initializeWHOChecklist(
  tenantId: string,
  caseId: string,
  orCase: SurgicalCase
): Promise<WHOChecklist> {
  const checklistId = `who-${caseId}`;
  const now = new Date().toISOString();

  const defaultChecklist: WHOChecklist = {
    id: checklistId,
    caseId,
    tenantId,
    signIn: {
      patientConfirmedIdentitySite: false,
      patientIdentityConfirmed: false,
      siteMarked: true,
      anesthesiaSafetyCheckCompleted: false,
      anesthesiaMachineCheckComplete: false,
      pulseOximeterFunctioning: true,
      allergyKnown: (orCase.patientAllergies && orCase.patientAllergies.length > 0) || false,
      knownAllergy: (orCase.patientAllergies && orCase.patientAllergies.length > 0) || false,
      allergyDetails: orCase.patientAllergies?.join(', ') || 'NKDA (No Known Drug Allergies)',
      difficultAirwayRisk: false,
      aspirationRisk: false,
      bloodLossRiskAssessed: true,
      bloodLossEstimatedMl: orCase.bloodUnitsReserved ? orCase.bloodUnitsReserved * 250 : 150,
      ivAccessAdequate: true,
      verifiedByAnesthetist: orCase.anesthesiologistName || orCase.anesthesiologist || 'Anesthesiologist',
      verifiedByNurse: orCase.scrubNurseName || orCase.scrubNurse || 'Lead Scrub RN',
      completed: false,
    },
    timeOut: {
      allTeamMembersIntroduced: false,
      teamIntroductions: false,
      confirmPatientNameProcedureSite: false,
      verbalConfirmation: false,
      anticipatedCriticalEvents: false,
      criticalEventsDetails: {
        surgeonReviewOperatingTimeSteps: false,
        anesthesiaReviewPatientRisks: false,
        nursingReviewSterilityEquipment: false,
      },
      antibioticProphylaxisGivenWithin60Min: true,
      antibioticProphylaxisGiven: true,
      antibioticNameTime: 'Cefazolin 2g IV at 07:45 AM',
      essentialImagingDisplayed: true,
      imagingDisplayed: true,
      sterilizationConfirmed: true,
      specialEquipmentVerified: true,
      verifiedBySurgeon: orCase.surgeonName || orCase.leadSurgeon || 'Lead Surgeon',
      verifiedByCirculator: orCase.circulatingNurseName || orCase.circulatingNurse || 'Circulating RN',
      completed: false,
    },
    signOut: {
      procedureNameRecorded: false,
      procedureRecorded: false,
      actualProcedureName: orCase.surgicalProcedureName || orCase.procedureName || 'Surgical Procedure',
      instrumentSpongeNeedleCountsCorrect: false,
      instrumentCountCorrect: false,
      specimenLabeledCorrectly: true,
      specimensLabeledCorrectly: true,
      specimenDetails: `${orCase.surgicalProcedureName || orCase.procedureName || 'Specimen'} tissue sample for pathology`,
      equipmentProblemsAddressed: true,
      keyRecoveryConcernsReviewed: false,
      recoveryPlanReviewed: false,
      pacuTransferPlanConfirmed: false,
      verifiedByTeam: [
        orCase.surgeonName || orCase.leadSurgeon || 'Lead Surgeon',
        orCase.anesthesiologistName || orCase.anesthesiologist || 'Anesthesiologist',
        orCase.scrubNurseName || orCase.scrubNurse || 'Scrub RN',
      ],
      completed: false,
    },
    surgicalCounts: [
      { id: 'sc-1', itemType: 'Lap_Pad', initialCount: 10, addedCount: 0, finalCount: 10, status: 'correct' },
      { id: 'sc-2', itemType: 'Sponge', initialCount: 20, addedCount: 5, finalCount: 25, status: 'correct' },
      { id: 'sc-3', itemType: 'Needle', initialCount: 12, addedCount: 2, finalCount: 14, status: 'correct' },
      { id: 'sc-4', itemType: 'Blade', initialCount: 2, addedCount: 0, finalCount: 2, status: 'correct' },
      { id: 'sc-5', itemType: 'Instrument', initialCount: 48, addedCount: 0, finalCount: 48, status: 'correct' },
    ],
    implants: orCase.implantRequired
      ? [
          {
            id: 'imp-1',
            itemDescription: orCase.implantDetails || 'Titanium Spinal Fusion Cage / Prosthesis',
            manufacturer: 'Synthes Ortho / Medtronic Surgical',
            lotNumber: 'LT-2026-8841',
            serialNumber: 'SN-90234-A',
            expiryDate: '2029-05-15',
            anatomicalSite: 'L4-L5 Vertebral Interspace',
            placedBy: orCase.surgeonName,
            timestamp: now,
          },
        ]
      : [],
    anesthesiaLogs: [
      {
        id: 'vital-1',
        timestamp: '08:00',
        heartRate: 72,
        systolicBP: 120,
        diastolicBP: 80,
        spo2: 99,
        etCO2: 36,
        tempCelsius: 36.6,
        gasAgentPercentage: 1.8,
        gasAgentType: 'Sevoflurane',
        ivFluidGivenMl: 500,
        bloodLossEstimateMl: 50,
        urineOutputMl: 100,
        notes: 'Pre-induction baseline stable',
      },
      {
        id: 'vital-2',
        timestamp: '08:30',
        heartRate: 68,
        systolicBP: 115,
        diastolicBP: 74,
        spo2: 100,
        etCO2: 38,
        tempCelsius: 36.4,
        gasAgentPercentage: 2.0,
        gasAgentType: 'Sevoflurane',
        ivFluidGivenMl: 800,
        bloodLossEstimateMl: 120,
        urineOutputMl: 180,
        notes: 'Skin incision made. Hemodynamics stable.',
      },
    ],
    completedBy: orCase.anesthesiologistName || orCase.surgeonName || 'OR Team',
    status: 'in_progress',
    updatedAt: now,
  };

  const docRef = doc(db, 'tenants', tenantId, 'whoChecklists', checklistId);
  await setDoc(docRef, cleanFirestoreData(defaultChecklist));
  return defaultChecklist;
}

export async function getWHOChecklistByCaseId(
  tenantId: string,
  caseId: string,
  orCase?: SurgicalCase
): Promise<WHOChecklist | null> {
  const checklistId = `who-${caseId}`;
  const path = `tenants/${tenantId}/whoChecklists/${checklistId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'whoChecklists', checklistId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      if (orCase) {
        return await initializeWHOChecklist(tenantId, caseId, orCase);
      }
      return null;
    }
    return snap.data() as WHOChecklist;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveWHOChecklist(
  tenantId: string,
  checklist: WHOChecklist
): Promise<void> {
  const path = `tenants/${tenantId}/whoChecklists/${checklist.id}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'whoChecklists', checklist.id);
    const now = new Date().toISOString();
    const payload = {
      ...checklist,
      updatedAt: now,
    };
    await setDoc(docRef, cleanFirestoreData(payload), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToWHOChecklist(
  tenantId: string,
  caseId: string,
  onUpdate: (checklist: WHOChecklist) => void
) {
  const checklistId = `who-${caseId}`;
  const docRef = doc(db, 'tenants', tenantId, 'whoChecklists', checklistId);
  return onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      onUpdate(snap.data() as WHOChecklist);
    }
  });
}

// ============================================================================
// 6. INITIAL DATA SEEDER FOR INPATIENT WARDS, BEDS & SURGERY SUITES
// ============================================================================

export async function seedInitialInpatientORData(tenantId: string): Promise<void> {
  try {
    const batch = writeBatch(db);

    // 1. Wards
    const wards: Ward[] = [
      {
        id: 'ward-icu',
        tenantId,
        name: 'Intensive Care Unit (ICU)',
        floor: 'Floor 2 (Critical Care Pavilion)',
        department: 'ICU',
        totalBeds: 8,
        nurseStationPhone: 'Ext. 2101',
        headNurse: 'Charge Nurse Maya Patel, RN, BSN, CCRN',
        attendingPhysician: 'Dr. Sarah Jenkins, MD (Intensivist)',
        specialtyFocus: 'Level-1 Cardiovascular & Septic Shock ICU',
      },
      {
        id: 'ward-surg',
        tenantId,
        name: 'Post-Surgical Inpatient Ward (4-West)',
        floor: 'Floor 4 (West Wing)',
        department: 'General_Surgery',
        totalBeds: 12,
        nurseStationPhone: 'Ext. 4100',
        headNurse: 'Nurse Kevin O\'Connor, BSN',
        attendingPhysician: 'Dr. David Rodriguez, MD, FACS',
        specialtyFocus: 'Post-Operative Recovery & Step-Down Care',
      },
      {
        id: 'ward-gen',
        tenantId,
        name: 'General Medical Ward (3-East)',
        floor: 'Floor 3 (East Wing)',
        department: 'General_Medicine',
        totalBeds: 14,
        nurseStationPhone: 'Ext. 3100',
        headNurse: 'Nurse John Davis, RN',
        attendingPhysician: 'Dr. Michael Chen, MD',
        specialtyFocus: 'Internal Medicine, Pulmonology & Nephrology',
      },
      {
        id: 'ward-cardio',
        tenantId,
        name: 'Cardiology & Telemetry Unit (3-North)',
        floor: 'Floor 3 (North Wing)',
        department: 'Cardiology',
        totalBeds: 10,
        nurseStationPhone: 'Ext. 3200',
        headNurse: 'Nurse Clara Oswald, BSN',
        attendingPhysician: 'Dr. Sarah Jenkins, MD, FACC',
        specialtyFocus: 'Continuous 12-Lead Telemetry & Post-Cath Lab',
      },
      {
        id: 'ward-mat',
        tenantId,
        name: 'Maternity & Labor & Delivery (5-South)',
        floor: 'Floor 5 (Women & Children Pavilion)',
        department: 'Maternity',
        totalBeds: 8,
        nurseStationPhone: 'Ext. 5100',
        headNurse: 'Nurse Clara Oswald, RNC-OB',
        attendingPhysician: 'Dr. Lisa Wong, MD, FACOG',
        specialtyFocus: 'LDRP Suites & High-Risk Antepartum',
      },
      {
        id: 'ward-ped',
        tenantId,
        name: 'Pediatric Inpatient Unit (5-North)',
        floor: 'Floor 5 (North Wing)',
        department: 'Pediatrics',
        totalBeds: 8,
        nurseStationPhone: 'Ext. 5200',
        headNurse: 'Nurse Amanda Rios, CPN',
        attendingPhysician: 'Dr. Lisa Wong, MD, FAAP',
        specialtyFocus: 'Pediatric General & Subspecialty Inpatient Care',
      },
    ];

    for (const ward of wards) {
      batch.set(doc(db, 'tenants', tenantId, 'wards', ward.id), ward);
    }

    // 2. Beds
    const now = new Date().toISOString();
    const beds: Bed[] = [
      // ICU Beds
      {
        id: 'b-icu-101',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-101',
        roomNumber: 'Suite 201',
        class: 'icu',
        status: 'occupied',
        currentPatientId: 'p-1001',
        patientName: 'Elena Rostova',
        patientMRN: 'GH-2026-9812',
        patientAge: 44,
        patientGender: 'Female',
        admissionDate: '2026-08-10T09:30:00Z',
        expectedDischargeDate: '2026-08-17',
        assignedDoctor: 'Dr. Sarah Jenkins',
        assignedNurse: 'Nurse John Davis',
        dailyRate: 1850,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        vitalAlert: true,
        notes: 'Post-op CABG x3. Titrating norepinephrine infusion. Daily arterial line flush.',
        updatedAt: now,
      },
      {
        id: 'b-icu-102',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-102',
        roomNumber: 'Suite 202',
        class: 'icu',
        status: 'occupied',
        currentPatientId: 'p-1002',
        patientName: 'Marcus Vance',
        patientMRN: 'GH-2026-4491',
        patientAge: 58,
        patientGender: 'Male',
        admissionDate: '2026-08-12T14:15:00Z',
        expectedDischargeDate: '2026-08-18',
        assignedDoctor: 'Dr. Michael Chen',
        assignedNurse: 'Nurse Maya Patel',
        dailyRate: 1850,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'droplet',
        vitalAlert: false,
        notes: 'Severe acute pancreatitis with ARDS on high-flow nasal cannula (HFNC 50L/60%).',
        updatedAt: now,
      },
      {
        id: 'b-icu-103',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-103',
        roomNumber: 'Suite 203',
        class: 'icu',
        status: 'cleaning',
        dailyRate: 1850,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'contact',
        vitalAlert: false,
        notes: 'Terminal UV-C room sterilization in progress following patient discharge.',
        updatedAt: now,
      },
      {
        id: 'b-icu-104',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-104',
        roomNumber: 'Suite 204',
        class: 'icu',
        status: 'available',
        dailyRate: 1850,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        vitalAlert: false,
        notes: 'Prepared and stocked with Hamilton-C6 mechanical ventilator and Philips monitor.',
        lastCleanedAt: '2026-08-15T08:00:00Z',
        updatedAt: now,
      },
      {
        id: 'b-icu-105',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-105',
        roomNumber: 'Suite 205 (Isolation)',
        class: 'icu',
        status: 'reserved',
        dailyRate: 2100,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'airborne',
        vitalAlert: false,
        notes: 'Reserved for OR Suite 2 cardiac bypass case pending PACU transfer at 16:30.',
        updatedAt: now,
      },
      {
        id: 'b-icu-106',
        tenantId,
        wardId: 'ward-icu',
        wardName: 'Intensive Care Unit (ICU)',
        bedNumber: 'ICU-106',
        roomNumber: 'Suite 206',
        class: 'icu',
        status: 'available',
        dailyRate: 1850,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        vitalAlert: false,
        notes: 'Available for immediate emergency or trauma admission.',
        lastCleanedAt: '2026-08-15T09:30:00Z',
        updatedAt: now,
      },

      // Surgical Ward Beds
      {
        id: 'b-surg-401',
        tenantId,
        wardId: 'ward-surg',
        wardName: 'Post-Surgical Inpatient Ward (4-West)',
        bedNumber: 'SURG-401',
        roomNumber: 'Room 401-A',
        class: 'private',
        status: 'occupied',
        currentPatientId: 'p-1009',
        patientName: 'Robert Thorne',
        patientMRN: 'GH-2026-3390',
        patientAge: 62,
        patientGender: 'Male',
        admissionDate: '2026-08-13T11:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. David Rodriguez',
        assignedNurse: 'Nurse Kevin O\'Connor',
        dailyRate: 750,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        vitalAlert: false,
        notes: 'Post-laparoscopic hemicolectomy Day 2. Tolerating clear liquids. Ambulated x3.',
        updatedAt: now,
      },
      {
        id: 'b-surg-402',
        tenantId,
        wardId: 'ward-surg',
        wardName: 'Post-Surgical Inpatient Ward (4-West)',
        bedNumber: 'SURG-402',
        roomNumber: 'Room 401-B',
        class: 'semi_private',
        status: 'available',
        dailyRate: 450,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        notes: 'Cleaned and sanitized. Bed linens changed.',
        lastCleanedAt: '2026-08-15T11:00:00Z',
        updatedAt: now,
      },
      {
        id: 'b-surg-403',
        tenantId,
        wardId: 'ward-surg',
        wardName: 'Post-Surgical Inpatient Ward (4-West)',
        bedNumber: 'SURG-403',
        roomNumber: 'Room 402-A',
        class: 'semi_private',
        status: 'occupied',
        currentPatientId: 'p-1004',
        patientName: 'David Kim',
        patientMRN: 'GH-2026-7782',
        patientAge: 51,
        patientGender: 'Male',
        admissionDate: '2026-08-09T16:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. Lisa Wong',
        assignedNurse: 'Nurse Kevin O\'Connor',
        dailyRate: 450,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        vitalAlert: false,
        notes: 'Post-op total knee arthroplasty (TKA). Physical therapy evaluation cleared.',
        updatedAt: now,
      },
      {
        id: 'b-surg-404',
        tenantId,
        wardId: 'ward-surg',
        wardName: 'Post-Surgical Inpatient Ward (4-West)',
        bedNumber: 'SURG-404',
        roomNumber: 'Room 402-B',
        class: 'semi_private',
        status: 'maintenance',
        dailyRate: 450,
        oxygenPort: false,
        telemetryEnabled: false,
        isolationType: 'none',
        notes: 'Motorized head-elevation actuator malfunctioning. Work order #WO-9014 submitted.',
        updatedAt: now,
      },

      // General Medicine Ward Beds
      {
        id: 'b-gen-301',
        tenantId,
        wardId: 'ward-gen',
        wardName: 'General Medical Ward (3-East)',
        bedNumber: 'GEN-301',
        roomNumber: 'Room 301-A',
        class: 'general',
        status: 'occupied',
        currentPatientId: 'p-1003',
        patientName: 'Sophia Al-Mansoor',
        patientMRN: 'GH-2026-1129',
        patientAge: 39,
        patientGender: 'Female',
        admissionDate: '2026-08-11T10:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. Sarah Jenkins',
        assignedNurse: 'Nurse Kevin O\'Connor',
        dailyRate: 350,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        notes: 'Complicated pyelonephritis on IV Ceftriaxone. Afebrile for 36 hours.',
        updatedAt: now,
      },
      {
        id: 'b-gen-302',
        tenantId,
        wardId: 'ward-gen',
        wardName: 'General Medical Ward (3-East)',
        bedNumber: 'GEN-302',
        roomNumber: 'Room 301-B',
        class: 'general',
        status: 'available',
        dailyRate: 350,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        lastCleanedAt: '2026-08-15T07:15:00Z',
        updatedAt: now,
      },
      {
        id: 'b-gen-303',
        tenantId,
        wardId: 'ward-gen',
        wardName: 'General Medical Ward (3-East)',
        bedNumber: 'GEN-303',
        roomNumber: 'Room 302-A',
        class: 'general',
        status: 'occupied',
        currentPatientId: 'p-1005',
        patientName: 'James Carter',
        patientMRN: 'GH-2026-5561',
        patientAge: 67,
        patientGender: 'Male',
        admissionDate: '2026-08-13T18:30:00Z',
        expectedDischargeDate: '2026-08-17',
        assignedDoctor: 'Dr. Michael Chen',
        assignedNurse: 'Nurse Maya Patel',
        dailyRate: 350,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'contact',
        vitalAlert: true,
        notes: 'COPD exacerbation with community-acquired pneumonia. On 3L O2 via nasal cannula.',
        updatedAt: now,
      },
      {
        id: 'b-gen-304',
        tenantId,
        wardId: 'ward-gen',
        wardName: 'General Medical Ward (3-East)',
        bedNumber: 'GEN-304',
        roomNumber: 'Room 302-B',
        class: 'general',
        status: 'available',
        dailyRate: 350,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        lastCleanedAt: '2026-08-15T12:00:00Z',
        updatedAt: now,
      },

      // Cardiology Telemetry Ward
      {
        id: 'b-card-311',
        tenantId,
        wardId: 'ward-cardio',
        wardName: 'Cardiology & Telemetry Unit (3-North)',
        bedNumber: 'CARD-311',
        roomNumber: 'Room 311',
        class: 'private',
        status: 'occupied',
        currentPatientId: 'p-1006',
        patientName: 'Aisha Bello',
        patientMRN: 'GH-2026-9043',
        patientAge: 53,
        patientGender: 'Female',
        admissionDate: '2026-08-13T22:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. David Rodriguez',
        assignedNurse: 'Nurse John Davis',
        dailyRate: 650,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        notes: 'Post-percutaneous coronary intervention (PCI) with drug-eluting stent. Continuous rhythm monitoring.',
        updatedAt: now,
      },
      {
        id: 'b-card-312',
        tenantId,
        wardId: 'ward-cardio',
        wardName: 'Cardiology & Telemetry Unit (3-North)',
        bedNumber: 'CARD-312',
        roomNumber: 'Room 312',
        class: 'private',
        status: 'available',
        dailyRate: 650,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        lastCleanedAt: '2026-08-15T10:00:00Z',
        updatedAt: now,
      },

      // Maternity Ward
      {
        id: 'b-mat-501',
        tenantId,
        wardId: 'ward-mat',
        wardName: 'Maternity & Labor & Delivery (5-South)',
        bedNumber: 'MAT-501',
        roomNumber: 'LDRP Suite 501',
        class: 'private',
        status: 'occupied',
        currentPatientId: 'p-1007',
        patientName: 'Chloe Bennett',
        patientMRN: 'GH-2026-6632',
        patientAge: 31,
        patientGender: 'Female',
        admissionDate: '2026-08-12T19:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. Lisa Wong',
        assignedNurse: 'Nurse Clara Oswald',
        dailyRate: 800,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        notes: 'Post-partum Day 2 uncomplicated vaginal delivery. Newborn rooming-in in stable condition.',
        updatedAt: now,
      },
      {
        id: 'b-mat-502',
        tenantId,
        wardId: 'ward-mat',
        wardName: 'Maternity & Labor & Delivery (5-South)',
        bedNumber: 'MAT-502',
        roomNumber: 'LDRP Suite 502',
        class: 'private',
        status: 'available',
        dailyRate: 800,
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        lastCleanedAt: '2026-08-15T09:00:00Z',
        updatedAt: now,
      },

      // Pediatrics Ward
      {
        id: 'b-ped-511',
        tenantId,
        wardId: 'ward-ped',
        wardName: 'Pediatric Inpatient Unit (5-North)',
        bedNumber: 'PED-511',
        roomNumber: 'Room 511',
        class: 'private',
        status: 'occupied',
        currentPatientId: 'p-1008',
        patientName: 'Liam Miller',
        patientMRN: 'GH-2026-2218',
        patientAge: 8,
        patientGender: 'Male',
        admissionDate: '2026-08-13T08:00:00Z',
        expectedDischargeDate: '2026-08-16',
        assignedDoctor: 'Dr. Sarah Jenkins',
        assignedNurse: 'Nurse Clara Oswald',
        dailyRate: 500,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'droplet',
        notes: 'RSV bronchiolitis on low-flow cannula. Parent present at bedside.',
        updatedAt: now,
      },
      {
        id: 'b-ped-512',
        tenantId,
        wardId: 'ward-ped',
        wardName: 'Pediatric Inpatient Unit (5-North)',
        bedNumber: 'PED-512',
        roomNumber: 'Room 512',
        class: 'private',
        status: 'available',
        dailyRate: 500,
        oxygenPort: true,
        telemetryEnabled: false,
        isolationType: 'none',
        lastCleanedAt: '2026-08-15T11:45:00Z',
        updatedAt: now,
      },
    ];

    for (const bed of beds) {
      batch.set(doc(db, 'tenants', tenantId, 'beds', bed.id), bed);
    }

    // 3. Operating Room Suites
    const orRooms: ORRoom[] = [
      {
        id: 'or-suite-1',
        tenantId,
        name: 'OR Suite 1 (General & Minimally Invasive Laparoscopy)',
        suiteNumber: 'OR-1',
        floor: 'Floor 3 (Surgical Pavilion)',
        status: 'in_use',
        currentCaseId: 'case-or-101',
        features: ['4K Olympus Laparoscopy Tower', 'Harmonic Scalpel UltraCision', 'Laminar Flow HEPA', 'Touch Screen Boom'],
      },
      {
        id: 'or-suite-2',
        tenantId,
        name: 'OR Suite 2 (Cardiovascular & Thoracic Hybrid)',
        suiteNumber: 'OR-2',
        floor: 'Floor 3 (Surgical Pavilion)',
        status: 'in_use',
        currentCaseId: 'case-or-102',
        features: ['Sorin S5 Heart-Lung CPB Machine', 'Siemens Artis Zeego C-Arm', 'Intra-Aortic Balloon Pump (IABP)', 'Transesophageal Echo (TEE)'],
      },
      {
        id: 'or-suite-3',
        tenantId,
        name: 'OR Suite 3 (Orthopedic Joint & Trauma)',
        suiteNumber: 'OR-3',
        floor: 'Floor 3 (Surgical Pavilion)',
        status: 'available',
        features: ['Mako Robotic-Arm Arthroplasty', 'Stryker System 8 Power Tools', 'Radiforce Dual Display', 'Zero-Gravity Radiation Shield'],
      },
      {
        id: 'or-suite-4',
        tenantId,
        name: 'OR Suite 4 (Neurosurgery & Micro-Spine)',
        suiteNumber: 'OR-4',
        floor: 'Floor 3 (Surgical Pavilion)',
        status: 'available',
        features: ['Zeiss Kinevo 900 Surgical Microscope', 'Medtronic StealthStation S8 Navigation', 'Mayfield Skull Clamp', 'Cavitation Ultrasonic Aspirator (CUSA)'],
      },
      {
        id: 'or-suite-5',
        tenantId,
        name: 'OR Suite 5 (Robotic Multi-Specialty DaVinci)',
        suiteNumber: 'OR-5',
        floor: 'Floor 3 (Surgical Pavilion)',
        status: 'turnaround',
        features: ['Intuitive DaVinci Xi Dual-Console', 'AirSeal Insufflation System', 'Firefly Fluorescence Imaging', 'Integrated Table Motion'],
      },
    ];

    for (const room of orRooms) {
      batch.set(doc(db, 'tenants', tenantId, 'orRooms', room.id), room);
    }

    // 4. Surgical Staff Roster
    const staffMembers: SurgicalStaff[] = [
      {
        id: 'staff-surg-1',
        name: 'Dr. David Rodriguez, MD, FACS',
        role: 'Surgeon',
        specialty: 'General & Minimally Invasive Gastrointestinal Surgery',
        licenseNumber: 'MD-883492',
        status: 'in_surgery',
      },
      {
        id: 'staff-surg-2',
        name: 'Dr. Sarah Jenkins, MD, FACC, FACS',
        role: 'Surgeon',
        specialty: 'Cardiothoracic Surgery & Structural Heart',
        licenseNumber: 'MD-991204',
        status: 'in_surgery',
      },
      {
        id: 'staff-surg-3',
        name: 'Dr. Marcus Sterling, MD, FAAOS',
        role: 'Surgeon',
        specialty: 'Orthopedic Joint Reconstruction & Spine',
        licenseNumber: 'MD-772183',
        status: 'available',
      },
      {
        id: 'staff-anes-1',
        name: 'Dr. Elena Rostova-Chen, MD',
        role: 'Anesthesiologist',
        specialty: 'Cardiothoracic & Critical Care Anesthesiology',
        licenseNumber: 'MD-663821',
        status: 'in_surgery',
      },
      {
        id: 'staff-anes-2',
        name: 'Dr. Arthur Vance, MD, FASA',
        role: 'Anesthesiologist',
        specialty: 'Neuro-Anesthesia & Pediatric Anesthesia',
        licenseNumber: 'MD-554910',
        status: 'available',
      },
      {
        id: 'staff-nurse-1',
        name: 'Nurse Kevin O\'Connor, BSN, CNOR',
        role: 'Scrub_Nurse',
        specialty: 'Operating Room Scrub Specialist',
        licenseNumber: 'RN-338291',
        status: 'in_surgery',
      },
      {
        id: 'staff-nurse-2',
        name: 'Nurse Maya Patel, BSN, RN',
        role: 'Circulating_Nurse',
        specialty: 'OR Circulating Nurse & Patient Advocate',
        licenseNumber: 'RN-449102',
        status: 'in_surgery',
      },
      {
        id: 'staff-nurse-3',
        name: 'Nurse Clara Oswald, BSN, RN',
        role: 'Scrub_Nurse',
        specialty: 'Orthopedic & Robotic Scrub Specialist',
        licenseNumber: 'RN-551029',
        status: 'available',
      },
    ];

    for (const staff of staffMembers) {
      batch.set(doc(db, 'tenants', tenantId, 'surgicalStaff', staff.id), staff);
    }

    // 5. Initial Surgical Cases
    const cases: SurgicalCase[] = [
      {
        id: 'case-or-101',
        tenantId,
        patientId: 'p-1009',
        patientName: 'Robert Thorne',
        patientMRN: 'GH-2026-3390',
        patientAge: 62,
        patientGender: 'Male',
        patientBloodType: 'A+',
        patientAllergies: ['Penicillin'],
        surgeonId: 'staff-surg-1',
        surgeonName: 'Dr. David Rodriguez, MD, FACS',
        anesthesiologistId: 'staff-anes-2',
        anesthesiologistName: 'Dr. Arthur Vance, MD, FASA',
        scrubNurseName: 'Nurse Kevin O\'Connor, BSN, CNOR',
        circulatingNurseName: 'Nurse Maya Patel, BSN, RN',
        orRoomId: 'or-suite-1',
        orRoomName: 'OR Suite 1 (General Laparoscopy)',
        scheduledStartTime: '2026-08-15T08:00',
        scheduledEndTime: '2026-08-15T11:30',
        actualStartTime: '2026-08-15T08:15',
        surgicalProcedureName: 'Laparoscopic Right Hemicolectomy with Intracorporeal Anastomosis',
        procedureCategory: 'General Surgery / Colorectal',
        icd10Codes: [
          { code: 'C18.0', description: 'Malignant neoplasm of cecum' },
          { code: 'K56.60', description: 'Unspecified intestinal obstruction' },
        ],
        cptCodes: [
          { code: '44205', description: 'Laparoscopy, surgical; colectomy, partial, with anastomosis' },
          { code: '49320', description: 'Diagnostic laparoscopy' },
        ],
        urgency: 'elective',
        anesthesiaType: 'general',
        status: 'intra_op',
        preOpDiagnosis: 'Cecal adenocarcinoma with luminal narrowing',
        postOpDiagnosis: 'Adenocarcinoma cecum pT3N0, R0 margin resected',
        estimatedDurationMinutes: 210,
        pacuBedAssigned: 'b-surg-401',
        bloodUnitsReserved: 2,
        notes: 'Specimen sent for frozen section. Hemostasis secured with Harmonic scalpel.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'case-or-102',
        tenantId,
        patientId: 'p-1001',
        patientName: 'Elena Rostova',
        patientMRN: 'GH-2026-9812',
        patientAge: 44,
        patientGender: 'Female',
        patientBloodType: 'O+',
        patientAllergies: ['Penicillin', 'Sulfa Drugs'],
        surgeonId: 'staff-surg-2',
        surgeonName: 'Dr. Sarah Jenkins, MD, FACC, FACS',
        anesthesiologistId: 'staff-anes-1',
        anesthesiologistName: 'Dr. Elena Rostova-Chen, MD',
        scrubNurseName: 'Nurse Clara Oswald, BSN, RN',
        circulatingNurseName: 'Nurse John Davis, RN',
        orRoomId: 'or-suite-2',
        orRoomName: 'OR Suite 2 (Cardiovascular Hybrid)',
        scheduledStartTime: '2026-08-15T07:30',
        scheduledEndTime: '2026-08-15T12:00',
        actualStartTime: '2026-08-15T07:45',
        surgicalProcedureName: 'Coronary Artery Bypass Graft (CABG x3) with LIMA to LAD',
        procedureCategory: 'Cardiothoracic Surgery',
        icd10Codes: [
          { code: 'I25.10', description: 'Atherosclerotic heart disease of native coronary artery' },
          { code: 'I21.09', description: 'ST elevation (STEMI) myocardial infarction involving anterior wall' },
        ],
        cptCodes: [
          { code: '33533', description: 'Coronary artery bypass, using arterial graft(s); single arterial graft' },
          { code: '33518', description: 'Coronary artery bypass, using venous graft(s); 2 coronary venous grafts' },
        ],
        urgency: 'urgent',
        anesthesiaType: 'general',
        status: 'post_op_pacu',
        preOpDiagnosis: 'Triple vessel coronary artery disease with critical LAD stenosis',
        postOpDiagnosis: 'Successful CABG x3: LIMA-LAD, SVG-OM1, SVG-PDA',
        estimatedDurationMinutes: 270,
        pacuBedAssigned: 'b-icu-101',
        bloodUnitsReserved: 4,
        notes: 'Weaned successfully from cardiopulmonary bypass. Transferred to ICU Bed 101 on dopamine support.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'case-or-103',
        tenantId,
        patientId: 'p-1004',
        patientName: 'David Kim',
        patientMRN: 'GH-2026-7782',
        patientAge: 51,
        patientGender: 'Male',
        patientBloodType: 'B+',
        patientAllergies: [],
        surgeonId: 'staff-surg-3',
        surgeonName: 'Dr. Marcus Sterling, MD, FAAOS',
        anesthesiologistId: 'staff-anes-2',
        anesthesiologistName: 'Dr. Arthur Vance, MD, FASA',
        scrubNurseName: 'Nurse Clara Oswald, BSN, RN',
        circulatingNurseName: 'Nurse Maya Patel, BSN, RN',
        orRoomId: 'or-suite-3',
        orRoomName: 'OR Suite 3 (Orthopedic & Trauma)',
        scheduledStartTime: '2026-08-15T13:00',
        scheduledEndTime: '2026-08-15T16:00',
        surgicalProcedureName: 'Total Knee Arthroplasty (TKA) - Robotic Assisted Left Knee',
        procedureCategory: 'Orthopedic Surgery',
        icd10Codes: [
          { code: 'M17.12', description: 'Unilateral primary osteoarthritis, left knee' },
        ],
        cptCodes: [
          { code: '27447', description: 'Arthroplasty, knee, condyle and plateau; medical and lateral compartments' },
        ],
        urgency: 'elective',
        anesthesiaType: 'regional',
        status: 'scheduled',
        preOpDiagnosis: 'Severe tricompartmental osteoarthritis left knee',
        estimatedDurationMinutes: 180,
        pacuBedAssigned: 'b-surg-403',
        implantRequired: true,
        implantDetails: 'Stryker Triathlon Total Knee System (Size 5 Femoral, Size 4 Tibial)',
        notes: 'Pre-op spinal anesthesia planned with adductor canal block.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'case-or-104',
        tenantId,
        patientId: 'p-1006',
        patientName: 'Aisha Bello',
        patientMRN: 'GH-2026-9043',
        patientAge: 53,
        patientGender: 'Female',
        patientBloodType: 'O-',
        patientAllergies: ['Latex'],
        surgeonId: 'staff-surg-1',
        surgeonName: 'Dr. David Rodriguez, MD, FACS',
        anesthesiologistId: 'staff-anes-1',
        anesthesiologistName: 'Dr. Elena Rostova-Chen, MD',
        scrubNurseName: 'Nurse Kevin O\'Connor, BSN, CNOR',
        circulatingNurseName: 'Nurse Maya Patel, BSN, RN',
        orRoomId: 'or-suite-1',
        orRoomName: 'OR Suite 1 (General Laparoscopy)',
        scheduledStartTime: '2026-08-15T14:30',
        scheduledEndTime: '2026-08-15T16:30',
        surgicalProcedureName: 'Laparoscopic Cholecystectomy with Intraoperative Cholangiogram',
        procedureCategory: 'General Surgery / HPB',
        icd10Codes: [
          { code: 'K80.00', description: 'Calculus of gallbladder with acute cholecystitis without obstruction' },
        ],
        cptCodes: [
          { code: '47563', description: 'Laparoscopy, surgical; cholecystectomy with cholangiography' },
        ],
        urgency: 'urgent',
        anesthesiaType: 'general',
        status: 'pre_op',
        preOpDiagnosis: 'Acute calculous cholecystitis with biliary colic',
        estimatedDurationMinutes: 120,
        pacuBedAssigned: 'b-card-311',
        bloodUnitsReserved: 1,
        notes: 'Latex-free protocol required. IV Antibiotic prophylaxis verified.',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'case-or-105',
        tenantId,
        patientId: 'p-1008',
        patientName: 'Liam Miller',
        patientMRN: 'GH-2026-2218',
        patientAge: 8,
        patientGender: 'Male',
        patientBloodType: 'A+',
        patientAllergies: [],
        surgeonId: 'staff-surg-1',
        surgeonName: 'Dr. David Rodriguez, MD, FACS',
        anesthesiologistId: 'staff-anes-2',
        anesthesiologistName: 'Dr. Arthur Vance, MD, FASA',
        scrubNurseName: 'Nurse Clara Oswald, BSN, RN',
        circulatingNurseName: 'Nurse John Davis, RN',
        orRoomId: 'or-suite-5',
        orRoomName: 'OR Suite 5 (Robotic Multi-Specialty)',
        scheduledStartTime: '2026-08-15T16:00',
        scheduledEndTime: '2026-08-15T18:00',
        surgicalProcedureName: 'Pediatric Open Inguinal Hernia Repair (Herniorrhaphy)',
        procedureCategory: 'Pediatric Surgery',
        icd10Codes: [
          { code: 'K40.90', description: 'Unilateral inguinal hernia, without obstruction or gangrene' },
        ],
        cptCodes: [
          { code: '49500', description: 'Repair initial inguinal hernia, age 6 months to younger than 5 years' },
        ],
        urgency: 'elective',
        anesthesiaType: 'general',
        status: 'scheduled',
        preOpDiagnosis: 'Right indirect congenital inguinal hernia',
        estimatedDurationMinutes: 90,
        pacuBedAssigned: 'b-ped-511',
        notes: 'Pediatric laryngeal mask airway (LMA) planned.',
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const orCase of cases) {
      batch.set(doc(db, 'tenants', tenantId, 'surgicalCases', orCase.id), orCase);
    }

    await batch.commit();

    // Initialize WHO checklist for case 101
    await initializeWHOChecklist(tenantId, 'case-or-101', cases[0]);
    await initializeWHOChecklist(tenantId, 'case-or-102', cases[1]);
    await initializeWHOChecklist(tenantId, 'case-or-103', cases[2]);
    await initializeWHOChecklist(tenantId, 'case-or-104', cases[3]);
    await initializeWHOChecklist(tenantId, 'case-or-105', cases[4]);

    console.log('Seeded Phase 8 Inpatient Wards, Beds, OR Suites and Cases successfully.');
  } catch (error) {
    console.error('Error seeding Phase 8 Inpatient & OR data:', error);
  }
}
