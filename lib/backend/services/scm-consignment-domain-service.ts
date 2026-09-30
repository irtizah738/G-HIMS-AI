import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type { ItemMaster, SupplierMaster } from '@/types/scm-domain';
import type {
  ApproveConsignmentAgreementPayload,
  ConsignmentAgreement,
  ConsignmentLotRecord,
  ConsignmentUsageRecord,
  CreateConsignmentAgreementPayload,
  ReceiveConsignmentStockPayload,
  RecordConsignmentUsagePayload,
} from '@/types/scm-consignment';
import {
  consignmentUsageCostMinorUnits,
  validateHighValueIdentity,
} from '@/lib/supply-chain/consignment';

function rejection(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}
function assertFacilityScope(context:CommandContext,facilityId:string):void{
  const admin=context.roles.some(r=>['SYSTEM_ADMIN','ADMINISTRATOR'].includes(r));
  if(!admin&&context.facilityIds?.length&&!context.facilityIds.includes(facilityId)){
    throw new AtomicMutationRejectedError('FACILITY_SCOPE_MISMATCH','Consignment mutation is outside actor facility scope.');
  }
}
function buildAccrualJournal(params:{
  journalId:string;tenantId:string;usage:ConsignmentUsageRecord;postedBy:string;
}){
  const usedMs=Date.parse(params.usage.usedAt);
  const date=new Date(usedMs);
  const amount=params.usage.totalCostMinorUnits;
  if(!Number.isFinite(usedMs)||!Number.isSafeInteger(amount)||amount<=0){
    throw new AtomicMutationRejectedError('INVALID_CONSIGNMENT_ACCRUAL','Consignment accrual requires valid date and positive cost.');
  }
  return {
    journalId:params.journalId,tenantId:params.tenantId,
    fiscalYear:date.getUTCFullYear(),postingPeriod:date.getUTCMonth()+1,
    documentDate:usedMs,postingDate:usedMs,
    referenceDocumentId:params.usage.usageId,
    documentHeader:`Consignment usage accrual ${params.usage.usageId}`,
    currency:params.usage.currency,totalAmountMinorUnits:amount,
    lines:[
      {glAccountId:'6020',glAccountName:'Medical Consumables & Surgical Implants Used',
        debitMinorUnits:amount,creditMinorUnits:0,lineDescription:'Recognize consignment item usage expense'},
      {glAccountId:'2030',glAccountName:'Goods Received Not Invoiced (GRNI)',
        debitMinorUnits:0,creditMinorUnits:amount,lineDescription:'Accrue vendor-owned consignment usage pending supplier invoice'},
    ],
    status:'POSTED',postedBy:params.postedBy,postedAt:Date.now(),
  };
}

