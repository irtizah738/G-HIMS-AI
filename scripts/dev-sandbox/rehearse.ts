/**
 * Read-only emulator rehearsal: verify the seeded patient/encounter/clinical
 * scope invariants before manually executing real backend commands in G-HIMS.
 * This is NOT a synthetic assertion that clinical commands have completed.
 */
import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { validateDevelopmentSandbox } from '../../lib/dev-sandbox/safety';
import { SANDBOX_FACILITY_ID, SANDBOX_PERSONAS, SANDBOX_SCENARIOS, scenarioCarePointers } from '../../lib/dev-sandbox/scenarios';
import { ConsultantDirectoryService } from '../../lib/clinical/intelligence/consultant-directory-service';

const { tenantId } = validateDevelopmentSandbox(process.env);
const db = getAdminFirestore();
const auth = getAdminAuth();
if (!db || !auth) throw new Error('DEV_SANDBOX_EMULATOR_NOT_READY');
const tenant = db.collection('tenants').doc(tenantId);
const metadata = await tenant.get();
if (!metadata.exists || metadata.data()?.syntheticOnly !== true ||
    metadata.data()?.environment !== 'TEST') {
  throw new Error('DEV_SANDBOX_UNVERIFIED_TENANT');
}
const checks: Array<{ workflow: string; result: string; next: string }> = [];
for (const scene of SANDBOX_SCENARIOS) {
  const patient = await tenant.collection('patients').doc(scene.patientId).get();
  if (!patient.exists || !patient.data()?.sandboxFixture || patient.data()?.mrn !== scene.mrn) {
    throw new Error(`DEV_SANDBOX_IDENTITY_NOT_READY:${scene.id}`);
  }
  if (scene.encounterId) {
    const encounter = await tenant.collection('encounters').doc(scene.encounterId).get();
    if (!encounter.exists || encounter.data()?.patientId !== scene.patientId ||
        encounter.data()?.status !== scene.encounterStatus ||
        !encounter.data()?.sandboxFixture) {
      throw new Error(`DEV_SANDBOX_ENCOUNTER_NOT_READY:${scene.id}`);
    }
    const care = scenarioCarePointers(scene);
    if (JSON.stringify(patient.data()?.activeCareContexts) !== JSON.stringify(care)) {
      throw new Error(`DEV_SANDBOX_CARE_POINTER_NOT_READY:${scene.id}`);
    }
  }
  checks.push({
    workflow: scene.id,
    result: 'FIXTURE_READY_NOT_WORKFLOW_PASSED',
    next: scene.expectedNextAction,
  });
}
const doctor = SANDBOX_PERSONAS.find(p => p.key === 'doctor')!;
const uid = `dev-sandbox-${doctor.key}`;
const clinicalMember = await tenant.collection('users').doc(uid).get();
const clinicalCredentials = await tenant.collection('clinicalCredentials')
  .where('employeeId', '==', 'ds_emp_doctor').limit(2).get();
const signingPrivileges = await tenant.collection('clinicalPrivileges')
  .where('employeeId', '==', 'ds_emp_doctor').get();
const doctorRecord = await tenant.collection('employees').doc('ds_emp_doctor').get();
const roster = await tenant.collection('rosterAssignments')
  .where('employeeId', '==', 'ds_emp_doctor').get();
if (!(await auth.getUser(uid)).email?.endsWith('@ghims-dev-sandbox.invalid') ||
    clinicalMember.data()?.credentialStatus !== 'VERIFIED' ||
    !clinicalMember.data()?.clinicalPrivileges?.includes('SIGN_CLINICAL_NOTES') ||
    clinicalCredentials.size !== 1 ||
    !signingPrivileges.docs.some(x => x.data().privilegeType === 'SIGN_CLINICAL_NOTES' &&
      x.data().status === 'GRANTED')) {
  throw new Error('DEV_SANDBOX_HCM_DOCTOR_CREDENTIAL_NOT_READY');
}
const eligibility = ConsultantDirectoryService.assertConsultantEligibility({
  employee: doctorRecord.data() as any,
  membership: clinicalMember.data() as any,
  credentials: clinicalCredentials.docs.map(doc => doc.data() as any),
  privileges: signingPrivileges.docs.map(doc => doc.data() as any),
  shifts: roster.docs.map(doc => doc.data() as any),
  facilityId: SANDBOX_FACILITY_ID,
  departmentId: doctor.department,
  now: Date.now(),
});
if (!eligibility.eligible || eligibility.availability !== 'ON_DUTY' ||
    !eligibility.activePrivilegeTypes?.includes('CONSULT_OPD') ||
    !eligibility.activePrivilegeTypes?.includes('SIGN_CLINICAL_NOTES')) {
  throw new Error('DEV_SANDBOX_CLINICIAN_NOT_ROUTABLE:' +
    (eligibility.reason || eligibility.availability));
}
process.stdout.write(JSON.stringify({
  success: true, tenantId, doctorIdentity: 'SYNTHETIC_VERIFIED_IN_EMULATOR',
  consultantEligibility: 'ON_DUTY_AND_HCM_VERIFIED',
  checks, stage: 'READY_FOR_ACTUAL_COMMAND_E2E',
  next: 'Use authenticated sandbox UI/API workflows and collect command/audit/outbox evidence for each scenario.',
}, null, 2) + '\n');
