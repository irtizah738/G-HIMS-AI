import { Tariff, ChargeItem, Invoice, SplitCalculationResult, ChargeEntitySource } from '@/types/billing';

/**
 * High-precision 2-decimal arithmetic rounder to prevent IEEE 754 floating point distortion
 */
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export interface CalculateLineItemParams {
  entitySource: ChargeEntitySource;
  code: string;
  description: string;
  quantity: number;
  standardPrice: number;
  tariff?: Tariff | null;
  taxRate?: number;
  sourceReferenceId?: string;
  icd10Code?: string;
  icd10Description?: string;
}

/**
 * Automated Line-Item Split Calculator applying multi-tariff discounts,
 * overridden procedure fees, and copay caps.
 */
export function calculateLineItem(params: CalculateLineItemParams): ChargeItem {
  const {
    entitySource,
    code,
    description,
    quantity,
    standardPrice,
    tariff,
    taxRate = 0,
    sourceReferenceId,
    icd10Code = 'Z00.00',
    icd10Description = 'General medical examination',
  } = params;

  const validQty = Math.max(1, quantity);
  let effectiveUnitPrice = standardPrice;
  let itemDiscount = 0;

  if (tariff) {
    // 1. Check direct override mapping for CPT / LOINC / Drug ID
    if (tariff.priceOverrides && tariff.priceOverrides[code] !== undefined) {
      effectiveUnitPrice = tariff.priceOverrides[code];
      itemDiscount = Math.max(0, round2(standardPrice - effectiveUnitPrice));
    } else if (tariff.defaultDiscountPercent > 0) {
      // 2. Apply global tier discount
      const discountRatio = tariff.defaultDiscountPercent / 100;
      effectiveUnitPrice = round2(standardPrice * (1 - discountRatio));
      itemDiscount = round2(standardPrice * discountRatio);
    }
  }

  const grossAmount = round2(validQty * effectiveUnitPrice);
  const discountAmount = round2(validQty * itemDiscount);
  const tax = round2(grossAmount * taxRate);
  const netAmount = round2(grossAmount + tax);

  let patientPortion = netAmount;
  let insurancePortion = 0;

  if (tariff && tariff.planName !== 'cash') {
    // Calculate copay percentage (e.g. 20% patient responsibility)
    const rawPatientCopay = round2(netAmount * (tariff.copayPercent / 100));

    if (tariff.maxCopayCap !== undefined && tariff.maxCopayCap > 0) {
      // Enforce insurance policy max copay ceiling
      patientPortion = Math.min(rawPatientCopay, tariff.maxCopayCap);
    } else {
      patientPortion = rawPatientCopay;
    }

    insurancePortion = round2(netAmount - patientPortion);
  }

  return {
    id: `chg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    entitySource,
    code,
    description,
    quantity: validQty,
    unitPrice: effectiveUnitPrice,
    grossAmount,
    discountAmount,
    tax,
    netAmount,
    insurancePortion,
    patientPortion,
    timestamp: new Date().toISOString(),
    status: 'billed',
    sourceReferenceId,
    icd10Code,
    icd10Description,
  };
}

/**
 * Standard hospital charge catalogue dictionary with CPT/HCPCS and LOINC mappings
 */
export const STANDARD_PRICE_CATALOGUE: Record<string, { description: string; category: ChargeEntitySource; price: number; icd10: string; icdDesc: string }> = {
  // Consultations
  'CPT-99204': { description: 'New Patient Comprehensive Consultation (Level 4)', category: 'consultation', price: 150.0, icd10: 'Z00.00', icdDesc: 'General Medical Examination' },
  'CPT-99214': { description: 'Established Patient Detailed Follow-up (Level 4)', category: 'consultation', price: 95.0, icd10: 'I10', icdDesc: 'Essential (primary) hypertension' },
  'CPT-99285': { description: 'Emergency Department High-Severity Triage & Resuscitation', category: 'consultation', price: 350.0, icd10: 'R07.9', icdDesc: 'Chest pain, unspecified' },
  'CPT-99223': { description: 'Initial Hospital Inpatient Care High Complexity', category: 'consultation', price: 240.0, icd10: 'J18.9', icdDesc: 'Pneumonia, unspecified organism' },
  
  // Laboratory
  'LOINC-80053': { description: 'Comprehensive Metabolic Panel (CMP 14)', category: 'lab', price: 65.0, icd10: 'E11.9', icdDesc: 'Type 2 diabetes mellitus without complications' },
  'LOINC-85025': { description: 'Complete Blood Count (CBC) with Automated Differential', category: 'lab', price: 45.0, icd10: 'D64.9', icdDesc: 'Anemia, unspecified' },
  'LOINC-80061': { description: 'Lipid Profile Panel (Cholesterol, HDL, LDL, Triglycerides)', category: 'lab', price: 55.0, icd10: 'E78.5', icdDesc: 'Hyperlipidemia, unspecified' },
  'LOINC-83036': { description: 'Hemoglobin A1c Glycated Blood Test', category: 'lab', price: 50.0, icd10: 'E11.9', icdDesc: 'Type 2 diabetes mellitus' },
  'LOINC-87070': { description: 'Automated Blood Culture & Antimicrobial Sensitivity', category: 'lab', price: 110.0, icd10: 'A41.9', icdDesc: 'Sepsis, unspecified organism' },

  // Radiology
  'CPT-71046': { description: 'Chest Radiograph X-Ray (2 Views AP/Lateral)', category: 'radiology', price: 85.0, icd10: 'R05.9', icdDesc: 'Cough, unspecified' },
  'CPT-70450': { description: 'Non-Contrast Computed Tomography (CT) Head/Brain', category: 'radiology', price: 420.0, icd10: 'G44.1', icdDesc: 'Vascular headache, not elsewhere classified' },
  'CPT-76700': { description: 'Ultrasound Abdominal Complete Real-Time with Doppler', category: 'radiology', price: 180.0, icd10: 'R10.9', icdDesc: 'Abdominal pain, unspecified' },
  'CPT-93000': { description: '12-Lead Electrocardiogram (ECG) with Physician Interpretation', category: 'radiology', price: 75.0, icd10: 'I49.9', icdDesc: 'Cardiac arrhythmia, unspecified' },

  // Pharmacy (FEFO Batch mapped)
  'RX-CEFTRIAX-1G': { description: 'Ceftriaxone Sodium 1g IV Infusion Vial', category: 'pharmacy', price: 38.0, icd10: 'J18.9', icdDesc: 'Pneumonia' },
  'RX-INSULIN-GLAR': { description: 'Insulin Glargine 100 units/mL SubQ Cartridge (Lantus)', category: 'pharmacy', price: 85.0, icd10: 'E11.9', icdDesc: 'Type 2 diabetes mellitus' },
  'RX-ENOXAPARIN-40': { description: 'Enoxaparin Sodium 40mg/0.4mL Pre-filled Syringe (Lovenox)', category: 'pharmacy', price: 42.0, icd10: 'I82.90', icdDesc: 'Venous thromboembolism' },
  'RX-PARACET-IV': { description: 'Paracetamol 1000mg/100mL IV Infusion Bottle', category: 'pharmacy', price: 18.0, icd10: 'R50.9', icdDesc: 'Fever, unspecified' },
  'RX-ONDANSETRON-8': { description: 'Ondansetron 8mg/4mL IV Ampoule', category: 'pharmacy', price: 24.0, icd10: 'R11.0', icdDesc: 'Nausea with vomiting' },

  // Bed & Ward Days
  'BED-GEN-WARD': { description: 'Inpatient General Medical Ward Bed Accommodations (24hr)', category: 'bed_day', price: 120.0, icd10: 'Z00.00', icdDesc: 'Inpatient hospital care' },
  'BED-ICU-MONITOR': { description: 'Intensive Care Unit (ICU) Critical Care Telemetry Bed (24hr)', category: 'bed_day', price: 750.0, icd10: 'R57.9', icdDesc: 'Shock, unspecified' },
  'BED-SURG-STEP': { description: 'Surgical Step-Down Post-Op Recovery Suite (24hr)', category: 'bed_day', price: 280.0, icd10: 'Z48.815', icdDesc: 'Encounter for surgical aftercare' },
};

export interface EncounterBillableEvents {
  patientId: string;
  patientName: string;
  mrn: string;
  encounterId: string;
  tariff: Tariff;
  policyNumber?: string;
  approvalCode?: string;
  consultations?: { code: string; customPrice?: number; description?: string; quantity?: number; referenceId?: string }[];
  labOrders?: { code: string; customPrice?: number; description?: string; quantity?: number; referenceId?: string }[];
  pharmacyDisbursements?: { code: string; customPrice?: number; description?: string; quantity?: number; referenceId?: string }[];
  bedDays?: { code: string; customPrice?: number; description?: string; quantity?: number; referenceId?: string }[];
  taxRate?: number;
  notes?: string;
}

/**
 * Automated Charge Aggregation Engine
 * Captures all point-of-care clinical transactions from consultations, LIS orders,
 * FEFO pharmacy dispensations, and bed census stays into an unbilled invoice draft.
 */
export function autoCaptureEncounterCharges(
  tenantId: string,
  events: EncounterBillableEvents
): Invoice {
  const items: ChargeItem[] = [];
  const { tariff, taxRate = 0 } = events;

  // 1. Process Consultations
  (events.consultations || []).forEach((c) => {
    const catalog = STANDARD_PRICE_CATALOGUE[c.code] || {
      description: c.description || 'Specialist Medical Consultation',
      category: 'consultation' as const,
      price: c.customPrice || 120.0,
      icd10: 'Z00.00',
      icdDesc: 'Medical Examination',
    };
    items.push(
      calculateLineItem({
        entitySource: 'consultation',
        code: c.code,
        description: c.description || catalog.description,
        quantity: c.quantity || 1,
        standardPrice: c.customPrice || catalog.price,
        tariff,
        taxRate,
        sourceReferenceId: c.referenceId || events.encounterId,
        icd10Code: catalog.icd10,
        icd10Description: catalog.icdDesc,
      })
    );
  });

  // 2. Process LIS Lab Orders
  (events.labOrders || []).forEach((l) => {
    const catalog = STANDARD_PRICE_CATALOGUE[l.code] || {
      description: l.description || 'Clinical Diagnostic Test',
      category: 'lab' as const,
      price: l.customPrice || 50.0,
      icd10: 'Z01.89',
      icdDesc: 'Diagnostic Examination',
    };
    items.push(
      calculateLineItem({
        entitySource: 'lab',
        code: l.code,
        description: l.description || catalog.description,
        quantity: l.quantity || 1,
        standardPrice: l.customPrice || catalog.price,
        tariff,
        taxRate,
        sourceReferenceId: l.referenceId,
        icd10Code: catalog.icd10,
        icd10Description: catalog.icdDesc,
      })
    );
  });

  // 3. Process FEFO Pharmacy Dispensations
  (events.pharmacyDisbursements || []).forEach((p) => {
    const catalog = STANDARD_PRICE_CATALOGUE[p.code] || {
      description: p.description || 'Dispensed Pharmaceutical Medication',
      category: 'pharmacy' as const,
      price: p.customPrice || 25.0,
      icd10: 'Z76.89',
      icdDesc: 'Medication Administration',
    };
    items.push(
      calculateLineItem({
        entitySource: 'pharmacy',
        code: p.code,
        description: p.description || catalog.description,
        quantity: p.quantity || 1,
        standardPrice: p.customPrice || catalog.price,
        tariff,
        taxRate,
        sourceReferenceId: p.referenceId,
        icd10Code: catalog.icd10,
        icd10Description: catalog.icdDesc,
      })
    );
  });

  // 4. Process Bed Census Stay Days
  (events.bedDays || []).forEach((b) => {
    const catalog = STANDARD_PRICE_CATALOGUE[b.code] || {
      description: b.description || 'Inpatient Hospital Stay Bed Days',
      category: 'bed_day' as const,
      price: b.customPrice || 150.0,
      icd10: 'Z00.00',
      icdDesc: 'Inpatient Hospital Stay',
    };
    items.push(
      calculateLineItem({
        entitySource: 'bed_day',
        code: b.code,
        description: b.description || catalog.description,
        quantity: b.quantity || 1,
        standardPrice: b.customPrice || catalog.price,
        tariff,
        taxRate,
        sourceReferenceId: b.referenceId,
        icd10Code: catalog.icd10,
        icd10Description: catalog.icdDesc,
      })
    );
  });

  // Aggregate financial metrics
  const totalGross = round2(items.reduce((sum, item) => sum + item.grossAmount, 0));
  const totalDiscount = round2(items.reduce((sum, item) => sum + item.discountAmount, 0));
  const totalTax = round2(items.reduce((sum, item) => sum + item.tax, 0));
  const totalCoverage = round2(items.reduce((sum, item) => sum + item.insurancePortion, 0));
  const totalPatientDue = round2(items.reduce((sum, item) => sum + item.patientPortion, 0));

  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const invoiceId = `inv-${events.encounterId.toLowerCase()}-${Date.now().toString().slice(-4)}`;

  return {
    id: invoiceId,
    tenantId,
    invoiceNumber,
    patientId: events.patientId,
    patientName: events.patientName,
    mrn: events.mrn,
    encounterId: events.encounterId,
    tariffId: tariff.id,
    tariffName: tariff.name,
    planName: tariff.planName,
    payerName: tariff.payerCode || (tariff.planName === 'cash' ? 'Self-Pay Cash' : tariff.name),
    policyNumber: events.policyNumber,
    approvalCode: events.approvalCode,
    totalGross,
    totalDiscount,
    totalTax,
    totalCoverage,
    totalPatientDue,
    totalPaid: 0,
    balanceDue: totalPatientDue,
    paymentStatus: 'pending',
    paymentMethod: tariff.planName === 'cash' ? 'cash' : 'split',
    items,
    paymentHistory: [],
    notes: events.notes || 'Automated encounter point-of-care charge capture complete.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
