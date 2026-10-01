import { getAdminFirestore } from '@/server/firebase/admin';

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const projectId = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();
const tenantId = String(process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero')
  .trim()
  .toLowerCase();

if (runtime !== 'STAGING') throw new Error('DRP10_FIXTURE_PROVISION_STAGING_ONLY');
if (String(process.env.GHIMS_DRP10_ALLOW_STAGING_PROVISION || '') !== 'true') {
  throw new Error('DRP10_STAGING_PROVISION_NOT_CONFIRMED');
}
if (!projectId) throw new Error('DRP10_PROJECT_ID_REQUIRED');
if (
  String(process.env.GHIMS_DRP10_CONFIRM_PROJECT || '').trim() !== projectId
) {
  throw new Error('DRP10_PROJECT_CONFIRMATION_MISMATCH');
}

const productionProject = String(
  process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION ||
    ''
).trim();
if (productionProject && productionProject === projectId) {
  throw new Error('DRP10_REFUSES_PRODUCTION_PROJECT');
}

const db = getAdminFirestore();
if (!db) throw new Error('DRP10_ADMIN_FIRESTORE_REQUIRED');

const tenantRef = db.collection('tenants').doc(tenantId);
const now = new Date().toISOString();

const itemId = 'drp10-item-paracetamol';
const supplierId = 'drp10-supplier-primary';
const locationId = 'drp10-central-store';

await tenantRef.collection('items').doc(itemId).set(
  {
    itemId,
    tenantId,
    organizationId: tenantId,
    itemCode: 'DRP10-PARA-500',
    internalSKU: 'DRP10-PARA-500',
    barcode: 'DRP1000000001',
    name: 'DRP-10 Synthetic Paracetamol 500mg',
    genericName: 'Paracetamol',
    description: 'Synthetic staging-only inventory item for DRP-10 qualification.',
    categoryId: 'MEDICATIONS',
    itemType: 'MEDICATION',
    unitOfMeasure: 'TABLET',
    purchaseUOM: 'TABLET',
    stockUOM: 'TABLET',
    issueUOM: 'TABLET',
    conversionRules: [],
    preferredVendorIds: [supplierId],
    controlledItem: false,
    requiresBatchTracking: true,
    requiresExpiryTracking: true,
    requiresSerialTracking: false,
    requiresTemperatureTracking: false,
    requiresQualityInspection: true,
    requiresPatientTraceability: false,
    requiresPrescription: true,
    minimumStock: 0,
    maximumStock: 10000,
    reorderPoint: 100,
    reorderQuantity: 500,
    safetyStock: 50,
    leadTimeDays: 2,
    criticality: 'VITAL',
    abcClass: 'A',
    vedClass: 'VITAL',
    storageRequirements: 'Controlled room temperature',
    hazardClass: 'NONE',
    unitCost: 10,
    sellingPrice: 15,
    currency: 'PKR',
    isActive: true,
    syntheticQualificationRecord: true,
    createdAt: now,
    updatedAt: now,
  },
  { merge: true }
);

await tenantRef.collection('suppliers').doc(supplierId).set(
  {
    supplierId,
    tenantId,
    legalName: 'DRP-10 Synthetic Medical Supplier',
    displayName: 'DRP-10 Synthetic Supplier',
    registrationNumber: 'DRP10-SUP-001',
    taxNumber: 'DRP10-TAX-001',
    contactPerson: 'Synthetic Qualification Contact',
    email: 'drp10.supplier@g-hims.invalid',
    phone: '+920000000001',
    address: {
      street: 'Synthetic Staging Address',
      city: 'Qualification City',
      postalCode: '00000',
      country: 'Pakistan',
    },
    paymentTerms: 'NET30',
    creditLimit: 10000000,
    currency: 'PKR',
    categories: ['MEDICATIONS'],
    certifications: [],
    status: 'ACTIVE',
    riskLevel: 'LOW',
    scorecard: {
      supplierId,
      period: 'DRP10-STAGING',
      onTimeDeliveryRate: 100,
      fillRate: 100,
      qualityAcceptanceRate: 100,
      invoiceAccuracyRate: 100,
      responseTimeHours: 1,
      overallScore: 100,
      rating: 'EXCELLENT',
      trend: 'STABLE',
      totalOrders: 0,
      totalValue: 0,
      lateDeliveries: 0,
      qualityRejections: 0,
    },
    activeContractsCount: 0,
    syntheticQualificationRecord: true,
    createdAt: now,
    updatedAt: now,
  },
  { merge: true }
);

await tenantRef.collection('inventoryLocations').doc(locationId).set(
  {
    locationId,
    tenantId,
    facilityId: 'P7H0',
    locationType: 'CENTRAL_STORE',
    name: 'DRP-10 Synthetic Central Store',
    code: 'DRP10-CS-01',
    departmentId: 'Pharmacy',
    departmentName: 'Pharmacy',
    temperatureControlled: false,
    restricted: false,
    active: true,
    syntheticQualificationRecord: true,
    createdAt: now,
    updatedAt: now,
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
      fixtures: {
        itemId,
        supplierId,
        locationId,
        facilityId: 'P7H0',
      },
      provisionedAt: now,
    },
    null,
    2
  ) + '\n'
);
