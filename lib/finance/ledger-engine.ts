import { db, cleanFirestoreData } from '@/lib/firebase/config';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ChartOfAccount,
  JournalLine,
  JournalVoucher,
  LedgerValidationResult,
  AccountType,
} from '@/types/erp-ledger';

// Standard Hospital Chart of Accounts Seed Catalog
export const DEFAULT_HOSPITAL_CHART_OF_ACCOUNTS: Omit<ChartOfAccount, 'tenantId'>[] = [
  // 1000 - ASSETS
  { accountCode: '1010', accountName: 'Operating Cash on Hand', category: 'asset', subCategory: 'Current Assets', balance: 145000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1020', accountName: 'Main Commercial Bank Account', category: 'asset', subCategory: 'Current Assets', balance: 890000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1100', accountName: 'Accounts Receivable - Patient Self-Pay', category: 'asset', subCategory: 'Receivables', balance: 64200.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1110', accountName: 'Accounts Receivable - Insurance Payers', category: 'asset', subCategory: 'Receivables', balance: 215400.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1200', accountName: 'Pharmacy Inventory Asset', category: 'asset', subCategory: 'Inventory', balance: 178500.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1210', accountName: 'Surgical Consumables & Implants Inventory', category: 'asset', subCategory: 'Inventory', balance: 142000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1220', accountName: 'General Hospital Consumables Inventory', category: 'asset', subCategory: 'Inventory', balance: 35600.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1500', accountName: 'Clinical & Diagnostic Medical Equipment', category: 'asset', subCategory: 'Fixed Assets', balance: 1250000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '1590', accountName: 'Accumulated Depreciation - Medical Equipment', category: 'asset', subCategory: 'Contra-Asset', balance: -245000.0, isActive: true, normalBalance: 'credit' },

  // 2000 - LIABILITIES
  { accountCode: '2010', accountName: 'Accounts Payable - Trade & SCM Vendors', category: 'liability', subCategory: 'Current Liabilities', balance: 184500.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '2020', accountName: 'Accrued Payroll & Physician Compensation', category: 'liability', subCategory: 'Payroll Liabilities', balance: 92000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '2030', accountName: 'Statutory Taxes & Withholding Payable', category: 'liability', subCategory: 'Current Liabilities', balance: 18400.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '2100', accountName: 'Unearned Patient Deposits & Pre-payments', category: 'liability', subCategory: 'Deferred Revenue', balance: 34000.0, isActive: true, normalBalance: 'credit' },

  // 3000 - EQUITY
  { accountCode: '3010', accountName: 'Contributed Capital / Hospital Foundation', category: 'equity', subCategory: 'Equity Capital', balance: 1500000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '3020', accountName: 'Retained Hospital Earnings', category: 'equity', subCategory: 'Retained Earnings', balance: 809200.0, isActive: true, normalBalance: 'credit' },

  // 4000 - REVENUE
  { accountCode: '4010', accountName: 'Inpatient Ward & Bed Accommodation Revenue', category: 'revenue', subCategory: 'Clinical Revenue', balance: 412000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '4020', accountName: 'Operating Room & Surgical Theater Revenue', category: 'revenue', subCategory: 'Clinical Revenue', balance: 388500.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '4030', accountName: 'Pharmacy Dispensing Revenue', category: 'revenue', subCategory: 'Ancillary Revenue', balance: 294000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '4040', accountName: 'Diagnostic Laboratory & Pathology Revenue', category: 'revenue', subCategory: 'Diagnostic Revenue', balance: 165000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '4050', accountName: 'Radiology & Imaging Revenue', category: 'revenue', subCategory: 'Diagnostic Revenue', balance: 198000.0, isActive: true, normalBalance: 'credit' },
  { accountCode: '4060', accountName: 'Emergency & Triage Consultation Revenue', category: 'revenue', subCategory: 'Clinical Revenue', balance: 112000.0, isActive: true, normalBalance: 'credit' },

  // 5000 - EXPENSES
  { accountCode: '5010', accountName: 'Clinical & Nursing Salaries Expense', category: 'expense', subCategory: 'Personnel Costs', balance: 340000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5020', accountName: 'Physician & Specialist Professional Fees', category: 'expense', subCategory: 'Personnel Costs', balance: 185000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5100', accountName: 'Cost of Goods Sold - Pharmaceutical Drugs', category: 'expense', subCategory: 'Direct Material Costs', balance: 142000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5110', accountName: 'Cost of Goods Sold - Surgical & Medical Supplies', category: 'expense', subCategory: 'Direct Material Costs', balance: 98000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5200', accountName: 'CSSD & Sterilization Processing Costs', category: 'expense', subCategory: 'Operating Costs', balance: 24500.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5300', accountName: 'Hospital Utilities, Power & Medical Gas', category: 'expense', subCategory: 'Facility Expenses', balance: 41200.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5400', accountName: 'Depreciation Expense - Clinical Equipment', category: 'expense', subCategory: 'Non-Cash Expenses', balance: 38000.0, isActive: true, normalBalance: 'debit' },
  { accountCode: '5500', accountName: 'Administrative & General Operating Expenses', category: 'expense', subCategory: 'General & Admin', balance: 52000.0, isActive: true, normalBalance: 'debit' },
];

/**
 * Validates a Double-Entry General Ledger journal entry with strict floating-point
 * 2-decimal precision integer-cent verification.
 */
export function validateJournalEntry(
  lines: JournalLine[],
  chartOfAccounts?: ChartOfAccount[]
): LedgerValidationResult {
  if (!lines || !Array.isArray(lines) || lines.length < 2) {
    return {
      isValid: false,
      totalDebits: 0,
      totalCredits: 0,
      imbalanceAmount: 0,
      error: 'A valid journal entry must contain at least 2 line items.',
    };
  }

  let sumDebitCents = 0;
  let sumCreditCents = 0;

  const coaMap = chartOfAccounts
    ? new Map<string, ChartOfAccount>(chartOfAccounts.map((a) => [a.accountCode, a]))
    : null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineIndex = i + 1;

    if (!line.accountCode || typeof line.accountCode !== 'string' || line.accountCode.trim() === '') {
      return {
        isValid: false,
        totalDebits: sumDebitCents / 100,
        totalCredits: sumCreditCents / 100,
        imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
        error: `Line ${lineIndex}: Missing or invalid Account Code.`,
      };
    }

    // Check account validity against active Chart of Accounts if provided
    if (coaMap) {
      const coaAccount = coaMap.get(line.accountCode.trim());
      if (!coaAccount) {
        return {
          isValid: false,
          totalDebits: sumDebitCents / 100,
          totalCredits: sumCreditCents / 100,
          imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
          error: `Line ${lineIndex}: Account Code '${line.accountCode}' does not exist in Chart of Accounts.`,
        };
      }
      if (!coaAccount.isActive) {
        return {
          isValid: false,
          totalDebits: sumDebitCents / 100,
          totalCredits: sumCreditCents / 100,
          imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
          error: `Line ${lineIndex}: Account '${line.accountCode} - ${coaAccount.accountName}' is marked inactive.`,
        };
      }
    }

    const debitVal = Number(line.debit) || 0;
    const creditVal = Number(line.credit) || 0;

    if (debitVal < 0 || creditVal < 0) {
      return {
        isValid: false,
        totalDebits: sumDebitCents / 100,
        totalCredits: sumCreditCents / 100,
        imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
        error: `Line ${lineIndex}: Debits and Credits cannot be negative numbers.`,
      };
    }

    if (debitVal > 0 && creditVal > 0) {
      return {
        isValid: false,
        totalDebits: sumDebitCents / 100,
        totalCredits: sumCreditCents / 100,
        imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
        error: `Line ${lineIndex}: Line cannot have both a Debit AND a Credit amount simultaneously.`,
      };
    }

    if (debitVal === 0 && creditVal === 0) {
      return {
        isValid: false,
        totalDebits: sumDebitCents / 100,
        totalCredits: sumCreditCents / 100,
        imbalanceAmount: Math.abs(sumDebitCents - sumCreditCents) / 100,
        error: `Line ${lineIndex}: Line must contain either a non-zero Debit or Credit amount.`,
      };
    }

    const lineDebitCents = Math.round(debitVal * 100);
    const lineCreditCents = Math.round(creditVal * 100);

    sumDebitCents += lineDebitCents;
    sumCreditCents += lineCreditCents;
  }

  const totalDebits = sumDebitCents / 100;
  const totalCredits = sumCreditCents / 100;
  const imbalanceCents = Math.abs(sumDebitCents - sumCreditCents);
  const imbalanceAmount = imbalanceCents / 100;

  if (totalDebits <= 0 || totalCredits <= 0) {
    return {
      isValid: false,
      totalDebits,
      totalCredits,
      imbalanceAmount,
      error: 'A balanced voucher must contain both positive debits and positive credits.',
    };
  }

  if (imbalanceCents !== 0) {
    return {
      isValid: false,
      totalDebits,
      totalCredits,
      imbalanceAmount,
      error: `Double-entry imbalance detected: Total Debits ($${totalDebits.toFixed(2)}) does not equal Total Credits ($${totalCredits.toFixed(2)}). Difference: $${imbalanceAmount.toFixed(2)}.`,
    };
  }

  return {
    isValid: true,
    totalDebits,
    totalCredits,
    imbalanceAmount: 0,
  };
}

