/**
 * G-HIMS Master Transaction Manager
 * Production path atomically persists Domain State + Immutable Event + Audit + Outbox.
 */

import { DomainEventEnvelope, AuditRecord, OutboxRecord, CommandContext } from '../types';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { IdempotencyService } from '../idempotency/idempotency-service';

export interface TransactionPayload<TState = unknown> {
  entityType: string;
  entityId: string;
  eventType: string;
  domainState: TState;
  eventPayload: Record<string, unknown>;
  auditReason?: string;
  auditMetadata?: Record<string, unknown>;
  /** Sensitive aggregates may persist audit metadata without copying full PHI state. */
  omitDomainStateFromAudit?: boolean;
  outboxTopic?: string;
  source?: DomainEventEnvelope['source'];
}

export interface CommittedTransaction<TState = unknown> {
  success: boolean;
  entityId: string;
  domainState: TState;
  event: DomainEventEnvelope;
  audit: AuditRecord;
  outbox: OutboxRecord;
  committedAt: number;
}

export interface AdditionalStateWrite {
  entityType: string;
  entityId: string;
  domainState: unknown;
  /**
   * Optional optimistic concurrency precondition. When supplied, the mutation
   * aborts if the authoritative server version changed after domain validation.
   */
  expectedServerVersion?: number;
}

export interface AtomicMutationParams {
  tenantId: string;
  actorId: string;
  actorRole: string;
  actorRoles?: string[];
  deviceId?: string;
  sessionId?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  auditAction?: string;
  auditResourceType?: string;
  auditResourceId?: string;
  auditReason?: string;
  auditMetadata?: Record<string, unknown>;
  outboxTopic?: string;
  source?: DomainEventEnvelope['source'];
  idempotencyKey?: string;
  commandId?: string;
  correlationId?: string;
  domainState?: unknown;
  expectedPrimaryServerVersion?: number;
  additionalStateWrites?: AdditionalStateWrite[];
  /** @deprecated State must be represented by domainState/additionalStateWrites. */
  stateWrite?: () => Promise<void> | void;
}

export interface AtomicMutationResult {
  success: boolean;
  eventId: string;
  auditId: string;
  outboxId: string;
  committedAt: number;
}

export interface AtomicReadTarget {
  key: string;
  entityType: string;
  entityId: string;
  required?: boolean;
}

export interface PreparedAtomicMutation {
  domainState?: unknown;
  additionalStateWrites?: AdditionalStateWrite[];
  eventPayload: Record<string, unknown>;
  auditReason?: string;
  auditMetadata?: Record<string, unknown>;
  resultData?: unknown;
}

export interface AtomicReadModifyMutationParams
  extends Omit<
    AtomicMutationParams,
    'domainState' | 'additionalStateWrites' | 'eventPayload' | 'auditReason' | 'auditMetadata'
  > {
  readTargets: AtomicReadTarget[];
  prepare: (
    current: Record<string, Record<string, unknown> | null>
  ) => PreparedAtomicMutation;
}

export interface AtomicReadModifyMutationResult extends AtomicMutationResult {
  resultData?: unknown;
}

export class AtomicMutationRejectedError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AtomicMutationRejectedError';
    this.code = code;
    this.details = details;
  }
}

function generateUuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function canUseEphemeralPersistence(): boolean {
  const mode = getRuntimeMode();
  return mode === 'DEMO' || mode === 'TEST';
}

function toDocumentData(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`INVALID_DOMAIN_STATE: ${label} must be a Firestore document object.`);
  }
  return sanitizeForFirestore(value as Record<string, unknown>);
}

function toVersionedDocumentData(
  value: unknown,
  label: string,
  existing?: Record<string, unknown> | null
): Record<string, unknown> {
  const document = toDocumentData(value, label);
  const currentVersion = Number(existing?._serverVersion || 0);
  return {
    ...document,
    _serverVersion: currentVersion + 1,
    ...(existing?._vectorClock && typeof existing._vectorClock === 'object'
      ? { _vectorClock: existing._vectorClock }
      : {}),
  };
}

