import { FixedAsset, DepreciationScheduleItem, Account, AccountCategory, NormalBalance } from '@/types/erp-finance';

export interface ValidationResult {
  isValid: boolean;
  totalDebits: number;
  totalCredits: number;
  imbalance: number;
  errors: string[];
}

export interface MinimalJournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

/**
 * Validates a double-entry journal transaction.
 * Ensures total debits equal total credits to floating point cent precision,
 * ensures no negative numbers, and enforces at least 2 line items.
 */
export function validateJournalEntry(lines: MinimalJournalLine[]): ValidationResult {
  const errors: string[] = [];

  if (!lines || lines.length < 2) {
    errors.push('A journal entry must contain at least 2 line items.');
    return {
      isValid: false,
      totalDebits: 0,
      totalCredits: 0,
      imbalance: 0,
      errors,
    };
  }

  let totalDebitsCents = 0;
  let totalCreditsCents = 0;

  lines.forEach((line, index) => {
    const lineIndex = index + 1;
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;

    if (!line.accountCode || line.accountCode.trim() === '') {
      errors.push(`Line ${lineIndex}: Missing GL Account Code.`);
    }

    if (debit < 0 || credit < 0) {
      errors.push(`Line ${lineIndex}: Debit and credit amounts must be non-negative.`);
    }

    if (debit > 0 && credit > 0) {
      errors.push(`Line ${lineIndex}: A single line cannot have both a debit and a credit amount.`);
    }

    if (debit === 0 && credit === 0) {
      errors.push(`Line ${lineIndex}: Line must contain a non-zero debit or credit amount.`);
    }

    totalDebitsCents += Math.round(debit * 100);
    totalCreditsCents += Math.round(credit * 100);
  });

  const totalDebits = totalDebitsCents / 100;
  const totalCredits = totalCreditsCents / 100;
  const imbalanceCents = Math.abs(totalDebitsCents - totalCreditsCents);
  const imbalance = imbalanceCents / 100;

  if (totalDebitsCents === 0 && totalCreditsCents === 0) {
    errors.push('Journal entry cannot be empty or zero total value.');
  } else if (imbalanceCents !== 0) {
    errors.push(
      `Journal entry is out of balance by $${imbalance.toFixed(2)} (Debits: $${totalDebits.toFixed(2)}, Credits: $${totalCredits.toFixed(2)}).`
    );
  }

  return {
    isValid: errors.length === 0,
    totalDebits,
    totalCredits,
    imbalance,
    errors,
  };
}

/**
 * Calculates single month straight-line or declining balance depreciation for a fixed asset.
 */
export function calculateMonthlyDepreciation(asset: FixedAsset): number {
  if (asset.status === 'disposed' || asset.status === 'fully_depreciated') {
    return 0;
  }

  const cost = Number(asset.acquisitionCost) || 0;
  const salvage = Number(asset.salvageValue) || 0;
  const usefulLifeYears = Number(asset.usefulLifeYears) || 1;
  const currentBook = Number(asset.currentBookValue) ?? cost;

  if (currentBook <= salvage) {
    return 0;
  }

  let monthlyAmount = 0;

  if (asset.depreciationMethod === 'straight_line') {
    const depreciableBase = Math.max(0, cost - salvage);
    const totalMonths = Math.max(1, usefulLifeYears * 12);
    monthlyAmount = depreciableBase / totalMonths;
  } else if (asset.depreciationMethod === 'declining_balance') {
    // 200% Double Declining Balance
    const annualRate = 2 / usefulLifeYears;
    const monthlyRate = annualRate / 12;
    monthlyAmount = currentBook * monthlyRate;
  }

  // Cap depreciation so book value does not drop below salvage value
  const maxAllowable = Math.max(0, currentBook - salvage);
  const finalAmount = Math.min(monthlyAmount, maxAllowable);

  return Math.round(finalAmount * 100) / 100;
}

/**
 * Calculates complete annual depreciation schedule across useful lifespan.
 */
