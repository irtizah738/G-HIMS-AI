import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { AtomicMutationRejectedError, TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  BatchLotRecord,
  GoodsReceiptNote,
  InventoryBalance,
  PurchaseOrderRecord,
  StockTransaction,
  ThreeWayMatchResult,
} from '@/types/scm-domain';
import type {
  GenerateScmIntelligenceSnapshotPayload,
  ScmOperationalSnapshot,
} from '@/types/scm-intelligence';
import {
  buildOperationalAlerts,
  buildScmInputFingerprint,
  calculateOperationalMetrics,
} from '@/lib/supply-chain/scm-intelligence';

function rejection(commandId:string,idempotencyKey:string,code:string,message:string,details?:unknown):CommandResult{
  return {success:false,commandId,idempotencyKey,error:{code,message,details}};
}
function assertFacilityScope(context:CommandContext,facilityId:string){
  const admin=context.roles.some(r=>['SYSTEM_ADMIN','ADMINISTRATOR'].includes(r));
  if(!admin&&context.facilityIds?.length&&!context.facilityIds.includes(facilityId)){
    throw new AtomicMutationRejectedError('FACILITY_SCOPE_MISMATCH','SCM intelligence request is outside actor facility scope.');
  }
}

export class ScmIntelligenceDomainService {
  public static async generateSnapshot(
    context:CommandContext,commandId:string,idempotencyKey:string,
    payload:GenerateScmIntelligenceSnapshotPayload
  ):Promise<CommandResult>{
    const auth=AuthorizationPipeline.evaluate(context,{
      requiredRoles:['SCM_MANAGER','INVENTORY_OFFICER','FINANCE_MANAGER','QUALITY_MANAGER','SYSTEM_ADMIN','ADMINISTRATOR'],
    });
    if(!auth.authorized)return rejection(commandId,idempotencyKey,auth.code||'UNAUTHORIZED',auth.reason||'SCM intelligence authority required.');

    try{
      assertFacilityScope(context,payload.facilityId);
      if(!Number.isFinite(Date.parse(payload.asOf))||payload.lookbackDays<7||payload.lookbackDays>3650||payload.expiryHorizonDays<1||payload.expiryHorizonDays>730){
        throw new AtomicMutationRejectedError('INVALID_SCM_INTELLIGENCE_WINDOW','SCM intelligence time window is invalid.');
      }
      const currency=payload.currency.trim().toUpperCase();
      if(currency.length!==3)throw new AtomicMutationRejectedError('INVALID_SCM_INTELLIGENCE_CURRENCY','Currency must be a 3-letter code.');

      const [
        balances,transactions,purchaseOrders,goodsReceipts,allBatches,
        matches,recalls,excursions,consignmentLots,consignmentUsages,custody,
      ]=await Promise.all([
        DomainStateRepository.queryAllEqual<InventoryBalance>(context.tenantId,'inventoryBalances','facilityId',payload.facilityId,{pageSize:500,maxRows:200000}),
        DomainStateRepository.queryAllEqual<StockTransaction>(context.tenantId,'stockTransactions','facilityId',payload.facilityId,{pageSize:500,maxRows:500000}),
        DomainStateRepository.queryAllEqual<PurchaseOrderRecord>(context.tenantId,'scmPurchaseOrders','facilityId',payload.facilityId,{pageSize:500,maxRows:100000}),
        DomainStateRepository.queryAllEqual<GoodsReceiptNote>(context.tenantId,'goodsReceiptNotes','facilityId',payload.facilityId,{pageSize:500,maxRows:100000}),
        DomainStateRepository.list<BatchLotRecord>(context.tenantId,'batches',100000),
        DomainStateRepository.list<ThreeWayMatchResult>(context.tenantId,'threeWayMatches',100000),
        DomainStateRepository.queryAllEqual<Record<string,unknown>>(context.tenantId,'scmRecalls','facilityId',payload.facilityId,{pageSize:500,maxRows:50000}),
        DomainStateRepository.queryAllEqual<Record<string,unknown>>(context.tenantId,'scmColdChainExcursions','facilityId',payload.facilityId,{pageSize:500,maxRows:50000}),
        DomainStateRepository.queryAllEqual<Record<string,unknown>>(context.tenantId,'scmConsignmentLots','facilityId',payload.facilityId,{pageSize:500,maxRows:100000}),
        DomainStateRepository.queryAllEqual<Record<string,unknown>>(context.tenantId,'scmConsignmentUsages','facilityId',payload.facilityId,{pageSize:500,maxRows:100000}),
        DomainStateRepository.queryAllEqual<Record<string,unknown>>(context.tenantId,'scmControlledCustody','facilityId',payload.facilityId,{pageSize:500,maxRows:200000}),
      ]);

      const poIds=new Set(purchaseOrders.map(po=>po.poId));
      const scopedMatches=matches.filter(match=>poIds.has(match.poId));
      const batchIds=new Set(balances.map(balance=>balance.batchId).filter(Boolean));
      const batches=allBatches.filter(batch=>batchIds.has(batch.batchId));

      const currencies=new Set([
        ...balances.filter(b=>Number(b.onHand||0)>0).map(b=>String((b as any).currency||'').trim().toUpperCase()).filter(Boolean),
        ...transactions.map(t=>String(t.currency||'').trim().toUpperCase()).filter(Boolean),
        ...purchaseOrders.map(po=>String(po.currency||'').trim().toUpperCase()).filter(Boolean),
        ...consignmentLots.map(l=>String(l.currency||'').trim().toUpperCase()).filter(Boolean),
      ]);
      const incompatible=[...currencies].filter(value=>value!==currency);
      if(incompatible.length){
        throw new AtomicMutationRejectedError('SCM_INTELLIGENCE_CURRENCY_MISMATCH','Snapshot cannot aggregate monetary values across currencies.',{requested:currency,found:[...currencies]});
      }

      const inputs={
        balances,transactions,purchaseOrders,goodsReceipts,batches,matches:scopedMatches,
        recalls,excursions,consignmentLots,consignmentUsages,custody,
      };
      const metrics=calculateOperationalMetrics({
        asOf:payload.asOf,lookbackDays:payload.lookbackDays,expiryHorizonDays:payload.expiryHorizonDays,
        ...inputs,
      });
      const alerts=buildOperationalAlerts(metrics);
      const inputFingerprint=buildScmInputFingerprint({
        asOf:payload.asOf,lookbackDays:payload.lookbackDays,expiryHorizonDays:payload.expiryHorizonDays,
        balances:balances.map(b=>[b.balanceId,b.onHand,b.available,b.unitCost,b.lastMovementAt,b.version]),
        transactions:transactions.map(t=>[t.transactionId,t.transactionType,t.quantity,t.unitCost,t.occurredAt]),
        purchaseOrders:purchaseOrders.map(p=>[p.poId,p.status,p.expectedDeliveryDate,p.updatedAt]),
        goodsReceipts:goodsReceipts.map(g=>[g.grnId,g.purchaseOrderId,g.receivedAt,g.status]),
        matches:scopedMatches.map(m=>[m.matchId,m.netVariance,m.matchStatus]),
        recalls:recalls.map(r=>[r.recallId,r.status,r.updatedAt]),
        excursions:excursions.map(e=>[e.excursionId,e.status,e.reviewedAt]),
        consignmentLots:consignmentLots.map(l=>[l.lotId,l.quantityAvailable,l.unitCostMinorUnits,l.status]),
        consignmentUsages:consignmentUsages.map(u=>[u.usageId,u.totalCostMinorUnits,u.status]),
        custody:custody.map(c=>[c.custodyId,c.action,c.occurredAt]),
      });

      const snapshot:ScmOperationalSnapshot={
        snapshotId:payload.snapshotId,tenantId:context.tenantId,facilityId:payload.facilityId,
        asOf:payload.asOf,lookbackDays:payload.lookbackDays,expiryHorizonDays:payload.expiryHorizonDays,
        currency,generatedAt:new Date().toISOString(),generatedBy:context.actorId,inputFingerprint,metrics,alerts,
      };

      const tx=await TransactionManager.executeAtomicMutation({
        tenantId:context.tenantId,actorId:context.actorId,actorRole:context.roles[0]||'AUTHENTICATED_USER',
        aggregateType:'SCM_INTELLIGENCE_SNAPSHOT',aggregateId:payload.snapshotId,
        eventType:'SCM_OPERATIONAL_INTELLIGENCE_SNAPSHOT_GENERATED',
        eventPayload:{snapshotId:payload.snapshotId,facilityId:payload.facilityId,inputFingerprint,alertCount:alerts.length},
        auditAction:'SCM_OPERATIONAL_INTELLIGENCE_SNAPSHOT_GENERATED',
        auditResourceType:'SCM_INTELLIGENCE_SNAPSHOT',auditResourceId:payload.snapshotId,
        auditReason:`Generated deterministic SCM operational snapshot for ${payload.facilityId}.`,
        outboxTopic:'g-hims-scm-intelligence-events',idempotencyKey,commandId,
        correlationId:context.correlationId,domainState:snapshot,
      });
      return {success:true,commandId,idempotencyKey,entityId:payload.snapshotId,eventId:tx.eventId,auditId:tx.auditId,outboxId:tx.outboxId,data:snapshot};
    }catch(error){
      if(error instanceof AtomicMutationRejectedError)return rejection(commandId,idempotencyKey,error.code,error.message,error.details);
      throw error;
    }
  }
}
