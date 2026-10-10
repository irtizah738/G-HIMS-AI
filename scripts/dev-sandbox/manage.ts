/**
 * Usage (only inside local Firebase Auth + Firestore emulators):
 *   bun scripts/dev-sandbox/manage.ts seed|verify|reset
 *
 * There is no hosted-project fallback, no bypass and no production credentials.
 * Reset destroys only the marked disposable sandbox tenant IN THE EMULATOR.
 */
import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import {
  SANDBOX_ACK, SANDBOX_PROJECT_ID, SANDBOX_TENANT_ID,
  validateDevelopmentSandbox,
} from '../../lib/dev-sandbox/safety';
import {
  SANDBOX_FACILITY_ID, SANDBOX_FIXTURE_VERSION, SANDBOX_PERSONAS,
  SANDBOX_SCENARIOS, scenarioCarePointers,
} from '../../lib/dev-sandbox/scenarios';

const action = String(process.argv[2] || '').trim().toLowerCase();
if (!['seed', 'verify', 'reset'].includes(action)) {
  throw new Error('DEV_SANDBOX_ACTION_REQUIRED: seed | verify | reset');
}
const { tenantId, projectId } = validateDevelopmentSandbox(process.env);
const db = getAdminFirestore();
const auth = getAdminAuth();
if (!db || !auth) throw new Error('DEV_SANDBOX_EMULATOR_ADMIN_UNAVAILABLE');
const tenant = db.collection('tenants').doc(tenantId);
const existingTenant = await tenant.get();

function assertExistingMarker(): void {
  if (!existingTenant.exists ||
      existingTenant.data()?.sandboxMarker !== SANDBOX_ACK ||
      existingTenant.data()?.syntheticOnly !== true ||
      existingTenant.data()?.environment !== 'TEST' ||
      existingTenant.data()?.projectId !== projectId) {
    throw new Error('DEV_SANDBOX_TENANT_MARKER_NOT_VERIFIED');
  }
}

const personaUid = (key: string) => `dev-sandbox-${key}`;

