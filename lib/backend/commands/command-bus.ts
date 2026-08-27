/**
 * G-HIMS Master Command Bus & Router
 * Central dispatch router for all domain commands across Clinical, ERP, HCM, and Diagnostic engines.
 */

import { BaseCommand, CommandContext, CommandResult } from '../types';
import { EncounterDomainService } from '../services/encounter-domain-service';
import { ClinicalOrderDomainService } from '../services/clinical-order-domain-service';
import { FinancialLedgerDomainService } from '../services/financial-ledger-domain-service';
import { HcmPrivilegeDomainService } from '../services/hcm-privilege-domain-service';

export class CommandBus {
  /**
   * Routes and executes a domain command through the authoritative backend pipeline.
   */
  public static async dispatch(
    context: CommandContext,
    command: BaseCommand
  ): Promise<CommandResult> {
    try {
      switch (command.commandType) {
        // --- Clinical Domain ---
        case 'CreateEncounterCommand':
          return await EncounterDomainService.createEncounter(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        case 'AdvanceStageCommand':
          return await EncounterDomainService.advanceStage(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        case 'PlaceDiagnosticOrderCommand':
          return await ClinicalOrderDomainService.placeDiagnosticOrder(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        case 'PrescribeMedicationCommand':
          return await ClinicalOrderDomainService.prescribeMedication(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        // --- Finance Domain ---
        case 'PostJournalCommand':
          return await FinancialLedgerDomainService.postUniversalJournal(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        // --- HCM Domain ---
        case 'VerifyCredentialCommand':
          return await HcmPrivilegeDomainService.verifyCredential(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        case 'GrantClinicalPrivilegeCommand':
          return await HcmPrivilegeDomainService.grantClinicalPrivilege(
            context,
            command.commandId,
            command.idempotencyKey,
            command.payload as any
          );

        default:
          return {
            success: false,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            error: {
              code: 'UNKNOWN_COMMAND_TYPE',
              message: `Command type '${command.commandType}' is not registered in the Master Command Bus.`,
            },
          };
      }
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
