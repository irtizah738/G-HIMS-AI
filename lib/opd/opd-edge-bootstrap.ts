import 'server-only';

import type {
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { OPD_EDGE_COLLECTIONS } from '@/lib/opd/edge-surface';

type Row = Record<string, unknown>;

export interface OpdEdgeScopeContext {
  actorId: string;
  roles: string[];
  departmentId?: string;
  departmentIds?: string[];
  facilityIds?: string[];
}

const IN_CHUNK = 30;
const DOCUMENT_GET_CHUNK = 100;
const OPD_ACTIVE_ENCOUNTER_MAX = 5000;
const OPD_SCHEDULING_MAX = 5000;
const OPD_RELATED_MAX = 10000;
const APPOINTMENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const ACTIVE_APPOINTMENT_STATUSES = [
  'CONFIRMED',
  'RESCHEDULED',
  'CHECKED_IN',
] as const;

const ACTIVE_WAITLIST_STATUSES = ['WAITING', 'OFFERED'] as const;

function normalizedSet(values: readonly unknown[] = []): Set<string> {
  return new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
}

function roleSet(roles: string[]): Set<string> {
  return new Set(
    roles.map((role) => String(role || '').trim().toUpperCase()).filter(Boolean)
  );
}

function isAdmin(roles: string[]): boolean {
  const rolesSet = roleSet(roles);
  return ['SYSTEM_ADMIN', 'ADMINISTRATOR', 'ADMIN'].some((role) =>
    rolesSet.has(role)
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size) as T[]);
  }
  return output;
}

function rowFromDocument(document: QueryDocumentSnapshot): Row {
  return { id: document.id, ...document.data() };
}

function addRows(
  target: Map<string, Row>,
  documents: QueryDocumentSnapshot[],
  maxRows: number,
  collection: string
): void {
  for (const document of documents) {
    target.set(document.id, rowFromDocument(document));
  }
  if (target.size > maxRows) {
    throw new Error(
      `OPD_EDGE_COLLECTION_LIMIT_EXCEEDED:${collection}:${maxRows}`
    );
  }
}

async function runBoundedQuery(
  query: Query,
  collection: string,
  maxRows: number
): Promise<Row[]> {
  const snapshot = await query.limit(maxRows + 1).get();
  if (snapshot.size > maxRows) {
    throw new Error(
      `OPD_EDGE_COLLECTION_LIMIT_EXCEEDED:${collection}:${maxRows}`
    );
  }
  return snapshot.docs.map(rowFromDocument);
}

async function readDocumentsByIds(
  tenantRef: DocumentReference,
  collection: string,
  ids: readonly string[],
  maxRows = OPD_RELATED_MAX
): Promise<Row[]> {
  const uniqueIds = [...normalizedSet(ids)];
  if (uniqueIds.length > maxRows) {
    throw new Error(
      `OPD_EDGE_ID_SCOPE_LIMIT_EXCEEDED:${collection}:${maxRows}`
    );
  }

  const rows = new Map<string, Row>();
  for (const group of chunks(uniqueIds, DOCUMENT_GET_CHUNK)) {
    const snapshots = await Promise.all(
      group.map((id) => tenantRef.collection(collection).doc(id).get())
    );
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      rows.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
    }
  }
  return [...rows.values()];
}

async function readByFieldValues(
  tenantRef: DocumentReference,
  collection: string,
  field: string,
  values: readonly string[],
  maxRows = OPD_RELATED_MAX
): Promise<Row[]> {
  const uniqueValues = [...normalizedSet(values)];
  if (uniqueValues.length === 0) return [];

  const rows = new Map<string, Row>();
  for (const group of chunks(uniqueValues, IN_CHUNK)) {
    const snapshot = await tenantRef
      .collection(collection)
      .where(field, 'in', group)
      .limit(maxRows + 1)
      .get();
    addRows(rows, snapshot.docs, maxRows, collection);
  }
  return [...rows.values()];
}

