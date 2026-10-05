/**
 * G-HIMS Master Command Bus & Router
 * Central dispatch router for all domain commands across Clinical, ERP, HCM, and Diagnostic engines.
 */

import { BaseCommand, CommandContext, CommandResult } from '../types';
import { EncounterDomainService } from '../services/encounter-domain-service';
import { ClinicalOrderDomainService } from '../services/clinical-order-domain-service';
import { ClinicalDocumentationDomainService } from '../services/clinical-documentation-domain-service';
import { ClinicalDraftDomainService } from '../services/clinical-draft-domain-service';
import { OpdQueueDomainService } from '../services/opd-queue-domain-service';
import { OpdBillingDomainService } from '../services/opd-billing-domain-service';
import { FinanceGlDomainService } from '../services/finance-gl-domain-service';
import { FinanceArRevenueDomainService } from '../services/finance-ar-revenue-domain-service';
import { FinanceTreasuryDomainService } from '../services/finance-treasury-domain-service';
import { FinanceApDomainService } from '../services/finance-ap-domain-service';
import { FinanceCostBudgetDomainService } from '../services/finance-cost-budget-domain-service';
import { FinanceFixedAssetDomainService } from '../services/finance-fixed-asset-domain-service';
import { FinanceCloseDomainService } from '../services/finance-close-domain-service';
import { FinanceTaxDomainService } from '../services/finance-tax-domain-service';
import { FinanceIntelligenceDomainService } from '../services/finance-intelligence-domain-service';
import { HrWorkforceDomainService } from '../services/hr-workforce-domain-service';
import { HcmPayrollDomainService } from '../services/hcm-payroll-domain-service';
import { HcmIntelligenceDomainService } from '../services/hcm-intelligence-domain-service';
import { ResourceCapacityDomainService } from '../services/resource-capacity-domain-service';
import { PatientIdentityDomainService } from '../services/patient-identity-domain-service';
import { PatientMergeDomainService } from '../services/patient-merge-domain-service';
import { InpatientClinicalDomainService } from '../services/inpatient-clinical-domain-service';
import { CareTransitionDomainService } from '../services/care-transition-domain-service';
import { SurgicalCaseDomainService } from '../services/surgical-case-domain-service';
import { TelehealthDomainService } from '../services/telehealth-domain-service';
import { RevenueIntegrityDomainService } from '../services/revenue-integrity-domain-service';
import { ScmOfflineDomainService } from '../services/scm-offline-domain-service';
import { ScmProcurementDomainService } from '../services/scm-procurement-domain-service';
import { ScmPayablesDomainService } from '../services/scm-payables-domain-service';
import { ScmSourcingDomainService } from '../services/scm-sourcing-domain-service';
import { ScmPlanningDomainService } from '../services/scm-planning-domain-service';
import { ScmRecallDispositionDomainService } from '../services/scm-recall-disposition-domain-service';
import { ScmControlledInventoryDomainService } from '../services/scm-controlled-inventory-domain-service';
import { ScmConsignmentDomainService } from '../services/scm-consignment-domain-service';
import { ScmIntelligenceDomainService } from '../services/scm-intelligence-domain-service';
import { ScmCostingDomainService } from '../services/scm-costing-domain-service';
import { CashReceiptDomainService } from '../services/cash-receipt-domain-service';
import { DiagnosticResultDomainService } from '../services/diagnostic-result-domain-service';
import { PatientClinicalKnowledgeDomainService } from '../services/patient-clinical-knowledge-domain-service';
import { DischargeReadinessReviewDomainService } from '../services/discharge-readiness-review-domain-service';
import { ConsultantReviewDomainService } from '../services/consultant-review-domain-service';
import { ClinicalCoordinationDomainService } from '../services/clinical-coordination-domain-service';
import { IdempotencyService } from '../idempotency/idempotency-service';
import { validateCommandPayload } from './command-schema-registry';
import { emitOperationalEvent, operationalTimer } from '@/lib/observability/server-telemetry';

