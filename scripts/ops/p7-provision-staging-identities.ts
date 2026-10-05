import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';
import {
  UserProvisioningService,
  type ProvisionableUiRole,
} from '../../server/auth/user-provisioning-service';

const runtime = getRuntimeMode();
if (runtime !== 'STAGING') {
  throw new Error('P7_STAGING_ONLY: rehearsal identities may only be provisioned in STAGING.');
}
if (String(process.env.GHIMS_P7_ALLOW_STAGING_PROVISION || '').toLowerCase() !== 'true') {
  throw new Error('P7_STAGING_PROVISION_DISABLED: set GHIMS_P7_ALLOW_STAGING_PROVISION=true.');
}

const activeProject = String(
  process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ''
).trim();
const expectedProject = String(process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING || '').trim();
const confirmedProject = String(process.env.GHIMS_P7_CONFIRM_PROJECT || '').trim();

if (!activeProject || !expectedProject || activeProject !== expectedProject) {
  throw new Error('P7_STAGING_PROJECT_MISMATCH');
}
if (confirmedProject !== activeProject) {
  throw new Error('P7_STAGING_PROJECT_CONFIRMATION_MISMATCH');
}

const password = String(process.env.GHIMS_P7_BOOTSTRAP_PASSWORD || '');
if (password.length < 16) {
  throw new Error('P7_BOOTSTRAP_PASSWORD_REQUIRED: provide at least 16 characters.');
}

