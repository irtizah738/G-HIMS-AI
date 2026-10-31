/**
 * Build a canonical Patient 360 source fixture through the actual registration
 * orchestrator. Structural DEV sandbox patient fixtures intentionally do not
 * prove clinical event or projection persistence.
 */
import { validateDevelopmentSandbox } from '@/lib/dev-sandbox/safety';
import { getAdminFirestore } from '@/server/firebase/admin';
import { SANDBOX_FACILITY_ID } from '@/lib/dev-sandbox/scenarios';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';

const { tenantId } = validateDevelopmentSandbox(process.env);
const db = getAdminFirestore();
if (!db) throw new Error('CIQP_BROWSER_EMULATOR_ADMIN_UNAVAILABLE');

const tenant = await db.collection('tenants').doc(tenantId).get();
if (
  tenant.data()?.syntheticOnly !== true ||
  tenant.data()?.environment !== 'TEST' ||
  tenant.data()?.sandboxFixture === false
) throw new Error('CIQP_BROWSER_NOT_SYNTHETIC_TENANT');

const patientId = 'ciqp_browser_patient';
if ((await db.collection('tenants').doc(tenantId).collection('patients').doc(patientId).get()).exists) {
  throw new Error('CIQP_BROWSER_PATIENT_ALREADY_EXISTS');
}

const created = await registerPatientAndEncounter({
  tenantId,
  patientId,
  commandId: 'ciqp-browser-register',
  idempotencyKey: 'ciqp-browser-register-fixture-only',
  fullName: 'Synthetic CIQP Browser Patient',
  gender: 'other',
  dateOfBirth: '1985-01-01',
  identifiers: [{ type: 'CNIC', value: String(Date.now()).slice(-11) }],
  contactPhone: '+920000000000',
  address: 'Disposable emulator only',
  encounterType: 'OPD',
  facilityId: SANDBOX_FACILITY_ID,
  departmentId: 'GENERAL_MEDICINE',
  actorId: 'dev-sandbox-reception',
  actorRole: 'RECEPTIONIST',
  actorName: 'Synthetic Sandbox Reception',
  assignedDoctor: 'dev-sandbox-doctor',
});
if (created.patient.id !== patientId || created.encounter.patientId !== patientId) {
  throw new Error('CIQP_BROWSER_REGISTRATION_LINEAGE_MISMATCH');
}
const projection = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
const events = await Patient360ProjectionService.loadPatientEvents(tenantId, patientId);
if (
  !projection.timelineReady ||
  projection.patientId !== patientId ||
  !projection.contentHash ||
  events.length === 0
) throw new Error('CIQP_BROWSER_IMMUTABLE_PATIENT360_NOT_READY');

process.stdout.write('CIQP_BROWSER_REGISTERED_AND_PROJECTED_SYNTHETIC_PATIENT=PASS\n');
