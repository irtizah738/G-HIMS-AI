'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';
import type {
  CapitalizeAssetPayload,
  DepreciationRunRecord,
  FinanceFixedAssetRecord,
} from '@/types/finance-domain';
import type {
  DepreciationRunLog,
  FixedAsset,
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