const tenantId = String(process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero')
  .trim()
  .toLowerCase();
if (!tenantId) throw new Error('P7_TENANT_ID_REQUIRED');

const auth = getAdminAuth();
const db = getAdminFirestore();
if (!auth || !db) throw new Error('P7_FIREBASE_ADMIN_UNAVAILABLE');

const personas: Array<{
  key: string;
  email: string;
  displayName: string;
  role: ProvisionableUiRole;
  department: string;
}> = [
  {
    key: 'admin',
    email: process.env.GHIMS_P7_ADMIN_EMAIL || 'p7.admin@g-hims.invalid',
    displayName: 'P7 Staging Administrator',
    role: 'admin',
    department: 'Hospital Administration',
  },
  {
    key: 'reception',
    email: process.env.GHIMS_P7_RECEPTION_EMAIL || 'p7.reception@g-hims.invalid',
    displayName: 'P7 Staging Reception',
    role: 'reception',
    department: 'Patient Access',
  },
  {
    key: 'nurse',
    email: process.env.GHIMS_P7_NURSE_EMAIL || 'p7.nurse@g-hims.invalid',
    displayName: 'P7 Staging Nurse',
    role: 'nurse',
    department: 'OPD Nursing',
  },
  {
    key: 'doctor',
    email: process.env.GHIMS_P7_DOCTOR_EMAIL || 'p7.doctor@g-hims.invalid',
    displayName: 'P7 Staging Doctor',
    role: 'doctor',
    department: 'General Medicine',
  },
  {
    key: 'billing',
    email: process.env.GHIMS_P7_BILLING_EMAIL || 'p7.billing@g-hims.invalid',
    displayName: 'P7 Staging Billing',
    role: 'billing',
    department: 'Revenue Cycle',
  },
  {
    key: 'lab',
    email: process.env.GHIMS_P7_LAB_EMAIL || 'p7.lab@g-hims.invalid',
    displayName: 'P7 Staging Lab',
    role: 'lab',
    department: 'Laboratory',
  },
  {
    key: 'pharmacy',
    email: process.env.GHIMS_P7_PHARMACY_EMAIL || 'p7.pharmacy@g-hims.invalid',
    displayName: 'P7 Staging Pharmacy',
    role: 'pharmacy',
    department: 'Pharmacy',
  },
];

await db.collection('tenants').doc(tenantId).set(
  {
    name: 'G-HIMS P7 Hospital-0 Staging',
    facilityCode: 'P7H0',
    tier: 'QUALIFICATION',
    region: 'STAGING',
    environment: 'STAGING',
    syntheticOnly: true,
    updatedAt: new Date().toISOString(),
  },
  { merge: true }
);

const users: Array<{
  key: string;
  email: string;
  uid: string;
  role: string;
  identityCreated: boolean;
}> = [];

const syntheticPharmacyBalanceId = `${tenantId}_P7H0_loc-pharmacy_P7-PARA-500_p7-batch`;
await db
  .collection('tenants')
  .doc(tenantId)
  .collection('inventoryBalances')
  .doc(syntheticPharmacyBalanceId)
  .set(
    {
      balanceId: syntheticPharmacyBalanceId,
      tenantId,
      facilityId: 'P7H0',
      locationId: 'loc-pharmacy',
      locationName: 'P7 Synthetic Pharmacy',
      itemId: 'P7-PARA-500',
      itemCode: 'P7-PARA-500',
      itemName: 'Synthetic Paracetamol',
      itemType: 'MEDICATION',
      batchId: 'p7-batch',
      batchNumber: 'P7-SYNTHETIC-BATCH',
      expiryDate: '2030-01-01',
      onHand: 500,
      reserved: 0,
      quarantined: 0,
      damaged: 0,
      expired: 0,
      inTransit: 0,
      available: 500,
      uom: 'TABLET',
      minimumStock: 20,
      maximumStock: 1000,
      reorderPoint: 100,
      unitCost: 500,
      totalValuation: 250000,
      lastMovementAt: new Date().toISOString(),
      version: 1,
      syntheticQualificationInventory: true,
    },
    { merge: true }
  );

for (const persona of personas) {
  const email = String(persona.email).trim().toLowerCase();
  let uid = '';
  let identityCreated = false;

  try {
    const result = await UserProvisioningService.provision({
      tenantId,
      email,
      displayName: persona.displayName,
      role: persona.role,
      department: persona.department,
      licenseId:
        persona.role === 'doctor' || persona.role === 'nurse'
          ? `P7-SYNTHETIC-${persona.key.toUpperCase()}`
          : undefined,
      assignedWards: [],
    });
    uid = result.user.userId;
    identityCreated = result.identityCreated;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('IAM_MEMBERSHIP_EXISTS')) {
      throw error;
    }
    uid = (await auth.getUserByEmail(email)).uid;
  }

  const membershipRef = db.collection('tenants').doc(tenantId).collection('users').doc(uid);
  const membershipSnapshot = await membershipRef.get();
  if (!membershipSnapshot.exists) {
    throw new Error(`P7_MEMBERSHIP_MISSING:${persona.key}`);
  }

  const membership = membershipSnapshot.data() || {};
  const roles = Array.isArray(membership.roles)
    ? membership.roles.map(String)
    : [String(membership.role || '')].filter(Boolean);
  const qualificationRoles = new Set(
    roles.map((role) => String(role).trim().toUpperCase()).filter(Boolean)
  );
  const qualificationPermissions = new Set(
    Array.isArray(membership.permissions)
      ? membership.permissions.map(String)
      : []
  );

  if (persona.key === 'admin') {
    [
      'ADMINISTRATOR',
      'HOSPITAL_EXECUTIVE',
      'FACILITIES_ADMIN',
      'HR_ADMIN',
      'MEDICAL_DIRECTOR',
      'SCM_MANAGER',
      'PROCUREMENT_MANAGER',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'PAYROLL_MANAGER',
    ].forEach((role) => qualificationRoles.add(role));
    qualificationPermissions.add('SCM_PURCHASE_ORDER:APPROVE');
  }
  if (persona.key === 'billing') {
    ['BILLING_CLERK', 'FINANCE_MANAGER', 'ACCOUNTANT', 'CASHIER', 'CFO']
      .forEach((role) => qualificationRoles.add(role));
    qualificationPermissions.add('ERP_GL:CREATE');
  }
  if (persona.key === 'lab') {
    qualificationRoles.add('LAB_TECH');
    qualificationRoles.add('PROCUREMENT_OFFICER');
  }
  if (persona.key === 'pharmacy') {
    qualificationRoles.add('PHARMACIST');
    qualificationRoles.add('STORE_KEEPER');
  }
  if (persona.key === 'reception') {
    qualificationRoles.add('RECEPTIONIST');
    qualificationRoles.add('DEPARTMENT_HEAD');
  }

  const privileges = new Set(
    Array.isArray(membership.clinicalPrivileges)
      ? membership.clinicalPrivileges.map(String)
      : []
  );

  // Synthetic credential verification is deliberately restricted to the
  // dedicated STAGING project and exists only for controlled qualification.
  if (persona.role === 'doctor') {
    privileges.add('PRESCRIBE');
    privileges.add('SIGN_CLINICAL_NOTES');
    privileges.add('ORDER_LAB');
    privileges.add('ORDER_RADIOLOGY');
  }
  if (persona.role === 'nurse') {
    privileges.add('RECORD_VITALS');
  }

  await membershipRef.set(
    {
      tenantName: 'G-HIMS P7 Hospital-0 Staging',
      facilityCode: 'P7H0',
      facilityIds: ['P7H0'],
      departmentIds: [persona.department],
      roles: Array.from(qualificationRoles),
      role: Array.from(qualificationRoles)[0] || persona.role,
      permissions: Array.from(qualificationPermissions),
      financialAuthorityMinorUnits:
        persona.key === 'billing' || persona.key === 'admin'
          ? 10_000_000_000
          : 0,
      credentialStatus: 'VERIFIED',
      clinicalPrivileges: Array.from(privileges),
      syntheticQualificationAccount: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  const clinicalQualificationRoles = new Set(['doctor', 'nurse', 'pharmacy', 'lab']);
  if (clinicalQualificationRoles.has(persona.role)) {
    const employeeId = `p7_emp_${persona.key}`;
    const credentialId = `p7_cred_${persona.key}`;
    const credentialType =
      persona.role === 'doctor'
        ? 'MEDICAL_LICENSE'
        : persona.role === 'nurse'
          ? 'NURSING_BOARD'
          : persona.role === 'pharmacy'
            ? 'PHARMACY_LICENSE'
            : 'PROFESSIONAL_REGISTRATION';
    await db.collection('tenants').doc(tenantId).collection('employees').doc(employeeId).set({
      employeeId,
      tenantId,
      userId: uid,
      personalInfo: {
        legalFirstName: 'P7',
        legalLastName: persona.role === 'doctor' ? 'Doctor' : 'Nurse',
        contactEmail: email,
      },
      employmentStatus: 'ACTIVE',
      facilityIds: ['P7H0'],
      departmentIds: [persona.department],
      primaryFacilityId: 'P7H0',
      primaryDepartmentId: persona.department,
      credentialRevision: 1,
      syntheticQualificationRecord: true,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await db.collection('tenants').doc(tenantId)
      .collection('clinicalCredentials').doc(credentialId).set({
        credentialId,
        tenantId,
        employeeId,
        credentialType,
        credentialNumber: `P7-SYNTHETIC-${persona.key.toUpperCase()}`,
        issueDate: '2026-01-01',
        expiryDate: '2035-12-31',
        isMandatoryForPractice: true,
        verificationStatus: 'VERIFIED',
        syntheticQualificationRecord: true,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    const privilegeTypes =
      persona.role === 'doctor'
        ? ['PRESCRIBE_MEDICATION', 'ORDER_LAB', 'ORDER_RADIOLOGY', 'ORDER_PROCEDURE', 'SIGN_CLINICAL_NOTE']
        : persona.role === 'pharmacy'
          ? ['DISPENSE_MEDICATION']
          : persona.role === 'lab'
            ? ['VERIFY_LAB_RESULT']
            : [];
    if (privilegeTypes.length > 0) {
      for (const privilegeType of privilegeTypes) {
        const privilegeId = `p7_prv_${persona.key}_${privilegeType.toLowerCase()}`;
        await db.collection('tenants').doc(tenantId)
          .collection('clinicalPrivileges').doc(privilegeId).set({
            privilegeId,
            tenantId,
            employeeId,
            privilegeType,
            facilityId: 'P7H0',
            departmentId: persona.department,
            status: 'GRANTED',
            effectiveFrom: '2026-01-01',
            effectiveUntil: '2035-12-31',
            syntheticQualificationRecord: true,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
      }
    }
  }

  await auth.updateUser(uid, {
    password,
    disabled: false,
    emailVerified: true,
    displayName: persona.displayName,
  });

  await auth.setCustomUserClaims(uid, {
    tenantId,
    role: Array.from(qualificationRoles)[0] || persona.role,
    roles: Array.from(qualificationRoles),
    accessibleTenants: [tenantId],
    p7SyntheticQualification: true,
    claimedAt: Date.now(),
  });

  users.push({
    key: persona.key,
    email,
    uid,
    role: Array.from(qualificationRoles)[0] || persona.role,
    identityCreated,
  });
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime,
      projectId: activeProject,
      tenantId,
      syntheticOnly: true,
      users,
      note: 'Passwords are intentionally omitted from output.',
    },
    null,
    2
  ) + '\n'
);