export function calculateAssetDepreciationSchedule(asset: FixedAsset): DepreciationScheduleItem[] {
  const schedule: DepreciationScheduleItem[] = [];
  const cost = Number(asset.acquisitionCost) || 0;
  const salvage = Number(asset.salvageValue) || 0;
  const years = Math.max(1, Number(asset.usefulLifeYears) || 1);

  let bookValue = cost;
  let accumulated = 0;

  if (asset.depreciationMethod === 'straight_line') {
    const annualDepreciation = (cost - salvage) / years;

    for (let year = 1; year <= years; year++) {
      const opening = bookValue;
      let exp = annualDepreciation;
      if (opening - exp < salvage) {
        exp = Math.max(0, opening - salvage);
      }
      accumulated += exp;
      bookValue = opening - exp;

      schedule.push({
        periodIndex: year,
        periodLabel: `Year ${year}`,
        openingBookValue: Math.round(opening * 100) / 100,
        depreciationExpense: Math.round(exp * 100) / 100,
        accumulatedDepreciation: Math.round(accumulated * 100) / 100,
        closingBookValue: Math.round(bookValue * 100) / 100,
      });

      if (bookValue <= salvage) break;
    }
  } else {
    // Declining balance
    const rate = 2 / years;
    for (let year = 1; year <= years; year++) {
      const opening = bookValue;
      let exp = opening * rate;
      if (opening - exp < salvage) {
        exp = Math.max(0, opening - salvage);
      }
      accumulated += exp;
      bookValue = opening - exp;

      schedule.push({
        periodIndex: year,
        periodLabel: `Year ${year}`,
        openingBookValue: Math.round(opening * 100) / 100,
        depreciationExpense: Math.round(exp * 100) / 100,
        accumulatedDepreciation: Math.round(accumulated * 100) / 100,
        closingBookValue: Math.round(bookValue * 100) / 100,
      });

      if (bookValue <= salvage) break;
    }
  }

  return schedule;
}

/**
 * Standard Hospital Chart of Accounts Seed Template
 */
