import { createHash } from 'node:crypto';
import type {
  BatchLotRecord,
  GoodsReceiptNote,
  InventoryBalance,
  PurchaseOrderRecord,
  StockTransaction,
  ThreeWayMatchResult,
} from '@/types/scm-domain';
import type { ScmOperationalAlert } from '@/types/scm-intelligence';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a],[b])=>a.localeCompare(b))
        .map(([k,v])=>[k,stable(v)])
    );
  }
  return value;
}

export function buildScmInputFingerprint(value:unknown):string{
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function minor(value:number):number{
  if(!Number.isFinite(value)) return 0;
  return Math.round(value*100);
}

export function calculateOperationalMetrics(params:{
  asOf:string;
  lookbackDays:number;
  expiryHorizonDays:number;
  balances:InventoryBalance[];
  batches:BatchLotRecord[];
  transactions:StockTransaction[];
  purchaseOrders:PurchaseOrderRecord[];
  goodsReceipts:GoodsReceiptNote[];
  matches:ThreeWayMatchResult[];
  recalls:Array<{status?:string;facilityId?:string}>;
  excursions:Array<{status?:string;facilityId?:string}>;
  consignmentLots:Array<{status?:string;quantityAvailable?:number;unitCostMinorUnits?:number}>;
  consignmentUsages:Array<{status?:string;totalCostMinorUnits?:number}>;
  custody:Array<Record<string,unknown>>;
}){
  const asOfMs=Date.parse(params.asOf);
  if(!Number.isFinite(asOfMs)||params.lookbackDays<1||params.expiryHorizonDays<1){
    throw new Error('INVALID_SCM_INTELLIGENCE_WINDOW');
  }
  const lookbackStart=asOfMs-params.lookbackDays*86400000;
  const expiryEnd=asOfMs+params.expiryHorizonDays*86400000;
  const itemIds=[...new Set(params.balances.filter(b=>Number(b.onHand||0)>0).map(b=>b.itemId))];
  const stockoutIds=[...new Set(params.balances.filter(b=>Number(b.onHand||0)>0&&Number(b.available||0)<=0).map(b=>b.itemId))];
  const endingInventoryValuationMinorUnits=params.balances.reduce(
    (sum,b)=>sum+minor(Number(b.onHand||0)*Number(b.unitCost||0)),0
  );

  const balanceBatchIds=new Set(params.balances.map(b=>b.batchId).filter(Boolean));
  const expiryExposureMinorUnits=params.batches
    .filter(b=>{
      const expiry=Date.parse(b.expiryDate);
      return balanceBatchIds.has(b.batchId)&&Number.isFinite(expiry)&&expiry>=asOfMs&&expiry<=expiryEnd&&Number(b.quantityRemaining||0)>0;
    })
    .reduce((sum,b)=>sum+minor(Number(b.quantityRemaining||0)*Number(b.unitCost||0)),0);

  const latestMovementByBalanceKey=new Map<string,number>();
  for(const txn of params.transactions){
    const at=Date.parse(txn.occurredAt);
    if(!Number.isFinite(at)||at>asOfMs)continue;
    const location=txn.toLocationId||txn.fromLocationId||'';
    const key=[txn.itemId,txn.batchId||'',location].join('|');
    latestMovementByBalanceKey.set(key,Math.max(latestMovementByBalanceKey.get(key)||0,at));
  }
  const deadStockExposureMinorUnits=params.balances
    .filter(b=>{
      if(Number(b.onHand||0)<=0)return false;
      const key=[b.itemId,b.batchId||'',b.locationId].join('|');
      const last=latestMovementByBalanceKey.get(key)||Date.parse(b.lastMovementAt||'');
      return !Number.isFinite(last)||last<lookbackStart;
    })
    .reduce((sum,b)=>sum+minor(Number(b.onHand||0)*Number(b.unitCost||0)),0);

  const usageCostMinorUnits=params.transactions
    .filter(txn=>{
      const at=Date.parse(txn.occurredAt);
      return Number.isFinite(at)&&at>=lookbackStart&&at<=asOfMs&&
        ['ISSUE','CONSUMPTION','DISPENSE','ADJUSTMENT_OUT','WRITE_OFF'].includes(txn.transactionType);
    })
    .reduce((sum,txn)=>sum+minor(Number(txn.normalizedQuantity||txn.quantity||0)*Number(txn.unitCost||0)),0);

  const annualizedInventoryTurns=endingInventoryValuationMinorUnits>0
    ? Math.round((usageCostMinorUnits/endingInventoryValuationMinorUnits)*(365/params.lookbackDays)*100)/100
    : 0;

  const grnsByPo=new Map<string,GoodsReceiptNote[]>();
  for(const grn of params.goodsReceipts){
    const list=grnsByPo.get(grn.purchaseOrderId)||[];
    list.push(grn);grnsByPo.set(grn.purchaseOrderId,list);
  }
  let deliveredPoCount=0,onTimeInFull=0;
  for(const po of params.purchaseOrders){
    const grns=grnsByPo.get(po.poId)||[];
    if(!grns.length)continue;
    deliveredPoCount++;
    const latest=Math.max(...grns.map(g=>Date.parse(g.receivedAt)).filter(Number.isFinite));
    const expected=Date.parse(po.expectedDeliveryDate);
    const acceptedByItem=new Map<string,number>();
    grns.forEach(g=>g.items.forEach(line=>acceptedByItem.set(line.itemId,(acceptedByItem.get(line.itemId)||0)+Number(line.quantityAccepted||0))));
    const inFull=po.items.every(line=>(acceptedByItem.get(line.itemId)||0)+0.000001>=Number(line.quantityOrdered||0));
    if(Number.isFinite(expected)&&latest<=expected&&inFull)onTimeInFull++;
  }
  const supplierOtifPercent=deliveredPoCount
    ? Math.round((onTimeInFull/deliveredPoCount)*10000)/100
    : 100;

  const purchaseVarianceMinorUnits=params.matches.reduce(
    (sum,m)=>sum+minor(Math.abs(Number(m.netVariance||0))),0
  );
  const openRecallCount=params.recalls.filter(r=>r.status!=='RESOLVED_DISPOSED').length;
  const unresolvedColdChainExcursionCount=params.excursions.filter(e=>!['RELEASED'].includes(String(e.status||''))).length;
  const consignmentAvailableMinorUnits=params.consignmentLots
    .filter(l=>l.status==='AVAILABLE')
    .reduce((sum,l)=>sum+Math.round(Number(l.quantityAvailable||0)*Number(l.unitCostMinorUnits||0)),0);
  const consignmentPendingInvoiceMinorUnits=params.consignmentUsages
    .filter(u=>u.status==='ACCRUED_AWAITING_SUPPLIER_INVOICE')
    .reduce((sum,u)=>sum+Number(u.totalCostMinorUnits||0),0);

  return {
    distinctStockedItems:itemIds.length,
    stockoutItemCount:stockoutIds.length,
    stockoutRatePercent:itemIds.length?Math.round((stockoutIds.length/itemIds.length)*10000)/100:0,
    endingInventoryValuationMinorUnits,
    expiryExposureMinorUnits,
    deadStockExposureMinorUnits,
    usageCostMinorUnits,
    annualizedInventoryTurns,
    supplierOtifPercent,
    deliveredPoCount,
    purchaseVarianceMinorUnits,
    openRecallCount,
    unresolvedColdChainExcursionCount,
    consignmentAvailableMinorUnits,
    consignmentPendingInvoiceMinorUnits,
    controlledCustodyEventCount:params.custody.length,
  };
}

export function buildOperationalAlerts(metrics:ReturnType<typeof calculateOperationalMetrics>):ScmOperationalAlert[]{
  const alerts:ScmOperationalAlert[]=[];
  if(metrics.stockoutRatePercent>0)alerts.push({
    code:'STOCKOUT_EXPOSURE',severity:metrics.stockoutRatePercent>=10?'CRITICAL':'WARNING',
    value:metrics.stockoutRatePercent,unit:'PERCENT',
    explanation:`${metrics.stockoutItemCount} stocked item(s) have no currently available quantity.`,
  });
  if(metrics.expiryExposureMinorUnits>0)alerts.push({
    code:'EXPIRY_EXPOSURE',severity:'WARNING',value:metrics.expiryExposureMinorUnits,
    unit:'MINOR_CURRENCY_UNITS',explanation:'Inventory value falls within the configured expiry horizon.',
  });
  if(metrics.deadStockExposureMinorUnits>0)alerts.push({
    code:'DEAD_STOCK_EXPOSURE',severity:'WARNING',value:metrics.deadStockExposureMinorUnits,
    unit:'MINOR_CURRENCY_UNITS',explanation:'On-hand inventory has no movement inside the configured lookback window.',
  });
  if(metrics.supplierOtifPercent<90)alerts.push({
    code:'SUPPLIER_OTIF_BELOW_TARGET',severity:metrics.supplierOtifPercent<75?'CRITICAL':'WARNING',
    value:metrics.supplierOtifPercent,unit:'PERCENT',explanation:'Delivered purchase orders are below the 90% on-time-in-full control threshold.',
  });
  if(metrics.purchaseVarianceMinorUnits>0)alerts.push({
    code:'PURCHASE_VARIANCE',severity:'WARNING',value:metrics.purchaseVarianceMinorUnits,
    unit:'MINOR_CURRENCY_UNITS',explanation:'Three-way match variance requires procurement/finance attention.',
  });
  if(metrics.openRecallCount>0)alerts.push({
    code:'OPEN_RECALL',severity:'CRITICAL',value:metrics.openRecallCount,unit:'COUNT',
    explanation:'One or more governed recall cases remain unresolved.',
  });
  if(metrics.unresolvedColdChainExcursionCount>0)alerts.push({
    code:'UNRESOLVED_COLD_CHAIN',severity:'CRITICAL',value:metrics.unresolvedColdChainExcursionCount,unit:'COUNT',
    explanation:'Cold-chain excursions remain quarantined or require disposition.',
  });
  if(metrics.consignmentPendingInvoiceMinorUnits>0)alerts.push({
    code:'CONSIGNMENT_ACCRUAL_PENDING',severity:'INFO',value:metrics.consignmentPendingInvoiceMinorUnits,
    unit:'MINOR_CURRENCY_UNITS',explanation:'Consumed consignment inventory remains accrued pending supplier invoice processing.',
  });
  return alerts;
}
