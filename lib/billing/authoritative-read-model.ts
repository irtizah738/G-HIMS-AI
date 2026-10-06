import type { EdgeSnapshot } from '@/lib/offline/hydration';
import type {
  ChargeEntitySource,
  ChargeItem,
  Invoice,
  InvoicePaymentMethod,
  InvoicePaymentStatus,
} from '@/types/billing';

export interface BillingInvoiceReadModel {
  invoices: Invoice[];
  rejectedRows: number;
  snapshotVersion: string;
  generatedAt: number;
  source: EdgeSnapshot['source'];
}

const PAYMENT_STATUSES = new Set<InvoicePaymentStatus>([
  'pending',
  'partially_paid',
  'paid',
  'waived',
]);

const PAYMENT_METHODS = new Set<InvoicePaymentMethod>([
  'cash',
  'card',
  'pos',
  'mobile_wallet',
  'insurance_claim',
  'split',
]);

const CHARGE_SOURCES = new Set<ChargeEntitySource>([
  'consultation',
  'pharmacy',
  'lab',
  'radiology',
  'bed_day',
  'procedure',
]);

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function adaptChargeItem(rawValue: unknown): ChargeItem | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }
  const raw = rawValue as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  const source = String(raw.entitySource || '').trim().toLowerCase();
  const code = String(raw.code || '').trim();
  const description = String(raw.description || '').trim();
  const quantity = finiteNonNegative(raw.quantity);
  const unitPrice = finiteNonNegative(raw.unitPrice);
  const grossAmount = finiteNonNegative(raw.grossAmount);
  const discountAmount = finiteNonNegative(raw.discountAmount);
  const tax = finiteNonNegative(raw.tax);
  const netAmount = finiteNonNegative(raw.netAmount);
  const insurancePortion = finiteNonNegative(raw.insurancePortion);
  const patientPortion = finiteNonNegative(raw.patientPortion);

  if (
    !id ||
    !CHARGE_SOURCES.has(source as ChargeEntitySource) ||
    !code ||
    !description ||
    quantity === null ||
    quantity <= 0 ||
    unitPrice === null ||
    grossAmount === null ||
    discountAmount === null ||
    tax === null ||
    netAmount === null ||
    insurancePortion === null ||
    patientPortion === null
  ) {
    return null;
  }

  return {
    id,
    entitySource: source as ChargeEntitySource,
    code,
    description,
    quantity,
    unitPrice,
    grossAmount,
    discountAmount,
    tax,
    netAmount,
    insurancePortion,
    patientPortion,
    timestamp: String(raw.timestamp || raw.createdAt || ''),
    ...(raw.status ? { status: String(raw.status) as ChargeItem['status'] } : {}),
    ...(raw.sourceReferenceId
      ? { sourceReferenceId: String(raw.sourceReferenceId) }
      : {}),
    ...(raw.icd10Code ? { icd10Code: String(raw.icd10Code) } : {}),
    ...(raw.icd10Description
      ? { icd10Description: String(raw.icd10Description) }
      : {}),
  };
}

export function adaptAuthoritativeInvoice(
  rawValue: unknown,
  expectedTenantId: string
): Invoice | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }

  const raw = rawValue as Record<string, unknown>;
  const id = String(raw.id || raw.invoiceId || '').trim();
  const tenantId = String(raw.tenantId || '').trim().toLowerCase();
  const invoiceNumber = String(raw.invoiceNumber || '').trim();
  const patientId = String(raw.patientId || '').trim();
  const patientName = String(raw.patientName || '').trim();
  const mrn = String(raw.mrn || '').trim();
  const encounterId = String(raw.encounterId || '').trim();
  const tariffId = String(raw.tariffId || '').trim();
  const paymentStatus = String(raw.paymentStatus || '').trim().toLowerCase();
  const paymentMethod = String(raw.paymentMethod || 'cash')
    .trim()
    .toLowerCase();

  const totals = {
    totalGross: finiteNonNegative(raw.totalGross),
    totalDiscount: finiteNonNegative(raw.totalDiscount),
    totalTax: finiteNonNegative(raw.totalTax),
    totalCoverage: finiteNonNegative(raw.totalCoverage),
    totalPatientDue: finiteNonNegative(raw.totalPatientDue),
    totalPaid: finiteNonNegative(raw.totalPaid),
    balanceDue: finiteNonNegative(raw.balanceDue),
  };

  const items = Array.isArray(raw.items)
    ? raw.items.map(adaptChargeItem).filter((item): item is ChargeItem => !!item)
    : [];

  if (
    !id ||
    !tenantId ||
    tenantId !== expectedTenantId.trim().toLowerCase() ||
    !invoiceNumber ||
    !patientId ||
    !patientName ||
    !mrn ||
    !encounterId ||
    !tariffId ||
    !PAYMENT_STATUSES.has(paymentStatus as InvoicePaymentStatus) ||
    !PAYMENT_METHODS.has(paymentMethod as InvoicePaymentMethod) ||
    Object.values(totals).some((value) => value === null) ||
    !Array.isArray(raw.items) ||
    items.length !== raw.items.length
  ) {
    return null;
  }

  return {
    id,
    tenantId,
    invoiceNumber,
    patientId,
    patientName,
    mrn,
    encounterId,
    tariffId,
    tariffName: raw.tariffName ? String(raw.tariffName) : undefined,
    planName: raw.planName ? (String(raw.planName) as Invoice['planName']) : undefined,
    payerName: raw.payerName ? String(raw.payerName) : undefined,
    policyNumber: raw.policyNumber ? String(raw.policyNumber) : undefined,
    approvalCode: raw.approvalCode ? String(raw.approvalCode) : undefined,
    totalGross: totals.totalGross!,
    totalDiscount: totals.totalDiscount!,
    totalTax: totals.totalTax!,
    totalCoverage: totals.totalCoverage!,
    totalPatientDue: totals.totalPatientDue!,
    totalPaid: totals.totalPaid!,
    balanceDue: totals.balanceDue!,
    paymentStatus: paymentStatus as InvoicePaymentStatus,
    paymentMethod: paymentMethod as InvoicePaymentMethod,
    items,
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || raw.createdAt || ''),
  };
}

export function buildBillingInvoiceReadModel(
  snapshot: EdgeSnapshot
): BillingInvoiceReadModel {
  const rawInvoices = snapshot.collections.invoices || [];
  const invoices = rawInvoices
    .map((row) => adaptAuthoritativeInvoice(row, snapshot.tenantId))
    .filter((invoice): invoice is Invoice => !!invoice)
    .sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || right.createdAt) || 0;
      const leftTime = Date.parse(left.updatedAt || left.createdAt) || 0;
      return rightTime - leftTime;
    });

  return {
    invoices,
    rejectedRows: rawInvoices.length - invoices.length,
    snapshotVersion: snapshot.snapshotVersion,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
  };
}