function collectionForEntityType(entityType: string): string {
  const map: Record<string, string> = {
    ENCOUNTER: 'encounters',
    ENCOUNTER_STAGE: 'encounterStages',
    ENCOUNTER_EVIDENCE: 'encounterEvidence',
    CLINICAL_OBSERVATION: 'clinicalObservations',
    CLINICAL_DOCUMENT: 'clinicalDocuments',
    CLINICAL_CONDITION: 'clinicalConditions',
    CLINICAL_ALLERGY: 'clinicalAllergies',
    MEDICATION_ORDER: 'medicationOrders',
    MEDICATION_DISPENSE: 'medicationDispenses',
    CANONICAL_MEDICATION_ADMINISTRATION: 'canonicalMedicationAdministrations',
    CLINICAL_PROCEDURE: 'clinicalProcedures',
    CANONICAL_DIAGNOSTIC_ORDER: 'canonicalDiagnosticOrders',
    DIAGNOSTIC_REPORT: 'diagnosticReports',
    DIAGNOSTIC_RESULT: 'diagnosticResults',
    DIAGNOSTIC_RESULT_ACKNOWLEDGEMENT: 'diagnosticResultAcknowledgements',
    CARE_PLAN: 'carePlans',
    CLINICAL_PROVENANCE: 'clinicalProvenance',
    PATIENT_CLINICAL_KNOWLEDGE_STATUS: 'patientClinicalKnowledgeStatus',
    OPD_QUEUE_TOKEN: 'opd_queue',
    OPD_APPOINTMENT: 'opdAppointments',
    OPD_APPOINTMENT_SLOT: 'opdAppointmentSlots',
    OPD_WAITLIST_ENTRY: 'opdWaitlist',
    OPD_WAITLIST_SCOPE: 'opdWaitlistScopes',
    OPD_REFERRAL: 'opdReferrals',
    DIAGNOSTIC_ORDER: 'orders',
    PRESCRIPTION: 'prescriptions',
    INPATIENT_ORDER: 'inpatientOrders',
    MEDICATION_ADMINISTRATION: 'medicationAdministrations',
    EMAR_SCHEDULE_SLOT: 'emarScheduleSlots',
    NURSING_CARE_PLAN: 'nursingCarePlans',
    RENAL_DIALYSIS_ORDER: 'renalDialysisOrders',
    RENAL_DIALYSIS_SESSION: 'renalDialysisSessions',
    OBSTETRIC_EPISODE: 'obstetricEpisodes',
    OBSTETRIC_PARTOGRAM_ENTRY: 'obstetricPartogramEntries',
    ONCOLOGY_CASE: 'oncologyCases',
    ONCOLOGY_TUMOR_BOARD_RECOMMENDATION: 'oncologyTumorBoardRecommendations',
    ONCOLOGY_REGIMEN: 'oncologyRegimens',
    ONCOLOGY_CHEMOTHERAPY_LINK: 'oncologyChemotherapyLinks',
    ONCOLOGY_TOXICITY_ASSESSMENT: 'oncologyToxicityAssessments',
    REHABILITATION_PLAN: 'rehabilitationPlans',
    REHABILITATION_SESSION: 'rehabilitationSessions',
    EMERGENCY_PREARRIVAL_TELEMETRY: 'preArrivalTelemetryRecords',
    TELEMETRY_DEVICE_CHECKPOINT: 'telemetryDeviceCheckpoints',
    JOURNAL_ENTRY: 'journalEntries',
    GL_ACCOUNT: 'accounts',
    FINANCE_PERIOD: 'accountingPeriods',
    TRIAL_BALANCE_SNAPSHOT: 'financeTrialBalanceSnapshots',
    REVENUE_RECOGNITION: 'financeRevenueRecognitions',
    AR_OPEN_ITEM: 'arOpenItems',
    AR_ADJUSTMENT: 'financeArAdjustments',
    AR_RECEIPT: 'financeArReceipts',
    AR_AGING_SNAPSHOT: 'financeArAgingSnapshots',
    TREASURY_ACCOUNT: 'treasuryAccounts',
    CASH_SHIFT: 'cashRegisterShifts',
    TREASURY_TRANSFER: 'financeTreasuryTransfers',
    BANK_RECONCILIATION: 'financeBankReconciliations',
    AP_AGING_SNAPSHOT: 'financeApAgingSnapshots',
    SUPPLIER_CREDIT: 'financeSupplierCredits',
    COST_CENTER: 'financeCostCenters',
    COST_ALLOCATION_RULE: 'financeCostAllocationRules',
    COST_ALLOCATION_RUN: 'financeCostAllocationRuns',
    BUDGET_ENVELOPE: 'financeBudgets',
    BUDGET_COMMITMENT: 'financeBudgetCommitments',
    FIXED_ASSET: 'financeFixedAssets',
    DEPRECIATION_RUN: 'financeDepreciationRuns',
    FINANCE_CLOSE: 'financeCloses',
    FINANCIAL_STATEMENT_SNAPSHOT: 'financeStatementSnapshots',
    TAX_CODE: 'financeTaxCodes',
    TAX_LEDGER_ITEM: 'financeTaxLedger',
    TAX_REMITTANCE: 'financeTaxRemittances',
    TAX_SUMMARY_SNAPSHOT: 'financeTaxSummarySnapshots',
    FINANCE_INTELLIGENCE_SNAPSHOT: 'financeIntelligenceSnapshots',
    EMPLOYEE_MASTER: 'employees',
    EMPLOYEE_ASSIGNMENT: 'employeeAssignments',
    WORKFORCE_IDENTITY: 'workforceIdentities',
    EMPLOYEE_CREDENTIAL: 'clinicalCredentials',
    CREDENTIAL_IDENTITY: 'credentialIdentities',
    CLINICAL_PRIVILEGE: 'clinicalPrivileges',
    CLINICAL_PRIVILEGE_SLOT: 'clinicalPrivilegeSlots',
    ROSTER_SHIFT: 'rosterAssignments',
    ROSTER_TIMELINE: 'rosterTimelines',
    ROSTER_SWAP: 'rosterSwaps',
    ATTENDANCE_RECORD: 'attendanceRecords',
    ATTENDANCE_OPEN_SLOT: 'attendanceOpenSlots',
    ATTENDANCE_CORRECTION: 'attendanceCorrections',
    LEAVE_REQUEST: 'leaveRequests',
    LEAVE_BALANCE: 'leaveBalances',
    LEAVE_CALENDAR: 'leaveCalendars',
    COMPENSATION_PROFILE: 'compensationProfiles',
    COMPENSATION_SLOT: 'compensationSlots',
    PAYROLL_PERIOD: 'payrollPeriods',
    PAYROLL_CALENDAR: 'payrollCalendars',
    PAYROLL_EMPLOYEE_SLOT: 'payrollEmployeeSlots',
    PAYROLL_PAYSLIP: 'payrollPayslips',
    PAYROLL_ATTENDANCE_LOCK: 'payrollAttendanceLocks',
    PAYROLL_STATUTORY_LIABILITY: 'payrollStatutoryLiabilities',
    PAYROLL_COMPLIANCE_SNAPSHOT: 'payrollComplianceSnapshots',
    HCM_INTELLIGENCE_SNAPSHOT: 'hcmIntelligenceSnapshots',
    RESOURCE_MASTER: 'resources',
    RESOURCE_IDENTITY: 'resourceIdentities',
    HOSPITAL_ROOM: 'rooms',
    ROOM_IDENTITY: 'roomIdentities',
    HOSPITAL_BED: 'beds',
    BED_IDENTITY: 'bedIdentities',
    SURGICAL_CASE: 'surgicalCases',
    OR_ROOM_SCHEDULE: 'orRoomSchedules',
    TELEHEALTH_SESSION: 'telehealthSessions',
    RESOURCE_RESERVATION: 'resourceReservations',
    MAINTENANCE_WORK_ORDER: 'maintenanceWorkOrders',
    CALIBRATION_RECORD: 'calibrationRecords',
    PATIENT_MPI: 'patients',
    PATIENT_SAFETY: 'patients',
    PATIENT_IDENTITY_CONFIRMATION: 'patientIdentityConfirmations',
    REVENUE_INTEGRITY_FINDING: 'billingMismatches',
    ENCOUNTER_CHARGE: 'encounterCharges',
    AI_DRAFT: 'aiDrafts',
    CLINICAL_DRAFT: 'clinicalDrafts',
    CLINICAL_DRAFT_REVISION: 'clinicalDraftRevisions',
    PATIENT360_PROJECTION: 'patient360Projections',
    ITEM_MASTER: 'items',
    BATCH_LOT: 'batches',
    INVENTORY_LOCATION: 'inventoryLocations',
    STOCK_TRANSFER: 'stockTransfers',
    STOCK_TRANSACTION: 'stockTransactions',
    INVENTORY_BALANCE: 'inventoryBalances',
    PATIENT_CONSUMPTION: 'patientConsumptions',
    PURCHASE_REQUISITION: 'purchaseRequisitions',
    PURCHASE_ORDER: 'scmPurchaseOrders',
    GOODS_RECEIPT_NOTE: 'goodsReceiptNotes',
    SUPPLIER_MASTER: 'suppliers',
    SUPPLIER_QUALIFICATION_REVIEW: 'scmSupplierQualificationReviews',
    SCM_RFQ: 'scmRfqs',
    SUPPLIER_QUOTATION: 'scmSupplierQuotations',
    SUPPLIER_CONTRACT: 'scmSupplierContracts',
    REPLENISHMENT_POLICY: 'scmReplenishmentPolicies',
    REPLENISHMENT_PLAN: 'scmReplenishmentPlans',
    REPLENISHMENT_ORDER: 'scmReplenishmentOrders',
    SCM_RECALL: 'scmRecalls',
    RECALL_EXPOSURE: 'scmRecallExposures',
    INVENTORY_DISPOSITION: 'scmInventoryDispositions',
    COLD_CHAIN_OBSERVATION: 'scmColdChainObservations',
    COLD_CHAIN_EXCURSION: 'scmColdChainExcursions',
    CONTROLLED_CUSTODY: 'scmControlledCustody',
    CONSIGNMENT_AGREEMENT: 'scmConsignmentAgreements',
    CONSIGNMENT_LOT: 'scmConsignmentLots',
    CONSIGNMENT_USAGE: 'scmConsignmentUsages',
    CONSIGNMENT_IDENTITY: 'scmConsignmentIdentities',
    SCM_INTELLIGENCE_SNAPSHOT: 'scmOperationalSnapshots',
    THREE_WAY_MATCH: 'threeWayMatches',
    SUPPLIER_INVOICE: 'scmSupplierInvoices',
    SUPPLIER_INVOICE_MATCH: 'scmSupplierInvoiceMatches',
    AP_PAYMENT_AUTHORIZATION: 'scmPaymentAuthorizations',
    SUPPLIER_PAYMENT: 'scmSupplierPayments',
    CYCLE_COUNT: 'scmCycleCounts',
    STOCK_ADJUSTMENT: 'scmStockAdjustments',
    INVENTORY_PERIOD_CLOSE: 'scmInventoryPeriodCloses',
    CASH_RECEIPT: 'cashReceipts',
    INVOICE: 'invoices',
    INVOICE_SETTLEMENT: 'invoiceSettlements',
    BILLING_SERVICE_CATALOG: 'billingServiceCatalog',
    TARIFF: 'tariffs',
    OPD_BILLING_RECONCILIATION: 'opdBillingReconciliations',
    DISCHARGE_READINESS_REVIEW: 'dischargeReadinessReviews',
    CONSULTANT_REVIEW_CHECKPOINT: 'consultantReviewCheckpoints',
    CLINICAL_CONSULTATION_REQUEST: 'consultationRequests',
    DISEASE_INTAKE_ARTIFACT: 'diseaseIntakeArtifacts',
    CLINICAL_HANDOFF: 'clinicalHandoffs',
    CARE_TRANSITION_EVIDENCE: 'careTransitionEvidence',
    CLINICAL_OPEN_ITEM: 'clinicalOpenItems',
    CLINICAL_ESCALATION: 'clinicalEscalations',
    BED_TRANSFER: 'bedTransfers',
    RADIO_TRANSMISSION: 'radioTransmissions',
  };

  const collection = map[entityType];
  if (!collection) throw new Error(`UNMAPPED_DOMAIN_ENTITY_TYPE: ${entityType}`);
  return collection;
}

