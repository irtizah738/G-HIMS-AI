import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  runTransaction,
  writeBatch,
  where,
  orderBy,
} from 'firebase/firestore';
import { db, cleanFirestoreData } from '../config';
import { handleFirestoreError, OperationType } from '../errors';
import {
  Account,
  JournalEntry,
  JournalLine,
  VendorInvoice,
  APPaymentRecord,
  FixedAsset,
  DepreciationRunLog,
} from '@/types/erp-finance';
import {
  validateJournalEntry,
  calculateMonthlyDepreciation,
  DEFAULT_HOSPITAL_COA,
} from '@/lib/finance/double-entry';

// ============================================================================
// 1. CHART OF ACCOUNTS SERVICE
// ============================================================================

export async function getChartOfAccounts(tenantId: string): Promise<Account[]> {
  const path = `tenants/${tenantId}/accounts`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'accounts'), orderBy('accountCode', 'asc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      await seedInitialChartOfAccounts(tenantId);
      const seeded = await getDocs(q);
      return seeded.docs.map((d) => d.data() as Account);
    }
    return snapshot.docs.map((d) => d.data() as Account);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToAccounts(
  tenantId: string,
  onUpdate: (accounts: Account[]) => void,
  onError?: (err: Error) => void
) {
  const path = `tenants/${tenantId}/accounts`;
  const q = query(collection(db, 'tenants', tenantId, 'accounts'), orderBy('accountCode', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        seedInitialChartOfAccounts(tenantId).catch(console.error);
      }
      const accounts = snapshot.docs.map((d) => d.data() as Account);
      onUpdate(accounts);
    },
    (error) => {
      console.error('Accounts subscription error:', error);
      if (onError) onError(error);
    }
  );
}

