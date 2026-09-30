/**
 * Double-Entry Accounting Ledger Engine
 * Enforces strict mathematical equilibrium: Sum(Debits) === Sum(Credits)
 * Manages 80/20 insurance co-pay splits, GL journal postings, and revenue recognition
 */

import { LedgerJournalVoucher } from '@/types/clinical-workflow-comprehensive';

export interface ChartOfAccount {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
}

export const STANDARD_CHART_OF_ACCOUNTS: Record<string, ChartOfAccount> = {
  '1010': { code: '1010', name: 'Cash & Cash Equivalents (Counter Intake)', type: 'ASSET' },
  '1020': { code: '1020', name: 'Accounts Receivable - Patient Co-Pay', type: 'ASSET' },
  '1030': { code: '1030', name: 'Accounts Receivable - Corporate / Insurance Payer', type: 'ASSET' },
  '1200': { code: '1200', name: 'Pharmacy Drug Inventory Asset', type: 'ASSET' },
  '1210': { code: '1210', name: 'Pharmacy Formulary Inventory', type: 'ASSET' },
  '1220': { code: '1220', name: 'Surgical & Sterile Medical Supplies Inventory', type: 'ASSET' },
  '1230': { code: '1230', name: 'Recoverable Input Tax', type: 'ASSET' },
  '1240': { code: '1240', name: 'Freight-In Inventory', type: 'ASSET' },
  '2010': { code: '2010', name: 'Accounts Payable - Medical & Trade Vendors', type: 'LIABILITY' },
  '2030': { code: '2030', name: 'Goods Received Not Invoiced (GRNI)', type: 'LIABILITY' },
  '6030': { code: '6030', name: 'Purchase Price Variance', type: 'EXPENSE' },
  '4010': { code: '4010', name: 'OPD Consultation Fee Revenue', type: 'REVENUE' },
  '4020': { code: '4020', name: 'Clinical Laboratory Services Revenue', type: 'REVENUE' },
  '4030': { code: '4030', name: 'Radiology & Diagnostic Imaging Revenue', type: 'REVENUE' },
  '4040': { code: '4040', name: 'Pharmacy Pharmaceutical Sales Revenue', type: 'REVENUE' },
  '5010': { code: '5010', name: 'Cost of Goods Sold - Pharmacy Inventory', type: 'EXPENSE' },
};

export interface BillableLineItem {
  id: string;
  description: string;
  category: 'CONSULTATION' | 'LABORATORY' | 'RADIOLOGY' | 'PHARMACY';
  grossAmount: number;
}

export interface CopaySplitResult {
  totalGross: number;
  insurancePercent: number;
  patientPercent: number;
  insurancePayable: number;
  patientPayable: number;
  lineItems: BillableLineItem[];
  voucher: LedgerJournalVoucher;
}

export class DoubleEntryLedgerEngine {
  /**
   * Validates mathematical balance of any journal voucher
   */
  public static validateVoucherBalance(voucher: LedgerJournalVoucher): { isValid: boolean; discrepancy: number } {
    const totalDebit = voucher.debitEntries.reduce((sum, e) => sum + Math.round(e.amount * 100) / 100, 0);
    const totalCredit = voucher.creditEntries.reduce((sum, e) => sum + Math.round(e.amount * 100) / 100, 0);
    const discrepancy = Math.abs(Math.round((totalDebit - totalCredit) * 100) / 100);

    return {
      isValid: discrepancy === 0,
      discrepancy,
    };
  }

