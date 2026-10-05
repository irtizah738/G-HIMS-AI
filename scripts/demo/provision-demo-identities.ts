import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { assertDemoRuntime } from '../../lib/runtime/runtime-mode';
import { UserProvisioningService, type ProvisionableUiRole } from '../../server/auth/user-provisioning-service';

assertDemoRuntime('Demo identity provisioning');

const password = String(process.env.GHIMS_DEMO_BOOTSTRAP_PASSWORD || '');
if (password.length < 12) {
  throw new Error('DEMO_BOOTSTRAP_PASSWORD_REQUIRED: provide at least 12 characters.');
}

const tenantId = String(process.env.GHIMS_DEMO_TENANT_ID || 'central-metro-hospital')
  .trim()
  .toLowerCase();
const facilityId = 'DEMO_FACILITY';

const personas: Array<{
  key: string;
  email: string;
  displayName: string;
  role: ProvisionableUiRole;
  department: string;
}> = [
  { key: 'admin', email: 'demo.admin@example.invalid', displayName: 'Demo Administrator', role: 'admin', department: 'Hospital Administration' },
  { key: 'doctor', email: 'demo.doctor@example.invalid', displayName: 'Demo Physician', role: 'doctor', department: 'General Medicine' },
  { key: 'nurse', email: 'demo.nurse@example.invalid', displayName: 'Demo Nurse', role: 'nurse', department: 'OPD Nursing' },
  { key: 'reception', email: 'demo.reception@example.invalid', displayName: 'Demo Receptionist', role: 'reception', department: 'Patient Access' },
  { key: 'billing', email: 'demo.billing@example.invalid', displayName: 'Demo Billing Officer', role: 'billing', department: 'Revenue Cycle' },
  { key: 'pharmacy', email: 'demo.pharmacy@example.invalid', displayName: 'Demo Pharmacist', role: 'pharmacy', department: 'Pharmacy' },
  { key: 'lab', email: 'demo.lab@example.invalid', displayName: 'Demo Lab Technologist', role: 'lab', department: 'Laboratory' },
  { key: 'patient', email: 'demo.patient@example.invalid', displayName: 'Demo Patient', role: 'patient', department: 'Patient Portal' },
];

const auth = getAdminAuth();
const db = getAdminFirestore();
if (!auth || !db) throw new Error('DEMO_FIREBASE_ADMIN_UNAVAILABLE');

const clinicalRoles = new Set<ProvisionableUiRole>(['doctor', 'nurse', 'pharmacy', 'lab']);
const results = [];

for (const persona of personas) {
  let uid = '';
  try {
    const result = await UserProvisioningService.provision({
      tenantId,
      email: persona.email,
      displayName: persona.displayName,
      role: persona.role,
      department: persona.department,
      assignedWards: [],
    });
    uid = result.user.userId;
  } catch (error: any) {
    if (!String(error?.message || '').includes('IAM_MEMBERSHIP_EXISTS')) throw error;
    uid = (await auth.getUserByEmail(persona.email)).uid;
  }

  await auth.updateUser(uid, {
    password,
    disabled: false,
    emailVerified: true,
    displayName: persona.displayName,
  });

  if (clinicalRoles.has(persona.role)) {
    const employeeId = `demo_emp_${persona.key}`;
    const credentialId = `demo_cred_${persona.key}`;
    const credentialType =
      persona.role === 'doctor'
        ? 'MEDICAL_LICENSE'
        : persona.role === 'nurse'
          ? 'NURSING_BOARD'
          : persona.role === 'pharmacy'
            ? 'PHARMACY_LICENSE'
            : 'PROFESSIONAL_REGISTRATION';

    await db.collection('tenants').doc(tenantId).collection('users').doc(uid).set({
      credentialStatus: 'VERIFIED',
      facilityIds: [facilityId],
      departmentIds: [persona.department],
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await db.collection('tenants').doc(tenantId).collection('employees').doc(employeeId).set({
      employeeId,
      tenantId,
      userId: uid,
      personalInfo: {
        legalFirstName: 'Demo',
        legalLastName: persona.displayName.replace(/^Demo\s+/i, ''),
        contactEmail: persona.email,
      },
      employmentStatus: 'ACTIVE',
      facilityIds: [facilityId],
      departmentIds: [persona.department],
      primaryFacilityId: facilityId,
      primaryDepartmentId: persona.department,
      credentialRevision: 1,
      syntheticQualificationRecord: true,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await db.collection('tenants').doc(tenantId).collection('clinicalCredentials').doc(credentialId).set({
      credentialId,
      tenantId,
      employeeId,
      credentialType,
      credentialNumber: `DEMO-${persona.key.toUpperCase()}-LICENSE`,
      issueDate: '2026-01-01',
      expiryDate: '2035-12-31',
      isMandatoryForPractice: true,
      verificationStatus: 'VERIFIED',
      syntheticQualificationRecord: true,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    const privilegeTypes =
      persona.role === 'doctor'
        ? ['PRESCRIBE_MEDICATION', 'ORDER_LAB', 'ORDER_RADIOLOGY', 'ORDER_PROCEDURE', 'SIGN_CLINICAL_NOTE', 'ACKNOWLEDGE_CRITICAL_RESULT']
        : persona.role === 'pharmacy'
          ? ['DISPENSE_MEDICATION']
          : persona.role === 'lab'
            ? ['VERIFY_LAB_RESULT']
            : [];

    for (const privilegeType of privilegeTypes) {
      const privilegeId = `demo_prv_${persona.key}_${privilegeType.toLowerCase()}`;
      await db.collection('tenants').doc(tenantId).collection('clinicalPrivileges').doc(privilegeId).set({
        privilegeId,
        tenantId,
        employeeId,
        employeeName: persona.displayName,
        privilegeType,
        specialty: persona.department,
        facilityId,
        facilityName: 'G-HIMS Demo Facility',
        departmentId: persona.department,
        departmentName: persona.department,
        effectiveFrom: '2026-01-01',
        effectiveUntil: '2035-12-31',
        status: 'GRANTED',
        grantedByActorId: 'DEMO_BOOTSTRAP',
        syntheticQualificationRecord: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }

  results.push({ email: persona.email, uid, role: persona.role });
}

process.stdout.write(JSON.stringify({ success: true, tenantId, users: results }, null, 2) + '\n');
