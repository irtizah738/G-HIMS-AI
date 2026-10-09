/**
 * READ-ONLY operational inspection of the two explicitly confirmed mock MPI identities.
 *
 * No patient/encounter mutation, projection rebuild, inferred discharge, or synthetic
 * data seeding. All reads are bounded and scoped to one isolated TEST/DEMO tenant.
 *
 * Usage:
 *   GHIMS_MOCK_INSPECTION_TENANT_ID=... GHIMS_MOCK_INSPECTION_MRN=... \
 *   GHIMS_MOCK_INSPECTION_CONFIRM_PROJECT=... bun scripts/ops/inspect-mock-retirement.ts
 */
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { mockRetirementNonOpdPointerBlockers } from '@/lib/backend/services/mock-patient-pointer-inspection';
import type { PatientMPI } from '@/types/mpi';

const TARGET_TENANTS = new Set(['tenant_02bb76e3', 'central-metro-hospital']);
const CONFIRMED_MOCKS = new Map([
  ['MRN-20260820-8790', 'eleanor vance'],
  ['MRN-20260930-3611', 'test patient'],
]);
const PER_COLLECTION_LIMIT = 26;
type Row = Record<string, unknown>;
type QueryName = 'encounters' | 'beds' | 'opd_queue' | 'invoices' | 'encounterCharges' | 'payments';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertReadOnlyInspectionScope(): { projectId: string; tenantId: string; mrn: string } {
  const mode = getRuntimeMode();
  const projectId = text(process.env.FIREBASE_PROJECT_ID);
  const expectedProject = text(
    mode === 'DEMO'
      ? process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO
      : process.env.GHIMS_FIREBASE_PROJECT_ID_TEST
  );
  const productionProject = text(process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION);
  const tenantId = text(process.env.GHIMS_MOCK_INSPECTION_TENANT_ID).toLowerCase();
  const mrn = text(process.env.GHIMS_MOCK_INSPECTION_MRN).toUpperCase();
  const confirmation = text(process.env.GHIMS_MOCK_INSPECTION_CONFIRM_PROJECT);
  const nodeEnv = text(process.env.NODE_ENV).toLowerCase();

  // Report only safe configuration check names, never tenant, project or
  // credential values. Every original guard remains mandatory and fail-closed.
  const failedChecks: string[] = [];
  if (!['TEST', 'DEMO'].includes(mode)) failedChecks.push('RUNTIME_NOT_TEST_OR_DEMO');
  if (!['development', 'test'].includes(nodeEnv)) failedChecks.push('NODE_ENV_NOT_DEVELOPMENT_OR_TEST');
  if (!projectId) failedChecks.push('FIREBASE_PROJECT_ID_MISSING');
  if (!expectedProject) failedChecks.push('TEST_OR_DEMO_PROJECT_ID_MISSING');
  if (projectId && expectedProject && projectId !== expectedProject) {
    failedChecks.push('FIREBASE_PROJECT_MISMATCH');
  }
  if (!productionProject) failedChecks.push('PRODUCTION_PROJECT_ID_MISSING');
  if (projectId && productionProject && productionProject === projectId) {
    failedChecks.push('TEST_PROJECT_EQUALS_PRODUCTION');
  }
  if (!confirmation) failedChecks.push('EXPLICIT_PROJECT_CONFIRMATION_MISSING');
  else if (confirmation !== projectId) failedChecks.push('PROJECT_CONFIRMATION_MISMATCH');
  if (!tenantId) failedChecks.push('INSPECTION_TENANT_ID_MISSING');
  else if (!TARGET_TENANTS.has(tenantId)) failedChecks.push('TENANT_NOT_ALLOWLISTED');
  if (!CONFIRMED_MOCKS.has(mrn)) failedChecks.push('MRN_NOT_ALLOWLISTED');

  if (failedChecks.length) {
    throw new Error('MOCK_INSPECTION_SCOPE_DENIED: ' + failedChecks.join(', '));
  }
  return { projectId, tenantId, mrn };
}

function pointer(value: unknown): { kind: string; value?: string; entries?: unknown[]; length?: number } {
  if (value === undefined) return { kind: 'absent' };
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string', value, length: value.length };
  if (Array.isArray(value)) {
    return { kind: 'array', entries: value.slice(0, 8), length: value.length };
  }
  return { kind: typeof value };
}

