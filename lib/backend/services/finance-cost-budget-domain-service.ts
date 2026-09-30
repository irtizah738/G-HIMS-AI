import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  BudgetCommitmentPayload,
  BudgetCommitmentRecord,
  BudgetEnvelopeRecord,
  CostAllocationRule,
  CostAllocationRunRecord,
  CostCenterRecord,
  FinancePeriodRecord,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';

export interface CreateCostCenterPayload {
  costCenterId:string;
  code:string;
  name:string;
  department:string;
  facilityId?:string;
  managerUserId?:string;
}

export interface CreateCostAllocationRulePayload {
  ruleId:string;
  sourceCostCenterId:string;
  expenseAccountCode:string;
  allocationBasis:'PERCENT'|'HEADCOUNT'|'AREA'|'ENCOUNTERS';
  targets:Array<{costCenterId:string;percentBasisPoints:number}>;
  effectiveFrom:number;
  effectiveTo?:number;
}

export interface RunCostAllocationPayload {
  runId:string;
  fiscalYear:number;
  postingPeriod:number;
  currency:string;
  ruleIds:string[];
}

export interface CreateBudgetEnvelopePayload {
  budgetId:string;
  fiscalYear:number;
  costCenterId:string;
  accountCode:string;
  currency:string;
  approvedMinorUnits:number;
}

export interface ApproveBudgetEnvelopePayload {
  budgetId:string;
  decision:'APPROVE'|'REJECT';
  reason:string;
}

export interface ReleaseBudgetCommitmentPayload {
  commitmentId:string;
  reason:string;
}

export interface ConsumeBudgetCommitmentPayload {
  commitmentId:string;
  journalId:string;
}

