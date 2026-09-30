import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  CapitalizeAssetPayload,
  DepreciationRunRecord,
  FinanceFixedAssetRecord,
  FinancePeriodRecord,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import {
  financePeriodId,
  straightLineMonthlyDepreciationMinorUnits,
} from '@/lib/finance/finance-engine';

export interface RunDepreciationPayload {
  runId:string;
  fiscalYear:number;
  postingPeriod:number;
  currency:string;
  assetIds:string[];
}

export interface TransferFixedAssetPayload {
  assetId:string;
  facilityId:string;
  costCenterId:string;
  transferredAt:number;
  reason:string;
}

export interface DisposeFixedAssetPayload {
  assetId:string;
  disposedAt:number;
  proceedsMinorUnits:number;
  treasuryAccountCode?:string;
  reason:string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}
function assertAmount(value:number,code:string,allowZero=false){
  if(!Number.isSafeInteger(value)||(allowZero?value<0:value<=0))throw new AtomicMutationRejectedError(code,'Amount must be valid integer minor units.');
}

export class FinanceFixedAssetDomainService {
  public static async capitalize(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CapitalizeAssetPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FIXED_ASSET_ACCOUNTANT','ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Fixed asset capitalization authority required.');
    try{
      assertAmount(payload.acquisitionCostMinorUnits,'INVALID_ASSET_ACQUISITION_COST');
      assertAmount(payload.salvageValueMinorUnits,'INVALID_ASSET_SALVAGE_VALUE',true);
      if(payload.salvageValueMinorUnits>payload.acquisitionCostMinorUnits||!Number.isInteger(payload.usefulLifeMonths)||payload.usefulLifeMonths<1){
        throw new AtomicMutationRejectedError('INVALID_ASSET_DEPRECIATION_POLICY','Asset salvage value/useful life is invalid.');
      }
      const source=await DomainStateRepository.getById<GovernedJournalRecord>(
        context.tenantId,'journalEntries',payload.sourceReferenceId
      );
      if(!source||source.status!=='POSTED')throw new AtomicMutationRejectedError(
        'ASSET_CAPITALIZATION_SOURCE_JOURNAL_REQUIRED',
        'Capitalization requires a posted source journal.'
      );
      const currency=payload.currency.trim().toUpperCase();
      if(source.currency!==currency)throw new AtomicMutationRejectedError('ASSET_SOURCE_CURRENCY_MISMATCH','Capitalization currency must match source journal.');
      const clearingAvailable=source.lines.filter(line=>line.glAccountId==='1595')
        .reduce((sum,line)=>sum+line.debitMinorUnits-line.creditMinorUnits,0);
      const existing=(await DomainStateRepository.list<FinanceFixedAssetRecord>(
        context.tenantId,'financeFixedAssets',100000
      )).filter(asset=>asset.sourceReferenceId===payload.sourceReferenceId&&asset.status!=='DISPOSED');
      const alreadyCapitalized=existing.reduce((sum,asset)=>sum+asset.acquisitionCostMinorUnits,0);
      if(payload.acquisitionCostMinorUnits>clearingAvailable-alreadyCapitalized){
        throw new AtomicMutationRejectedError(
          'ASSET_CAPITALIZATION_EXCEEDS_SOURCE_CLEARING',
          'Asset capitalization exceeds unallocated capital-expenditure clearing evidence.',
          {clearingAvailable,alreadyCapitalized}
        );
      }
      const date=new Date(payload.inServiceAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const journalId=`je_asset_cap_${payload.assetId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.acquisitionAt,postingDate:payload.inServiceAt,
        referenceDocumentId:payload.assetId,documentHeader:`Capitalize fixed asset ${payload.assetTag}`,
        currency,totalAmountMinorUnits:payload.acquisitionCostMinorUnits,
        lines:[
          {glAccountId:payload.assetAccountCode,glAccountName:payload.assetAccountCode,costCenterId:payload.costCenterId,debitMinorUnits:payload.acquisitionCostMinorUnits,creditMinorUnits:0,lineDescription:`Capitalize ${payload.assetName}`},
          {glAccountId:'1595',glAccountName:'Capital Expenditure Clearing',costCenterId:payload.costCenterId,debitMinorUnits:0,creditMinorUnits:payload.acquisitionCostMinorUnits,lineDescription:`Clear capitalization source ${payload.sourceReferenceId}`},
        ],
        sourceModule:'ASSETS',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const asset:FinanceFixedAssetRecord={
        ...payload,tenantId:context.tenantId,currency,accumulatedDepreciationMinorUnits:0,
        bookValueMinorUnits:payload.acquisitionCostMinorUnits,monthsDepreciated:0,status:'ACTIVE',
        capitalizationJournalId:journalId,createdAt:new Date().toISOString(),createdBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'FIXED_ASSET',aggregateId:payload.assetId,eventType:'FIXED_ASSET_CAPITALIZED',
        auditAction:'FIXED_ASSET_CAPITALIZED',auditResourceType:'FIXED_ASSET',auditResourceId:payload.assetId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true}],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Capitalization period is not open.');
          return {domainState:asset,additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{assetId:payload.assetId,assetTag:payload.assetTag,acquisitionCostMinorUnits:payload.acquisitionCostMinorUnits,journalId},
            auditReason:`Capitalized fixed asset ${payload.assetTag} from source journal ${payload.sourceReferenceId}.`,resultData:{asset,journal}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.assetId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async runDepreciation(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RunDepreciationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FIXED_ASSET_ACCOUNTANT','ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Depreciation posting authority required.');
    try{
      const unique=[...new Set(payload.assetIds)];
      if(!unique.length||unique.length!==payload.assetIds.length||unique.length>500)throw new AtomicMutationRejectedError('INVALID_DEPRECIATION_ASSET_SET','Depreciation run requires 1-500 unique assets.');
      const periodId=financePeriodId(payload.fiscalYear,payload.postingPeriod);
      const assets=await Promise.all(unique.map(id=>DomainStateRepository.getById<FinanceFixedAssetRecord>(context.tenantId,'financeFixedAssets',id)));
      if(assets.some(asset=>!asset))throw new AtomicMutationRejectedError('FIXED_ASSET_NOT_FOUND','One or more fixed assets do not exist.');
      const currency=payload.currency.trim().toUpperCase();
      const period=await DomainStateRepository.getById<FinancePeriodRecord>(context.tenantId,'accountingPeriods',periodId);
      if(!period||!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Depreciation period is not open.');
      const existing=(await DomainStateRepository.list<DepreciationRunRecord>(context.tenantId,'financeDepreciationRuns',10000))
        .find(run=>run.fiscalYear===payload.fiscalYear&&run.postingPeriod===payload.postingPeriod&&run.currency===currency);
      if(existing)throw new AtomicMutationRejectedError('DEPRECIATION_PERIOD_ALREADY_POSTED','A depreciation run already exists for this period/currency.');

      const writes:any[]=[];const journalIds:string[]=[];let total=0;
      for(const asset of assets as FinanceFixedAssetRecord[]){
        if(asset.currency!==currency||asset.status!=='ACTIVE')continue;
        if(asset.inServiceAt>period.endAt)continue;
        const amount=straightLineMonthlyDepreciationMinorUnits({
          acquisitionCostMinorUnits:asset.acquisitionCostMinorUnits,
          salvageValueMinorUnits:asset.salvageValueMinorUnits,
          usefulLifeMonths:asset.usefulLifeMonths,
          monthsDepreciated:asset.monthsDepreciated,
        });
        if(amount<=0)continue;
        const journalId=`je_dep_${payload.runId}_${asset.assetId}`;
        const journal:GovernedJournalRecord={
          journalId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,postingPeriod:payload.postingPeriod,
          documentDate:period.endAt,postingDate:period.endAt,referenceDocumentId:payload.runId,
          documentHeader:`Monthly depreciation ${asset.assetTag}`,currency,totalAmountMinorUnits:amount,
          lines:[
            {glAccountId:asset.depreciationExpenseAccountCode,glAccountName:asset.depreciationExpenseAccountCode,costCenterId:asset.costCenterId,debitMinorUnits:amount,creditMinorUnits:0,lineDescription:`Depreciation ${asset.assetTag}`},
            {glAccountId:asset.accumulatedDepreciationAccountCode,glAccountName:asset.accumulatedDepreciationAccountCode,costCenterId:asset.costCenterId,debitMinorUnits:0,creditMinorUnits:amount,lineDescription:`Accumulated depreciation ${asset.assetTag}`},
          ],
          sourceModule:'ASSETS',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
        };
        const accumulated=asset.accumulatedDepreciationMinorUnits+amount;
        const book=Math.max(asset.salvageValueMinorUnits,asset.acquisitionCostMinorUnits-accumulated);
        const next:FinanceFixedAssetRecord={
          ...asset,accumulatedDepreciationMinorUnits:accumulated,bookValueMinorUnits:book,
          monthsDepreciated:asset.monthsDepreciated+1,
          status:book<=asset.salvageValueMinorUnits?'FULLY_DEPRECIATED':'ACTIVE',
        };
        writes.push(
          {entityType:'FIXED_ASSET',entityId:asset.assetId,domainState:next},
          {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
        );
        journalIds.push(journalId);total+=amount;
      }
      const run:DepreciationRunRecord={
        runId:payload.runId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,postingPeriod:payload.postingPeriod,
        currency,assetIds:unique,totalDepreciationMinorUnits:total,journalIds,postedBy:context.actorId,postedAt:new Date().toISOString(),
      };
      const tx=await TransactionManager.executeAtomicMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'DEPRECIATION_RUN',aggregateId:payload.runId,eventType:'DEPRECIATION_RUN_POSTED',
        eventPayload:{runId:payload.runId,totalDepreciationMinorUnits:total,journalIds},
        auditAction:'DEPRECIATION_RUN_POSTED',auditResourceType:'DEPRECIATION_RUN',auditResourceId:payload.runId,
        auditReason:`Posted depreciation run ${payload.runId}.`,outboxTopic:'g-hims-finance-events',
        idempotencyKey,commandId,correlationId:context.correlationId,domainState:run,additionalStateWrites:writes,
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.runId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:run};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async transferAsset(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:TransferFixedAssetPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FIXED_ASSET_ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Fixed asset transfer authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FIXED_ASSET_ACCOUNTANT',
        aggregateType:'FIXED_ASSET',aggregateId:payload.assetId,eventType:'FIXED_ASSET_TRANSFERRED',
        auditAction:'FIXED_ASSET_TRANSFERRED',auditResourceType:'FIXED_ASSET',auditResourceId:payload.assetId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'asset',entityType:'FIXED_ASSET',entityId:payload.assetId,required:true}],
        prepare:(current)=>{
          const asset=current.asset as unknown as FinanceFixedAssetRecord;
          if(asset.status==='DISPOSED')throw new AtomicMutationRejectedError('FIXED_ASSET_DISPOSED','Disposed asset cannot be transferred.');
          const from={facilityId:asset.facilityId,costCenterId:asset.costCenterId};
          const next:FinanceFixedAssetRecord={...asset,facilityId:payload.facilityId,costCenterId:payload.costCenterId};
          return {domainState:next,eventPayload:{assetId:asset.assetId,from,to:{facilityId:payload.facilityId,costCenterId:payload.costCenterId},transferredAt:payload.transferredAt},
            auditReason:`Transferred asset ${asset.assetTag}: ${payload.reason}`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.assetId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async disposeAsset(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:DisposeFixedAssetPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FIXED_ASSET_ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Fixed asset disposal authority required.');
    try{
      assertAmount(payload.proceedsMinorUnits,'INVALID_ASSET_DISPOSAL_PROCEEDS',true);
      const preflight=await DomainStateRepository.getById<FinanceFixedAssetRecord>(context.tenantId,'financeFixedAssets',payload.assetId);
      if(!preflight||preflight.status==='DISPOSED')throw new AtomicMutationRejectedError('FIXED_ASSET_NOT_DISPOSABLE','Fixed asset does not exist or is already disposed.');
      if(payload.proceedsMinorUnits>0&&!payload.treasuryAccountCode?.trim())throw new AtomicMutationRejectedError('ASSET_DISPOSAL_TREASURY_REQUIRED','Disposal proceeds require treasury GL account.');
      const date=new Date(payload.disposedAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const nbv=preflight.bookValueMinorUnits;
      const gain=Math.max(0,payload.proceedsMinorUnits-nbv);
      const loss=Math.max(0,nbv-payload.proceedsMinorUnits);
      const totalDebit=payload.proceedsMinorUnits+preflight.accumulatedDepreciationMinorUnits+loss;
      const totalCredit=preflight.acquisitionCostMinorUnits+gain;
      if(totalDebit!==totalCredit)throw new AtomicMutationRejectedError('ASSET_DISPOSAL_UNBALANCED','Asset disposal calculation is unbalanced.');
      const journalId=`je_asset_dispose_${payload.assetId}`;
      const lines:any[]=[
        ...(payload.proceedsMinorUnits>0?[{glAccountId:String(payload.treasuryAccountCode),glAccountName:String(payload.treasuryAccountCode),debitMinorUnits:payload.proceedsMinorUnits,creditMinorUnits:0,lineDescription:'Asset disposal proceeds'}]:[]),
        ...(preflight.accumulatedDepreciationMinorUnits>0?[{glAccountId:preflight.accumulatedDepreciationAccountCode,glAccountName:preflight.accumulatedDepreciationAccountCode,debitMinorUnits:preflight.accumulatedDepreciationMinorUnits,creditMinorUnits:0,lineDescription:'Clear accumulated depreciation'}]:[]),
        ...(loss>0?[{glAccountId:'6430',glAccountName:'Loss on Disposal of Fixed Assets',debitMinorUnits:loss,creditMinorUnits:0,lineDescription:'Recognize disposal loss'}]:[]),
        {glAccountId:preflight.assetAccountCode,glAccountName:preflight.assetAccountCode,debitMinorUnits:0,creditMinorUnits:preflight.acquisitionCostMinorUnits,lineDescription:'Derecognize fixed asset cost'},
        ...(gain>0?[{glAccountId:'4210',glAccountName:'Gain on Disposal of Fixed Assets',debitMinorUnits:0,creditMinorUnits:gain,lineDescription:'Recognize disposal gain'}]:[]),
      ];
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,documentDate:payload.disposedAt,postingDate:payload.disposedAt,
        referenceDocumentId:payload.assetId,documentHeader:`Dispose fixed asset ${preflight.assetTag}`,
        currency:preflight.currency,totalAmountMinorUnits:totalDebit,lines,sourceModule:'ASSETS',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FIXED_ASSET_ACCOUNTANT',
        aggregateType:'FIXED_ASSET',aggregateId:payload.assetId,eventType:'FIXED_ASSET_DISPOSED',
        auditAction:'FIXED_ASSET_DISPOSED',auditResourceType:'FIXED_ASSET',auditResourceId:payload.assetId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'asset',entityType:'FIXED_ASSET',entityId:payload.assetId,required:true},
        ],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          const asset=current.asset as unknown as FinanceFixedAssetRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Asset disposal period is not open.');
          if(asset.status==='DISPOSED'||asset.bookValueMinorUnits!==nbv)throw new AtomicMutationRejectedError('FIXED_ASSET_STATE_CHANGED','Asset state changed before disposal; retry required.');
          const next:FinanceFixedAssetRecord={...asset,status:'DISPOSED',disposedAt:payload.disposedAt,disposalJournalId:journalId};
          return {domainState:next,additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{assetId:asset.assetId,proceedsMinorUnits:payload.proceedsMinorUnits,gainMinorUnits:gain,lossMinorUnits:loss,journalId},
            auditReason:`Disposed fixed asset ${asset.assetTag}: ${payload.reason}`,resultData:{asset:next,journal,gainMinorUnits:gain,lossMinorUnits:loss}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.assetId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
