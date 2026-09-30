import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  BatchLotRecord,
  InventoryBalance,
  ItemMaster,
  PatientConsumptionRecord,
  StockTransaction,
} from '@/types/scm-domain';
import type {
  CreateInventoryDispositionPayload,
  ExecuteInventoryDispositionPayload,
  ExecuteRecallQuarantinePayload,
  GovernedRecallCase,
  InitiateRecallPayload,
  InventoryDispositionOrder,
  ProjectRecallExposuresPayload,
  RecallExposureRecord,
  RecordRecallNotificationPayload,
  ResolveRecallPayload,
  ReviewInventoryDispositionPayload,
} from '@/types/scm-recall';
import {
  batchMatchesRecall,
  consumptionMatchesRecall,
} from '@/lib/supply-chain/recall-disposition';
import {
  inventoryAccountForItemType,
  inventoryPeriodCloseId,
  isInventoryPeriodBlocked,
  periodKeyFromIso,
  toMinorUnits,
} from '@/lib/supply-chain/inventory-costing';

function rejection(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

function assertFacilityScope(context: CommandContext, facilityId: string): void {
  const admin = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !admin &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Recall/disposition operation is outside the actor facility scope.'
    );
  }
}

function assertDate(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new AtomicMutationRejectedError(code, 'A valid ISO timestamp is required.');
  }
  return parsed;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assertRecallCriteria(payload: InitiateRecallPayload): void {
  const batches = unique(payload.targetBatchNumbers || []);
  const lots = unique(payload.targetLotNumbers || []);
  const serials = unique(payload.targetSerialNumbers || []);
  switch (payload.scope) {
    case 'BATCH_WIDE':
      if (!batches.length) throw new AtomicMutationRejectedError('RECALL_BATCH_REQUIRED','Batch-wide recall requires at least one batch number.');
      break;
    case 'LOT_WIDE':
      if (!lots.length) throw new AtomicMutationRejectedError('RECALL_LOT_REQUIRED','Lot-wide recall requires at least one lot number.');
      break;
    case 'SERIAL_SPECIFIC':
      if (!serials.length || !batches.length) throw new AtomicMutationRejectedError('RECALL_SERIAL_AND_BATCH_REQUIRED','Serial-specific recall requires exact serials plus affected batch provenance for physical quarantine.');
      break;
    case 'SUPPLIER_SPECIFIC':
      if (!payload.supplierId?.trim()) throw new AtomicMutationRejectedError('RECALL_SUPPLIER_REQUIRED','Supplier-specific recall requires supplier identity.');
      break;
    case 'MANUFACTURER_SPECIFIC':
      if (!payload.manufacturerName?.trim()) throw new AtomicMutationRejectedError('RECALL_MANUFACTURER_REQUIRED','Manufacturer-specific recall requires manufacturer identity.');
      break;
    default:
      break;
  }
}

function dispositionJournal(params: {
  order: InventoryDispositionOrder;
  journalId: string;
  postedBy: string;
  postingMs: number;
}) {
  const inventoryName =
    params.order.inventoryAccountCode === '1210'
      ? 'Pharmacy Formulary Inventory'
      : 'Surgical & Sterile Medical Supplies Inventory';
  const debitAccount =
    params.order.dispositionType === 'RETURN_TO_SUPPLIER'
      ? {
          id: '1250',
          name: 'Supplier Returns & Credit Receivable',
        }
      : {
          id: '6040',
          name: 'Inventory Shrinkage, Count Variance & Write-Off Expense',
        };
  return {
    journalId: params.journalId,
    tenantId: params.order.tenantId,
    fiscalYear: new Date(params.postingMs).getUTCFullYear(),
    postingPeriod: new Date(params.postingMs).getUTCMonth() + 1,
    documentDate: params.postingMs,
    postingDate: params.postingMs,
    referenceDocumentId: params.order.orderId,
    documentHeader: `Inventory disposition ${params.order.orderNumber}`,
    currency: params.order.currency,
    totalAmountMinorUnits: params.order.totalValueMinorUnits,
    lines: [
      {
        glAccountId: debitAccount.id,
        glAccountName: debitAccount.name,
        debitMinorUnits: params.order.totalValueMinorUnits,
        creditMinorUnits: 0,
        lineDescription: `${params.order.dispositionType} ${params.order.itemName}`,
      },
      {
        glAccountId: params.order.inventoryAccountCode,
        glAccountName: inventoryName,
        debitMinorUnits: 0,
        creditMinorUnits: params.order.totalValueMinorUnits,
        lineDescription: `Remove disposed inventory ${params.order.itemName}`,
      },
    ],
    status: 'POSTED',
    postedBy: params.postedBy,
    postedAt: Date.now(),
  };
}

export class ScmRecallDispositionDomainService {
  public static async initiateRecall(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: InitiateRecallPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'QUALITY_MANAGER',
        'PHARMACIST',
        'PATIENT_SAFETY_OFFICER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(commandId,idempotencyKey,auth.code || 'UNAUTHORIZED',auth.reason || 'Recall initiation authority required.');
    }

