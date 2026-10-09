/**
 * ORC-7 read-only reconciliation inventory.
 * Explicitly staging-only: never mutate clinical, workforce or financial state.
 * Prints counts only; no patient or employee identifiers or PHI.
 */
import { getAdminFirestore } from '@/server/firebase/admin';
import { FieldPath, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { credentialsValid } from '@/lib/clinical/intelligence/consultant-directory-service';
import type { EmployeeCredential } from '@/types/hcm-advanced';

type RecordRow = { documentId: string; [key: string]: unknown };

export function requireOrcAuditEnvironment(env: NodeJS.ProcessEnv): string {
  if (String(env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase() !== 'STAGING') {
    throw new Error('ORC_AUDIT_STAGING_ONLY');
  }
  const tenantId = String(env.GHIMS_ORC_AUDIT_TENANT_ID || '').trim().toLowerCase();
  if (!tenantId || !/^[a-z0-9][a-z0-9_-]{1,127}$/.test(tenantId)) {
    throw new Error('ORC_AUDIT_EXPLICIT_TENANT_REQUIRED');
  }
  return tenantId;
}

async function readAll(
  ref: DocumentReference,
  collection: string,
  maxRows = 50000
): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = ref.collection(collection).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const document of snap.docs) {
      out.push({ ...document.data(), documentId: document.id });
    }
    if (out.length > maxRows) {
      throw new Error('ORC_AUDIT_COLLECTION_TOO_LARGE:' + collection);
    }
    if (snap.size < 500) return out;
    cursor = snap.docs[snap.docs.length - 1] || null;
    if (!cursor) return out;
  }
}

const str = (value: unknown): string => String(value ?? '').trim();
const active = (value: unknown): boolean => str(value).toUpperCase() === 'ACTIVE';

export function calculateOrcIntegrityCounts(input: {
  users: RecordRow[];
  employees: RecordRow[];
  credentials: RecordRow[];
  privileges: RecordRow[];
  encounters: RecordRow[];
  invoices: RecordRow[];
}): Record<string, number> {
  const userIds = new Set(input.users.filter(u=>active(u.status)).map(u=>u.documentId));
  const employeeIds = new Set(input.employees.map(e=>str(e.employeeId)).filter(Boolean));
  // Mirror the live server's mandatory credential policy: a VERIFIED label
  // without independent verification provenance or valid dates is insufficient.
  const groupedCredentials = new Map<string, EmployeeCredential[]>();
  for (const row of input.credentials) {
    const employeeId = str(row.employeeId);
    if (!employeeId) continue;
    const bucket = groupedCredentials.get(employeeId) || [];
    bucket.push(row as unknown as EmployeeCredential);
    groupedCredentials.set(employeeId, bucket);
  }
  const now = Date.now();
  const credentialsByEmployee = new Set(
    [...groupedCredentials.entries()]
      .filter(([, records]) => credentialsValid(records, now))
      .map(([employeeId]) => employeeId)
  );
  const cleared = new Set(input.encounters.filter(e=>
    str(e.financialClearanceState)==='FINAL_BILLING_CLEARED'
  ).map(e=>str(e.encounterId||e.documentId)));
  return {
    activeEmployeeMissingAuthMembership: input.employees.filter(e=>active(e.employmentStatus) &&
      (!str(e.userId) || !userIds.has(str(e.userId)))).length,
    activeEmployeeWithoutVerifiedMandatoryCredential: input.employees.filter(e=>active(e.employmentStatus) &&
      !credentialsByEmployee.has(str(e.employeeId))).length,
    privilegeWithMissingEmployee: input.privileges.filter(p=>!employeeIds.has(str(p.employeeId))).length,
    emergencyEncounterWithoutFacility: input.encounters.filter(e=>
      str(e.encounterType).toUpperCase()==='EMERGENCY' && !str(e.facilityId)).length,
    clearedEncounterWithOutstandingInvoice: input.invoices.filter(i=>
      cleared.has(str(i.encounterId)) && Number(i.balanceDue)>0).length,
  };
}

if (import.meta.main) {
  const tenantId = requireOrcAuditEnvironment(process.env);
  const db = getAdminFirestore();
  if (!db) throw new Error('ORC_AUDIT_FIRESTORE_UNAVAILABLE');
  const tenantRef = db.collection('tenants').doc(tenantId);
  const [users,employees,credentials,privileges,encounters,invoices] = await Promise.all(
    (['users','employees','clinicalCredentials','clinicalPrivileges','encounters','invoices'] as const)
      .map(key => readAll(tenantRef,key))
  );
  const counts = calculateOrcIntegrityCounts({
    users,employees,credentials,privileges,encounters,invoices,
  });
  process.stdout.write(JSON.stringify({
    schema:'ghims.orc7.staging-readonly.v1',
    inspectedAt:new Date().toISOString(),
    tenantId,
    mutationsPerformed:0,
    scannedCollections:6,
    counts,
    warning:'Diagnostic heuristic only. Verify individual records through governed administrator workflows before correction.',
  },null,2)+'\n');
}