async function readActiveOpdEncounters(
  tenantRef: DocumentReference,
  context: OpdEdgeScopeContext
): Promise<Row[]> {
  const facilities = [...normalizedSet(context.facilityIds || [])];
  const admin = isAdmin(context.roles);
  const rows = new Map<string, Row>();

  if (!admin && facilities.length === 0) {
    throw new Error('OPD_EDGE_FACILITY_SCOPE_REQUIRED');
  }

  if (admin) {
    const snapshot = await tenantRef
      .collection('encounters')
      .where('encounterType', '==', 'OPD')
      .where('status', '==', 'ACTIVE')
      .orderBy('updatedAt', 'desc')
      .limit(OPD_ACTIVE_ENCOUNTER_MAX + 1)
      .get();
    addRows(
      rows,
      snapshot.docs,
      OPD_ACTIVE_ENCOUNTER_MAX,
      'encounters'
    );
  } else {
    for (const group of chunks(facilities, IN_CHUNK)) {
      const snapshot = await tenantRef
        .collection('encounters')
        .where('facilityId', 'in', group)
        .where('encounterType', '==', 'OPD')
        .where('status', '==', 'ACTIVE')
        .orderBy('updatedAt', 'desc')
        .limit(OPD_ACTIVE_ENCOUNTER_MAX + 1)
        .get();
      addRows(
        rows,
        snapshot.docs,
        OPD_ACTIVE_ENCOUNTER_MAX,
        'encounters'
      );
    }
  }

  return [...rows.values()];
}

async function readActiveAppointments(
  tenantRef: DocumentReference,
  context: OpdEdgeScopeContext,
  now: number
): Promise<Row[]> {
  const facilities = [...normalizedSet(context.facilityIds || [])];
  const admin = isAdmin(context.roles);
  const rows = new Map<string, Row>();
  const cutoff = now - APPOINTMENT_LOOKBACK_MS;

  if (!admin && facilities.length === 0) {
    throw new Error('OPD_EDGE_FACILITY_SCOPE_REQUIRED');
  }

  for (const status of ACTIVE_APPOINTMENT_STATUSES) {
    if (admin) {
      const snapshot = await tenantRef
        .collection('opdAppointments')
        .where('status', '==', status)
        .where('scheduledEndAt', '>=', cutoff)
        .orderBy('scheduledEndAt', 'asc')
        .limit(OPD_SCHEDULING_MAX + 1)
        .get();
      addRows(
        rows,
        snapshot.docs,
        OPD_SCHEDULING_MAX,
        'opdAppointments'
      );
      continue;
    }

    for (const group of chunks(facilities, IN_CHUNK)) {
      const snapshot = await tenantRef
        .collection('opdAppointments')
        .where('facilityId', 'in', group)
        .where('status', '==', status)
        .where('scheduledEndAt', '>=', cutoff)
        .orderBy('scheduledEndAt', 'asc')
        .limit(OPD_SCHEDULING_MAX + 1)
        .get();
      addRows(
        rows,
        snapshot.docs,
        OPD_SCHEDULING_MAX,
        'opdAppointments'
      );
    }
  }

  return [...rows.values()];
}

async function readActiveWaitlist(
  tenantRef: DocumentReference,
  context: OpdEdgeScopeContext
): Promise<Row[]> {
  const facilities = [...normalizedSet(context.facilityIds || [])];
  const admin = isAdmin(context.roles);
  const rows = new Map<string, Row>();

  if (!admin && facilities.length === 0) {
    throw new Error('OPD_EDGE_FACILITY_SCOPE_REQUIRED');
  }

  for (const status of ACTIVE_WAITLIST_STATUSES) {
    if (admin) {
      const snapshot = await tenantRef
        .collection('opdWaitlist')
        .where('status', '==', status)
        .orderBy('updatedAt', 'desc')
        .limit(OPD_SCHEDULING_MAX + 1)
        .get();
      addRows(rows, snapshot.docs, OPD_SCHEDULING_MAX, 'opdWaitlist');
      continue;
    }

    for (const group of chunks(facilities, IN_CHUNK)) {
      const snapshot = await tenantRef
        .collection('opdWaitlist')
        .where('facilityId', 'in', group)
        .where('status', '==', status)
        .orderBy('updatedAt', 'desc')
        .limit(OPD_SCHEDULING_MAX + 1)
        .get();
      addRows(rows, snapshot.docs, OPD_SCHEDULING_MAX, 'opdWaitlist');
    }
  }

  return [...rows.values()];
}

