import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  FieldPath,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

const CLINICAL_COLLECTIONS = [
  'patients',
  'encounters',
  'encounterEvidence',
  'orders',
  'prescriptions',
  'opd_queue',
  'beds',
  'patient360Projections',
  'dischargeReadinessProjections',
  'deteriorationProjections',
] as const;

const BILLING_COLLECTIONS = [
  'billingMismatches',
  'encounterCharges',
  'journalEntries',
  'cashReceipts',
] as const;

const FINANCE_COLLECTIONS = [
  'accounts',
  'accountingPeriods',
  'journalEntries',
  'cashReceipts',
  'arOpenItems',
  'financeArReceipts',
  'financeArAdjustments',
  'financeArAgingSnapshots',
  'treasuryAccounts',
  'cashRegisterShifts',
  'financeBankReconciliations',
  'financeApAgingSnapshots',
  'financeCostCenters',
  'financeBudgets',
  'financeBudgetCommitments',
  'financeFixedAssets',
  'financeDepreciationRuns',
  'financeStatementSnapshots',
  'financeTaxSummarySnapshots',
  'financeIntelligenceSnapshots',
] as const;

const ADMIN_COLLECTIONS = [
  'telehealthSessions',
] as const;

const HCM_COLLECTIONS = [
  'employees',
  'employeeAssignments',
  'clinicalCredentials',
  'clinicalPrivileges',
  'rosterAssignments',
] as const;

const SCM_COLLECTIONS = [
  'items',
  'inventoryBalances',
  'batches',
  'stockTransactions',
  'patientConsumptions',
  'purchaseRequisitions',
  'inventoryLocations',
  'scmPurchaseOrders',
  'goodsReceiptNotes',
  'stockTransfers',
  'recallCases',
  'suppliers',
  'threeWayMatches',
] as const;

const EDGE_PAGE_SIZE = 500;
const EDGE_COLLECTION_MAX = 10000;

async function readCollectionSnapshot(
  tenantRef: DocumentReference,
  collection: string
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let lastDocument: QueryDocumentSnapshot | null = null;

  while (true) {
    let query = tenantRef
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(EDGE_PAGE_SIZE);

    if (lastDocument) query = query.startAfter(lastDocument);

    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      rows.push({ id: document.id, ...document.data() });
    }

    if (rows.length > EDGE_COLLECTION_MAX) {
      throw new Error(
        `EDGE_SNAPSHOT_COLLECTION_LIMIT_EXCEEDED:${collection}:${EDGE_COLLECTION_MAX}`
      );
    }

    if (snapshot.size < EDGE_PAGE_SIZE) break;
    lastDocument = snapshot.docs[snapshot.docs.length - 1] || null;
    if (!lastDocument) break;
  }

  return rows;
}

