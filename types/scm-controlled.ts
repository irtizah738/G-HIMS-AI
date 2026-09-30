export interface RecordColdChainObservationPayload {
  observationId: string;
  facilityId: string;
  locationId: string;
  itemId: string;
  batchId: string;
  balanceId: string;
  temperatureCelsius: number;
  observedAt: string;
  deviceId: string;
  calibrationValidUntil: string;
}

export interface ColdChainObservationRecord extends RecordColdChainObservationPayload {
  tenantId: string;
  minAllowedCelsius: number;
  maxAllowedCelsius: number;
  withinRange: boolean;
  recordedBy: string;
  recordedAt: string;
  excursionId?: string;
}

export interface ColdChainExcursionRecord {
  excursionId: string;
  tenantId: string;
  observationId: string;
  facilityId: string;
  locationId: string;
  itemId: string;
  batchId: string;
  balanceId: string;
  temperatureCelsius: number;
  minAllowedCelsius: number;
  maxAllowedCelsius: number;
  affectedQuantity: number;
  detectedAt: string;
  detectedBy: string;
  status:
    | 'QUARANTINED_PENDING_REVIEW'
    | 'RELEASED'
    | 'DISPOSITION_REQUIRED';
  reviewedAt?: string;
  reviewedBy?: string;
  reviewDecision?: 'RELEASE' | 'DISPOSE_REQUIRED';
  reviewNotes?: string;
}

export interface ReviewColdChainExcursionPayload {
  excursionId: string;
  decision: 'RELEASE' | 'DISPOSE_REQUIRED';
  notes: string;
}

export type ControlledCustodyAction =
  | 'RECEIVE'
  | 'HANDOFF'
  | 'ISSUE'
  | 'RETURN'
  | 'WASTE_WITNESS';

export interface RecordControlledCustodyPayload {
  custodyId: string;
  facilityId: string;
  locationId: string;
  itemId: string;
  batchId: string;
  balanceId: string;
  action: ControlledCustodyAction;
  quantity: number;
  fromCustodianId?: string;
  toCustodianId?: string;
  witnessUserId: string;
  stockTransactionId?: string;
  referenceId: string;
  occurredAt: string;
  notes?: string;
}

export interface ControlledCustodyRecord
  extends RecordControlledCustodyPayload {
  tenantId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  recordedBy: string;
  recordedAt: string;
}
