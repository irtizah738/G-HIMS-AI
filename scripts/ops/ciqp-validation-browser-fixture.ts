/**
 * Disposable TEST-only fixture for browser-based clinical validation.
 * Must execute only within firebase emulators:exec (auth + firestore).
 * No production services, patients, model predictions or imported clinical data.
 */
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';

const PROJECT = 'ghims-ciqp-synthetic';
const TENANT = 'ciqp-renal-browser';
const FACILITY = 'ciqp-browser-facility';
const DEPARTMENT = 'ciqp-browser-medicine';
const PASSWORD = 'SyntheticBrowserTestOnly!8462';

export const BROWSER_CIQP_TEST_IDENTITIES = {
  coordinator: 'cv_browser_coord_001',
  reviewerA: 'cv_browser_clinA_001',
  reviewerB: 'cv_browser_clinB_001',
  adjudicator: 'cv_browser_adjudicator_001',
} as const;

function assertScope() {
  if (
    process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
    process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'TEST' ||
    process.env.FIREBASE_PROJECT_ID !== PROJECT ||
    process.env.GHIMS_FIREBASE_PROJECT_ID_TEST !== PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== PROJECT ||
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST !== PROJECT ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.VERCEL
  ) {
    throw new Error('CIQP_BROWSER_FIXTURE_TEST_EMULATORS_REQUIRED');
  }
}

async function main() {
  assertScope();
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) throw new Error('CIQP_BROWSER_FIXTURE_EMULATOR_UNAVAILABLE');

  const tenant = db.collection('tenants').doc(TENANT);
  await tenant.set({ name: 'Synthetic Clinical Review Hospital', facilityCode: 'CV-SYN-1', syntheticOnly: true });

  for (const [role, uid] of Object.entries(BROWSER_CIQP_TEST_IDENTITIES)) {
    const coordinator = role === 'coordinator';
    // Do not replace or elevate an existing user even in the disposable emulator.
    let exists = false;
    try { await auth.getUser(uid); exists = true; } catch {}
    if (exists) throw new Error('CIQP_BROWSER_FIXTURE_PREEXISTING_USER');
    await auth.createUser({
      uid, email: uid + '@synthetic.invalid', password: PASSWORD,
      displayName: 'Synthetic ' + role, emailVerified: true,
    });
    await tenant.collection('users').doc(uid).create({
      userId: uid, tenantId: TENANT, status: 'ACTIVE',
      roles: coordinator ? ['SYSTEM_ADMIN'] : ['DOCTOR'],
      permissions: coordinator ? ['CLINICAL_VALIDATION_ADMIN'] : ['CLINICAL_VALIDATION_REVIEW'],
      facilityIds: [FACILITY], departmentIds: [DEPARTMENT],
      credentialStatus: coordinator ? 'UNVERIFIED' : 'VERIFIED',
    });
    if (!coordinator) {
      const employeeId = 'emp_' + uid;
      await tenant.collection('employees').doc(employeeId).create({
        employeeId, tenantId: TENANT, userId: uid,
        employmentStatus: 'ACTIVE', facilityIds: [FACILITY], departmentIds: [DEPARTMENT],
      });
      await tenant.collection('clinicalCredentials').doc('creds_' + uid).create({
        credentialId: 'creds_' + uid, employeeId,
        isMandatoryForPractice: true, verificationStatus: 'VERIFIED',
        verifiedByActorId: 'ciqp-synthetic-verifier',
        verifiedAt: '2026-10-24T00:00:00.000Z',
        issueDate: '2024-01-01', expiryDate: '2030-12-31',
      });
      await tenant.collection('clinicalPrivileges').doc('priv_' + uid).create({
        privilegeId: 'priv_' + uid, employeeId,
        privilegeType: 'SIGN_CLINICAL_NOTE',
        status: 'GRANTED', effectiveFrom: '2024-01-01',
        effectiveUntil: '2030-12-31', facilityId: FACILITY,
        departmentId: DEPARTMENT,
      });
    }
  }

  // Safe operational record: never emit reusable credentials in logs.
  console.log('CIQP_BROWSER_FIXTURE=PASS');
  console.log('DATA_SCOPE=DISPOSABLE_SYNTHETIC_TEST_EMULATORS_ONLY');
  console.log('TENANT=' + TENANT);
  console.log('FIXTURE_IDENTITIES=4');
}

await main();
