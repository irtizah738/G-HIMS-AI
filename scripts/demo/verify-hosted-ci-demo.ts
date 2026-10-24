/**
 * Read-only verification of the already provisioned G-HIMS CI investor demo.
 * Run via verify-hosted-ci-demo.sh from authenticated Google Cloud Shell.
 * Never creates or updates users, Firestore documents, projections, or rules.
 */
import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { assertDemoRuntime } from '../../lib/runtime/runtime-mode';
import { assertInvestorDemoFromEnvironment } from '../../lib/runtime/investor-demo-isolation';

const projectId = 'g-hims-ci-demo';
const tenantId = 'central-metro-hospital';
const patientId = 'demo-ci-patient-001';
const emailNames = ['admin', 'doctor', 'nurse', 'reception', 'billing', 'pharmacy', 'lab', 'patient'];

assertDemoRuntime('Hosted investor-demo read verification');
if (
  process.env.DEVSHELL_PROJECT_ID !== projectId ||
  process.env.GHIMS_DEMO_USE_CLOUD_SHELL_CLI !== 'true' ||
  process.env.FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO !== projectId ||
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO !== projectId ||
  process.env.GHIMS_DEMO_TENANT_ID !== tenantId ||
  process.env.VERCEL ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_PRIVATE_KEY ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.FIRESTORE_EMULATOR_HOST
) throw new Error('CI_DEMO_READONLY_VERIFICATION_SCOPE_INVALID');

// The bootstrap guard requires an explicit hosted-write acknowledgment, which
// would be misleading on a read-only script. Check its precise no-emulator
// equivalent here instead and do not create/set a hosted-write ack.
const auth = getAdminAuth();
const db = getAdminFirestore();
if (!auth || !db) throw new Error('CI_DEMO_READONLY_FIREBASE_ADMIN_UNAVAILABLE');

const tenantRef = db.collection('tenants').doc(tenantId);
const [tenant, patient, projection, events] = await Promise.all([
  tenantRef.get(),
  tenantRef.collection('patients').doc(patientId).get(),
  tenantRef.collection('patient360Projections').doc(patientId).get(),
  tenantRef.collection('events').where('syntheticDemoRecord', '==', true).limit(15).get(),
]);
if (!tenant.exists || tenant.data()?.syntheticOnly !== true || tenant.data()?.environment !== 'DEMO') {
  throw new Error('CI_DEMO_TENANT_NOT_CONFIRMED_SYNTHETIC');
}
const patientData = patient.data();
if (!patient.exists || patientData?.syntheticDemoRecord !== true ||
    patientData?.tenantId !== tenantId || patientData?.mrn !== 'CI-DEMO-001' ||
    patientData?.fullName !== 'Amina Shah (Synthetic)') {
  throw new Error('CI_DEMO_PATIENT_RECORD_MISSING_OR_NOT_SYNTHETIC');
}
const projectionData = projection.data();
if (!projection.exists || projectionData?.patientId !== patientId ||
    !Number.isInteger(projectionData?.revision) || projectionData.revision < 10 ||
    projectionData.projectionVersion !== 6) {
  throw new Error('CI_DEMO_PATIENT360_PROJECTION_NOT_QUALIFIED');
}
const expectedCounts: Record<string, number> = {
  encounters: 2, conditions: 2, allergies: 1, medicationOrders: 2,
  observations: 4, diagnosticOrders: 1, diagnosticReports: 1,
  procedures: 1, carePlans: 1, documents: 1,
};
const counts = projectionData.counts || {};
for (const [key, minimum] of Object.entries(expectedCounts)) {
  if (!Number.isInteger(counts[key]) || counts[key] < minimum) {
    throw new Error('CI_DEMO_PATIENT360_COUNT_INVALID:' + key);
  }
}
if (events.docs.filter(d => d.data().syntheticDemoRecord === true &&
        d.data().tenantId === tenantId).length < 10) {
  throw new Error('CI_DEMO_SOURCE_EVENTS_INCOMPLETE');
}

for (const name of emailNames) {
  const user = await auth.getUserByEmail('demo.' + name + '@example.invalid');
  if (user.disabled || user.emailVerified !== true) {
    throw new Error('CI_DEMO_AUTH_IDENTITY_INACTIVE:' + name);
  }
}
console.log('DEMO_FIREBASE_PROJECT=' + projectId);
console.log('DEMO_TENANT_SYNTHETIC=PASS');
console.log('DEMO_AUTH_EIGHT_IDENTITIES=PASS');
console.log('DEMO_PATIENT_RECORD=PASS');
console.log('DEMO_PATIENT360_PROJECTION=PASS');
console.log('DEMO_PATIENT360_REVISION=' + projectionData.revision);
console.log('DEMO_PATIENT360_COUNTS=' + JSON.stringify(counts));
console.log('DEMO_SOURCE_EVENTS=PASS');
console.log('CI_DEMO_HOSTED_READ_VERIFICATION=PASS');
