import { getAdminAuth } from '../../server/firebase/admin';
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

const personas: Array<{
  email: string;
  displayName: string;
  role: ProvisionableUiRole;
  department: string;
}> = [
  { email: 'demo.admin@example.invalid', displayName: 'Demo Administrator', role: 'admin', department: 'Hospital Administration' },
  { email: 'demo.doctor@example.invalid', displayName: 'Demo Physician', role: 'doctor', department: 'General Medicine' },
  { email: 'demo.nurse@example.invalid', displayName: 'Demo Nurse', role: 'nurse', department: 'Inpatient Nursing' },
  { email: 'demo.reception@example.invalid', displayName: 'Demo Receptionist', role: 'reception', department: 'Patient Access' },
  { email: 'demo.billing@example.invalid', displayName: 'Demo Billing Officer', role: 'billing', department: 'Revenue Cycle' },
  { email: 'demo.patient@example.invalid', displayName: 'Demo Patient', role: 'patient', department: 'Patient Portal' },
];

const auth = getAdminAuth();
if (!auth) throw new Error('DEMO_FIREBASE_ADMIN_UNAVAILABLE');

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
  });
  results.push({ email: persona.email, uid, role: persona.role });
}

process.stdout.write(JSON.stringify({ success: true, tenantId, users: results }, null, 2) + '\n');