async function readScopedBeds(
  tenantRef: DocumentReference,
  context: OpdEdgeScopeContext
): Promise<Row[]> {
  const facilities = [...normalizedSet(context.facilityIds || [])];
  if (isAdmin(context.roles)) {
    return runBoundedQuery(
      tenantRef.collection('beds').orderBy('updatedAt', 'desc'),
      'beds',
      OPD_RELATED_MAX
    );
  }
  return readByFieldValues(
    tenantRef,
    'beds',
    'facilityId',
    facilities,
    OPD_RELATED_MAX
  );
}

export async function loadOpdScopedEdgeCollections(
  tenantRef: DocumentReference,
  context: OpdEdgeScopeContext,
  requestedCollections: readonly string[],
  now = Date.now()
): Promise<Record<string, Row[]>> {
  const requested = new Set(
    requestedCollections.filter((collection) =>
      (OPD_EDGE_COLLECTIONS as readonly string[]).includes(collection)
    )
  );
  const result: Record<string, Row[]> = Object.fromEntries(
    [...requested].map((collection) => [collection, []])
  );

  const [encounters, appointments, waitlist] = await Promise.all([
    readActiveOpdEncounters(tenantRef, context),
    requested.has('opdAppointments')
      ? readActiveAppointments(tenantRef, context, now)
      : Promise.resolve([]),
    requested.has('opdWaitlist')
      ? readActiveWaitlist(tenantRef, context)
      : Promise.resolve([]),
  ]);

  if (requested.has('encounters')) result.encounters = encounters;
  if (requested.has('opdAppointments')) result.opdAppointments = appointments;
  if (requested.has('opdWaitlist')) result.opdWaitlist = waitlist;

  const encounterIds = [
    ...normalizedSet(
      encounters.map((row) => row.encounterId || row.id)
    ),
  ];
  const patientIds = [
    ...normalizedSet([
      ...encounters.map((row) => row.patientId),
      ...appointments.map((row) => row.patientId),
      ...waitlist.map((row) => row.patientId),
    ]),
  ];

  const encounterLinkedCollections = [
    'encounterEvidence',
    'orders',
    'prescriptions',
    'opd_queue',
    'clinicalOpenItems',
    'consultationRequests',
    'clinicalHandoffs',
    'billingMismatches',
    'encounterCharges',
    'invoices',
    'arOpenItems',
    'dischargeReadinessProjections',
    'deteriorationProjections',
    'clinicalEscalations',
  ] as const;

  await Promise.all(
    encounterLinkedCollections.map(async (collection) => {
      if (!requested.has(collection)) return;
      result[collection] = await readByFieldValues(
        tenantRef,
        collection,
        'encounterId',
        encounterIds
      );
    })
  );

  if (requested.has('patients')) {
    result.patients = await readDocumentsByIds(
      tenantRef,
      'patients',
      patientIds
    );
  }
  if (requested.has('patient360Projections')) {
    result.patient360Projections = await readDocumentsByIds(
      tenantRef,
      'patient360Projections',
      patientIds
    );
  }
  if (requested.has('medicationSafetyProjections')) {
    result.medicationSafetyProjections = await readDocumentsByIds(
      tenantRef,
      'medicationSafetyProjections',
      patientIds
    );
  }
  if (requested.has('beds')) {
    result.beds = await readScopedBeds(tenantRef, context);
  }

  const invoices = result.invoices || [];
  const invoiceIds = [
    ...normalizedSet(invoices.map((row) => row.id || row.invoiceId)),
  ];

  if (requested.has('invoiceSettlements')) {
    result.invoiceSettlements = await readByFieldValues(
      tenantRef,
      'invoiceSettlements',
      'invoiceId',
      invoiceIds
    );
  }
  if (requested.has('cashReceipts')) {
    result.cashReceipts = await readByFieldValues(
      tenantRef,
      'cashReceipts',
      'invoiceId',
      invoiceIds
    );
  }

  const chargeIds = [
    ...normalizedSet(
      (result.encounterCharges || []).map(
        (row) => row.id || row.chargeId
      )
    ),
  ];
  const receiptIds = [
    ...normalizedSet(
      (result.cashReceipts || []).map((row) => row.id || row.receiptId)
    ),
  ];

  if (requested.has('journalEntries')) {
    result.journalEntries = await readByFieldValues(
      tenantRef,
      'journalEntries',
      'referenceDocumentId',
      [...invoiceIds, ...chargeIds, ...receiptIds, ...encounterIds]
    );
  }

  return result;
}
