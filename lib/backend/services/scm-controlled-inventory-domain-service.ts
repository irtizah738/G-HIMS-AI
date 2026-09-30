import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  BatchLotRecord,
  InventoryBalance,
  ItemMaster,
  StockTransaction,
} from '@/types/scm-domain';
import type {
  ColdChainExcursionRecord,
  ColdChainObservationRecord,
  ControlledCustodyRecord,
  RecordColdChainObservationPayload,
  RecordControlledCustodyPayload,
  ReviewColdChainExcursionPayload,
} from '@/types/scm-controlled';
import {
  controlledCustodyEvidenceMatches,
  requiresStockEvidence,
  temperatureWithinRange,
} from '@/lib/supply-chain/cold-chain';

function rejection(
  commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown
): CommandResult {
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}

function assertFacilityScope(context:CommandContext, facilityId:string):void {
  const admin=context.roles.some((role)=>['SYSTEM_ADMIN','ADMINISTRATOR'].includes(role));
  if(!admin && context.facilityIds?.length && !context.facilityIds.includes(facilityId)){
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'SCM controlled-inventory mutation is outside the actor facility scope.'
    );
  }
}

export class ScmControlledInventoryDomainService {
  public static async recordColdChainObservation(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:RecordColdChainObservationPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:[
        'PHARMACIST','INVENTORY_OFFICER','STORE_KEEPER','SCM_MANAGER',
        'QUALITY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'
      ],
    });
    if(!auth.authorized){
      return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
        auth.reason||'Cold-chain observation authority required.');
    }

    try{
      assertFacilityScope(context,payload.facilityId);
      const observedMs=Date.parse(payload.observedAt);
      const calibrationMs=Date.parse(payload.calibrationValidUntil);
      if(!Number.isFinite(observedMs)||!Number.isFinite(calibrationMs)){
        throw new AtomicMutationRejectedError(
          'INVALID_COLD_CHAIN_TIMESTAMP',
          'Observation and calibration validity timestamps must be valid ISO dates.'
        );
      }
      if(calibrationMs < observedMs){
        throw new AtomicMutationRejectedError(
          'COLD_CHAIN_SENSOR_CALIBRATION_EXPIRED',
          'Cold-chain observation cannot be accepted from an expired sensor calibration.'
        );
      }

      const excursionId=`exc_${payload.observationId}`;
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,
        actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'COLD_CHAIN_OBSERVATION',
        aggregateId:payload.observationId,
        eventType:'COLD_CHAIN_OBSERVATION_RECORDED',
        auditAction:'COLD_CHAIN_OBSERVATION_RECORDED',
        auditResourceType:'COLD_CHAIN_OBSERVATION',
        auditResourceId:payload.observationId,
        outboxTopic:'g-hims-scm-safety-events',
        idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'item',entityType:'ITEM_MASTER',entityId:payload.itemId,required:true},
          {key:'batch',entityType:'BATCH_LOT',entityId:payload.batchId,required:true},
          {key:'balance',entityType:'INVENTORY_BALANCE',entityId:payload.balanceId,required:true},
          {key:'excursion',entityType:'COLD_CHAIN_EXCURSION',entityId:excursionId,required:false},
        ],
        prepare:(current)=>{
          const item=current.item as unknown as ItemMaster;
          const batch=current.batch as unknown as BatchLotRecord;
          const balance=current.balance as unknown as InventoryBalance;
          if(!item.requiresTemperatureTracking || !item.temperatureRange){
            throw new AtomicMutationRejectedError(
              'ITEM_NOT_COLD_CHAIN_CONTROLLED',
              'Item master does not require governed temperature tracking.'
            );
          }
          if(
            batch.itemId!==item.itemId ||
            balance.itemId!==item.itemId ||
            balance.batchId!==batch.batchId ||
            balance.facilityId!==payload.facilityId ||
            balance.locationId!==payload.locationId
          ){
            throw new AtomicMutationRejectedError(
              'COLD_CHAIN_SCOPE_MISMATCH',
              'Observation batch/balance/facility/location identity is inconsistent.'
            );
          }

          const withinRange=temperatureWithinRange({
            temperatureCelsius:payload.temperatureCelsius,
            minCelsius:item.temperatureRange.minCelsius,
            maxCelsius:item.temperatureRange.maxCelsius,
          });
          const now=new Date().toISOString();
          const observation:ColdChainObservationRecord={
            ...payload,
            tenantId:context.tenantId,
            minAllowedCelsius:item.temperatureRange.minCelsius,
            maxAllowedCelsius:item.temperatureRange.maxCelsius,
            withinRange,
            recordedBy:context.actorId,
            recordedAt:now,
            ...(withinRange?{}:{excursionId}),
          };

          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          if(!withinRange){
            if(current.excursion){
              throw new AtomicMutationRejectedError(
                'COLD_CHAIN_EXCURSION_ALREADY_EXISTS',
                'An excursion already exists for this observation.'
              );
            }
            const affectedQuantity=Math.max(0,Number(balance.available||0));
            const nextBalance:InventoryBalance={
              ...balance,
              quarantined:Number(balance.quarantined||0)+affectedQuantity,
              available:0,
              lastMovementAt:now,
              version:Number(balance.version||0)+1,
            };
            const nextBatch:BatchLotRecord={
              ...batch,
              status:'QUARANTINED',
              temperatureExcursionDetected:true,
              excursionDetails:{
                recordedTemp:payload.temperatureCelsius,
                durationHours:0,
                flaggedAt:payload.observedAt,
              },
              quarantineReason:`Cold-chain excursion ${excursionId}`,
              updatedAt:now,
            };
            const excursion:ColdChainExcursionRecord={
              excursionId,
              tenantId:context.tenantId,
              observationId:payload.observationId,
              facilityId:payload.facilityId,
              locationId:payload.locationId,
              itemId:payload.itemId,
              batchId:payload.batchId,
              balanceId:payload.balanceId,
              temperatureCelsius:payload.temperatureCelsius,
              minAllowedCelsius:item.temperatureRange.minCelsius,
              maxAllowedCelsius:item.temperatureRange.maxCelsius,
              affectedQuantity,
              detectedAt:payload.observedAt,
              detectedBy:context.actorId,
              status:'QUARANTINED_PENDING_REVIEW',
            };
            writes.push(
              {entityType:'COLD_CHAIN_EXCURSION',entityId:excursionId,domainState:excursion},
              {entityType:'INVENTORY_BALANCE',entityId:balance.balanceId,domainState:nextBalance},
              {entityType:'BATCH_LOT',entityId:batch.batchId,domainState:nextBatch},
            );
          }

          return {
            domainState:observation,
            additionalStateWrites:writes,
            eventPayload:{
              observationId:payload.observationId,
              itemId:payload.itemId,
              batchId:payload.batchId,
              withinRange,
              excursionId:withinRange?undefined:excursionId,
            },
            auditReason:withinRange
              ? `Recorded in-range cold-chain observation for ${item.itemCode}.`
              : `Cold-chain excursion detected; batch ${batch.batchNumber} quarantined automatically.`,
            resultData:{observation,excursionId:withinRange?undefined:excursionId},
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.observationId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async reviewColdChainExcursion(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:ReviewColdChainExcursionPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['QUALITY_MANAGER','PHARMACIST','SCM_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized){
      return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
        auth.reason||'Cold-chain excursion review authority required.');
    }

    try{
      const preflight=await import('@/server/repositories/domain-state-repository')
        .then(({DomainStateRepository})=>
          DomainStateRepository.getById<ColdChainExcursionRecord>(
            context.tenantId,'scmColdChainExcursions',payload.excursionId
          )
        );
      if(!preflight){
        throw new AtomicMutationRejectedError('COLD_CHAIN_EXCURSION_NOT_FOUND','Excursion does not exist.');
      }
      assertFacilityScope(context,preflight.facilityId);

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'COLD_CHAIN_EXCURSION',aggregateId:payload.excursionId,
        eventType:payload.decision==='RELEASE'?'COLD_CHAIN_STOCK_RELEASED':'COLD_CHAIN_DISPOSITION_REQUIRED',
        auditAction:payload.decision==='RELEASE'?'COLD_CHAIN_STOCK_RELEASED':'COLD_CHAIN_DISPOSITION_REQUIRED',
        auditResourceType:'COLD_CHAIN_EXCURSION',auditResourceId:payload.excursionId,
        outboxTopic:'g-hims-scm-safety-events',idempotencyKey,commandId,
        correlationId:context.correlationId,
        readTargets:[
          {key:'excursion',entityType:'COLD_CHAIN_EXCURSION',entityId:payload.excursionId,required:true},
          {key:'batch',entityType:'BATCH_LOT',entityId:preflight.batchId,required:true},
          {key:'balance',entityType:'INVENTORY_BALANCE',entityId:preflight.balanceId,required:true},
        ],
        prepare:(current)=>{
          const excursion=current.excursion as unknown as ColdChainExcursionRecord;
          const batch=current.batch as unknown as BatchLotRecord;
          const balance=current.balance as unknown as InventoryBalance;
          if(excursion.status!=='QUARANTINED_PENDING_REVIEW'){
            throw new AtomicMutationRejectedError('COLD_CHAIN_EXCURSION_NOT_REVIEWABLE','Excursion is not pending review.');
          }
          if(excursion.detectedBy===context.actorId){
            throw new AtomicMutationRejectedError('SCM_SEGREGATION_OF_DUTIES','Excursion detector cannot approve its own release.');
          }
          const now=new Date().toISOString();
          const nextExcursion:ColdChainExcursionRecord={
            ...excursion,
            status:payload.decision==='RELEASE'?'RELEASED':'DISPOSITION_REQUIRED',
            reviewedAt:now,reviewedBy:context.actorId,
            reviewDecision:payload.decision,reviewNotes:payload.notes,
          };
          const writes:Array<{entityType:string;entityId:string;domainState:unknown}>=[];
          if(payload.decision==='RELEASE'){
            const released=Math.min(
              Number(balance.quarantined||0),
              Number(excursion.affectedQuantity||0)
            );
            const nextQuarantined=Math.max(0,Number(balance.quarantined||0)-released);
            const nextBalance:InventoryBalance={
              ...balance,
              quarantined:nextQuarantined,
              available:Math.max(
                0,
                Number(balance.onHand||0)-Number(balance.reserved||0)-
                nextQuarantined-Number(balance.damaged||0)-Number(balance.expired||0)
              ),
              lastMovementAt:now,
              version:Number(balance.version||0)+1,
            };
            const nextBatch:BatchLotRecord={
              ...batch,status:'AVAILABLE',
              quarantineReason:undefined,
              updatedAt:now,
            };
            writes.push(
              {entityType:'INVENTORY_BALANCE',entityId:balance.balanceId,domainState:nextBalance},
              {entityType:'BATCH_LOT',entityId:batch.batchId,domainState:nextBatch},
            );
          }
          return {
            domainState:nextExcursion,
            additionalStateWrites:writes,
            eventPayload:{excursionId:excursion.excursionId,decision:payload.decision,batchId:excursion.batchId},
            auditReason:`Reviewed cold-chain excursion ${excursion.excursionId}: ${payload.decision}.`,
            resultData:nextExcursion,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.excursionId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }

  public static async recordControlledCustody(
    context:CommandContext,
    commandId:string,
    idempotencyKey:string,
    payload:RecordControlledCustodyPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:[
        'PHARMACIST','NURSE','DOCTOR','INVENTORY_OFFICER',
        'SCM_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'
      ],
    });
    if(!auth.authorized){
      return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',
        auth.reason||'Controlled inventory custody authority required.');
    }

    try{
      assertFacilityScope(context,payload.facilityId);
      if(!Number.isFinite(payload.quantity)||payload.quantity<=0){
        throw new AtomicMutationRejectedError('INVALID_CONTROLLED_CUSTODY_QUANTITY','Custody quantity must be positive.');
      }
      if(
        payload.witnessUserId===context.actorId ||
        payload.witnessUserId===payload.fromCustodianId ||
        payload.witnessUserId===payload.toCustodianId
      ){
        throw new AtomicMutationRejectedError(
          'CONTROLLED_CUSTODY_WITNESS_NOT_INDEPENDENT',
          'Controlled inventory custody requires an independent witness.'
        );
      }
      if(
        payload.action==='HANDOFF' &&
        (!payload.fromCustodianId || !payload.toCustodianId ||
          payload.fromCustodianId===payload.toCustodianId)
      ){
        throw new AtomicMutationRejectedError(
          'INVALID_CONTROLLED_CUSTODY_HANDOFF',
          'Custody handoff requires distinct source and destination custodians.'
        );
      }

      const readTargets=[
        {key:'item',entityType:'ITEM_MASTER',entityId:payload.itemId,required:true},
        {key:'batch',entityType:'BATCH_LOT',entityId:payload.batchId,required:true},
        {key:'balance',entityType:'INVENTORY_BALANCE',entityId:payload.balanceId,required:true},
        ...(requiresStockEvidence(payload.action)
          ? [{key:'stockTxn',entityType:'STOCK_TRANSACTION',entityId:String(payload.stockTransactionId||''),required:true}]
          : []),
      ];

      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,
        actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CONTROLLED_CUSTODY',aggregateId:payload.custodyId,
        eventType:'CONTROLLED_INVENTORY_CUSTODY_RECORDED',
        auditAction:'CONTROLLED_INVENTORY_CUSTODY_RECORDED',
        auditResourceType:'CONTROLLED_CUSTODY',auditResourceId:payload.custodyId,
        outboxTopic:'g-hims-scm-controlled-events',idempotencyKey,commandId,
        correlationId:context.correlationId,readTargets,
        prepare:(current)=>{
          const item=current.item as unknown as ItemMaster;
          const batch=current.batch as unknown as BatchLotRecord;
          const balance=current.balance as unknown as InventoryBalance;
          const stockTxn=(current.stockTxn||null) as unknown as StockTransaction|null;
          if(!item.controlledItem){
            throw new AtomicMutationRejectedError(
              'ITEM_NOT_CONTROLLED',
              'Custody chain can only be recorded for item masters marked controlled.'
            );
          }
          if(
            batch.itemId!==item.itemId || balance.itemId!==item.itemId ||
            balance.batchId!==batch.batchId || balance.facilityId!==payload.facilityId ||
            balance.locationId!==payload.locationId
          ){
            throw new AtomicMutationRejectedError(
              'CONTROLLED_CUSTODY_SCOPE_MISMATCH',
              'Custody item/batch/balance/facility/location identity is inconsistent.'
            );
          }
          if(!controlledCustodyEvidenceMatches({
            action:payload.action,quantity:payload.quantity,itemId:payload.itemId,
            batchId:payload.batchId,transaction:stockTxn
          })){
            throw new AtomicMutationRejectedError(
              'CONTROLLED_CUSTODY_STOCK_EVIDENCE_INVALID',
              'Custody event does not match an authoritative stock transaction.'
            );
          }
          const record:ControlledCustodyRecord={
            ...payload,tenantId:context.tenantId,itemCode:item.itemCode,itemName:item.name,
            batchNumber:batch.batchNumber,recordedBy:context.actorId,recordedAt:new Date().toISOString(),
          };
          return {
            domainState:record,
            eventPayload:{custodyId:record.custodyId,itemId:record.itemId,batchId:record.batchId,
              action:record.action,quantity:record.quantity,witnessUserId:record.witnessUserId},
            auditReason:`Recorded controlled inventory custody ${record.action} for ${item.itemCode}.`,
            resultData:record,
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.custodyId,
        eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError){
        return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      }
      throw error;
    }
  }
}
