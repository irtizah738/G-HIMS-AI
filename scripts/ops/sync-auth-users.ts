import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';

/**
 * G-HIMS Ops Tool: Provision or sync Firebase Auth users into the Firestore tenant database.
 * Uses Firebase Admin SDK for authoritative synchronization.
 *
 * Usage:
 *   bun scripts/ops/sync-auth-users.ts --all
 *   bun scripts/ops/sync-auth-users.ts [email] [role] [tenantId]
 */

const permissions = [
  'patient:read', 'patient:write',
  'encounter:read', 'encounter:write',
  'order:read', 'order:write',
  'clinical:read', 'clinical:write',
  'admin:read', 'admin:write',
  'billing:read', 'billing:write',
  'inventory:read', 'inventory:write',
  'telehealth:read', 'telehealth:write',
];

const clinicalPrivileges = [
  'ORDER_MEDICATIONS',
  'ORDER_DIAGNOSTICS',
  'ORDER_LAB',
  'ORDER_RADIOLOGY',
  'ADMIT_INPATIENT',
  'DISCHARGE_INPATIENT',
  'PERFORM_PROCEDURES',
  'SIGN_CLINICAL_NOTES',
  'SIGN_PRESCRIPTIONS',
];

function deriveRole(email: string, requestedRole?: string): { role: string; roles: string[]; displayName: string; department: string } {
  const cleanEmail = email.toLowerCase().trim();
  if (requestedRole) {
    const role = requestedRole.toLowerCase().trim();
    const roles = role === 'administrator' ? ['administrator', 'doctor'] : [role];
    return {
      role,
      roles,
      displayName: cleanEmail.split('@')[0],
      department: role === 'administrator' ? 'Hospital Administration' : 'General Medicine',
    };
  }

  if (cleanEmail.includes('admin') || cleanEmail.includes('haider') || cleanEmail.includes('irtiza')) {
    return {
      role: 'administrator',
      roles: ['administrator', 'doctor'],
      displayName: cleanEmail.includes('irtiza') ? 'Irtiza Haider' : 'Hospital Administrator',
      department: 'Hospital Administration',
    };
  }

  if (cleanEmail.includes('jenkins') || cleanEmail.includes('doctor')) {
    return {
      role: 'doctor',
      roles: ['doctor'],
      displayName: 'Dr. Sarah Jenkins, MD',
      department: 'General Medicine',
    };
  }

  if (cleanEmail.includes('oswald') || cleanEmail.includes('nurse')) {
    return {
      role: 'nurse',
      roles: ['nurse'],
      displayName: 'Nurse Clara Oswald, RN',
      department: 'Inpatient Nursing',
    };
  }

  if (cleanEmail.includes('santos') || cleanEmail.includes('reception')) {
    return {
      role: 'receptionist',
      roles: ['receptionist'],
      displayName: 'Maria Santos',
      department: 'Outpatient Patient Intake',
    };
  }

  if (cleanEmail.includes('hastings') || cleanEmail.includes('billing')) {
    return {
      role: 'billing_clerk',
      roles: ['billing_clerk', 'billing_staff'],
      displayName: 'Robert Hastings',
      department: 'Revenue Cycle & Claims',
    };
  }

  if (cleanEmail.includes('rostova') || cleanEmail.includes('patient')) {
    return {
      role: 'patient',
      roles: ['patient'],
      displayName: 'Elena Rostova (Patient)',
      department: 'Consumer Health Portal',
    };
  }

  return {
    role: 'administrator',
    roles: ['administrator', 'doctor'],
    displayName: cleanEmail.split('@')[0] || 'Medical Staff',
    department: 'Hospital Administration',
  };
}

async function syncSingleUser(
  auth: any,
  db: any,
  user: { uid: string; email?: string; displayName?: string },
  tenantId: string = 'central-metro-hospital',
  overrideRole?: string
) {
  const email = (user.email || '').toLowerCase().trim();
  const { role, roles, displayName: defaultDisplayName, department } = deriveRole(email, overrideRole);
  const displayName = user.displayName || defaultDisplayName;
  const now = new Date().toISOString();

  const isClinician = role === 'doctor' || role === 'administrator' || role === 'nurse';

  const membershipData = {
    userId: user.uid,
    tenantId,
    email,
    displayName,
    role,
    roles,
    status: 'ACTIVE',
    department,
    departmentIds: [department],
    facilityIds: [],
    assignedWards: [],
    permissions,
    clinicalPrivileges: isClinician ? clinicalPrivileges : [],
    credentialStatus: 'VERIFIED',
    createdAt: now,
    updatedAt: now,
  };

  await db
    .collection('tenants')
    .doc(tenantId)
    .collection('users')
    .doc(user.uid)
    .set(membershipData, { merge: true });

  await db.collection('user_profiles').doc(user.uid).set(
    {
      uid: user.uid,
      email,
      name: displayName,
      role,
      tenantId,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  try {
    await auth.setCustomUserClaims(user.uid, {
      tenantId,
      role,
      roles,
      accessibleTenants: [tenantId],
    });
  } catch (claimErr) {
    console.warn(`Notice: Unable to set custom claims for ${user.uid}:`, claimErr);
  }

  return { uid: user.uid, email, displayName, role, roles, status: 'ACTIVE' };
}

async function main() {
  const args = process.argv.slice(2);
  const auth = getAdminAuth();
  const db = getAdminFirestore();

  if (!auth || !db) {
    console.error('Error: Firebase Admin is uninitialized. Ensure credentials are set.');
    process.exit(1);
  }

  const tenantId = 'central-metro-hospital';

  // Ensure root tenant document exists
  await db.collection('tenants').doc(tenantId).set(
    {
      id: tenantId,
      name: 'Central Metro General Hospital',
      facilityCode: 'CENT',
      activeStatus: 'ACTIVE',
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  if (args.length === 0 || args[0] === '--all') {
    console.log('Synchronizing all Firebase Auth users to Firestore...');
    const result = await auth.listUsers(100);
    const synced = [];

    for (const user of result.users) {
      const info = await syncSingleUser(auth, db, user, tenantId);
      synced.push(info);
      console.log(`Synced user: ${info.email} (${info.uid}) -> ${info.role}`);
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          count: synced.length,
          users: synced,
        },
        null,
        2
      )
    );
    return;
  }

  const targetEmail = args[0].toLowerCase().trim();
  const overrideRole = args[1];

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(targetEmail);
  } catch (err: any) {
    console.log(`User ${targetEmail} not found in Firebase Auth. Creating user...`);
    userRecord = await auth.createUser({
      email: targetEmail,
      displayName: targetEmail.split('@')[0],
      emailVerified: true,
    });
  }

  const info = await syncSingleUser(auth, db, userRecord, tenantId, overrideRole);
  console.log(JSON.stringify({ success: true, user: info }, null, 2));
}

main().catch((err) => {
  console.error('Fatal error syncing users to Firestore:', err);
  process.exit(1);
});
