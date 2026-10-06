import { getAdminFirestore } from '@/server/firebase/admin';
import { financePeriodId } from '@/lib/finance/finance-engine';

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '')
  .trim()
  .toUpperCase();
const projectId = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();
const tenantId = String(
  process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero'
)
  .trim()
  .toLowerCase();

if (runtime !== 'STAGING') {
  throw new Error('OPD_RP20_FIXTURE_STAGING_ONLY');
}
if (
  String(process.env.GHIMS_OPD_RP20_ALLOW_STAGING_PROVISION || '').toLowerCase() !==
  'true'
) {
  throw new Error('OPD_RP20_STAGING_PROVISION_NOT_CONFIRMED');
}
if (!projectId) throw new Error('OPD_RP20_PROJECT_ID_REQUIRED');
if (
  String(process.env.GHIMS_OPD_RP20_CONFIRM_PROJECT || '').trim() !== projectId
) {
  throw new Error('OPD_RP20_PROJECT_CONFIRMATION_MISMATCH');
}

const productionProject = String(
  process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION ||
    ''
).trim();
if (productionProject && productionProject === projectId) {
  throw new Error('OPD_RP20_REFUSES_PRODUCTION_PROJECT');
}

const db = getAdminFirestore();
if (!db) throw new Error('OPD_RP20_ADMIN_FIRESTORE_REQUIRED');

const tenantRef = db.collection('tenants').doc(tenantId);
const tenantSnapshot = await tenantRef.get();
if (!tenantSnapshot.exists) {
  throw new Error('OPD_RP20_TENANT_NOT_PROVISIONED');
}
const tenant = tenantSnapshot.data() || {};
if (
  String(tenant.environment || '').toUpperCase() !== 'STAGING' ||
  tenant.syntheticOnly !== true
) {
  throw new Error('OPD_RP20_REQUIRES_SYNTHETIC_STAGING_TENANT');
}

const now = new Date();
const nowIso = now.toISOString();
const fiscalYear = now.getUTCFullYear();
const postingPeriod = now.getUTCMonth() + 1;
const periodId = financePeriodId(fiscalYear, postingPeriod);
const periodStart = Date.UTC(fiscalYear, postingPeriod - 1, 1);
const periodEnd = Date.UTC(fiscalYear, postingPeriod, 1) - 1;

async function upsertUniqueAccount(input: {
  accountCode: string;
  accountName: string;
  category: 'asset' | 'liability' | 'revenue';
  normalBalance: 'debit' | 'credit';
  allowCashReceipts?: boolean;
}) {
  const snapshot = await tenantRef
    .collection('accounts')
    .where('accountCode', '==', input.accountCode)
    .limit(3)
    .get();

  if (snapshot.size > 1) {
    throw new Error(
      `OPD_RP20_DUPLICATE_GL_ACCOUNT:${input.accountCode}:${snapshot.size}`
    );
  }

  const ref =
    snapshot.docs[0]?.ref ||
    tenantRef.collection('accounts').doc(`opd-rp20-${input.accountCode}`);

  await ref.set(
    {
      accountId: ref.id,
      id: ref.id,
      tenantId,
      accountCode: input.accountCode,
      accountName: input.accountName,
      category: input.category,
      subCategory: 'OPD_RP20_STAGING_QUALIFICATION',
      normalBalance: input.normalBalance,
      currency: 'PKR',
      allowManualPosting: false,
      allowCashReceipts: input.allowCashReceipts === true,
      allowSupplierPayments: false,
      isActive: true,
      isSystemLocked: true,
      syntheticQualificationRecord: true,
      updatedAt: nowIso,
      ...(snapshot.empty
        ? {
            createdAt: nowIso,
            createdBy: 'OPD_RP20_STAGING_FIXTURE',
          }
        : {}),
    },
    { merge: true }
  );

  return ref.id;
}

await Promise.all([
  upsertUniqueAccount({
    accountCode: '1010',
    accountName: 'OPD RP20 Cash Control',
    category: 'asset',
    normalBalance: 'debit',
    allowCashReceipts: true,
  }),
  upsertUniqueAccount({
    accountCode: '1110',
    accountName: 'OPD RP20 Patient Accounts Receivable',
    category: 'asset',
    normalBalance: 'debit',
  }),
  upsertUniqueAccount({
    accountCode: '4010',
    accountName: 'OPD RP20 Consultation Revenue',
    category: 'revenue',
    normalBalance: 'credit',
  }),
  upsertUniqueAccount({
    accountCode: '205000',
    accountName: 'OPD RP20 Deferred Diagnostic Revenue',
    category: 'liability',
    normalBalance: 'credit',
  }),
  upsertUniqueAccount({
    accountCode: '402100',
    accountName: 'OPD RP20 Diagnostic Revenue',
    category: 'revenue',
    normalBalance: 'credit',
  }),
  upsertUniqueAccount({
    accountCode: '4030',
    accountName: 'OPD RP20 Pharmacy Revenue',
    category: 'revenue',
    normalBalance: 'credit',
  }),
]);

