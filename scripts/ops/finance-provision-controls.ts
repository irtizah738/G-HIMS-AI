import { getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';

const tenantId = String(process.env.GHIMS_FINANCE_PROVISION_TENANT || '')
  .trim()
  .toLowerCase();
const fiscalYear = Number(process.env.GHIMS_FINANCE_PROVISION_FISCAL_YEAR || '');
const confirmedProject = String(
  process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT || ''
).trim();
const activeProject = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();

if (process.env.GHIMS_ALLOW_FINANCE_PROVISION !== 'true') {
  throw new Error(
    'FINANCE_PROVISION_DISABLED: GHIMS_ALLOW_FINANCE_PROVISION=true is required.'
  );
}
if (!tenantId) {
  throw new Error(
    'FINANCE_PROVISION_TENANT_REQUIRED: GHIMS_FINANCE_PROVISION_TENANT is required.'
  );
}
if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200) {
  throw new Error(
    'FINANCE_PROVISION_FISCAL_YEAR_REQUIRED: GHIMS_FINANCE_PROVISION_FISCAL_YEAR must be a valid year.'
  );
}
if (!activeProject || confirmedProject !== activeProject) {
  throw new Error('FINANCE_PROVISION_PROJECT_CONFIRMATION_MISMATCH');
}

const mode = getRuntimeMode();
if (
  mode === 'PRODUCTION' &&
  process.env.GHIMS_ALLOW_PRODUCTION_FINANCE_PROVISION !== 'true'
) {
  throw new Error(
    'FINANCE_PROVISION_PRODUCTION_CONFIRMATION_REQUIRED: explicit production override is required.'
  );
}

const db = getAdminFirestore();
if (!db) throw new Error('FINANCE_PROVISION_FIREBASE_ADMIN_UNAVAILABLE');

type AccountShape = {
  id?: string;
  accountId?: string;
  accountCode?: string;
  accountName?: string;
  category?: string;
  subCategory?: string;
  normalBalance?: string;
  currency?: string;
  isActive?: boolean;
  isSystemLocked?: boolean;
  allowSupplierPayments?: boolean;
  allowCashReceipts?: boolean;
  allowManualPosting?: boolean;
};

const accounts = db.collection('tenants').doc(tenantId).collection('accounts');
const periods = db
  .collection('tenants')
  .doc(tenantId)
  .collection('accountingPeriods');

async function findByCode(code: string) {
  const snapshot = await accounts.where('accountCode', '==', code).limit(2).get();
  if (snapshot.size > 1) {
    throw new Error(
      `FINANCE_COA_DUPLICATE_CODE: tenant ${tenantId} has duplicate account code ${code}.`
    );
  }
  const doc = snapshot.docs[0];
  return doc
    ? { docId: doc.id, data: doc.data() as AccountShape }
    : null;
}

async function requireCore(code: string, category: string, normalBalance: string) {
  const row = await findByCode(code);
  if (!row) {
    throw new Error(
      `FINANCE_COA_CORE_ACCOUNT_MISSING: required account ${code} does not exist.`
    );
  }
  if (
    row.data.category !== category ||
    row.data.normalBalance !== normalBalance ||
    row.data.isActive === false
  ) {
    throw new Error(
      `FINANCE_COA_CORE_ACCOUNT_INVALID: ${code} must be active ${category}/${normalBalance}.`
    );
  }
  return row;
}

const cash = await requireCore('1010', 'asset', 'debit');
const ar = await requireCore('1110', 'asset', 'debit');
const ap = await requireCore('2010', 'liability', 'credit');
await requireCore('1210', 'asset', 'debit');
await requireCore('1220', 'asset', 'debit');
await requireCore('2030', 'liability', 'credit');

const currency = String(ap.data.currency || '').trim().toUpperCase();
if (currency.length !== 3) throw new Error('FINANCE_COA_CURRENCY_INVALID');
for (const row of [cash, ar]) {
  if (String(row.data.currency || '').trim().toUpperCase() !== currency) {
    throw new Error('FINANCE_COA_CORE_CURRENCY_MISMATCH');
  }
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
    code: '1250',
    accountName: 'Supplier Returns & Credit Receivable',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    description: 'Supplier credits receivable after governed returns',
  },
  {
    code: '1595',
    accountName: 'Capital Expenditure Clearing',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'debit',
    description: 'Governed clearing before fixed-asset capitalization',
  },
  {
    code: '2040',
    accountName: 'Output Tax Payable',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    description: 'Output tax collected on patient and payer invoices',
  },
  {
    code: '2050',
    accountName: 'Withholding Tax Payable',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    description: 'Supplier withholding tax payable to statutory authority',
  },
  {
    code: '4090',
    accountName: 'Patient Revenue Adjustments & Contractual Allowances',
    category: 'revenue',
    subCategory: 'Contra Revenue',
    normalBalance: 'debit',
    description: 'Approved credit notes and contractual revenue reductions',
  },
  {
    code: '4210',
    accountName: 'Gain on Disposal of Fixed Assets',
    category: 'revenue',
    subCategory: 'Other Operating Revenue',
    normalBalance: 'credit',
    description: 'Governed gain on fixed-asset disposal',
  },
  {
    code: '6030',
    accountName: 'Purchase Price Variance',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    description: 'Approved purchase-price variance',
  },
  {
    code: '6040',
    accountName: 'Inventory Shrinkage, Count Variance & Write-Off Expense',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    description: 'Inventory count variance and write-off expense',
  },
  {
    code: '6410',
    accountName: 'Bad Debt & Accounts Receivable Write-Off Expense',
    category: 'expense',
    subCategory: 'Revenue Cycle Expense',
    normalBalance: 'debit',
    description: 'Governed patient and payer receivable write-offs',
  },
  {
    code: '6430',
    accountName: 'Loss on Disposal of Fixed Assets',
    category: 'expense',
    subCategory: 'Other Operating Expense',
    normalBalance: 'debit',
    description: 'Governed loss on fixed-asset disposal',
  },
] as const;

