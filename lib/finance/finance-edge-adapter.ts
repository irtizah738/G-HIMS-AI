'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';
import type {
  CapitalizeAssetPayload,
  DepreciationRunRecord,
  FinanceAccountRecord,
  FinanceFixedAssetRecord,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import type {
  Account,
  DepreciationRunLog,
  FixedAsset,
  JournalEntry,
} from '@/types/erp-finance';

async function run<T>(
  commandType:string,
  payload:Record<string,unknown>,
  idempotencyKey?:string
):Promise<T>{
  const result=await executeActiveTenantCommand<T>(
    commandType,
    payload,
    {idempotencyKey,schemaVersion:1}
  );
  if(!result.success)throw new Error(
    result.error?.message||`${commandType} failed.`
  );
  return result.data as T;
}

export const createFinanceAccountEdge=(
  payload:{
    accountCode:string;
    accountName:string;
    category:FinanceAccountRecord['category'];
    subCategory:string;
    normalBalance:FinanceAccountRecord['normalBalance'];
    currency:string;
    parentAccountCode?:string;
    costCenterRequired?:boolean;
    profitCenterRequired?:boolean;
    allowManualPosting:boolean;
    allowCashReceipts?:boolean;
    allowSupplierPayments?:boolean;
    isSystemLocked?:boolean;
  },
  idempotencyKey?:string
)=>run<FinanceAccountRecord>(
  'CreateFinanceAccountCommand',
  payload as Record<string,unknown>,
  idempotencyKey
);

export const postManualJournalEdge=(
  payload:{
    journalId?:string;
    fiscalYear:number;
    postingPeriod:number;
    documentDate:number;
    postingDate:number;
    referenceDocumentId?:string;
    documentHeader:string;
    currency:string;
    lines:Array<{
      glAccountId:string;
      glAccountName:string;
      costCenterId?:string;
      profitCenterId?:string;
      debitMinorUnits:number;
      creditMinorUnits:number;
      lineDescription:string;
    }>;
  },
  idempotencyKey?:string
)=>run<GovernedJournalRecord>(
  'PostJournalCommand',
  {...payload,sourceModule:'MANUAL'} as Record<string,unknown>,
  idempotencyKey
);

function toLegacyJournal(journal:GovernedJournalRecord):JournalEntry{
  const module:JournalEntry['sourceModule'] =
    journal.sourceModule==='AP'?'ap_invoice':
    journal.sourceModule==='ASSETS'?'depreciation':
    journal.sourceModule==='BILLING'||journal.sourceModule==='AR'?'patient_billing':
    journal.sourceModule==='PAYROLL'?'payroll':
    'manual';
  return {
    id:journal.journalId,
    entryNumber:journal.journalId,
    postingDate:new Date(journal.postingDate).toISOString().slice(0,10),
    referenceNumber:journal.referenceDocumentId||'',
    description:journal.documentHeader,
    sourceModule:module,
    lines:journal.lines.map((line,index)=>({
      id:`${journal.journalId}_${index}`,
      accountCode:line.glAccountId,
      accountName:line.glAccountName,
      description:line.lineDescription,
      debit:line.debitMinorUnits/100,
      credit:line.creditMinorUnits/100,
      department:line.costCenterId,
    })),
    totalDebits:journal.lines.reduce((sum,line)=>sum+line.debitMinorUnits,0)/100,
    totalCredits:journal.lines.reduce((sum,line)=>sum+line.creditMinorUnits,0)/100,
    status:journal.status==='POSTED'?'posted':'void',
    postedBy:journal.postedBy,
    postedAt:new Date(journal.postedAt).toISOString(),
    tenantId:journal.tenantId,
    createdAt:new Date(journal.postedAt).toISOString(),
    updatedAt:new Date(journal.postedAt).toISOString(),
  };
}

function mapLedgerSnapshot(snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>){
  const journals=(snapshot.collections.journalEntries||[])
    .map(row=>row as unknown as GovernedJournalRecord)
    .map(toLegacyJournal);
  const governedJournals=(snapshot.collections.journalEntries||[])
    .map(row=>row as unknown as GovernedJournalRecord)
    .filter(journal=>journal.status==='POSTED');
  const accounts=(snapshot.collections.accounts||[])
    .map(row=>row as unknown as FinanceAccountRecord)
    .map((account):Account=>{
      let debit=0;
      let credit=0;
      for(const journal of governedJournals){
        for(const line of journal.lines){
          if(line.glAccountId!==account.accountCode) continue;
          debit+=line.debitMinorUnits;
          credit+=line.creditMinorUnits;
        }
      }
      const signed=account.normalBalance==='debit'
        ? debit-credit
        : credit-debit;
      return {
        id:account.accountId||account.id||account.accountCode,
        accountCode:account.accountCode,
        accountName:account.accountName,
        category:account.category,
        subCategory:account.subCategory,
        normalBalance:account.normalBalance,
        balance:signed/100,
        currency:account.currency,
        isActive:account.isActive,
        isSystemLocked:account.isSystemLocked,
        allowSupplierPayments:account.allowSupplierPayments,
        allowCashReceipts:account.allowCashReceipts,
        allowManualPosting:account.allowManualPosting,
        costCenterRequired:account.costCenterRequired,
        profitCenterRequired:account.profitCenterRequired,
        parentAccountCode:account.parentAccountCode,
        tenantId:account.tenantId,
        createdAt:account.createdAt,
        updatedAt:account.createdAt,
      };
    });
  return {accounts,journals};
}

export async function loadLocalFinanceLedger(tenantId:string){
  return mapLedgerSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateFinanceLedger(tenantId:string){
  return mapLedgerSnapshot(await hydrateEdgeSnapshot(tenantId));
}

export const capitalizeFixedAssetEdge=(
  payload:CapitalizeAssetPayload,
  idempotencyKey?:string
)=>run<{asset:FinanceFixedAssetRecord}>(
  'CapitalizeFixedAssetCommand',
  payload as unknown as Record<string,unknown>,
  idempotencyKey
);

export async function runDepreciationEdge(
  payload:{
    runId:string;
    fiscalYear:number;
    postingPeriod:number;
    currency:string;
    assetIds:string[];
  },
  idempotencyKey?:string
):Promise<DepreciationRunLog>{
  const result=await run<DepreciationRunRecord>(
    'RunDepreciationCommand',
    payload as Record<string,unknown>,
    idempotencyKey
  );
  return toLegacyRun(result);
}

export const transferFixedAssetEdge=(
  payload:{
    assetId:string;
    facilityId:string;
    costCenterId:string;
    transferredAt:number;
    reason:string;
  },
  idempotencyKey?:string
)=>run<FinanceFixedAssetRecord>(
  'TransferFixedAssetCommand',
  payload,
  idempotencyKey
);

export const disposeFixedAssetEdge=(
  payload:{
    assetId:string;
    disposedAt:number;
    proceedsMinorUnits:number;
    treasuryAccountCode?:string;
    reason:string;
  },
  idempotencyKey?:string
)=>run<FinanceFixedAssetRecord>(
  'DisposeFixedAssetCommand',
  payload,
  idempotencyKey
);

function toLegacyAsset(asset:FinanceFixedAssetRecord):FixedAsset{
  const category:FixedAsset['assetCategory'] =
    asset.assetCategory==='MEDICAL_EQUIPMENT'?'medical_equipment':
    asset.assetCategory==='IT_HARDWARE'?'it_hardware':
    asset.assetCategory==='FACILITY'?'facility':
    asset.assetCategory==='VEHICLE'?'vehicles':
    'medical_equipment';
  const status:FixedAsset['status'] =
    asset.status==='DISPOSED'?'disposed':
    asset.status==='FULLY_DEPRECIATED'?'fully_depreciated':
    'active';

  return {
    id:asset.assetId,
    assetTag:asset.assetTag,
    serialNumber:asset.serialNumber||'',
    assetName:asset.assetName,
    assetCategory:category,
    department:asset.costCenterId,
    location:asset.facilityId,
    purchaseDate:new Date(asset.acquisitionAt).toISOString().slice(0,10),
    inServiceDate:new Date(asset.inServiceAt).toISOString().slice(0,10),
    acquisitionCost:asset.acquisitionCostMinorUnits/100,
    salvageValue:asset.salvageValueMinorUnits/100,
    usefulLifeYears:asset.usefulLifeMonths/12,
    depreciationMethod:'straight_line',
    accumulatedDepreciation:asset.accumulatedDepreciationMinorUnits/100,
    currentBookValue:asset.bookValueMinorUnits/100,
    assetAccountCode:asset.assetAccountCode,
    accumulatedDepreciationAccountCode:asset.accumulatedDepreciationAccountCode,
    depreciationExpenseAccountCode:asset.depreciationExpenseAccountCode,
    status,
    tenantId:asset.tenantId,
    createdAt:asset.createdAt,
    updatedAt:asset.disposedAt
      ? new Date(asset.disposedAt).toISOString()
      : asset.createdAt,
  };
}

function toLegacyRun(run:DepreciationRunRecord):DepreciationRunLog{
  return {
    id:run.runId,
    runNumber:run.runId,
    runDate:run.postedAt,
    fiscalPeriod:`${run.fiscalYear}-${String(run.postingPeriod).padStart(2,'0')}`,
    totalDepreciationPosted:run.totalDepreciationMinorUnits/100,
    assetsProcessedCount:run.journalIds.length,
    journalEntryId:run.journalIds[0]||'',
    assetBreakdown:[],
    postedBy:run.postedBy,
    status:'posted',
    tenantId:run.tenantId,
    createdAt:run.postedAt,
  };
}

function mapSnapshot(snapshot:Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>){
  return {
    assets:(snapshot.collections.financeFixedAssets||[])
      .map(row=>toLegacyAsset(row as unknown as FinanceFixedAssetRecord)),
    depreciationRuns:(snapshot.collections.financeDepreciationRuns||[])
      .map(row=>toLegacyRun(row as unknown as DepreciationRunRecord)),
  };
}

export async function loadLocalFinanceAssets(tenantId:string){
  return mapSnapshot(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateFinanceAssets(tenantId:string){
  return mapSnapshot(await hydrateEdgeSnapshot(tenantId));
}
