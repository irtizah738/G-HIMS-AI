import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { FinanceApAgingSnapshot, FinancePeriodRecord, GovernedJournalRecord } from '@/types/finance-domain';
import type { SupplierInvoiceRecord } from '@/types/scm-payables';
import { financePeriodId } from '@/lib/finance/finance-engine';

export interface GenerateApAgingPayload {
  snapshotId: string;
  asOf: number;
  currency: string;
}

export interface ApplySupplierCreditPayload {
  creditId: string;
  invoiceId: string;
  creditType: 'RETURN_CREDIT' | 'PRICE_CREDIT';
  amountMinorUnits: number;
  postingAt: number;
  supplierReference: string;
  reason: string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function apBucket(dueDate:string,asOf:number):'CURRENT'|'1_30'|'31_60'|'61_90'|'OVER_90'{
  const due=Date.parse(dueDate);
  if(!Number.isFinite(due))throw new AtomicMutationRejectedError('INVALID_AP_DUE_DATE','Supplier invoice has invalid due date.');
  const days=Math.floor((asOf-due)/86400000);
  if(days<=0)return 'CURRENT';
  if(days<=30)return '1_30';
  if(days<=60)return '31_60';
  if(days<=90)return '61_90';
  return 'OVER_90';
}

export class FinanceApDomainService {
  public static async generateAging(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:GenerateApAgingPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['ACCOUNTS_PAYABLE','ACCOUNTANT','FINANCE_MANAGER','AUDITOR','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'AP aging authority required.');
    if(!Number.isFinite(payload.asOf))return reject(commandId,idempotencyKey,'INVALID_AP_AGING_DATE','AP aging date is invalid.');
    const currency=payload.currency.trim().toUpperCase();
    try{
      const invoices=(await DomainStateRepository.list<SupplierInvoiceRecord>(
        context.tenantId,'scmSupplierInvoices',200000
      )).filter(invoice=>
        invoice.currency===currency &&
        invoice.balanceMinorUnits>0 &&
        ['PAYABLE_RECOGNIZED','PARTIALLY_PAID'].includes(invoice.status)
      );
      const totals={CURRENT:0,'1_30':0,'31_60':0,'61_90':0,OVER_90:0};
      invoices.forEach(invoice=>{
        const available=Math.max(0,invoice.balanceMinorUnits-invoice.pendingPaymentMinorUnits);
        totals[apBucket(invoice.dueDate,payload.asOf)]+=available;
      });
      const snapshot:FinanceApAgingSnapshot={
        snapshotId:payload.snapshotId,tenantId:context.tenantId,asOf:payload.asOf,currency,
        currentMinorUnits:totals.CURRENT,days1to30MinorUnits:totals['1_30'],
        days31to60MinorUnits:totals['31_60'],days61to90MinorUnits:totals['61_90'],
        over90MinorUnits:totals.OVER_90,
        totalOutstandingMinorUnits:Object.values(totals).reduce((a,b)=>a+b,0),
        invoiceCount:invoices.length,generatedAt:new Date().toISOString(),generatedBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'AP_AGING_SNAPSHOT',entityId:payload.snapshotId,
        eventType:'AP_AGING_SNAPSHOT_GENERATED',domainState:snapshot,
        eventPayload:{snapshotId:payload.snapshotId,asOf:payload.asOf,currency,totalOutstandingMinorUnits:snapshot.totalOutstandingMinorUnits},
        auditReason:`Generated AP aging as of ${new Date(payload.asOf).toISOString()}.`,
        outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:snapshot};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async applySupplierCredit(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ApplySupplierCreditPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['ACCOUNTS_PAYABLE','FINANCE_MANAGER','ACCOUNTANT','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Supplier credit authority required.');
    try{
      if(!Number.isSafeInteger(payload.amountMinorUnits)||payload.amountMinorUnits<=0){
        throw new AtomicMutationRejectedError('INVALID_SUPPLIER_CREDIT_AMOUNT','Supplier credit must be positive integer minor units.');
      }
      const invoice=await DomainStateRepository.getById<SupplierInvoiceRecord>(
        context.tenantId,'scmSupplierInvoices',payload.invoiceId
      );
      if(!invoice||!['PAYABLE_RECOGNIZED','PARTIALLY_PAID'].includes(invoice.status)){
        throw new AtomicMutationRejectedError('SUPPLIER_INVOICE_NOT_CREDITABLE','Supplier invoice is not an open recognized payable.');
      }
      const available=Math.max(0,invoice.balanceMinorUnits-invoice.pendingPaymentMinorUnits);
      if(payload.amountMinorUnits>available)throw new AtomicMutationRejectedError(
        'SUPPLIER_CREDIT_EXCEEDS_AVAILABLE_PAYABLE',
        'Supplier credit exceeds payable balance not reserved for payment.',
        {availableMinorUnits:available}
      );
      const date=new Date(payload.postingAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const offsetCode=payload.creditType==='RETURN_CREDIT'?'1250':'6030';
      const journalId=`je_ap_credit_${payload.creditId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.postingAt,postingDate:payload.postingAt,
        referenceDocumentId:payload.creditId,
        documentHeader:`Supplier credit ${payload.supplierReference}`,
        currency:invoice.currency,totalAmountMinorUnits:payload.amountMinorUnits,
        lines:[
          {glAccountId:'2010',glAccountName:'Accounts Payable - Medical & Trade Vendors',debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,lineDescription:'Reduce supplier payable'},
          {glAccountId:offsetCode,glAccountName:payload.creditType==='RETURN_CREDIT'?'Supplier Returns & Credit Receivable':'Purchase Price Variance',debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,lineDescription:payload.reason},
        ],
        sourceModule:'AP',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const credit={
        creditId:payload.creditId,tenantId:context.tenantId,invoiceId:invoice.invoiceId,
        supplierId:invoice.supplierId,supplierReference:payload.supplierReference,
        creditType:payload.creditType,amountMinorUnits:payload.amountMinorUnits,currency:invoice.currency,
        postingAt:payload.postingAt,reason:payload.reason,journalId,
        postedBy:context.actorId,postedAt:new Date().toISOString(),
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'ACCOUNTS_PAYABLE',
        aggregateType:'SUPPLIER_CREDIT',aggregateId:payload.creditId,
        eventType:'SUPPLIER_CREDIT_APPLIED',auditAction:'SUPPLIER_CREDIT_APPLIED',
        auditResourceType:'SUPPLIER_INVOICE',auditResourceId:payload.invoiceId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'invoice',entityType:'SUPPLIER_INVOICE',entityId:payload.invoiceId,required:true},
        ],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Supplier credit period is not open.');
          const live=current.invoice as unknown as SupplierInvoiceRecord;
          const currentAvailable=Math.max(0,live.balanceMinorUnits-live.pendingPaymentMinorUnits);
          if(payload.amountMinorUnits>currentAvailable)throw new AtomicMutationRejectedError(
            'SUPPLIER_CREDIT_EXCEEDS_AVAILABLE_PAYABLE','Payable state changed before supplier credit.'
          );
          const nextBalance=live.balanceMinorUnits-payload.amountMinorUnits;
          const next:SupplierInvoiceRecord={
            ...live,balanceMinorUnits:nextBalance,
            status:nextBalance===0?'PAID':live.amountPaidMinorUnits>0?'PARTIALLY_PAID':'PAYABLE_RECOGNIZED',
            updatedAt:new Date().toISOString(),
          };
          return {domainState:credit,additionalStateWrites:[
            {entityType:'SUPPLIER_INVOICE',entityId:live.invoiceId,domainState:next},
            {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
          ],eventPayload:{creditId:payload.creditId,invoiceId:live.invoiceId,amountMinorUnits:payload.amountMinorUnits,journalId},
          auditReason:`Applied supplier credit ${payload.supplierReference} to invoice ${live.invoiceNumber}.`,
          resultData:{credit,invoice:next,journal}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.creditId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