const createdAccounts: string[] = [];
const normalizedAccounts: string[] = [];
const now = new Date().toISOString();
const batch = db.batch();

const coreRows = [
  { row: cash, allowCashReceipts: true, allowSupplierPayments: true },
  { row: ar, allowCashReceipts: false, allowSupplierPayments: false },
  { row: ap, allowCashReceipts: false, allowSupplierPayments: false },
];

for (const entry of coreRows) {
  batch.set(
    accounts.doc(entry.row.docId),
    {
      id: entry.row.docId,
      accountId: entry.row.docId,
      allowCashReceipts: entry.allowCashReceipts,
      allowSupplierPayments: entry.allowSupplierPayments,
      allowManualPosting: false,
      updatedAt: now,
    },
    { merge: true }
  );
  normalizedAccounts.push(String(entry.row.data.accountCode || ''));
}

for (const code of ['1210', '1220', '2030']) {
  const row = await findByCode(code);
  if (!row) throw new Error(`FINANCE_COA_CORE_ACCOUNT_MISSING:${code}`);
  batch.set(
    accounts.doc(row.docId),
    {
      id: row.docId,
      accountId: row.docId,
      allowManualPosting: false,
      updatedAt: now,
    },
    { merge: true }
  );
  normalizedAccounts.push(code);
}

for (const control of controls) {
  const existing = await findByCode(control.code);
  if (existing) {
    if (
      existing.data.category !== control.category ||
      existing.data.normalBalance !== control.normalBalance ||
      existing.data.isActive === false ||
      String(existing.data.currency || '').trim().toUpperCase() !== currency
    ) {
      throw new Error(
        `FINANCE_COA_CONTROL_CONFLICT:${control.code}`
      );
    }
    batch.set(
      accounts.doc(existing.docId),
      {
        id: existing.docId,
        accountId: existing.docId,
        isSystemLocked: true,
        allowManualPosting: false,
        updatedAt: now,
      },
      { merge: true }
    );
    normalizedAccounts.push(control.code);
    continue;
  }

  const docId = `fin-${control.code}`;
  const ref = accounts.doc(docId);
  const collision = await ref.get();
  if (collision.exists) {
    throw new Error(`FINANCE_COA_DOCUMENT_COLLISION:${docId}`);
  }
  batch.create(ref, {
    id: docId,
    accountId: docId,
    accountCode: control.code,
    accountName: control.accountName,
    category: control.category,
    subCategory: control.subCategory,
    normalBalance: control.normalBalance,
    balance: 0,
    currency,
    description: control.description,
    isActive: true,
    isSystemLocked: true,
    allowManualPosting: false,
    allowSupplierPayments: false,
    allowCashReceipts: false,
    tenantId,
    createdAt: now,
    updatedAt: now,
  });
  createdAccounts.push(control.code);
}

const periodCreates: string[] = [];
for (let postingPeriod = 1; postingPeriod <= 12; postingPeriod += 1) {
  const key = `${fiscalYear}-${String(postingPeriod).padStart(2, '0')}`;
  const periodId = `fin_period_${key}`;
  const ref = periods.doc(periodId);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data();
    if (
      Number(data?.fiscalYear) !== fiscalYear ||
      Number(data?.postingPeriod) !== postingPeriod
    ) {
      throw new Error(`FINANCE_PERIOD_DOCUMENT_CONFLICT:${periodId}`);
    }
    continue;
  }
  const startAt = Date.UTC(fiscalYear, postingPeriod - 1, 1, 0, 0, 0, 0);
  const endAt = Date.UTC(fiscalYear, postingPeriod, 0, 23, 59, 59, 999);
  batch.create(ref, {
    periodId,
    tenantId,
    fiscalYear,
    postingPeriod,
    periodKey: key,
    periodName: new Date(startAt).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    startAt,
    endAt,
    status: 'OPEN',
    createdAt: now,
    createdBy: 'FINANCE_PROVISIONER',
  });
  periodCreates.push(periodId);
}

await batch.commit();

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtimeMode: mode,
      projectId: activeProject,
      tenantId,
      fiscalYear,
      currency,
      normalizedAccounts: [...new Set(normalizedAccounts)].sort(),
      createdAccounts,
      createdPeriods: periodCreates,
    },
    null,
    2
  ) + '\n'
);