export async function createAccount(
  tenantId: string,
  accountData: Omit<Account, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
): Promise<Account> {
  const path = `tenants/${tenantId}/accounts`;
  try {
    const accountRef = doc(collection(db, 'tenants', tenantId, 'accounts'));
    const now = new Date().toISOString();
    const newAccount: Account = {
      ...accountData,
      id: accountRef.id,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(accountRef, cleanFirestoreData(newAccount));
    return newAccount;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAccount(
  tenantId: string,
  accountId: string,
  updates: Partial<Account>
): Promise<void> {
  const path = `tenants/${tenantId}/accounts/${accountId}`;
  try {
    const accountRef = doc(db, 'tenants', tenantId, 'accounts', accountId);
    await updateDoc(accountRef, cleanFirestoreData({
      ...updates,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function seedInitialChartOfAccounts(tenantId: string): Promise<void> {
  const path = `tenants/${tenantId}/accounts`;
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    for (const item of DEFAULT_HOSPITAL_COA) {
      const accountRef = doc(collection(db, 'tenants', tenantId, 'accounts'));
      const account: Account = {
        ...item,
        id: accountRef.id,
        tenantId,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(accountRef, account);
    }

    // Also seed default fixed assets if empty
    await batch.commit();
    await seedInitialFixedAssets(tenantId);
    await seedInitialJournalEntries(tenantId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 2. JOURNAL ENTRIES & DOUBLE-ENTRY POSTING ENGINE
// ============================================================================

export async function getJournalEntries(tenantId: string): Promise<JournalEntry[]> {
  const path = `tenants/${tenantId}/journalEntries`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'journalEntries'), orderBy('postingDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as JournalEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToJournalEntries(
  tenantId: string,
  onUpdate: (entries: JournalEntry[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'journalEntries'), orderBy('postingDate', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const entries = snapshot.docs.map((d) => d.data() as JournalEntry);
      onUpdate(entries);
    },
    (error) => {
      console.error('Journal entries subscription error:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Posts a double-entry journal entry atomically.
 * Updates all ledger accounts directly inside a Firestore transaction.
 */
export async function postJournalEntry(
  tenantId: string,
  entryData: {
    postingDate: string;
    referenceNumber: string;
    description: string;
    sourceModule: JournalEntry['sourceModule'];
    lines: JournalLine[];
    postedBy: string;
  }
): Promise<JournalEntry> {
  const path = `tenants/${tenantId}/journalEntries`;

  const validation = validateJournalEntry(entryData.lines);
  if (!validation.isValid) {
    throw new Error(`Double-entry validation failed: ${validation.errors.join('; ')}`);
  }

  try {
    const entryRef = doc(collection(db, 'tenants', tenantId, 'journalEntries'));
    const now = new Date().toISOString();
    const entryNumber = `JE-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const journalEntry: JournalEntry = {
      id: entryRef.id,
      entryNumber,
      postingDate: entryData.postingDate,
      referenceNumber: entryData.referenceNumber,
      description: entryData.description,
      sourceModule: entryData.sourceModule,
      lines: entryData.lines,
      totalDebits: validation.totalDebits,
      totalCredits: validation.totalCredits,
      status: 'posted',
      postedBy: entryData.postedBy,
      postedAt: now,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    await runTransaction(db, async (transaction) => {
      // 1. Fetch all accounts by code
      const accountsQuery = query(collection(db, 'tenants', tenantId, 'accounts'));
      const accountsSnapshot = await getDocs(accountsQuery);
      const accountsMap = new Map<string, { docId: string; account: Account }>();

      accountsSnapshot.docs.forEach((docSnap) => {
        const acc = docSnap.data() as Account;
        accountsMap.set(acc.accountCode, { docId: docSnap.id, account: acc });
      });

      // 2. Validate all accounts exist
      for (const line of entryData.lines) {
        if (!accountsMap.has(line.accountCode)) {
          throw new Error(`GL Account code "${line.accountCode}" does not exist in Chart of Accounts.`);
        }
      }

      // 3. Compute balance adjustments
      for (const line of entryData.lines) {
        const accountEntry = accountsMap.get(line.accountCode)!;
        const currentBalance = Number(accountEntry.account.balance) || 0;
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;

        let delta = 0;
        if (accountEntry.account.normalBalance === 'debit') {
          // Assets and Expenses increase with debit, decrease with credit
          delta = debit - credit;
        } else {
          // Liabilities, Equity, Revenue increase with credit, decrease with debit
          delta = credit - debit;
        }

        const newBalance = Math.round((currentBalance + delta) * 100) / 100;
        const targetRef = doc(db, 'tenants', tenantId, 'accounts', accountEntry.docId);

        transaction.update(targetRef, {
          balance: newBalance,
          updatedAt: now,
        });

        // Update local object for potential duplicate accounts in multi-line entry
        accountEntry.account.balance = newBalance;
      }

      // 4. Save journal entry
      transaction.set(entryRef, journalEntry);
    });

    return journalEntry;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 3. VENDOR INVOICES & ACCOUNTS PAYABLE
// ============================================================================

export async function getVendorInvoices(tenantId: string): Promise<VendorInvoice[]> {
  const path = `tenants/${tenantId}/vendorInvoices`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'vendorInvoices'), orderBy('issueDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as VendorInvoice);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToVendorInvoices(
  tenantId: string,
  onUpdate: (invoices: VendorInvoice[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'vendorInvoices'), orderBy('issueDate', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const invoices = snapshot.docs.map((d) => d.data() as VendorInvoice);
      onUpdate(invoices);
    },
    (error) => {
      console.error('Vendor invoices subscription error:', error);
      if (onError) onError(error);
    }
  );
}

export async function createVendorInvoice(
  tenantId: string,
  invoiceData: Omit<VendorInvoice, 'id' | 'internalRef' | 'amountPaid' | 'remainingBalance' | 'payments' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  postedBy: string
): Promise<VendorInvoice> {
  const path = `tenants/${tenantId}/vendorInvoices`;
  try {
    const invRef = doc(collection(db, 'tenants', tenantId, 'vendorInvoices'));
    const now = new Date().toISOString();
    const internalRef = `AP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newInvoice: VendorInvoice = {
      ...invoiceData,
      id: invRef.id,
      internalRef,
      amountPaid: 0,
      remainingBalance: invoiceData.totalAmount,
      payments: [],
      tenantId,
      createdAt: now,
      updatedAt: now,
    };

    // Auto-create GL Journal Entry for AP Recognition:
    // Debits: Expense accounts from lines
    // Credit: 2010 Accounts Payable for total amount
    const journalLines: JournalLine[] = invoiceData.lines.map((line) => ({
      id: doc(collection(db, 'temp')).id,
      accountCode: line.expenseAccountCode,
      accountName: line.expenseAccountName,
      description: `AP Inv ${invoiceData.invoiceNumber} - ${line.description}`,
      debit: line.amount,
      credit: 0,
    }));

    if (invoiceData.taxAmount > 0) {
      journalLines.push({
        id: doc(collection(db, 'temp')).id,
        accountCode: '6020',
        accountName: 'Medical Consumables & Surgical Implants Used',
        description: `Sales Tax - AP Inv ${invoiceData.invoiceNumber}`,
        debit: invoiceData.taxAmount,
        credit: 0,
      });
    }

    journalLines.push({
      id: doc(collection(db, 'temp')).id,
      accountCode: invoiceData.apAccountCode || '2010',
      accountName: 'Accounts Payable - Medical & Trade Vendors',
      description: `Vendor Liability - ${invoiceData.vendorName} (${invoiceData.invoiceNumber})`,
      debit: 0,
      credit: invoiceData.totalAmount,
    });

    const je = await postJournalEntry(tenantId, {
      postingDate: invoiceData.issueDate,
      referenceNumber: internalRef,
      description: `AP Recognition: ${invoiceData.vendorName} Inv #${invoiceData.invoiceNumber}`,
      sourceModule: 'ap_invoice',
      lines: journalLines,
      postedBy,
    });

    newInvoice.journalEntryId = je.id;
    await setDoc(invRef, cleanFirestoreData(newInvoice));
    return newInvoice;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordAPPayment(
  tenantId: string,
  invoiceId: string,
  paymentData: {
    paymentDate: string;
    amount: number;
    paymentMethod: APPaymentRecord['paymentMethod'];
    paidFromAccountCode: string;
    paidFromAccountName: string;
    referenceNumber: string;
    notes?: string;
    recordedBy: string;
  }
): Promise<void> {
  const path = `tenants/${tenantId}/vendorInvoices/${invoiceId}`;
  try {
    const invRef = doc(db, 'tenants', tenantId, 'vendorInvoices', invoiceId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) {
      throw new Error('Vendor invoice not found');
    }
    const invoice = invSnap.data() as VendorInvoice;

    const paymentAmount = Number(paymentData.amount) || 0;
    if (paymentAmount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }
    if (paymentAmount > invoice.remainingBalance + 0.01) {
      throw new Error(`Payment amount ($${paymentAmount}) exceeds outstanding balance ($${invoice.remainingBalance}).`);
    }

    const now = new Date().toISOString();
    const paymentNumber = `PAY-${Math.floor(10000 + Math.random() * 90000)}`;

    // Post GL Journal Entry for AP Settlement:
    // Debit: 2010 Accounts Payable
    // Credit: 1010 Operating Cash (or chosen bank account)
    const journalLines: JournalLine[] = [
      {
        id: doc(collection(db, 'temp')).id,
        accountCode: invoice.apAccountCode || '2010',
        accountName: 'Accounts Payable - Medical & Trade Vendors',
        description: `AP Settlement - ${invoice.vendorName} (Inv #${invoice.invoiceNumber})`,
        debit: paymentAmount,
        credit: 0,
      },
      {
        id: doc(collection(db, 'temp')).id,
        accountCode: paymentData.paidFromAccountCode,
        accountName: paymentData.paidFromAccountName,
        description: `Disbursement ref: ${paymentData.referenceNumber}`,
        debit: 0,
        credit: paymentAmount,
      },
    ];

    const je = await postJournalEntry(tenantId, {
      postingDate: paymentData.paymentDate,
      referenceNumber: paymentNumber,
      description: `AP Payment to ${invoice.vendorName} (${paymentData.paymentMethod.toUpperCase()})`,
      sourceModule: 'ap_payment',
      lines: journalLines,
      postedBy: paymentData.recordedBy,
    });

    const newPaymentRecord: APPaymentRecord = {
      id: doc(collection(db, 'temp')).id,
      paymentNumber,
      paymentDate: paymentData.paymentDate,
      amount: paymentAmount,
      paymentMethod: paymentData.paymentMethod,
      paidFromAccountCode: paymentData.paidFromAccountCode,
      paidFromAccountName: paymentData.paidFromAccountName,
      referenceNumber: paymentData.referenceNumber,
      notes: paymentData.notes,
      journalEntryId: je.id,
      recordedBy: paymentData.recordedBy,
      recordedAt: now,
    };

    const newAmountPaid = Math.round((invoice.amountPaid + paymentAmount) * 100) / 100;
    const newRemaining = Math.max(0, Math.round((invoice.totalAmount - newAmountPaid) * 100) / 100);
    const newStatus = newRemaining <= 0.01 ? 'paid' : 'partially_paid';

    await updateDoc(invRef, cleanFirestoreData({
      amountPaid: newAmountPaid,
      remainingBalance: newRemaining,
      status: newStatus,
      payments: [...invoice.payments, newPaymentRecord],
      updatedAt: now,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 4. FIXED ASSETS & DEPRECIATION SERVICE
// ============================================================================

export async function getFixedAssets(tenantId: string): Promise<FixedAsset[]> {
  const path = `tenants/${tenantId}/fixedAssets`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'fixedAssets'), orderBy('assetTag', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as FixedAsset);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeToFixedAssets(
  tenantId: string,
  onUpdate: (assets: FixedAsset[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(collection(db, 'tenants', tenantId, 'fixedAssets'), orderBy('assetTag', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const assets = snapshot.docs.map((d) => d.data() as FixedAsset);
      onUpdate(assets);
    },
    (error) => {
      console.error('Fixed assets subscription error:', error);
      if (onError) onError(error);
    }
  );
}

export async function createFixedAsset(
  tenantId: string,
  assetData: Omit<FixedAsset, 'id' | 'accumulatedDepreciation' | 'currentBookValue' | 'tenantId' | 'createdAt' | 'updatedAt'>
): Promise<FixedAsset> {
  const path = `tenants/${tenantId}/fixedAssets`;
  try {
    const assetRef = doc(collection(db, 'tenants', tenantId, 'fixedAssets'));
    const now = new Date().toISOString();
    const newAsset: FixedAsset = {
      ...assetData,
      id: assetRef.id,
      accumulatedDepreciation: 0,
      currentBookValue: assetData.acquisitionCost,
      tenantId,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(assetRef, cleanFirestoreData(newAsset));
    return newAsset;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateFixedAsset(
  tenantId: string,
  assetId: string,
  updates: Partial<FixedAsset>
): Promise<void> {
  const path = `tenants/${tenantId}/fixedAssets/${assetId}`;
  try {
    const assetRef = doc(db, 'tenants', tenantId, 'fixedAssets', assetId);
    await updateDoc(assetRef, cleanFirestoreData({
      ...updates,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getDepreciationRuns(tenantId: string): Promise<DepreciationRunLog[]> {
  const path = `tenants/${tenantId}/depreciationRuns`;
  try {
    const q = query(collection(db, 'tenants', tenantId, 'depreciationRuns'), orderBy('runDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as DepreciationRunLog);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Runs monthly depreciation batch:
 * Calculates depreciation for all active fixed assets,
 * updates asset currentBookValue and accumulatedDepreciation,
 * and posts the composite balanced journal entry to the GL.
 */
export async function runMonthlyDepreciationPosting(
  tenantId: string,
  fiscalPeriod: string, // YYYY-MM
  postedBy: string
): Promise<DepreciationRunLog> {
  const path = `tenants/${tenantId}/depreciationRuns`;
  try {
    const assets = await getFixedAssets(tenantId);
    const activeAssets = assets.filter(
      (a) => a.status === 'active' && a.currentBookValue > a.salvageValue
    );

    if (activeAssets.length === 0) {
      throw new Error('No eligible active fixed assets available for depreciation in this period.');
    }

    const breakdown: DepreciationRunLog['assetBreakdown'] = [];
    const expenseMap = new Map<string, number>(); // accountCode -> totalDebit
    const accumMap = new Map<string, number>(); // accountCode -> totalCredit
    let totalRunDepreciation = 0;

    const assetUpdates: Array<{ id: string; newAccum: number; newBook: number; status: FixedAsset['status'] }> = [];

    for (const asset of activeAssets) {
      const depAmount = calculateMonthlyDepreciation(asset);
      if (depAmount > 0) {
        totalRunDepreciation += depAmount;
        const newAccum = Math.round((asset.accumulatedDepreciation + depAmount) * 100) / 100;
        const newBook = Math.max(asset.salvageValue, Math.round((asset.currentBookValue - depAmount) * 100) / 100);
        const newStatus = newBook <= asset.salvageValue ? 'fully_depreciated' : 'active';

        breakdown.push({
          assetId: asset.id,
          assetTag: asset.assetTag,
          assetName: asset.assetName,
          depreciationAmount: depAmount,
          newBookValue: newBook,
        });

        assetUpdates.push({
          id: asset.id,
          newAccum,
          newBook,
          status: newStatus,
        });

        // Group into accounts
        const expCode = asset.depreciationExpenseAccountCode || '6210';
        const accCode = asset.accumulatedDepreciationAccountCode || '1519';

        expenseMap.set(expCode, (expenseMap.get(expCode) || 0) + depAmount);
        accumMap.set(accCode, (accumMap.get(accCode) || 0) + depAmount);
      }
    }

    if (totalRunDepreciation === 0) {
      throw new Error('Calculated depreciation for all active assets is $0.00.');
    }

    // Build balanced Journal Lines
    const journalLines: JournalLine[] = [];

    expenseMap.forEach((amount, accCode) => {
      journalLines.push({
        id: doc(collection(db, 'temp')).id,
        accountCode: accCode,
        accountName: getStandardAccountName(accCode),
        description: `Depreciation Expense for period ${fiscalPeriod}`,
        debit: Math.round(amount * 100) / 100,
        credit: 0,
      });
    });

    accumMap.forEach((amount, accCode) => {
      journalLines.push({
        id: doc(collection(db, 'temp')).id,
        accountCode: accCode,
        accountName: getStandardAccountName(accCode),
        description: `Accumulated Depreciation for period ${fiscalPeriod}`,
        debit: 0,
        credit: Math.round(amount * 100) / 100,
      });
    });

    // Post to General Ledger
    const todayStr = new Date().toISOString().split('T')[0];
    const runNumber = `DEP-RUN-${fiscalPeriod}`;

    const postedJE = await postJournalEntry(tenantId, {
      postingDate: todayStr,
      referenceNumber: runNumber,
      description: `Monthly Fixed Asset Depreciation Run for Fiscal Period ${fiscalPeriod}`,
      sourceModule: 'depreciation',
      lines: journalLines,
      postedBy,
    });

    // Update all assets
    const now = new Date().toISOString();
    const batch = writeBatch(db);

    for (const update of assetUpdates) {
      const aRef = doc(db, 'tenants', tenantId, 'fixedAssets', update.id);
      batch.update(aRef, {
        accumulatedDepreciation: update.newAccum,
        currentBookValue: update.newBook,
        status: update.status,
        lastDepreciationDate: todayStr,
        updatedAt: now,
      });
    }

    // Create Depreciation Run Record
    const runRef = doc(collection(db, 'tenants', tenantId, 'depreciationRuns'));
    const runLog: DepreciationRunLog = {
      id: runRef.id,
      runNumber,
      runDate: now,
      fiscalPeriod,
      totalDepreciationPosted: Math.round(totalRunDepreciation * 100) / 100,
      assetsProcessedCount: breakdown.length,
      journalEntryId: postedJE.id,
      assetBreakdown: breakdown,
      postedBy,
      status: 'posted',
      tenantId,
      createdAt: now,
    };

    batch.set(runRef, runLog);
    await batch.commit();

    return runLog;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function getStandardAccountName(code: string): string {
  const match = DEFAULT_HOSPITAL_COA.find((a) => a.accountCode === code);
  return match ? match.accountName : `GL Account ${code}`;
}

// ============================================================================
// 5. SEED INITIAL REALISTIC FIXED ASSETS & SEED TRANSACTIONS
// ============================================================================

export async function seedInitialFixedAssets(tenantId: string): Promise<void> {
  const path = `tenants/${tenantId}/fixedAssets`;
  try {
    const existing = await getDocs(collection(db, 'tenants', tenantId, 'fixedAssets'));
    if (!existing.empty) return;

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    const sampleAssets: Array<Omit<FixedAsset, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
      {
        assetTag: 'RAD-MRI-01',
        serialNumber: 'SN-SIEM-MAGNETOM-8821',
        assetName: 'Siemens MAGNETOM Vida 3T MRI Scanner',
        assetCategory: 'medical_equipment',
        department: 'Radiology & Imaging',
        location: 'Diagnostic Pavilion - Suite B1-04',
        manufacturer: 'Siemens Healthineers',
        model: 'MAGNETOM Vida 3T',
        purchaseDate: '2024-03-15',
        inServiceDate: '2024-04-01',
        acquisitionCost: 1450000.0,
        salvageValue: 150000.0,
        usefulLifeYears: 10,
        depreciationMethod: 'straight_line',
        accumulatedDepreciation: 312000.0,
        currentBookValue: 1138000.0,
        assetAccountCode: '1510',
        accumulatedDepreciationAccountCode: '1519',
        depreciationExpenseAccountCode: '6210',
        lastDepreciationDate: '2026-07-31',
        status: 'active',
        warrantyExpiration: '2029-03-15',
        maintenanceVendor: 'Siemens Service Americas',
        notes: 'Equipped with BioMatrix sensors and 64-channel head/neck coil array.',
      },
      {
        assetTag: 'SURG-LAP-04',
        serialNumber: 'SN-STRYK-1688-4491',
        assetName: 'Stryker 1688 4K Ultra-HD Laparoscopy Surgical Tower',
        assetCategory: 'medical_equipment',
        department: 'Surgery & OR Suite',
        location: 'OR 3 - Advanced Laparoscopy Suite',
        manufacturer: 'Stryker Endoscopy',
        model: '1688 4K AIM',
        purchaseDate: '2025-01-10',
        inServiceDate: '2025-02-01',
        acquisitionCost: 285000.0,
        salvageValue: 25000.0,
        usefulLifeYears: 7,
        depreciationMethod: 'straight_line',
        accumulatedDepreciation: 58690.0,
        currentBookValue: 226310.0,
        assetAccountCode: '1510',
        accumulatedDepreciationAccountCode: '1519',
        depreciationExpenseAccountCode: '6210',
        lastDepreciationDate: '2026-07-31',
        status: 'active',
        warrantyExpiration: '2028-01-10',
        maintenanceVendor: 'Stryker ProCare Services',
        notes: 'Includes SPY fluorescence imaging and dual 32-inch 4K OLED surgical displays.',
      },
      {
        assetTag: 'IT-PACS-01',
        serialNumber: 'SN-DELL-POWEREDGE-R760',
        assetName: 'Dell PowerEdge PACS DICOM Enterprise Storage Cluster',
        assetCategory: 'it_hardware',
        department: 'Clinical IT & Informatics',
        location: 'Hospital Datacenter - Rack 04',
        manufacturer: 'Dell Technologies',
        model: 'PowerEdge R760 NVMe',
        purchaseDate: '2024-06-20',
        inServiceDate: '2024-07-01',
        acquisitionCost: 195000.0,
        salvageValue: 15000.0,
        usefulLifeYears: 5,
        depreciationMethod: 'straight_line',
        accumulatedDepreciation: 75000.0,
        currentBookValue: 120000.0,
        assetAccountCode: '1520',
        accumulatedDepreciationAccountCode: '1529',
        depreciationExpenseAccountCode: '6220',
        lastDepreciationDate: '2026-07-31',
        status: 'active',
        warrantyExpiration: '2029-06-20',
        maintenanceVendor: 'Dell ProSupport Plus',
        notes: 'Primary redundant imaging archive hosting 1.2 Petabytes of clinical DICOM studies.',
      },
      {
        assetTag: 'FLEET-AMB-02',
        serialNumber: 'SN-FORD-F450-ALS-901',
        assetName: 'Ford F-450 Type I ALS Mobile Intensive Care Ambulance',
        assetCategory: 'vehicles',
        department: 'Emergency Medical Services (EMS)',
        location: 'Emergency Bay - Stall 2',
        manufacturer: 'Braun Ambulances / Ford',
        model: 'Chief XL ALS',
        purchaseDate: '2023-11-05',
        inServiceDate: '2023-12-01',
        acquisitionCost: 240000.0,
        salvageValue: 30000.0,
        usefulLifeYears: 6,
        depreciationMethod: 'straight_line',
        accumulatedDepreciation: 93333.0,
        currentBookValue: 146667.0,
        assetAccountCode: '1540',
        accumulatedDepreciationAccountCode: '1549',
        depreciationExpenseAccountCode: '6240',
        lastDepreciationDate: '2026-07-31',
        status: 'active',
        warrantyExpiration: '2027-11-05',
        maintenanceVendor: 'Fleet Municipal Maintenance',
        notes: 'Equipped with Stryker Power-LOAD cot and Zoll X-Series advanced cardiac monitor.',
      },
    ];

    for (const item of sampleAssets) {
      const assetRef = doc(collection(db, 'tenants', tenantId, 'fixedAssets'));
      batch.set(assetRef, {
        ...item,
        id: assetRef.id,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function seedInitialJournalEntries(tenantId: string): Promise<void> {
  const path = `tenants/${tenantId}/journalEntries`;
  try {
    const existing = await getDocs(collection(db, 'tenants', tenantId, 'journalEntries'));
    if (!existing.empty) return;

    const batch = writeBatch(db);
    const now = new Date().toISOString();

    const sampleEntries: Array<Omit<JournalEntry, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
      {
        entryNumber: 'JE-2026-0018',
        postingDate: '2026-08-01',
        referenceNumber: 'REV-BATCH-0801',
        description: 'Daily Inpatient and Emergency Department Clinical Revenue Recognition',
        sourceModule: 'patient_billing',
        lines: [
          {
            id: 'line-1',
            accountCode: '1110',
            accountName: 'Accounts Receivable - Patient & Insurers',
            description: 'Inpatient Room & Board billables for 08/01',
            debit: 48500.0,
            credit: 0,
          },
          {
            id: 'line-2',
            accountCode: '4010',
            accountName: 'Inpatient Hospitalization & Room Board Revenue',
            description: 'Ward Census Room and Board charges',
            debit: 0,
            credit: 32000.0,
          },
          {
            id: 'line-3',
            accountCode: '4020',
            accountName: 'Outpatient Clinic & Emergency Triage Revenue',
            description: 'Emergency Level 4 & 5 Triage Billings',
            debit: 0,
            credit: 16500.0,
          },
        ],
        totalDebits: 48500.0,
        totalCredits: 48500.0,
        status: 'posted',
        postedBy: 'Chief Financial Officer (Admin)',
        postedAt: now,
      },
      {
        entryNumber: 'JE-2026-0019',
        postingDate: '2026-08-05',
        referenceNumber: 'INV-PHARM-902',
        description: 'Vendor Purchase: Emergency Floor Oncology & IV Formulary Stock',
        sourceModule: 'ap_invoice',
        lines: [
          {
            id: 'line-1',
            accountCode: '1210',
            accountName: 'Pharmacy Formulary Inventory',
            description: 'Bulk infusion biologics and IV antibiotics',
            debit: 34200.0,
            credit: 0,
          },
          {
            id: 'line-2',
            accountCode: '2010',
            accountName: 'Accounts Payable - Medical & Trade Vendors',
            description: 'Liability to Cardinal Health Dist.',
            debit: 0,
            credit: 34200.0,
          },
        ],
        totalDebits: 34200.0,
        totalCredits: 34200.0,
        status: 'posted',
        postedBy: 'Controller (Admin)',
        postedAt: now,
      },
      {
        entryNumber: 'JE-2026-0020',
        postingDate: '2026-08-10',
        referenceNumber: 'PAYROLL-CY-16',
        description: 'Bi-Weekly Nursing, Resident & Clinical Staff Payroll Disbursement',
        sourceModule: 'payroll',
        lines: [
          {
            id: 'line-1',
            accountCode: '6010',
            accountName: 'Physician, Surgeon & Nursing Salaries',
            description: 'Cycle 16 Gross Clinical Compensation',
            debit: 112500.0,
            credit: 0,
          },
          {
            id: 'line-2',
            accountCode: '1020',
            accountName: 'Payroll Bank Clearing Account',
            description: 'ACH Direct Deposit Disbursement',
            debit: 0,
            credit: 98000.0,
          },
          {
            id: 'line-3',
            accountCode: '2020',
            accountName: 'Accrued Clinical Payroll & Nursing Withholdings',
            description: 'Employee Withholding & Benefit Liabilities',
            debit: 0,
            credit: 14500.0,
          },
        ],
        totalDebits: 112500.0,
        totalCredits: 112500.0,
        status: 'posted',
        postedBy: 'Payroll Director',
        postedAt: now,
      },
    ];

    for (const item of sampleEntries) {
      const jeRef = doc(collection(db, 'tenants', tenantId, 'journalEntries'));
      batch.set(jeRef, {
        ...item,
        id: jeRef.id,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