/**
 * Calculates new account balance based on account type and normal debit/credit rules.
 */
export function calculateNewAccountBalance(
  category: AccountType,
  currentBalance: number,
  debit: number,
  credit: number
): number {
  const currentCents = Math.round(currentBalance * 100);
  const debitCents = Math.round(debit * 100);
  const creditCents = Math.round(credit * 100);

  let newCents: number;

  switch (category) {
    case 'asset':
    case 'expense':
      // Normal Debit: Increases on debit, decreases on credit
      newCents = currentCents + debitCents - creditCents;
      break;
    case 'liability':
    case 'equity':
    case 'revenue':
      // Normal Credit: Increases on credit, decreases on debit
      newCents = currentCents + creditCents - debitCents;
      break;
    default:
      newCents = currentCents + debitCents - creditCents;
      break;
  }

  return newCents / 100;
}

/**
 * Atomically posts a Journal Voucher transaction in Firestore and updates
 * the account balance aggregates in the Chart of Accounts.
 */
export async function postVoucherTransaction(
  tenantId: string,
  voucherData: Omit<JournalVoucher, 'id' | 'postedAt' | 'status' | 'postedBy'> & { postedBy?: string },
  userId: string
): Promise<string> {
  const validation = validateJournalEntry(voucherData.lines);
  if (!validation.isValid) {
    throw new Error(`Cannot post unbalanced voucher: ${validation.error}`);
  }

  const now = Date.now();
  const voucherId = `jv_${now}_${Math.random().toString(36).substring(2, 8)}`;
  const voucherNumber =
    voucherData.voucherNumber ||
    `JV-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  // Execute Firestore runTransaction for ACID atomicity
  await runTransaction(db, async (transaction) => {
    // 1. Read all relevant Chart of Accounts documents
    const accountUpdates: Array<{
      accountRef: any;
      accountCode: string;
      accountName: string;
      category: AccountType;
      oldBalance: number;
      newBalance: number;
    }> = [];

    for (const line of voucherData.lines) {
      const accountRef = doc(db, 'tenants', tenantId, 'chart_of_accounts', line.accountCode);
      const accountSnap = await transaction.get(accountRef);

      let category: AccountType = 'asset';
      let currentBalance = 0;
      let accountName = line.accountName;

      if (accountSnap.exists()) {
        const data = accountSnap.data() as ChartOfAccount;
        category = data.category || 'asset';
        currentBalance = data.balance || 0;
        accountName = data.accountName || line.accountName;
      } else {
        // If not found in primary path, determine category by code convention
        const firstDigit = line.accountCode.charAt(0);
        if (firstDigit === '1') category = 'asset';
        else if (firstDigit === '2') category = 'liability';
        else if (firstDigit === '3') category = 'equity';
        else if (firstDigit === '4') category = 'revenue';
        else if (firstDigit === '5') category = 'expense';
      }

      const newBalance = calculateNewAccountBalance(
        category,
        currentBalance,
        line.debit || 0,
        line.credit || 0
      );

      accountUpdates.push({
        accountRef,
        accountCode: line.accountCode,
        accountName,
        category,
        oldBalance: currentBalance,
        newBalance,
      });
    }

    // 2. Perform updates
    for (const update of accountUpdates) {
      transaction.set(
        update.accountRef,
        cleanFirestoreData({
          accountCode: update.accountCode,
          accountName: update.accountName,
          category: update.category,
          balance: update.newBalance,
          tenantId,
          isActive: true,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    }

    // 3. Write the Journal Voucher document
    const voucherRef = doc(db, 'tenants', tenantId, 'journal_entries', voucherId);
    const voucherDoc: JournalVoucher = {
      ...voucherData,
      id: voucherId,
      tenantId,
      voucherNumber,
      totalDebits: validation.totalDebits,
      totalCredits: validation.totalCredits,
      status: 'posted',
      postedBy: userId,
      postedAt: now,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    transaction.set(voucherRef, cleanFirestoreData(voucherDoc));
  });

  return voucherId;
}

/**
 * Reverses an existing posted voucher by creating an inverse journal voucher
 * and atomically updating the Chart of Accounts ledger balances.
 */
export async function reverseVoucherTransaction(
  tenantId: string,
  voucherId: string,
  userId: string,
  reason: string = 'Reversal requested by controller'
): Promise<string> {
  const originalVoucherRef = doc(db, 'tenants', tenantId, 'journal_entries', voucherId);

  let reversalVoucherId = '';

  await runTransaction(db, async (transaction) => {
    const originalSnap = await transaction.get(originalVoucherRef);
    if (!originalSnap.exists()) {
      throw new Error(`Voucher ${voucherId} does not exist.`);
    }

    const originalData = originalSnap.data() as JournalVoucher;
    if (originalData.status === 'reversed') {
      throw new Error(`Voucher ${originalData.voucherNumber} has already been reversed.`);
    }

    const now = Date.now();
    reversalVoucherId = `jv_rev_${now}_${Math.random().toString(36).substring(2, 8)}`;
    const reversalVoucherNumber = `REV-${originalData.voucherNumber}`;

    // Create inverted lines: swap debits and credits
    const invertedLines: JournalLine[] = originalData.lines.map((l) => ({
      ...l,
      description: `[REVERSAL of ${originalData.voucherNumber}] ${l.description || ''}`,
      debit: l.credit,
      credit: l.debit,
    }));

    // Update account balances
    for (const line of invertedLines) {
      const accountRef = doc(db, 'tenants', tenantId, 'chart_of_accounts', line.accountCode);
      const accountSnap = await transaction.get(accountRef);

      let category: AccountType = 'asset';
      let currentBalance = 0;
      let accountName = line.accountName;

      if (accountSnap.exists()) {
        const data = accountSnap.data() as ChartOfAccount;
        category = data.category || 'asset';
        currentBalance = data.balance || 0;
        accountName = data.accountName || line.accountName;
      }

      const newBalance = calculateNewAccountBalance(
        category,
        currentBalance,
        line.debit,
        line.credit
      );

      transaction.set(
        accountRef,
        cleanFirestoreData({
          accountCode: line.accountCode,
          accountName,
          category,
          balance: newBalance,
          tenantId,
          isActive: true,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    }

    // Mark original voucher as reversed
    transaction.update(originalVoucherRef, {
      status: 'reversed',
      reversedAt: now,
      reversedBy: userId,
      reversalReason: reason,
      reversalVoucherId,
      updatedAt: new Date().toISOString(),
    });

    // Write the new reversal voucher document
    const reversalDocRef = doc(db, 'tenants', tenantId, 'journal_entries', reversalVoucherId);
    const reversalDoc: JournalVoucher = {
      id: reversalVoucherId,
      tenantId,
      voucherNumber: reversalVoucherNumber,
      postingDate: new Date().toISOString().split('T')[0],
      description: `Reversal of Voucher ${originalData.voucherNumber}: ${reason}`,
      lines: invertedLines,
      totalDebits: originalData.totalCredits,
      totalCredits: originalData.totalDebits,
      status: 'posted',
      postedBy: userId,
      postedAt: now,
      sourceModule: originalData.sourceModule || 'manual',
      referenceNumber: originalData.voucherNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    transaction.set(reversalDocRef, cleanFirestoreData(reversalDoc));
  });

  return reversalVoucherId;
}

/**
 * Initializes or fetches the Chart of Accounts for a given tenant.
 */
export async function getOrSeedChartOfAccounts(tenantId: string): Promise<ChartOfAccount[]> {
  try {
    const q = query(
      collection(db, 'tenants', tenantId, 'chart_of_accounts'),
      orderBy('accountCode', 'asc')
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      return snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as ChartOfAccount[];
    }

    // If empty, seed the standard hospital chart of accounts
    const seededList: ChartOfAccount[] = [];
    for (const item of DEFAULT_HOSPITAL_CHART_OF_ACCOUNTS) {
      const accRef = doc(db, 'tenants', tenantId, 'chart_of_accounts', item.accountCode);
      const accData: ChartOfAccount = {
        ...item,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await runTransaction(db, async (t) => {
        t.set(accRef, cleanFirestoreData(accData));
      });
      seededList.push({ id: item.accountCode, ...accData });
    }
    return seededList;
  } catch (err) {
    console.warn('Error reading chart_of_accounts, using fallback in-memory seed:', err);
    return DEFAULT_HOSPITAL_CHART_OF_ACCOUNTS.map((a) => ({
      ...a,
      tenantId,
      id: a.accountCode,
    }));
  }
}
