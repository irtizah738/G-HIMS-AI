import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';
import { ROLE_DEFINITIONS } from '../../lib/auth/rbac';

const email = String(process.env.GHIMS_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const tenantId = String(process.env.GHIMS_BOOTSTRAP_ADMIN_TENANT || '').trim().toLowerCase();
const displayName = String(process.env.GHIMS_BOOTSTRAP_ADMIN_DISPLAY_NAME || 'G-HIMS Administrator').trim();
const confirmedProject = String(process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT || '').trim();
const activeProject =
  String(process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();

if (process.env.GHIMS_ALLOW_ADMIN_BOOTSTRAP !== 'true') {
  throw new Error('ADMIN_BOOTSTRAP_DISABLED: GHIMS_ALLOW_ADMIN_BOOTSTRAP=true is required.');
}
if (!email.includes('@') || !tenantId) {
  throw new Error('ADMIN_BOOTSTRAP_INPUT_INVALID: email and tenant are required.');
}
if (!activeProject || confirmedProject !== activeProject) {
  throw new Error('ADMIN_BOOTSTRAP_PROJECT_CONFIRMATION_MISMATCH');
}

const mode = getRuntimeMode();
if (mode === 'PRODUCTION' && process.env.GHIMS_ALLOW_PRODUCTION_ADMIN_BOOTSTRAP !== 'true') {
  throw new Error(
    'ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION_REQUIRED: explicit production override is required.'
  );
}

const auth = getAdminAuth();
const db = getAdminFirestore();
if (!auth || !db) throw new Error('ADMIN_BOOTSTRAP_FIREBASE_ADMIN_UNAVAILABLE');

let identity;
let identityCreated = false;
try {
  identity = await auth.getUserByEmail(email);
} catch (error: any) {
  if (error?.code !== 'auth/user-not-found') throw error;
  identity = await auth.createUser({
    email,
    displayName,
    emailVerified: false,
    disabled: false,
  });
  identityCreated = true;
}

const permissions = new Set<string>();
for (const [resource, actions] of Object.entries(ROLE_DEFINITIONS.administrator.permissions)) {
  for (const action of actions) permissions.add(`${resource}:${action}`);
}

const now = new Date().toISOString();
await db.collection('tenants').doc(tenantId).collection('users').doc(identity.uid).set({
  userId: identity.uid,
  tenantId,
  email,
  displayName,
  role: 'administrator',
  roles: ['administrator'],
  status: 'ACTIVE',
  department: 'Hospital Administration',
  departmentIds: ['Hospital Administration'],
  facilityIds: [],
  permissions: Array.from(permissions),
  clinicalPrivileges: [],
  credentialStatus: 'VERIFIED',
  createdAt: now,
  updatedAt: now,
}, { merge: true });

await auth.setCustomUserClaims(identity.uid, {
  tenantId,
  role: 'administrator',
  roles: ['administrator'],
  accessibleTenants: [tenantId],
  claimedAt: Date.now(),
});

process.stdout.write(JSON.stringify({
  success: true,
  runtimeMode: mode,
  projectId: activeProject,
  tenantId,
  uid: identity.uid,
  email,
  identityCreated,
  nextStep: identityCreated
    ? 'Use the Forgot password flow to establish the Firebase password.'
    : 'Existing Firebase identity linked to administrator membership.',
}, null, 2) + '\n');
