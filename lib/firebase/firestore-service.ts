import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from './config';
import { handleFirestoreError, OperationType } from './errors';
import {
  Patient,
  Bed,
  BillingAuditMismatch,
  OpdQueueToken,
  StaffMember,
  AuditLogEntry,
  Hl7Message,
} from '@/lib/types/ghims';

// Subscriptions
export function subscribeToPatients(callback: (patients: Patient[]) => void) {
  const path = 'patients';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data() as Patient);
          callback(items);
        }
      },
      (error) => {
        if (error?.code === 'unavailable' || error?.message?.includes('offline') || error?.message?.includes('unavailable')) {
          console.warn(`Firestore subscription [${path}] offline mode:`, error.message);
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    if ((error as any)?.code === 'unavailable' || (error as any)?.message?.includes('offline')) {
      return () => {};
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToBeds(callback: (beds: Bed[]) => void) {
  const path = 'beds';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data() as Bed);
          callback(items);
        }
      },
      (error) => {
        if (error?.code === 'unavailable' || error?.message?.includes('offline') || error?.message?.includes('unavailable')) {
          console.warn(`Firestore subscription [${path}] offline mode:`, error.message);
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    if ((error as any)?.code === 'unavailable' || (error as any)?.message?.includes('offline')) {
      return () => {};
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToBillingMismatches(callback: (mismatches: BillingAuditMismatch[]) => void) {
  const path = 'billingMismatches';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data() as BillingAuditMismatch);
          callback(items);
        }
      },
      (error) => {
        if (error?.code === 'unavailable' || error?.message?.includes('offline') || error?.message?.includes('unavailable')) {
          console.warn(`Firestore subscription [${path}] offline mode:`, error.message);
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    if ((error as any)?.code === 'unavailable' || (error as any)?.message?.includes('offline')) {
      return () => {};
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToOpdQueue(callback: (tokens: OpdQueueToken[]) => void) {
  const path = 'opdQueue';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data() as OpdQueueToken);
          callback(items);
        }
      },
      (error) => {
        if (error?.code === 'unavailable' || error?.message?.includes('offline') || error?.message?.includes('unavailable')) {
          console.warn(`Firestore subscription [${path}] offline mode:`, error.message);
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    if ((error as any)?.code === 'unavailable' || (error as any)?.message?.includes('offline')) {
      return () => {};
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToAuditLogs(callback: (logs: AuditLogEntry[]) => void) {
  const path = 'auditLogs';
  try {
    const q = query(collection(db, path), limit(50));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const items = snapshot.docs.map((d) => d.data() as AuditLogEntry);
          callback(items);
        }
      },
      (error) => {
        if (error?.code === 'unavailable' || error?.message?.includes('offline') || error?.message?.includes('unavailable')) {
          console.warn(`Firestore subscription [${path}] offline mode:`, error.message);
          return;
        }
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    if ((error as any)?.code === 'unavailable' || (error as any)?.message?.includes('offline')) {
      return () => {};
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// Mutations
export async function syncPatientToFirestore(patient: Patient): Promise<void> {
  const path = `patients/${patient.id}`;
  try {
    await setDoc(doc(db, 'patients', patient.id), cleanFirestoreData(patient), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncBedToFirestore(bed: Bed): Promise<void> {
  const path = `beds/${bed.id}`;
  try {
    await setDoc(doc(db, 'beds', bed.id), cleanFirestoreData(bed), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncMismatchToFirestore(mismatch: BillingAuditMismatch): Promise<void> {
  const path = `billingMismatches/${mismatch.id}`;
  try {
    await setDoc(doc(db, 'billingMismatches', mismatch.id), cleanFirestoreData(mismatch), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncOpdTokenToFirestore(token: OpdQueueToken): Promise<void> {
  const path = `opdQueue/${token.id}`;
  try {
    await setDoc(doc(db, 'opdQueue', token.id), cleanFirestoreData(token), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncAuditLogToFirestore(log: AuditLogEntry): Promise<void> {
  const path = `auditLogs/${log.id}`;
  try {
    await setDoc(doc(db, 'auditLogs', log.id), cleanFirestoreData(log));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function syncHl7ToFirestore(message: Hl7Message): Promise<void> {
  const path = `hl7Messages/${message.id}`;
  try {
    await setDoc(doc(db, 'hl7Messages', message.id), cleanFirestoreData(message), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Seed initial dataset to Firestore if empty
export async function seedInitialFirestoreData(
  initialPatients: Patient[],
  initialBeds: Bed[],
  initialMismatches: BillingAuditMismatch[],
  initialTokens: OpdQueueToken[],
  initialStaff: StaffMember[]
) {
  try {
    const patientsSnap = await getDocs(collection(db, 'patients'));
    if (patientsSnap.empty) {
      console.log('Seeding initial clinical data to Firestore...');
      for (const p of initialPatients) {
        await setDoc(doc(db, 'patients', p.id), cleanFirestoreData(p));
      }
      for (const b of initialBeds) {
        await setDoc(doc(db, 'beds', b.id), cleanFirestoreData(b));
      }
      for (const m of initialMismatches) {
        await setDoc(doc(db, 'billingMismatches', m.id), cleanFirestoreData(m));
      }
      for (const t of initialTokens) {
        await setDoc(doc(db, 'opdQueue', t.id), cleanFirestoreData(t));
      }
      for (const s of initialStaff) {
        await setDoc(doc(db, 'staff', s.id), cleanFirestoreData(s));
      }
    }
  } catch (error) {
    console.warn('Firestore initial seeding deferred or offline:', error);
  }
}
