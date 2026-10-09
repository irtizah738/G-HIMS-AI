import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  FieldPath,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { OPD_EDGE_COLLECTIONS } from '@/lib/opd/edge-surface';
import { loadOpdScopedEdgeCollections } from '@/lib/opd/opd-edge-bootstrap';
import { requireEdgeHydrationSurface } from '@/lib/offline/hydration-policy';

export const dynamic = 'force-dynamic';

const CLINICAL_COLLECTIONS = [
  'patients',
  'encounters',
  'encounterEvidence',
  'orders',
  'prescriptions',
  'opd_queue',
  'opdAppointments',
  'opdWaitlist',
  'beds',
  'surgicalCases',
  'orRoomSchedules',
  'patient360Projections',
  'dischargeReadinessProjections',
  'deteriorationProjections',
  'medicationSafetyProjections',
  'clinicalOpenItems',
  'clinicalEscalations',
  'consultationRequests',
  'clinicalHandoffs',
] as const;

const BILLING_COLLECTIONS = [
  'billingMismatches',
  'encounterCharges',
  'invoices',
  'invoiceSettlements',
  'arOpenItems',
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

const FACILITIES_COLLECTIONS = [
  'beds',
  'resources',
  'rooms',
  'resourceReservations',
  'maintenanceWorkOrders',
  'calibrationRecords',
] as const;

const HOSPITAL_SHELL_COLLECTIONS = [
  'patients',
  'encounters',
  'opd_queue',
  'beds',
  'billingMismatches',
  'telehealthSessions',
] as const;

const HCM_COLLECTIONS = [
  'employees',
  'employeeAssignments',
  'clinicalCredentials',
  'clinicalPrivileges',
  'rosterAssignments',
  'attendanceRecords',
  'leaveRequests',
  'leaveBalances',
  'compensationProfiles',
  'payrollPeriods',
  'payrollEmployeeSlots',
  'payrollPayslips',
  'payrollStatutoryLiabilities',
  'payrollComplianceSnapshots',
  'hcmIntelligenceSnapshots',
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
  'scmCycleCounts',
  'scmReplenishmentPolicies',
  'scmReplenishmentPlans',
  'scmReplenishmentOrders',
  'scmSupplierContracts',
  'scmOperationalSnapshots',
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
      ...FACILITIES_COLLECTIONS,
    ];
  }

  const selected = new Set<string>();
  const add = (...collections: readonly string[]) =>
    collections.forEach((collection) => selected.add(collection));

  // Clinicians receive a bounded working set. The response is further reduced
  // by facility/department/care relationship before leaving the server.
  if (['DOCTOR', 'CONSULTANT', 'NURSE'].some((role) => normalized.has(role))) {
    add(...CLINICAL_COLLECTIONS);
    // ORC-1B: Clinicians need facility-scoped bed/room data for assignments and census.
    // beds is already in CLINICAL_COLLECTIONS; rooms was missing for all non-admin roles.
    add('rooms');
  }

  // Front desk/admissions should not receive notes, prescriptions or results.
  if (['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some((role) => normalized.has(role))) {
    add(
      'patients',
      'encounters',
      'opd_queue',
      'opdAppointments',
      'opdWaitlist',
      'beds',
      // ORC-1B: Front desk needs room data for patient room assignments.
      'rooms'
    );
  }

  // ORC-1B: ER / emergency roles need full bed and room census for triage assignments.
  // These roles were entirely missing from the authorizedCollections predicate.
  if (
    ['EMERGENCY_NURSE', 'EMERGENCY_DOCTOR', 'ER_NURSE', 'TRIAGE_NURSE', 'ER_DOCTOR']
      .some((role) => normalized.has(role))
  ) {
    add(...CLINICAL_COLLECTIONS);
    add('beds', 'rooms', 'resourceReservations');
  }

  // Ancillary roles never hydrate the complete patient identity/chart set.
  if (
    ['LAB_TECHNICIAN', 'LAB_TECH', 'PATHOLOGIST'].some((role) =>
      normalized.has(role)
    )
  ) {
    add('encounters', 'orders');
  }

  if (
    ['RADIOLOGY_TECH', 'RADIOLOGY_TECHNICIAN', 'RADIOLOGIST'].some((role) =>
      normalized.has(role)
    )
  ) {
    add('encounters', 'orders');
  }

  if (normalized.has('PHARMACIST')) {
    // RP15 makes physical dispensing reconnect-required. Pharmacists need the
    // scoped encounter/prescription working set offline, not the tenant-wide
    // SCM inventory graph.
    add('encounters', 'prescriptions');
  }

  if (
    [
      'BILLING_CLERK',
      'BILLING_ADMIN',
      'CASHIER',
      'BILLING_CASHIER',
      'FINANCE_MANAGER',
      'FINANCE',
      'REVENUE_CYCLE',
    ]
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

function isBillingRole(roles: string[]): boolean {
  const normalized = new Set(
    roles.map((role) => String(role || '').trim().toUpperCase())
  );
  return [
    'BILLING_CLERK',
    'BILLING_ADMIN',
    'CASHIER',
    'BILLING_CASHIER',
    'FINANCE_MANAGER',
    'FINANCE',
    'REVENUE_CYCLE',
  ].some((role) => normalized.has(role));
}

function isFullFinanceRole(roles: string[]): boolean {
  const normalized = new Set(
    roles.map((role) => String(role || '').trim().toUpperCase())
  );
  return [
    'ACCOUNTANT',
    'FINANCE_MANAGER',
    'TREASURY_MANAGER',
    'AUDITOR',
    'TAX_ACCOUNTANT',
    'BUDGET_MANAGER',
    'FIXED_ASSET_ACCOUNTANT',
    'FINANCE',
  ].some((role) => normalized.has(role));
}

function valueMatchesScope(
  value: unknown,
  allowed: Set<string>
): boolean {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && allowed.size > 0 && allowed.has(normalized);
}

function normalizedRoleSet(roles: string[]): Set<string> {
  return new Set(
    roles.map((role) => String(role || '').trim().toUpperCase()).filter(Boolean)
  );
}

function minimizePatientRows(
  roles: string[],
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const normalized = normalizedRoleSet(roles);
  const frontDesk = ['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some(
    (role) => normalized.has(role)
  );
  const cashier = [
    'BILLING_CLERK',
    'BILLING_ADMIN',
    'CASHIER',
    'BILLING_CASHIER',
    'REVENUE_CYCLE',
  ].some((role) => normalized.has(role));

  if (!frontDesk && !cashier) return rows;

  return rows.map((row) => {
    const base: Record<string, unknown> = {
      id: row.id,
      patientId: row.patientId,
      mrn: row.mrn,
      fullName: row.fullName,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      status: row.status,
      facilityId: row.facilityId,
      departmentId: row.departmentId,
      activeEncounterId: row.activeEncounterId,
      currentEncounterId: row.currentEncounterId,
    };

    if (frontDesk) {
      return {
        ...base,
        phoneNumber: row.phoneNumber,
        email: row.email,
        residentialAddress: row.residentialAddress,
        emergencyContact: row.emergencyContact,
        tariffPlan: row.tariffPlan,
        consentSummary: row.consentSummary,
      };
    }

    return {
      ...base,
      tariffPlan: row.tariffPlan,
    };
  });
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
  const normalizedRoles = normalizedRoleSet(context.roles);
  const labRole = ['LAB_TECHNICIAN', 'LAB_TECH', 'PATHOLOGIST'].some(
    (role) => normalizedRoles.has(role)
  );
  const radiologyRole = [
    'RADIOLOGY_TECH',
    'RADIOLOGY_TECHNICIAN',
    'RADIOLOGIST',
  ].some((role) => normalizedRoles.has(role));
  const pharmacistRole = normalizedRoles.has('PHARMACIST');
  const ancillaryRole = labRole || radiologyRole || pharmacistRole;

  const rawEncounterById = new Map(
    (collections.encounters || [])
      .map((encounter) => [
        String(encounter.id || encounter.encounterId || '').trim(),
        encounter,
      ] as const)
      .filter(([encounterId]) => Boolean(encounterId))
  );

  const resolveRelatedFacility = (
    row: Record<string, unknown>
  ): string => {
    const explicit = String(row.facilityId || '').trim();
    if (explicit) return explicit;
    const encounterId = String(row.encounterId || '').trim();
    const encounter = encounterId ? rawEncounterById.get(encounterId) : null;
    return String(encounter?.facilityId || '').trim();
  };

  const ancillaryOrderIds = new Set<string>();
  const ancillaryEncounterIds = new Set<string>();
  if (labRole || radiologyRole) {
    for (const order of collections.orders || []) {
      const orderType = String(order.orderType || '').trim().toUpperCase();
      if (labRole && orderType !== 'LAB') continue;
      if (radiologyRole && orderType !== 'RADIOLOGY') continue;
      if (!valueMatchesScope(resolveRelatedFacility(order), facilities)) {
        continue;
      }

      const orderId = String(order.id || order.orderId || '').trim();
      const encounterId = String(order.encounterId || '').trim();
      if (orderId) ancillaryOrderIds.add(orderId);
      if (encounterId) ancillaryEncounterIds.add(encounterId);
    }
  }
  if (pharmacistRole) {
    for (const prescription of collections.prescriptions || []) {
      const facilityId = resolveRelatedFacility(prescription);
      if (!valueMatchesScope(facilityId, facilities)) continue;
      const encounterId = String(prescription.encounterId || '').trim();
      if (encounterId) ancillaryEncounterIds.add(encounterId);
    }
  }

  const billingRole = isBillingRole(context.roles);
  const billingOnlyRole = billingRole && !isFullFinanceRole(context.roles);
  const billingEncounterIds = new Set(
    billingOnlyRole
      ? (collections.invoices || [])
          .map((invoice) => String(invoice.encounterId || '').trim())
          .filter(Boolean)
      : []
  );

  const encounters = (collections.encounters || []).filter((encounter) => {
    const encounterId = String(encounter.id || encounter.encounterId || '').trim();
    if (billingOnlyRole) {
      if (!encounterId || !billingEncounterIds.has(encounterId)) return false;
      if (!valueMatchesScope(encounter.facilityId, facilities)) return false;
      return true;
    }

    if (ancillaryRole) {
      return (
        Boolean(encounterId) &&
        ancillaryEncounterIds.has(encounterId) &&
        valueMatchesScope(encounter.facilityId, facilities)
      );
    }

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
  const scopedAppointments = (collections.opdAppointments || []).filter(
    (appointment) =>
      valueMatchesScope(appointment.facilityId, facilities) &&
      valueMatchesScope(appointment.departmentId, departments)
  );
  const scopedWaitlist = (collections.opdWaitlist || []).filter(
    (entry) =>
      valueMatchesScope(entry.facilityId, facilities) &&
      valueMatchesScope(entry.preferredDepartmentId, departments)
  );

  const patientIds = new Set(
    [
      ...encounters.map((item) => String(item.patientId || '').trim()),
      ...scopedAppointments.map((item) =>
        String(item.patientId || '').trim()
      ),
      ...scopedWaitlist.map((item) => String(item.patientId || '').trim()),
    ].filter(Boolean)
  );

  const scoped: Record<string, Array<Record<string, unknown>>> = {
    ...collections,
    encounters,
    ...(collections.opdAppointments
      ? { opdAppointments: scopedAppointments }
      : {}),
    ...(collections.opdWaitlist ? { opdWaitlist: scopedWaitlist } : {}),
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
        facilities.size > 0 &&
        employeeFacilities.some((facilityId) => facilities.has(facilityId));
      const departmentMatch =
        departments.size > 0 &&
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

  if(collections.attendanceRecords){
    scoped.attendanceRecords=collections.attendanceRecords.filter(record=>
      scopedEmployeeIds.has(String(record.employeeId||'').trim()) &&
      valueMatchesScope(record.facilityId,facilities) &&
      valueMatchesScope(record.departmentId,departments)
    );
  }

  if(collections.leaveRequests){
    scoped.leaveRequests=collections.leaveRequests.filter(request=>
      scopedEmployeeIds.has(String(request.employeeId||'').trim())
    );
  }
  if(collections.leaveBalances){
    scoped.leaveBalances=collections.leaveBalances.filter(balance=>
      scopedEmployeeIds.has(String(balance.employeeId||'').trim())
    );
  }

  const byEncounterOrPatient = new Set([
    'encounterEvidence',
    'orders',
    'prescriptions',
    'opd_queue',
    'dischargeReadinessProjections',
    'deteriorationProjections',
    'medicationSafetyProjections',
    'clinicalOpenItems',
    'clinicalEscalations',
    'consultationRequests',
    'clinicalHandoffs',
  ]);

  if (billingOnlyRole) {
    const scopedInvoices = (collections.invoices || []).filter((row) => {
      const encounterId = String(row.encounterId || '').trim();
      const patientId = String(row.patientId || '').trim();
      return (
        (encounterId && encounterIds.has(encounterId)) ||
        (patientId && patientIds.has(patientId))
      );
    });
    const invoiceIds = new Set(
      scopedInvoices
        .map((row) => String(row.id || row.invoiceId || '').trim())
        .filter(Boolean)
    );

    const scopedReceipts = (collections.cashReceipts || []).filter((row) =>
      invoiceIds.has(String(row.invoiceId || '').trim())
    );
    const receiptIds = new Set(
      scopedReceipts
        .map((row) => String(row.id || row.receiptId || '').trim())
        .filter(Boolean)
    );

    const scopedCharges = (collections.encounterCharges || []).filter((row) => {
      const encounterId = String(row.encounterId || '').trim();
      const patientId = String(row.patientId || '').trim();
      return (
        (encounterId && encounterIds.has(encounterId)) ||
        (patientId && patientIds.has(patientId))
      );
    });
    const chargeIds = new Set(
      scopedCharges
        .map((row) => String(row.id || row.chargeId || '').trim())
        .filter(Boolean)
    );

    scoped.invoices = scopedInvoices;
    if (collections.invoiceSettlements) {
      scoped.invoiceSettlements = collections.invoiceSettlements.filter((row) =>
        invoiceIds.has(String(row.invoiceId || row.id || '').trim())
      );
    }
    if (collections.arOpenItems) {
      scoped.arOpenItems = collections.arOpenItems.filter((row) => {
        const invoiceId = String(row.invoiceId || '').trim();
        const encounterId = String(row.encounterId || '').trim();
        const patientId = String(row.patientId || '').trim();
        return (
          (invoiceId && invoiceIds.has(invoiceId)) ||
          (encounterId && encounterIds.has(encounterId)) ||
          (patientId && patientIds.has(patientId))
        );
      });
    }
    if (collections.cashReceipts) {
      scoped.cashReceipts = scopedReceipts;
    }
    if (collections.encounterCharges) {
      scoped.encounterCharges = scopedCharges;
    }
    if (collections.billingMismatches) {
      scoped.billingMismatches = collections.billingMismatches.filter((row) => {
        const invoiceId = String(row.invoiceId || '').trim();
        const encounterId = String(row.encounterId || '').trim();
        const patientId = String(row.patientId || '').trim();
        return (
          (invoiceId && invoiceIds.has(invoiceId)) ||
          (encounterId && encounterIds.has(encounterId)) ||
          (patientId && patientIds.has(patientId))
        );
      });
    }
    if (collections.journalEntries) {
      const allowedReferences = new Set([
        ...invoiceIds,
        ...receiptIds,
        ...chargeIds,
        ...encounterIds,
      ]);
      scoped.journalEntries = collections.journalEntries.filter((row) =>
        allowedReferences.has(String(row.referenceDocumentId || '').trim())
      );
    }
  }

  for (const [collection, rows] of Object.entries(collections)) {
    if (
      collection === 'encounters' ||
      collection === 'opdAppointments' ||
      collection === 'opdWaitlist'
    ) {
      continue;
    }
    if (
      billingOnlyRole &&
      [
        'invoices',
        'invoiceSettlements',
        'arOpenItems',
        'cashReceipts',
        'encounterCharges',
        'billingMismatches',
        'journalEntries',
      ].includes(collection)
    ) {
      continue;
    }

    if (collection === 'patients') {
      scoped[collection] = minimizePatientRows(
        context.roles,
        rows.filter((row) =>
          patientIds.has(String(row.id || row.patientId || '').trim())
        )
      );
      continue;
    }

    if (collection === 'patient360Projections') {
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

    if (collection === 'surgicalCases') {
      scoped[collection] = rows.filter((row) => {
        const encounterId = String(row.encounterId || '').trim();
        const patientId = String(row.patientId || '').trim();
        return (
          (encounterId && encounterIds.has(encounterId)) ||
          (patientId && patientIds.has(patientId)) ||
          valueMatchesScope(row.facilityId, facilities)
        );
      });
      continue;
    }

    if (collection === 'orRoomSchedules') {
      scoped[collection] = rows.filter((row) =>
        valueMatchesScope(row.facilityId, facilities)
      );
      continue;
    }

    if (byEncounterOrPatient.has(collection)) {
      scoped[collection] = rows.filter((row) => {
        if (collection === 'orders' && (labRole || radiologyRole)) {
          return ancillaryOrderIds.has(
            String(row.id || row.orderId || '').trim()
          );
        }

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

    const surface = String(
      req.nextUrl.searchParams.get('surface') || ''
    )
      .trim()
      .toUpperCase();

    const { context } = await deriveAuthoritativeContext(req, requestedTenantId);
    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json(
        { success: false, error: { code: 'EDGE_BOOTSTRAP_STORE_UNAVAILABLE' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    let requestedSurface;
    try {
      requestedSurface = requireEdgeHydrationSurface(surface);
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'EDGE_HYDRATION_SURFACE_REQUIRED'
          ? 'EDGE_BOOTSTRAP_SURFACE_REQUIRED'
          : 'EDGE_BOOTSTRAP_SURFACE_INVALID';
      return NextResponse.json(
        { success: false, error: { code } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const authorized = authorizedCollections(context.roles);
    const requestedCollections: readonly string[] =
      requestedSurface === 'HOSPITAL_SHELL'
        ? HOSPITAL_SHELL_COLLECTIONS
        : requestedSurface === 'OPD'
          ? OPD_EDGE_COLLECTIONS
        : requestedSurface === 'CLINICAL'
          ? CLINICAL_COLLECTIONS
          : requestedSurface === 'BILLING'
            ? [...BILLING_COLLECTIONS, 'patients', 'encounters']
            : requestedSurface === 'FINANCE'
              ? FINANCE_COLLECTIONS
              : requestedSurface === 'HCM'
                ? HCM_COLLECTIONS
                : requestedSurface === 'SCM'
                  ? SCM_COLLECTIONS
                  : requestedSurface === 'FACILITIES'
                    ? FACILITIES_COLLECTIONS
                    : [];

    // Every offline read model is bound to an explicit, named minimum-necessary
    // surface. There is no generic tenant cache fallback.
    const collections = [...new Set(requestedCollections)].filter((collection) =>
      authorized.includes(collection)
    );
    const generatedAt = Date.now();

    const rawCollections =
      requestedSurface === 'OPD'
        ? await loadOpdScopedEdgeCollections(
            tenantRef,
            context,
            collections,
            generatedAt
          )
        : Object.fromEntries(
            await Promise.all(
              collections.map(async (collection) => [
                collection,
                await readCollectionSnapshot(tenantRef, collection),
              ] as const)
            )
          );

    const scopedCollections = scopeOfflineCollections(
      context,
      rawCollections
    );

    const snapshotVersion = `${context.tenantId}:${
      requestedSurface.toLowerCase() + ':'
    }${generatedAt}`;
    // A revised role, privilege or facility scope invalidates every previously
    // cached read surface for this session. Never use client-supplied claims.
    const sorted = (values: string[] | undefined) =>
      [...(values || [])].map(String).sort();
    const authorizationRevision = createHash('sha256').update(JSON.stringify({
      actorId: context.actorId,
      roles: sorted(context.roles),
      permissions: sorted(context.permissions),
      facilities: sorted(context.facilityIds),
      departments: sorted(context.departmentIds),
      clinicalPrivileges: sorted(context.clinicalPrivileges),
    })).digest('hex');

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        generatedAt,
        snapshotVersion,
        authorizationRevision,
        surface: requestedSurface,
        hydrationStatus: collections.length === 0 ? 'NOT_APPLICABLE' : 'CURRENT',
        authorizedCollectionCount: collections.length,
        requestedCollectionCount: new Set(requestedCollections).size,
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
    const message =
      error instanceof Error ? error.message : 'Unable to hydrate offline read models';
    const unauthorized =
      /AUTH|TENANT|SESSION|ACCOUNT|DEVICE|PERMISSION|ACCESS|SCOPE|FORBIDDEN|DENIED/i.test(
        message
      );
    return NextResponse.json(
      {
        success: false,
        error: {
          code: unauthorized
            ? 'EDGE_BOOTSTRAP_UNAUTHORIZED'
            : 'EDGE_BOOTSTRAP_FAILED',
        },
      },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