await tenantRef.collection('accountingPeriods').doc(periodId).set(
  {
    periodId,
    tenantId,
    fiscalYear,
    postingPeriod,
    periodKey: periodId,
    periodName: `OPD RP20 ${fiscalYear}-${String(postingPeriod).padStart(
      2,
      '0'
    )}`,
    startAt: periodStart,
    endAt: periodEnd,
    status: 'OPEN',
    syntheticQualificationRecord: true,
    createdAt: nowIso,
    createdBy: 'OPD_RP20_STAGING_FIXTURE',
  },
  { merge: true }
);

await tenantRef.collection('tariffs').doc('tariff-standard-cash').set(
  {
    id: 'tariff-standard-cash',
    tenantId,
    name: 'OPD RP20 Standard Cash',
    status: 'active',
    planName: 'cash',
    copayPercent: 100,
    defaultDiscountPercent: 0,
    syntheticQualificationRecord: true,
    updatedAt: nowIso,
  },
  { merge: true }
);

await tenantRef
  .collection('billingServiceCatalog')
  .doc('opd-consultation-standard')
  .set(
    {
      id: 'opd-consultation-standard',
      tenantId,
      serviceCode: 'OPD-CONSULT',
      description: 'Synthetic OPD RP20 consultation',
      category: 'consultation',
      status: 'ACTIVE',
      currency: 'PKR',
      unitPriceMinorUnits: 150_000,
      taxRateBasisPoints: 0,
      revenueAccountCode: '4010',
      syntheticQualificationRecord: true,
      updatedAt: nowIso,
    },
    { merge: true }
  );

await tenantRef.collection('billingServiceCatalog').doc('LAB-RP20-CBC').set(
  {
    id: 'LAB-RP20-CBC',
    tenantId,
    serviceCode: 'LAB-RP20-CBC',
    description: 'Synthetic OPD RP20 Complete Blood Count',
    orderType: 'LAB',
    category: 'laboratory',
    status: 'ACTIVE',
    currency: 'PKR',
    unitPriceMinorUnits: 120_000,
    taxRateBasisPoints: 0,
    revenueAccountCode: '402100',
    deferredRevenueAccountCode: '205000',
    specimenType: 'EDTA whole blood',
    syntheticQualificationRecord: true,
    updatedAt: nowIso,
  },
  { merge: true }
);

const medicationItemId = 'P7-PARA-500';
await tenantRef.collection('items').doc(medicationItemId).set(
  {
    itemId: medicationItemId,
    tenantId,
    organizationId: tenantId,
    itemCode: 'P7-PARA-500',
    internalSKU: 'P7-PARA-500',
    barcode: 'P7RP200000001',
    name: 'Synthetic Paracetamol 500mg',
    genericName: 'Paracetamol',
    description: 'Synthetic OPD RP20 formulary medication',
    categoryId: 'medications',
    itemType: 'MEDICATION',
    unitOfMeasure: 'TABLET',
    purchaseUOM: 'TABLET',
    stockUOM: 'TABLET',
    issueUOM: 'TABLET',
    conversionRules: [],
    preferredVendorIds: [],
    controlledItem: false,
    requiresBatchTracking: true,
    requiresExpiryTracking: true,
    requiresSerialTracking: false,
    requiresTemperatureTracking: false,
    requiresQualityInspection: false,
    requiresPatientTraceability: false,
    requiresPrescription: true,
    minimumStock: 20,
    maximumStock: 1000,
    reorderPoint: 100,
    reorderQuantity: 100,
    safetyStock: 20,
    leadTimeDays: 1,
    criticality: 'ESSENTIAL',
    abcClass: 'C',
    vedClass: 'ESSENTIAL',
    storageRequirements: 'Room temperature',
    hazardClass: 'NONE',
    unitCost: 5,
    sellingPrice: 25,
    currency: 'PKR',
    isActive: true,
    syntheticQualificationRecord: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  { merge: true }
);

const balanceId = `${tenantId}_P7H0_loc-pharmacy_P7-PARA-500_p7-batch`;
await tenantRef.collection('inventoryBalances').doc(balanceId).set(
  {
    balanceId,
    tenantId,
    facilityId: 'P7H0',
    locationId: 'loc-pharmacy',
    locationName: 'P7 Synthetic Pharmacy',
    itemId: medicationItemId,
    itemCode: 'P7-PARA-500',
    itemName: 'Synthetic Paracetamol 500mg',
    itemType: 'MEDICATION',
    batchId: 'p7-batch',
    batchNumber: 'P7-SYNTHETIC-BATCH',
    expiryDate: '2035-12-31',
    onHand: 500,
    reserved: 0,
    quarantined: 0,
    damaged: 0,
    expired: 0,
    inTransit: 0,
    available: 500,
    uom: 'TABLET',
    minimumStock: 20,
    maximumStock: 1000,
    reorderPoint: 100,
    unitCost: 5,
    totalValuation: 2500,
    lastMovementAt: nowIso,
    version: 1,
    syntheticQualificationRecord: true,
  },
  { merge: true }
);

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime,
      projectId,
      tenantId,
      syntheticOnly: true,
      financePeriodId: periodId,
      consultationCatalogId: 'opd-consultation-standard',
      diagnosticCatalogId: 'LAB-RP20-CBC',
      medicationItemId,
      inventoryBalanceId: balanceId,
      provisionedAt: nowIso,
    },
    null,
    2
  ) + '\n'
);
