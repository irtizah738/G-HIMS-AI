/**
 * G-HIMS Clinical Safety, Financial Integrity & Interoperability Test Suite
 * Validates clinical stage workflows, financial double-entry invariance, and standards adapters.
 */

import { beforeEach, describe, test, expect } from 'bun:test';
import { CommandBus } from '../lib/backend/commands/command-bus';
import { CommandContext, BaseCommand } from '../lib/backend/types';
import { parseHL7, extractORU_R01, generateACK } from '../lib/interop/hl7-parser';
import { DeviceTelemetryAdapter, RawTelemetryPacket } from '../lib/interop/device-telemetry-adapter';
import { RadioIntercomAdapter } from '../lib/interop/radio-intercom-adapter';
import { ReconciliationDomainService } from '../lib/backend/services/reconciliation-domain-service';
import { financePeriodId, validateGovernedJournal } from '../lib/finance/finance-engine';
import { TransactionManager } from '../lib/backend/transactions/transaction-manager';

describe('G-HIMS Clinical Safety, Financial & Interoperability Engine', () => {
  const tenantId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

  const doctorContext: CommandContext = {
    actorId: 'doc_sarah_connor',
    tenantId,
    roles: ['DOCTOR'],
    permissions: ['CLINICAL_WRITE', 'PATIENT_READ'],
    clinicalPrivileges: ['PRESCRIBE', 'ORDER_LAB', 'ORDER_RADIOLOGY'],
    correlationId: 'corr_doc_sarah',
    requestId: 'req_doc_sarah',
  };

  const accountantContext: CommandContext = {
    actorId: 'act_john_nash',
    tenantId,
    roles: ['ACCOUNTANT', 'FINANCE_MANAGER'],
    permissions: ['GL_POST', 'JOURNAL_READ'],
    correlationId: 'corr_act_john',
    requestId: 'req_act_john',
  };

  beforeEach(() => {
    for (const patientId of ['pat_cardiac_arrest_99', 'pat_trauma_victim']) {
      TransactionManager.seedEphemeralStateForTesting(
        tenantId,
        'PATIENT_MPI',
        patientId,
        {
          id: patientId,
          tenantId,
          mrn: `MRN-${patientId}`,
          fullName: 'Synthetic Security Qualification Patient',
          tariffPlan: 'OUT_OF_POCKET',
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      );
    }

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'BILLING_SERVICE_CATALOG',
      'LAB-STAT-TROP',
      {
        id: 'LAB-STAT-TROP',
        serviceCode: 'LAB-STAT-TROP',
        description: 'STAT High Sensitivity Troponin I',
        orderType: 'LAB',
        category: 'laboratory',
        status: 'ACTIVE',
        currency: 'USD',
        unitPriceMinorUnits: 4500,
        taxRateBasisPoints: 0,
        revenueAccountCode: '402100',
        deferredRevenueAccountCode: '205000',
        specimenType: 'Serum',
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'TARIFF',
      'tariff-standard-cash',
      {
        id: 'tariff-standard-cash',
        name: 'Standard cash tariff',
        status: 'active',
        planName: 'cash',
        copayPercent: 100,
        defaultDiscountPercent: 0,
      }
    );

    for (const account of [
      {
        accountCode: '1110',
        accountName: 'Patient Accounts Receivable',
        category: 'asset',
      },
      {
        accountCode: '205000',
        accountName: 'Deferred Diagnostic Revenue',
        category: 'liability',
      },
      {
        accountCode: '402100',
        accountName: 'Diagnostic Service Revenue',
        category: 'revenue',
      },
    ]) {
      TransactionManager.seedEphemeralStateForTesting(
        tenantId,
        'GL_ACCOUNT',
        account.accountCode,
        {
          ...account,
          currency: 'USD',
          isActive: true,
        }
      );
    }

    const now = new Date();
    const periodId = financePeriodId(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'FINANCE_PERIOD',
      periodId,
      {
        periodId,
        periodKey: periodId,
        status: 'OPEN',
      }
    );
  });

  describe('1. Clinical Safety & Governed Stage Workflow', () => {
    test('Creates emergency triage encounter and advances through governed clinical stage', async () => {
      // 1. Create Encounter
      const createCmd: BaseCommand = {
        commandId: 'cmd_enc_triage_01',
        idempotencyKey: 'idemp_enc_triage_01',
        tenantId,
        commandType: 'CreateEncounterCommand',
        schemaVersion: 1,
        payload: {
          patientId: 'pat_cardiac_arrest_99',
          encounterType: 'EMERGENCY',
          chiefComplaint: 'Sudden collapse, unresponsive, pulseless',
          departmentId: 'dept_emergency',
          priority: 'STAT',
        },
      };

      const encResult = await CommandBus.dispatch(doctorContext, createCmd);
      expect(encResult.success).toBe(true);
      expect(encResult.entityId).toBeDefined();
      const encounterId = encResult.entityId!;

      // 2. Advance to RESUSCITATION stage
      const advanceCmd: BaseCommand = {
        commandId: 'cmd_enc_adv_01',
        idempotencyKey: 'idemp_enc_adv_01',
        tenantId,
        commandType: 'AdvanceStageCommand',
        schemaVersion: 1,
        payload: {
          encounterId,
          currentStage: 'TRIAGE',
          targetStage: 'RESUSCITATION',
          evidenceId: 'ev_ecg_asystole_01',
          stageNotes: 'Patient moved to trauma bay 1 for active CPR',
          handoffSbar: {
            situation: 'Cardiac arrest in transit',
            background: 'Hypertensive, CAD history',
            assessment: 'PEA arrest, CPR ongoing',
            recommendation: 'Epinephrine 1mg IV and intubation',
          },
        },
      };

      const advResult = await CommandBus.dispatch(doctorContext, advanceCmd);
      expect(advResult.success).toBe(true);
      expect(advResult.data).toBeDefined();
    });

    test('STAT emergency lab orders automatically bypass routine payment locks for patient life safety', async () => {
      const encounterResult = await CommandBus.dispatch(doctorContext, {
        commandId: 'cmd_enc_stat_order_01',
        idempotencyKey: 'idemp_enc_stat_order_01',
        tenantId,
        commandType: 'CreateEncounterCommand',
        schemaVersion: 1,
        payload: {
          patientId: 'pat_trauma_victim',
          encounterType: 'EMERGENCY',
          chiefComplaint: 'Suspected acute transmural myocardial infarction',
          departmentId: 'dept_emergency',
          priority: 'STAT',
        },
      });
      expect(encounterResult.success).toBe(true);
      expect(encounterResult.entityId).toBeDefined();

      const statOrderCmd: BaseCommand = {
        commandId: 'cmd_ord_stat_01',
        idempotencyKey: 'idemp_ord_stat_01',
        tenantId,
        commandType: 'PlaceDiagnosticOrderCommand',
        schemaVersion: 1,
        payload: {
          encounterId: encounterResult.entityId!,
          patientId: 'pat_trauma_victim',
          orderType: 'LAB',
          catalogCode: 'LAB-STAT-TROP',
          priority: 'STAT',
          clinicalIndication: 'Suspected acute transmural myocardial infarction',
          statOverrideReason:
            'Immediate troponin execution is required for a time-critical suspected myocardial infarction.',
        },
      };

      const result = await CommandBus.dispatch(doctorContext, statOrderCmd);
      expect(result.success).toBe(true);
      const order = (result.data as any)?.order;
      expect(order?.revenueLockStatus).toBe('UNLOCKED_STAT_OVERRIDE');
      expect(order?.worklistStatus).toBe('READY_FOR_EXECUTION');
      expect((result.data as any)?.invoice?.paymentStatus).toBe('pending');
    });
  });

  describe('2. Universal Financial Journal & Double-Entry Invariance', () => {
    const governedAccounts = [
      {
        accountCode: '101000',
        accountName: 'Operating Cash',
        category: 'asset',
        subCategory: 'cash',
        normalBalance: 'debit',
        currency: 'USD',
        allowManualPosting: true,
        isActive: true,
      },
      {
        accountCode: '402000',
        accountName: 'Pharmacy Inpatient Revenue',
        category: 'revenue',
        subCategory: 'patient_revenue',
        normalBalance: 'credit',
        currency: 'USD',
        allowManualPosting: true,
        isActive: true,
      },
    ] as any;

    test('Balanced General Ledger journal entry (Debits == Credits) posts successfully', () => {
      expect(() => validateGovernedJournal({
        currency: 'USD',
        accounts: governedAccounts,
        lines: [
          {
            glAccountId: '101000',
            glAccountName: 'Operating Cash',
            debitMinorUnits: 15400,
            creditMinorUnits: 0,
            lineDescription: 'Cash Received',
          },
          {
            glAccountId: '402000',
            glAccountName: 'Pharmacy Inpatient Revenue',
            debitMinorUnits: 0,
            creditMinorUnits: 15400,
            lineDescription: 'Medication Revenue',
          },
        ],
      })).not.toThrow();
    });

    test('Unbalanced journal entry (Debits !== Credits) is strictly rejected', () => {
      expect(() => validateGovernedJournal({
        currency: 'USD',
        accounts: governedAccounts,
        lines: [
          {
            glAccountId: '101000',
            glAccountName: 'Cash',
            debitMinorUnits: 20000,
            creditMinorUnits: 0,
            lineDescription: 'Debit $200',
          },
          {
            glAccountId: '402000',
            glAccountName: 'Revenue',
            debitMinorUnits: 0,
            creditMinorUnits: 18000,
            lineDescription: 'Credit $180',
          },
        ],
      })).toThrow('UNBALANCED_JOURNAL_POSTING');
    });
  });

  describe('3. HL7 v2.x Standards & Framing Processor', () => {
    test('Parses raw HL7 ORU^R01 lab results message and generates standard ACK', () => {
      const rawHL7 = [
        'MSH|^~\\&|LIS_ROCHE|CENTRAL_LAB|GHIMS|METRO_HOSPITAL|20260917120000||ORU^R01|MSG_LAB_84920|P|2.3.1',
        'PID|1||MRN-784920||DOE^JOHN^A||19800515|M',
        'OBR|1|ORD_9910|FIL_84920|CBC^Complete Blood Count|||20260917114500',
        'OBX|1|NM|WBC^White Blood Cell Count|1|12.5|10*3/uL|4.5-11.0|H|||F',
        'OBX|2|NM|HGB^Hemoglobin|1|14.2|g/dL|13.5-17.5|N|||F',
        'OBX|3|NM|PLT^Platelets|1|240|10*3/uL|150-450|N|||F',
      ].join('\r') + '\r';

      const parsed = parseHL7(rawHL7);
      const oru = extractORU_R01(parsed);
      expect(oru.patientMrn).toBe('MRN-784920');
      expect(oru.patientName).toBe('JOHN DOE');
      expect(oru.results.length).toBe(3);

      const wbc = oru.results.find((r) => r.testCode === 'WBC');
      expect(wbc).toBeDefined();
      expect(wbc?.resultValue).toBe('12.5');
      expect(wbc?.abnormalFlags).toBe('H');

      const ack = generateACK(parsed, 'AA', 'ORU Accepted and Stored');
      expect(ack).toContain('MSA|AA|MSG_LAB_84920|ORU Accepted and Stored');
    });
  });

  describe('4. External Device Telemetry Adapter', () => {
    test('Blocks production telemetry until physical integration certification is complete', async () => {
      const stalePacket: RawTelemetryPacket = {
        deviceId: 'ALS-MONITOR-01',
        deviceType: 'ALS_MONITOR_DEFIBRILLATOR',
        deviceModel: 'ZOLL X Series Advanced',
        firmwareVersion: '3.12.0',
        packetSequenceNumber: 101,
        deviceTimestamp: Date.now() - 45000, // 45 seconds old!
        patientBinding: { mrn: 'MRN-998822', encounterId: 'enc_amb_01' },
        metrics: { heartRateBpm: 88, spo2Percent: 98, respiratoryRate: 16 },
      };

      const res = await DeviceTelemetryAdapter.ingestPacket(doctorContext, stalePacket, 'PRODUCTION_MODE');
      expect(res.success).toBe(false);
      expect(['TELEMETRY_LIVE_VALIDATION_INCOMPLETE', 'TELEMETRY_INTEGRATION_NOT_LIVE']).toContain(res.error?.code);
    });

    test('Does not interpret or persist a valid packet through the uncertified production path', async () => {
      const validPacket: RawTelemetryPacket = {
        deviceId: 'ALS-MONITOR-02',
        deviceType: 'ALS_MONITOR_DEFIBRILLATOR',
        deviceModel: 'ZOLL X Series Advanced',
        firmwareVersion: '3.12.0',
        packetSequenceNumber: 1,
        deviceTimestamp: Date.now() - 500, // 500ms fresh!
        patientBinding: { mrn: 'MRN-773311', encounterId: 'enc_amb_02' },
        metrics: {
          heartRateBpm: 142,
          spo2Percent: 94,
          respiratoryRate: 28,
          nibpSystolicMmHg: 90,
          nibpDiastolicMmHg: 55,
          etco2MmHg: 32,
        },
        ecgWaveform: {
          lead: 'II',
          sampleRateHz: 500,
          scaleMvPerMm: 10,
          samples: [0.1, 0.2, 0.5, 2.1, 1.9, 0.3, 0.1], // Elevated J-point (ST elevation)
        },
      };

      const res = await DeviceTelemetryAdapter.ingestPacket(doctorContext, validPacket, 'PRODUCTION_MODE');
      expect(res.success).toBe(false);
      expect(['TELEMETRY_LIVE_VALIDATION_INCOMPLETE', 'TELEMETRY_INTEGRATION_NOT_LIVE']).toContain(res.error?.code);
    });
  });

  describe('5. Pre-Hospital Radio & Verbal Medical Order Gating', () => {
    test('Rejects verbal medical order transmission without paramedic readback confirmation', async () => {
      const orderWithoutReadback = {
        channel: 'HEAR_RADIO' as const,
        direction: 'OUTBOUND_TO_AMBULANCE' as const,
        sender: {
          unitId: 'BASE_STATION_ER',
          callsign: 'Metro Base ER',
          operatorRole: 'ATTENDING_PHYSICIAN' as const,
          operatorName: 'Dr. Sarah Connor',
        },
        recipient: {
          stationId: 'MEDIC_UNIT_7',
          operatorRole: 'PARAMEDIC',
          operatorName: 'Paramedic Jane Doe',
        },
        patientBinding: { mrn: 'MRN-554433' },
        contentSummary: 'Verbal order for Amiodarone administration',
        verbalMedicalOrder: {
          orderType: 'MEDICATION_ADMINISTRATION' as const,
          details: 'Amiodarone 150mg IV push over 10 minutes',
          authorizingPhysicianId: 'doc_sarah_connor',
          authorizingPhysicianName: 'Dr. Sarah Connor',
          readbackConfirmed: false, // Readback NOT confirmed!
          acknowledgedAt: '',
        },
        audioDurationSeconds: 14,
      };

      const res = await RadioIntercomAdapter.logTransmission(doctorContext, orderWithoutReadback);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('READBACK_CONFIRMATION_REQUIRED');
    });

    test('Accepts verbal order with closed-loop readback and logs immutable audit record', async () => {
      const confirmedOrder = {
        channel: 'HEAR_RADIO' as const,
        direction: 'OUTBOUND_TO_AMBULANCE' as const,
        sender: {
          unitId: 'BASE_STATION_ER',
          callsign: 'Metro Base ER',
          operatorRole: 'ATTENDING_PHYSICIAN' as const,
          operatorName: 'Dr. Sarah Connor',
        },
        recipient: {
          stationId: 'MEDIC_UNIT_7',
          operatorRole: 'PARAMEDIC',
          operatorName: 'Paramedic Jane Doe',
        },
        patientBinding: { mrn: 'MRN-554433' },
        contentSummary: 'Verbal order for Amiodarone administration',
        verbalMedicalOrder: {
          orderType: 'MEDICATION_ADMINISTRATION' as const,
          details: 'Amiodarone 150mg IV push over 10 minutes',
          authorizingPhysicianId: 'doc_sarah_connor',
          authorizingPhysicianName: 'Dr. Sarah Connor',
          readbackConfirmed: true, // Readback confirmed!
          acknowledgedAt: new Date().toISOString(),
        },
        audioDurationSeconds: 22,
      };

      const res = await RadioIntercomAdapter.logTransmission(doctorContext, confirmedOrder);
      expect(res.success).toBe(true);
      expect(res.transmission?.transmissionId).toBeDefined();
    });
  });

  describe('6. Reconciliation Engine (Cross-Domain Integrity)', () => {
    test('Detects inpatient bed projection status discrepancy against immutable event stream', async () => {
      const bedId = 'bed_icu_04';
      // Projected state says AVAILABLE, but event stream has BED_OCCUPIED
      const currentBedState = { status: 'AVAILABLE', patientId: undefined };
      const eventHistory = [
        {
          eventId: 'ev_bed_occ_01',
          tenantId,
          aggregateType: 'BED',
          aggregateId: bedId,
          eventType: 'BED_OCCUPIED',
          eventVersion: 1,
          payload: { bedId, patientId: 'pat_icu_patient_10' },
          actorId: 'nurse_icu_01',
          actorRole: 'NURSE',
          occurredAt: Date.now() - 10000,
          recordedAt: Date.now() - 10000,
          correlationId: 'corr_bed',
          commandId: 'cmd_bed',
          idempotencyKey: 'idemp_bed',
          source: 'web' as const,
          schemaVersion: 1,
        },
      ];

      const issue = await ReconciliationDomainService.reconcileBedEvents(
        doctorContext,
        bedId,
        currentBedState,
        eventHistory
      );

      expect(issue).not.toBeNull();
      expect(issue?.domain).toBe('BED_CENSUS');
      expect(issue?.severity).toBe('HIGH');
      expect(issue?.status).toBe('OPEN');
    });

    test('Detects financial journal debits/credits imbalance across multiple vouchers', async () => {
      const journalVouchers = [
        {
          journalId: 'je_aud_01',
          lines: [
            { debit: 1000, credit: 0, accountId: '101' },
            { debit: 0, credit: 1000, accountId: '401' },
          ], // Balanced
        },
        {
          journalId: 'je_aud_02',
          lines: [
            { debit: 5000, credit: 0, accountId: '101' },
            { debit: 0, credit: 4500, accountId: '401' }, // Imbalance of 500!
          ],
        },
      ];

      const issues = await ReconciliationDomainService.reconcileFinancialLedger(accountantContext, journalVouchers);
      expect(issues.length).toBe(1);
      expect(issues[0].entityId).toBe('je_aud_02');
      expect(issues[0].severity).toBe('FINANCIAL_IMBALANCE');
    });
  });
});
