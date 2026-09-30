import { createHash } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { Invoice } from '@/types/billing';
import type {
  AdjustArPayload,
  FinanceAccountRecord,
  FinanceArAdjustment,
  FinanceArOpenItem,
  GovernedJournalRecord,
  RecognizePatientInvoicePayload,
  TreasuryAccountRecord,
  FinancePeriodRecord,
} from '@/types/finance-domain';
import {
  arAgingBucket,
  assertMinorUnits,
  calculateArOutstandingAsOf,
  financePeriodId,
} from '@/lib/finance/finance-engine';

export interface GenerateArAgingPayload {
  snapshotId: string;
  asOf: number;
  currency: string;
}

export interface RecordArReceiptPayload {
  receiptId: string;
  openItemId: string;
  treasuryAccountId: string;
  amountMinorUnits: number;
  receivedAt: number;
  method: 'BANK_TRANSFER' | 'CARD' | 'MOBILE_WALLET' | 'INSURANCE_SETTLEMENT';
  reference: string;
}

function reject(
  commandId:string,
  idempotencyKey:string,
  code:string,
  message:string,
  details?:unknown
):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function hashId(prefix:string,value:string):string{
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0,32)}`;
}

function minor(value:number):number{
  const result=Math.round(Number(value||0)*100);
  if(!Number.isSafeInteger(result)||result<0)throw new AtomicMutationRejectedError(
    'INVALID_INVOICE_MONETARY_STATE',
    'Authoritative invoice monetary state is invalid.'
  );
  return result;
}

async function resolveAccount(
  tenantId:string,
  accountCode:string
):Promise<FinanceAccountRecord>{
  const rows=await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
    tenantId,'accounts','accountCode',accountCode,{pageSize:10,maxRows:10}
  );
  if(rows.length!==1)throw new AtomicMutationRejectedError(
    rows.length?'GL_ACCOUNT_CODE_NOT_UNIQUE':'GL_ACCOUNT_NOT_FOUND',
    `GL account ${accountCode} must resolve uniquely.`
  );
  return rows[0];
}

export class FinanceArRevenueDomainService {
  public static async recognizeInvoice(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:RecognizePatientInvoicePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:[
        'BILLING_ADMIN','FINANCE_MANAGER','ACCOUNTANT',
        'SYSTEM_ADMIN','ADMINISTRATOR'
      ],
    });
    if(!auth.authorized)return reject(
      commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
      auth.reason||'Revenue recognition authority required.'
    );

    try{
      const invoice=await DomainStateRepository.getById<Invoice>(
        context.tenantId,'invoices',payload.invoiceId
      );
      if(!invoice)throw new AtomicMutationRejectedError(
        'INVOICE_NOT_FOUND','Invoice does not exist.'
      );
      if(invoice.patientId!==payload.patientId){
        throw new AtomicMutationRejectedError(
          'INVOICE_PATIENT_MISMATCH','Invoice patient identity mismatch.'
        );
      }
      if(payload.encounterId&&invoice.encounterId!==payload.encounterId){
        throw new AtomicMutationRejectedError(
          'INVOICE_ENCOUNTER_MISMATCH','Invoice encounter identity mismatch.'
        );
      }

      const patientMinor=minor(invoice.totalPatientDue);
      const payerMinor=minor(invoice.totalCoverage);
      if(
        patientMinor!==payload.patientResponsibilityMinorUnits ||
        payerMinor!==payload.payerResponsibilityMinorUnits
      ){
        throw new AtomicMutationRejectedError(
          'INVOICE_RESPONSIBILITY_MISMATCH',
          'Revenue recognition responsibility amounts must match the authoritative invoice.',
          {patientMinor,payerMinor}
        );
      }
      if(payerMinor>0&&!payload.payerId?.trim()){
        throw new AtomicMutationRejectedError(
          'PAYER_ID_REQUIRED','Payer responsibility requires authoritative payer identity.'
        );
      }

      const totalReceivable=patientMinor+payerMinor;
      const outputTaxMinor=minor(invoice.totalTax);
      if(outputTaxMinor>totalReceivable){
        throw new AtomicMutationRejectedError(
          'INVOICE_TAX_EXCEEDS_RECEIVABLE',
          'Authoritative invoice tax exceeds total receivable.'
        );
      }
      const revenueBaseMinor=totalReceivable-outputTaxMinor;
      const revenueTotal=payload.lines.reduce((sum,line)=>{
        assertMinorUnits(line.amountMinorUnits,'INVALID_REVENUE_LINE_AMOUNT');
        return sum+line.amountMinorUnits;
      },0);
      if(!Number.isSafeInteger(revenueTotal)||revenueTotal<0||revenueTotal!==revenueBaseMinor){
        throw new AtomicMutationRejectedError(
          'REVENUE_RECOGNITION_TOTAL_MISMATCH',
          'Revenue lines must equal authoritative receivable less output tax.'
        );
      }

      const currency=String((invoice as any).currency||payload.currency||'PKR').trim().toUpperCase();
      if(currency!==payload.currency.trim().toUpperCase()){
        throw new AtomicMutationRejectedError(
          'INVOICE_CURRENCY_MISMATCH','Revenue recognition currency does not match invoice.'
        );
      }
      const postingDate=payload.issueAt;
      const fiscalYear=new Date(postingDate).getUTCFullYear();
      const postingPeriod=new Date(postingDate).getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);

      const revenueAccounts=await Promise.all(
        [...new Set(payload.lines.map(line=>line.revenueAccountCode))].map(code=>
          resolveAccount(context.tenantId,code)
        )
      );
      const arAccount=await resolveAccount(context.tenantId,'1110');
      const outputTaxAccount=outputTaxMinor>0
        ? await resolveAccount(context.tenantId,'2040')
        : undefined;
      if(arAccount.category!=='asset'||arAccount.currency!==currency){
        throw new AtomicMutationRejectedError(
          'AR_CONTROL_ACCOUNT_INVALID','AR control account 1110 is invalid.'
        );
      }
      if(
        outputTaxAccount &&
        (outputTaxAccount.category!=='liability'||outputTaxAccount.currency!==currency)
      ){
        throw new AtomicMutationRejectedError(
          'OUTPUT_TAX_CONTROL_ACCOUNT_INVALID',
          'Output tax payable account 2040 is invalid.'
        );
      }
      for(const account of revenueAccounts){
        if(account.category!=='revenue'||!account.isActive||account.currency!==currency){
          throw new AtomicMutationRejectedError(
            'REVENUE_ACCOUNT_INVALID',
            `Account ${account.accountCode} is not an active revenue account in ${currency}.`
          );
        }
      }

      const recognitionId=hashId('revrec',`${context.tenantId}:${payload.invoiceId}`);
      const journalId=`je_${recognitionId}`;
      const patientOpenItemId=`ar_patient_${payload.invoiceId}`;
      const payerOpenItemId=`ar_payer_${payload.invoiceId}`;
      const now=new Date().toISOString();
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.issueAt,postingDate,
        referenceDocumentId:payload.invoiceId,
        documentHeader:`Patient service revenue recognition ${invoice.invoiceNumber}`,
        currency,totalAmountMinorUnits:totalReceivable,
        lines:[
          {
            glAccountId:'1110',glAccountName:arAccount.accountName,
            debitMinorUnits:totalReceivable,creditMinorUnits:0,
            lineDescription:`Recognize receivable for invoice ${invoice.invoiceNumber}`,
          },
          ...payload.lines.map(line=>({
            glAccountId:line.revenueAccountCode,
            glAccountName:revenueAccounts.find(a=>a.accountCode===line.revenueAccountCode)?.accountName||line.revenueAccountCode,
            costCenterId:line.costCenterId,profitCenterId:line.profitCenterId,
            debitMinorUnits:0,creditMinorUnits:line.amountMinorUnits,
            lineDescription:line.description,
          })),
          ...(outputTaxMinor>0?[{
            glAccountId:'2040',
            glAccountName:outputTaxAccount?.accountName||'Output Tax Payable',
            debitMinorUnits:0,
            creditMinorUnits:outputTaxMinor,
            lineDescription:`Output tax for invoice ${invoice.invoiceNumber}`,
          }]:[]),
        ],
        sourceModule:'BILLING',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };

      const patientOpenItem:FinanceArOpenItem|undefined=patientMinor>0?{
        openItemId:patientOpenItemId,tenantId:context.tenantId,invoiceId:payload.invoiceId,
        debtorType:'PATIENT',debtorId:payload.patientId,patientId:payload.patientId,
        encounterId:payload.encounterId||invoice.encounterId,issueAt:payload.issueAt,dueAt:payload.dueAt,
        currency,originalMinorUnits:patientMinor,allocatedMinorUnits:0,writtenOffMinorUnits:0,
        refundedMinorUnits:0,outstandingMinorUnits:patientMinor,status:'OPEN',createdAt:now,updatedAt:now,
      }:undefined;
      const payerOpenItem:FinanceArOpenItem|undefined=payerMinor>0?{
        openItemId:payerOpenItemId,tenantId:context.tenantId,invoiceId:payload.invoiceId,
        debtorType:'PAYER',debtorId:String(payload.payerId),patientId:payload.patientId,
        encounterId:payload.encounterId||invoice.encounterId,issueAt:payload.issueAt,dueAt:payload.dueAt,
        currency,originalMinorUnits:payerMinor,allocatedMinorUnits:0,writtenOffMinorUnits:0,
        refundedMinorUnits:0,outstandingMinorUnits:payerMinor,status:'OPEN',createdAt:now,updatedAt:now,
      }:undefined;

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'REVENUE_RECOGNITION',aggregateId:recognitionId,
        eventType:'PATIENT_INVOICE_REVENUE_RECOGNIZED',
        auditAction:'PATIENT_INVOICE_REVENUE_RECOGNIZED',
        auditResourceType:'INVOICE',auditResourceId:payload.invoiceId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,
        correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'existing',entityType:'REVENUE_RECOGNITION',entityId:recognitionId,required:false},
          {key:'invoice',entityType:'INVOICE',entityId:payload.invoiceId,required:true},
        ],
        prepare:(current)=>{
          if(current.existing)throw new AtomicMutationRejectedError(
            'INVOICE_REVENUE_ALREADY_RECOGNIZED','Invoice revenue is already recognized.'
          );
          const period=current.period as any;
          if(!['OPEN','SOFT_CLOSE'].includes(String(period.status))){
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE','Invoice posting period is not open.'
            );
          }
          const liveInvoice=current.invoice as unknown as Invoice;
          if(
            liveInvoice.patientId!==invoice.patientId ||
            minor(liveInvoice.totalPatientDue)!==patientMinor ||
            minor(liveInvoice.totalCoverage)!==payerMinor
          ){
            throw new AtomicMutationRejectedError(
              'INVOICE_CHANGED_BEFORE_RECOGNITION',
              'Authoritative invoice changed before finance recognition; retry required.'
            );
          }

          const recognition={
            recognitionId,tenantId:context.tenantId,invoiceId:payload.invoiceId,
            patientOpenItemId:patientOpenItem?.openItemId,
            payerOpenItemId:payerOpenItem?.openItemId,
            journalId,currency,totalReceivableMinorUnits:totalReceivable,
            recognizedAt:now,recognizedBy:context.actorId,
          };
          const writes:any[]=[
            {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
            ...(patientOpenItem?[{entityType:'AR_OPEN_ITEM',entityId:patientOpenItem.openItemId,domainState:patientOpenItem}]:[]),
            ...(payerOpenItem?[{entityType:'AR_OPEN_ITEM',entityId:payerOpenItem.openItemId,domainState:payerOpenItem}]:[]),
          ];
          return {
            domainState:recognition,additionalStateWrites:writes,
            eventPayload:{recognitionId,invoiceId:payload.invoiceId,journalId,totalReceivable,revenueBaseMinor,outputTaxMinor,currency},
            auditReason:`Recognized invoice ${invoice.invoiceNumber} into AR and service revenue.`,
            resultData:{recognition,journal,patientOpenItem,payerOpenItem},
          };
        },
      });
      return {
        success:true,commandId,idempotencyKey,entityId:recognitionId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(
        commandId,idempotencyKey,error.code,error.message,error.details
      );
      throw error;
    }
  }

  public static async adjustOpenItem(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:AdjustArPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(
      commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
      auth.reason||'AR adjustment authority required.'
    );
    try{
      assertMinorUnits(payload.amountMinorUnits,'INVALID_AR_ADJUSTMENT_AMOUNT');
      if(payload.amountMinorUnits<=0)throw new AtomicMutationRejectedError(
        'INVALID_AR_ADJUSTMENT_AMOUNT','AR adjustment must be positive.'
      );
      const item=await DomainStateRepository.getById<FinanceArOpenItem>(
        context.tenantId,'arOpenItems',payload.openItemId
      );
      if(!item)throw new AtomicMutationRejectedError(
        'AR_OPEN_ITEM_NOT_FOUND','AR open item does not exist.'
      );
      if(payload.amountMinorUnits>item.outstandingMinorUnits&&payload.type!=='REFUND'){
        throw new AtomicMutationRejectedError(
          'AR_ADJUSTMENT_EXCEEDS_OUTSTANDING','AR adjustment exceeds outstanding receivable.'
        );
      }
      const date=new Date(payload.postingAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const arAccount=await resolveAccount(context.tenantId,'1110');
      const offsetCode=payload.type==='WRITE_OFF'?'6410':payload.type==='REFUND'?'1010':'4090';
      const offset=await resolveAccount(context.tenantId,offsetCode);
      const journalId=`je_ar_adj_${payload.adjustmentId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.postingAt,postingDate:payload.postingAt,
        referenceDocumentId:payload.adjustmentId,
        documentHeader:`${payload.type} for AR item ${payload.openItemId}`,
        currency:item.currency,totalAmountMinorUnits:payload.amountMinorUnits,
        lines:payload.type==='REFUND'?[
          {glAccountId:'1110',glAccountName:arAccount.accountName,debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,lineDescription:'Reinstate/refund receivable'},
          {glAccountId:offsetCode,glAccountName:offset.accountName,debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,lineDescription:'Cash/bank refund offset'},
        ]:[
          {glAccountId:offsetCode,glAccountName:offset.accountName,debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,lineDescription:`${payload.type} adjustment`},
          {glAccountId:'1110',glAccountName:arAccount.accountName,debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,lineDescription:'Reduce accounts receivable'},
        ],
        sourceModule:'AR',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'AR_ADJUSTMENT',aggregateId:payload.adjustmentId,
        eventType:'AR_OPEN_ITEM_ADJUSTED',auditAction:'AR_OPEN_ITEM_ADJUSTED',
        auditResourceType:'AR_OPEN_ITEM',auditResourceId:payload.openItemId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,
        correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'item',entityType:'AR_OPEN_ITEM',entityId:payload.openItemId,required:true},
        ],
        prepare:(current)=>{
          const period=current.period as any;
          if(!['OPEN','SOFT_CLOSE'].includes(String(period.status)))throw new AtomicMutationRejectedError(
            'FINANCE_PERIOD_NOT_POSTABLE','AR adjustment period is not open.'
          );
          const live=current.item as unknown as FinanceArOpenItem;
          if(payload.type!=='REFUND'&&payload.amountMinorUnits>live.outstandingMinorUnits){
            throw new AtomicMutationRejectedError(
              'AR_ADJUSTMENT_EXCEEDS_OUTSTANDING','AR open item changed before adjustment.'
            );
          }
          const nextOutstanding=payload.type==='REFUND'
            ? live.outstandingMinorUnits+payload.amountMinorUnits
            : live.outstandingMinorUnits-payload.amountMinorUnits;
          const now=new Date().toISOString();
          const next:FinanceArOpenItem={
            ...live,
            writtenOffMinorUnits:live.writtenOffMinorUnits+(payload.type==='WRITE_OFF'?payload.amountMinorUnits:0),
            refundedMinorUnits:live.refundedMinorUnits+(payload.type==='REFUND'?payload.amountMinorUnits:0),
            outstandingMinorUnits:nextOutstanding,
            status:nextOutstanding===0?(payload.type==='WRITE_OFF'?'WRITTEN_OFF':'SETTLED'):'PARTIALLY_SETTLED',
            updatedAt:now,
          };
          const adjustment:FinanceArAdjustment={
            adjustmentId:payload.adjustmentId,tenantId:context.tenantId,
            openItemId:payload.openItemId,type:payload.type,amountMinorUnits:payload.amountMinorUnits,
            reason:payload.reason,postingAt:payload.postingAt,journalId,
            postedBy:context.actorId,postedAt:now,
          };
          return {
            domainState:adjustment,
            additionalStateWrites:[
              {entityType:'AR_OPEN_ITEM',entityId:live.openItemId,domainState:next},
              {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
            ],
            eventPayload:{adjustmentId:payload.adjustmentId,openItemId:live.openItemId,type:payload.type,amountMinorUnits:payload.amountMinorUnits,journalId},
            auditReason:`${payload.type} AR item ${live.openItemId}: ${payload.reason}`,
            resultData:{adjustment,openItem:next,journal},
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.adjustmentId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async generateAging(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:GenerateArAgingPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','BILLING_ADMIN','AUDITOR','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'AR aging authority required.');
    if(!Number.isFinite(payload.asOf))return reject(commandId,idempotencyKey,'INVALID_AR_AGING_DATE','AR aging as-of date is invalid.');
    const currency=payload.currency.trim().toUpperCase();
    const [items,receipts,adjustments]=await Promise.all([
      DomainStateRepository.list<FinanceArOpenItem>(context.tenantId,'arOpenItems',200000),
      DomainStateRepository.list<Record<string,unknown>>(context.tenantId,'financeArReceipts',200000),
      DomainStateRepository.list<FinanceArAdjustment>(context.tenantId,'financeArAdjustments',200000),
    ]);
    const asOf=calculateArOutstandingAsOf({
      openItems:items,
      receipts:receipts.map(row=>({
        openItemId:String(row.openItemId||''),
        amountMinorUnits:Number(row.amountMinorUnits||0),
        receivedAt:Number(row.receivedAt||0),
        currency:String(row.currency||''),
      })),
      adjustments,
      asOf:payload.asOf,
      currency,
    });
    const relevantItems=items.filter(item=>
      item.currency===currency &&
      item.issueAt<=payload.asOf &&
      (asOf.outstandingByOpenItemId.get(item.openItemId)||0)>0
    );

    const totals={CURRENT:0,'1_30':0,'31_60':0,'61_90':0,OVER_90:0};
    for(const item of relevantItems){
      totals[arAgingBucket(item,payload.asOf)]+=
        asOf.outstandingByOpenItemId.get(item.openItemId)||0;
    }
    const snapshot={
      snapshotId:payload.snapshotId,tenantId:context.tenantId,asOf:payload.asOf,currency,
      currentMinorUnits:totals.CURRENT,days1to30MinorUnits:totals['1_30'],
      days31to60MinorUnits:totals['31_60'],days61to90MinorUnits:totals['61_90'],
      over90MinorUnits:totals.OVER_90,
      totalOutstandingMinorUnits:asOf.totalOutstandingMinorUnits,
      openItemCount:relevantItems.length,generatedAt:new Date().toISOString(),generatedBy:context.actorId,
    };
    const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
      entityType:'AR_AGING_SNAPSHOT',entityId:payload.snapshotId,
      eventType:'AR_AGING_SNAPSHOT_GENERATED',domainState:snapshot,
      eventPayload:{snapshotId:payload.snapshotId,asOf:payload.asOf,currency,totalOutstandingMinorUnits:snapshot.totalOutstandingMinorUnits},
      auditReason:`Generated AR aging as of ${new Date(payload.asOf).toISOString()}.`,
      outboxTopic:'g-hims-finance-events',
    });
    return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:snapshot};
  }

  public static async recordArReceipt(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:RecordArReceiptPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:[
        'BILLING_ADMIN','ACCOUNTANT','FINANCE_MANAGER','TREASURY_MANAGER',
        'SYSTEM_ADMIN','ADMINISTRATOR'
      ],
    });
    if(!auth.authorized)return reject(
      commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
      auth.reason||'AR receipt allocation authority required.'
    );

    try{
      assertMinorUnits(payload.amountMinorUnits,'INVALID_AR_RECEIPT_AMOUNT');
      if(payload.amountMinorUnits<=0)throw new AtomicMutationRejectedError(
        'INVALID_AR_RECEIPT_AMOUNT','AR receipt amount must be positive.'
      );
      const [openItem,treasury]=await Promise.all([
        DomainStateRepository.getById<FinanceArOpenItem>(
          context.tenantId,'arOpenItems',payload.openItemId
        ),
        DomainStateRepository.getById<TreasuryAccountRecord>(
          context.tenantId,'treasuryAccounts',payload.treasuryAccountId
        ),
      ]);
      if(!openItem||openItem.outstandingMinorUnits<=0)throw new AtomicMutationRejectedError(
        'AR_OPEN_ITEM_NOT_OPEN','AR open item is not open.'
      );
      if(
        !treasury ||
        !treasury.isActive ||
        !treasury.allowReceipts ||
        treasury.currency!==openItem.currency
      )throw new AtomicMutationRejectedError(
        'TREASURY_RECEIPT_ACCOUNT_INVALID',
        'Receipt requires an active receipt-enabled treasury account in the AR currency.'
      );
      if(payload.amountMinorUnits>openItem.outstandingMinorUnits)throw new AtomicMutationRejectedError(
        'AR_RECEIPT_EXCEEDS_OUTSTANDING',
        'Receipt exceeds AR open-item outstanding amount.'
      );

      const date=new Date(payload.receivedAt);
      const fiscalYear=date.getUTCFullYear(),postingPeriod=date.getUTCMonth()+1;
      const periodId=financePeriodId(fiscalYear,postingPeriod);
      const journalId=`je_ar_receipt_${payload.receiptId}`;
      const journal:GovernedJournalRecord={
        journalId,tenantId:context.tenantId,fiscalYear,postingPeriod,
        documentDate:payload.receivedAt,postingDate:payload.receivedAt,
        referenceDocumentId:payload.receiptId,
        documentHeader:`AR receipt ${payload.reference}`,
        currency:openItem.currency,totalAmountMinorUnits:payload.amountMinorUnits,
        lines:[
          {
            glAccountId:treasury.accountCode,glAccountName:treasury.accountName,
            debitMinorUnits:payload.amountMinorUnits,creditMinorUnits:0,
            lineDescription:`${payload.method} receipt ${payload.reference}`,
          },
          {
            glAccountId:'1110',glAccountName:'Accounts Receivable - Patient & Insurers',
            debitMinorUnits:0,creditMinorUnits:payload.amountMinorUnits,
            lineDescription:`Clear AR open item ${openItem.openItemId}`,
          },
        ],
        sourceModule:'AR',status:'POSTED',postedBy:context.actorId,postedAt:Date.now(),
      };
      const receipt={
        receiptId:payload.receiptId,tenantId:context.tenantId,
        openItemId:openItem.openItemId,invoiceId:openItem.invoiceId,
        debtorType:openItem.debtorType,debtorId:openItem.debtorId,
        treasuryAccountId:treasury.treasuryAccountId,
        amountMinorUnits:payload.amountMinorUnits,currency:openItem.currency,
        method:payload.method,reference:payload.reference,receivedAt:payload.receivedAt,
        journalId,recordedBy:context.actorId,recordedAt:new Date().toISOString(),
      };

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'AR_RECEIPT',aggregateId:payload.receiptId,
        eventType:'AR_RECEIPT_ALLOCATED',auditAction:'AR_RECEIPT_ALLOCATED',
        auditResourceType:'AR_OPEN_ITEM',auditResourceId:payload.openItemId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,
        correlationId:context.correlationId,
        readTargets:[
          {key:'period',entityType:'FINANCE_PERIOD',entityId:periodId,required:true},
          {key:'openItem',entityType:'AR_OPEN_ITEM',entityId:payload.openItemId,required:true},
          {key:'treasury',entityType:'TREASURY_ACCOUNT',entityId:payload.treasuryAccountId,required:true},
        ],
        prepare:(current)=>{
          const period=current.period as unknown as FinancePeriodRecord;
          const live=current.openItem as unknown as FinanceArOpenItem;
          const liveTreasury=current.treasury as unknown as TreasuryAccountRecord;
          if(!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError(
            'FINANCE_PERIOD_NOT_POSTABLE','AR receipt period is not open.'
          );
          if(
            !liveTreasury.isActive ||
            !liveTreasury.allowReceipts ||
            liveTreasury.currency!==live.currency
          )throw new AtomicMutationRejectedError(
            'TREASURY_RECEIPT_ACCOUNT_CHANGED',
            'Treasury receipt account changed before settlement.'
          );
          if(payload.amountMinorUnits>live.outstandingMinorUnits)throw new AtomicMutationRejectedError(
            'AR_RECEIPT_EXCEEDS_OUTSTANDING','AR open-item state changed before receipt allocation.'
          );
          const nextOutstanding=live.outstandingMinorUnits-payload.amountMinorUnits;
          const next:FinanceArOpenItem={
            ...live,allocatedMinorUnits:live.allocatedMinorUnits+payload.amountMinorUnits,
            outstandingMinorUnits:nextOutstanding,
            status:nextOutstanding===0?'SETTLED':'PARTIALLY_SETTLED',
            updatedAt:new Date().toISOString(),
          };
          return {
            domainState:receipt,
            additionalStateWrites:[
              {entityType:'AR_OPEN_ITEM',entityId:live.openItemId,domainState:next},
              {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal},
            ],
            eventPayload:{
              receiptId:payload.receiptId,openItemId:live.openItemId,
              invoiceId:live.invoiceId,amountMinorUnits:payload.amountMinorUnits,
              currency:live.currency,journalId,
            },
            auditReason:`Allocated ${payload.method} receipt ${payload.reference} to AR item ${live.openItemId}.`,
            resultData:{receipt,openItem:next,journal},
          };
        },
      });
      return {
        success:true,commandId,idempotencyKey,entityId:payload.receiptId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData
      };
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(
        commandId,idempotencyKey,error.code,error.message,error.details
      );
      throw error;
    }
  }

}