export class TransactionManager {
  private static readonly OUTBOX_LEASE_MS = 2 * 60 * 1000;
  private static inMemoryEventStore: DomainEventEnvelope[] = [];
  private static inMemoryAuditStore: AuditRecord[] = [];
  private static inMemoryOutboxStore: OutboxRecord[] = [];
  private static inMemoryDomainState: Map<string, Record<string, unknown>> = new Map();

  private static ephemeralStateKey(
    tenantId:string,
    entityType:string,
    entityId:string
  ):string{
    return `${tenantId}\u0000${entityType}\u0000${entityId}`;
  }

  private static getEphemeralState(
    tenantId:string,
    entityType:string,
    entityId:string
  ):Record<string,unknown>|null{
    return this.inMemoryDomainState.get(
      this.ephemeralStateKey(tenantId,entityType,entityId)
    )||null;
  }

  private static setEphemeralState(
    tenantId:string,
    entityType:string,
    entityId:string,
    value:unknown
  ):void{
    const key=this.ephemeralStateKey(tenantId,entityType,entityId);
    const existing=this.inMemoryDomainState.get(key)||null;
    this.inMemoryDomainState.set(
      key,
      toVersionedDocumentData(value,entityType,existing)
    );
  }

  public static resetEphemeralStateForTesting():void{
    this.inMemoryDomainState.clear();
    this.inMemoryEventStore=[];
    this.inMemoryAuditStore=[];
    this.inMemoryOutboxStore=[];
  }

