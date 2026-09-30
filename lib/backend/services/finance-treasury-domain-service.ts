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
  FinanceAccountRecord,
  FinancePeriodRecord,
  GovernedJournalRecord,
  TreasuryAccountRecord,
  TreasuryTransferPayload,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';

export interface RegisterTreasuryAccountPayload {
  treasuryAccountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  kind: 'CASH_DRAWER' | 'BANK';
  bankName?: string;
  maskedAccountNumber?: string;
  facilityId?: string;
  allowReceipts: boolean;
  allowPayments: boolean;
}

export interface OpenCashShiftPayload {
  shiftId: string;
  facilityId: string;
  registerId: string;
  treasuryAccountId: string;
  openedAt: number;
  openingFloatMinorUnits: number;
}

export interface CloseCashShiftPayload {
  shiftId: string;
  countedClosingMinorUnits: number;
  closedAt: number;
}

export interface ReviewCashShiftPayload {
  shiftId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

export interface PrepareBankReconciliationPayload {
  reconciliationId: string;
  treasuryAccountId: string;
  statementDate: number;
  statementEndingMinorUnits: number;
  depositsInTransitMinorUnits: number;
  outstandingPaymentsMinorUnits: number;
  currency: string;
}

export interface ApproveBankReconciliationPayload {
  reconciliationId: string;
  notes?: string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function assertPositiveMinorUnits(value:number,code:string){
  if(!Number.isSafeInteger(value)||value<=0)throw new AtomicMutationRejectedError(code,'Amount must be a positive integer in minor currency units.');
}

async function glAccountByCode(tenantId:string,code:string):Promise<FinanceAccountRecord>{
  const rows=await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
    tenantId,'accounts','accountCode',code,{pageSize:10,maxRows:10}
  );
  if(rows.length!==1)throw new AtomicMutationRejectedError(
    rows.length?'GL_ACCOUNT_CODE_NOT_UNIQUE':'GL_ACCOUNT_NOT_FOUND',
    `GL account ${code} must resolve uniquely.`
  );
  return rows[0];
}

function glNetDebitMinorUnits(journals:GovernedJournalRecord[],accountCode:string,through:number,currency:string):number{
  let value=0;
  for(const journal of journals){
    if(journal.status!=='POSTED'||journal.postingDate>through||journal.currency!==currency)continue;
    for(const line of journal.lines){
      if(line.glAccountId===accountCode)value+=line.debitMinorUnits-line.creditMinorUnits;
    }
  }
  return value;
}

export class FinanceTreasuryDomainService {
  public static async registerTreasuryAccount(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RegisterTreasuryAccountPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Treasury administration authority required.');
    try{
      const gl=await glAccountByCode(context.tenantId,payload.accountCode);
      const currency=payload.currency.trim().toUpperCase();
      if(gl.category!=='asset'||!gl.isActive||gl.currency!==currency){
        throw new AtomicMutationRejectedError('TREASURY_GL_ACCOUNT_INVALID','Treasury account must reference an active asset GL account in the same currency.');
      }
      if(payload.allowPayments&&!gl.allowSupplierPayments){
        throw new AtomicMutationRejectedError('TREASURY_PAYMENT_CAPABILITY_NOT_ENABLED','GL account is not authorized for governed payments.');
      }
      if(payload.allowReceipts&&payload.kind==='CASH_DRAWER'&&!gl.allowCashReceipts){
        throw new AtomicMutationRejectedError('TREASURY_RECEIPT_CAPABILITY_NOT_ENABLED','Cash GL account is not authorized for governed receipts.');
      }
      const record:TreasuryAccountRecord={
        ...payload,tenantId:context.tenantId,currency,isActive:true,
        createdAt:new Date().toISOString(),createdBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'TREASURY_ACCOUNT',entityId:payload.treasuryAccountId,
        eventType:'TREASURY_ACCOUNT_REGISTERED',domainState:record,
        eventPayload:{treasuryAccountId:payload.treasuryAccountId,accountCode:payload.accountCode,kind:payload.kind,currency},
        auditReason:`Registered governed treasury account ${payload.treasuryAccountId} against GL ${payload.accountCode}.`,
        outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.treasuryAccountId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async openCashShift(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:OpenCashShiftPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['CASHIER','BILLING_CLERK','BILLING_ADMIN','TREASURY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cash shift authority required.');
    try{
      if(!Number.isSafeInteger(payload.openingFloatMinorUnits)||payload.openingFloatMinorUnits<0){
        throw new AtomicMutationRejectedError('INVALID_OPENING_FLOAT','Opening float must be non-negative minor units.');
      }
      const treasury=await DomainStateRepository.getById<TreasuryAccountRecord>(
        context.tenantId,'treasuryAccounts',payload.treasuryAccountId
      );
      if(!treasury||!treasury.isActive||treasury.kind!=='CASH_DRAWER'||!treasury.allowReceipts){
        throw new AtomicMutationRejectedError('CASH_DRAWER_NOT_ACTIVE','Cash shift requires an active receipt-enabled cash drawer.');
      }
      const existing=(await DomainStateRepository.list<CashShiftRecord>(
        context.tenantId,'cashRegisterShifts',50000
      )).find(shift=>
        shift.status==='OPEN'&&
        (shift.cashierId===context.actorId||
         (shift.facilityId===payload.facilityId&&shift.registerId===payload.registerId))
      );
      if(existing)throw new AtomicMutationRejectedError(
        'CASH_SHIFT_ALREADY_OPEN',
        'Cashier or register already has an open shift.',
        {shiftId:existing.shiftId}
      );
      const record:CashShiftRecord={
        shiftId:payload.shiftId,tenantId:context.tenantId,facilityId:payload.facilityId,
        registerId:payload.registerId,treasuryAccountId:payload.treasuryAccountId,
        cashierId:context.actorId,openedAt:payload.openedAt,
        openingFloatMinorUnits:payload.openingFloatMinorUnits,
        expectedClosingMinorUnits:payload.openingFloatMinorUnits,status:'OPEN',openedBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'CASH_SHIFT',entityId:payload.shiftId,eventType:'CASH_SHIFT_OPENED',
        domainState:record,eventPayload:{shiftId:payload.shiftId,registerId:payload.registerId,facilityId:payload.facilityId},
        auditReason:`Opened cash register shift ${payload.shiftId}.`,outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.shiftId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async closeCashShift(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CloseCashShiftPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['CASHIER','BILLING_CLERK','BILLING_ADMIN','TREASURY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cash shift close authority required.');
    try{
      if(!Number.isSafeInteger(payload.countedClosingMinorUnits)||payload.countedClosingMinorUnits<0){
        throw new AtomicMutationRejectedError('INVALID_CASH_COUNT','Counted closing cash must be non-negative minor units.');
      }
      const preflight=await DomainStateRepository.getById<CashShiftRecord>(
        context.tenantId,'cashRegisterShifts',payload.shiftId
      );
      if(!preflight||preflight.status!=='OPEN')throw new AtomicMutationRejectedError('CASH_SHIFT_NOT_OPEN','Cash shift is not open.');
      if(preflight.cashierId!==context.actorId&&!context.roles.some(r=>['TREASURY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'].includes(r))){
        throw new AtomicMutationRejectedError('CASH_SHIFT_CASHIER_MISMATCH','Only the cashier or treasury authority may close this shift.');
      }
      const receipts=await DomainStateRepository.list<Record<string,unknown>>(
        context.tenantId,'cashReceipts',200000
      );
      const cashCollected=receipts
        .filter(receipt=>
          String(receipt.collectedBy||'')===preflight.cashierId&&
          Number(receipt.collectedAt||0)>=preflight.openedAt&&
          Number(receipt.collectedAt||0)<=payload.closedAt&&
          String(receipt.mode||'')==='CASH'
        )
        .reduce((sum,receipt)=>sum+Number(receipt.amountMinorUnits||0),0);
      if(!Number.isSafeInteger(cashCollected)||cashCollected<0)throw new AtomicMutationRejectedError('INVALID_CASH_RECEIPT_AGGREGATE','Cash receipt aggregate is invalid.');
      const expected=preflight.openingFloatMinorUnits+cashCollected;
      const variance=payload.countedClosingMinorUnits-expected;
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'CASHIER',
        aggregateType:'CASH_SHIFT',aggregateId:payload.shiftId,
        eventType:'CASH_SHIFT_CLOSED_FOR_REVIEW',auditAction:'CASH_SHIFT_CLOSED_FOR_REVIEW',
        auditResourceType:'CASH_SHIFT',auditResourceId:payload.shiftId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'shift',entityType:'CASH_SHIFT',entityId:payload.shiftId,required:true}],
        prepare:(current)=>{
          const shift=current.shift as unknown as CashShiftRecord;
          if(shift.status!=='OPEN')throw new AtomicMutationRejectedError('CASH_SHIFT_NOT_OPEN','Cash shift state changed before close.');
          const next:CashShiftRecord={
            ...shift,expectedClosingMinorUnits:expected,
            countedClosingMinorUnits:payload.countedClosingMinorUnits,varianceMinorUnits:variance,
            status:'AWAITING_REVIEW',closedBy:context.actorId,
          };
          return {domainState:next,eventPayload:{shiftId:shift.shiftId,expectedClosingMinorUnits:expected,countedClosingMinorUnits:payload.countedClosingMinorUnits,varianceMinorUnits:variance},
            auditReason:`Closed cash shift ${shift.shiftId} for treasury review with variance ${variance} minor units.`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.shiftId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async reviewCashShift(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ReviewCashShiftPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cash reconciliation authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'TREASURY_MANAGER',
        aggregateType:'CASH_SHIFT',aggregateId:payload.shiftId,
        eventType:payload.decision==='APPROVE'?'CASH_SHIFT_RECONCILED':'CASH_SHIFT_REVIEW_REJECTED',
        auditAction:payload.decision==='APPROVE'?'CASH_SHIFT_RECONCILED':'CASH_SHIFT_REVIEW_REJECTED',
        auditResourceType:'CASH_SHIFT',auditResourceId:payload.shiftId,outboxTopic:'g-hims-finance-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'shift',entityType:'CASH_SHIFT',entityId:payload.shiftId,required:true}],
        prepare:(current)=>{
          const shift=current.shift as unknown as CashShiftRecord;
          if(shift.status!=='AWAITING_REVIEW')throw new AtomicMutationRejectedError('CASH_SHIFT_NOT_REVIEWABLE','Cash shift is not awaiting review.');
          if(shift.cashierId===context.actorId)throw new AtomicMutationRejectedError('FINANCE_SEGREGATION_OF_DUTIES','Cashier cannot approve their own shift reconciliation.');
          const next:CashShiftRecord={
            ...shift,status:payload.decision==='APPROVE'?'CLOSED':'AWAITING_REVIEW',
            reviewedBy:context.actorId,reviewedAt:new Date().toISOString(),
          };
          return {domainState:next,eventPayload:{shiftId:shift.shiftId,decision:payload.decision,varianceMinorUnits:shift.varianceMinorUnits||0},
            auditReason:`${payload.decision} cash shift ${shift.shiftId}: ${payload.reason}`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.shiftId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async transfer(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:TreasuryTransferPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Treasury transfer authority required.');
    try{
      assertPositiveMinorUnits(payload.amountMinorUnits,'INVALID_TREASURY_TRANSFER_AMOUNT');
      if(payload.fromTreasuryAccountId===payload.toTreasuryAccountId)throw new AtomicMutationRejectedError('TREASURY_TRANSFER_SAME_ACCOUNT','Treasury transfer accounts must differ.');
      const [from,to]=await Promise.all([
        DomainStateRepository.getById<TreasuryAccountRecord>(context.tenantId,'treasuryAccounts',payload.fromTreasuryAccountId),
        DomainStateRepository.getById<TreasuryAccountRecord>(context.tenantId,'treasuryAccounts',payload.toTreasuryAccountId),
      ]);
      if(!from||!to||!from.isActive||!to.isActive)throw new AtomicMutationRejectedError('TREASURY_ACCOUNT_NOT_ACTIVE','Both treasury accounts must be active.');
      const currency=payload.currency.trim().toUpperCase();
      if(from.currency!==currency||to.currency!==currency)throw new AtomicMutationRejectedError('TREASURY_TRANSFER_CURRENCY_MISMATCH','Treasury transfer cannot cross currencies.');
      const date=new Date(payload.transferredAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const journalId=`je_treasury_${payload.transferId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.transferredAt,postingDate:payload.transferredAt,
        referenceDocumentId:payload.transferId,documentHeader:`Treasury transfer ${payload.reference}`,
        currency,totalAmountMinorUnits:payload.amountMinorUnits,
        lines:[
          {glAccountId:to.accountCode,glAccountName:to.accountName,debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,lineDescription:'Treasury transfer destination'},
          {glAccountId:from.accountCode,glAccountName:from.accountName,debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,lineDescription:'Treasury transfer source'},
        ],
        sourceModule:'TREASURY',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const record={...payload,tenantId:context.tenantId,currency,journalId,status:'POSTED',postedBy:context.actorId,postedAt:new Date().toISOString()};
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'TREASURY_MANAGER',
        aggregateType:'TREASURY_TRANSFER',aggregateId:payload.transferId,eventType:'TREASURY_TRANSFER_POSTED',
        auditAction:'TREASURY_TRANSFER_POSTED',auditResourceType:'TREASURY_TRANSFER',auditResourceId:payload.transferId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true}],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Treasury posting period is not open.');
          return {domainState:record,additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{transferId:payload.transferId,journalId,amountMinorUnits:payload.amountMinorUnits,currency},
            auditReason:`Posted treasury transfer ${payload.transferId}.`,resultData:{transfer:record,journal}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.transferId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async prepareBankReconciliation(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:PrepareBankReconciliationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['TREASURY_MANAGER','ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Bank reconciliation authority required.');
    try{
      const account=await DomainStateRepository.getById<TreasuryAccountRecord>(
        context.tenantId,'treasuryAccounts',payload.treasuryAccountId
      );
      if(!account||account.kind!=='BANK'||!account.isActive)throw new AtomicMutationRejectedError('BANK_ACCOUNT_NOT_ACTIVE','Bank reconciliation requires active bank treasury account.');
      const currency=payload.currency.trim().toUpperCase();
      if(account.currency!==currency)throw new AtomicMutationRejectedError('BANK_RECONCILIATION_CURRENCY_MISMATCH','Bank statement currency does not match treasury account.');
      for(const value of [payload.statementEndingMinorUnits,payload.depositsInTransitMinorUnits,payload.outstandingPaymentsMinorUnits]){
        if(!Number.isSafeInteger(value))throw new AtomicMutationRejectedError('INVALID_BANK_RECONCILIATION_AMOUNT','Bank reconciliation values must be integer minor units.');
      }
      const journals=await DomainStateRepository.list<GovernedJournalRecord>(
        context.tenantId,'journalEntries',500000
      );
      const glEnding=glNetDebitMinorUnits(journals,account.accountCode,payload.statementDate,currency);
      const adjustedStatement=payload.statementEndingMinorUnits+payload.depositsInTransitMinorUnits-payload.outstandingPaymentsMinorUnits;
      const adjustedGl=glEnding;
      const variance=adjustedStatement-adjustedGl;
      const record:BankReconciliationRecord={
        reconciliationId:payload.reconciliationId,tenantId:context.tenantId,
        treasuryAccountId:payload.treasuryAccountId,statementDate:payload.statementDate,currency,
        statementEndingMinorUnits:payload.statementEndingMinorUnits,glEndingMinorUnits:glEnding,
        depositsInTransitMinorUnits:payload.depositsInTransitMinorUnits,outstandingPaymentsMinorUnits:payload.outstandingPaymentsMinorUnits,
        adjustedStatementMinorUnits:adjustedStatement,adjustedGlMinorUnits:adjustedGl,varianceMinorUnits:variance,
        status:variance===0?'BALANCED':'DRAFT',preparedBy:context.actorId,preparedAt:new Date().toISOString(),
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'BANK_RECONCILIATION',entityId:payload.reconciliationId,eventType:'BANK_RECONCILIATION_PREPARED',
        domainState:record,eventPayload:{reconciliationId:payload.reconciliationId,varianceMinorUnits:variance,status:record.status},
        auditReason:`Prepared bank reconciliation ${payload.reconciliationId} with variance ${variance} minor units.`,
        outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.reconciliationId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async approveBankReconciliation(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ApproveBankReconciliationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Bank reconciliation approval authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FINANCE_MANAGER',
        aggregateType:'BANK_RECONCILIATION',aggregateId:payload.reconciliationId,
        eventType:'BANK_RECONCILIATION_APPROVED',auditAction:'BANK_RECONCILIATION_APPROVED',
        auditResourceType:'BANK_RECONCILIATION',auditResourceId:payload.reconciliationId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'reconciliation',entityType:'BANK_RECONCILIATION',entityId:payload.reconciliationId,required:true}],
        prepare:(current)=>{
          const record=current.reconciliation as unknown as BankReconciliationRecord;
          if(record.status!=='BALANCED'||record.varianceMinorUnits!==0)throw new AtomicMutationRejectedError('BANK_RECONCILIATION_NOT_BALANCED','Only zero-variance balanced reconciliations may be approved.');
          if(record.preparedBy===context.actorId)throw new AtomicMutationRejectedError('FINANCE_SEGREGATION_OF_DUTIES','Bank reconciliation preparer cannot approve their own reconciliation.');
          const next:BankReconciliationRecord={...record,status:'APPROVED',approvedBy:context.actorId,approvedAt:new Date().toISOString()};
          return {domainState:next,eventPayload:{reconciliationId:record.reconciliationId,status:'APPROVED'},
            auditReason:`Approved balanced bank reconciliation ${record.reconciliationId}. ${payload.notes||''}`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.reconciliationId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
