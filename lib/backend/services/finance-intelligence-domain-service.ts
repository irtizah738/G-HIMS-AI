import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  BankReconciliationRecord,
  BudgetEnvelopeRecord,
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinanceIntelligenceSnapshot,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import type { SupplierInvoiceRecord } from '@/types/scm-payables';
import {
  buildFinanceAnomalies,
  buildTrialBalance,
  stableFinanceFingerprint,
} from '@/lib/finance/finance-engine';

export interface GenerateFinanceIntelligencePayload {
  snapshotId:string;
  asOf:number;
  fiscalYear:number;
  throughPostingPeriod:number;
  currency:string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message}};
}

export class FinanceIntelligenceDomainService {
  public static async generate(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:GenerateFinanceIntelligencePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','AUDITOR','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Financial intelligence authority required.');
    if(!Number.isFinite(payload.asOf))return reject(commandId,idempotencyKey,'INVALID_FINANCE_INTELLIGENCE_DATE','Financial intelligence as-of date is invalid.');

    const currency=payload.currency.trim().toUpperCase();
    const [accounts,journals,arItems,apInvoices,budgets,bankRecons]=await Promise.all([
      DomainStateRepository.list<FinanceAccountRecord>(context.tenantId,'accounts',50000),
      DomainStateRepository.queryAllEqual<GovernedJournalRecord>(
        context.tenantId,'journalEntries','fiscalYear',payload.fiscalYear,{pageSize:500,maxRows:500000}
      ),
      DomainStateRepository.list<FinanceArOpenItem>(context.tenantId,'arOpenItems',200000),
      DomainStateRepository.list<SupplierInvoiceRecord>(context.tenantId,'scmSupplierInvoices',200000),
      DomainStateRepository.list<BudgetEnvelopeRecord>(context.tenantId,'financeBudgets',50000),
      DomainStateRepository.list<BankReconciliationRecord>(context.tenantId,'financeBankReconciliations',50000),
    ]);

    const relevantAccounts=accounts.filter(account=>account.currency===currency);
    const trial=buildTrialBalance({
      journals,accounts:relevantAccounts,fiscalYear:payload.fiscalYear,
      throughPostingPeriod:payload.throughPostingPeriod,currency,
    });
    const byCode=new Map(trial.lines.map(line=>[line.accountCode,line]));
    const cashMinorUnits=['1010','1020'].reduce((sum,code)=>sum+(byCode.get(code)?.endingBalanceMinorUnits||0),0);
    const arOutstandingMinorUnits=arItems.filter(item=>item.currency===currency&&item.issueAt<=payload.asOf)
      .reduce((sum,item)=>sum+item.outstandingMinorUnits,0);
    const apOutstandingMinorUnits=apInvoices.filter(invoice=>invoice.currency===currency&&['PAYABLE_RECOGNIZED','PARTIALLY_PAID'].includes(invoice.status))
      .reduce((sum,invoice)=>sum+invoice.balanceMinorUnits,0);
    const revenueMinorUnits=trial.lines.filter(line=>line.category==='revenue').reduce((sum,line)=>sum+line.endingBalanceMinorUnits,0);
    const expenseMinorUnits=trial.lines.filter(line=>line.category==='expense').reduce((sum,line)=>sum+line.endingBalanceMinorUnits,0);
    const currentAssetsMinorUnits=relevantAccounts.filter(account=>account.category==='asset'&&account.subCategory.toLowerCase().includes('current'))
      .reduce((sum,account)=>sum+(byCode.get(account.accountCode)?.endingBalanceMinorUnits||0),0);
    const currentLiabilitiesMinorUnits=relevantAccounts.filter(account=>account.category==='liability'&&account.subCategory.toLowerCase().includes('current'))
      .reduce((sum,account)=>sum+(byCode.get(account.accountCode)?.endingBalanceMinorUnits||0),0);
    const budgetAvailableMinorUnits=budgets.filter(budget=>budget.currency===currency&&budget.status==='APPROVED')
      .reduce((sum,budget)=>sum+budget.availableMinorUnits,0);
    const overdueArMinorUnits=arItems.filter(item=>item.currency===currency&&item.outstandingMinorUnits>0&&item.dueAt<payload.asOf)
      .reduce((sum,item)=>sum+item.outstandingMinorUnits,0);
    const overdueApMinorUnits=apInvoices.filter(invoice=>invoice.currency===currency&&invoice.balanceMinorUnits>0&&Date.parse(invoice.dueDate)<payload.asOf)
      .reduce((sum,invoice)=>sum+invoice.balanceMinorUnits,0);
    const latestBank=bankRecons.filter(r=>r.currency===currency&&r.statementDate<=payload.asOf)
      .sort((a,b)=>b.statementDate-a.statementDate)[0];
    const unreconciledBankMinorUnits=latestBank?.varianceMinorUnits||0;

    const metrics:FinanceIntelligenceSnapshot['metrics']={
      cashMinorUnits,arOutstandingMinorUnits,apOutstandingMinorUnits,
      revenueMinorUnits,expenseMinorUnits,operatingSurplusMinorUnits:revenueMinorUnits-expenseMinorUnits,
      currentAssetsMinorUnits,currentLiabilitiesMinorUnits,
      workingCapitalMinorUnits:currentAssetsMinorUnits-currentLiabilitiesMinorUnits,
      budgetAvailableMinorUnits,overdueArMinorUnits,overdueApMinorUnits,unreconciledBankMinorUnits,
    };
    const anomalies=buildFinanceAnomalies(metrics,trial.balanced);
    const inputFingerprint=stableFinanceFingerprint({
      trial:trial.lines,
      ar:arItems.map(i=>[i.openItemId,i.outstandingMinorUnits,i.dueAt,i.status]),
      ap:apInvoices.map(i=>[i.invoiceId,i.balanceMinorUnits,i.dueDate,i.status]),
      budgets:budgets.map(b=>[b.budgetId,b.availableMinorUnits,b.committedMinorUnits,b.actualMinorUnits,b.status]),
      bank:bankRecons.map(r=>[r.reconciliationId,r.statementDate,r.varianceMinorUnits,r.status]),
    });
    const snapshot:FinanceIntelligenceSnapshot={
      snapshotId:payload.snapshotId,tenantId:context.tenantId,asOf:payload.asOf,currency,
      generatedAt:new Date().toISOString(),generatedBy:context.actorId,inputFingerprint,metrics,anomalies,
    };

    const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
      entityType:'FINANCE_INTELLIGENCE_SNAPSHOT',entityId:payload.snapshotId,
      eventType:'FINANCE_INTELLIGENCE_SNAPSHOT_GENERATED',domainState:snapshot,
      eventPayload:{snapshotId:payload.snapshotId,inputFingerprint,anomalyCount:anomalies.length},
      auditReason:`Generated deterministic finance intelligence snapshot ${payload.snapshotId}.`,
      outboxTopic:'g-hims-finance-intelligence-events',
    });
    return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:snapshot};
  }
}