  public static seedEphemeralStateForTesting(
    tenantId:string,
    entityType:string,
    entityId:string,
    value:unknown
  ):void{
    if(!canUseEphemeralPersistence()){
      throw new Error('EPHEMERAL_STATE_SEED_FORBIDDEN_OUTSIDE_TEST_OR_DEMO');
    }
    this.setEphemeralState(tenantId,entityType,entityId,value);
  }

  public static getEphemeralStateForTesting(
    tenantId:string,
    entityType:string,
    entityId:string
  ):Record<string,unknown>|null{
    if(!canUseEphemeralPersistence()){
      throw new Error('EPHEMERAL_STATE_READ_FORBIDDEN_OUTSIDE_TEST_OR_DEMO');
    }
    return this.getEphemeralState(tenantId,entityType,entityId);
  }

  public static getEphemeralCollectionForTesting(
    tenantId: string,
    collectionName: string
  ): Array<Record<string, unknown>> {
    if (!canUseEphemeralPersistence()) {
      throw new Error('EPHEMERAL_STATE_READ_FORBIDDEN_OUTSIDE_TEST_OR_DEMO');
    }

    const prefix = `${tenantId}\u0000`;
    const rows: Array<Record<string, unknown>> = [];
    for (const [key, value] of this.inMemoryDomainState.entries()) {
      if (!key.startsWith(prefix)) continue;
      const [, entityType] = key.split('\u0000');
      if (!entityType) continue;
      try {
        if (collectionForEntityType(entityType) === collectionName) {
          rows.push(value);
        }
      } catch {
        // Unknown ephemeral entity types are not part of repository-backed state.
      }
    }
    return rows;
  }

  public static getEphemeralStateByCollectionForTesting(
    tenantId: string,
    collectionName: string,
    entityId: string
  ): Record<string, unknown> | null {
    if (!canUseEphemeralPersistence()) {
      throw new Error('EPHEMERAL_STATE_READ_FORBIDDEN_OUTSIDE_TEST_OR_DEMO');
    }

    const suffix = `\u0000${entityId}`;
    const prefix = `${tenantId}\u0000`;
    for (const [key, value] of this.inMemoryDomainState.entries()) {
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const [, entityType] = key.split('\u0000');
      if (!entityType) continue;
      try {
        if (collectionForEntityType(entityType) === collectionName) {
          return value;
        }
      } catch {
        // Unknown ephemeral entity types are not part of repository-backed state.
      }
    }
    return null;
  }

  private static buildRecords(params: {
    tenantId: string;
    actorId: string;
    actorRole: string;
    actorRoles?: string[];
    deviceId?: string;
    sessionId?: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    auditAction?: string;
    auditResourceType?: string;
    auditResourceId?: string;
    auditReason?: string;
    auditMetadata?: Record<string, unknown>;
    omitDomainStateFromAudit?: boolean;
    outboxTopic?: string;
    idempotencyKey: string;
    commandId: string;
    correlationId: string;
    domainState?: unknown;
    source?: DomainEventEnvelope['source'];
    timestamp?: number;
    eventId?: string;
    auditId?: string;
    outboxId?: string;
  }) {
    const timestamp = params.timestamp ?? Date.now();
    const eventId = params.eventId || generateUuid('evt');
    const auditId = params.auditId || generateUuid('aud');
    const outboxId = params.outboxId || generateUuid('obx');

    const event: DomainEventEnvelope = {
      eventId,
      tenantId: params.tenantId,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      eventVersion: 1,
      payload: params.eventPayload,
      actorId: params.actorId,
      actorRole: params.actorRole,
      actorRoles: params.actorRoles?.length ? [...params.actorRoles] : [params.actorRole],
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      occurredAt: timestamp,
      recordedAt: timestamp,
      correlationId: params.correlationId,
      commandId: params.commandId,
      idempotencyKey: params.idempotencyKey,
      source: params.source || 'system',
      schemaVersion: 1,
    };

    const audit: AuditRecord = {
      auditId,
      tenantId: params.tenantId,
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.auditAction || params.eventType,
      resourceType: params.auditResourceType || params.aggregateType,
      resourceId: params.auditResourceId || params.aggregateId,
      commandId: params.commandId,
      eventId,
      correlationId: params.correlationId,
      occurredAt: timestamp,
      recordedAt: timestamp,
      reason: params.auditReason || `Executed ${params.eventType}`,
      metadata: params.auditMetadata || {},
      ...(!params.omitDomainStateFromAudit && params.domainState !== undefined
        ? { newValue: params.domainState }
        : {}),
    };

    const outbox: OutboxRecord = {
      outboxId,
      tenantId: params.tenantId,
      eventId,
      eventType: params.eventType,
      topic: params.outboxTopic || 'g-hims-domain-events',
      payload: params.eventPayload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: timestamp,
      createdAt: timestamp,
    };

    return { timestamp, event, audit, outbox };
  }