function reject(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function positive(value:number,code:string){
  if(!Number.isSafeInteger(value)||value<=0)throw new AtomicMutationRejectedError(code,'Amount must be positive integer minor units.');
}

export class FinanceCostBudgetDomainService {
  public static async createCostCenter(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CreateCostCenterPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cost-center administration authority required.');
    const record:CostCenterRecord={
      ...payload,tenantId:context.tenantId,isActive:true,createdAt:new Date().toISOString(),createdBy:context.actorId,
    };
    const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
      entityType:'COST_CENTER',entityId:payload.costCenterId,eventType:'COST_CENTER_CREATED',
      domainState:record,eventPayload:{costCenterId:payload.costCenterId,code:payload.code},
      auditReason:`Created cost center ${payload.code}.`,outboxTopic:'g-hims-finance-events',
    });
    return {success:true,commandId,idempotencyKey,entityId:payload.costCenterId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
  }

  public static async createAllocationRule(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CreateCostAllocationRulePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cost allocation authority required.');
    try{
      if(!payload.targets.length||payload.targets.length>100)throw new AtomicMutationRejectedError('INVALID_COST_ALLOCATION_TARGETS','Allocation rule requires 1-100 targets.');
      const unique=[...new Set(payload.targets.map(t=>t.costCenterId))];
      if(unique.length!==payload.targets.length||unique.includes(payload.sourceCostCenterId))throw new AtomicMutationRejectedError('INVALID_COST_ALLOCATION_TARGETS','Allocation targets must be unique and exclude source cost center.');
      const total=payload.targets.reduce((sum,t)=>sum+t.percentBasisPoints,0);
      if(total!==10000||payload.targets.some(t=>!Number.isInteger(t.percentBasisPoints)||t.percentBasisPoints<=0)){
        throw new AtomicMutationRejectedError('INVALID_COST_ALLOCATION_BASIS_POINTS','Target allocation percentages must be positive and total exactly 10,000 basis points.');
      }
      const centers=await Promise.all(
        [payload.sourceCostCenterId,...unique].map(id=>DomainStateRepository.getById<CostCenterRecord>(context.tenantId,'financeCostCenters',id))
      );
      if(centers.some(center=>!center?.isActive))throw new AtomicMutationRejectedError('COST_CENTER_NOT_ACTIVE','All allocation cost centers must be active.');
      const record:CostAllocationRule={
        ruleId:payload.ruleId,tenantId:context.tenantId,sourceCostCenterId:payload.sourceCostCenterId,
        expenseAccountCode:payload.expenseAccountCode,allocationBasis:payload.allocationBasis,
        targets:payload.targets,effectiveFrom:payload.effectiveFrom,effectiveTo:payload.effectiveTo,
        isActive:true,createdAt:new Date().toISOString(),createdBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'COST_ALLOCATION_RULE',entityId:payload.ruleId,eventType:'COST_ALLOCATION_RULE_CREATED',
        domainState:record,eventPayload:{ruleId:payload.ruleId,sourceCostCenterId:payload.sourceCostCenterId,expenseAccountCode:payload.expenseAccountCode},
        auditReason:`Created ${payload.allocationBasis} allocation rule ${payload.ruleId}.`,outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.ruleId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async runCostAllocation(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RunCostAllocationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','ACCOUNTANT','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Cost allocation posting authority required.');
    try{
      const periodId=financePeriodId(payload.fiscalYear,payload.postingPeriod);
      const period=await DomainStateRepository.getById<FinancePeriodRecord>(context.tenantId,'accountingPeriods',periodId);
      if(!period||!['OPEN','SOFT_CLOSE'].includes(period.status))throw new AtomicMutationRejectedError('FINANCE_PERIOD_NOT_POSTABLE','Cost allocation period is not open.');
      const rules=await Promise.all(payload.ruleIds.map(id=>DomainStateRepository.getById<CostAllocationRule>(context.tenantId,'financeCostAllocationRules',id)));
      if(rules.some(rule=>!rule?.isActive))throw new AtomicMutationRejectedError('COST_ALLOCATION_RULE_NOT_ACTIVE','All requested allocation rules must be active.');
      const journals=await DomainStateRepository.queryAllEqual<GovernedJournalRecord>(
        context.tenantId,'journalEntries','fiscalYear',payload.fiscalYear,{pageSize:500,maxRows:500000}
      );
      const periodJournals=journals.filter(j=>j.status==='POSTED'&&j.postingPeriod===payload.postingPeriod&&j.currency===payload.currency.toUpperCase());
      const writes:any[]=[];
      const journalIds:string[]=[];
      let allocatedMinorUnits=0;
      for(const rule of rules as CostAllocationRule[]){
        const sourceMinor=periodJournals.flatMap(j=>j.lines).filter(line=>
          line.glAccountId===rule.expenseAccountCode&&line.costCenterId===rule.sourceCostCenterId
        ).reduce((sum,line)=>sum+line.debitMinorUnits-line.creditMinorUnits,0);
        if(sourceMinor<=0)continue;
        let assigned=0;
        const lines:any[]=[];
        rule.targets.forEach((target,index)=>{
          const amount=index===rule.targets.length-1
            ? sourceMinor-assigned
            : Math.floor(sourceMinor*target.percentBasisPoints/10000);
          assigned+=amount;
          if(amount<=0)return;
          lines.push({
            glAccountId:rule.expenseAccountCode,glAccountName:rule.expenseAccountCode,
            costCenterId:target.costCenterId,debitMinorUnits:amount,creditMinorUnits:0,
            lineDescription:`Allocate ${rule.allocationBasis} cost from ${rule.sourceCostCenterId}`,
          });
          lines.push({
            glAccountId:rule.expenseAccountCode,glAccountName:rule.expenseAccountCode,
            costCenterId:rule.sourceCostCenterId,debitMinorUnits:0,creditMinorUnits:amount,
            lineDescription:`Release source cost center ${rule.sourceCostCenterId}`,
          });
        });
        if(!lines.length)continue;
        const journalId=`je_costalloc_${payload.runId}_${rule.ruleId}`;
        const postingAt=period.endAt;
        const journal:GovernedJournalRecord={
          journalId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,postingPeriod:payload.postingPeriod,
          documentDate:postingAt,postingDate:postingAt,referenceDocumentId:payload.runId,
          documentHeader:`Cost allocation ${rule.ruleId}`,currency:payload.currency.toUpperCase(),
          totalAmountMinorUnits:sourceMinor,lines,sourceModule:'COSTING',status:'POSTED',
          postedBy:context.actorId,postedAt:Date.now(),
        };
        writes.push({entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:journal});
        journalIds.push(journalId);allocatedMinorUnits+=sourceMinor;
      }
      const record:CostAllocationRunRecord={
        runId:payload.runId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,
        postingPeriod:payload.postingPeriod,currency:payload.currency.toUpperCase(),
        ruleIds:payload.ruleIds,journalIds,allocatedMinorUnits,status:'POSTED',
        postedAt:new Date().toISOString(),postedBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'COST_ALLOCATION_RUN',aggregateId:payload.runId,eventType:'COST_ALLOCATION_RUN_POSTED',
        eventPayload:{runId:payload.runId,journalIds,allocatedMinorUnits},auditAction:'COST_ALLOCATION_RUN_POSTED',
        auditResourceType:'COST_ALLOCATION_RUN',auditResourceId:payload.runId,auditReason:`Posted cost allocation run ${payload.runId}.`,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        domainState:record,additionalStateWrites:writes,
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.runId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async createBudget(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CreateBudgetEnvelopePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','BUDGET_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Budget administration authority required.');
    try{
      positive(payload.approvedMinorUnits,'INVALID_BUDGET_AMOUNT');
      const center=await DomainStateRepository.getById<CostCenterRecord>(context.tenantId,'financeCostCenters',payload.costCenterId);
      if(!center?.isActive)throw new AtomicMutationRejectedError('COST_CENTER_NOT_ACTIVE','Budget cost center must be active.');
      const record:BudgetEnvelopeRecord={
        budgetId:payload.budgetId,tenantId:context.tenantId,fiscalYear:payload.fiscalYear,
        costCenterId:payload.costCenterId,accountCode:payload.accountCode,currency:payload.currency.toUpperCase(),
        approvedMinorUnits:payload.approvedMinorUnits,committedMinorUnits:0,actualMinorUnits:0,
        availableMinorUnits:payload.approvedMinorUnits,status:'DRAFT',createdAt:new Date().toISOString(),createdBy:context.actorId,
      };
      const tx=await TransactionManager.executeAtomicWrite(context,commandId,idempotencyKey,{
        entityType:'BUDGET_ENVELOPE',entityId:payload.budgetId,eventType:'BUDGET_ENVELOPE_CREATED',
        domainState:record,eventPayload:{budgetId:payload.budgetId,costCenterId:payload.costCenterId,approvedMinorUnits:payload.approvedMinorUnits},
        auditReason:`Created draft budget envelope ${payload.budgetId}.`,outboxTopic:'g-hims-finance-events',
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.budgetId,eventId:tx.event.eventId,auditId:tx.audit.auditId,outboxId:tx.outbox.outboxId,data:record};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async approveBudget(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ApproveBudgetEnvelopePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Budget approval authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'FINANCE_MANAGER',
        aggregateType:'BUDGET_ENVELOPE',aggregateId:payload.budgetId,
        eventType:payload.decision==='APPROVE'?'BUDGET_ENVELOPE_APPROVED':'BUDGET_ENVELOPE_REJECTED',
        auditAction:payload.decision==='APPROVE'?'BUDGET_ENVELOPE_APPROVED':'BUDGET_ENVELOPE_REJECTED',
        auditResourceType:'BUDGET_ENVELOPE',auditResourceId:payload.budgetId,outboxTopic:'g-hims-finance-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'budget',entityType:'BUDGET_ENVELOPE',entityId:payload.budgetId,required:true}],
        prepare:(current)=>{
          const budget=current.budget as unknown as BudgetEnvelopeRecord;
          if(budget.status!=='DRAFT')throw new AtomicMutationRejectedError('BUDGET_NOT_REVIEWABLE','Budget is not draft.');
          if(budget.createdBy===context.actorId)throw new AtomicMutationRejectedError('FINANCE_SEGREGATION_OF_DUTIES','Budget creator cannot approve their own budget.');
          if(payload.decision==='REJECT'){
            return {domainState:{...budget,status:'CLOSED'},eventPayload:{budgetId:budget.budgetId,decision:'REJECT'},
              auditReason:`Rejected budget ${budget.budgetId}: ${payload.reason}`,resultData:{...budget,status:'CLOSED'}};
          }
          const next:BudgetEnvelopeRecord={...budget,status:'APPROVED',approvedAt:new Date().toISOString(),approvedBy:context.actorId};
          return {domainState:next,eventPayload:{budgetId:budget.budgetId,decision:'APPROVE'},
            auditReason:`Approved budget ${budget.budgetId}: ${payload.reason}`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.budgetId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async commitBudget(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:BudgetCommitmentPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['BUDGET_MANAGER','PROCUREMENT_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Budget commitment authority required.');
    try{
      positive(payload.amountMinorUnits,'INVALID_BUDGET_COMMITMENT_AMOUNT');
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'BUDGET_MANAGER',
        aggregateType:'BUDGET_COMMITMENT',aggregateId:payload.commitmentId,eventType:'BUDGET_COMMITMENT_CREATED',
        auditAction:'BUDGET_COMMITMENT_CREATED',auditResourceType:'BUDGET_ENVELOPE',auditResourceId:payload.budgetId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'budget',entityType:'BUDGET_ENVELOPE',entityId:payload.budgetId,required:true}],
        prepare:(current)=>{
          const budget=current.budget as unknown as BudgetEnvelopeRecord;
          if(budget.status!=='APPROVED')throw new AtomicMutationRejectedError('BUDGET_NOT_APPROVED','Budget envelope is not approved.');
          if(payload.amountMinorUnits>budget.availableMinorUnits)throw new AtomicMutationRejectedError('BUDGET_INSUFFICIENT_AVAILABLE','Budget commitment exceeds available budget.');
          const now=new Date().toISOString();
          const commitment:BudgetCommitmentRecord={...payload,tenantId:context.tenantId,status:'ACTIVE',createdBy:context.actorId,createdAt:now};
          const next:BudgetEnvelopeRecord={...budget,committedMinorUnits:budget.committedMinorUnits+payload.amountMinorUnits,availableMinorUnits:budget.availableMinorUnits-payload.amountMinorUnits};
          return {domainState:commitment,additionalStateWrites:[{entityType:'BUDGET_ENVELOPE',entityId:budget.budgetId,domainState:next}],
            eventPayload:{commitmentId:payload.commitmentId,budgetId:budget.budgetId,amountMinorUnits:payload.amountMinorUnits},
            auditReason:`Committed ${payload.amountMinorUnits} minor units from budget ${budget.budgetId}.`,resultData:{commitment,budget:next}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.commitmentId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async releaseBudgetCommitment(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ReleaseBudgetCommitmentPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['BUDGET_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Budget commitment release authority required.');
    try{
      const preflight=await DomainStateRepository.getById<BudgetCommitmentRecord>(context.tenantId,'financeBudgetCommitments',payload.commitmentId);
      if(!preflight)throw new AtomicMutationRejectedError('BUDGET_COMMITMENT_NOT_FOUND','Budget commitment does not exist.');
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'BUDGET_MANAGER',
        aggregateType:'BUDGET_COMMITMENT',aggregateId:payload.commitmentId,eventType:'BUDGET_COMMITMENT_RELEASED',
        auditAction:'BUDGET_COMMITMENT_RELEASED',auditResourceType:'BUDGET_COMMITMENT',auditResourceId:payload.commitmentId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'commitment',entityType:'BUDGET_COMMITMENT',entityId:payload.commitmentId,required:true},
          {key:'budget',entityType:'BUDGET_ENVELOPE',entityId:preflight.budgetId,required:true},
        ],
        prepare:(current)=>{
          const commitment=current.commitment as unknown as BudgetCommitmentRecord;
          const budget=current.budget as unknown as BudgetEnvelopeRecord;
          if(commitment.status!=='ACTIVE')throw new AtomicMutationRejectedError('BUDGET_COMMITMENT_NOT_ACTIVE','Only active commitment may be released.');
          const nextCommitment:BudgetCommitmentRecord={...commitment,status:'RELEASED',releasedAt:new Date().toISOString()};
          const nextBudget:BudgetEnvelopeRecord={...budget,committedMinorUnits:Math.max(0,budget.committedMinorUnits-commitment.amountMinorUnits),availableMinorUnits:budget.availableMinorUnits+commitment.amountMinorUnits};
          return {domainState:nextCommitment,additionalStateWrites:[{entityType:'BUDGET_ENVELOPE',entityId:budget.budgetId,domainState:nextBudget}],
            eventPayload:{commitmentId:commitment.commitmentId,budgetId:budget.budgetId,amountMinorUnits:commitment.amountMinorUnits},
            auditReason:`Released budget commitment ${commitment.commitmentId}: ${payload.reason}`,resultData:{commitment:nextCommitment,budget:nextBudget}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.commitmentId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async consumeBudgetCommitment(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ConsumeBudgetCommitmentPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['BUDGET_MANAGER','ACCOUNTANT','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return reject(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Budget actualization authority required.');
    try{
      const preflight=await DomainStateRepository.getById<BudgetCommitmentRecord>(context.tenantId,'financeBudgetCommitments',payload.commitmentId);
      if(!preflight)throw new AtomicMutationRejectedError('BUDGET_COMMITMENT_NOT_FOUND','Budget commitment does not exist.');
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'ACCOUNTANT',
        aggregateType:'BUDGET_COMMITMENT',aggregateId:payload.commitmentId,eventType:'BUDGET_COMMITMENT_CONSUMED',
        auditAction:'BUDGET_COMMITMENT_CONSUMED',auditResourceType:'BUDGET_COMMITMENT',auditResourceId:payload.commitmentId,
        outboxTopic:'g-hims-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'commitment',entityType:'BUDGET_COMMITMENT',entityId:payload.commitmentId,required:true},
          {key:'budget',entityType:'BUDGET_ENVELOPE',entityId:preflight.budgetId,required:true},
          {key:'journal',entityType:'JOURNAL_ENTRY',entityId:payload.journalId,required:true},
        ],
        prepare:(current)=>{
          const commitment=current.commitment as unknown as BudgetCommitmentRecord;
          const budget=current.budget as unknown as BudgetEnvelopeRecord;
          const journal=current.journal as unknown as GovernedJournalRecord;
          if(commitment.status!=='ACTIVE')throw new AtomicMutationRejectedError('BUDGET_COMMITMENT_NOT_ACTIVE','Only active commitment may be consumed.');
          const actual=journal.lines.filter(line=>line.glAccountId===budget.accountCode&&line.costCenterId===budget.costCenterId)
            .reduce((sum,line)=>sum+line.debitMinorUnits-line.creditMinorUnits,0);
          if(actual<=0||actual>commitment.amountMinorUnits)throw new AtomicMutationRejectedError(
            'BUDGET_JOURNAL_EVIDENCE_MISMATCH',
            'Posted journal does not contain a compatible positive budget actual within the commitment.'
          );
          const nextCommitment:BudgetCommitmentRecord={...commitment,status:'CONSUMED',consumedAt:new Date().toISOString()};
          const nextBudget:BudgetEnvelopeRecord={
            ...budget,committedMinorUnits:Math.max(0,budget.committedMinorUnits-commitment.amountMinorUnits),
            actualMinorUnits:budget.actualMinorUnits+actual,
            availableMinorUnits:budget.availableMinorUnits+(commitment.amountMinorUnits-actual),
          };
          return {domainState:nextCommitment,additionalStateWrites:[{entityType:'BUDGET_ENVELOPE',entityId:budget.budgetId,domainState:nextBudget}],
            eventPayload:{commitmentId:commitment.commitmentId,budgetId:budget.budgetId,journalId:payload.journalId,actualMinorUnits:actual},
            auditReason:`Consumed budget commitment ${commitment.commitmentId} using posted journal ${payload.journalId}.`,
            resultData:{commitment:nextCommitment,budget:nextBudget}};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.commitmentId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return reject(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
