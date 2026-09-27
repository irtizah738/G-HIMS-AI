/**
 * G-HIMS Master Command Bus & Router
 * Central dispatch router for all domain commands across Clinical, ERP, HCM, and Diagnostic engines.
 */

import { BaseCommand, CommandContext, CommandResult } from '../types';
import { EncounterDomainService } from '../services/encounter-domain-service';
import { ClinicalOrderDomainService } from '../services/clinical-order-domain-service';
import { ClinicalDocumentationDomainService } from '../services/clinical-documentation-domain-service';
import { FinancialLedgerDomainService } from '../services/financial-ledger-domain-service';
import { HcmPrivilegeDomainService } from '../services/hcm-privilege-domain-service';
import { HrWorkforceDomainService } from '../services/hr-workforce-domain-service';
import { ResourceCapacityDomainService } from '../services/resource-capacity-domain-service';
import { PatientIdentityDomainService } from '../services/patient-identity-domain-service';
import { IdempotencyService } from '../idempotency/idempotency-service';

export class CommandBus {
  /**
   * Routes and executes a domain command through the authoritative backend pipeline.
   * Enforces zero-duplicate idempotency checking, state-machine validation, and audit recording.
   */
  public static async dispatch(
    context: CommandContext,
    command: BaseCommand
  ): Promise<CommandResult> {
    try {
      // 1. Durable zero-duplicate idempotency reservation.
      const idempotencyCheck = await IdempotencyService.acquireExecution(
        context.tenantId,
        command.idempotencyKey,
        command.commandType,
        command.payload,
        command.commandId
      );

      if (idempotencyCheck.status === 'CACHED' && idempotencyCheck.record?.result) {
        return {
          ...idempotencyCheck.record.result,
          replayedFromCache: true,
        };
      }

      if (idempotencyCheck.status === 'IN_PROGRESS') {
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

        case 'AdvanceStageCommand':
          result = await EncounterDomainService.advanceStage(
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

        case 'PrescribeMedicationCommand':
          result = await ClinicalOrderDomainService.prescribeMedication(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
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

        // --- Patient Identity & Safety Domain ---
        case 'RegisterPatientCommand':
          result = await PatientIdentityDomainService.registerPatient(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );
          break;

        case 'MergePatientCommand':
          result = await PatientIdentityDomainService.mergePatients(
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
        case 'PostJournalCommand':
          result = await FinancialLedgerDomainService.postUniversalJournal(
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

        case 'AssignShiftCommand':
          result = await HrWorkforceDomainService.assignShift(
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

      // Finalize the durable idempotency record with the exact command result.
      await IdempotencyService.completeExecution(
        context.tenantId,
        command.idempotencyKey,
        command.commandType,
        command.payload,
        result
      );

      return result;
    } catch (err) {
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