  public static async executeAtomicMutation(params: AtomicMutationParams): Promise<AtomicMutationResult> {
    const correlationId = params.correlationId || generateUuid('corr');
    const commandId = params.commandId || generateUuid('cmd');
    const idempotencyKey = params.idempotencyKey || generateUuid('idemp');
    const { timestamp, event, audit, outbox } = this.buildRecords({
      ...params,
      correlationId,
      commandId,
      idempotencyKey,
    });

    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) {
        throw new Error('TRANSACTION_STORE_UNAVAILABLE: durable Firestore transaction store is required.');
      }
      const primaryExisting = this.getEphemeralState(
        params.tenantId,
        params.aggregateType,
        params.aggregateId
      );
      if (
        params.expectedPrimaryServerVersion !== undefined &&
        Number(primaryExisting?._serverVersion || 0) !==
          params.expectedPrimaryServerVersion
      ) {
        throw new Error(
          'DOMAIN_STATE_VERSION_CONFLICT: primary state changed during command execution.'
        );
      }

      const validatedAdditionalWrites = (params.additionalStateWrites || []).map(
        (write) => {
          const existing = this.getEphemeralState(
            params.tenantId,
            write.entityType,
            write.entityId
          );
          if (
            write.expectedServerVersion !== undefined &&
            Number(existing?._serverVersion || 0) !==
              write.expectedServerVersion
          ) {
            throw new Error(
              `DOMAIN_STATE_VERSION_CONFLICT: ${write.entityType}/${write.entityId} changed during command execution.`
            );
          }
          return { write, existing };
        }
      );