  /**
   * Generates balanced journal voucher for OPD encounter billing with 80/20 or custom co-pay ratio
   */
  public static generateBillingJournalVoucher(params: {
    tenantId: string;
    encounterId: string;
    patientId: string;
    patientName: string;
    lineItems: BillableLineItem[];
    insurancePercent: number; // e.g. 80
    patientPercent: number; // e.g. 20
    postedBy: string;
  }): CopaySplitResult {
    const totalGross = params.lineItems.reduce((acc, item) => acc + item.grossAmount, 0);
    const insurancePayable = Math.round((totalGross * (params.insurancePercent / 100)) * 100) / 100;
    const patientPayable = Math.round((totalGross - insurancePayable) * 100) / 100;

    const voucherId = `jv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const voucherNumber = `JV-OPD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Breakdown revenue by category
    const consultationRev = params.lineItems.filter(i => i.category === 'CONSULTATION').reduce((s, i) => s + i.grossAmount, 0);
    const labRev = params.lineItems.filter(i => i.category === 'LABORATORY').reduce((s, i) => s + i.grossAmount, 0);
    const radRev = params.lineItems.filter(i => i.category === 'RADIOLOGY').reduce((s, i) => s + i.grossAmount, 0);
    const pharmaRev = params.lineItems.filter(i => i.category === 'PHARMACY').reduce((s, i) => s + i.grossAmount, 0);

    const debitEntries = [
      {
        accountCode: '1020',
        accountName: STANDARD_CHART_OF_ACCOUNTS['1020'].name,
        amount: patientPayable,
      },
      {
        accountCode: '1030',
        accountName: STANDARD_CHART_OF_ACCOUNTS['1030'].name,
        amount: insurancePayable,
      },
    ];

    const creditEntries: { accountCode: string; accountName: string; amount: number }[] = [];
    if (consultationRev > 0) creditEntries.push({ accountCode: '4010', accountName: STANDARD_CHART_OF_ACCOUNTS['4010'].name, amount: consultationRev });
    if (labRev > 0) creditEntries.push({ accountCode: '4020', accountName: STANDARD_CHART_OF_ACCOUNTS['4020'].name, amount: labRev });
    if (radRev > 0) creditEntries.push({ accountCode: '4030', accountName: STANDARD_CHART_OF_ACCOUNTS['4030'].name, amount: radRev });
    if (pharmaRev > 0) creditEntries.push({ accountCode: '4040', accountName: STANDARD_CHART_OF_ACCOUNTS['4040'].name, amount: pharmaRev });

    const totalDebit = debitEntries.reduce((s, d) => s + d.amount, 0);
    const totalCredit = creditEntries.reduce((s, c) => s + c.amount, 0);

    const voucher: LedgerJournalVoucher = {
      voucherId,
      tenantId: params.tenantId,
      encounterId: params.encounterId,
      patientId: params.patientId,
      voucherNumber,
      postingDate: Date.now(),
      description: `OPD Service Billing Revenue & Co-Pay Split (Patient: ${params.patientName})`,
      debitEntries,
      creditEntries,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.001,
      postedBy: params.postedBy,
    };

    return {
      totalGross,
      insurancePercent: params.insurancePercent,
      patientPercent: params.patientPercent,
      insurancePayable,
      patientPayable,
      lineItems: params.lineItems,
      voucher,
    };
  }

  /**
   * Generates journal voucher for Ingress Fee / Cash Settlement at front desk
   */
  public static generateCashReceiptVoucher(params: {
    tenantId: string;
    encounterId: string;
    patientId: string;
    amount: number;
    receiptNumber: string;
    postedBy: string;
  }): LedgerJournalVoucher {
    const voucherId = `jv_rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const voucherNumber = `CR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      voucherId,
      tenantId: params.tenantId,
      encounterId: params.encounterId,
      patientId: params.patientId,
      voucherNumber,
      postingDate: Date.now(),
      description: `Ingress Fee & Registration Cash Receipt (${params.receiptNumber})`,
      debitEntries: [
        {
          accountCode: '1010',
          accountName: STANDARD_CHART_OF_ACCOUNTS['1010'].name,
          amount: params.amount,
        },
      ],
      creditEntries: [
        {
          accountCode: '4010',
          accountName: STANDARD_CHART_OF_ACCOUNTS['4010'].name,
          amount: params.amount,
        },
      ],
      totalDebit: params.amount,
      totalCredit: params.amount,
      isBalanced: true,
      postedBy: params.postedBy,
    };
  }
}