export class ScmConsignmentDomainService {
  public static async createAgreement(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:CreateConsignmentAgreementPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['SCM_MANAGER','PROCUREMENT_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Consignment agreement authority required.');
    try{
      assertFacilityScope(context,payload.facilityId);
      const effective=Date.parse(payload.effectiveAt),expires=Date.parse(payload.expiresAt);
      if(!Number.isFinite(effective)||!Number.isFinite(expires)||expires<=effective){
        throw new AtomicMutationRejectedError('INVALID_CONSIGNMENT_AGREEMENT_DATES','Agreement dates are invalid.');
      }
      if(!payload.lines.length||payload.lines.length>500){
        throw new AtomicMutationRejectedError('INVALID_CONSIGNMENT_AGREEMENT_LINES','Agreement requires 1-500 lines.');
      }
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CONSIGNMENT_AGREEMENT',aggregateId:payload.agreementId,
        eventType:'CONSIGNMENT_AGREEMENT_CREATED_PENDING_APPROVAL',
        auditAction:'CONSIGNMENT_AGREEMENT_CREATED_PENDING_APPROVAL',
        auditResourceType:'CONSIGNMENT_AGREEMENT',auditResourceId:payload.agreementId,
        outboxTopic:'g-hims-scm-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'supplier',entityType:'SUPPLIER_MASTER',entityId:payload.supplierId,required:true},
          ...payload.lines.map((line,index)=>({key:`item:${index}`,entityType:'ITEM_MASTER',entityId:line.itemId,required:true})),
        ],
        prepare:(current)=>{
          const supplier=current.supplier as unknown as SupplierMaster;
          if(supplier.status!=='ACTIVE')throw new AtomicMutationRejectedError('SUPPLIER_NOT_ACTIVE','Consignment supplier must be active.');
          payload.lines.forEach((line,index)=>{
            const item=current[`item:${index}`] as unknown as ItemMaster;
            if(!item||item.isActive===false)throw new AtomicMutationRejectedError('SCM_ITEM_NOT_ACTIVE','Agreement contains inactive item.');
            if(line.uom!==item.stockUOM)throw new AtomicMutationRejectedError('CONSIGNMENT_UOM_MISMATCH','Agreement UOM must match stock UOM.');
            if(!Number.isSafeInteger(line.maxUnitCostMinorUnits)||line.maxUnitCostMinorUnits<0){
              throw new AtomicMutationRejectedError('INVALID_CONSIGNMENT_UNIT_COST','Agreement cost ceiling must be non-negative minor units.');
            }
            if((item.itemType==='IMPLANT'||item.itemType==='PROSTHESIS')&&(!line.requiresSerial||!line.requiresUdi)){
              throw new AtomicMutationRejectedError('HIGH_VALUE_TRACEABILITY_REQUIRED','Implants/prostheses require serial and UDI traceability.');
            }
          });
          const now=new Date().toISOString();
          const agreement:ConsignmentAgreement={...payload,tenantId:context.tenantId,status:'PENDING_APPROVAL',createdBy:context.actorId,createdAt:now};
          return {domainState:agreement,eventPayload:{agreementId:agreement.agreementId,supplierId:agreement.supplierId},
            auditReason:`Created consignment agreement ${agreement.agreementNumber} pending approval.`,resultData:agreement};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.agreementId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){if(error instanceof AtomicMutationRejectedError)return rejection(commandId,idempotencyKey,error.code,error.message,error.details);throw error;}
  }