export class CommandBus {
  /**
   * Routes and executes a domain command through the authoritative backend pipeline.
   * Enforces zero-duplicate idempotency checking, state-machine validation, and audit recording.
   */
  public static async dispatch(
    context: CommandContext,
    command: BaseCommand
  ): Promise<CommandResult> {
    const elapsed = operationalTimer();

    const emit = (
      outcome: 'SUCCESS' | 'REJECTED' | 'FAILURE',
      errorCode?: string,
      attributes?: Record<string, string | number | boolean | null | undefined>
    ) => {
      emitOperationalEvent({
        event: 'command.dispatch',
        outcome,
        tenantId: context.tenantId,
        correlationId: context.correlationId,
        requestId: context.requestId,
        durationMs: elapsed(),
        errorCode,
        attributes: {
          commandType: command.commandType,
          ...attributes,
        },
      });
    };

    // Zero-trust perimeter validation must precede schema/idempotency work.
    if (!context.tenantId?.trim() || !command.tenantId?.trim()) {
      emit('REJECTED', 'TENANT_ISOLATION_ERROR');
      return {
        success: false,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        error: {
          code: 'TENANT_ISOLATION_ERROR',
          message: 'Command context is missing an authenticated tenant identifier.',
        },
      };
    }

    if (
      context.tenantId.trim().toLowerCase() !==
      command.tenantId.trim().toLowerCase()
    ) {
      emit('REJECTED', 'TENANT_MISMATCH');
      return {
        success: false,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        error: {
          code: 'TENANT_MISMATCH',
          message: 'Cross-tenant mutation strictly blocked.',
        },
      };
    }

    if (!context.actorId?.trim()) {
      emit('REJECTED', 'UNAUTHENTICATED_ACTOR');
      return {
        success: false,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        error: {
          code: 'UNAUTHENTICATED_ACTOR',
          message: 'Command context does not contain an authoritative actor ID.',
        },
      };
    }

    try {
      const schemaValidation = validateCommandPayload(command);
      if (!schemaValidation.success) {
        emit('REJECTED', schemaValidation.error?.code);
        return {
          success: false,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          error: {
            code: schemaValidation.error?.code || 'COMMAND_PAYLOAD_INVALID',
            message: schemaValidation.error?.message || 'Command payload validation failed.',
            details: schemaValidation.error?.details,
          },
        };
      }

      command.payload = schemaValidation.payload || command.payload;

      // 1. Durable zero-duplicate idempotency reservation.
      const idempotencyCheck = await IdempotencyService.acquireExecution(
        context.tenantId,
        command.idempotencyKey,
        command.commandType,
        command.payload,
        command.commandId
      );

      if (idempotencyCheck.status === 'CACHED' && idempotencyCheck.record?.result) {
        emit('SUCCESS', undefined, { replayedFromCache: true });
        return {
          ...idempotencyCheck.record.result,
          replayedFromCache: true,
        };
      }

      if (idempotencyCheck.status === 'IN_PROGRESS') {
        emit('REJECTED', 'IDEMPOTENCY_IN_PROGRESS');
        return {
          success: false,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          error: {
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: `Idempotency key '${command.idempotencyKey}' is already reserved by an in-flight or recovery-required command.`,
          },
        };
      }

      if (idempotencyCheck.status === 'CONFLICT') {
        emit('REJECTED', 'IDEMPOTENCY_KEY_CONFLICT');
        return {
          success: false,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: `Idempotency key '${command.idempotencyKey}' was previously used with a different command payload.`,
          },
        };
      }

      let result: CommandResult;

      switch (command.commandType) {
        // --- Clinical Domain ---
        case 'CreateEncounterCommand':
          result = await EncounterDomainService.createEncounter(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateOpdEncounterCommand':
          result = await EncounterDomainService.createOpdEncounter(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AdvanceStageCommand':
          result = await EncounterDomainService.advanceStage(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CommitEncounterDispositionCommand':
          result = await EncounterDomainService.commitDisposition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'PlaceDiagnosticOrderCommand':
          result = await ClinicalOrderDomainService.placeDiagnosticOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordDiagnosticResultCommand':
          result = await DiagnosticResultDomainService.record(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AcknowledgeCriticalDiagnosticResultCommand':
          result = await DiagnosticResultDomainService.acknowledgeCriticalResult(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'PrescribeMedicationCommand':
          result = await ClinicalOrderDomainService.prescribeMedication(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'DispensePrescriptionCommand':
          result = await ClinicalOrderDomainService.dispenseMedication(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SetCompensationCommand':
          result = await HcmPayrollDomainService.setCompensation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'ReviewCompensationCommand':
          result = await HcmPayrollDomainService.reviewCompensation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'CreatePayrollPeriodCommand':
          result = await HcmPayrollDomainService.createPayrollPeriod(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'EnrollPayrollEmployeeCommand':
          result = await HcmPayrollDomainService.enrollPayrollEmployee(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'CalculatePayrollEmployeeCommand':
          result = await HcmPayrollDomainService.calculatePayrollEmployee(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'FinalizePayrollPeriodCommand':
          result = await HcmPayrollDomainService.finalizePayrollPeriod(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'ApprovePayrollPeriodCommand':
          result = await HcmPayrollDomainService.approvePayrollPeriod(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'PostPayrollPeriodCommand':
          result = await HcmPayrollDomainService.postPayrollPeriod(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'SettlePayrollPeriodCommand':
          result = await HcmPayrollDomainService.settlePayrollPeriod(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'RemitPayrollLiabilityCommand':
          result = await HcmPayrollDomainService.remitPayrollLiability(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'GenerateHcmIntelligenceCommand':
          result = await HcmIntelligenceDomainService.generateSnapshot(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'GeneratePayrollComplianceSnapshotCommand':
          result = await HcmPayrollDomainService.generatePayrollComplianceSnapshot(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'RecordVitalsCommand':
          result = await ClinicalDocumentationDomainService.recordVitals(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SignClinicalNoteCommand':
          result = await ClinicalDocumentationDomainService.signClinicalNote(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewClinicalDraftCommand':
          result = await ClinicalDraftDomainService.reviewAndRevise(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'ApproveClinicalDraftCommand':
          result = await ClinicalDraftDomainService.approve(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'SignClinicalDraftCommand':
          result = await ClinicalDraftDomainService.sign(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'RejectClinicalDraftCommand':
          result = await ClinicalDraftDomainService.reject(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'CompleteMedicationReconciliationCommand':
          result = await ClinicalDocumentationDomainService.completeMedicationReconciliation(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordClinicalConditionCommand':
          result = await ClinicalDocumentationDomainService.recordClinicalCondition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordClinicalAllergyCommand':
          result = await ClinicalDocumentationDomainService.recordClinicalAllergy(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewPatientClinicalKnowledgeCommand':
          result = await PatientClinicalKnowledgeDomainService.review(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordConsultantPatientReviewCommand':
          result = await ConsultantReviewDomainService.record(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RequestConsultationCommand':
          result = await ClinicalCoordinationDomainService.requestConsultation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'AcceptConsultationCommand':
          result = await ClinicalCoordinationDomainService.acceptConsultation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'CompleteConsultationCommand':
          result = await ClinicalCoordinationDomainService.completeConsultation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'CreateClinicalHandoffCommand':
          result = await ClinicalCoordinationDomainService.createHandoff(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'AcceptClinicalHandoffCommand':
          result = await ClinicalCoordinationDomainService.acceptHandoff(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'AcknowledgeClinicalOpenItemCommand':
          result = await ClinicalCoordinationDomainService.acknowledgeOpenItem(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'ResolveClinicalOpenItemCommand':
          result = await ClinicalCoordinationDomainService.resolveOpenItem(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'AcknowledgeClinicalEscalationCommand':
          result = await ClinicalCoordinationDomainService.acknowledgeEscalation(
            context, command.commandId, command.idempotencyKey, command.payload as any
          );
          break;

        case 'RecordDischargeReadinessReviewCommand':
          result = await DischargeReadinessReviewDomainService.record(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'UpdateOpdQueueStatusCommand':
          result = await OpdQueueDomainService.updateStatus(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'StartOpdServiceCommand':
          result = await OpdQueueDomainService.startService(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateOpdConsultationInvoiceCommand':
          result = await OpdBillingDomainService.createConsultationInvoice(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AdmitPatientToInpatientCareCommand':
          result = await CareTransitionDomainService.admitToInpatientCare(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'PlaceInpatientOrderCommand':
          result = await InpatientClinicalDomainService.placeOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ResolveInpatientOrderCommand':
          result = await InpatientClinicalDomainService.resolveOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordMedicationAdministrationCommand':
          result = await InpatientClinicalDomainService.recordMedicationAdministration(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AdmitPatientToBedCommand':
          result = {
            success: false,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            error: {
              code: 'CARE_TRANSITION_COMMAND_REQUIRED',
              message:
                'Inpatient admission must use AdmitPatientToInpatientCareCommand so the encounter lifecycle and bed assignment are committed together.',
            },
          };
          break;

        case 'UpdateBedStatusCommand':
          result = await ResourceCapacityDomainService.updateBedOperationalStatus(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'TransferInpatientBedCommand':
          result = await CareTransitionDomainService.transferInpatientBed(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'DischargeInpatientEncounterCommand':
          result = await CareTransitionDomainService.dischargeInpatientEncounter(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'DischargePatientFromBedCommand':
          result = {
            success: false,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            error: {
              code: 'CARE_TRANSITION_COMMAND_REQUIRED',
              message:
                'Inpatient discharge must use DischargeInpatientEncounterCommand so clinical safety gates, encounter closure, patient census, and bed release are atomic.',
            },
          };
          break;

        case 'ScheduleSurgicalCaseCommand':
          result = await SurgicalCaseDomainService.scheduleCase(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordSurgicalSafetyChecklistCommand':
          result = await SurgicalCaseDomainService.recordSafetyChecklist(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AdvanceSurgicalCaseCommand':
          result = await SurgicalCaseDomainService.advanceCase(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CancelSurgicalCaseCommand':
          result = await SurgicalCaseDomainService.cancelCase(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateTelehealthSessionCommand':
          result = await TelehealthDomainService.create(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'UpdateTelehealthSessionCommand':
          result = await TelehealthDomainService.update(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CompleteTelehealthSessionCommand':
          result = await TelehealthDomainService.complete(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        // --- Patient Identity & Safety Domain ---
        case 'RegisterPatientCommand':
          result = {
            success: false,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            error: {
              code: 'REGISTRATION_ORCHESTRATOR_REQUIRED',
              message: 'Patient registration must use the atomic patient+encounter registration endpoint.',
            },
          };
          break;

        case 'MergePatientCommand':
          result = await PatientMergeDomainService.merge(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ConfirmPatientIdentityCommand':
          result = await PatientIdentityDomainService.confirmPatientIdentity(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        // --- Finance Domain ---
        case 'CreateFinanceAccountCommand':
          result = await FinanceGlDomainService.createAccount(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CreateFinancePeriodCommand':
          result = await FinanceGlDomainService.createPeriod(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ChangeFinancePeriodStatusCommand':
          result = await FinanceGlDomainService.changePeriodStatus(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'PostJournalCommand':
          result = await FinanceGlDomainService.postJournal(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ReverseJournalCommand':
          result = await FinanceGlDomainService.reverseJournal(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'GenerateTrialBalanceCommand':
          result = await FinanceGlDomainService.generateTrialBalance(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RecognizePatientInvoiceCommand':
          result = await FinanceArRevenueDomainService.recognizeInvoice(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'AdjustArOpenItemCommand':
          result = await FinanceArRevenueDomainService.adjustOpenItem(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RecordArReceiptCommand':
          result = await FinanceArRevenueDomainService.recordArReceipt(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'GenerateArAgingCommand':
          result = await FinanceArRevenueDomainService.generateAging(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RegisterTreasuryAccountCommand':
          result = await FinanceTreasuryDomainService.registerTreasuryAccount(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'OpenCashShiftCommand':
          result = await FinanceTreasuryDomainService.openCashShift(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CloseCashShiftCommand':
          result = await FinanceTreasuryDomainService.closeCashShift(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ReviewCashShiftCommand':
          result = await FinanceTreasuryDomainService.reviewCashShift(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'TreasuryTransferCommand':
          result = await FinanceTreasuryDomainService.transfer(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'PrepareBankReconciliationCommand':
          result = await FinanceTreasuryDomainService.prepareBankReconciliation(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ApproveBankReconciliationCommand':
          result = await FinanceTreasuryDomainService.approveBankReconciliation(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'GenerateApAgingCommand':
          result = await FinanceApDomainService.generateAging(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ApplySupplierCreditCommand':
          result = await FinanceApDomainService.applySupplierCredit(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CreateCostCenterCommand':
          result = await FinanceCostBudgetDomainService.createCostCenter(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CreateCostAllocationRuleCommand':
          result = await FinanceCostBudgetDomainService.createAllocationRule(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RunCostAllocationCommand':
          result = await FinanceCostBudgetDomainService.runCostAllocation(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CreateBudgetEnvelopeCommand':
          result = await FinanceCostBudgetDomainService.createBudget(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ApproveBudgetEnvelopeCommand':
          result = await FinanceCostBudgetDomainService.approveBudget(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CommitBudgetCommand':
          result = await FinanceCostBudgetDomainService.commitBudget(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ReleaseBudgetCommitmentCommand':
          result = await FinanceCostBudgetDomainService.releaseBudgetCommitment(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'ConsumeBudgetCommitmentCommand':
          result = await FinanceCostBudgetDomainService.consumeBudgetCommitment(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CapitalizeFixedAssetCommand':
          result = await FinanceFixedAssetDomainService.capitalize(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RunDepreciationCommand':
          result = await FinanceFixedAssetDomainService.runDepreciation(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'TransferFixedAssetCommand':
          result = await FinanceFixedAssetDomainService.transferAsset(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'DisposeFixedAssetCommand':
          result = await FinanceFixedAssetDomainService.disposeAsset(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'StartFinanceCloseCommand':
          result = await FinanceCloseDomainService.startClose(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'FinalizeFinanceCloseCommand':
          result = await FinanceCloseDomainService.finalizeClose(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'LockFinancePeriodCommand':
          result = await FinanceCloseDomainService.lockPeriod(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'CreateTaxCodeCommand':
          result = await FinanceTaxDomainService.createTaxCode(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RecordSupplierWithholdingCommand':
          result = await FinanceTaxDomainService.recordSupplierWithholding(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'RemitTaxLiabilityCommand':
          result = await FinanceTaxDomainService.remitTax(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'GenerateTaxSummaryCommand':
          result = await FinanceTaxDomainService.generateTaxSummary(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;
        case 'GenerateFinanceIntelligenceCommand':
          result = await FinanceIntelligenceDomainService.generate(context, command.commandId, command.idempotencyKey, command.payload as any);
          break;

        case 'ReconcileRevenueIntegrityFindingCommand':
          result = await RevenueIntegrityDomainService.reconcile(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'DismissRevenueIntegrityFindingCommand':
          result = await RevenueIntegrityDomainService.dismiss(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        // --- Supply Chain / Pharmacy Domain ---
        case 'RecordStockTransactionCommand':
          result = await ScmOfflineDomainService.recordStockTransaction(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordPatientConsumptionCommand':
          result = await ScmOfflineDomainService.recordPatientConsumption(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SubmitPurchaseRequisitionCommand':
          result = await ScmOfflineDomainService.submitPurchaseRequisition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApprovePurchaseRequisitionCommand':
          result = await ScmProcurementDomainService.approvePurchaseRequisition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreatePurchaseOrderCommand':
          result = await ScmProcurementDomainService.createPurchaseOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApprovePurchaseOrderCommand':
          result = await ScmProcurementDomainService.approvePurchaseOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordGoodsReceiptCommand':
          result = await ScmProcurementDomainService.recordGoodsReceipt(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'InitiateScmRecallCommand':
          result = await ScmRecallDispositionDomainService.initiateRecall(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ExecuteRecallQuarantineCommand':
          result = await ScmRecallDispositionDomainService.executeRecallQuarantine(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ProjectRecallExposuresCommand':
          result = await ScmRecallDispositionDomainService.projectRecallExposures(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordRecallNotificationCommand':
          result = await ScmRecallDispositionDomainService.recordRecallNotification(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateInventoryDispositionCommand':
          result = await ScmRecallDispositionDomainService.createDisposition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewInventoryDispositionCommand':
          result = await ScmRecallDispositionDomainService.reviewDisposition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ExecuteInventoryDispositionCommand':
          result = await ScmRecallDispositionDomainService.executeDisposition(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ResolveScmRecallCommand':
          result = await ScmRecallDispositionDomainService.resolveRecall(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordColdChainObservationCommand':
          result = await ScmControlledInventoryDomainService.recordColdChainObservation(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewColdChainExcursionCommand':
          result = await ScmControlledInventoryDomainService.reviewColdChainExcursion(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordControlledCustodyCommand':
          result = await ScmControlledInventoryDomainService.recordControlledCustody(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateConsignmentAgreementCommand':
          result = await ScmConsignmentDomainService.createAgreement(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApproveConsignmentAgreementCommand':
          result = await ScmConsignmentDomainService.approveAgreement(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReceiveConsignmentStockCommand':
          result = await ScmConsignmentDomainService.receiveStock(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordConsignmentUsageCommand':
          result = await ScmConsignmentDomainService.recordUsage(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CaptureConsignmentSupplierInvoiceCommand':
          result = await ScmConsignmentDomainService.captureConsignmentSupplierInvoice(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewConsignmentSupplierInvoiceCommand':
          result = await ScmConsignmentDomainService.reviewConsignmentSupplierInvoice(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'GenerateScmIntelligenceSnapshotCommand':
          result = await ScmIntelligenceDomainService.generateSnapshot(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'UpsertReplenishmentPolicyCommand':
          result = await ScmPlanningDomainService.upsertReplenishmentPolicy(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'GenerateReplenishmentPlanCommand':
          result = await ScmPlanningDomainService.generateReplenishmentPlan(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewReplenishmentPlanCommand':
          result = await ScmPlanningDomainService.reviewReplenishmentPlan(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ExecuteReplenishmentPlanCommand':
          result = await ScmPlanningDomainService.executeReplenishmentPlan(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CompleteInternalReplenishmentOrderCommand':
          result = await ScmPlanningDomainService.completeInternalReplenishmentOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReviewSupplierQualificationCommand':
          result = await ScmSourcingDomainService.reviewSupplierQualification(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateScmRfqCommand':
          result = await ScmSourcingDomainService.createRfq(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordSupplierQuotationCommand':
          result = await ScmSourcingDomainService.recordSupplierQuotation(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AwardSupplierContractCommand':
          result = await ScmSourcingDomainService.awardSupplierContract(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApproveSupplierContractCommand':
          result = await ScmSourcingDomainService.approveSupplierContract(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ChangeSupplierContractStatusCommand':
          result = await ScmSourcingDomainService.changeSupplierContractStatus(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordSupplierInvoiceCommand':
          result = await ScmPayablesDomainService.recordSupplierInvoice(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ResolveSupplierInvoiceMatchCommand':
          result = await ScmPayablesDomainService.resolveSupplierInvoiceMatch(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecognizeSupplierInvoicePayableCommand':
          result = await ScmPayablesDomainService.recognizeSupplierInvoicePayable(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RequestSupplierPaymentAuthorizationCommand':
          result = await ScmPayablesDomainService.requestSupplierPaymentAuthorization(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApproveSupplierPaymentAuthorizationCommand':
          result = await ScmPayablesDomainService.approveSupplierPaymentAuthorization(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordSupplierPaymentCommand':
          result = await ScmPayablesDomainService.recordSupplierPayment(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SubmitCycleCountCommand':
          result = await ScmCostingDomainService.submitCycleCount(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApproveCycleCountCommand':
          result = await ScmCostingDomainService.approveCycleCount(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'StartInventoryPeriodCloseCommand':
          result = await ScmCostingDomainService.startInventoryPeriodClose(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'FinalizeInventoryPeriodCloseCommand':
          result = await ScmCostingDomainService.finalizeInventoryPeriodClose(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordCashReceiptCommand':
          result = await CashReceiptDomainService.record(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        // --- HCM / HR Domain ---
        case 'CreateEmployeeCommand':
          result = await HrWorkforceDomainService.createEmployee(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'UpdateEmployeeStatusCommand':
          result = await HrWorkforceDomainService.updateEmployeeStatus(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'TransferEmployeeCommand':
          result = await HrWorkforceDomainService.transferEmployee(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SubmitCredentialCommand':
          result = await HrWorkforceDomainService.submitCredential(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'VerifyCredentialCommand':
          result = await HrWorkforceDomainService.verifyCredential(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'GrantClinicalPrivilegeCommand':
          result = await HrWorkforceDomainService.grantClinicalPrivilege(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ChangeClinicalPrivilegeStatusCommand':
          result = await HrWorkforceDomainService.changeClinicalPrivilegeStatus(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'AssignShiftCommand':
          result = await HrWorkforceDomainService.assignShift(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CancelShiftCommand':
          result = await HrWorkforceDomainService.cancelShift(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ExecuteRosterSwapCommand':
          result = await HrWorkforceDomainService.executeRosterSwap(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordClockInCommand':
          result = await HrWorkforceDomainService.recordClockIn(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordClockOutCommand':
          result = await HrWorkforceDomainService.recordClockOut(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CorrectAttendanceTimeCommand':
          result = await HrWorkforceDomainService.correctAttendanceTime(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'SubmitLeaveRequestCommand':
          result = await HrWorkforceDomainService.submitLeaveRequest(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ApproveLeaveRequestCommand':
          result = await HrWorkforceDomainService.approveLeaveRequest(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        // --- Resource Management Domain ---
        case 'RegisterResourceCommand':
          result = await ResourceCapacityDomainService.registerResource(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RegisterRoomCommand':
          result = await ResourceCapacityDomainService.registerRoom(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RegisterBedCommand':
          result = await ResourceCapacityDomainService.registerBed(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'ReserveResourceCommand':
          result = await ResourceCapacityDomainService.reserveResource(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'TransferResourceCommand':
          result = await ResourceCapacityDomainService.transferResource(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CreateMaintenanceWorkOrderCommand':
          result = await ResourceCapacityDomainService.createWorkOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'CompleteMaintenanceWorkOrderCommand':
          result = await ResourceCapacityDomainService.completeWorkOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'RecordCalibrationCommand':
          result = await ResourceCapacityDomainService.recordCalibration(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        default:
          result = {
            success: false,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            error: {
              code: 'UNKNOWN_COMMAND_TYPE',
              message: `Command type '${command.commandType}' is not registered in the Master Command Bus.`,
            },
          };
      }

      // Enrich the durable idempotency record with the exact command result.
      // Successful domain services have already atomically committed state + event +
      // audit + outbox + a replay-safe idempotency result. If this enrichment write
      // fails after that commit, the command itself must still be reported as committed.
      try {
        await IdempotencyService.completeExecution(
          context.tenantId,
          command.idempotencyKey,
          command.commandType,
          command.payload,
          result
        );
      } catch {
        emitOperationalEvent({
          event: 'command.idempotency_result_enrichment',
          outcome: 'FAILURE',
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          durationMs: elapsed(),
          errorCode: 'IDEMPOTENCY_RESULT_ENRICHMENT_FAILED',
          attributes: { commandType: command.commandType },
        });
      }

      emit(
        result.success ? 'SUCCESS' : 'REJECTED',
        result.success ? undefined : result.error?.code
      );
      return result;
    } catch (err) {
      emit('FAILURE', 'COMMAND_EXECUTION_FAILURE');
      return {
        success: false,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        error: {
          code: 'COMMAND_EXECUTION_FAILURE',
          message: err instanceof Error ? err.message : 'Unknown fatal backend error',
        },
      };
    }
  }
}
