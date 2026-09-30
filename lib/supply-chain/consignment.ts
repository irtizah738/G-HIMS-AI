export function validateHighValueIdentity(params:{
  quantity:number;
  requiresSerial:boolean;
  requiresUdi:boolean;
  serialNumbers?:string[];
  udis?:string[];
}):void{
  if(!Number.isFinite(params.quantity)||params.quantity<=0){
    throw new Error('INVALID_CONSIGNMENT_QUANTITY');
  }
  if(!Number.isInteger(params.quantity)){
    if(params.requiresSerial||params.requiresUdi){
      throw new Error('HIGH_VALUE_SERIALIZED_QUANTITY_MUST_BE_INTEGER');
    }
    return;
  }
  const serials=[...new Set((params.serialNumbers||[]).map(v=>v.trim()).filter(Boolean))];
  const udis=[...new Set((params.udis||[]).map(v=>v.trim()).filter(Boolean))];
  if(params.requiresSerial && serials.length!==params.quantity){
    throw new Error('HIGH_VALUE_SERIAL_COUNT_MISMATCH');
  }
  if(params.requiresUdi && udis.length!==params.quantity){
    throw new Error('HIGH_VALUE_UDI_COUNT_MISMATCH');
  }
}

export function consignmentUsageCostMinorUnits(
  quantity:number,
  unitCostMinorUnits:number
):number{
  if(
    !Number.isFinite(quantity)||quantity<=0||
    !Number.isSafeInteger(unitCostMinorUnits)||unitCostMinorUnits<0
  ){
    throw new Error('INVALID_CONSIGNMENT_COST_INPUT');
  }
  const total=Math.round(quantity*unitCostMinorUnits);
  if(!Number.isSafeInteger(total)) throw new Error('CONSIGNMENT_COST_OVERFLOW');
  return total;
}
