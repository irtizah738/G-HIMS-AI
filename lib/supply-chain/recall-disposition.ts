import type {
  BatchLotRecord,
  PatientConsumptionRecord,
} from '@/types/scm-domain';
import type { GovernedRecallCase } from '@/types/scm-recall';

export function batchMatchesRecall(
  recall: Pick<
    GovernedRecallCase,
    | 'scope'
    | 'itemId'
    | 'targetBatchNumbers'
    | 'targetLotNumbers'
    | 'supplierId'
    | 'manufacturerName'
  >,
  batch: BatchLotRecord
): boolean {
  if (batch.itemId !== recall.itemId) return false;

  switch (recall.scope) {
    case 'ITEM_WIDE':
      return true;
    case 'BATCH_WIDE':
      return recall.targetBatchNumbers.includes(batch.batchNumber);
    case 'LOT_WIDE':
      return Boolean(
        batch.lotNumber && recall.targetLotNumbers.includes(batch.lotNumber)
      );
    case 'SUPPLIER_SPECIFIC':
      return Boolean(
        recall.supplierId && batch.supplierId === recall.supplierId
      );
    case 'MANUFACTURER_SPECIFIC':
      return Boolean(
        recall.manufacturerName &&
          batch.manufacturer.trim().toLowerCase() ===
            recall.manufacturerName.trim().toLowerCase()
      );
    case 'SERIAL_SPECIFIC':
      return false;
    default:
      return false;
  }
}

export function consumptionMatchesRecall(
  recall: Pick<
    GovernedRecallCase,
    | 'scope'
    | 'itemId'
    | 'targetBatchNumbers'
    | 'targetLotNumbers'
    | 'targetSerialNumbers'
    | 'supplierId'
    | 'manufacturerName'
  >,
  consumption: PatientConsumptionRecord
): boolean {
  if (consumption.itemId !== recall.itemId) return false;

  switch (recall.scope) {
    case 'ITEM_WIDE':
      return true;
    case 'BATCH_WIDE':
      return recall.targetBatchNumbers.includes(consumption.batchNumber);
    case 'LOT_WIDE':
      return Boolean(
        consumption.lotNumber &&
          recall.targetLotNumbers.includes(consumption.lotNumber)
      );
    case 'SERIAL_SPECIFIC':
      return Boolean(
        consumption.serialNumber &&
          recall.targetSerialNumbers.includes(consumption.serialNumber)
      );
    case 'SUPPLIER_SPECIFIC':
      return Boolean(
        recall.supplierId &&
          consumption.supplierId === recall.supplierId
      );
    case 'MANUFACTURER_SPECIFIC':
      // Consumption records preserve supply provenance but not a canonical
      // manufacturer value. Manufacturer-wide exposure projection therefore
      // requires the authoritative affected batch list rather than guessing.
      return recall.targetBatchNumbers.includes(consumption.batchNumber);
    default:
      return false;
  }
}
