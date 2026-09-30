import { getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';

const tenantId = String(
  process.env.GHIMS_SCM5_PROVISION_TENANT || ''
).trim().toLowerCase();
const confirmedProject = String(
  process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT || ''
).trim();
const activeProject = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();

if (process.env.GHIMS_ALLOW_SCM5_FINANCE_PROVISION !== 'true') {
  throw new Error(
    'SCM5_FINANCE_PROVISION_DISABLED: GHIMS_ALLOW_SCM5_FINANCE_PROVISION=true is required.'
  );
}
if (!tenantId) {
  throw new Error(
    'SCM5_FINANCE_PROVISION_TENANT_REQUIRED: GHIMS_SCM5_PROVISION_TENANT is required.'
  );
}
if (!activeProject || confirmedProject !== activeProject) {
  throw new Error('SCM5_FINANCE_PROVISION_PROJECT_CONFIRMATION_MISMATCH');
}

const mode = getRuntimeMode();
if (
  mode === 'PRODUCTION' &&
  process.env.GHIMS_ALLOW_PRODUCTION_SCM5_FINANCE_PROVISION !== 'true'
) {
  throw new Error(
    'SCM5_FINANCE_PROVISION_PRODUCTION_CONFIRMATION_REQUIRED'
  );
}

const db = getAdminFirestore();
if (!db) {
  throw new Error('SCM5_FINANCE_PROVISION_FIREBASE_ADMIN_UNAVAILABLE');
}

const accounts = db
  .collection('tenants')
  .doc(tenantId)
  .collection('accounts');

async function findByCode(code: string) {
  const snapshot = await accounts.where('accountCode', '==', code).limit(2).get();
  if (snapshot.size > 1) {
    throw new Error(
      `SCM5_COA_DUPLICATE_CODE: tenant ${tenantId} has duplicate account code ${code}.`
    );
  }
  return snapshot.docs[0] || null;
}

const inventoryAccounts = await Promise.all([
  findByCode('1210'),
  findByCode('1220'),
]);
if (inventoryAccounts.some((doc) => !doc)) {
  throw new Error(
    'SCM5_COA_INVENTORY_ACCOUNT_MISSING: accounts 1210 and 1220 are required before provisioning 6040.'
  );
}

const currencies = new Set(
  inventoryAccounts.map((doc) =>
    String(doc?.data().currency || '').trim().toUpperCase()
  )
);
if (currencies.size !== 1 || ![...currencies][0] || [...currencies][0].length !== 3) {
  throw new Error(
    'SCM5_COA_INVENTORY_CURRENCY_INVALID: inventory accounts must share one 3-letter currency.'
  );
}
const currency = [...currencies][0];

const existing = await findByCode('6040');
if (existing) {
  const data = existing.data();
  if (
    data.category !== 'expense' ||
    data.normalBalance !== 'debit' ||
    data.isActive === false ||
    String(data.currency || '').trim().toUpperCase() !== currency
  ) {
    throw new Error(
      'SCM5_COA_CONTROL_ACCOUNT_INVALID: account 6040 conflicts with inventory variance semantics.'
    );
  }
} else {
  const docId = 'scm5-6040';
  const ref = accounts.doc(docId);
  const collision = await ref.get();
  if (collision.exists && collision.data()?.accountCode !== '6040') {
    throw new Error('SCM5_COA_DOCUMENT_COLLISION');
  }
  const now = new Date().toISOString();
  await ref.create({
    id: docId,
    accountCode: '6040',
    accountName: 'Inventory Shrinkage, Count Variance & Write-Off Expense',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    balance: 0,
    currency,
    description:
      'Physical count shortages, approved write-offs, and inventory control variances',
    isActive: true,
    isSystemLocked: true,
    tenantId,
    createdAt: now,
    updatedAt: now,
  });
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtimeMode: mode,
      projectId: activeProject,
      tenantId,
      currency,
      inventoryAccountsVerified: ['1210', '1220'],
      inventoryVarianceAccount: '6040',
      created: !existing,
    },
    null,
    2
  ) + '\n'
);
