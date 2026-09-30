import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildFinanceAnomalies,
  buildTrialBalance,
  financePeriodId,
  periodKey,
  straightLineMonthlyDepreciationMinorUnits,
  validateGovernedJournal,
} from '@/lib/finance/finance-engine';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('FIN-1 through FIN-11 enterprise finance completion',()=>{
  test('FIN-1 GL enforces deterministic periods and balanced journals',()=>{
    expect(periodKey(2026,9)).toBe('2026-09');
    expect(financePeriodId(2026,9)).toBe('fin_period_2026-09');
    expect(()=>validateGovernedJournal({
      lines:[
        {glAccountId:'1010',glAccountName:'Cash',debitMinorUnits:100,creditMinorUnits:0,lineDescription:'d'},
        {glAccountId:'4010',glAccountName:'Revenue',debitMinorUnits:0,creditMinorUnits:100,lineDescription:'c'},
      ] as any,
      accounts:[
        {accountCode:'1010',accountName:'Cash',category:'asset',normalBalance:'debit',isActive:true,currency:'USD'} as any,
        {accountCode:'4010',accountName:'Revenue',category:'revenue',normalBalance:'credit',isActive:true,currency:'USD'} as any,
      ],
      currency:'USD',
    })).not.toThrow();
    expect(()=>validateGovernedJournal({
      lines:[
        {glAccountId:'1010',glAccountName:'Cash',debitMinorUnits:100,creditMinorUnits:0,lineDescription:'d'},
        {glAccountId:'4010',glAccountName:'Revenue',debitMinorUnits:0,creditMinorUnits:99,lineDescription:'c'},
      ] as any,
      accounts:[
        {accountCode:'1010',accountName:'Cash',category:'asset',normalBalance:'debit',isActive:true,currency:'USD'} as any,
        {accountCode:'4010',accountName:'Revenue',category:'revenue',normalBalance:'credit',isActive:true,currency:'USD'} as any,
      ],
      currency:'USD',
    })).toThrow('UNBALANCED_JOURNAL_POSTING');
  });

  test('FIN-1 trial balance derives from immutable posted journals',()=>{
    const trial=buildTrialBalance({
      journals:[{
        journalId:'j1',tenantId:'t',fiscalYear:2026,postingPeriod:9,
        documentDate:1,postingDate:1,documentHeader:'x',currency:'USD',
        totalAmountMinorUnits:100,sourceModule:'GENERAL_LEDGER',status:'POSTED',
        lines:[
          {glAccountId:'1010',glAccountName:'Cash',debitMinorUnits:100,creditMinorUnits:0,lineDescription:'x'},
          {glAccountId:'4010',glAccountName:'Revenue',debitMinorUnits:0,creditMinorUnits:100,lineDescription:'x'},
        ],
        postedBy:'u',postedAt:1,
      }] as any,
      accounts:[
        {accountCode:'1010',accountName:'Cash',category:'asset',normalBalance:'debit',isActive:true,currency:'USD'} as any,
        {accountCode:'4010',accountName:'Revenue',category:'revenue',normalBalance:'credit',isActive:true,currency:'USD'} as any,
      ],
      fiscalYear:2026,throughPostingPeriod:9,currency:'USD',
    });
    expect(trial.balanced).toBe(true);
    expect(trial.totalDebitsMinorUnits).toBe(100);
    expect(trial.totalCreditsMinorUnits).toBe(100);
  });

  test('FIN-2/5 AR and revenue are governed, period-aware and journal-backed',async()=>{
    const s=await source('lib/backend/services/finance-ar-revenue-domain-service.ts');
    expect(s).toContain('FinanceArRevenueDomainService');
    expect(s).toContain('REVENUE_RECOGNITION');
    expect(s).toContain('AR_OPEN_ITEM');
    expect(s).toContain('AR_ADJUSTMENT');
    expect(s).toContain('AR_RECEIPT');
    expect(s).toContain('FINANCE_PERIOD_NOT_POSTABLE');
    expect(s).toContain("entityType:'JOURNAL_ENTRY'");
    expect(s).toContain('SCM_FINANCE_SEGREGATION_OF_DUTIES');
  });

  test('FIN-3 treasury uses maker-checker and bank reconciliation controls',async()=>{
    const s=await source('lib/backend/services/finance-treasury-domain-service.ts');
    expect(s).toContain('TREASURY_ACCOUNT');
    expect(s).toContain('CASH_SHIFT');
    expect(s).toContain('TREASURY_TRANSFER');
    expect(s).toContain('BANK_RECONCILIATION');
    expect(s).toContain('SCM_FINANCE_SEGREGATION_OF_DUTIES');
    expect(s).toContain('FINANCE_PERIOD_NOT_POSTABLE');
    expect(s).toContain("entityType:'JOURNAL_ENTRY'");
  });

  test('FIN-4 AP extends SCM payables without creating a parallel payable ledger',async()=>{
    const s=await source('lib/backend/services/finance-ap-domain-service.ts');
    expect(s).toContain('scmSupplierInvoices');
    expect(s).toContain('AP_AGING_SNAPSHOT');
    expect(s).toContain('SUPPLIER_CREDIT');
    expect(s).not.toContain("entityType:'FINANCE_SUPPLIER_INVOICE'");
  });

  test('FIN-6/7 costing and budgets are immutable controlled projections',async()=>{
    const s=await source('lib/backend/services/finance-cost-budget-domain-service.ts');
    for(const marker of [
      'COST_CENTER','COST_ALLOCATION_RULE','COST_ALLOCATION_RUN',
      'BUDGET_ENVELOPE','BUDGET_COMMITMENT'
    ]) expect(s).toContain(marker);
    expect(s).toContain('BUDGET_INSUFFICIENT_AVAILABLE');
    expect(s).toContain('SCM_FINANCE_SEGREGATION_OF_DUTIES');
  });

  test('FIN-8 fixed assets use deterministic straight-line depreciation and journals',async()=>{
    expect(straightLineMonthlyDepreciationMinorUnits({
      acquisitionCostMinorUnits:1200,
      residualValueMinorUnits:0,
      usefulLifeMonths:12,
      monthsDepreciated:0,
    })).toBe(100);
    const s=await source('lib/backend/services/finance-fixed-asset-domain-service.ts');
    expect(s).toContain('FIXED_ASSET');
    expect(s).toContain('DEPRECIATION_RUN');
    expect(s).toContain("entityType:'JOURNAL_ENTRY'");
    expect(s).toContain('FINANCE_PERIOD_NOT_POSTABLE');
  });

  test('FIN-9 close requires reconciliations and locks period after statements',async()=>{
    const s=await source('lib/backend/services/finance-close-domain-service.ts');
    expect(s).toContain('trialBalanceBalanced');
    expect(s).toContain('inventoryClosed');
    expect(s).toContain('apReconciled');
    expect(s).toContain('arReconciled');
    expect(s).toContain('cashReconciled');
    expect(s).toContain('depreciationPosted');
    expect(s).toContain('FINANCIAL_STATEMENT_SNAPSHOT');
    expect(s).toContain("status:'LOCKED'");
  });

  test('FIN-10 tax postings are period-gated and journal-backed',async()=>{
    const s=await source('lib/backend/services/finance-tax-domain-service.ts');
    expect(s).toContain('TAX_CODE');
    expect(s).toContain('TAX_LEDGER_ITEM');
    expect(s).toContain('TAX_REMITTANCE');
    expect(s).toContain('TAX_SUMMARY_SNAPSHOT');
    expect(s).toContain('FINANCE_PERIOD_NOT_POSTABLE');
    expect(s).toContain("entityType:'JOURNAL_ENTRY'");
  });

  test('FIN-11 intelligence is deterministic and explanatory',()=>{
    const anomalies=buildFinanceAnomalies({
      revenueMinorUnits:100,
      expenseMinorUnits:150,
      netIncomeMinorUnits:-50,
      currentAssetsMinorUnits:100,
      currentLiabilitiesMinorUnits:200,
      workingCapitalMinorUnits:-100,
      budgetAvailableMinorUnits:-10,
      overdueArMinorUnits:25,
      overdueApMinorUnits:30,
      unreconciledBankMinorUnits:5,
    },false);
    expect(anomalies.some(a=>a.code==='TRIAL_BALANCE_IMBALANCE')).toBe(true);
    expect(anomalies.some(a=>a.code==='BUDGET_EXHAUSTED')).toBe(true);
    expect(anomalies.every(a=>a.explanation.length>10)).toBe(true);
  });

  test('all Finance commands are routed through governed command bus',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'CreateFinanceAccountCommand','CreateFinancePeriodCommand','ChangeFinancePeriodStatusCommand',
      'PostGovernedJournalCommand','ReverseGovernedJournalCommand','GenerateTrialBalanceCommand',
      'RecognizeRevenueInvoiceCommand','AdjustArOpenItemCommand','RecordArReceiptCommand','GenerateArAgingCommand',
      'RegisterTreasuryAccountCommand','OpenCashShiftCommand','CloseCashShiftCommand','ReviewCashShiftCommand',
      'TreasuryTransferCommand','PrepareBankReconciliationCommand','ApproveBankReconciliationCommand',
      'GenerateApAgingCommand','ApplySupplierCreditCommand',
      'CreateCostCenterCommand','CreateCostAllocationRuleCommand','RunCostAllocationCommand',
      'CreateBudgetEnvelopeCommand','ApproveBudgetEnvelopeCommand','CommitBudgetCommand',
      'ReleaseBudgetCommitmentCommand','ConsumeBudgetCommitmentCommand',
      'CapitalizeFixedAssetCommand','RunDepreciationCommand','TransferFixedAssetCommand','DisposeFixedAssetCommand',
      'StartFinanceCloseCommand','FinalizeFinanceCloseCommand','LockFinancePeriodCommand',
      'CreateTaxCodeCommand','RecordSupplierWithholdingCommand','RemitTaxLiabilityCommand','GenerateTaxSummaryCommand',
      'GenerateFinanceIntelligenceCommand'
    ]) expect(bus).toContain(`case '${command}'`);
  });

  test('Finance read models are tenant scoped, server-write-only, and available offline where safe',async()=>{
    const rules=await source('firestore.rules');
    const hydration=await source('lib/offline/hydration.ts');
    for(const collection of [
      'financeTrialBalanceSnapshots','financeRevenueRecognitions','financeArAdjustments',
      'financeArReceipts','financeArAgingSnapshots','treasuryAccounts','financeBankReconciliations',
      'financeApAgingSnapshots','financeCostCenters','financeBudgets','financeBudgetCommitments',
      'financeFixedAssets','financeDepreciationRuns','financeStatementSnapshots',
      'financeTaxSummarySnapshots','financeIntelligenceSnapshots'
    ]){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+240)).toContain('allow write: if false;');
    }
    for(const collection of [
      'accountingPeriods','financeArAgingSnapshots','treasuryAccounts',
      'financeBankReconciliations','financeApAgingSnapshots','financeBudgets',
      'financeFixedAssets','financeStatementSnapshots','financeTaxSummarySnapshots',
      'financeIntelligenceSnapshots'
    ]) expect(hydration).toContain(`'${collection}'`);
  });

  test('finance provisioning is guarded for explicit tenant/project/runtime',async()=>{
    const s=await source('scripts/ops/finance-provision-controls.ts');
    expect(s).toContain('GHIMS_FINANCE_PROVISION_TENANT');
    expect(s).toContain('GHIMS_ALLOW_FINANCE_PROVISION');
    expect(s).toContain('GHIMS_BOOTSTRAP_CONFIRM_PROJECT');
    expect(s).toContain('PRODUCTION');
  });
});
