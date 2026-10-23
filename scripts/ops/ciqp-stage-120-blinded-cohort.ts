/**
 * CIQP: exact blinded 120-case cohort staging.
 *
 * This is an engineering-only staging operation, NOT release of the clinical
 * protocol and NOT authorization for a clinician to access or score a case.
 * Dataset is generated locally from the independently prepared synthetic-only
 * script and compared to the fixed SHA before any Firestore write.
 */
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';

const TENANT = 'ciqp-renal-browser';
const PROJECT = 'ghims-ciqp-synthetic';
const STUDY_ID = 'renal-ciqp-synthetic-120-v0';
const SOURCE_PATH = 'tmp/ghims-ciqp/120-blinded-synthetic-cases.jsonl';
const EXPECTED_SHA256 = '116596dd531f549873cf026cb0e61209f96554954ca622f53ef3b7fb3adcca9d';

interface CohortObservation {
  source_id: string;
  loinc: string;
  value: number;
  unit: string;
  status: string;
  effective_at: string;
  analyte: string;
}
interface CohortRow {
  case_id: string;
  synthetic_only: true;
  snapshot_as_of: string;
  clinical_context: Record<string, string | number>;
  observations: CohortObservation[];
  review_instructions: string;
}

function checkSandbox() {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== PROJECT ||
      process.env.GHIMS_FIREBASE_PROJECT_ID_TEST !== PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
      process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST !== PROJECT ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      Boolean(process.env.VERCEL)) {
    throw new Error('CIQP_COHORT_ISOLATED_EMULATOR_REQUIRED');
  }
}

export function parseLockedSyntheticCohort(bytes: Buffer): CohortRow[] {
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== EXPECTED_SHA256) {
    throw new Error('CIQP_COHORT_SOURCE_SHA256_MISMATCH');
  }
  const lines = bytes.toString('utf8').trimEnd().split('\n');
  if (lines.length !== 120) throw new Error('CIQP_COHORT_CASE_COUNT_INVALID');
  const ids = new Set<string>();
  return lines.map(line => {
    const record = JSON.parse(line) as CohortRow;
    if (!/^SYNREN-[A-F0-9]{12}$/.test(record.case_id) ||
        record.synthetic_only !== true || ids.has(record.case_id) ||
        !record.review_instructions?.includes('Independently review source facts') ||
        !record.clinical_context || !Array.isArray(record.observations) ||
        record.observations.length < 2 || record.observations.length > 3 ||
        !record.observations.every(o =>
          o.source_id.startsWith(record.case_id + '-E') &&
          typeof o.loinc === 'string' &&
          typeof o.unit === 'string' && typeof o.status === 'string' &&
          typeof o.effective_at === 'string' &&
          typeof o.value === 'number' && Number.isFinite(o.value))) {
      throw new Error('CIQP_COHORT_SYNTHETIC_SCHEMA_INVALID');
    }
    ids.add(record.case_id);
    return record;
  });
}

async function main() {
  checkSandbox();
  const rows = parseLockedSyntheticCohort(await readFile(SOURCE_PATH));
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_COHORT_FIRESTORE_EMULATOR_UNAVAILABLE');
  const tenant = db.collection('tenants').doc(TENANT);
  const studyRef = tenant.collection('clinicalValidationStudies').doc(STUDY_ID);
  const existing = await studyRef.get();
  if (existing.exists) throw new Error('CIQP_COHORT_ALREADY_STAGED');

  const batch = db.batch();
  const timestamp = Date.now();
  batch.create(studyRef, {
    studyId: STUDY_ID, status: 'STAGED_LOCKED_POLICY_UNAPPROVED',
    dataClass: 'SYNTHETIC_ONLY', cohortCount: 120,
    exactSourceSha256: EXPECTED_SHA256,
    protocolApproved: false, institutionalAuthorization: false,
    clinicianReviewCount: 0, reviewerCredentialsVerified: false,
    algorithmPredictionsUnblinded: false,
    createdAt: timestamp,
  });
  for (const record of rows) {
    batch.create(tenant.collection('clinicalValidationCohortCases').doc(record.case_id), {
      ...record, studyId: STUDY_ID,
      status: 'STAGED_LOCKED_POLICY_UNAPPROVED',
      immutableSourceSha256: crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex'),
      createdAt: timestamp,
    });
  }
  const audit = tenant.collection('audit_logs').doc('ciqp120-import-' + EXPECTED_SHA256.slice(0,16));
  batch.create(audit, {
    auditId: audit.id, tenantId: TENANT,
    actorId: 'ciqp-emulator-only-fixture',
    actorRole: 'TEST_FIXTURE',
    action: 'CIQP_120_SYNTHETIC_COHORT_STAGED',
    resourceType: 'CLINICAL_VALIDATION_SYNTHETIC',
    resourceId: STUDY_ID, occurredAt: timestamp, recordedAt: timestamp,
    metadata: { sourceSha256: EXPECTED_SHA256, count: 120,
      policyApproved: false, syntheticOnly: true },
  });
  await batch.commit();
  console.log('CIQP_120_EXACT_SOURCE_SHA256=' + EXPECTED_SHA256);
  console.log('CIQP_120_SYNTHETIC_LOCKED_STAGING=PASS');
  console.log('CLINICIAN_CASE_ACCESS=DENIED_PENDING_APPROVAL');
  console.log('COHORT_OUTCOME_METRICS=NOT_AVAILABLE');
  console.log('PRODUCTION_RELEASE=NOT_AUTHORIZED');
}

if (import.meta.main) await main();
