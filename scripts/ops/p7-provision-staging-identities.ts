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
      credentialStatus:
        persona.role === 'doctor' || persona.role === 'nurse' ? 'VERIFIED' : 'VERIFIED',
      clinicalPrivileges: Array.from(privileges),
      syntheticQualificationAccount: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  await auth.updateUser(uid, {
    password,
    disabled: false,
    emailVerified: true,
    displayName: persona.displayName,
  });

  await auth.setCustomUserClaims(uid, {
    tenantId,
    role: roles[0] || persona.role,
    roles,
    accessibleTenants: [tenantId],
    p7SyntheticQualification: true,
    claimedAt: Date.now(),
  });

  users.push({
    key: persona.key,
    email,
    uid,
    role: roles[0] || persona.role,
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