if (action === 'reset') {
  if (!existingTenant.exists) {
    process.stdout.write('Sandbox tenant already absent. No records changed.\n');
  } else {
    assertExistingMarker();
    if (String(process.env.GHIMS_DEV_SANDBOX_RESET_ACK || '') !==
        'RESET_DISPOSABLE_EMULATOR_TENANT') {
      throw new Error('DEV_SANDBOX_RESET_CONFIRMATION_REQUIRED');
    }
    // NEVER call recursiveDelete in hosted Firebase: guard above proves both
    // emulators, TEST-only project/tenant, marker and explicit double consent.
    await db.recursiveDelete(tenant);
    for (const persona of SANDBOX_PERSONAS) {
      const uid = personaUid(persona.key);
      try {
        const user = await auth.getUser(uid);
        if (user.email !== `${persona.key}@ghims-dev-sandbox.invalid`) {
          throw new Error('DEV_SANDBOX_AUTH_IDENTITY_MISMATCH');
        }
        await auth.deleteUser(uid);
      } catch (error: any) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }
    process.stdout.write(JSON.stringify({
      success: true, action, projectId, tenantId,
      scope: 'local-emulator-disposable-tenant', resetAt: new Date().toISOString(),
    }) + '\n');
  }
} else if (action === 'seed') {
  if (existingTenant.exists) {
    assertExistingMarker();
    throw new Error('DEV_SANDBOX_ALREADY_SEEDED: reset first; do not overwrite workflow evidence.');
  }
  const password = String(process.env.GHIMS_DEV_SANDBOX_PASSWORD || '');
  if (password.length < 16) {
    throw new Error('DEV_SANDBOX_PASSWORD_REQUIRED: provide 16+ chars through environment only.');
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await tenant.create({
    tenantId, projectId, name: 'G-HIMS Disposable Development Hospital',
    syntheticOnly: true, environment: 'TEST', sandboxMarker: SANDBOX_ACK,
    fixtureVersion: SANDBOX_FIXTURE_VERSION, createdAt: nowIso,
  });

  for (const persona of SANDBOX_PERSONAS) {
    const uid = personaUid(persona.key);
    const email = `${persona.key}@ghims-dev-sandbox.invalid`;
    try {
      await auth.createUser({
        uid, email, displayName: `Sandbox ${persona.key}`,
        emailVerified: true, disabled: false, password,
      });
    } catch (error: any) {
      if (error?.code !== 'auth/uid-already-exists') throw error;
      const existing = await auth.getUser(uid);
      if (existing.email !== email) {
        throw new Error('DEV_SANDBOX_AUTH_UID_COLLISION');
      }
      throw new Error('DEV_SANDBOX_STALE_AUTH_FIXTURE: reset before reseeding.');
    }
    await auth.setCustomUserClaims(uid, { tenantId, roles: [persona.role], role: persona.role });
    const isClinical = ['doctor', 'nurse', 'lab', 'pharmacy'].includes(persona.key);
    const privilegeTypes =
      persona.key === 'doctor' ? [
        'SIGN_CLINICAL_NOTE', 'SIGN_CLINICAL_NOTES', 'SIGN_SOAP_CLINICAL_NOTE',
        'CONSULT_OPD', 'ORDER_LAB', 'PRESCRIBE_MEDICATION',
      ] : persona.key === 'nurse' ? ['RECORD_VITALS'] :
      persona.key === 'lab' ? ['VERIFY_LAB_RESULT'] :
      persona.key === 'pharmacy' ? ['DISPENSE_MEDICATION'] : [];
    await tenant.collection('users').doc(uid).create({
      userId: uid, uid, tenantId, email, displayName: `Sandbox ${persona.key}`,
      role: persona.role, roles: [persona.role],
      departmentId: persona.department, departmentIds: [persona.department],
      facilityIds: [SANDBOX_FACILITY_ID], status: 'active',
      clinicalPrivileges: privilegeTypes, credentialStatus: isClinical ? 'VERIFIED' : 'UNVERIFIED',
      permissions: [], syntheticQualificationAccount: true,
      sandboxFixture: true, createdAt: nowIso,
    });
    if (isClinical) {
      const employeeId = `ds_emp_${persona.key}`;
      await tenant.collection('employees').doc(employeeId).create({
        employeeId, tenantId, userId: uid,
        personalInfo: { legalFirstName: 'Sandbox', legalLastName: persona.key,
          contactEmail: email },
        employmentStatus: 'ACTIVE', facilityIds: [SANDBOX_FACILITY_ID],
        departmentIds: [persona.department],
        primaryFacilityId: SANDBOX_FACILITY_ID,
        primaryDepartmentId: persona.department,
        credentialRevision: 1, syntheticQualificationRecord: true,
        sandboxFixture: true, createdAt: nowIso,
      });
      const credentialId = `ds_cred_${persona.key}`;
      await tenant.collection('clinicalCredentials').doc(credentialId).create({
        credentialId, tenantId, employeeId,
        credentialType: persona.key === 'doctor' ? 'MEDICAL_LICENSE' :
          persona.key === 'nurse' ? 'NURSING_BOARD' : 'PROFESSIONAL_REGISTRATION',
        credentialNumber: `DS-SYNTHETIC-${persona.key.toUpperCase()}`,
        issueDate: '2026-01-01', expiryDate: '2035-12-31',
        verificationStatus: 'VERIFIED', isMandatoryForPractice: true,
        verifiedByActorId: personaUid('admin'), verifiedAt: nowIso,
        syntheticQualificationRecord: true, sandboxFixture: true,
      });
      for (const privilegeType of privilegeTypes) {
        const privilegeId = `ds_priv_${persona.key}_${privilegeType.toLowerCase()}`;
        await tenant.collection('clinicalPrivileges').doc(privilegeId).create({
          privilegeId, tenantId, employeeId, privilegeType,
          facilityId: SANDBOX_FACILITY_ID, departmentId: persona.department,
          status: 'GRANTED', effectiveFrom: '2026-01-01',
          effectiveUntil: '2035-12-31',
          syntheticQualificationRecord: true, sandboxFixture: true,
        });
      }
      await tenant.collection('rosterAssignments').doc(`ds_roster_${persona.key}`).create({
        assignmentId: `ds_roster_${persona.key}`, tenantId, employeeId,
        facilityId: SANDBOX_FACILITY_ID, departmentId: persona.department,
        startTime: new Date(now - 3600_000).toISOString(),
        endTime: new Date(now + 12 * 3600_000).toISOString(),
        shiftName: 'DAY', status: 'PUBLISHED',
        syntheticQualificationRecord: true, sandboxFixture: true,
      });
    }
  }

  await tenant.collection('facilities').doc(SANDBOX_FACILITY_ID).create({
    id: SANDBOX_FACILITY_ID, facilityId: SANDBOX_FACILITY_ID,
    tenantId, name: 'Synthetic Development Facility',
    status: 'ACTIVE', sandboxFixture: true,
  });

  for (const scenario of SANDBOX_SCENARIOS) {
    const care = scenarioCarePointers(scenario);
    const activeIds = [
      ...(care.activeOpdEncounterIds as string[]),
      ...(care.activeTelehealthEncounterIds as string[]),
      String(care.activeIpdEncounterId || ''),
      String(care.activeEmergencyEncounterId || ''),
    ].filter(Boolean);
    await tenant.collection('patients').doc(scenario.patientId).create({
      id: scenario.patientId, patientId: scenario.patientId,
      tenantId, mrn: scenario.mrn, fullName: scenario.fullName,
      dateOfBirth: '1990-01-01', gender: 'Other', bloodGroup: 'Unknown',
      status: 'ACTIVE', identifiers: [], tariffPlan: 'OUT_OF_POCKET',
      contactPhone: '', activeCareContexts: care,
      activeEncounterId: activeIds[0] || null,
      activeBedId: scenario.encounterType === 'IPD' ? 'ds_bed_01' : null,
      consentSummary: {
        GENERAL_OUTPATIENT: { status: 'GRANTED', consentId: `ds_consent_${scenario.id}` },
      },
      createdAt: now, updatedAt: now, sandboxFixture: true,
      syntheticQualificationRecord: true, scenarioId: scenario.id,
    });
    if (scenario.encounterId) {
      await tenant.collection('encounters').doc(scenario.encounterId).create({
        id: scenario.encounterId, encounterId: scenario.encounterId,
        tenantId, patientId: scenario.patientId,
        facilityId: SANDBOX_FACILITY_ID,
        departmentId: scenario.encounterType === 'TELEHEALTH'
          ? 'TELEHEALTH' : 'GENERAL_MEDICINE',
        encounterType: scenario.encounterType, status: scenario.encounterStatus,
        assignedProviderId: personaUid('doctor'), currentStage:
          scenario.encounterStatus === 'COMPLETED' ? 'COMPLETED' : 'REGISTERED',
        chiefComplaint: 'SYNTHETIC DEVELOPMENT FIXTURE — not real clinical care',
        createdAt: now, updatedAt: now, scenarioId: scenario.id, sandboxFixture: true,
      });
    }
    if (scenario.encounterType === 'TELEHEALTH') {
      await tenant.collection('telehealthSessions').doc(`ds_session_${scenario.id}`).create({
        id: `ds_session_${scenario.id}`, tenantId,
        encounterId: scenario.encounterId, patientId: scenario.patientId,
        roomToken: `ROOM-${crypto.randomUUID().toUpperCase()}`,
        status: scenario.encounterStatus === 'COMPLETED' ? 'COMPLETED' : 'WAITING_ROOM',
        type: 'Telehealth Consultation', chiefComplaint: 'Synthetic test encounter',
        soapNote: { subjective: '', objective: '', assessment: '', plan: '',
          icd10Codes: [], cptCodes: [] },
        prescriptions: [], transcription: [], callDurationSeconds: 0,
        isRecording: false, vitals: { bp: '', hr: 0, spo2: 0, temp: 0 },
        connectionQuality: 'UNKNOWN', createdAt: nowIso, updatedAt: nowIso,
        sandboxFixture: true, scenarioId: scenario.id,
      });
    }
  }
  if (SANDBOX_SCENARIOS.some(s => s.id === 'inpatient-care')) {
    await tenant.collection('beds').doc('ds_bed_01').create({
      id: 'ds_bed_01', tenantId, facilityId: SANDBOX_FACILITY_ID,
      bedNumber: 'DS-01', status: 'occupied', patientId: 'ds_patient_ipd',
      currentEncounterId: 'ds_enc_ipd', sandboxFixture: true,
    });
  }
  process.stdout.write(JSON.stringify({
    success: true, action, projectId, tenantId,
    identities: SANDBOX_PERSONAS.map(({ key, role }) => ({
      email: `${key}@ghims-dev-sandbox.invalid`, role,
    })),
    scenarios: SANDBOX_SCENARIOS.map(({ id, mrn, expectedNextAction }) =>
      ({ id, mrn, expectedNextAction })),
    note: 'Fixtures establish starting conditions, not successful clinical commands. Password is not printed.',
  }, null, 2) + '\n');
} else {
  assertExistingMarker();
  const checks: Array<{ scenario: string; result: string }> = [];
  for (const scenario of SANDBOX_SCENARIOS) {
    const patient = await tenant.collection('patients').doc(scenario.patientId).get();
    if (!patient.exists || !patient.data()?.sandboxFixture ||
        patient.data()?.mrn !== scenario.mrn) {
      throw new Error(`DEV_SANDBOX_SCENARIO_IDENTITY_MISMATCH:${scenario.id}`);
    }
    if (scenario.encounterId) {
      const episode = await tenant.collection('encounters').doc(scenario.encounterId).get();
      if (!episode.exists || !episode.data()?.sandboxFixture ||
          episode.data()?.patientId !== scenario.patientId) {
        throw new Error(`DEV_SANDBOX_SCENARIO_ENCOUNTER_MISMATCH:${scenario.id}`);
      }
    }
    checks.push({ scenario: scenario.id, result: 'IDENTITY_BOUND' });
  }
  for (const persona of SANDBOX_PERSONAS) {
    const uid = personaUid(persona.key);
    const user = await auth.getUser(uid);
    const member = await tenant.collection('users').doc(uid).get();
    if (!member.exists || user.email !== `${persona.key}@ghims-dev-sandbox.invalid` ||
        !member.data()?.sandboxFixture) {
      throw new Error(`DEV_SANDBOX_PERSONA_MISMATCH:${persona.key}`);
    }
  }
  process.stdout.write(JSON.stringify({
    success: true, action, projectId, tenantId, personaCount: SANDBOX_PERSONAS.length,
    checks, note: 'Structural fixtures verified, clinical workflow completion still requires cross-role testing.',
  }, null, 2) + '\n');
}