  public static async approveAgreement(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ApproveConsignmentAgreementPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['SCM_MANAGER','FINANCE_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Consignment approval authority required.');
    try{
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CONSIGNMENT_AGREEMENT',aggregateId:payload.agreementId,
        eventType:payload.decision==='APPROVE'?'CONSIGNMENT_AGREEMENT_ACTIVATED':'CONSIGNMENT_AGREEMENT_REJECTED',
        auditAction:payload.decision==='APPROVE'?'CONSIGNMENT_AGREEMENT_ACTIVATED':'CONSIGNMENT_AGREEMENT_REJECTED',
        auditResourceType:'CONSIGNMENT_AGREEMENT',auditResourceId:payload.agreementId,
        outboxTopic:'g-hims-scm-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[{key:'agreement',entityType:'CONSIGNMENT_AGREEMENT',entityId:payload.agreementId,required:true}],
        prepare:(current)=>{
          const agreement=current.agreement as unknown as ConsignmentAgreement;
          assertFacilityScope(context,agreement.facilityId);
          if(agreement.status!=='PENDING_APPROVAL')throw new AtomicMutationRejectedError('CONSIGNMENT_AGREEMENT_NOT_REVIEWABLE','Agreement is not pending approval.');
          if(agreement.createdBy===context.actorId)throw new AtomicMutationRejectedError('SCM_SEGREGATION_OF_DUTIES','Agreement creator cannot approve their own agreement.');
          const now=new Date().toISOString();
          const next:ConsignmentAgreement={...agreement,status:payload.decision==='APPROVE'?'ACTIVE':'CLOSED',approvedBy:context.actorId,approvedAt:now,reviewNotes:payload.notes};
          return {domainState:next,eventPayload:{agreementId:next.agreementId,decision:payload.decision},
            auditReason:`${payload.decision} consignment agreement ${next.agreementNumber}.`,resultData:next};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.agreementId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){if(error instanceof AtomicMutationRejectedError)return rejection(commandId,idempotencyKey,error.code,error.message,error.details);throw error;}
  }

  public static async receiveStock(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:ReceiveConsignmentStockPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['STORE_KEEPER','INVENTORY_OFFICER','SCM_MANAGER','PHARMACIST','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Consignment receiving authority required.');
    try{
      assertFacilityScope(context,payload.facilityId);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CONSIGNMENT_LOT',aggregateId:payload.lotId,
        eventType:'CONSIGNMENT_STOCK_RECEIVED_OFF_BALANCE_SHEET',
        auditAction:'CONSIGNMENT_STOCK_RECEIVED_OFF_BALANCE_SHEET',
        auditResourceType:'CONSIGNMENT_LOT',auditResourceId:payload.lotId,
        outboxTopic:'g-hims-scm-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'agreement',entityType:'CONSIGNMENT_AGREEMENT',entityId:payload.agreementId,required:true},
          {key:'item',entityType:'ITEM_MASTER',entityId:payload.itemId,required:true},
        ],
        prepare:(current)=>{
          const agreement=current.agreement as unknown as ConsignmentAgreement;
          const item=current.item as unknown as ItemMaster;
          const nowMs=Date.parse(payload.receivedAt);
          if(agreement.status!=='ACTIVE')throw new AtomicMutationRejectedError('CONSIGNMENT_AGREEMENT_NOT_ACTIVE','Consignment stock requires active agreement.');
          if(agreement.supplierId!==payload.supplierId||agreement.facilityId!==payload.facilityId){
            throw new AtomicMutationRejectedError('CONSIGNMENT_AGREEMENT_SCOPE_MISMATCH','Supplier/facility does not match agreement.');
          }
          if(nowMs<Date.parse(agreement.effectiveAt)||nowMs>Date.parse(agreement.expiresAt)){
            throw new AtomicMutationRejectedError('CONSIGNMENT_AGREEMENT_OUT_OF_TERM','Receipt falls outside agreement term.');
          }
          const line=agreement.lines.find(x=>x.itemId===payload.itemId);
          if(!line)throw new AtomicMutationRejectedError('CONSIGNMENT_ITEM_NOT_CONTRACTED','Item is not on agreement.');
          if(payload.uom!==line.uom||payload.currency.toUpperCase()!==agreement.currency.toUpperCase()){
            throw new AtomicMutationRejectedError('CONSIGNMENT_COMMERCIAL_MISMATCH','Receipt UOM/currency does not match agreement.');
          }
          if(payload.unitCostMinorUnits>line.maxUnitCostMinorUnits){
            throw new AtomicMutationRejectedError('CONSIGNMENT_COST_CEILING_EXCEEDED','Receipt cost exceeds agreement ceiling.');
          }
          try{validateHighValueIdentity({quantity:payload.quantity,requiresSerial:line.requiresSerial,requiresUdi:line.requiresUdi,serialNumbers:payload.serialNumbers,udis:payload.udis});}
          catch(error){throw new AtomicMutationRejectedError(String((error as Error).message),'High-value identity validation failed.');}
          const now=new Date().toISOString();
          const lot:ConsignmentLotRecord={...payload,tenantId:context.tenantId,quantityAvailable:payload.quantity,quantityConsumed:0,status:'AVAILABLE',receivedBy:context.actorId,createdAt:now};
          return {domainState:lot,eventPayload:{lotId:lot.lotId,itemId:lot.itemId,quantity:lot.quantity,supplierId:lot.supplierId},
            auditReason:`Received vendor-owned consignment lot ${lot.lotId}; no inventory asset was recognized.`,resultData:lot};
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.lotId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){if(error instanceof AtomicMutationRejectedError)return rejection(commandId,idempotencyKey,error.code,error.message,error.details);throw error;}
  }

  public static async recordUsage(
    context:CommandContext,commandId:string,idempotencyKey:string,payload:RecordConsignmentUsagePayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{requiredRoles:['SURGEON','DOCTOR','NURSE','PHARMACIST','INVENTORY_OFFICER','SCM_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR']});
    if(!auth.authorized)return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'Consignment usage authority required.');
    try{
      assertFacilityScope(context,payload.facilityId);
      const tx=await TransactionManager.executeAtomicReadModifyMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'CONSIGNMENT_USAGE',aggregateId:payload.usageId,
        eventType:'CONSIGNMENT_USAGE_ACCRUED',
        auditAction:'CONSIGNMENT_USAGE_ACCRUED',
        auditResourceType:'CONSIGNMENT_USAGE',auditResourceId:payload.usageId,
        outboxTopic:'g-hims-scm-finance-events',idempotencyKey,commandId,correlationId:context.correlationId,
        readTargets:[
          {key:'lot',entityType:'CONSIGNMENT_LOT',entityId:payload.lotId,required:true},
          {key:'agreement',entityType:'CONSIGNMENT_AGREEMENT',entityId:payload.agreementId,required:true},
          {key:'item',entityType:'ITEM_MASTER',entityId:payload.itemId,required:true},
          ...(payload.patientId?[{key:'patient',entityType:'PATIENT_MPI',entityId:payload.patientId,required:true}]:[]),
          ...(payload.encounterId?[{key:'encounter',entityType:'ENCOUNTER',entityId:payload.encounterId,required:true}]:[]),
        ],
        prepare:(current)=>{
          const lot=current.lot as unknown as ConsignmentLotRecord;
          const agreement=current.agreement as unknown as ConsignmentAgreement;
          const item=current.item as unknown as ItemMaster;
          if(lot.status!=='AVAILABLE'||lot.quantityAvailable<payload.quantity){
            throw new AtomicMutationRejectedError('CONSIGNMENT_STOCK_INSUFFICIENT','Consignment lot does not have enough available quantity.');
          }
          if(lot.agreementId!==agreement.agreementId||lot.itemId!==payload.itemId||lot.facilityId!==payload.facilityId){
            throw new AtomicMutationRejectedError('CONSIGNMENT_USAGE_SCOPE_MISMATCH','Usage does not match lot/agreement/facility.');
          }
          const line=agreement.lines.find(x=>x.itemId===payload.itemId);
          if(!line)throw new AtomicMutationRejectedError('CONSIGNMENT_ITEM_NOT_CONTRACTED','Item is no longer on agreement.');
          if((item.itemType==='IMPLANT'||item.itemType==='PROSTHESIS')&&(!payload.patientId||!payload.encounterId||!payload.procedureId)){
            throw new AtomicMutationRejectedError('HIGH_VALUE_PATIENT_TRACEABILITY_REQUIRED','Implant/prosthesis usage requires patient, encounter and procedure identity.');
          }
          try{validateHighValueIdentity({quantity:payload.quantity,requiresSerial:line.requiresSerial,requiresUdi:line.requiresUdi,serialNumbers:payload.serialNumbers,udis:payload.udis});}
          catch(error){throw new AtomicMutationRejectedError(String((error as Error).message),'High-value usage identity validation failed.');}
          if(payload.encounterId&&String((current.encounter as any)?.patientId||'')!==payload.patientId){
            throw new AtomicMutationRejectedError('CONSIGNMENT_ENCOUNTER_PATIENT_MISMATCH','Encounter does not belong to supplied patient.');
          }
          const totalCostMinorUnits=consignmentUsageCostMinorUnits(payload.quantity,lot.unitCostMinorUnits);
          const journalId=`je_consignment_${payload.usageId}`;
          const now=new Date().toISOString();
          const usage:ConsignmentUsageRecord={...payload,tenantId:context.tenantId,supplierId:lot.supplierId,currency:lot.currency.toUpperCase(),unitCostMinorUnits:lot.unitCostMinorUnits,totalCostMinorUnits,recordedBy:context.actorId,recordedAt:now,accrualJournalId:journalId,status:'ACCRUED_AWAITING_SUPPLIER_INVOICE'};
          const nextLot:ConsignmentLotRecord={...lot,quantityAvailable:lot.quantityAvailable-payload.quantity,quantityConsumed:lot.quantityConsumed+payload.quantity,status:lot.quantityAvailable-payload.quantity<=0?'DEPLETED':'AVAILABLE'};
          return {
            domainState:usage,
            additionalStateWrites:[
              {entityType:'CONSIGNMENT_LOT',entityId:lot.lotId,domainState:nextLot},
              {entityType:'JOURNAL_ENTRY',entityId:journalId,domainState:buildAccrualJournal({journalId,tenantId:context.tenantId,usage,postedBy:context.actorId})},
            ],
            eventPayload:{usageId:usage.usageId,lotId:usage.lotId,itemId:usage.itemId,quantity:usage.quantity,totalCostMinorUnits,journalId},
            auditReason:`Consumed vendor-owned consignment stock and accrued GRNI liability for ${item.itemCode}.`,
            resultData:{usage,lot:nextLot,journalId},
          };
        },
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.usageId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:tx.resultData};
    }catch(error){if(error instanceof AtomicMutationRejectedError)return rejection(commandId,idempotencyKey,error.code,error.message,error.details);throw error;}
  }
}