export const DEFAULT_HOSPITAL_COA: Array<Omit<Account, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
  // ASSETS (1000 - 1999)
  {
    accountCode: '1010',
    accountName: 'Operating Cash & Treasury Account',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 850000.0,
    currency: 'USD',
    description: 'Primary liquidity and clinical operational disbursement checking account',
    isActive: true,
    isSystemLocked: true,
    allowSupplierPayments: true,
  },
  {
    accountCode: '1020',
    accountName: 'Payroll Bank Clearing Account',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 240000.0,
    currency: 'USD',
    description: 'Direct deposit clearing account for physician, nursing, and staff payroll',
    isActive: true,
  },
  {
    accountCode: '1110',
    accountName: 'Accounts Receivable - Patient & Insurers',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 420000.0,
    currency: 'USD',
    description: 'Outstanding billable claims from insurance payers and self-pay inpatient accounts',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1210',
    accountName: 'Pharmacy Formulary Inventory',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 185000.0,
    currency: 'USD',
    description: 'On-hand pharmaceutical stock, chemotherapy agents, and emergency floor drugs',
    isActive: true,
  },
  {
    accountCode: '1220',
    accountName: 'Surgical & Sterile Medical Supplies Inventory',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 95000.0,
    currency: 'USD',
    description: 'Surgical implants, sutures, catheter kits, sterile drapes, and PPE',
    isActive: true,
  },
  {
    accountCode: '1230',
    accountName: 'Recoverable Input Tax',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 0,
    currency: 'USD',
    description: 'Input tax recoverable on governed supplier invoices',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1240',
    accountName: 'Freight-In Inventory',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 0,
    currency: 'USD',
    description: 'Capitalized inbound freight associated with inventory procurement',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1250',
    accountName: 'Supplier Returns & Credit Receivable',
    category: 'asset',
    subCategory: 'Current Assets',
    normalBalance: 'debit',
    balance: 0,
    currency: 'USD',
    description: 'Approved inventory returned to suppliers pending credit memo or settlement',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1510',
    accountName: 'Medical Machinery & Diagnostic Equipment',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'debit',
    balance: 2850000.0,
    currency: 'USD',
    description: 'MRI units, CT scanners, OR laparoscopy towers, ultrasound machines, and ventilators',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1519',
    accountName: 'Accumulated Depreciation - Medical Equipment',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'credit',
    balance: -420000.0, // Contra-asset
    currency: 'USD',
    description: 'Contra-asset account tracking accumulated write-down on medical machines',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '1520',
    accountName: 'IT Hardware & Clinical Server Infrastructure',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'debit',
    balance: 380000.0,
    currency: 'USD',
    description: 'EHR datacenter racks, nursing workstations, PACS servers, and networking gear',
    isActive: true,
  },
  {
    accountCode: '1529',
    accountName: 'Accumulated Depreciation - IT Hardware',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'credit',
    balance: -85000.0,
    currency: 'USD',
    description: 'Contra-asset account tracking write-down on clinical compute hardware',
    isActive: true,
  },
  {
    accountCode: '1530',
    accountName: 'Hospital Building, Wing & Cleanroom Facilities',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'debit',
    balance: 12500000.0,
    currency: 'USD',
    description: 'Main hospital pavilions, ICU suites, negative pressure isolation wards',
    isActive: true,
  },
  {
    accountCode: '1539',
    accountName: 'Accumulated Depreciation - Buildings & Facilities',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'credit',
    balance: -1100000.0,
    currency: 'USD',
    description: 'Contra-asset account tracking accumulated building amortization',
    isActive: true,
  },
  {
    accountCode: '1540',
    accountName: 'Hospital Ambulances & Mobile Response Fleet',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'debit',
    balance: 480000.0,
    currency: 'USD',
    description: 'Type I and Type III Advanced Life Support (ALS) emergency ambulances',
    isActive: true,
  },
  {
    accountCode: '1549',
    accountName: 'Accumulated Depreciation - Ambulances & Fleet',
    category: 'asset',
    subCategory: 'Fixed Assets',
    normalBalance: 'credit',
    balance: -65000.0,
    currency: 'USD',
    description: 'Contra-asset tracking write-down on ambulance fleet',
    isActive: true,
  },

  // LIABILITIES (2000 - 2999)
  {
    accountCode: '2010',
    accountName: 'Accounts Payable - Medical & Trade Vendors',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    balance: 310000.0,
    currency: 'USD',
    description: 'Unpaid vendor invoices for pharmaceuticals, implants, equipment maintenance',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '2020',
    accountName: 'Accrued Clinical Payroll & Nursing Withholdings',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    balance: 145000.0,
    currency: 'USD',
    description: 'Earned but unpaid clinical compensation and employee benefit deductions',
    isActive: true,
  },
  {
    accountCode: '2030',
    accountName: 'Goods Received Not Invoiced (GRNI)',
    category: 'liability',
    subCategory: 'Current Liabilities',
    normalBalance: 'credit',
    balance: 0,
    currency: 'USD',
    description: 'Accrued liability for accepted inventory pending supplier invoice recognition',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '2510',
    accountName: 'Long-Term Medical Equipment Financing Notes',
    category: 'liability',
    subCategory: 'Long-Term Liabilities',
    normalBalance: 'credit',
    balance: 1650000.0,
    currency: 'USD',
    description: 'Secured debt obligations for specialized imaging and oncology radiation hardware',
    isActive: true,
  },

  // EQUITY (3000 - 3999)
  {
    accountCode: '3010',
    accountName: 'Hospital Retained Operating Surplus',
    category: 'equity',
    subCategory: 'Equity & Reserves',
    normalBalance: 'credit',
    balance: 12850000.0,
    currency: 'USD',
    description: 'Cumulative operating earnings reinvested in clinical modernization',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '3020',
    accountName: 'Restricted Clinical Endowment & Research Fund',
    category: 'equity',
    subCategory: 'Equity & Reserves',
    normalBalance: 'credit',
    balance: 750000.0,
    currency: 'USD',
    description: 'Philanthropic gifts restricted for cancer institute and pediatric innovation',
    isActive: true,
  },

  // REVENUE (4000 - 4999)
  {
    accountCode: '4010',
    accountName: 'Inpatient Hospitalization & Room Board Revenue',
    category: 'revenue',
    subCategory: 'Clinical Operating Revenue',
    normalBalance: 'credit',
    balance: 1850000.0,
    currency: 'USD',
    description: 'Per-diem bed charges, ICU acuity nursing, inpatient dietary and round fees',
    isActive: true,
  },
  {
    accountCode: '4020',
    accountName: 'Outpatient Clinic & Emergency Triage Revenue',
    category: 'revenue',
    subCategory: 'Clinical Operating Revenue',
    normalBalance: 'credit',
    balance: 920000.0,
    currency: 'USD',
    description: 'Emergency department triage fees, day-surgery, and specialty consult fees',
    isActive: true,
  },
  {
    accountCode: '4030',
    accountName: 'Surgical & Operating Room Facility Revenue',
    category: 'revenue',
    subCategory: 'Clinical Operating Revenue',
    normalBalance: 'credit',
    balance: 1420000.0,
    currency: 'USD',
    description: 'OR suite hourly block time, sterile surgical setup, and recovery unit charges',
    isActive: true,
  },
  {
    accountCode: '4040',
    accountName: 'Diagnostic Imaging & Pathology Laboratory Revenue',
    category: 'revenue',
    subCategory: 'Clinical Operating Revenue',
    normalBalance: 'credit',
    balance: 680000.0,
    currency: 'USD',
    description: 'MRI/CT scans, ultrasound, blood chemistry panels, histology pathology tests',
    isActive: true,
  },
  {
    accountCode: '4050',
    accountName: 'Inpatient & Discharge Pharmacy Sales Revenue',
    category: 'revenue',
    subCategory: 'Clinical Operating Revenue',
    normalBalance: 'credit',
    balance: 410000.0,
    currency: 'USD',
    description: 'Pharmaceutical billing for administered IV bags and discharge prescriptions',
    isActive: true,
  },

  // EXPENSES (6000 - 6999)
  {
    accountCode: '6010',
    accountName: 'Physician, Surgeon & Nursing Salaries',
    category: 'expense',
    subCategory: 'Direct Labor & Staffing',
    normalBalance: 'debit',
    balance: 1240000.0,
    currency: 'USD',
    description: 'Compensation for attending staff, surgical residents, certified registered nurse anesthetists',
    isActive: true,
  },
  {
    accountCode: '6020',
    accountName: 'Medical Consumables & Surgical Implants Used',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    balance: 380000.0,
    currency: 'USD',
    description: 'Cost of consumed orthopedic prosthetics, sutures, syringes, and sterile PPE',
    isActive: true,
  },
  {
    accountCode: '6030',
    accountName: 'Purchase Price Variance',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    balance: 0,
    currency: 'USD',
    description: 'Controlled variance between accrued PO value and approved supplier invoice value',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '6040',
    accountName: 'Inventory Shrinkage, Count Variance & Write-Off Expense',
    category: 'expense',
    subCategory: 'Clinical Operations Expense',
    normalBalance: 'debit',
    balance: 0,
    currency: 'USD',
    description: 'Physical count shortages, approved write-offs, and inventory control variances',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '6110',
    accountName: 'Hospital Utilities, Oxygen Supply & Clean Power',
    category: 'expense',
    subCategory: 'Facility Expenses',
    normalBalance: 'debit',
    balance: 115000.0,
    currency: 'USD',
    description: 'Medical gas pipeline supply, liquid oxygen tanks, emergency HVAC filtration, electricity',
    isActive: true,
  },
  {
    accountCode: '6210',
    accountName: 'Depreciation Expense - Medical Equipment',
    category: 'expense',
    subCategory: 'Depreciation & Amortization',
    normalBalance: 'debit',
    balance: 62000.0,
    currency: 'USD',
    description: 'Monthly straight-line depreciation allocation for clinical imaging and surgery suites',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '6220',
    accountName: 'Depreciation Expense - IT Hardware',
    category: 'expense',
    subCategory: 'Depreciation & Amortization',
    normalBalance: 'debit',
    balance: 12500.0,
    currency: 'USD',
    description: 'Monthly depreciation write-down on servers, mobile carts, and network switches',
    isActive: true,
    isSystemLocked: true,
  },
  {
    accountCode: '6230',
    accountName: 'Depreciation Expense - Building & Facilities',
    category: 'expense',
    subCategory: 'Depreciation & Amortization',
    normalBalance: 'debit',
    balance: 28000.0,
    currency: 'USD',
    description: 'Monthly building depreciation allocation',
    isActive: true,
  },
  {
    accountCode: '6240',
    accountName: 'Depreciation Expense - Ambulances & Fleet',
    category: 'expense',
    subCategory: 'Depreciation & Amortization',
    normalBalance: 'debit',
    balance: 8500.0,
    currency: 'USD',
    description: 'Monthly fleet vehicle depreciation write-down',
    isActive: true,
  },
  {
    accountCode: '6310',
    accountName: 'Biomedical Maintenance & Service Contracts',
    category: 'expense',
    subCategory: 'Maintenance & Service',
    normalBalance: 'debit',
    balance: 45000.0,
    currency: 'USD',
    description: 'Preventative calibration contracts for linear accelerators and diagnostic scanners',
    isActive: true,
  },
];