function authorizedCollections(roles: string[]): string[] {
  const normalized = new Set(roles.map((role) => String(role || '').trim().toUpperCase()));

  if (
    normalized.has('SYSTEM_ADMIN') ||
    normalized.has('ADMINISTRATOR') ||
    normalized.has('ADMIN')
  ) {
    return [
      ...CLINICAL_COLLECTIONS,
      ...BILLING_COLLECTIONS,
      ...FINANCE_COLLECTIONS,
      ...ADMIN_COLLECTIONS,
      ...SCM_COLLECTIONS,
      ...HCM_COLLECTIONS,
    ];
  }

  const selected = new Set<string>();
  const add = (...collections: readonly string[]) =>
    collections.forEach((collection) => selected.add(collection));

  // Clinicians receive a bounded working set. The response is further reduced
  // by facility/department/care relationship before leaving the server.
  if (['DOCTOR', 'CONSULTANT', 'NURSE'].some((role) => normalized.has(role))) {
    add(...CLINICAL_COLLECTIONS);
  }

  // Front desk/admissions should not receive notes, prescriptions or results.
  if (['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some((role) => normalized.has(role))) {
    add('patients', 'encounters', 'opd_queue', 'beds');
  }

  // Ancillary roles never hydrate the complete patient identity/chart set.
  if (['LAB_TECHNICIAN', 'LAB_TECH'].some((role) => normalized.has(role))) {
    add('encounters', 'orders');
  }

  if (normalized.has('PHARMACIST')) {
    add('encounters', 'prescriptions');
    add(...SCM_COLLECTIONS);
  }

  if (
    ['BILLING_CLERK', 'BILLING_ADMIN', 'FINANCE', 'REVENUE_CYCLE']
      .some((role) => normalized.has(role))
  ) {
    add(...BILLING_COLLECTIONS);
    add('patients', 'encounters');
  }

  if (
    [
      'ACCOUNTS_PAYABLE',
      'ACCOUNTANT',
      'FINANCE_MANAGER',
      'TREASURY_MANAGER',
      'AUDITOR',
      'TAX_ACCOUNTANT',
      'BUDGET_MANAGER',
      'FIXED_ASSET_ACCOUNTANT',
      'FINANCE'
    ].some((role) => normalized.has(role))
  ) {
    add(...FINANCE_COLLECTIONS);
  }

  if (
    ['SCM_MANAGER', 'INVENTORY_OFFICER', 'STORE_KEEPER', 'PROCUREMENT']
      .some((role) => normalized.has(role))
  ) {
    add(...SCM_COLLECTIONS);
  }

  if (
    ['HR_ADMIN', 'HOSPITAL_EXECUTIVE', 'MEDICAL_DIRECTOR']
      .some((role) => normalized.has(role))
  ) {
    add(...HCM_COLLECTIONS);
  }

  return [...selected];
}

function isAdministrativeRole(roles: string[]): boolean {
  const normalized = new Set(roles.map((role) => String(role || '').trim().toUpperCase()));
  return ['SYSTEM_ADMIN', 'ADMINISTRATOR', 'ADMIN'].some((role) => normalized.has(role));
}

function valueMatchesScope(
  value: unknown,
  allowed: Set<string>
): boolean {
  const normalized = String(value || '').trim();
  return !normalized || allowed.size === 0 || allowed.has(normalized);
}

function scopeOfflineCollections(
  context: {
    actorId: string;
    roles: string[];
    departmentId?: string;
    departmentIds?: string[];
    facilityIds?: string[];
  },
  collections: Record<string, Array<Record<string, unknown>>>
): Record<string, Array<Record<string, unknown>>> {
  if (isAdministrativeRole(context.roles)) return collections;

  const departments = new Set(
    (context.departmentIds || (context.departmentId ? [context.departmentId] : []))
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const facilities = new Set(
    (context.facilityIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );

  const encounters = (collections.encounters || []).filter((encounter) => {
    if (!valueMatchesScope(encounter.facilityId, facilities)) return false;
    if (!valueMatchesScope(encounter.departmentId, departments)) return false;

    const explicitActorIds = [
      encounter.assignedDoctorId,
      encounter.attendingDoctorId,
      encounter.assignedNurseId,
      encounter.clinicianId,
      encounter.providerId,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    const hasExplicitScope =
      Boolean(String(encounter.facilityId || '').trim()) ||
      Boolean(String(encounter.departmentId || '').trim()) ||
      explicitActorIds.length > 0;

    // Legacy encounters without any server-verifiable care scope are deliberately
    // omitted from non-admin offline hydration instead of leaking tenant-wide PHI.
    if (!hasExplicitScope) return false;
    if (explicitActorIds.length > 0 && !explicitActorIds.includes(context.actorId)) {
      // Department/facility-scoped clinicians may still receive encounters in
      // their assigned organizational scope.
      return (
        Boolean(String(encounter.departmentId || '').trim()) &&
        valueMatchesScope(encounter.departmentId, departments)
      );
    }
    return true;
  });

  const encounterIds = new Set(
    encounters
      .map((item) => String(item.id || item.encounterId || '').trim())
      .filter(Boolean)
  );
  const patientIds = new Set(
    encounters
      .map((item) => String(item.patientId || '').trim())
      .filter(Boolean)
  );

  const scoped: Record<string, Array<Record<string, unknown>>> = {
    ...collections,
    encounters,
  };

  if (collections.employees) {
    scoped.employees = collections.employees.filter((employee) => {
      const employeeFacilities = Array.isArray(employee.facilityIds)
        ? employee.facilityIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [String(employee.primaryFacilityId || '').trim()].filter(Boolean);
      const employeeDepartments = Array.isArray(employee.departmentIds)
        ? employee.departmentIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [String(employee.primaryDepartmentId || '').trim()].filter(Boolean);
      const facilityMatch =
        facilities.size === 0 ||
        employeeFacilities.some((facilityId) => facilities.has(facilityId));
      const departmentMatch =
        departments.size === 0 ||
        employeeDepartments.some((departmentId) => departments.has(departmentId));
      return facilityMatch && departmentMatch;
    });
  }

  if (collections.employeeAssignments) {
    scoped.employeeAssignments = collections.employeeAssignments.filter((assignment) =>
      valueMatchesScope(assignment.facilityId, facilities) &&
      valueMatchesScope(assignment.departmentId, departments)
    );
  }

  const scopedEmployeeIds=new Set(
    (scoped.employees||[]).map(employee=>String(employee.employeeId||'').trim()).filter(Boolean)
  );

  if(collections.clinicalCredentials){
    scoped.clinicalCredentials=collections.clinicalCredentials.filter(credential=>
      scopedEmployeeIds.has(String(credential.employeeId||'').trim())
    );
  }

  if(collections.clinicalPrivileges){
    scoped.clinicalPrivileges=collections.clinicalPrivileges.filter(privilege=>
      scopedEmployeeIds.has(String(privilege.employeeId||'').trim()) &&
      valueMatchesScope(privilege.facilityId,facilities) &&
      valueMatchesScope(privilege.departmentId,departments)
    );
  }

  if(collections.rosterAssignments){
    scoped.rosterAssignments=collections.rosterAssignments.filter(shift=>
      scopedEmployeeIds.has(String(shift.employeeId||'').trim()) &&
      valueMatchesScope(shift.facilityId,facilities) &&
      valueMatchesScope(shift.departmentId,departments)
    );
  }

  const byEncounterOrPatient = new Set([
    'encounterEvidence',
    'orders',
    'prescriptions',
    'opd_queue',
    'dischargeReadinessProjections',
    'deteriorationProjections',
  ]);

  for (const [collection, rows] of Object.entries(collections)) {
    if (collection === 'encounters') continue;

    if (collection === 'patients' || collection === 'patient360Projections') {
      scoped[collection] = rows.filter((row) =>
        patientIds.has(String(row.id || row.patientId || '').trim())
      );
      continue;
    }

    if (collection === 'beds') {
      scoped[collection] = rows.filter((row) => {
        const encounterId = String(row.currentEncounterId || row.encounterId || '').trim();
        if (encounterId && encounterIds.has(encounterId)) return true;
        return (
          valueMatchesScope(row.facilityId, facilities) &&
          valueMatchesScope(row.departmentId, departments) &&
          (Boolean(String(row.facilityId || '').trim()) ||
            Boolean(String(row.departmentId || '').trim()))
        );
      });
      continue;
    }

    if (byEncounterOrPatient.has(collection)) {
      scoped[collection] = rows.filter((row) => {
        const encounterId = String(row.encounterId || row.id || '').trim();
        const patientId = String(row.patientId || '').trim();
        return (
          (encounterId && encounterIds.has(encounterId)) ||
          (patientId && patientIds.has(patientId))
        );
      });
    }
  }

  return scoped;
}

export async function GET(req: NextRequest) {
  try {
    const requestedTenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
      req.headers.get('x-ghims-tenant-id') ||
      ''
    ).trim().toLowerCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { success: false, error: { code: 'EDGE_BOOTSTRAP_STORE_UNAVAILABLE' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const collections = authorizedCollections(context.roles);
    const generatedAt = Date.now();

    const entries = await Promise.all(
      collections.map(async (collection) => [
        collection,
        await readCollectionSnapshot(tenantRef, collection),
      ] as const)
    );
    const scopedCollections = scopeOfflineCollections(
      context,
      Object.fromEntries(entries)
    );

    const snapshotVersion = `${context.tenantId}:${generatedAt}`;

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        generatedAt,
        snapshotVersion,
        collections: scopedCollections,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'X-GHIMS-Edge-Snapshot': snapshotVersion,
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to hydrate offline read models';
    const unauthorized = /AUTH|TENANT|SESSION|ACCOUNT/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized ? 'EDGE_BOOTSTRAP_UNAUTHORIZED' : 'EDGE_BOOTSTRAP_FAILED',
          message,
        },
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
