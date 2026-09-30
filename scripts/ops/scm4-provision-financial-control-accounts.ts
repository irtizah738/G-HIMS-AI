import { getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';

const tenantId = String(
  process.env.GHIMS_SCM4_PROVISION_TENANT || ''
).trim().toLowerCase();
const confirmedProject = String(
  process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT || ''
).trim();
const activeProject = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();

if (process.env.GHIMS_ALLOW_SCM4_FINANCE_PROVISION !== 'true') {
  throw new Error(
    'SCM4_FINANCE_PROVISION_DISABLED: GHIMS_ALLOW_SCM4_FINANCE_PROVISION=true is required.'
  );
}
if (!tenantId) {
  throw new Error(
    'SCM4_FINANCE_PROVISION_TENANT_REQUIRED: GHIMS_SCM4_PROVISION_TENANT is required.'
  );
}
if (!activeProject || confirmedProject !== activeProject) {
  throw new Error('SCM4_FINANCE_PROVISION_PROJECT_CONFIRMATION_MISMATCH');
}

const mode = getRuntimeMode();
if (
  mode === 'PRODUCTION' &&
  process.env.GHIMS_ALLOW_PRODUCTION_SCM4_FINANCE_PROVISION !== 'true'
) {
  throw new Error(
    'SCM4_FINANCE_PROVISION_PRODUCTION_CONFIRMATION_REQUIRED: explicit production override is required.'
  );
}

const db = getAdminFirestore();
if (!db) {
  throw new Error('SCM4_FINANCE_PROVISION_FIREBASE_ADMIN_UNAVAILABLE');
}

type AccountShape = {
  id?: string;
  accountCode?: string;
  accountName?: string;
  category?: string;
  normalBalance?: string;
  currency?: string;
  isActive?: boolean;
  allowSupplierPayments?: boolean;
};

const accounts = db
  .collection('tenants')
  .doc(tenantId)
  .collection('accounts');

async function findByCode(code: string) {
  const snapshot = await accounts.where('accountCode', '==', code).limit(2).get();
  if (snapshot.size > 1) {
    throw new Error(
      `SCM4_COA_DUPLICATE_CODE: tenant ${tenantId} has duplicate account code ${code}.`
    );
  }
  const doc = snapshot.docs[0];
  return doc
    ? { docId: doc.id, data: doc.data() as AccountShape }
    : null;
}

async function requireExistingAccount(params: {
  code: string;
  category: 'asset' | 'liability';
  normalBalance: 'debit' | 'credit';
}) {
  const existing = await findByCode(params.code);
  if (!existing) {
    throw new Error(
      `SCM4_COA_REQUIRED_ACCOUNT_MISSING: required account ${params.code} does not exist.`
    );
  }
  if (
    existing.data.category !== params.category ||
    existing.data.normalBalance !== params.normalBalance ||
    existing.data.isActive === false
  ) {
    throw new Error(
      `SCM4_COA_REQUIRED_ACCOUNT_INVALID: account ${params.code} must be an active ${params.category} with ${params.normalBalance} normal balance.`
    );
  }
  return existing;
}

const operatingTreasuryAccount = await requireExistingAccount({
  code: '1010',
  category: 'asset',
  normalBalance: 'debit',
});
const apAccount = await requireExistingAccount({
  code: '2010',
  category: 'liability',
  normalBalance: 'credit',
});
await requireExistingAccount({
  code: '1210',
  category: 'asset',
  normalBalance: 'debit',
});
await requireExistingAccount({
  code: '1220',
  category: 'asset',
  normalBalance: 'debit',
});

const currency = String(apAccount.data.currency || '').trim().toUpperCase();
if (!currency || currency.length !== 3) {
  throw new Error(
    'SCM4_COA_CURRENCY_INVALID: authoritative AP account must define a 3-letter currency.'
  );
}

if (
  String(operatingTreasuryAccount.data.currency || '').trim().toUpperCase() !==
  currency
) {
  throw new Error(
    'SCM4_COA_TREASURY_CURRENCY_MISMATCH: operating treasury and AP accounts must use the same currency.'
  );
}

const controls = [
  {
    code: '1230',
    accountName: 'Recoverable Input Tax',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    description: 'Input tax recoverable on governed supplier invoices',
  },
  {
    code: '1240',
    accountName: 'Freight-In Inventory',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    description: 'Capitalized inbound freight associated with inventory procurement',
  },
  {
    code: '2030',
    accountName: 'Goods Received Not Invoiced (GRNI)',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    description: 'Accepted inventory accrued before supplier invoice recognition',
  },
  {
    code: '6030',
    accountName: 'Purchase Price Variance',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    description: 'Controlled variance between accrued PO value and approved supplier invoice',
  },
] as const;

const created: string[] = [];
const verified: string[] = [];
const pendingCreates: Array<{
  docId: string;
  control: (typeof controls)[number];
}> = [];
const now = new Date().toISOString();

for (const control of controls) {
  const existing = await findByCode(control.code);
  if (existing) {
    if (
      existing.data.category !== control.category ||
      existing.data.normalBalance !== control.normalBalance ||
      existing.data.isActive === false
    ) {
      throw new Error(
        `SCM4_COA_CONTROL_ACCOUNT_INVALID: existing account ${control.code} conflicts with SCM-4 control-account semantics.`
      );
    }
    verified.push(control.code);
    continue;
  }

  const docId = `scm4-${control.code}`;
  const ref = accounts.doc(docId);
  const collision = await ref.get();
  if (
    collision.exists &&
    collision.data()?.accountCode !== control.code
  ) {
    throw new Error(
      `SCM4_COA_DOCUMENT_COLLISION: ${docId} already belongs to another account.`
    );
  }
  pendingCreates.push({ docId, control });
}

// All preconditions are now validated. Apply the capability update and every
// missing control account in one atomic batch so provisioning cannot half-apply.
const writeBatch = db.batch();
writeBatch.set(
  accounts.doc(operatingTreasuryAccount.docId),
  {
    allowSupplierPayments: true,
    updatedAt: now,
  },
  { merge: true }
);

for (const pending of pendingCreates) {
  const ref = accounts.doc(pending.docId);
  writeBatch.create(ref, {
    id: pending.docId,
    accountCode: pending.control.code,
    accountName: pending.control.accountName,
    category: pending.control.category,
    subCategory: pending.control.subCategory,
    normalBalance: pending.control.normalBalance,
    balance: 0,
    currency,
    description: pending.control.description,
    isActive: true,
    isSystemLocked: true,
    tenantId,
    createdAt: now,
    updatedAt: now,
  });
  created.push(pending.control.code);
}

await writeBatch.commit();

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtimeMode: mode,
      projectId: activeProject,
      tenantId,
      currency,
      requiredAccountsVerified: ['1010', '2010', '1210', '1220'],
      supplierPaymentSourceEnabled: '1010',
      controlAccountsCreated: created,
      controlAccountsAlreadyPresent: verified,
    },
    null,
    2
  ) + '\n'
);
