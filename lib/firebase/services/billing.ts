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
  runTransaction,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from '../config';
import { handleFirestoreError, OperationType } from '../errors';
import { Tariff, Invoice, Claim, PaymentRecord, ClaimLineItem, ChargeItem } from '@/types/billing';
import { round2 } from '@/lib/billing/charges';

// ==========================================
// 1. TARIFFS SERVICE
// ==========================================

export async function createOrUpdateTariff(tenantId: string, tariff: Tariff): Promise<void> {
  const path = `tenants/${tenantId}/tariffs/${tariff.id}`;
  try {
    const tariffRef = doc(db, 'tenants', tenantId, 'tariffs', tariff.id);
    await setDoc(tariffRef, cleanFirestoreData({
      ...tariff,
      tenantId,
      updatedAt: new Date().toISOString(),
    }), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteTariff(tenantId: string, tariffId: string): Promise<void> {
  const path = `tenants/${tenantId}/tariffs/${tariffId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'tariffs', tariffId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function getTariffs(tenantId: string): Promise<Tariff[]> {
  const path = `tenants/${tenantId}/tariffs`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'tariffs'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      // Seed default tariffs on empty read
      await seedInitialTariffs(tenantId);
      const seededSnap = await getDocs(q);
      return seededSnap.docs.map((d) => d.data() as Tariff);
    }
    return snapshot.docs.map((d) => d.data() as Tariff);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getTariffById(tenantId: string, tariffId: string): Promise<Tariff | null> {
  const path = `tenants/${tenantId}/tariffs/${tariffId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'tariffs', tariffId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as Tariff;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ==========================================
// 2. INVOICE & SPLIT-BILLING SERVICE
// ==========================================

export async function generateInvoice(tenantId: string, invoice: Invoice): Promise<Invoice> {
  const path = `tenants/${tenantId}/invoices/${invoice.id}`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoice.id);
    const invoicePayload: Invoice = {
      ...invoice,
      tenantId,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(invoiceRef, invoicePayload, { merge: true });
    return invoicePayload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getInvoices(tenantId: string): Promise<Invoice[]> {
  const path = `tenants/${tenantId}/invoices`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'invoices'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialInvoices(tenantId);
      const seededSnap = await getDocs(q);
      return seededSnap.docs.map((d) => d.data() as Invoice);
    }
    return snapshot.docs.map((d) => d.data() as Invoice);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getInvoiceById(tenantId: string, invoiceId: string): Promise<Invoice | null> {
  const path = `tenants/${tenantId}/invoices/${invoiceId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as Invoice;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToInvoices(tenantId: string, callback: (invoices: Invoice[]) => void) {
  const path = `tenants/${tenantId}/invoices`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'invoices'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as Invoice);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Executes a transactional payment recording to prevent race conditions and balance desync.
 */
export async function recordPayment(
  tenantId: string,
  invoiceId: string,
  payment: Omit<PaymentRecord, 'id' | 'timestamp'>
): Promise<Invoice> {
  const path = `tenants/${tenantId}/invoices/${invoiceId}`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);

    const updatedInvoice = await runTransaction(db, async (transaction) => {
      const invoiceDoc = await transaction.get(invoiceRef);
      if (!invoiceDoc.exists()) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const current = invoiceDoc.data() as Invoice;
      const paymentAmount = round2(Number(payment.amount));
      if (paymentAmount <= 0) {
        throw new Error('Payment amount must be greater than zero');
      }

      const newTotalPaid = round2((current.totalPaid || 0) + paymentAmount);
      const newBalanceDue = round2(Math.max(0, current.totalPatientDue - newTotalPaid));

      let newStatus: Invoice['paymentStatus'] = 'partially_paid';
      if (newBalanceDue <= 0.01) {
        newStatus = 'paid';
      } else if (newTotalPaid === 0) {
        newStatus = 'pending';
      }

      const newRecord: PaymentRecord = {
        id: `pmt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        amount: paymentAmount,
        method: payment.method,
        referenceNumber: payment.referenceNumber || `TXN-${Date.now().toString().slice(-6)}`,
        recordedBy: payment.recordedBy || 'Billing Cashier',
        cashierId: payment.cashierId || (payment.recordedBy?.match(/CSH-\w+/)?.[0] || 'CSH-4091'),
        stationId: payment.stationId || 'POS-STATION-01',
        timestamp: new Date().toISOString(),
        notes: payment.notes,
      };

      const paymentHistory = [...(current.paymentHistory || []), newRecord];

      const patch: Partial<Invoice> = {
        totalPaid: newTotalPaid,
        balanceDue: newBalanceDue,
        paymentStatus: newStatus,
        paymentHistory,
        updatedAt: new Date().toISOString(),
      };

      transaction.update(invoiceRef, patch);

      return {
        ...current,
        ...patch,
      } as Invoice;
    });

    return updatedInvoice;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateInvoice(
  tenantId: string,
  invoiceId: string,
  updates: Partial<Invoice>
): Promise<void> {
  const path = `tenants/${tenantId}/invoices/${invoiceId}`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);
    await updateDoc(invoiceRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteInvoice(tenantId: string, invoiceId: string): Promise<void> {
  const path = `tenants/${tenantId}/invoices/${invoiceId}`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);
    await deleteDoc(invoiceRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function addChargeItemToInvoice(
  tenantId: string,
  invoiceId: string,
  newItem: ChargeItem
): Promise<Invoice> {
  const path = `tenants/${tenantId}/invoices/${invoiceId}`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);
    const invoiceSnap = await getDoc(invoiceRef);
    if (!invoiceSnap.exists()) throw new Error(`Invoice ${invoiceId} not found`);

    const inv = invoiceSnap.data() as Invoice;
    const items = [...(inv.items || []), newItem];

    const totalGross = round2(items.reduce((s, i) => s + (i.grossAmount || 0), 0));
    const totalDiscount = round2(items.reduce((s, i) => s + (i.discountAmount || 0), 0));
    const totalTax = round2(items.reduce((s, i) => s + (i.tax || 0), 0));
    const totalCoverage = round2(items.reduce((s, i) => s + (i.insurancePortion || 0), 0));
    const totalPatientDue = round2(items.reduce((s, i) => s + (i.patientPortion || 0), 0));
    const balanceDue = round2(Math.max(0, totalPatientDue - (inv.totalPaid || 0)));

    let paymentStatus: Invoice['paymentStatus'] = inv.paymentStatus;
    if (balanceDue <= 0.01 && inv.totalPaid > 0) {
      paymentStatus = 'paid';
    } else if (inv.totalPaid > 0 && balanceDue > 0) {
      paymentStatus = 'partially_paid';
    } else {
      paymentStatus = 'pending';
    }

    const patch: Partial<Invoice> = {
      items,
      totalGross,
      totalDiscount,
      totalTax,
      totalCoverage,
      totalPatientDue,
      balanceDue,
      paymentStatus,
      updatedAt: new Date().toISOString(),
    };

    await updateDoc(invoiceRef, patch);
    return { ...inv, ...patch } as Invoice;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteClaim(tenantId: string, claimId: string): Promise<void> {
  const path = `tenants/${tenantId}/claims/${claimId}`;
  try {
    const claimRef = doc(db, 'tenants', tenantId, 'claims', claimId);
    await deleteDoc(claimRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==========================================
// 3. INSURANCE CLAIMS ADJUDICATION SERVICE
// ==========================================

export async function generateInsuranceClaim(
  tenantId: string,
  invoiceId: string,
  approvalCode?: string,
  overrideProviderId?: string
): Promise<Claim> {
  const path = `tenants/${tenantId}/claims`;
  try {
    const invoiceRef = doc(db, 'tenants', tenantId, 'invoices', invoiceId);
    const invoiceSnap = await getDoc(invoiceRef);

    if (!invoiceSnap.exists()) {
      throw new Error(`Cannot generate claim: Invoice ${invoiceId} not found`);
    }

    const inv = invoiceSnap.data() as Invoice;
    const coveredItems = inv.items.filter((item) => item.insurancePortion > 0);

    if (coveredItems.length === 0 && inv.totalCoverage === 0) {
      throw new Error('Invoice has zero insurance coverage responsibility. Claim generation skipped.');
    }

    const claimId = `clm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const claimNumber = `CLM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const lineItems: ClaimLineItem[] = coveredItems.map((item) => ({
      itemId: item.id,
      code: item.code,
      description: item.description,
      icd10Code: item.icd10Code || 'Z00.00',
      icd10Description: item.icd10Description || 'General Medical Examination',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      billedAmount: item.insurancePortion,
      allowedAmount: item.insurancePortion,
      adjudicatedStatus: 'pending',
    }));

    const totalClaimAmount = round2(lineItems.reduce((acc, l) => acc + (l.billedAmount ?? l.claimedAmount ?? 0), 0) || inv.totalCoverage);

    const newClaim: Claim = {
      id: claimId,
      tenantId,
      claimNumber,
      invoiceId: inv.id,
      patientId: inv.patientId,
      patientName: inv.patientName,
      mrn: inv.mrn,
      encounterId: inv.encounterId,
      insuranceProviderId: overrideProviderId || inv.tariffId || 'ins-jubilee-01',
      insuranceProviderName: inv.payerName || 'Primary Payer Carrier',
      policyNumber: inv.policyNumber || 'POL-992384-A',
      approvalCode: approvalCode || inv.approvalCode || `PRE-${Math.floor(100000 + Math.random() * 900000)}`,
      totalClaimAmount,
      approvedAmount: 0,
      patientCopayAmount: inv.totalPatientDue,
      claimStatus: 'draft',
      lineItems,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save claim document
    const claimRef = doc(db, 'tenants', tenantId, 'claims', claimId);
    await setDoc(claimRef, newClaim);

    // Link claim back to invoice
    await updateDoc(invoiceRef, {
      claimId,
      approvalCode: newClaim.approvalCode,
      updatedAt: new Date().toISOString(),
    });

    return newClaim;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getClaims(tenantId: string): Promise<Claim[]> {
  const path = `tenants/${tenantId}/claims`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'claims'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialClaims(tenantId);
      const seededSnap = await getDocs(q);
      return seededSnap.docs.map((d) => d.data() as Claim);
    }
    return snapshot.docs.map((d) => d.data() as Claim);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getClaimById(tenantId: string, claimId: string): Promise<Claim | null> {
  const path = `tenants/${tenantId}/claims/${claimId}`;
  try {
    const docRef = doc(db, 'tenants', tenantId, 'claims', claimId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as Claim;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateClaimStatus(
  tenantId: string,
  claimId: string,
  status: Claim['claimStatus'],
  adjudicationDetails?: {
    approvedAmount?: number;
    adjudicationNotes?: string;
    rejectionReason?: string;
  }
): Promise<void> {
  const path = `tenants/${tenantId}/claims/${claimId}`;
  try {
    const claimRef = doc(db, 'tenants', tenantId, 'claims', claimId);
    const updatePayload: Partial<Claim> = {
      claimStatus: status,
      updatedAt: new Date().toISOString(),
    };

    if (status === 'submitted') {
      updatePayload.submissionDate = new Date().toISOString();
    } else if (status === 'approved' || status === 'adjudicated' || status === 'rejected') {
      updatePayload.adjudicationDate = new Date().toISOString();
    }

    if (adjudicationDetails?.approvedAmount !== undefined) {
      updatePayload.approvedAmount = round2(adjudicationDetails.approvedAmount);
    }
    if (adjudicationDetails?.adjudicationNotes) {
      updatePayload.adjudicationNotes = adjudicationDetails.adjudicationNotes;
    }
    if (adjudicationDetails?.rejectionReason) {
      updatePayload.rejectionReason = adjudicationDetails.rejectionReason;
    }

    await updateDoc(claimRef, cleanFirestoreData(updatePayload));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToClaims(tenantId: string, callback: (claims: Claim[]) => void) {
  const path = `tenants/${tenantId}/claims`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'claims'));
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((d) => d.data() as Claim);
        callback(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ==========================================
// 4. SEEDING DEFAULTS
// ==========================================

export async function seedInitialTariffs(tenantId: string): Promise<void> {
  const defaultTariffs: Tariff[] = [
    {
      id: 'tariff-standard-cash',
      tenantId,
      name: 'Standard Cash Self-Pay',
      planName: 'cash',
      description: 'Standard retail hospital fee schedule for un-insured or self-paying outpatients & inpatients.',
      defaultDiscountPercent: 0,
      copayPercent: 100,
      priceOverrides: {},
      isDefault: true,
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'tariff-jubilee-gold',
      tenantId,
      name: 'Jubilee Life Insurance (Gold Tier)',
      planName: 'private_insurance',
      payerCode: 'JUBILEE-HLTH',
      description: 'Corporate and individual private comprehensive health insurance network with negotiated discount.',
      defaultDiscountPercent: 15,
      copayPercent: 20, // 20% patient copay, 80% coverage
      maxCopayCap: 250, // $250 max patient cap
      priceOverrides: {
        'CPT-99204': 110.0,
        'CPT-99214': 75.0,
        'LOINC-80053': 48.0,
        'CPT-71046': 65.0,
        'BED-ICU-MONITOR': 550.0,
      },
      isDefault: false,
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'tariff-habib-corp',
      tenantId,
      name: 'Habib Metro Corporate Health Plan',
      planName: 'corporate',
      payerCode: 'HBL-CORP-MED',
      description: 'Executive corporate employee wellness coverage with 10% copay and subsidized medicines.',
      defaultDiscountPercent: 10,
      copayPercent: 10,
      maxCopayCap: 100,
      priceOverrides: {
        'CPT-99204': 125.0,
        'LOINC-80061': 42.0,
        'RX-INSULIN-GLAR': 70.0,
      },
      isDefault: false,
      status: 'active',
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: 'tariff-sehat-sahulat',
      tenantId,
      name: 'National Sehat Sahulat Health Card',
      planName: 'government',
      payerCode: 'GOV-SEHAT-PK',
      description: 'Universal government social health insurance program providing 100% cashless emergency and surgical coverage.',
      defaultDiscountPercent: 25,
      copayPercent: 0, // 0% patient copay (100% government coverage)
      maxCopayCap: 0,
      priceOverrides: {
        'CPT-99285': 220.0,
        'BED-GEN-WARD': 80.0,
        'BED-ICU-MONITOR': 400.0,
        'RX-CEFTRIAX-1G': 25.0,
      },
      isDefault: false,
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ];

  for (const t of defaultTariffs) {
    await setDoc(doc(db, 'tenants', tenantId, 'tariffs', t.id), t, { merge: true });
  }
}

export async function seedInitialInvoices(tenantId: string): Promise<void> {
  const sampleInvoices: Invoice[] = [
    {
      id: 'inv-enc-8092-441',
      tenantId,
      invoiceNumber: 'INV-2026-809201',
      patientId: 'pat-101',
      patientName: 'Elena Rostova',
      mrn: 'MRN-882190',
      encounterId: 'ENC-8092',
      tariffId: 'tariff-jubilee-gold',
      tariffName: 'Jubilee Life Insurance (Gold Tier)',
      planName: 'private_insurance',
      payerName: 'Jubilee Life Insurance',
      policyNumber: 'POL-JUB-88219-G',
      approvalCode: 'PRE-488201',
      totalGross: 620.0,
      totalDiscount: 85.0,
      totalTax: 0,
      totalCoverage: 428.0,
      totalPatientDue: 107.0,
      totalPaid: 107.0,
      balanceDue: 0.0,
      paymentStatus: 'paid',
      paymentMethod: 'split',
      items: [
        {
          id: 'chg-001',
          entitySource: 'consultation',
          code: 'CPT-99214',
          description: 'Established Patient Detailed Follow-up (Level 4)',
          quantity: 1,
          unitPrice: 75.0,
          grossAmount: 75.0,
          discountAmount: 20.0,
          tax: 0,
          netAmount: 75.0,
          insurancePortion: 60.0,
          patientPortion: 15.0,
          timestamp: '2026-08-14T09:30:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ENC-8092',
          icd10Code: 'I10',
          icd10Description: 'Essential (primary) hypertension',
        },
        {
          id: 'chg-002',
          entitySource: 'lab',
          code: 'LOINC-80053',
          description: 'Comprehensive Metabolic Panel (CMP 14)',
          quantity: 1,
          unitPrice: 48.0,
          grossAmount: 48.0,
          discountAmount: 17.0,
          tax: 0,
          netAmount: 48.0,
          insurancePortion: 38.4,
          patientPortion: 9.6,
          timestamp: '2026-08-14T10:15:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ORD-LAB-902',
          icd10Code: 'E11.9',
          icd10Description: 'Type 2 diabetes mellitus',
        },
        {
          id: 'chg-003',
          entitySource: 'radiology',
          code: 'CPT-71046',
          description: 'Chest Radiograph X-Ray (2 Views AP/Lateral)',
          quantity: 1,
          unitPrice: 65.0,
          grossAmount: 65.0,
          discountAmount: 20.0,
          tax: 0,
          netAmount: 65.0,
          insurancePortion: 52.0,
          patientPortion: 13.0,
          timestamp: '2026-08-14T11:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ORD-RAD-412',
          icd10Code: 'R05.9',
          icd10Description: 'Cough, unspecified',
        },
        {
          id: 'chg-004',
          entitySource: 'bed_day',
          code: 'BED-GEN-WARD',
          description: 'Inpatient General Medical Ward Bed Accommodations (24hr)',
          quantity: 3,
          unitPrice: 115.0,
          grossAmount: 345.0,
          discountAmount: 15.0,
          tax: 0,
          netAmount: 345.0,
          insurancePortion: 276.0,
          patientPortion: 69.0,
          timestamp: '2026-08-14T12:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'BED-104',
          icd10Code: 'Z00.00',
          icd10Description: 'Inpatient hospital care',
        },
      ],
      paymentHistory: [
        {
          id: 'pmt-001a',
          amount: 50.0,
          method: 'pos',
          referenceNumber: 'POS-TXN-88491',
          recordedBy: 'Zainab Qureshi (Senior Cashier)',
          cashierId: 'CSH-4091',
          stationId: 'POS-TERMINAL-01',
          timestamp: '2026-08-14T11:45:00.000Z',
          notes: 'Initial admission copay deposit collected via Visa Card.',
        },
        {
          id: 'pmt-001b',
          amount: 57.0,
          method: 'pos',
          referenceNumber: 'POS-TXN-88492',
          recordedBy: 'Marcus Vance (Cashier Supervisor)',
          cashierId: 'CSH-1044',
          stationId: 'POS-TERMINAL-02',
          timestamp: '2026-08-14T14:30:00.000Z',
          notes: 'Final discharge balance settled via Mastercard.',
        },
      ],
      claimId: 'clm-jub-882190-01',
      notes: 'Split billing processed successfully under Jubilee Insurance Gold Policy.',
      createdAt: '2026-08-14T09:00:00.000Z',
      updatedAt: '2026-08-14T14:30:00.000Z',
    },
    {
      id: 'inv-enc-9104-118',
      tenantId,
      invoiceNumber: 'INV-2026-910402',
      patientId: 'pat-102',
      patientName: 'Tariq Mehmood',
      mrn: 'MRN-774019',
      encounterId: 'ENC-9104',
      tariffId: 'tariff-standard-cash',
      tariffName: 'Standard Cash Self-Pay',
      planName: 'cash',
      payerName: 'Self-Pay Cash',
      totalGross: 390.0,
      totalDiscount: 0,
      totalTax: 0,
      totalCoverage: 0,
      totalPatientDue: 390.0,
      totalPaid: 200.0,
      balanceDue: 190.0,
      paymentStatus: 'partially_paid',
      paymentMethod: 'cash',
      items: [
        {
          id: 'chg-005',
          entitySource: 'consultation',
          code: 'CPT-99204',
          description: 'New Patient Comprehensive Consultation (Level 4)',
          quantity: 1,
          unitPrice: 150.0,
          grossAmount: 150.0,
          discountAmount: 0,
          tax: 0,
          netAmount: 150.0,
          insurancePortion: 0,
          patientPortion: 150.0,
          timestamp: '2026-08-15T08:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ENC-9104',
          icd10Code: 'R07.9',
          icd10Description: 'Chest pain, unspecified',
        },
        {
          id: 'chg-006',
          entitySource: 'radiology',
          code: 'CPT-93000',
          description: '12-Lead Electrocardiogram (ECG) with Physician Interpretation',
          quantity: 1,
          unitPrice: 75.0,
          grossAmount: 75.0,
          discountAmount: 0,
          tax: 0,
          netAmount: 75.0,
          insurancePortion: 0,
          patientPortion: 75.0,
          timestamp: '2026-08-15T08:30:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ORD-ECG-109',
          icd10Code: 'I49.9',
          icd10Description: 'Cardiac arrhythmia',
        },
        {
          id: 'chg-007',
          entitySource: 'pharmacy',
          code: 'RX-ENOXAPARIN-40',
          description: 'Enoxaparin Sodium 40mg/0.4mL Pre-filled Syringe (Lovenox)',
          quantity: 2,
          unitPrice: 42.0,
          grossAmount: 84.0,
          discountAmount: 0,
          tax: 0,
          netAmount: 84.0,
          insurancePortion: 0,
          patientPortion: 84.0,
          timestamp: '2026-08-15T09:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'RX-9941',
          icd10Code: 'I82.90',
          icd10Description: 'Venous thromboembolism',
        },
        {
          id: 'chg-008',
          entitySource: 'pharmacy',
          code: 'RX-PARACET-IV',
          description: 'Paracetamol 1000mg/100mL IV Infusion Bottle',
          quantity: 4,
          unitPrice: 18.0,
          grossAmount: 72.0,
          discountAmount: 0,
          tax: 0,
          netAmount: 72.0,
          insurancePortion: 0,
          patientPortion: 72.0,
          timestamp: '2026-08-15T09:15:00.000Z',
          status: 'billed',
          sourceReferenceId: 'RX-9942',
          icd10Code: 'R50.9',
          icd10Description: 'Fever, unspecified',
        },
      ],
      paymentHistory: [
        {
          id: 'pmt-002',
          amount: 200.0,
          method: 'cash',
          referenceNumber: 'CSH-TXN-09411',
          recordedBy: 'Ahmed Raza (Front Desk Cashier)',
          cashierId: 'CSH-0941',
          stationId: 'FRONT-DESK-CASH',
          timestamp: '2026-08-15T10:00:00.000Z',
          notes: 'Partial cash advance payment received in currency notes.',
        },
      ],
      notes: 'Cash payment plan active. Remaining balance due on discharge.',
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    },
    {
      id: 'inv-enc-7721-305',
      tenantId,
      invoiceNumber: 'INV-2026-772103',
      patientId: 'pat-103',
      patientName: 'Fatima Al-Mansoor',
      mrn: 'MRN-449120',
      encounterId: 'ENC-7721',
      tariffId: 'tariff-habib-corp',
      tariffName: 'Habib Metro Corporate Health Plan',
      planName: 'corporate',
      payerName: 'Habib Metro Bank Ltd',
      policyNumber: 'CORP-HBL-99214-EXEC',
      approvalCode: 'AUTH-HBL-8812',
      totalGross: 550.0,
      totalDiscount: 55.0,
      totalTax: 0,
      totalCoverage: 445.5,
      totalPatientDue: 49.5,
      totalPaid: 49.5,
      balanceDue: 0.0,
      paymentStatus: 'paid',
      paymentMethod: 'mobile_wallet',
      items: [
        {
          id: 'chg-009',
          entitySource: 'consultation',
          code: 'CPT-99204',
          description: 'Specialist Executive Health Check & Assessment',
          quantity: 1,
          unitPrice: 125.0,
          grossAmount: 125.0,
          discountAmount: 12.5,
          tax: 0,
          netAmount: 125.0,
          insurancePortion: 101.25,
          patientPortion: 11.25,
          timestamp: '2026-08-16T08:30:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ENC-7721',
          icd10Code: 'Z00.00',
          icd10Description: 'General adult medical examination',
        },
        {
          id: 'chg-010',
          entitySource: 'lab',
          code: 'LOINC-80061',
          description: 'Lipid Panel (Total Cholesterol, HDL, LDL, Triglycerides)',
          quantity: 1,
          unitPrice: 42.0,
          grossAmount: 42.0,
          discountAmount: 4.2,
          tax: 0,
          netAmount: 42.0,
          insurancePortion: 34.02,
          patientPortion: 3.78,
          timestamp: '2026-08-16T09:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'ORD-LAB-1029',
          icd10Code: 'E78.5',
          icd10Description: 'Hyperlipidemia, unspecified',
        },
        {
          id: 'chg-011',
          entitySource: 'bed_day',
          code: 'BED-GEN-WARD',
          description: 'Day-Stay Executive Observation Suite (8hr)',
          quantity: 1,
          unitPrice: 383.0,
          grossAmount: 383.0,
          discountAmount: 38.3,
          tax: 0,
          netAmount: 383.0,
          insurancePortion: 310.23,
          patientPortion: 34.47,
          timestamp: '2026-08-16T10:00:00.000Z',
          status: 'billed',
          sourceReferenceId: 'BED-OBS-03',
          icd10Code: 'R53.83',
          icd10Description: 'Other fatigue',
        },
      ],
      paymentHistory: [
        {
          id: 'pmt-003',
          amount: 49.5,
          method: 'mobile_wallet',
          referenceNumber: 'MW-EASYP-774910',
          recordedBy: 'Sana Tariq (Billing Specialist)',
          cashierId: 'CSH-3392',
          stationId: 'MOBILE-POS-03',
          timestamp: '2026-08-16T10:30:00.000Z',
          notes: 'Corporate copay 10% settled via JazzCash / EasyPaisa QR scan.',
        },
      ],
      claimId: 'clm-hbl-772103-01',
      notes: 'Corporate direct billing billed to Habib Metro Corporate account.',
      createdAt: '2026-08-16T08:00:00.000Z',
      updatedAt: '2026-08-16T10:30:00.000Z',
    },
  ];

  for (const inv of sampleInvoices) {
    await setDoc(doc(db, 'tenants', tenantId, 'invoices', inv.id), inv, { merge: true });
  }
}

export async function seedInitialClaims(tenantId: string): Promise<void> {
  const sampleClaims: Claim[] = [
    {
      id: 'clm-jub-882190-01',
      tenantId,
      claimNumber: 'CLM-2026-882191',
      invoiceId: 'inv-enc-8092-441',
      patientId: 'pat-101',
      patientName: 'Elena Rostova',
      mrn: 'MRN-882190',
      encounterId: 'ENC-8092',
      insuranceProviderId: 'tariff-jubilee-gold',
      insuranceProviderName: 'Jubilee Life Insurance (Gold Tier)',
      policyNumber: 'POL-JUB-88219-G',
      approvalCode: 'PRE-488201',
      totalClaimAmount: 428.0,
      approvedAmount: 428.0,
      patientCopayAmount: 107.0,
      claimStatus: 'approved',
      lineItems: [
        {
          itemId: 'chg-001',
          code: 'CPT-99214',
          description: 'Established Patient Detailed Follow-up (Level 4)',
          icd10Code: 'I10',
          icd10Description: 'Essential (primary) hypertension',
          quantity: 1,
          unitPrice: 75.0,
          billedAmount: 60.0,
          allowedAmount: 60.0,
          adjudicatedStatus: 'approved',
        },
        {
          itemId: 'chg-002',
          code: 'LOINC-80053',
          description: 'Comprehensive Metabolic Panel (CMP 14)',
          icd10Code: 'E11.9',
          icd10Description: 'Type 2 diabetes mellitus',
          quantity: 1,
          unitPrice: 48.0,
          billedAmount: 38.4,
          allowedAmount: 38.4,
          adjudicatedStatus: 'approved',
        },
        {
          itemId: 'chg-003',
          code: 'CPT-71046',
          description: 'Chest Radiograph X-Ray (2 Views AP/Lateral)',
          icd10Code: 'R05.9',
          icd10Description: 'Cough, unspecified',
          quantity: 1,
          unitPrice: 65.0,
          billedAmount: 52.0,
          allowedAmount: 52.0,
          adjudicatedStatus: 'approved',
        },
        {
          itemId: 'chg-004',
          code: 'BED-GEN-WARD',
          description: 'Inpatient General Medical Ward Bed Accommodations (24hr)',
          icd10Code: 'Z00.00',
          icd10Description: 'Inpatient hospital care',
          quantity: 3,
          unitPrice: 115.0,
          billedAmount: 276.0,
          allowedAmount: 276.0,
          adjudicatedStatus: 'approved',
        },
      ],
      submissionDate: '2026-08-14T12:30:00.000Z',
      adjudicationDate: '2026-08-14T14:15:00.000Z',
      adjudicationNotes: 'Pre-authorization validated against electronic claims gateway. Clean claim approved 100%.',
      ediBatchId: 'EDI-837P-BATCH-9941',
      createdAt: '2026-08-14T12:00:00.000Z',
      updatedAt: '2026-08-14T14:15:00.000Z',
    },
    {
      id: 'clm-sehat-55102-02',
      tenantId,
      claimNumber: 'CLM-2026-551022',
      invoiceId: 'inv-enc-5510-992',
      patientId: 'pat-103',
      patientName: 'Farhan Ali Qureshi',
      mrn: 'MRN-449102',
      encounterId: 'ENC-5510',
      insuranceProviderId: 'tariff-sehat-sahulat',
      insuranceProviderName: 'National Sehat Sahulat Health Card',
      policyNumber: 'CNIC-35201-8849102-1',
      approvalCode: 'SEHAT-AUTH-7729',
      totalClaimAmount: 645.0,
      approvedAmount: 0,
      patientCopayAmount: 0,
      claimStatus: 'submitted',
      lineItems: [
        {
          itemId: 'chg-101',
          code: 'CPT-99285',
          description: 'Emergency Department High-Severity Triage & Resuscitation',
          icd10Code: 'R07.9',
          icd10Description: 'Chest pain, unspecified',
          quantity: 1,
          unitPrice: 220.0,
          billedAmount: 220.0,
          allowedAmount: 220.0,
          adjudicatedStatus: 'pending',
        },
        {
          itemId: 'chg-102',
          code: 'CPT-70450',
          description: 'Non-Contrast Computed Tomography (CT) Head/Brain',
          icd10Code: 'G44.1',
          icd10Description: 'Vascular headache',
          quantity: 1,
          unitPrice: 425.0,
          billedAmount: 425.0,
          allowedAmount: 425.0,
          adjudicatedStatus: 'pending',
        },
      ],
      submissionDate: '2026-08-15T07:45:00.000Z',
      adjudicationNotes: 'Submitted to Sehat Sahulat National Clearinghouse portal. Pending medical officer review.',
      ediBatchId: 'EDI-837I-BATCH-0082',
      createdAt: '2026-08-15T07:30:00.000Z',
      updatedAt: '2026-08-15T07:45:00.000Z',
    },
    {
      id: 'clm-habib-33019-03',
      tenantId,
      claimNumber: 'CLM-2026-330193',
      invoiceId: 'inv-enc-3301-115',
      patientId: 'pat-104',
      patientName: 'Ayesha Siddiqui',
      mrn: 'MRN-660194',
      encounterId: 'ENC-3301',
      insuranceProviderId: 'tariff-habib-corp',
      insuranceProviderName: 'Habib Metro Corporate Health Plan',
      policyNumber: 'HBL-EMP-99201',
      approvalCode: 'HBL-CORP-441',
      totalClaimAmount: 285.0,
      approvedAmount: 0,
      patientCopayAmount: 28.5,
      claimStatus: 'draft',
      lineItems: [
        {
          itemId: 'chg-201',
          code: 'CPT-99204',
          description: 'New Patient Comprehensive Consultation (Level 4)',
          icd10Code: 'Z00.00',
          icd10Description: 'General Medical Examination',
          quantity: 1,
          unitPrice: 125.0,
          billedAmount: 112.5,
          allowedAmount: 112.5,
          adjudicatedStatus: 'pending',
        },
        {
          itemId: 'chg-202',
          code: 'LOINC-80061',
          description: 'Lipid Profile Panel (Cholesterol, HDL, LDL)',
          icd10Code: 'E78.5',
          icd10Description: 'Hyperlipidemia, unspecified',
          quantity: 1,
          unitPrice: 42.0,
          billedAmount: 37.8,
          allowedAmount: 37.8,
          adjudicatedStatus: 'pending',
        },
        {
          itemId: 'chg-203',
          code: 'CPT-76700',
          description: 'Ultrasound Abdominal Complete Real-Time',
          icd10Code: 'R10.9',
          icd10Description: 'Abdominal pain, unspecified',
          quantity: 1,
          unitPrice: 150.0,
          billedAmount: 135.0,
          allowedAmount: 135.0,
          adjudicatedStatus: 'pending',
        },
      ],
      createdAt: '2026-08-15T11:00:00.000Z',
      updatedAt: '2026-08-15T11:00:00.000Z',
    },
  ];

  for (const c of sampleClaims) {
    await setDoc(doc(db, 'tenants', tenantId, 'claims', c.id), c, { merge: true });
  }
}
