import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  BankReconciliationRecord,
  CashShiftRecord,
  DepreciationRunRecord,
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinanceCloseRecord,
  FinanceFixedAssetRecord,
  FinancePeriodRecord,
  FinancialStatementSnapshot,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import type { InventoryPeriodCloseRecord } from '@/types/scm-costing';
import type { SupplierInvoiceRecord } from '@/types/scm-payables';
import {
  buildTrialBalance,
  financePeriodId,
  stableFinanceFingerprint,
} from '@/lib/finance/finance-engine';

export interface StartFinanceClosePayload {
  closeId:string;
  fiscalYear:number;
  postingPeriod:number;
  currency:string;
}

export interface FinalizeFinanceClosePayload extends StartFinanceClosePayload {
  statementSnapshotId:string;
}

export interface LockFinancePeriodPayload {
  closeId:string;
  fiscalYear:number;
  postingPeriod:number;
  reason:string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function accountEnding(lines:ReturnType<typeof buildTrialBalance>['lines'],code:string):number{
  return lines.find(line=>line.accountCode===code)?.endingBalanceMinorUnits||0;
}

export class FinanceCloseDomainService {
  public static async startClose(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:StartFinanceClosePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Finance close authority required.');
    try{
      const periodId=financePeriodId(payload.fiscalYear,payload.postingPeriod);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FINANCE_MANAGER',
        aggregateType:'FINANCE_CLOSE',aggregateId:payload.closeId,eventType:'FINANCE_PERIOD_CLOSE_STARTED',
        auditAction:'FINANCE_PERIOD_CLOSE_STARTED',auditResourceType:'FINANCE_CLOSE',auditResourceId:payload.closeId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true}],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_CLOSABLE','Finance period must be OPEN or SOFT_CLOSE to begin close.');
          if(period.endAt>Date.now())throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_ENDED','Finance period cannot close before period end.');
          const now=new Date().toISOString();
          const close:FinanceCloseRecord={
            closeId:payload.closeId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,postingPeriod:payload.postingPeriod,
            periodId,currency:payload.currency.toUpperCase(),status:'CLOSING',startedAt:now,startedBy:context.actorId,
            checklist:{trialBalanceBalanced:false,inventoryClosed:false,apReconciled:false,arReconciled:false,cashReconciled:false,depreciationPosted:false},
          };
          const nextPeriod:FinancePeriodRecord={...period,status:'CLOSING',startedClosingAt:now,startedClosingBy:context.actorId};
          return {domainState:close,additionalStateWrites:[{entityType:'FINANCE_PERIOD',entityId:periodId,domainState:nextPeriod}],
            eventPayload:{closeId:payload.closeId,periodId,currency:close.currency},
            auditReason:`Started finance close for ${period.periodKey}; finance posting is frozen.`,resultData:close};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.closeId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async finalizeClose(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:FinalizeFinanceClosePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Finance close finalization authority required.');
    try{
      const periodId=financePeriodId(payload.fiscalYear,payload.postingPeriod);
      const currency=payload.currency.toUpperCase();
      const [accounts,journals,arItems,apInvoices,inventoryCloses,bankRecons,cashShifts,depreciationRuns,assets]=await Promise.all([
        DomainStateRepository.list<FinanceAccountRecord>(context.tenantId,'accounts',50000),
        DomainStateRepository.queryAllEqual<GovernedJournalRecord>(context.tenantId,'journalEntries','fiscalYear',payload.fiscalYear,{pageSize:500,maxRows:500000}),
        DomainStateRepository.list<FinanceArOpenItem>(context.tenantId,'arOpenItems',200000),
        DomainStateRepository.list<SupplierInvoiceRecord>(context.tenantId,'scmSupplierInvoices',200000),
        DomainStateRepository.list<InventoryPeriodCloseRecord>(context.tenantId,'scmInventoryPeriodCloses',50000),
        DomainStateRepository.list<BankReconciliationRecord>(context.tenantId,'financeBankReconciliations',50000),
        DomainStateRepository.list<CashShiftRecord>(context.tenantId,'cashRegisterShifts',100000),
        DomainStateRepository.list<DepreciationRunRecord>(context.tenantId,'financeDepreciationRuns',10000),
        DomainStateRepository.list<FinanceFixedAssetRecord>(context.tenantId,'financeFixedAssets',100000),
      ]);
      const relevantAccounts=accounts.filter(a=>a.currency===currency);
      const trial=buildTrialBalance({journals,accounts:relevantAccounts,fiscalYear:payload.fiscalYear,throughPostingPeriod:payload.postingPeriod,currency});
      if(!trial.balanced)throw new AtomicMutationRejectedError('TRIAL_BALANCE_IMBALANCED','Finance close requires balanced Universal Journal.');

      const periodEnd=Date.UTC(payload.fiscalYear,payload.postingPeriod,0,23,59,59,999);
      const arOutstanding=arItems.filter(i=>i.currency===currency&&i.issueAt<=periodEnd).reduce((sum,i)=>sum+i.outstandingMinorUnits,0);
      const apOutstanding=apInvoices.filter(i=>i.currency===currency&&['PAYABLE_RECOGNIZED','PARTIALLY_PAID'].includes(i.status))
        .reduce((sum,i)=>sum+i.balanceMinorUnits,0);
      const arGl=accountEnding(trial.lines,'1110');
      const apGl=accountEnding(trial.lines,'2010');
      const arReconciled=Math.abs(arGl-arOutstanding)<=1;
      const apReconciled=Math.abs(apGl-apOutstanding)<=1;
      if(!arReconciled||!apReconciled)throw new AtomicMutationRejectedError(
        'FINANCE_SUBLEDGER_RECONCILIATION_FAILED',
        'AR/AP subledgers do not reconcile to GL control accounts.',
        {arGl,arOutstanding,apGl,apOutstanding}
      );

      const periodKey=`${payload.fiscalYear}-${String(payload.postingPeriod).padStart(2,'0')}`;
      const inventoryForPeriod=inventoryCloses.filter(c=>c.periodKey===periodKey);
      const inventoryClosed=inventoryForPeriod.length>0&&inventoryForPeriod.every(c=>c.status==='CLOSED');
      if(!inventoryClosed)throw new AtomicMutationRejectedError('INVENTORY_SUBLEDGER_NOT_CLOSED','Inventory period close must complete before finance close.');

      const bankForPeriod=bankRecons.filter(r=>{
        const d=new Date(r.statementDate);
        return d.getUTCFullYear()===payload.fiscalYear&&d.getUTCMonth()+1===payload.postingPeriod&&r.currency===currency;
      });
      const relevantShifts=cashShifts.filter(s=>{
        const d=new Date(s.openedAt);
        return d.getUTCFullYear()===payload.fiscalYear&&d.getUTCMonth()+1===payload.postingPeriod;
      });
      const cashReconciled=bankForPeriod.every(r=>r.status==='APPROVED'&&r.varianceMinorUnits===0)&&relevantShifts.every(s=>s.status==='CLOSED');
      if(!cashReconciled)throw new AtomicMutationRejectedError('TREASURY_NOT_RECONCILED','All period bank reconciliations and cash shifts must be approved/closed.');

      const depreciableAssets=assets.filter(a=>a.currency===currency&&a.status==='ACTIVE'&&a.inServiceAt<=periodEnd);
      const depreciationPosted=depreciableAssets.length===0||depreciationRuns.some(r=>r.fiscalYear===payload.fiscalYear&&r.postingPeriod===payload.postingPeriod&&r.currency===currency);
      if(!depreciationPosted)throw new AtomicMutationRejectedError('DEPRECIATION_NOT_POSTED','Monthly depreciation must be posted before finance close.');

      const assetsMinor=trial.lines.filter(l=>l.category==='asset').reduce((s,l)=>s+l.endingBalanceMinorUnits,0);
      const liabilitiesMinor=trial.lines.filter(l=>l.category==='liability').reduce((s,l)=>s+l.endingBalanceMinorUnits,0);
      const equityBase=trial.lines.filter(l=>l.category==='equity').reduce((s,l)=>s+l.endingBalanceMinorUnits,0);
      const revenue=trial.lines.filter(l=>l.category==='revenue').reduce((s,l)=>s+l.endingBalanceMinorUnits,0);
      const expense=trial.lines.filter(l=>l.category==='expense').reduce((s,l)=>s+l.endingBalanceMinorUnits,0);
      const surplus=revenue-expense;
      const equity=equityBase+surplus;

      let operating=0,investing=0,financing=0;
      for(const journal of journals){
        if(journal.status!=='POSTED'||journal.fiscalYear!==payload.fiscalYear||journal.postingPeriod>payload.postingPeriod||journal.currency!==currency)continue;
        const cashMovement=journal.lines.filter(l=>['1010','1020'].includes(l.glAccountId)).reduce((s,l)=>s+l.debitMinorUnits-l.creditMinorUnits,0);
        if(!cashMovement)continue;
        if(journal.sourceModule==='ASSETS')investing+=cashMovement;
        else if(journal.lines.some(l=>['equity','liability'].includes(relevantAccounts.find(a=>a.accountCode===l.glAccountId)?.category||''))&&journal.sourceModule==='MANUAL')financing+=cashMovement;
        else operating+=cashMovement;
      }
      const statement:FinancialStatementSnapshot={
        snapshotId:payload.statementSnapshotId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,
        postingPeriod:payload.postingPeriod,currency,generatedAt:new Date().toISOString(),generatedBy:context.actorId,
        balanceSheet:{assetsMinorUnits:assetsMinor,liabilitiesMinorUnits:liabilitiesMinor,equityMinorUnits:equity,balanced:Math.abs(assetsMinor-(liabilitiesMinor+equity))<=1},
        incomeStatement:{revenueMinorUnits:revenue,expenseMinorUnits:expense,surplusMinorUnits:surplus},
        cashFlow:{operatingMinorUnits:operating,investingMinorUnits:investing,financingMinorUnits:financing,netChangeMinorUnits:operating+investing+financing},
        inputFingerprint:stableFinanceFingerprint({trial:trial.lines,journals:journals.map(j=>[j.journalId,j.status,j.totalAmountMinorUnits]),arOutstanding,apOutstanding}),
      };
      if(!statement.balanceSheet.balanced)throw new AtomicMutationRejectedError('BALANCE_SHEET_IMBALANCED','Derived balance sheet does not satisfy Assets = Liabilities + Equity.');

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FINANCE_MANAGER',
        aggregateType:'FINANCE_CLOSE',aggregateId:payload.closeId,eventType:'FINANCE_PERIOD_CLOSED',
        auditAction:'FINANCE_PERIOD_CLOSED',auditResourceType:'FINANCE_CLOSE',auditResourceId:payload.closeId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'close',entityType:'FINANCE_CLOSE',entityId:payload.closeId,required:true},
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
        ],
        prepare:(current)=>{
          const close=current.close as unknown as FinanceCloseRecord;
          const period=current.period as unknown as FinancePeriodRecord;
          if(close.status!=='CLOSING'||period.status!=='CLOSING')throw new AtomicMutationRejectedError('FINANCE_CLOSE_STATE_CHANGED','Finance close/period is not in CLOSING state.');
          const now=new Date().toISOString();
          const nextClose:FinanceCloseRecord={
            ...close,status:'CLOSED',checklist:{trialBalanceBalanced:true,inventoryClosed:true,apReconciled:true,arReconciled:true,cashReconciled:true,depreciationPosted:true},
            statementSnapshotId:payload.statementSnapshotId,closedAt:now,closedBy:context.actorId,
          };
          const nextPeriod:FinancePeriodRecord={...period,status:'CLOSED',closedAt:now,closedBy:context.actorId};
          return {domainState:nextClose,additionalStateWrites:[
            {entityType:'FINANCE_PERIOD',entityId:periodId,domainState:nextPeriod},
            {entityType:'FINANCIAL_STATEMENT_SNAPSHOT',entityId:payload.statementSnapshotId,domainState:statement},
          ],eventPayload:{closeId:payload.closeId,periodId,statementSnapshotId:payload.statementSnapshotId,inputFingerprint:statement.inputFingerprint},
          auditReason:`Closed finance period ${period.periodKey} after all subledgers reconciled.`,
          resultData:{close:nextClose,period:nextPeriod,statements:statement}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.closeId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async lockPeriod(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:LockFinancePeriodPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Finance period lock authority required.');
    try{
      const periodId=financePeriodId(payload.fiscalYear,payload.postingPeriod);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FINANCE_MANAGER',
        aggregateType:'FINANCE_CLOSE',aggregateId:payload.closeId,eventType:'FINANCE_PERIOD_LOCKED',
        auditAction:'FINANCE_PERIOD_LOCKED',auditResourceType:'FINANCE_CLOSE',auditResourceId:payload.closeId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'close',entityType:'FINANCE_CLOSE',entityId:payload.closeId,required:true},
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
        ],
        prepare:(current)=>{
          const close=current.close as unknown as FinanceCloseRecord;
          const period=current.period as unknown as FinancePeriodRecord;
          if(close.status!=='CLOSED'||period.status!=='CLOSED')throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_CLOSED','Only a closed period may be permanently locked.');
          const now=new Date().toISOString();
          const nextClose:FinanceCloseRecord={...close,status:'LOCKED',lockedAt:now,lockedBy:context.actorId};
          const nextPeriod:FinancePeriodRecord={...period,status:'LOCKED',lockedAt:now,lockedBy:context.actorId};
          return {domainState:nextClose,additionalStateWrites:[{entityType:'FINANCE_PERIOD',entityId:periodId,domainState:nextPeriod}],
            eventPayload:{closeId:payload.closeId,periodId},auditReason:`Locked finance period ${period.periodKey}: ${payload.reason}`,resultData:{close:nextClose,period:nextPeriod}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.closeId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