    try {
      assertRecallCriteria(payload);
      assertDate(payload.initiatedAt, 'INVALID_RECALL_INITIATED_AT');
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SCM_RECALL',
        aggregateId: payload.recallId,
        eventType: 'SCM_RECALL_INITIATED',
        auditAction: 'SCM_RECALL_INITIATED',
        auditResourceType: 'SCM_RECALL',
        auditResourceId: payload.recallId,
        outboxTopic: 'g-hims-scm-safety-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'item',
          entityType: 'ITEM_MASTER',
          entityId: payload.itemId,
          required: true,
        }],
        prepare: (current) => {
          const item = current.item as unknown as ItemMaster;
          if (item.isActive === false) {
            throw new AtomicMutationRejectedError(
              'RECALL_ITEM_INACTIVE',
              'Recall item is missing or inactive.'
            );
          }
          const now = new Date().toISOString();
          const recall: GovernedRecallCase = {
            recallId: payload.recallId,
            tenantId: context.tenantId,
            recallCaseNumber: payload.recallCaseNumber,
            itemId: item.itemId,
            itemCode: item.itemCode,
            itemName: item.name,
            scope: payload.scope,
            targetBatchNumbers: unique(payload.targetBatchNumbers || []),
            targetLotNumbers: unique(payload.targetLotNumbers || []),
            targetSerialNumbers: unique(payload.targetSerialNumbers || []),
            supplierId: payload.supplierId?.trim() || undefined,
            manufacturerName: payload.manufacturerName?.trim() || undefined,
            recallReason: payload.recallReason,
            severity: payload.severity,
            status: 'INITIATED',
            initiatedBy: context.actorId,
            initiatedAt: payload.initiatedAt,
            quarantinedBatchIds: [],
            quarantinedBalanceIds: [],
            quarantinedQuantity: 0,
            exposureCount: 0,
            notifiedExposureCount: 0,
            dispositionOrderIds: [],
            updatedAt: now,
          };
          return {
            domainState: recall,
            eventPayload: {
              recallId: recall.recallId,
              itemId: recall.itemId,
              scope: recall.scope,
              severity: recall.severity,
            },
            auditReason: `Initiated ${recall.severity} recall ${recall.recallCaseNumber} for ${item.itemCode}.`,
            resultData: recall,
          };
        },
      });
      return { success:true,commandId,idempotencyKey,entityId:payload.recallId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async executeRecallQuarantine(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ExecuteRecallQuarantinePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'QUALITY_MANAGER',
        'PHARMACIST',
        'INVENTORY_OFFICER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(commandId,idempotencyKey,auth.code || 'UNAUTHORIZED',auth.reason || 'Recall quarantine authority required.');
    }

    try {
      const batchIds = unique(payload.batchIds);
      const balanceIds = unique(payload.balanceIds);
      if (!batchIds.length || batchIds.length > 50 || !balanceIds.length || balanceIds.length > 100) {
        throw new AtomicMutationRejectedError(
          'INVALID_RECALL_QUARANTINE_CHUNK',
          'Recall quarantine chunk requires 1-50 unique batches and 1-100 unique balances.'
        );
      }
      const recallPreflight = await DomainStateRepository.getById<GovernedRecallCase>(
        context.tenantId,'scmRecalls',payload.recallId
      );
      if (!recallPreflight) throw new AtomicMutationRejectedError('RECALL_NOT_FOUND','Recall case does not exist.');

      let expectedBalanceIds: string[] = [];
      let expectedBatchIds: string[] = [];
      if (payload.finalChunk) {
        const [allBatches, allBalances] = await Promise.all([
          DomainStateRepository.queryAllEqual<BatchLotRecord>(
            context.tenantId,'batches','itemId',recallPreflight.itemId,{pageSize:500,maxRows:50000}
          ),
          DomainStateRepository.queryAllEqual<InventoryBalance>(
            context.tenantId,'inventoryBalances','itemId',recallPreflight.itemId,{pageSize:500,maxRows:100000}
          ),
        ]);
        const affectedBatches = allBatches.filter((batch) =>
          batchMatchesRecall(recallPreflight,batch)
        );
        const affectedBatchIds = new Set(affectedBatches.map((batch)=>batch.batchId));
        expectedBatchIds = affectedBatches.map((batch)=>batch.batchId).sort();
        expectedBalanceIds = allBalances
          .filter((balance)=>affectedBatchIds.has(balance.batchId) && balance.onHand > 0)
          .map((balance)=>balance.balanceId)
          .sort();
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType:'SCM_RECALL',
        aggregateId:payload.recallId,
        eventType:payload.finalChunk ? 'SCM_RECALL_QUARANTINE_COMPLETED' : 'SCM_RECALL_QUARANTINE_CHUNK_COMMITTED',
        auditAction:payload.finalChunk ? 'SCM_RECALL_QUARANTINE_COMPLETED' : 'SCM_RECALL_QUARANTINE_CHUNK_COMMITTED',
        auditResourceType:'SCM_RECALL',
        auditResourceId:payload.recallId,
        outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'recall',entityType:'SCM_RECALL',entityId:payload.recallId,required:true},
          ...batchIds.map((batchId,index)=>({key:`batch:${index}`,entityType:'BATCH_LOT',entityId:batchId,required:true})),
          ...balanceIds.map((balanceId,index)=>({key:`balance:${index}`,entityType:'INVENTORY_BALANCE',entityId:balanceId,required:true})),
        ],
        prepare:(current)=>{
          const recall=current.recall as unknown as GovernedRecallCase;
          if (recall.status === 'RESOLVED_DISPOSED') throw new AtomicMutationRejectedError('RECALL_ALREADY_RESOLVED','Resolved recall cannot be mutated.');
          const selectedBatches=batchIds.map((_,i)=>current[`batch:${i}`] as unknown as BatchLotRecord);
          selectedBatches.forEach((batch)=>{
            if(!batchMatchesRecall(recall,batch)) throw new AtomicMutationRejectedError('RECALL_BATCH_SCOPE_MISMATCH',`Batch ${batch.batchId} does not match recall criteria.`);
          });
          const selectedBatchIds=new Set(selectedBatches.map((batch)=>batch.batchId));
          const now=new Date().toISOString();
          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          let newlyQuarantined=0;

          selectedBatches.forEach((batch)=>{
            writes.push({
              entityType:'BATCH_LOT',
              entityId:batch.batchId,
              domainState:{
                ...batch,
                status:'QUARANTINED',
                quarantineReason:`RECALL ${recall.recallCaseNumber}: ${recall.recallReason}`,
                updatedAt:now,
              },
            });
          });

          balanceIds.forEach((balanceId,index)=>{
            const balance=current[`balance:${index}`] as unknown as InventoryBalance;
            if(!selectedBatchIds.has(balance.batchId) || balance.itemId!==recall.itemId) {
              throw new AtomicMutationRejectedError('RECALL_BALANCE_SCOPE_MISMATCH',`Balance ${balance.balanceId} does not belong to an affected batch.`);
            }
            const targetQuarantine=Math.max(
              Number(balance.quarantined || 0),
              Math.max(0,Number(balance.onHand||0)-Number(balance.damaged||0)-Number(balance.expired||0))
            );
            const delta=Math.max(0,targetQuarantine-Number(balance.quarantined||0));
            newlyQuarantined+=delta;
            const next:InventoryBalance={
              ...balance,
              reserved:0,
              quarantined:targetQuarantine,
              available:0,
              lastMovementAt:now,
              version:Number(balance.version||0)+1,
            };
            writes.push({entityType:'INVENTORY_BALANCE',entityId:balance.balanceId,domainState:next});
            if(delta>0){
              const transactionId=`txn_recall_${recall.recallId}_${balance.balanceId}`;
              const txn:StockTransaction={
                transactionId,
                tenantId:context.tenantId,
                facilityId:balance.facilityId,
                itemId:balance.itemId,
                itemCode:balance.itemCode,
                itemName:balance.itemName,
                batchId:balance.batchId,
                batchNumber:balance.batchNumber,
                fromLocationId:balance.locationId,
                fromLocationName:balance.locationName,
                quantity:delta,
                uom:balance.uom,
                normalizedQuantity:delta,
                unitCost:balance.unitCost,
                totalCost:Math.round(delta*balance.unitCost*100)/100,
                currency:String(selectedBatches.find((candidate)=>candidate.batchId===balance.batchId)?.currency||'').trim().toUpperCase(),
                transactionType:'QUARANTINE',
                referenceType:'RECALL_CASE',
                referenceId:recall.recallId,
                reasonCode:'RECALL',
                performedBy:{userId:context.actorId,userName:context.actorId,role:context.roles[0]||'AUTHENTICATED_USER'},
                occurredAt:now,
                recordedAt:now,
                idempotencyKey,
                source:'SYSTEM',
              };
              writes.push({entityType:'STOCK_TRANSACTION',entityId:transactionId,domainState:txn});
            }
          });

          const mergedBatchIds=unique([...recall.quarantinedBatchIds,...batchIds]);
          const mergedBalanceIds=unique([...recall.quarantinedBalanceIds,...balanceIds]);
          if(payload.finalChunk){
            if(
              expectedBatchIds.some((id)=>!mergedBatchIds.includes(id)) ||
              expectedBalanceIds.some((id)=>!mergedBalanceIds.includes(id))
            ){
              throw new AtomicMutationRejectedError(
                'RECALL_QUARANTINE_INCOMPLETE',
                'Final recall quarantine chunk does not cover all authoritative affected stock.',
                {expectedBatchIds,expectedBalanceIds,mergedBatchIds,mergedBalanceIds}
              );
            }
          }
          const next:GovernedRecallCase={
            ...recall,
            status:payload.finalChunk?'QUARANTINE_EXECUTED':'QUARANTINE_IN_PROGRESS',
            quarantinedBatchIds:mergedBatchIds,
            quarantinedBalanceIds:mergedBalanceIds,
            quarantinedQuantity:Number(recall.quarantinedQuantity||0)+newlyQuarantined,
            updatedAt:now,
          };
          return {
            domainState:next,
            additionalStateWrites:writes,
            eventPayload:{recallId:recall.recallId,batchIds,balanceIds,newlyQuarantined,finalChunk:payload.finalChunk},
            auditReason:`Committed recall quarantine chunk for ${recall.recallCaseNumber}; ${newlyQuarantined} units newly blocked.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.recallId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    } catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async projectRecallExposures(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ProjectRecallExposuresPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['PATIENT_SAFETY_OFFICER','QUALITY_MANAGER','SCM_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Recall exposure authority required.');
    try{
      const consumptionIds=unique(payload.consumptionIds);
      if(!consumptionIds.length||consumptionIds.length>100) throw new AtomicMutationRejectedError('INVALID_RECALL_EXPOSURE_CHUNK','Exposure projection chunk requires 1-100 unique consumption IDs.');
      const recallPreflight=await DomainStateRepository.getById<GovernedRecallCase>(context.tenantId,'scmRecalls',payload.recallId);
      if(!recallPreflight) throw new AtomicMutationRejectedError('RECALL_NOT_FOUND','Recall case does not exist.');
      let expectedIds:string[]=[];
      if(payload.finalChunk){
        const all=await DomainStateRepository.queryAllEqual<PatientConsumptionRecord>(
          context.tenantId,'patientConsumptions','itemId',recallPreflight.itemId,{pageSize:500,maxRows:100000}
        );
        expectedIds=all.filter((record)=>consumptionMatchesRecall(recallPreflight,record)).map((record)=>record.consumptionId).sort();
      }
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'SCM_RECALL',aggregateId:payload.recallId,
        eventType:payload.finalChunk?'SCM_RECALL_EXPOSURES_COMPLETED':'SCM_RECALL_EXPOSURE_CHUNK_COMMITTED',
        auditAction:payload.finalChunk?'SCM_RECALL_EXPOSURES_COMPLETED':'SCM_RECALL_EXPOSURE_CHUNK_COMMITTED',
        auditResourceType:'SCM_RECALL',auditResourceId:payload.recallId,outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'recall',entityType:'SCM_RECALL',entityId:payload.recallId,required:true},
          ...consumptionIds.map((id,index)=>({key:`consumption:${index}`,entityType:'PATIENT_CONSUMPTION',entityId:id,required:true})),
          ...consumptionIds.map((id,index)=>({key:`exposure:${index}`,entityType:'RECALL_EXPOSURE',entityId:`rexp_${payload.recallId}_${id}`,required:false})),
        ],
        prepare:(current)=>{
          const recall=current.recall as unknown as GovernedRecallCase;
          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          let created=0;
          const projectedIds:string[]=[];
          consumptionIds.forEach((id,index)=>{
            const consumption=current[`consumption:${index}`] as unknown as PatientConsumptionRecord;
            if(!consumptionMatchesRecall(recall,consumption)) throw new AtomicMutationRejectedError('RECALL_EXPOSURE_SCOPE_MISMATCH',`Consumption ${id} does not match recall criteria.`);
            const exposureId=`rexp_${recall.recallId}_${id}`;
            projectedIds.push(id);
            if(current[`exposure:${index}`]) return;
            const exposure:RecallExposureRecord={
              exposureId,tenantId:context.tenantId,recallId:recall.recallId,consumptionId:id,
              patientId:consumption.patientId,patientMRN:consumption.patientMRN,encounterId:consumption.encounterId,
              procedureId:consumption.procedureId,procedureName:consumption.procedureName,itemId:consumption.itemId,
              batchId:consumption.batchId,batchNumber:consumption.batchNumber,serialNumber:consumption.serialNumber,
              lotNumber:consumption.lotNumber,udi:consumption.udi,consumedAt:consumption.consumedAt,notificationStatus:'PENDING',
            };
            writes.push({entityType:'RECALL_EXPOSURE',entityId:exposureId,domainState:exposure});
            created+=1;
          });
          const previousCount=Number(recall.exposureCount||0);
          if(payload.finalChunk && previousCount+created < expectedIds.length){
            throw new AtomicMutationRejectedError('RECALL_EXPOSURE_PROJECTION_INCOMPLETE','Final exposure chunk does not cover all authoritative patient consumption matches.',{expectedCount:expectedIds.length,projectedCount:previousCount+created});
          }
          const now=new Date().toISOString();
          const next:GovernedRecallCase={
            ...recall,status:payload.finalChunk?'PATIENTS_IDENTIFIED':'PATIENT_TRACE_IN_PROGRESS',
            exposureCount:previousCount+created,updatedAt:now,
          };
          return {
            domainState:next,additionalStateWrites:writes,
            eventPayload:{recallId:recall.recallId,created,finalChunk:payload.finalChunk,consumptionIds:projectedIds},
            auditReason:`Projected ${created} new patient recall exposures for ${recall.recallCaseNumber}.`,
            resultData:next,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.recallId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async recordRecallNotification(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:RecordRecallNotificationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['PATIENT_SAFETY_OFFICER','NURSE','DOCTOR','QUALITY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Recall notification authority required.');
    try{
      assertDate(payload.notifiedAt,'INVALID_RECALL_NOTIFICATION_DATE');
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'RECALL_EXPOSURE',aggregateId:payload.exposureId,eventType:'RECALL_PATIENT_NOTIFIED',
        auditAction:'RECALL_PATIENT_NOTIFIED',auditResourceType:'RECALL_EXPOSURE',auditResourceId:payload.exposureId,
        outboxTopic:'g-hims-patient-safety-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'exposure',entityType:'RECALL_EXPOSURE',entityId:payload.exposureId,required:true},
          {key:'recall',entityType:'SCM_RECALL',entityId:payload.recallId,required:true},
        ],
        prepare:(current)=>{
          const exposure=current.exposure as unknown as RecallExposureRecord;
          const recall=current.recall as unknown as GovernedRecallCase;
          if(exposure.recallId!==recall.recallId) throw new AtomicMutationRejectedError('RECALL_EXPOSURE_CASE_MISMATCH','Exposure does not belong to recall case.');
          if(exposure.notificationStatus==='NOTIFIED') throw new AtomicMutationRejectedError('RECALL_EXPOSURE_ALREADY_NOTIFIED','Patient exposure is already marked notified.');
          const nextExposure:RecallExposureRecord={...exposure,notificationStatus:'NOTIFIED',notifiedBy:context.actorId,notifiedAt:payload.notifiedAt,notificationNote:payload.note};
          const nextRecall:GovernedRecallCase={...recall,notifiedExposureCount:Number(recall.notifiedExposureCount||0)+1,updatedAt:new Date().toISOString()};
          return {
            domainState:nextExposure,
            additionalStateWrites:[{entityType:'SCM_RECALL',entityId:recall.recallId,domainState:nextRecall}],
            eventPayload:{recallId:recall.recallId,exposureId:exposure.exposureId,patientId:exposure.patientId,notifiedAt:payload.notifiedAt},
            auditReason:`Recorded patient notification for recall exposure ${exposure.exposureId}.`,
            resultData:nextExposure,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.exposureId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async createDisposition(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:CreateInventoryDispositionPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['SCM_MANAGER','INVENTORY_OFFICER','PHARMACIST','QUALITY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Inventory disposition authority required.');
    try{
      assertFacilityScope(context,payload.facilityId);
      assertDate(payload.requestedAt,'INVALID_DISPOSITION_REQUEST_DATE');
      if(!Number.isFinite(payload.quantity)||payload.quantity<=0) throw new AtomicMutationRejectedError('INVALID_DISPOSITION_QUANTITY','Disposition quantity must be positive.');
      if(payload.dispositionType==='RETURN_TO_SUPPLIER'&&!payload.supplierId?.trim()) throw new AtomicMutationRejectedError('SUPPLIER_RETURN_SUPPLIER_REQUIRED','Return-to-supplier disposition requires supplier identity.');
      const periodCloseId=inventoryPeriodCloseId(payload.facilityId,periodKeyFromIso(payload.requestedAt));
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'INVENTORY_DISPOSITION',aggregateId:payload.orderId,eventType:'INVENTORY_DISPOSITION_REQUESTED',
        auditAction:'INVENTORY_DISPOSITION_REQUESTED',auditResourceType:'INVENTORY_DISPOSITION',auditResourceId:payload.orderId,
        outboxTopic:'g-hims-scm-safety-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'balance',entityType:'INVENTORY_BALANCE',entityId:payload.balanceId,required:true},
          {key:'batch',entityType:'BATCH_LOT',entityId:payload.batchId,required:true},
          {key:'periodClose',entityType:'INVENTORY_PERIOD_CLOSE',entityId:periodCloseId,required:false},
          ...(payload.recallId?[{key:'recall',entityType:'SCM_RECALL',entityId:payload.recallId,required:true}]:[]),
        ],
        prepare:(current)=>{
          const balance=current.balance as unknown as InventoryBalance;
          const batch=current.batch as unknown as BatchLotRecord;
          if(isInventoryPeriodBlocked(current.periodClose)) throw new AtomicMutationRejectedError('INVENTORY_PERIOD_BLOCKED','Disposition cannot be requested into a closing or closed inventory period.');
          if(balance.facilityId!==payload.facilityId||balance.locationId!==payload.locationId||balance.batchId!==payload.batchId||batch.batchId!==payload.batchId||batch.itemId!==balance.itemId){
            throw new AtomicMutationRejectedError('DISPOSITION_STOCK_SCOPE_MISMATCH','Disposition balance/batch/facility/location identity is inconsistent.');
          }
          const controlledQuantity=
            payload.reason==='RECALL'?Number(balance.quarantined||0):
            payload.reason==='EXPIRY'?Number(balance.expired||0):
            payload.reason==='DAMAGE'?Number(balance.damaged||0):
            Number(balance.quarantined||0);
          if(controlledQuantity+0.000001<payload.quantity||Number(balance.onHand||0)+0.000001<payload.quantity){
            throw new AtomicMutationRejectedError('DISPOSITION_QUANTITY_EXCEEDS_CONTROLLED_STOCK','Disposition quantity exceeds authoritative controlled/on-hand stock.');
          }
          if(payload.recallId){
            const recall=current.recall as unknown as GovernedRecallCase;
            if(recall.itemId!==balance.itemId||!recall.quarantinedBalanceIds.includes(balance.balanceId)) throw new AtomicMutationRejectedError('DISPOSITION_RECALL_SCOPE_MISMATCH','Disposition is not tied to stock quarantined by the recall.');
          }
          const itemCurrency=String(batch.currency||'').trim().toUpperCase();
          if(itemCurrency.length!==3) throw new AtomicMutationRejectedError('DISPOSITION_CURRENCY_INVALID','Batch currency must be a 3-letter code.');
          const unitCostMinorUnits=toMinorUnits(balance.unitCost);
          const order:InventoryDispositionOrder={
            orderId:payload.orderId,tenantId:context.tenantId,orderNumber:payload.orderNumber,
            facilityId:payload.facilityId,locationId:payload.locationId,balanceId:balance.balanceId,itemId:balance.itemId,
            itemCode:balance.itemCode,itemName:balance.itemName,itemType:balance.itemType,batchId:batch.batchId,batchNumber:batch.batchNumber,
            quantity:payload.quantity,uom:balance.uom,unitCostMinorUnits,totalValueMinorUnits:Math.round(payload.quantity*unitCostMinorUnits),
            currency:itemCurrency,inventoryAccountCode:inventoryAccountForItemType(balance.itemType),dispositionType:payload.dispositionType,
            reason:payload.reason,recallId:payload.recallId,supplierId:payload.supplierId,justification:payload.justification,
            status:'PENDING_APPROVAL',requestedBy:context.actorId,requestedAt:payload.requestedAt,
          };
          return {domainState:order,eventPayload:{orderId:order.orderId,itemId:order.itemId,batchId:order.batchId,quantity:order.quantity,dispositionType:order.dispositionType,reason:order.reason},auditReason:`Requested ${order.dispositionType} disposition ${order.orderNumber} for ${order.quantity} ${order.uom}.`,resultData:order};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.orderId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async reviewDisposition(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ReviewInventoryDispositionPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['SCM_MANAGER','QUALITY_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Disposition approval authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'INVENTORY_DISPOSITION',aggregateId:payload.orderId,eventType:payload.decision==='APPROVE'?'INVENTORY_DISPOSITION_APPROVED':'INVENTORY_DISPOSITION_REJECTED',
        auditAction:payload.decision==='APPROVE'?'INVENTORY_DISPOSITION_APPROVED':'INVENTORY_DISPOSITION_REJECTED',
        auditResourceType:'INVENTORY_DISPOSITION',auditResourceId:payload.orderId,outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'order',entityType:'INVENTORY_DISPOSITION',entityId:payload.orderId,required:true}],
        prepare:(current)=>{
          const order=current.order as unknown as InventoryDispositionOrder;
          assertFacilityScope(context,order.facilityId);
          if(order.status!=='PENDING_APPROVAL') throw new AtomicMutationRejectedError('DISPOSITION_NOT_REVIEWABLE',`Disposition status ${order.status} cannot be reviewed.`);
          if(order.requestedBy===context.actorId) throw new AtomicMutationRejectedError('SCM_SEGREGATION_OF_DUTIES','Disposition requester cannot approve their own disposition.');
          const now=new Date().toISOString();
          const next:InventoryDispositionOrder={...order,status:payload.decision==='APPROVE'?'APPROVED':'REJECTED',reviewedBy:context.actorId,reviewedAt:now,reviewComments:payload.comments};
          return {domainState:next,eventPayload:{orderId:order.orderId,decision:payload.decision,reviewedBy:context.actorId},auditReason:`${payload.decision} inventory disposition ${order.orderNumber}.`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.orderId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async executeDisposition(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ExecuteInventoryDispositionPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['INVENTORY_OFFICER','SCM_MANAGER','PHARMACIST','QUALITY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Disposition execution authority required.');
    try{
      const executionMs=assertDate(payload.executedAt,'INVALID_DISPOSITION_EXECUTION_DATE');
      const preflight=await DomainStateRepository.getById<InventoryDispositionOrder>(context.tenantId,'scmInventoryDispositions',payload.orderId);
      if(!preflight) throw new AtomicMutationRejectedError('DISPOSITION_NOT_FOUND','Inventory disposition order does not exist.');
      assertFacilityScope(context,preflight.facilityId);
      if(payload.witnessUserId===context.actorId||payload.witnessUserId===preflight.requestedBy||payload.witnessUserId===preflight.reviewedBy){
        throw new AtomicMutationRejectedError('DISPOSITION_WITNESS_NOT_INDEPENDENT','Disposition witness must be independent from requester, approver, and executor.');
      }
      const witness=await DomainStateRepository.getById<Record<string,unknown>>(context.tenantId,'users',payload.witnessUserId);
      if(!witness||String(witness.status||'')!=='ACTIVE') throw new AtomicMutationRejectedError('DISPOSITION_WITNESS_NOT_ACTIVE','Disposition witness must be an active tenant member.');
      if(preflight.dispositionType==='DESTROY'&&!payload.destructionCertificateNumber?.trim()) throw new AtomicMutationRejectedError('DESTRUCTION_CERTIFICATE_REQUIRED','Physical destruction requires a certificate number.');
      if(preflight.dispositionType==='RETURN_TO_SUPPLIER'&&!payload.carrierReference?.trim()) throw new AtomicMutationRejectedError('SUPPLIER_RETURN_CARRIER_REQUIRED','Supplier return requires carrier/shipping reference.');
      const closeId=inventoryPeriodCloseId(preflight.facilityId,periodKeyFromIso(payload.executedAt));
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'INVENTORY_DISPOSITION',aggregateId:payload.orderId,eventType:preflight.dispositionType==='DESTROY'?'INVENTORY_DESTROYED':'INVENTORY_RETURNED_TO_SUPPLIER',
        auditAction:preflight.dispositionType==='DESTROY'?'INVENTORY_DESTROYED':'INVENTORY_RETURNED_TO_SUPPLIER',
        auditResourceType:'INVENTORY_DISPOSITION',auditResourceId:payload.orderId,outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'order',entityType:'INVENTORY_DISPOSITION',entityId:payload.orderId,required:true},
          {key:'balance',entityType:'INVENTORY_BALANCE',entityId:preflight.balanceId,required:true},
          {key:'batch',entityType:'BATCH_LOT',entityId:preflight.batchId,required:true},
          {key:'periodClose',entityType:'INVENTORY_PERIOD_CLOSE',entityId:closeId,required:false},
          ...(preflight.recallId?[{key:'recall',entityType:'SCM_RECALL',entityId:preflight.recallId,required:true}]:[]),
        ],
        prepare:(current)=>{
          const order=current.order as unknown as InventoryDispositionOrder;
          const balance=current.balance as unknown as InventoryBalance;
          const batch=current.batch as unknown as BatchLotRecord;
          if(isInventoryPeriodBlocked(current.periodClose)) throw new AtomicMutationRejectedError('INVENTORY_PERIOD_BLOCKED','Disposition cannot execute into a closing or closed inventory period.');
          if(order.status!=='APPROVED') throw new AtomicMutationRejectedError('DISPOSITION_NOT_APPROVED','Only an approved disposition may execute.');
          if(order.reviewedBy===context.actorId||order.requestedBy===context.actorId) throw new AtomicMutationRejectedError('SCM_SEGREGATION_OF_DUTIES','Requester/approver cannot execute the same disposition.');
          if(balance.balanceId!==order.balanceId||batch.batchId!==order.batchId||Number(balance.onHand||0)+0.000001<order.quantity) throw new AtomicMutationRejectedError('DISPOSITION_STOCK_CHANGED','Authoritative disposition stock changed before execution.');
          const controlledField=order.reason==='RECALL'?'quarantined':order.reason==='EXPIRY'?'expired':order.reason==='DAMAGE'?'damaged':'quarantined';
          const controlled=Number((balance as unknown as Record<string,unknown>)[controlledField]||0);
          if(controlled+0.000001<order.quantity) throw new AtomicMutationRejectedError('DISPOSITION_CONTROLLED_QUANTITY_CHANGED','Controlled stock quantity is no longer sufficient for disposition.');
          const now=new Date().toISOString();
          const nextBalance:InventoryBalance={
            ...balance,
            onHand:Math.max(0,balance.onHand-order.quantity),
            [controlledField]:Math.max(0,controlled-order.quantity),
            available:0,
            totalValuation:Math.round(Math.max(0,balance.onHand-order.quantity)*balance.unitCost*100)/100,
            lastMovementAt:now,
            version:Number(balance.version||0)+1,
          } as InventoryBalance;
          nextBalance.available=Math.max(0,nextBalance.onHand-nextBalance.reserved-nextBalance.quarantined-nextBalance.damaged-nextBalance.expired);
          const nextRemaining=Math.max(0,Number(batch.quantityRemaining||0)-order.quantity);
          const nextBatch:BatchLotRecord={...batch,quantityRemaining:nextRemaining,status:nextRemaining<=0?'DEPLETED':batch.status,updatedAt:now};
          const stockTransactionId=`txn_disp_${order.orderId}`;
          const txn:StockTransaction={
            transactionId:stockTransactionId,tenantId:context.tenantId,facilityId:order.facilityId,itemId:order.itemId,itemCode:order.itemCode,itemName:order.itemName,
            batchId:order.batchId,batchNumber:order.batchNumber,fromLocationId:order.locationId,quantity:order.quantity,uom:order.uom,normalizedQuantity:order.quantity,
            unitCost:order.unitCostMinorUnits/100,totalCost:order.totalValueMinorUnits/100,currency:order.currency,
            transactionType:order.dispositionType==='DESTROY'?'WRITE_OFF':'RETURN_TO_SUPPLIER',referenceType:'DISPOSAL_ORDER',referenceId:order.orderId,
            reasonCode:order.reason,performedBy:{userId:context.actorId,userName:context.actorId,role:context.roles[0]||'AUTHENTICATED_USER'},
            authorizedBy:{userId:order.reviewedBy||'',userName:order.reviewedBy||'',role:'DISPOSITION_APPROVER'},witnessedBy:{userId:payload.witnessUserId,userName:payload.witnessUserId},
            occurredAt:payload.executedAt,recordedAt:now,idempotencyKey,source:'SYSTEM',
          };
          const journalEntryId=`je_disp_${order.orderId}`;
          const nextOrder:InventoryDispositionOrder={...order,status:'EXECUTED',executedBy:context.actorId,executedAt:payload.executedAt,witnessedBy:payload.witnessUserId,destructionCertificateNumber:payload.destructionCertificateNumber,carrierReference:payload.carrierReference,stockTransactionId,journalEntryId};
          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[
            {entityType:'INVENTORY_BALANCE',entityId:balance.balanceId,domainState:nextBalance},
            {entityType:'BATCH_LOT',entityId:batch.batchId,domainState:nextBatch},
            {entityType:'STOCK_TRANSACTION',entityId:stockTransactionId,domainState:txn},
            {entityType:'JOURNAL_ENTRY',entityId:journalEntryId,domainState:dispositionJournal({order:nextOrder,journalId:journalEntryId,postedBy:context.actorId,postingMs:executionMs})},
          ];
          if(order.recallId){
            const recall=current.recall as unknown as GovernedRecallCase;
            writes.push({entityType:'SCM_RECALL',entityId:recall.recallId,domainState:{...recall,dispositionOrderIds:unique([...recall.dispositionOrderIds,order.orderId]),updatedAt:now}});
          }
          return {domainState:nextOrder,additionalStateWrites:writes,eventPayload:{orderId:order.orderId,dispositionType:order.dispositionType,quantity:order.quantity,stockTransactionId,journalEntryId,witnessUserId:payload.witnessUserId},auditReason:`Executed inventory disposition ${order.orderNumber} with independent witness ${payload.witnessUserId}.`,resultData:nextOrder};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.orderId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }

  public static async resolveRecall(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ResolveRecallPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['QUALITY_MANAGER','PATIENT_SAFETY_OFFICER','SCM_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized) return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Recall resolution authority required.');
    try{
      const ids=unique(payload.dispositionOrderIds);
      if(new Set(ids).size!==ids.length||ids.length>200) throw new AtomicMutationRejectedError('INVALID_RECALL_DISPOSITION_SET','Recall resolution disposition set is invalid.');
      const preflight=await DomainStateRepository.getById<GovernedRecallCase>(context.tenantId,'scmRecalls',payload.recallId);
      if(!preflight) throw new AtomicMutationRejectedError('RECALL_NOT_FOUND','Recall case does not exist.');
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'SCM_RECALL',aggregateId:payload.recallId,eventType:'SCM_RECALL_RESOLVED',
        auditAction:'SCM_RECALL_RESOLVED',auditResourceType:'SCM_RECALL',auditResourceId:payload.recallId,outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'recall',entityType:'SCM_RECALL',entityId:payload.recallId,required:true},
          ...ids.map((id,index)=>({key:`disposition:${index}`,entityType:'INVENTORY_DISPOSITION',entityId:id,required:true})),
        ],
        prepare:(current)=>{
          const recall=current.recall as unknown as GovernedRecallCase;
          if(!['QUARANTINE_EXECUTED','PATIENTS_IDENTIFIED'].includes(recall.status)) throw new AtomicMutationRejectedError('RECALL_NOT_RESOLVABLE',`Recall status ${recall.status} cannot be resolved.`);
          if(recall.exposureCount!==recall.notifiedExposureCount) throw new AtomicMutationRejectedError('RECALL_PATIENT_NOTIFICATIONS_INCOMPLETE','Every identified patient exposure must be notified before recall resolution.');
          const authoritativeIds=unique(recall.dispositionOrderIds).sort();
          const supplied=ids.sort();
          if(authoritativeIds.length!==supplied.length||authoritativeIds.some((id,index)=>id!==supplied[index])) throw new AtomicMutationRejectedError('RECALL_DISPOSITION_SET_MISMATCH','Resolution must include every disposition order linked to the recall.');
          ids.forEach((_,index)=>{
            const order=current[`disposition:${index}`] as unknown as InventoryDispositionOrder;
            if(order.recallId!==recall.recallId||order.status!=='EXECUTED') throw new AtomicMutationRejectedError('RECALL_DISPOSITION_INCOMPLETE','Every linked recall disposition must be executed before resolution.');
          });
          const now=new Date().toISOString();
          const next:GovernedRecallCase={...recall,status:'RESOLVED_DISPOSED',resolvedBy:context.actorId,resolvedAt:now,resolutionNotes:payload.resolutionNotes,updatedAt:now};
          return {domainState:next,eventPayload:{recallId:recall.recallId,dispositionOrderIds:ids,exposureCount:recall.exposureCount},auditReason:`Resolved recall ${recall.recallCaseNumber} after quarantine, patient notification, and disposition evidence completed.`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.recallId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError) return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
