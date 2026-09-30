import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  FinancePeriodRecord,
  GovernedJournalRecord,
  TaxCodeRecord,
  TaxLedgerItem,
} from '@/types/finance-domain';
import type { SupplierInvoiceRecord } from '@/types/scm-payables';
import { financePeriodId } from '@/lib/finance/finance-engine';

export interface CreateTaxCodePayload {
  taxCodeId:string;
  code:string;
  description:string;
  jurisdiction:string;
  taxType:'OUTPUT'|'INPUT'|'WITHHOLDING';
  rateBasisPoints:number;
  recoverablePercentBasisPoints?:number;
  payableAccountCode:string;
  recoverableAccountCode?:string;
  expenseAccountCode?:string;
  effectiveFrom:number;
  effectiveTo?:number;
}

export interface RecordSupplierWithholdingPayload {
  taxLedgerItemId:string;
  taxCodeId:string;
  invoiceId:string;
  taxableMinorUnits:number;
  postingAt:number;
}

export interface RemitTaxLiabilityPayload {
  remittanceId:string;
  taxCodeId:string;
  amountMinorUnits:number;
  treasuryAccountCode:string;
  postingAt:number;
  reference:string;
}

export interface GenerateTaxSummaryPayload {
  snapshotId:string;
  fiscalYear:number;
  throughPostingPeriod:number;
  currency:string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function amount(value:number,code:string){
  if(!Number.isSafeInteger(value)||value<=0)throw new AtomicMutationRejectedError(code,'Amount must be positive integer minor units.');
}

export class FinanceTaxDomainService {
  public static async createTaxCode(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CreateTaxCodePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['TAX_ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Tax code administration authority required.');
    try{
      if(!Number.isInteger(payload.rateBasisPoints)||payload.rateBasisPoints<0||payload.rateBasisPoints>10000){
        throw new AtomicMutationRejectedError('INVALID_TAX_RATE','Tax rate must be 0-10,000 basis points.');
      }
      if(
        payload.recoverablePercentBasisPoints!==undefined &&
        (!Number.isInteger(payload.recoverablePercentBasisPoints)||payload.recoverablePercentBasisPoints<0||payload.recoverablePercentBasisPoints>10000)
      )throw new AtomicMutationRejectedError('INVALID_TAX_RECOVERABILITY','Recoverability must be 0-10,000 basis points.');
      const record:TaxCodeRecord={
        ...payload,tenantId:context.tenantId,isActive:true,
        createdAt:new Date().toISOString(),createdBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'TAX_CODE',entityId:payload.taxCodeId,eventType:'TAX_CODE_CREATED',
        domainState:record,eventPayload:{taxCodeId:payload.taxCodeId,code:payload.code,taxType:payload.taxType,rateBasisPoints:payload.rateBasisPoints},
        auditReason:`Created tax code ${payload.code} for ${payload.jurisdiction}.`,outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.taxCodeId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async recordSupplierWithholding(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RecordSupplierWithholdingPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['TAX_ACCOUNTANT','ACCOUNTS_PAYABLE','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Supplier withholding authority required.');
    try{
      amount(payload.taxableMinorUnits,'INVALID_WITHHOLDING_TAXABLE_AMOUNT');
      const [taxCode,invoice]=await Promise.all([
        DomainStateRepository.getById<TaxCodeRecord>(context.tenantId,'financeTaxCodes',payload.taxCodeId),
        DomainStateRepository.getById<SupplierInvoiceRecord>(context.tenantId,'scmSupplierInvoices',payload.invoiceId),
      ]);
      if(!taxCode||!taxCode.isActive||taxCode.taxType!=='WITHHOLDING')throw new AtomicMutationRejectedError('WITHHOLDING_TAX_CODE_INVALID','Withholding tax code is not active.');
      if(!invoice||!['PAYABLE_RECOGNIZED','PARTIALLY_PAID'].includes(invoice.status))throw new AtomicMutationRejectedError('SUPPLIER_INVOICE_NOT_WITHHOLDABLE','Supplier invoice is not an open recognized payable.');
      if(payload.taxableMinorUnits>invoice.balanceMinorUnits-invoice.pendingPaymentMinorUnits)throw new AtomicMutationRejectedError('WITHHOLDING_EXCEEDS_AVAILABLE_PAYABLE','Withholding taxable base exceeds available payable.');
      if(payload.postingAt<taxCode.effectiveFrom||(taxCode.effectiveTo&&payload.postingAt>taxCode.effectiveTo))throw new AtomicMutationRejectedError('TAX_CODE_NOT_EFFECTIVE','Tax code is not effective at posting date.');
      const taxMinor=Math.floor(payload.taxableMinorUnits*taxCode.rateBasisPoints/10000);
      if(taxMinor<=0)throw new AtomicMutationRejectedError('WITHHOLDING_CALCULATES_ZERO','Withholding tax calculates to zero.');
      const date=new Date(payload.postingAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const journalId=`je_tax_wh_${payload.taxLedgerItemId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.postingAt,postingDate:payload.postingAt,
        referenceDocumentId:payload.invoiceId,documentHeader:`Supplier withholding tax ${invoice.invoiceNumber}`,
        currency:invoice.currency,totalAmountMinorUnits:taxMinor,
        lines:[
          {glAccountId:'2010',glAccountName:'Accounts Payable - Medical & Trade Vendors',debitMinorUnits:taxMinor,creditMinorUnits:0,lineDescription:'Reduce supplier payable for statutory withholding'},
          {glAccountId:taxCode.payableAccountCode,glAccountName:taxCode.payableAccountCode,debitMinorUnits:0,creditMinorUnits:taxMinor,lineDescription:`Recognize ${taxCode.code} withholding liability`},
        ],
        sourceModule:'TAX',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const item:TaxLedgerItem={
        taxLedgerItemId:payload.taxLedgerItemId,tenantId:context.tenantId,taxCodeId:payload.taxCodeId,
        sourceType:'SUPPLIER_INVOICE',sourceId:payload.invoiceId,taxableMinorUnits:payload.taxableMinorUnits,
        taxMinorUnits:taxMinor,recoverableMinorUnits:0,payableMinorUnits:taxMinor,currency:invoice.currency,
        postingAt:payload.postingAt,journalId,createdAt:new Date().toISOString(),
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'TAX_ACCOUNTANT',
        aggregateType:'TAX_LEDGER_ITEM',aggregateId:payload.taxLedgerItemId,eventType:'SUPPLIER_WITHHOLDING_RECORDED',
        auditAction:'SUPPLIER_WITHHOLDING_RECORDED',auditResourceType:'SUPPLIER_INVOICE',auditResourceId:payload.invoiceId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'invoice',entityType:'SUPPLIER_INVOICE',entityId:payload.invoiceId,required:true},
        ],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          const live=current.invoice as unknown as SupplierInvoiceRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Tax posting period is not open.');
          const available=live.balanceMinorUnits-live.pendingPaymentMinorUnits;
          if(taxMinor>available)throw new AtomicMutationRejectedError('WITHHOLDING_EXCEEDS_AVAILABLE_PAYABLE','Supplier payable changed before withholding.');
          const nextBalance=live.balanceMinorUnits-taxMinor;
          const next:SupplierInvoiceRecord={...live,balanceMinorUnits:nextBalance,status:nextBalance===0?'PAID':live.amountPaidMinorUnits>0?'PARTIALLY_PAID':'PAYABLE_RECOGNIZED',updatedAt:new Date().toISOString()};
          return {domainState:item,additionalStateWrites:[
            {entityType:'SUPPLIER_INVOICE',entityId:live.invoiceId,domainState:next},
            {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
          ],eventPayload:{taxLedgerItemId:item.taxLedgerItemId,invoiceId:live.invoiceId,taxMinorUnits:taxMinor,journalId},
          auditReason:`Recorded ${taxCode.code} withholding on supplier invoice ${live.invoiceNumber}.`,resultData:{tax:item,invoice:next,journal}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.taxLedgerItemId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async remitTax(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RemitTaxLiabilityPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['TAX_ACCOUNTANT','TREASURY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Tax remittance authority required.');
    try{
      amount(payload.amountMinorUnits,'INVALID_TAX_REMITTANCE_AMOUNT');
      const taxCode=await DomainStateRepository.getById<TaxCodeRecord>(context.tenantId,'financeTaxCodes',payload.taxCodeId);
      if(!taxCode||!taxCode.isActive)throw new AtomicMutationRejectedError('TAX_CODE_INVALID','Tax code is not active.');
      const date=new Date(payload.postingAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const journalId=`je_tax_remit_${payload.remittanceId}`;
      const record={...payload,tenantId:context.tenantId,journalId,status:'POSTED',postedBy:context.actorId,postedAt:new Date().toISOString()};
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.postingAt,postingDate:payload.postingAt,referenceDocumentId:payload.remittanceId,
        documentHeader:`Tax remittance ${payload.reference}`,currency:'PKR',
        totalAmountMinorUnits:payload.amountMinorUnits,
        lines:[
          {glAccountId:taxCode.payableAccountCode,glAccountName:taxCode.payableAccountCode,debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,lineDescription:`Settle ${taxCode.code} tax payable`},
          {glAccountId:payload.treasuryAccountCode,glAccountName:payload.treasuryAccountCode,debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,lineDescription:'Tax remittance from treasury'},
        ],
        sourceModule:'TAX',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'TAX_ACCOUNTANT',
        aggregateType:'TAX_REMITTANCE',aggregateId:payload.remittanceId,eventType:'TAX_LIABILITY_REMITTED',
        auditAction:'TAX_LIABILITY_REMITTED',auditResourceType:'TAX_REMITTANCE',auditResourceId:payload.remittanceId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true}],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Tax remittance period is not open.');
          return {domainState:record,additionalStateWrites:[{entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal}],
            eventPayload:{remittanceId:payload.remittanceId,taxCodeId:payload.taxCodeId,amountMinorUnits:payload.amountMinorUnits,journalId},
            auditReason:`Remitted tax liability ${payload.reference}.`,resultData:{remittance:record,journal}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.remittanceId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async generateTaxSummary(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:GenerateTaxSummaryPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['TAX_ACCOUNTANT','ACCOUNTANT','FINANCE_MANAGER','AUDITOR','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Tax reporting authority required.');
    const currency=payload.currency.toUpperCase();
    const journals=(await DomainStateRepository.queryAllEqual<GovernedJournalRecord>(
      context.tenantId,'journalEntries','fiscalYear',payload.fiscalYear,{pageSize:500,maxRows:500000}
    )).filter(j=>j.status==='POSTED'&&j.postingPeriod<=payload.throughPostingPeriod&&j.currency===currency);
    let outputTax=0,inputTax=0,withholding=0;
    for(const journal of journals){
      for(const line of journal.lines){
        if(line.glAccountId==='2040')outputTax+=line.creditMinorUnits-line.debitMinorUnits;
        if(line.glAccountId==='1230')inputTax+=line.debitMinorUnits-line.creditMinorUnits;
        if(line.glAccountId==='2050')withholding+=line.creditMinorUnits-line.debitMinorUnits;
      }
    }
    const netIndirectTax=Math.max(0,outputTax-inputTax);
    const snapshot={
      snapshotId:payload.snapshotId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,
      throughPostingPeriod:payload.throughPostingPeriod,currency,
      outputTaxPayableMinorUnits:outputTax,inputTaxRecoverableMinorUnits:inputTax,
      netIndirectTaxPayableMinorUnits:netIndirectTax,withholdingPayableMinorUnits:withholding,
      generatedAt:new Date().toISOString(),generatedBy:context.actorId,
    };
    const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
      entityType:'TAX_SUMMARY_SNAPSHOT',entityId:payload.snapshotId,eventType:'TAX_SUMMARY_GENERATED',
      domainState:snapshot,eventPayload:{snapshotId:payload.snapshotId,netIndirectTaxPayableMinorUnits:netIndirectTax,withholdingPayableMinorUnits:withholding},
      auditReason:`Generated tax summary through ${payload.fiscalYear}-${String(payload.throughPostingPeriod).padStart(2,'0')}.`,
      outboxTopic:'g-hims-finance-events',
    });
    return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:snapshot};
  }
}