function summarize(collection: QueryName, id: string, row: Row): Row {
  const status = text(row.status) || 'UNKNOWN';
  switch (collection) {
    case 'encounters':
      return { id, patientId: row.patientId, type: row.encounterType || row.type || 'UNKNOWN', status };
    case 'beds':
      return { id, patientId: row.patientId || null, currentPatientId: row.currentPatientId || null, status };
    case 'opd_queue':
      return { id, encounterId: row.encounterId || null, status };
    default:
      return { id, encounterId: row.encounterId || null, status };
  }
}

async function run() {
  const scope = assertReadOnlyInspectionScope();
  const db = getAdminFirestore();
  if (!db) throw new Error('MOCK_INSPECTION_FIRESTORE_UNAVAILABLE');
  const tenantRef = db.collection('tenants').doc(scope.tenantId);
  const patients = await tenantRef.collection('patients')
    .where('mrn', '==', scope.mrn)
    .limit(3).get();

  if (patients.size !== 1) {
    throw new Error(
      'MOCK_INSPECTION_IDENTITY_AMBIGUOUS: expected exactly one canonical patient for the allowlisted MRN.'
    );
  }

  const doc = patients.docs[0];
  const patient = (doc.data() || {}) as Row;
  if (
    text(patient.id) !== doc.id ||
    text(patient.tenantId).toLowerCase() !== scope.tenantId ||
    text(patient.mrn).toUpperCase() !== scope.mrn ||
    text(patient.fullName).toLowerCase().replace(/\s+/g, ' ') !== CONFIRMED_MOCKS.get(scope.mrn)
  ) {
    throw new Error('MOCK_INSPECTION_IDENTITY_MISMATCH: document identity or patient facts do not match.');
  }

  const care = (
    patient.activeCareContexts && typeof patient.activeCareContexts === 'object' &&
    !Array.isArray(patient.activeCareContexts)
  ) ? patient.activeCareContexts as Row : {};
  const rawPointers = {
    activeBedId: pointer(patient.activeBedId),
    activeEncounterId: pointer(patient.activeEncounterId),
    activeIpdEncounterId: pointer(care.activeIpdEncounterId),
    activeEmergencyEncounterId: pointer(care.activeEmergencyEncounterId),
    activeOpdEncounterIds: pointer(care.activeOpdEncounterIds),
    activeTelehealthEncounterIds: pointer(care.activeTelehealthEncounterIds),
  };

  const blockers: string[] = mockRetirementNonOpdPointerBlockers(
    patient as unknown as PatientMPI
  ).map(field => 'COMMAND_POLICY_BLOCKER:' + field);
  if (patient.activeCareContexts !== null && patient.activeCareContexts !== undefined &&
      (typeof patient.activeCareContexts !== 'object' || Array.isArray(patient.activeCareContexts))) {
    blockers.push('INVALID_CARE_CONTEXT_STRUCTURE');
  }
  if (care.activeOpdEncounterIds !== undefined && care.activeOpdEncounterIds !== null &&
      !Array.isArray(care.activeOpdEncounterIds)) {
    blockers.push('INVALID_OPD_POINTER_TYPE');
  }
  if (rawPointers.activeBedId.value) blockers.push('PATIENT_ACTIVE_BED_POINTER');
  if (rawPointers.activeIpdEncounterId.value) blockers.push('PATIENT_ACTIVE_IPD_POINTER');
  if (rawPointers.activeEmergencyEncounterId.value) blockers.push('PATIENT_ACTIVE_EMERGENCY_POINTER');
  if (
    rawPointers.activeTelehealthEncounterIds.kind !== 'array' &&
    rawPointers.activeTelehealthEncounterIds.kind !== 'absent'
  ) blockers.push('INVALID_TELEHEALTH_POINTER_TYPE');
  if ((rawPointers.activeTelehealthEncounterIds.length || 0) > 0) {
    blockers.push('PATIENT_ACTIVE_TELEHEALTH_POINTER');
  }

  async function query(
    collection: QueryName,
    field: string,
    value: string
  ): Promise<{ rows: Row[]; truncated: boolean }> {
    const snap = await tenantRef.collection(collection)
      .where(field, '==', value)
      .limit(PER_COLLECTION_LIMIT).get();
    return {
      rows: snap.docs.slice(0, PER_COLLECTION_LIMIT - 1).map(
        d => summarize(collection, d.id, d.data() as Row)
      ),
      truncated: snap.size === PER_COLLECTION_LIMIT,
    };
  }

  const entries = await Promise.all([
    query('encounters', 'patientId', doc.id),
    query('beds', 'patientId', doc.id),
    query('beds', 'currentPatientId', doc.id),
    query('opd_queue', 'patientId', doc.id),
    query('invoices', 'patientId', doc.id),
    query('encounterCharges', 'patientId', doc.id),
    query('payments', 'patientId', doc.id),
  ]);
  const [encounters, bedsByPatient, bedsByCurrent, queue, invoices, charges, payments] = entries;
  const beds = [...new Map(
    [...bedsByPatient.rows, ...bedsByCurrent.rows]
      .map(row => [text(row.id), row] as const)
  ).values()];

  for (const [name, entry] of [
    ['encounters', encounters],
    ['beds.patientId', bedsByPatient],
    ['beds.currentPatientId', bedsByCurrent],
    ['opd_queue', queue],
    ['invoices', invoices],
    ['encounterCharges', charges],
    ['payments', payments],
  ] as const) {
    if (entry.truncated) blockers.push('BOUNDED_QUERY_EXCEEDED:' + name);
  }
  if (beds.length) blockers.push('BED_BACK_REFERENCE_PRESENT');
  if (encounters.rows.some(row => row.type !== 'OPD')) blockers.push('NON_OPD_ENCOUNTER_PRESENT');
  if (invoices.rows.length || charges.rows.length || payments.rows.length) {
    blockers.push('FINANCIAL_RECORDS_REQUIRE_RECONCILIATION');
  }
  const encounterIds = new Set(encounters.rows.map(row => text(row.id)));
  const referenced = [
    ...([rawPointers.activeEncounterId.value].filter(Boolean) as string[]),
    ...(rawPointers.activeOpdEncounterIds.entries || []).map(String),
  ];
  if (referenced.some(id => !encounterIds.has(id))) {
    blockers.push('UNVERIFIED_ENCOUNTER_POINTER');
  }
  if (queue.rows.some(row => row.encounterId && !encounterIds.has(text(row.encounterId)))) {
    blockers.push('UNVERIFIED_QUEUE_ENCOUNTER');
  }

  const deterministicInvoices = await Promise.all(
    [...encounterIds].slice(0, 20).map(async encounterId => {
      const invoiceId = 'inv_opd_consult_' + encounterId;
      const invoice = await tenantRef.collection('invoices').doc(invoiceId).get();
      return invoice.exists ? invoiceId : null;
    })
  );
  const foundDeterministicInvoices = deterministicInvoices.filter(
    (x): x is string => x !== null
  );
  if (foundDeterministicInvoices.length) {
    blockers.push('DETERMINISTIC_OPD_INVOICES_PRESENT');
  }

  const output = {
    success: true,
    mode: getRuntimeMode(),
    readOnly: true,
    projectId: scope.projectId,
    tenantId: scope.tenantId,
    mrn: scope.mrn,
    patientId: doc.id,
    version: patient.version || null,
    status: patient.status || 'UNKNOWN',
    pointers: rawPointers,
    linked: {
      encounters: encounters.rows,
      beds,
      opdQueue: queue.rows,
      invoices: invoices.rows,
      encounterCharges: charges.rows,
      payments: payments.rows,
      deterministicInvoiceIds: foundDeterministicInvoices,
    },
    blockers: [...new Set(blockers)],
    decision: blockers.length === 0
      ? 'NO_OBVIOUS_BLOCKERS_REVIEW_BEFORE_GOVERNED_COMMAND'
      : 'RECONCILIATION_REQUIRED_NO_CHANGES_MADE',
    limitation: 'This is a direct Firestore read, not an in-process ephemeral repository snapshot. ' +
      'No patient identity or care lifecycle is modified.',
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

if (import.meta.main) {
  run().catch(error => {
    process.stderr.write(JSON.stringify({
      success: false,
      readOnly: true,
      code: error instanceof Error ? error.message : 'MOCK_INSPECTION_FAILED',
    }, null, 2) + '\n');
    process.exitCode = 1;
  });
}