      if (params.stateWrite) await params.stateWrite();
      if (params.domainState !== undefined) {
        this.setEphemeralState(
          params.tenantId,
          params.aggregateType,
          params.aggregateId,
          params.domainState
        );
      }
      for (const { write } of validatedAdditionalWrites) {
        this.setEphemeralState(
          params.tenantId,
          write.entityType,
          write.entityId,
          write.domainState
        );
      }
      this.inMemoryEventStore.push(event);
      this.inMemoryAuditStore.push(audit);
      this.inMemoryOutboxStore.push(outbox);
      return { success: true, eventId: event.eventId, auditId: audit.auditId, outboxId: outbox.outboxId, committedAt: timestamp };
    }

    const tenantRef = db.collection('tenants').doc(params.tenantId);
    const eventRef = tenantRef.collection('events').doc(event.eventId);
    const auditRef = tenantRef.collection('audit_logs').doc(audit.auditId);
    const outboxRef = tenantRef.collection('outbox').doc(outbox.outboxId);
    const idempotencyRef = tenantRef.collection('idempotency').doc(IdempotencyService.getDocumentId(idempotencyKey));
    const primaryStateRef = params.domainState !== undefined
      ? tenantRef.collection(collectionForEntityType(params.aggregateType)).doc(params.aggregateId)
      : null;
    const additionalStateRefs = (params.additionalStateWrites || []).map((write) => ({
      write,
      ref: tenantRef.collection(collectionForEntityType(write.entityType)).doc(write.entityId),
    }));

    await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (!idempotencySnapshot.exists) {
        throw new Error('IDEMPOTENCY_RESERVATION_MISSING');
      }
      const reservation = idempotencySnapshot.data() as { status?: string; commandId?: string };
      if (reservation.status !== 'PENDING' || reservation.commandId !== commandId) {
        throw new Error('IDEMPOTENCY_RESERVATION_INVALID');
      }

      // Read current authoritative versions before any writes so Firestore can
      // atomically advance _serverVersion with the state transition.
      const primaryStateSnapshot = primaryStateRef
        ? await transaction.get(primaryStateRef)
        : null;

      if (
        params.expectedPrimaryServerVersion !== undefined &&
        Number(primaryStateSnapshot?.data()?._serverVersion || 0) !== params.expectedPrimaryServerVersion
      ) {
        throw new Error('DOMAIN_STATE_VERSION_CONFLICT: primary state changed during command execution.');
      }
      const additionalStateSnapshots: Array<{
        write: AdditionalStateWrite;
        ref: (typeof additionalStateRefs)[number]['ref'];
        data: Record<string, unknown> | null;
      }> = [];
      for (const item of additionalStateRefs) {
        const snapshot = await transaction.get(item.ref);
        const data = snapshot.exists ? snapshot.data() as Record<string, unknown> : null;
        if (
          item.write.expectedServerVersion !== undefined &&
          Number(data?._serverVersion || 0) !== item.write.expectedServerVersion
        ) {
          throw new Error(
            `DOMAIN_STATE_VERSION_CONFLICT: ${item.write.entityType}/${item.write.entityId} changed during command execution.`
          );
        }
        additionalStateSnapshots.push({
          ...item,
          data,
        });
      }

      if (params.domainState !== undefined && primaryStateRef) {
        // Authoritative snapshots replace stale fields and advance a monotonic
        // version in the same transaction as the domain event/audit/outbox.
        transaction.set(
          primaryStateRef,
          toVersionedDocumentData(
            params.domainState,
            params.aggregateType,
            primaryStateSnapshot?.exists
              ? primaryStateSnapshot.data() as Record<string, unknown>
              : null
          )
        );
      }

      for (const item of additionalStateSnapshots) {
        transaction.set(
          item.ref,
          toVersionedDocumentData(item.write.domainState, item.write.entityType, item.data)
        );
      }

      transaction.create(eventRef, sanitizeForFirestore(event));
      transaction.create(auditRef, sanitizeForFirestore(audit));
      transaction.create(outboxRef, sanitizeForFirestore(outbox));

      if (idempotencySnapshot.exists) {
        transaction.set(idempotencyRef, sanitizeForFirestore({
          ...idempotencySnapshot.data(),
          status: 'COMPLETED',
          completedAt: timestamp,
          lastUpdatedAt: timestamp,
          leaseExpiresAt: 0,
          result: {
            success: true,
            commandId,
            idempotencyKey,
            entityId: params.aggregateId,
            eventType: params.eventType,
            eventId: event.eventId,
            auditId: audit.auditId,
            outboxId: outbox.outboxId,
          },
        }), { merge: true });
      }
    });

    return { success: true, eventId: event.eventId, auditId: audit.auditId, outboxId: outbox.outboxId, committedAt: timestamp };
  }

  /**
   * Atomically reads authoritative state, derives next state, then persists
   * state + event + audit + outbox under the existing idempotency reservation.
   * Use this when writes depend on current authoritative values.
   */
  public static async executeAtomicReadModifyMutation(
    params: AtomicReadModifyMutationParams
  ): Promise<AtomicReadModifyMutationResult> {
    const correlationId = params.correlationId || generateUuid('corr');
    const commandId = params.commandId || generateUuid('cmd');
    const idempotencyKey = params.idempotencyKey || generateUuid('idemp');
    const timestamp = Date.now();
    const eventId = generateUuid('evt');
    const auditId = generateUuid('aud');
    const outboxId = generateUuid('obx');

    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) {
        throw new Error('TRANSACTION_STORE_UNAVAILABLE: durable Firestore transaction store is required.');
      }

      const current:Record<string,Record<string,unknown>|null>={};
      for(const target of params.readTargets){
        const value=this.getEphemeralState(params.tenantId,target.entityType,target.entityId);
        if(!value&&target.required){
          throw new AtomicMutationRejectedError(
            'REQUIRED_STATE_NOT_FOUND',
            `Required authoritative state '${target.key}' does not exist.`,
            {entityType:target.entityType,entityId:target.entityId}
          );
        }
        current[target.key]=value;
      }
      const prepared = params.prepare(current);

      const primaryExisting = this.getEphemeralState(
        params.tenantId,
        params.aggregateType,
        params.aggregateId
      );
      if (
        params.expectedPrimaryServerVersion !== undefined &&
        Number(primaryExisting?._serverVersion || 0) !==
          params.expectedPrimaryServerVersion
      ) {
        throw new Error(
          'DOMAIN_STATE_VERSION_CONFLICT: primary state changed during command execution.'
        );
      }

      const validatedAdditionalWrites = (
        prepared.additionalStateWrites || []
      ).map((write) => {
        const existing = this.getEphemeralState(
          params.tenantId,
          write.entityType,
          write.entityId
        );
        if (
          write.expectedServerVersion !== undefined &&
          Number(existing?._serverVersion || 0) !==
            write.expectedServerVersion
        ) {
          throw new Error(
            `DOMAIN_STATE_VERSION_CONFLICT: ${write.entityType}/${write.entityId} changed during command execution.`
          );
        }
        return { write, existing };
      });

      if (prepared.domainState !== undefined) {
        this.setEphemeralState(
          params.tenantId,
          params.aggregateType,
          params.aggregateId,
          prepared.domainState
        );
      }
      for (const { write } of validatedAdditionalWrites) {
        this.setEphemeralState(
          params.tenantId,
          write.entityType,
          write.entityId,
          write.domainState
        );
      }
      const { event, audit, outbox } = this.buildRecords({
        ...params,
        eventPayload: prepared.eventPayload,
        auditReason: prepared.auditReason,
        auditMetadata: prepared.auditMetadata,
        domainState: prepared.domainState,
        correlationId,
        commandId,
        idempotencyKey,
        timestamp,
        eventId,
        auditId,
        outboxId,
      });
      this.inMemoryEventStore.push(event);
      this.inMemoryAuditStore.push(audit);
      this.inMemoryOutboxStore.push(outbox);
      return {
        success: true,
        eventId,
        auditId,
        outboxId,
        committedAt: timestamp,
        resultData: prepared.resultData,
      };
    }

    const tenantRef = db.collection('tenants').doc(params.tenantId);
    const idempotencyRef = tenantRef
      .collection('idempotency')
      .doc(IdempotencyService.getDocumentId(idempotencyKey));
    const readRefs = params.readTargets.map((target) => ({
      target,
      ref: tenantRef
        .collection(collectionForEntityType(target.entityType))
        .doc(target.entityId),
    }));

    let committedResultData: unknown;

    await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (!idempotencySnapshot.exists) {
        throw new Error('IDEMPOTENCY_RESERVATION_MISSING');
      }
      const reservation = idempotencySnapshot.data() as {
        status?: string;
        commandId?: string;
      };
      if (reservation.status !== 'PENDING' || reservation.commandId !== commandId) {
        throw new Error('IDEMPOTENCY_RESERVATION_INVALID');
      }

      const current: Record<string, Record<string, unknown> | null> = {};
      for (const item of readRefs) {
        const snapshot = await transaction.get(item.ref);
        if (!snapshot.exists && item.target.required) {
          throw new AtomicMutationRejectedError(
            'REQUIRED_STATE_NOT_FOUND',
            `Required authoritative state '${item.target.key}' does not exist.`,
            {
              entityType: item.target.entityType,
              entityId: item.target.entityId,
            }
          );
        }
        current[item.target.key] = snapshot.exists
          ? (snapshot.data() as Record<string, unknown>)
          : null;
      }

      const prepared = params.prepare(current);
      committedResultData = prepared.resultData;
      const { event, audit, outbox } = this.buildRecords({
        ...params,
        eventPayload: prepared.eventPayload,
        auditReason: prepared.auditReason,
        auditMetadata: prepared.auditMetadata,
        domainState: prepared.domainState,
        correlationId,
        commandId,
        idempotencyKey,
        timestamp,
        eventId,
        auditId,
        outboxId,
      });

      const primaryRef =
        prepared.domainState !== undefined
          ? tenantRef
              .collection(collectionForEntityType(params.aggregateType))
              .doc(params.aggregateId)
          : null;
      const primaryRead = params.readTargets.find(
        (target) =>
          target.entityType === params.aggregateType &&
          target.entityId === params.aggregateId
      );
      const primaryExisting = primaryRead ? current[primaryRead.key] : null;

      if (primaryRef && prepared.domainState !== undefined) {
        transaction.set(
          primaryRef,
          toVersionedDocumentData(
            prepared.domainState,
            params.aggregateType,
            primaryExisting
          )
        );
      }

      for (const write of prepared.additionalStateWrites || []) {
        const ref = tenantRef
          .collection(collectionForEntityType(write.entityType))
          .doc(write.entityId);
        const readTarget = params.readTargets.find(
          (target) =>
            target.entityType === write.entityType &&
            target.entityId === write.entityId
        );
        const existing = readTarget ? current[readTarget.key] : null;
        transaction.set(
          ref,
          toVersionedDocumentData(write.domainState, write.entityType, existing)
        );
      }

      transaction.create(
        tenantRef.collection('events').doc(eventId),
        sanitizeForFirestore(event)
      );
      transaction.create(
        tenantRef.collection('audit_logs').doc(auditId),
        sanitizeForFirestore(audit)
      );
      transaction.create(
        tenantRef.collection('outbox').doc(outboxId),
        sanitizeForFirestore(outbox)
      );
      transaction.set(
        idempotencyRef,
        sanitizeForFirestore({
          ...idempotencySnapshot.data(),
          status: 'COMPLETED',
          completedAt: timestamp,
          lastUpdatedAt: timestamp,
          leaseExpiresAt: 0,
          result: {
            success: true,
            commandId,
            idempotencyKey,
            entityId: params.aggregateId,
            eventType: params.eventType,
            eventId,
            auditId,
            outboxId,
          },
        }),
        { merge: true }
      );
    });

    return {
      success: true,
      eventId,
      auditId,
      outboxId,
      committedAt: timestamp,
      resultData: committedResultData,
    };
  }

  public static async executeAtomicWrite<TState = unknown>(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransactionPayload<TState>
  ): Promise<CommittedTransaction<TState>> {
    const { timestamp, event, audit, outbox } = this.buildRecords({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      actorRoles: [...context.roles],
      deviceId: context.deviceId,
      sessionId: context.sessionId,
      aggregateType: payload.entityType,
      aggregateId: payload.entityId,
      eventType: payload.eventType,
      eventPayload: payload.eventPayload,
      auditReason: payload.auditReason,
      auditMetadata: {
        ...(payload.auditMetadata || {}),
        authorization: {
          effectiveRoles: [...context.roles],
          permissions: [...context.permissions],
          clinicalPrivileges: [...(context.clinicalPrivileges || [])],
          facilityIds: [...(context.facilityIds || [])],
          departmentIds: [...(context.departmentIds || [])],
          sessionId: context.sessionId || null,
          deviceId: context.deviceId || null,
          source: context.source || payload.source || 'system',
        },
        ...(context.isEmergencyOverride && context.breakGlassGrantId
          ? {
              breakGlassGrantId: context.breakGlassGrantId,
              breakGlassPatientId: context.breakGlassPatientId,
              breakGlassEncounterId: context.breakGlassEncounterId,
            }
          : {}),
      },
      outboxTopic: payload.outboxTopic,
      source: context.source || payload.source || 'system',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: payload.domainState,
    });

    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) {
        throw new Error('TRANSACTION_STORE_UNAVAILABLE: durable Firestore transaction store is required.');
      }
      this.setEphemeralState(
        context.tenantId,
        payload.entityType,
        payload.entityId,
        payload.domainState
      );
      this.inMemoryEventStore.push(event);
      this.inMemoryAuditStore.push(audit);
      this.inMemoryOutboxStore.push(outbox);
      return { success: true, entityId: payload.entityId, domainState: payload.domainState, event, audit, outbox, committedAt: timestamp };
    }

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const stateRef = tenantRef.collection(collectionForEntityType(payload.entityType)).doc(payload.entityId);
    const eventRef = tenantRef.collection('events').doc(event.eventId);
    const auditRef = tenantRef.collection('audit_logs').doc(audit.auditId);
    const outboxRef = tenantRef.collection('outbox').doc(outbox.outboxId);
    const idempotencyRef = tenantRef.collection('idempotency').doc(IdempotencyService.getDocumentId(idempotencyKey));

    await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (!idempotencySnapshot.exists) {
        throw new Error('IDEMPOTENCY_RESERVATION_MISSING');
      }
      const reservation = idempotencySnapshot.data() as { status?: string; commandId?: string };
      if (reservation.status !== 'PENDING' || reservation.commandId !== commandId) {
        throw new Error('IDEMPOTENCY_RESERVATION_INVALID');
      }

      const stateSnapshot = await transaction.get(stateRef);

      // Authoritative snapshot replacement is required to clear stale clinical
      // fields. _serverVersion advances atomically with event/audit/outbox.
      transaction.set(
        stateRef,
        toVersionedDocumentData(
          payload.domainState,
          payload.entityType,
          stateSnapshot.exists ? stateSnapshot.data() as Record<string, unknown> : null
        )
      );
      transaction.create(eventRef, sanitizeForFirestore(event));
      transaction.create(auditRef, sanitizeForFirestore(audit));
      transaction.create(outboxRef, sanitizeForFirestore(outbox));

      if (idempotencySnapshot.exists) {
        transaction.set(idempotencyRef, sanitizeForFirestore({
          ...idempotencySnapshot.data(),
          status: 'COMPLETED',
          completedAt: timestamp,
          lastUpdatedAt: timestamp,
          leaseExpiresAt: 0,
          result: {
            success: true,
            commandId,
            idempotencyKey,
            entityId: payload.entityId,
            eventType: payload.eventType,
            eventId: event.eventId,
            auditId: audit.auditId,
            outboxId: outbox.outboxId,
          },
        }), { merge: true });
      }
    });

    return { success: true, entityId: payload.entityId, domainState: payload.domainState, event, audit, outbox, committedAt: timestamp };
  }

  public static async getEvents(tenantId: string): Promise<DomainEventEnvelope[]> {
    const db = getAdminFirestore();
    if (!db) {
      return canUseEphemeralPersistence() ? this.inMemoryEventStore.filter((event) => event.tenantId === tenantId) : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('events').orderBy('recordedAt', 'asc').get();
    return snapshot.docs.map((doc) => doc.data() as DomainEventEnvelope);
  }

  public static async getAudits(tenantId: string): Promise<AuditRecord[]> {
    const db = getAdminFirestore();
    if (!db) {
      return canUseEphemeralPersistence() ? this.inMemoryAuditStore.filter((audit) => audit.tenantId === tenantId) : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('audit_logs').orderBy('recordedAt', 'asc').get();
    return snapshot.docs.map((doc) => doc.data() as AuditRecord);
  }

  public static async getPendingOutbox(tenantId: string): Promise<OutboxRecord[]> {
    const db = getAdminFirestore();
    if (!db) {
      const now = Date.now();
      return canUseEphemeralPersistence()
        ? this.inMemoryOutboxStore.filter((record) =>
            record.tenantId === tenantId &&
            (
              ((record.status === 'PENDING' || record.status === 'FAILED') && record.nextAttemptAt <= now) ||
              (record.status === 'PROCESSING' && (record.leaseExpiresAt || 0) <= now)
            )
          )
        : [];
    }

    const snapshot = await db.collection('tenants').doc(tenantId).collection('outbox')
      .where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING']).limit(100).get();

    const now = Date.now();
    return snapshot.docs
      .map((doc) => doc.data() as OutboxRecord)
      .filter((record) =>
        ((record.status === 'PENDING' || record.status === 'FAILED') && record.nextAttemptAt <= now) ||
        (record.status === 'PROCESSING' && (record.leaseExpiresAt || 0) <= now)
      );
  }

  public static async claimOutbox(
    tenantId: string,
    outboxId: string
  ): Promise<OutboxRecord | null> {
    const db = getAdminFirestore();

    if (!db) {
      if (!canUseEphemeralPersistence()) return null;
      const item = this.inMemoryOutboxStore.find((record) => record.outboxId === outboxId);
      const now = Date.now();
      const eligible =
        !!item &&
        (
          ((item.status === 'PENDING' || item.status === 'FAILED') && item.nextAttemptAt <= now) ||
          (item.status === 'PROCESSING' && (item.leaseExpiresAt || 0) <= now)
        );

      if (!item || !eligible) {
        return null;
      }

      item.status = 'PROCESSING';
      item.attempts += 1;
      item.processingStartedAt = now;
      item.leaseExpiresAt = now + this.OUTBOX_LEASE_MS;
      return { ...item };
    }

    const ref = db.collection('tenants').doc(tenantId).collection('outbox').doc(outboxId);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;

      const record = snapshot.data() as OutboxRecord;
      const now = Date.now();
      const eligible =
        ((record.status === 'PENDING' || record.status === 'FAILED') && record.nextAttemptAt <= now) ||
        (record.status === 'PROCESSING' && (record.leaseExpiresAt || 0) <= now);

      if (!eligible) {
        return null;
      }

      const claimed: OutboxRecord = {
        ...record,
        status: 'PROCESSING',
        attempts: record.attempts + 1,
        processingStartedAt: now,
        leaseExpiresAt: now + this.OUTBOX_LEASE_MS,
      };

      transaction.set(ref, sanitizeForFirestore(claimed), { merge: true });
      return claimed;
    });
  }

  public static async updateOutbox(
    tenantId: string,
    outboxId: string,
    patch: Partial<OutboxRecord>
  ): Promise<void> {
    const db = getAdminFirestore();
    if (!db) {
      if (!canUseEphemeralPersistence()) throw new Error('TRANSACTION_STORE_UNAVAILABLE');
      const item = this.inMemoryOutboxStore.find((record) => record.outboxId === outboxId);
      if (item) {
        const normalizedPatch: Partial<OutboxRecord> =
          patch.status && patch.status !== 'PROCESSING'
            ? { ...patch, processingStartedAt: 0, leaseExpiresAt: 0 }
            : patch;
        Object.assign(item, normalizedPatch);
      }
      return;
    }

    const normalizedPatch: Partial<OutboxRecord> =
      patch.status && patch.status !== 'PROCESSING'
        ? { ...patch, processingStartedAt: 0, leaseExpiresAt: 0 }
        : patch;

    await db.collection('tenants').doc(tenantId).collection('outbox').doc(outboxId)
      .set(sanitizeForFirestore(normalizedPatch), { merge: true });
  }
}
