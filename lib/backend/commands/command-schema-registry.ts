import { z } from 'zod';
import type { BaseCommand } from '@/lib/backend/types';

const nonEmpty = z.string().trim().min(1);

const schemas: Record<string, Record<number, z.ZodType<Record<string, unknown>>>> = {
  // --------------------------------------------------------------------------
  // DRP-1: Clinical / identity / telehealth command perimeter.
  // Every CommandBus handler must have an explicit versioned schema.
  // --------------------------------------------------------------------------
  CreateEncounterCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterType: z.enum(['OPD','IPD','EMERGENCY','TELEHEALTH']),
      chiefComplaint: nonEmpty.max(4000),
      departmentId: nonEmpty.max(150),
      priority: z.enum(['STAT','URGENT','ROUTINE']).optional(),
    }).strict(),
  },
  CreateOpdEncounterCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      chiefComplaint: nonEmpty.max(4000),
      departmentId: nonEmpty.max(150),
      priority: z.enum(['STAT','URGENT','ROUTINE']).optional(),
      assignedDoctor: z.string().trim().min(1).max(200).optional(),
    }).strict(),
  },
  CommitEncounterDispositionCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      dispositionType: nonEmpty.max(100),
      patientInstructions: z.string().trim().max(8000).optional(),
      warningSignsRedFlags: z.string().trim().max(8000).optional(),
      followUpScheduledDate: z.string().trim().max(50).optional(),
      followUpDepartment: z.string().trim().max(250).optional(),
      inpatientAdmissionRequest: z.object({
        targetWard: nonEmpty.max(200),
        targetBedId: z.string().trim().min(1).max(150).optional(),
        clinicalIndication: nonEmpty.max(4000),
        admittingService: z.string().trim().max(250).optional(),
      }).strict().optional(),
    }).strict(),
  },
  PlaceDiagnosticOrderCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      orderType: z.enum(['LAB','RADIOLOGY','PROCEDURE']),
      catalogCode: nonEmpty.max(100),
      priority: z.enum(['STAT','URGENT','ROUTINE']),
      clinicalIndication: nonEmpty.max(4000),
      statOverrideReason: z.string().trim().min(10).max(4000).optional(),
    }).strict().superRefine((value, ctx) => {
      if (value.priority === 'STAT' && !value.statOverrideReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statOverrideReason'],
          message: 'STAT diagnostic orders require an emergency override reason.',
        });
      }
      if (value.priority !== 'STAT' && value.statOverrideReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statOverrideReason'],
          message: 'statOverrideReason is only valid for STAT diagnostic orders.',
        });
      }
    }),
  },
  AdvanceDiagnosticWorklistCommand: {
    1: z.object({
      orderId: nonEmpty.max(150),
      targetStatus: z.enum(['SPECIMEN_COLLECTED','IN_PROCESSING']),
    }).strict(),
  },
  DispensePrescriptionCommand: {
    1: z.object({
      prescriptionId: nonEmpty.max(150),
      quantityDispensed: z.number().finite().positive().max(1000000),
      batchNumber: z.string().trim().min(1).max(200).optional(),
      expiryDate: z.string().trim().min(1).max(50).optional(),
    }).strict(),
  },
  RecordDiagnosticResultCommand: {
    1: z.object({
      orderId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      encounterId: z.string().trim().min(1).max(150).optional(),
      reportCode: nonEmpty.max(150),
      reportDisplay: nonEmpty.max(500),
      category: z.enum(['LAB','RADIOLOGY','PATHOLOGY','OTHER']),
      results: z.array(z.object({
        code: nonEmpty.max(150),
        display: nonEmpty.max(500),
        codingSystem: z.string().trim().min(1).max(200).optional(),
        value: z.union([z.string().max(4000), z.number().finite()]),
        unit: z.string().trim().max(100).optional(),
        unitCode: z.string().trim().max(100).optional(),
        referenceRange: z.string().trim().max(500).optional(),
        abnormalFlag: z.string().trim().max(100).optional(),
        status: z.enum(['PRELIMINARY','FINAL','AMENDED','CORRECTED']).optional(),
        observedAt: z.number().finite().positive().optional(),
      }).strict()).min(1).max(500),
      reportStatus: z.enum(['PARTIAL','PRELIMINARY','FINAL','AMENDED','CORRECTED']).optional(),
      conclusion: z.string().trim().max(12000).optional(),
      issuedAt: z.number().finite().positive().optional(),
      verifiedBy: z.string().trim().min(1).max(150).optional(),
      verifiedAt: z.number().finite().positive().optional(),
      sourceType: z.enum(['LAB_SYSTEM','RADIOLOGY_SYSTEM','CLINICIAN','EXTERNAL_HL7']).optional(),
      sourceSystem: z.string().trim().min(1).max(250).optional(),
      sourceMessageControlId: z.string().trim().min(1).max(250).optional(),
    }).strict(),
  },
  AcknowledgeCriticalDiagnosticResultCommand: {
    1: z.object({
      reportId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      note: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  SignClinicalNoteCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      category: z.enum(['SOAP','PROGRESS','CONSULTATION','DISCHARGE','NURSING']),
      content: nonEmpty.max(50000),
      sourceDraftId: z.string().trim().min(1).max(200).optional(),
      acceptedStructuredData: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  },
  ReviewClinicalDraftCommand: {
    1: z.object({
      draftId: nonEmpty.max(200),
      expectedRevisionNumber: z.number().int().positive().max(10000),
      title: z.string().trim().min(1).max(1000).optional(),
      content: nonEmpty.max(100000),
      reviewNote: z.string().trim().max(8000).optional(),
    }).strict(),
  },
  ApproveClinicalDraftCommand: {
    1: z.object({
      draftId: nonEmpty.max(200),
      expectedRevisionNumber: z.number().int().positive().max(10000),
      approvalAttestation: z.literal(true),
    }).strict(),
  },
  SignClinicalDraftCommand: {
    1: z.object({
      draftId: nonEmpty.max(200),
      expectedRevisionNumber: z.number().int().positive().max(10000),
      signatureAttestation: z.literal(true),
    }).strict(),
  },
  RejectClinicalDraftCommand: {
    1: z.object({
      draftId: nonEmpty.max(200),
      expectedRevisionNumber: z.number().int().positive().max(10000),
      reason: nonEmpty.min(3).max(8000),
    }).strict(),
  },
  CompleteMedicationReconciliationCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      reconciledMedicationIds: z.array(nonEmpty.max(150)).max(1000),
      discrepancyCount: z.number().int().nonnegative().max(10000),
      unresolvedDiscrepancies: z.array(nonEmpty.max(2000)).max(1000).optional(),
      notes: z.string().trim().max(8000).optional(),
    }).strict(),
  },
  RecordClinicalConditionCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: z.string().trim().min(1).max(150).optional(),
      code: nonEmpty.max(150),
      display: nonEmpty.max(500),
      codingSystem: z.string().trim().min(1).max(200).optional(),
      category: z.enum(['PROBLEM_LIST','ENCOUNTER_DIAGNOSIS','CHRONIC','ACUTE','OTHER']),
      clinicalStatus: z.enum(['ACTIVE','INACTIVE','RESOLVED','COMPLETED','CANCELLED','ENTERED_IN_ERROR']).optional(),
      verificationStatus: z.enum(['UNCONFIRMED','PROVISIONAL','DIFFERENTIAL','CONFIRMED','REFUTED','ENTERED_IN_ERROR']).optional(),
      onsetAt: z.number().finite().positive().optional(),
    }).strict(),
  },
  RecordClinicalAllergyCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: z.string().trim().min(1).max(150).optional(),
      substanceCode: nonEmpty.max(150),
      substanceDisplay: nonEmpty.max(500),
      codingSystem: z.string().trim().min(1).max(200).optional(),
      type: z.enum(['ALLERGY','INTOLERANCE']).optional(),
      category: z.enum(['FOOD','MEDICATION','ENVIRONMENT','BIOLOGIC','OTHER']),
      criticality: z.enum(['LOW','HIGH','UNABLE_TO_ASSESS']).optional(),
      verificationStatus: z.enum(['UNCONFIRMED','PROVISIONAL','DIFFERENTIAL','CONFIRMED','REFUTED','ENTERED_IN_ERROR']).optional(),
      reactionText: z.string().trim().max(4000).optional(),
      reactionSeverity: z.enum(['MILD','MODERATE','SEVERE']).optional(),
    }).strict(),
  },
  ReviewPatientClinicalKnowledgeCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: z.string().trim().min(1).max(150).optional(),
      domain: z.enum(['ALLERGIES','MEDICATIONS','PROBLEM_LIST']),
      status: z.enum(['KNOWN','KNOWN_NONE','UNKNOWN','NOT_ASSESSED','PATIENT_UNABLE_TO_REPORT']),
      reason: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  RequestConsultationCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      requestedSpecialty: nonEmpty.max(250),
      requestedConsultantId: z.string().trim().min(1).max(150).optional(),
      clinicalQuestion: nonEmpty.max(8000),
      priority: z.enum(['ROUTINE','URGENT','STAT']).optional(),
      sourceRefs: z.array(nonEmpty.max(250)).max(100).optional(),
    }).strict(),
  },
  AcceptConsultationCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      consultationId: nonEmpty.max(150),
    }).strict(),
  },
  CompleteConsultationCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      consultationId: nonEmpty.max(150),
      assessment: nonEmpty.max(12000),
      recommendations: z.array(nonEmpty.max(4000)).max(100),
      followUpRequired: z.boolean().optional(),
      primaryTeamReviewRequired: z.boolean().optional(),
    }).strict(),
  },
  CreateClinicalHandoffCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      toClinicianId: z.string().trim().min(1).max(150).optional(),
      toDepartmentId: z.string().trim().min(1).max(150).optional(),
      toRole: z.string().trim().min(1).max(150).optional(),
      currentProblemSummary: nonEmpty.max(12000),
      activeRisks: z.array(nonEmpty.max(2000)).max(100).optional(),
      pendingDiagnostics: z.array(nonEmpty.max(2000)).max(100).optional(),
      pendingProcedures: z.array(nonEmpty.max(2000)).max(100).optional(),
      pendingConsultations: z.array(nonEmpty.max(2000)).max(100).optional(),
      medicationConcerns: z.array(nonEmpty.max(2000)).max(100).optional(),
      unresolvedItems: z.array(nonEmpty.max(2000)).max(200).optional(),
      expectedActions: z.array(nonEmpty.max(2000)).max(100).optional(),
    }).strict(),
  },
  AcceptClinicalHandoffCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      handoffId: nonEmpty.max(150),
    }).strict(),
  },
  AcknowledgeClinicalOpenItemCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      openItemId: nonEmpty.max(200),
      note: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  ResolveClinicalOpenItemCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      openItemId: nonEmpty.max(200),
      resolutionReason: nonEmpty.max(8000),
      resolutionRef: z.string().trim().min(1).max(250).optional(),
    }).strict(),
  },
  AcknowledgeClinicalEscalationCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      escalationId: nonEmpty.max(200),
      note: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  RecordConsultantPatientReviewCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      careSetting: z.enum(['OPD','IPD','EMERGENCY','TELEHEALTH']),
      patient360Revision: z.number().int().nonnegative(),
      patient360SourceCheckpoint: nonEmpty.max(500),
      reviewedChangeIds: z.array(nonEmpty.max(200)).max(500).optional(),
      note: z.string().trim().max(8000).optional(),
    }).strict(),
  },
  RecordDischargeReadinessReviewCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      evaluationId: nonEmpty.max(200),
      outcome: z.enum(['ACKNOWLEDGED','ESCALATE','PROCEED_WITH_WARNINGS']),
      reviewedFindingIds: z.array(nonEmpty.max(200)).max(500).optional(),
      reason: z.string().trim().max(8000).optional(),
    }).strict(),
  },
  UpdateOpdQueueStatusCommand: {
    1: z.object({
      tokenId: nonEmpty.max(150),
      targetStatus: z.enum(['called','in_consultation','completed','no_show','transferred']),
      targetDepartment: z.string().trim().min(1).max(250).optional(),
      assignedDoctorName: z.string().trim().min(1).max(250).optional(),
      assignedRoomOrBay: z.string().trim().min(1).max(200).optional(),
    }).strict(),
  },
  StartOpdServiceCommand: {
    1: z.object({
      tokenId: nonEmpty.max(150),
      assignedRoomOrBay: z.string().trim().min(1).max(200).optional(),
    }).strict(),
  },
  BookOpdAppointmentCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      providerEmployeeId: nonEmpty.max(150),
      facilityId: nonEmpty.max(150),
      departmentId: nonEmpty.max(150),
      appointmentType: z.enum([
        'NEW_CONSULTATION',
        'FOLLOW_UP',
        'ROUTINE_REVIEW',
        'OUTPATIENT_PROCEDURE',
        'EXECUTIVE_HEALTH_CHECK',
        'SPECIALIST_CONSULTATION',
        'TELECONSULTATION',
        'POST_DISCHARGE_REVIEW',
      ]),
      scheduledStartAt: z.number().int().safe().positive(),
      durationMinutes: z.number().int().min(10).max(120),
      timeZone: nonEmpty.max(100),
      chiefComplaint: nonEmpty.max(4000),
      bookingChannel: z.enum([
        'FRONT_DESK',
        'PATIENT_PORTAL',
        'CALL_CENTER',
        'PHYSICIAN_REFERRAL',
        'ONLINE_PORTAL',
      ]),
    }).strict(),
  },
  CancelOpdAppointmentCommand: {
    1: z.object({
      appointmentId: nonEmpty.max(150),
      reason: nonEmpty.max(4000),
    }).strict(),
  },
  RescheduleOpdAppointmentCommand: {
    1: z.object({
      appointmentId: nonEmpty.max(150),
      scheduledStartAt: z.number().int().safe().positive(),
      durationMinutes: z.number().int().min(10).max(120),
      timeZone: nonEmpty.max(100),
      reason: nonEmpty.max(4000),
    }).strict(),
  },
  CheckInOpdAppointmentCommand: {
    1: z.object({
      appointmentId: nonEmpty.max(150),
    }).strict(),
  },
  MarkOpdAppointmentNoShowCommand: {
    1: z.object({
      appointmentId: nonEmpty.max(150),
      reason: nonEmpty.max(4000),
    }).strict(),
  },
  AddOpdWaitlistEntryCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      facilityId: nonEmpty.max(150),
      preferredDepartmentId: nonEmpty.max(150),
      preferredProviderEmployeeId: z.string().trim().min(1).max(150).optional(),
      priority: z.enum(['LOW', 'NORMAL', 'URGENT', 'CRITICAL']),
      notificationPreference: z.enum(['SMS', 'WHATSAPP', 'PHONE', 'EMAIL']),
      notes: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  OfferOpdWaitlistSlotCommand: {
    1: z.object({
      waitlistId: nonEmpty.max(150),
      providerEmployeeId: nonEmpty.max(150),
      scheduledStartAt: z.number().int().safe().positive(),
      durationMinutes: z.number().int().min(10).max(120),
      timeZone: nonEmpty.max(100),
      offerTtlMinutes: z.number().int().min(5).max(120).optional(),
    }).strict(),
  },
  AcceptOpdWaitlistOfferCommand: {
    1: z.object({
      waitlistId: nonEmpty.max(150),
      appointmentType: z.enum([
        'NEW_CONSULTATION',
        'FOLLOW_UP',
        'ROUTINE_REVIEW',
        'OUTPATIENT_PROCEDURE',
        'EXECUTIVE_HEALTH_CHECK',
        'SPECIALIST_CONSULTATION',
        'TELECONSULTATION',
        'POST_DISCHARGE_REVIEW',
      ]),
      chiefComplaint: nonEmpty.max(4000),
      bookingChannel: z.enum([
        'FRONT_DESK',
        'PATIENT_PORTAL',
        'CALL_CENTER',
        'PHYSICIAN_REFERRAL',
        'ONLINE_PORTAL',
      ]).optional(),
    }).strict(),
  },
  CancelOpdWaitlistEntryCommand: {
    1: z.object({
      waitlistId: nonEmpty.max(150),
      reason: nonEmpty.max(4000),
    }).strict(),
  },
  CreateOpdConsultationInvoiceCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
    }).strict(),
  },
  AdmitPatientToInpatientCareCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      bedId: nonEmpty.max(150),
      sourceEncounterId: z.string().trim().min(1).max(150).optional(),
      admittingDiagnosis: nonEmpty.max(4000),
      targetWard: z.string().trim().min(1).max(250).optional(),
      assignedDoctor: z.string().trim().min(1).max(250).optional(),
      assignedNurse: z.string().trim().min(1).max(250).optional(),
      priority: z.enum(['STAT','URGENT','ROUTINE']).optional(),
    }).strict(),
  },
  PlaceInpatientOrderCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      orderType: z.enum(['DIET','ACTIVITY','MEDICATION','LAB','IMAGING','NURSING']),
      description: nonEmpty.max(8000),
      priority: z.enum(['ROUTINE','URGENT','STAT']).optional(),
    }).strict(),
  },
  ResolveInpatientOrderCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      orderId: nonEmpty.max(150),
      status: z.enum(['COMPLETED','DISCONTINUED']),
      reason: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  RecordMedicationAdministrationCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      patientId: nonEmpty.max(150),
      medicationId: nonEmpty.max(150),
      medicationName: nonEmpty.max(500),
      dose: nonEmpty.max(200),
      route: nonEmpty.max(200),
      status: z.enum(['GIVEN','HELD']).optional(),
      administeredAt: z.number().finite().positive().optional(),
      notes: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  TransferInpatientBedCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      sourceBedId: nonEmpty.max(150),
      targetBedId: nonEmpty.max(150),
      reason: nonEmpty.max(4000),
      clinicalIndication: z.string().trim().max(4000).optional(),
    }).strict(),
  },
  ScheduleSurgicalCaseCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      roomId: nonEmpty.max(150),
      scheduledStartTime: nonEmpty.max(100),
      scheduledEndTime: nonEmpty.max(100),
      procedureName: nonEmpty.max(1000),
      urgency: z.enum(['elective','urgent','emergency']),
      anesthesiaType: z.enum(['general','regional','local','mac','sedation']).optional(),
      surgeonEmployeeId: z.string().trim().min(1).max(150).optional(),
      notes: z.string().trim().max(8000).optional(),
    }).strict(),
  },
  RecordSurgicalSafetyChecklistCommand: {
    1: z.object({
      caseId: nonEmpty.max(150),
      phase: z.enum(['SIGN_IN','TIME_OUT','SIGN_OUT']),
      completed: z.boolean(),
      evidenceSummary: nonEmpty.max(8000),
    }).strict(),
  },
  AdvanceSurgicalCaseCommand: {
    1: z.object({
      caseId: nonEmpty.max(150),
      targetStatus: z.enum(['pre_op','intra_op','post_op_pacu','completed']),
    }).strict(),
  },
  CancelSurgicalCaseCommand: {
    1: z.object({
      caseId: nonEmpty.max(150),
      reason: nonEmpty.max(8000),
    }).strict(),
  },

  CreateTelehealthSessionCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      type: z.enum([
        'Telehealth Consultation',
        'Remote Post-Op Follow-up',
        'RPM Chronic Care Review',
        'Urgent Tele-Triage',
      ]),
      scheduledTime: z.string().trim().min(1).max(100).optional(),
      chiefComplaint: nonEmpty.max(4000),
      attendingPhysician: z.string().trim().max(250).optional(),
    }).strict(),
  },
  UpdateTelehealthSessionCommand: {
    1: z.object({
      sessionId: nonEmpty.max(150),
      updates: z.object({
        status: z.enum(['WAITING_ROOM','IN_CONSULTATION','DOCUMENTING','COMPLETED','CANCELLED']).optional(),
        connectionQuality: z.enum(['EXCELLENT','GOOD','DEGRADED']).optional(),
        callDurationSeconds: z.number().int().nonnegative().max(86400).optional(),
        vitals: z.object({
          bp: z.string().max(50),
          hr: z.number().finite().min(0).max(300),
          spo2: z.number().finite().min(0).max(100),
          temp: z.number().finite().min(20).max(50),
          glucose: z.number().finite().min(0).max(2000).optional(),
          respiratoryRate: z.number().finite().min(0).max(100).optional(),
          rhythm: z.string().max(200).optional(),
          connectedDevice: z.string().max(250).optional(),
          lastSync: z.string().max(100).optional(),
        }).strict().optional(),
        transcription: z.array(z.object({
          id: nonEmpty.max(150),
          timestamp: nonEmpty.max(100),
          speaker: z.enum(['DOCTOR','PATIENT','SYSTEM']),
          text: nonEmpty.max(12000),
        }).strict()).max(5000).optional(),
        soapNote: z.object({
          subjective: z.string().max(20000),
          objective: z.string().max(20000),
          assessment: z.string().max(20000),
          plan: z.string().max(20000),
          icd10Codes: z.array(z.object({
            code: nonEmpty.max(50),
            description: nonEmpty.max(500),
            confidence: z.number().finite().min(0).max(1).optional(),
          }).strict()).max(200).optional(),
          cptCodes: z.array(z.object({
            code: nonEmpty.max(50),
            description: nonEmpty.max(500),
            fee: z.number().finite().nonnegative().optional(),
          }).strict()).max(200).optional(),
          signedAt: z.string().max(100).optional(),
          signedBy: z.string().max(250).optional(),
          clinicianNpi: z.string().max(100).optional(),
        }).strict().optional(),
        isAudioMuted: z.boolean().optional(),
        isVideoMuted: z.boolean().optional(),
        isRecording: z.boolean().optional(),
      }).strict().refine((value)=>Object.keys(value).length>0,'At least one telehealth field must be updated.'),
    }).strict(),
  },
  CompleteTelehealthSessionCommand: {
    1: z.object({
      sessionId: nonEmpty.max(150),
      soapNote: z.object({
        subjective: z.string().max(20000).optional(),
        objective: z.string().max(20000).optional(),
        assessment: z.string().max(20000).optional(),
        plan: z.string().max(20000).optional(),
        icd10Codes: z.array(z.object({
          code: nonEmpty.max(50),
          description: nonEmpty.max(500),
          confidence: z.number().finite().min(0).max(1).optional(),
        }).strict()).max(200).optional(),
        cptCodes: z.array(z.object({
          code: nonEmpty.max(50),
          description: nonEmpty.max(500),
          fee: z.number().finite().nonnegative().optional(),
        }).strict()).max(200).optional(),
        signedAt: z.string().max(100).optional(),
        signedBy: z.string().max(250).optional(),
        clinicianNpi: z.string().max(100).optional(),
      }).strict().optional(),
      prescriptions: z.array(z.object({
        id: nonEmpty.max(150),
        medication: nonEmpty.max(500),
        dosage: nonEmpty.max(200),
        frequency: nonEmpty.max(200),
        duration: nonEmpty.max(200),
        instructions: z.string().max(4000),
        prescribedAt: nonEmpty.max(100),
        pharmacyName: z.string().max(250),
        pharmacyNpi: z.string().max(100),
        status: z.enum(['DRAFT','PENDING_TRANSMISSION','TRANSMITTED','DISPENSED']),
        transactionRef: z.string().max(250).optional(),
      }).strict()).max(200).optional(),
    }).strict(),
  },
  MergePatientCommand: {
    1: z.object({
      primaryPatientId: nonEmpty.max(150),
      secondaryPatientId: nonEmpty.max(150),
      mergeReason: nonEmpty.max(4000),
      overrideDemographicConflict: z.boolean().optional(),
    }).strict(),
  },
  ConfirmPatientIdentityCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      expectedMrn: nonEmpty.max(150),
      expectedFullName: nonEmpty.max(500),
      expectedDob: z.string().trim().max(50),
      encounterId: z.string().trim().min(1).max(150).optional(),
      actionType: z.enum([
        'PRESCRIBE_HIGH_ALERT_MEDICATION',
        'ORDER_BLOOD_TRANSFUSION',
        'SCHEDULE_SURGERY',
        'STAT_LAB_OVERRIDE',
      ]),
      actionSummary: nonEmpty.max(4000),
      clinicianVerificationSignature: nonEmpty.max(2000),
    }).strict(),
  },
  ReconcileRevenueIntegrityFindingCommand: {
    1: z.object({
      findingId: nonEmpty.max(150),
    }).strict(),
  },
  DismissRevenueIntegrityFindingCommand: {
    1: z.object({
      findingId: nonEmpty.max(150),
      reason: nonEmpty.max(4000),
    }).strict(),
  },

  // Retired Generation-1 commands remain schema-bound so malformed payloads
  // are rejected before the handler returns the migration-required error.
  RegisterPatientCommand: {
    1: z.object({
      fullName: nonEmpty.max(500),
      gender: z.enum(['male','female','other','unknown']),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      contactPhone: nonEmpty.max(100),
      address: z.string().max(2000).optional(),
      bloodGroup: z.string().max(20).optional(),
      identifiers: z.array(z.object({
        type: z.enum(['CNIC','MRN','PASSPORT','NATIONAL_ID','DRIVER_LICENSE','INSURANCE_ID']),
        value: nonEmpty.max(250),
        issuer: z.string().max(250).optional(),
      }).strict()).max(100),
      allergies: z.array(z.string().max(500)).max(500).optional(),
      chronicConditions: z.array(z.string().max(500)).max(500).optional(),
      department: z.string().max(250).optional(),
      priority: z.enum(['ROUTINE','URGENT','EMERGENCY']).optional(),
      chiefComplaint: z.string().max(4000).optional(),
    }).strict(),
  },
  AdmitPatientToBedCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      bedId: nonEmpty.max(150),
      assignedDoctor: z.string().max(250).optional(),
      assignedNurse: z.string().max(250).optional(),
    }).strict(),
  },
  DischargePatientFromBedCommand: {
    1: z.object({
      bedId: nonEmpty.max(150),
      notes: z.string().max(8000).optional(),
      disposition: z.string().max(500).optional(),
    }).strict(),
  },

  RecordStockTransactionCommand: {
    1: z.object({
      transactionId: nonEmpty,
      facilityId: nonEmpty,
      itemId: nonEmpty,
      transactionType: z.enum([
        'RECEIPT',
        'ISSUE',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'RETURN',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT',
        'DAMAGE',
        'EXPIRY',
        'QUARANTINE',
        'RELEASE',
        'RESERVATION',
        'UNRESERVATION',
        'CONSUMPTION',
        'DISPENSE',
        'RECALL',
        'WRITE_OFF',
        'RETURN_TO_SUPPLIER',
      ]),
      quantity: z.number().finite().positive(),
      uom: nonEmpty,
      itemCode: z.string().optional(),
      itemName: z.string().optional(),
      batchId: z.string().trim().min(1).optional(),
      batchNumber: z.string().optional(),
      fromLocationId: z.string().trim().min(1).optional(),
      fromLocationName: z.string().optional(),
      toLocationId: z.string().trim().min(1).optional(),
      toLocationName: z.string().optional(),
      normalizedQuantity: z.number().finite().positive().optional(),
      unitCost: z.number().finite().nonnegative().optional(),
      totalCost: z.number().finite().nonnegative().optional(),
      currency: z.string().trim().length(3).optional(),
      referenceType: nonEmpty,
      referenceId: nonEmpty,
      patientId: z.string().optional(),
      encounterId: z.string().optional(),
      procedureId: z.string().optional(),
      occurredAt: z.string().optional(),
      source: z.enum(['ONLINE', 'OFFLINE_SYNC', 'SYSTEM']).optional(),
      performedBy: z.record(z.string(), z.unknown()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).strict().superRefine((value, ctx) => {
      if (
        (value.transactionType === 'TRANSFER_OUT' ||
          value.transactionType === 'TRANSFER_IN') &&
        (!value.fromLocationId ||
          !value.toLocationId ||
          value.fromLocationId === value.toLocationId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Stock transfers require distinct source and destination locations.',
          path: ['toLocationId'],
        });
      }
    }),
  },
  RecordPatientConsumptionCommand: {
    1: z.object({
      consumptionId: nonEmpty,
      patientId: nonEmpty,
      encounterId: nonEmpty,
      facilityId: nonEmpty.optional(),
      sourceLocationId: nonEmpty,
      sourceLocationName: z.string().optional(),
      stockTransactionId: z.string().optional(),
      procedureId: z.string().optional(),
      procedureName: z.string().optional(),
      departmentId: nonEmpty,
      departmentName: nonEmpty,
      surgeonOrDoctorName: z.string().optional(),
      itemId: nonEmpty,
      itemCode: z.string().optional(),
      itemName: z.string().optional(),
      itemType: z.string().optional(),
      batchId: nonEmpty,
      batchNumber: z.string().optional(),
      serialNumber: z.string().optional(),
      lotNumber: z.string().optional(),
      udi: z.string().optional(),
      quantity: z.number().finite().positive(),
      uom: nonEmpty,
      consumedAt: z.string().optional(),
      documentedBy: z.string().optional(),
      witnessedBy: z.string().optional(),
      supplierId: z.string().optional(),
      supplierName: z.string().optional(),
      purchaseOrderId: z.string().optional(),
      grnId: z.string().optional(),
      isImplant: z.boolean(),
      implantDetails: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  },
  SubmitPurchaseRequisitionCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      requisitionNumber: nonEmpty,
      facilityId: nonEmpty,
      requestingDepartment: nonEmpty,
      requestingLocationId: nonEmpty,
      priority: z.enum(['EMERGENCY', 'URGENT', 'NORMAL', 'PLANNED']),
      items: z.array(z.object({
        itemId: nonEmpty,
        itemCode: nonEmpty,
        itemName: nonEmpty,
        requestedQuantity: z.number().finite().positive(),
        uom: nonEmpty,
        currentStock: z.number().finite().nonnegative(),
        reorderPoint: z.number().finite().nonnegative(),
        suggestedQuantity: z.number().finite().nonnegative(),
        estimatedUnitCost: z.number().finite().nonnegative(),
        estimatedTotal: z.number().finite().nonnegative(),
        approvedQuantity: z.number().finite().nonnegative().optional(),
        justification: z.string().optional(),
      }).strict()).min(1).max(500),
      justification: nonEmpty,
      requiredByDate: nonEmpty,
      estimatedTotalCost: z.number().finite().nonnegative(),
      currency: z.string().trim().length(3),
      clinicalCriticality: z.enum(['VITAL', 'ESSENTIAL', 'DESIRABLE']),
      status: z.string().optional(),
      requestedBy: z.record(z.string(), z.unknown()).optional(),
      approvalHistory: z.array(z.unknown()).optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    }).strict(),
  },
  ApprovePurchaseRequisitionCommand: {
    1: z.object({
      requisitionId: nonEmpty,
      decision: z.enum(['APPROVED', 'REJECTED']),
      comments: z.string().trim().max(1000).optional(),
      approvedLines: z.array(z.object({
        itemId: nonEmpty,
        approvedQuantity: z.number().finite().nonnegative(),
      }).strict()).max(500).optional(),
    }).strict(),
  },
  CreatePurchaseOrderCommand: {
    1: z.object({
      poId: nonEmpty,
      poNumber: nonEmpty,
      requisitionId: nonEmpty,
      supplierId: nonEmpty,
      contractId: nonEmpty.optional(),
      emergencyWaiverReason: z.string().trim().max(2000).optional(),
      currency: z.string().trim().length(3),
      paymentTerms: nonEmpty,
      expectedDeliveryDate: nonEmpty,
      destinationLocationId: nonEmpty,
      destinationLocationName: z.string().trim().max(250).optional(),
      items: z.array(z.object({
        lineId: nonEmpty,
        itemId: nonEmpty,
        quantityOrdered: z.number().finite().positive(),
        uom: nonEmpty,
        unitPrice: z.number().finite().nonnegative(),
        discount: z.number().finite().nonnegative().optional(),
        taxPercent: z.number().finite().nonnegative().max(100).optional(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  ApprovePurchaseOrderCommand: {
    1: z.object({
      poId: nonEmpty,
      decision: z.enum(['APPROVED', 'REJECTED']),
      comments: z.string().trim().max(1000).optional(),
    }).strict(),
  },
  RecordGoodsReceiptCommand: {
    1: z.object({
      grnId: nonEmpty,
      grnNumber: nonEmpty,
      purchaseOrderId: nonEmpty,
      facilityId: nonEmpty,
      deliveryNoteNumber: nonEmpty,
      supplierInvoiceReference: z.string().trim().max(200).optional(),
      receivedAt: nonEmpty,
      inspectionStatus: z.enum(['PASSED', 'FAILED', 'PARTIAL', 'QUARANTINED']),
      destinationLocationId: nonEmpty,
      destinationLocationName: z.string().trim().max(250).optional(),
      notes: z.string().trim().max(2000).optional(),
      items: z.array(z.object({
        itemId: nonEmpty,
        batchId: z.string().trim().min(1).optional(),
        batchNumber: z.string().trim().min(1).optional(),
        lotNumber: z.string().trim().min(1).optional(),
        quantityReceived: z.number().finite().positive(),
        quantityAccepted: z.number().finite().nonnegative(),
        quantityRejected: z.number().finite().nonnegative(),
        quantityDamaged: z.number().finite().nonnegative(),
        uom: nonEmpty,
        expiryDate: z.string().trim().min(1).optional(),
        manufactureDate: z.string().trim().min(1).optional(),
        manufacturer: z.string().trim().max(250).optional(),
        recordedTemperatureCelsius: z.number().finite().optional(),
        temperatureExcursion: z.boolean().optional(),
        inspectionPassed: z.boolean(),
        inspectionNotes: z.string().trim().max(1000).optional(),
        unitCost: z.number().finite().nonnegative(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  InitiateScmRecallCommand: {
    1: z.object({
      recallId: nonEmpty,
      recallCaseNumber: nonEmpty,
      itemId: nonEmpty,
      scope: z.enum([
        'ITEM_WIDE',
        'BATCH_WIDE',
        'LOT_WIDE',
        'SERIAL_SPECIFIC',
        'SUPPLIER_SPECIFIC',
        'MANUFACTURER_SPECIFIC',
      ]),
      targetBatchNumbers: z.array(nonEmpty).max(500).optional(),
      targetLotNumbers: z.array(nonEmpty).max(500).optional(),
      targetSerialNumbers: z.array(nonEmpty).max(5000).optional(),
      supplierId: nonEmpty.optional(),
      manufacturerName: nonEmpty.max(250).optional(),
      recallReason: nonEmpty.max(4000),
      severity: z.enum(['CRITICAL_CLASS_1','URGENT_CLASS_2','ADVISORY_CLASS_3']),
      initiatedAt: nonEmpty,
    }).strict(),
  },
  ExecuteRecallQuarantineCommand: {
    1: z.object({
      recallId: nonEmpty,
      batchIds: z.array(nonEmpty).min(1).max(50),
      balanceIds: z.array(nonEmpty).min(1).max(100),
      finalChunk: z.boolean(),
    }).strict(),
  },
  ProjectRecallExposuresCommand: {
    1: z.object({
      recallId: nonEmpty,
      consumptionIds: z.array(nonEmpty).min(1).max(100),
      finalChunk: z.boolean(),
    }).strict(),
  },
  RecordRecallNotificationCommand: {
    1: z.object({
      recallId: nonEmpty,
      exposureId: nonEmpty,
      note: nonEmpty.max(4000),
      notifiedAt: nonEmpty,
    }).strict(),
  },
  CreateInventoryDispositionCommand: {
    1: z.object({
      orderId: nonEmpty,
      orderNumber: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      balanceId: nonEmpty,
      batchId: nonEmpty,
      quantity: z.number().finite().positive(),
      dispositionType: z.enum(['DESTROY','RETURN_TO_SUPPLIER']),
      reason: z.enum(['EXPIRY','DAMAGE','RECALL','QUALITY_FAILURE','TEMPERATURE_EXCURSION']),
      recallId: nonEmpty.optional(),
      excursionId: nonEmpty.optional(),
      supplierId: nonEmpty.optional(),
      justification: nonEmpty.max(4000),
      requestedAt: nonEmpty,
    }).strict(),
  },
  ReviewInventoryDispositionCommand: {
    1: z.object({
      orderId: nonEmpty,
      decision: z.enum(['APPROVE','REJECT']),
      comments: nonEmpty.max(2000),
    }).strict(),
  },
  ExecuteInventoryDispositionCommand: {
    1: z.object({
      orderId: nonEmpty,
      executedAt: nonEmpty,
      witnessUserId: nonEmpty,
      destructionCertificateNumber: nonEmpty.max(250).optional(),
      carrierReference: nonEmpty.max(250).optional(),
    }).strict(),
  },
  ResolveScmRecallCommand: {
    1: z.object({
      recallId: nonEmpty,
      dispositionOrderIds: z.array(nonEmpty).max(200),
      resolutionNotes: nonEmpty.max(4000),
    }).strict(),
  },
  UpsertReplenishmentPolicyCommand: {
    1: z.object({
      policyId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      itemId: nonEmpty,
      sourceLocationId: nonEmpty.optional(),
      preferredSupplierId: nonEmpty.optional(),
      minQuantity: z.number().finite().nonnegative(),
      maxQuantity: z.number().finite().positive(),
      reorderPoint: z.number().finite().nonnegative(),
      safetyStockQuantity: z.number().finite().nonnegative(),
      safetyStockDays: z.number().finite().nonnegative().max(365),
      leadTimeDays: z.number().finite().positive().max(3650),
      mode: z.enum(['AUTO', 'INTERNAL_TRANSFER_ONLY', 'PURCHASE_ONLY']),
      active: z.boolean(),
    }).strict(),
  },
  GenerateReplenishmentPlanCommand: {
    1: z.object({
      planId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      policyIds: z.array(nonEmpty).min(1).max(500),
      asOf: nonEmpty,
      lookbackDays: z.number().int().min(7).max(365),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  ReviewReplenishmentPlanCommand: {
    1: z.object({
      planId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      comments: nonEmpty.max(2000),
    }).strict(),
  },
  ExecuteReplenishmentPlanCommand: {
    1: z.object({
      planId: nonEmpty,
      purchaseRequisitionId: nonEmpty.optional(),
      purchaseRequisitionNumber: nonEmpty.optional(),
      replenishmentOrderId: nonEmpty.optional(),
      replenishmentOrderNumber: nonEmpty.optional(),
      requiredByDate: nonEmpty,
    }).strict(),
  },
  CompleteInternalReplenishmentOrderCommand: {
    1: z.object({
      orderId: nonEmpty,
      stockTransactionIds: z.array(nonEmpty).min(1).max(1000),
    }).strict(),
  },
  ReviewSupplierQualificationCommand: {
    1: z.object({
      supplierId: nonEmpty,
      decision: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED', 'UNDER_REVIEW']),
      riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      complianceStatus: z.enum([
        'FULLY_COMPLIANT',
        'WARNING_RENEWAL_DUE',
        'NON_COMPLIANT_BLOCKED',
      ]),
      notes: nonEmpty.max(2000),
      reviewedAt: nonEmpty,
    }).strict(),
  },
  CreateScmRfqCommand: {
    1: z.object({
      rfqId: nonEmpty,
      rfqNumber: nonEmpty,
      requisitionId: nonEmpty,
      requiredDeliveryDate: nonEmpty,
      submissionDeadline: nonEmpty,
      invitedSupplierIds: z.array(nonEmpty).min(2).max(100),
      terms: nonEmpty.max(5000),
    }).strict(),
  },
  RecordSupplierQuotationCommand: {
    1: z.object({
      quotationId: nonEmpty,
      rfqId: nonEmpty,
      supplierId: nonEmpty,
      quotationNumber: nonEmpty,
      currency: z.string().trim().length(3),
      paymentTerms: nonEmpty.max(1000),
      taxMinorUnits: z.number().int().safe().nonnegative().optional(),
      shippingMinorUnits: z.number().int().safe().nonnegative().optional(),
      warrantyPeriodMonths: z.number().int().nonnegative().max(240).optional(),
      items: z.array(z.object({
        itemId: nonEmpty,
        uom: nonEmpty,
        unitPriceMinorUnits: z.number().int().safe().nonnegative(),
        leadTimeDays: z.number().int().nonnegative().max(3650),
        expiryMonthsAtDelivery: z.number().int().nonnegative().max(240),
        manufacturer: nonEmpty.max(250),
        brand: nonEmpty.max(250),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  AwardSupplierContractCommand: {
    1: z.object({
      contractId: nonEmpty,
      contractNumber: nonEmpty,
      rfqId: nonEmpty,
      selectedQuotationId: nonEmpty,
      candidateQuotationIds: z.array(nonEmpty).min(2).max(100),
      effectiveAt: nonEmpty,
      expiresAt: nonEmpty,
      maxSpendMinorUnits: z.number().int().safe().positive().optional(),
      selectionJustification: nonEmpty.max(4000),
    }).strict(),
  },
  ApproveSupplierContractCommand: {
    1: z.object({
      contractId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      comments: nonEmpty.max(2000),
    }).strict(),
  },
  ChangeSupplierContractStatusCommand: {
    1: z.object({
      contractId: nonEmpty,
      status: z.enum(['SUSPENDED', 'TERMINATED']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  RecordSupplierInvoiceCommand: {
    1: z.object({
      facilityId: nonEmpty,
      supplierId: nonEmpty,
      invoiceNumber: nonEmpty.max(200),
      poId: nonEmpty,
      grnIds: z.array(nonEmpty).min(1).max(100),
      issueDate: nonEmpty,
      dueDate: nonEmpty,
      currency: z.string().trim().length(3),
      shippingMinorUnits: z.number().int().safe().nonnegative().optional(),
      priceToleranceBasisPoints: z.number().int().min(0).max(500).optional(),
      quantityTolerance: z.number().finite().nonnegative().max(1000000).optional(),
      lines: z.array(z.object({
        lineId: nonEmpty,
        itemId: nonEmpty,
        billedQuantity: z.number().finite().positive(),
        uom: nonEmpty,
        unitPriceMinorUnits: z.number().int().safe().nonnegative(),
        discountMinorUnits: z.number().int().safe().nonnegative().optional(),
        taxMinorUnits: z.number().int().safe().nonnegative().optional(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  ResolveSupplierInvoiceMatchCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      poId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      notes: nonEmpty.max(2000),
    }).strict(),
  },
  RecognizeSupplierInvoicePayableCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      poId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      documentDate: z.number().finite().positive(),
      postingDate: z.number().finite().positive(),
    }).strict(),
  },
  RequestSupplierPaymentAuthorizationCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      reason: nonEmpty.max(1000),
    }).strict(),
  },
  ApproveSupplierPaymentAuthorizationCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      decision: z.enum(['APPROVE', 'REJECT']),
      comments: z.string().trim().max(1000).optional(),
    }).strict(),
  },
  RecordSupplierPaymentCommand: {
    1: z.object({
      authorizationId: nonEmpty,
      invoiceId: nonEmpty,
      paymentReference: nonEmpty.max(200),
      paymentMethod: z.enum(['BANK_TRANSFER', 'CHECK', 'ACH', 'CASH']),
      sourceAccountId: nonEmpty.max(100),
      settledAt: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
    }).strict(),
  },
  SubmitCycleCountCommand: {
    1: z.object({
      countId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      locationName: z.string().trim().max(250).optional(),
      countedAt: nonEmpty,
      isBlindCount: z.literal(true),
      lines: z.array(z.object({
        balanceId: nonEmpty,
        countedQuantity: z.number().finite().nonnegative(),
      }).strict()).min(1).max(500),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  ApproveCycleCountCommand: {
    1: z.object({
      countId: nonEmpty,
      balanceIds: z.array(nonEmpty).min(1).max(500),
      decision: z.enum(['APPROVE', 'REJECT']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  StartInventoryPeriodCloseCommand: {
    1: z.object({
      closeId: nonEmpty,
      facilityId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      periodStart: nonEmpty,
      periodEnd: nonEmpty,
      currency: z.string().trim().length(3),
    }).strict(),
  },
  FinalizeInventoryPeriodCloseCommand: {
    1: z.object({
      closeId: nonEmpty,
      facilityId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      periodStart: nonEmpty,
      periodEnd: nonEmpty,
      currency: z.string().trim().length(3),
    }).strict(),
  },
  RecordColdChainObservationCommand: {
    1: z.object({
      observationId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      itemId: nonEmpty,
      batchId: nonEmpty,
      balanceId: nonEmpty,
      temperatureCelsius: z.number().finite().min(-100).max(100),
      observedAt: nonEmpty,
      deviceId: nonEmpty.max(200),
      calibrationValidUntil: nonEmpty,
    }).strict(),
  },
  ReviewColdChainExcursionCommand: {
    1: z.object({
      excursionId: nonEmpty,
      decision: z.enum(['RELEASE', 'DISPOSE_REQUIRED']),
      notes: nonEmpty.max(2000),
    }).strict(),
  },
  RecordControlledCustodyCommand: {
    1: z.object({
      custodyId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      itemId: nonEmpty,
      batchId: nonEmpty,
      balanceId: nonEmpty,
      action: z.enum(['RECEIVE','HANDOFF','ISSUE','RETURN','WASTE_WITNESS']),
      quantity: z.number().finite().positive(),
      fromCustodianId: z.string().trim().min(1).optional(),
      toCustodianId: z.string().trim().min(1).optional(),
      witnessUserId: nonEmpty,
      stockTransactionId: z.string().trim().min(1).optional(),
      referenceId: nonEmpty,
      occurredAt: nonEmpty,
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  CreateConsignmentAgreementCommand: {
    1: z.object({
      agreementId: nonEmpty,
      agreementNumber: nonEmpty,
      supplierId: nonEmpty,
      facilityId: nonEmpty,
      currency: z.string().trim().length(3),
      effectiveAt: nonEmpty,
      expiresAt: nonEmpty,
      lines: z.array(z.object({
        itemId: nonEmpty,
        uom: nonEmpty,
        maxUnitCostMinorUnits: z.number().int().safe().nonnegative(),
        requiresSerial: z.boolean(),
        requiresUdi: z.boolean(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  ApproveConsignmentAgreementCommand: {
    1: z.object({
      agreementId: nonEmpty,
      decision: z.enum(['APPROVE','REJECT']),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  ReceiveConsignmentStockCommand: {
    1: z.object({
      lotId: nonEmpty,
      agreementId: nonEmpty,
      supplierId: nonEmpty,
      facilityId: nonEmpty,
      locationId: nonEmpty,
      itemId: nonEmpty,
      quantity: z.number().finite().positive(),
      uom: nonEmpty,
      unitCostMinorUnits: z.number().int().safe().nonnegative(),
      currency: z.string().trim().length(3),
      batchNumber: z.string().trim().min(1).optional(),
      serialNumbers: z.array(nonEmpty).max(500).optional(),
      udis: z.array(nonEmpty).max(500).optional(),
      receivedAt: nonEmpty,
    }).strict(),
  },
  RecordConsignmentUsageCommand: {
    1: z.object({
      usageId: nonEmpty,
      lotId: nonEmpty,
      agreementId: nonEmpty,
      facilityId: nonEmpty,
      itemId: nonEmpty,
      quantity: z.number().finite().positive(),
      patientId: z.string().trim().min(1).optional(),
      encounterId: z.string().trim().min(1).optional(),
      procedureId: z.string().trim().min(1).optional(),
      serialNumbers: z.array(nonEmpty).max(500).optional(),
      udis: z.array(nonEmpty).max(500).optional(),
      usedAt: nonEmpty,
    }).strict(),
  },
  CaptureConsignmentSupplierInvoiceCommand: {
    1: z.object({
      facilityId: nonEmpty,
      supplierId: nonEmpty,
      agreementId: nonEmpty,
      invoiceNumber: nonEmpty.max(200),
      usageIds: z.array(nonEmpty).min(1).max(100),
      issueDate: nonEmpty,
      dueDate: nonEmpty,
      currency: z.string().trim().length(3),
    }).strict(),
  },
  ReviewConsignmentSupplierInvoiceCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      decision: z.enum(['APPROVE','REJECT']),
      notes: nonEmpty.max(2000),
    }).strict(),
  },
  GenerateScmIntelligenceSnapshotCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      facilityId: nonEmpty,
      asOf: nonEmpty,
      lookbackDays: z.number().int().min(7).max(3650),
      expiryHorizonDays: z.number().int().min(1).max(730),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  CreateFinanceAccountCommand: {
    1: z.object({
      accountCode: nonEmpty.max(20),
      accountName: nonEmpty.max(250),
      category: z.enum(['asset','liability','equity','revenue','expense']),
      subCategory: nonEmpty.max(250),
      normalBalance: z.enum(['debit','credit']),
      currency: z.string().trim().length(3),
      parentAccountCode: z.string().trim().max(20).optional(),
      costCenterRequired: z.boolean().optional(),
      profitCenterRequired: z.boolean().optional(),
      allowManualPosting: z.boolean(),
      allowCashReceipts: z.boolean().optional(),
      allowSupplierPayments: z.boolean().optional(),
      isSystemLocked: z.boolean().optional(),
    }).strict(),
  },
  CreateFinancePeriodCommand: {
    1: z.object({
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      periodName: nonEmpty.max(200),
      startAt: z.number().finite().positive(),
      endAt: z.number().finite().positive(),
    }).strict(),
  },
  ChangeFinancePeriodStatusCommand: {
    1: z.object({
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      nextStatus: z.enum(['SOFT_CLOSE','OPEN']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  ReverseJournalCommand: {
    1: z.object({
      originalJournalId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      reversalPostingAt: z.number().finite().positive(),
      reversalReason: nonEmpty.max(2000),
    }).strict(),
  },
  GenerateTrialBalanceCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      throughPostingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  RecognizePatientInvoiceCommand: {
    1: z.object({
      invoiceId: nonEmpty,
      patientId: nonEmpty,
      encounterId: z.string().trim().min(1).optional(),
      payerId: z.string().trim().min(1).optional(),
      issueAt: z.number().finite().positive(),
      dueAt: z.number().finite().positive(),
      currency: z.string().trim().length(3),
      patientResponsibilityMinorUnits: z.number().int().safe().nonnegative(),
      payerResponsibilityMinorUnits: z.number().int().safe().nonnegative(),
      lines: z.array(z.object({
        lineId: nonEmpty,
        description: nonEmpty.max(500),
        revenueAccountCode: nonEmpty.max(20),
        amountMinorUnits: z.number().int().safe().nonnegative(),
        costCenterId: z.string().trim().min(1).optional(),
        profitCenterId: z.string().trim().min(1).optional(),
      }).strict()).min(1).max(500),
    }).strict(),
  },
  AdjustArOpenItemCommand: {
    1: z.object({
      adjustmentId: nonEmpty,
      openItemId: nonEmpty,
      type: z.enum(['CREDIT_NOTE','WRITE_OFF','REFUND']),
      amountMinorUnits: z.number().int().safe().positive(),
      reason: nonEmpty.max(2000),
      postingAt: z.number().finite().positive(),
    }).strict(),
  },
  RecordArReceiptCommand: {
    1: z.object({
      receiptId: nonEmpty,
      openItemId: nonEmpty,
      treasuryAccountId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      receivedAt: z.number().finite().positive(),
      method: z.enum(['BANK_TRANSFER','CARD','MOBILE_WALLET','INSURANCE_SETTLEMENT']),
      reference: nonEmpty.max(200),
    }).strict(),
  },
  GenerateArAgingCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      asOf: z.number().finite().positive(),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  RegisterTreasuryAccountCommand: {
    1: z.object({
      treasuryAccountId: nonEmpty,
      accountCode: nonEmpty.max(20),
      accountName: nonEmpty.max(250),
      currency: z.string().trim().length(3),
      kind: z.enum(['CASH_DRAWER','BANK']),
      bankName: z.string().trim().max(250).optional(),
      maskedAccountNumber: z.string().trim().max(100).optional(),
      facilityId: z.string().trim().min(1).optional(),
      allowReceipts: z.boolean(),
      allowPayments: z.boolean(),
    }).strict(),
  },
  OpenCashShiftCommand: {
    1: z.object({
      shiftId: nonEmpty,
      facilityId: nonEmpty,
      registerId: nonEmpty,
      treasuryAccountId: nonEmpty,
      openedAt: z.number().finite().positive(),
      openingFloatMinorUnits: z.number().int().safe().nonnegative(),
    }).strict(),
  },
  CloseCashShiftCommand: {
    1: z.object({
      shiftId: nonEmpty,
      countedClosingMinorUnits: z.number().int().safe().nonnegative(),
      closedAt: z.number().finite().positive(),
    }).strict(),
  },
  ReviewCashShiftCommand: {
    1: z.object({
      shiftId: nonEmpty,
      decision: z.enum(['APPROVE','REJECT']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  TreasuryTransferCommand: {
    1: z.object({
      transferId: nonEmpty,
      fromTreasuryAccountId: nonEmpty,
      toTreasuryAccountId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      currency: z.string().trim().length(3),
      transferredAt: z.number().finite().positive(),
      reference: nonEmpty.max(200),
    }).strict(),
  },
  PrepareBankReconciliationCommand: {
    1: z.object({
      reconciliationId: nonEmpty,
      treasuryAccountId: nonEmpty,
      statementDate: z.number().finite().positive(),
      statementEndingMinorUnits: z.number().int().safe(),
      depositsInTransitMinorUnits: z.number().int().safe(),
      outstandingPaymentsMinorUnits: z.number().int().safe(),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  ApproveBankReconciliationCommand: {
    1: z.object({
      reconciliationId: nonEmpty,
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  GenerateApAgingCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      asOf: z.number().finite().positive(),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  ApplySupplierCreditCommand: {
    1: z.object({
      creditId: nonEmpty,
      invoiceId: nonEmpty,
      creditType: z.enum(['RETURN_CREDIT','PRICE_CREDIT']),
      amountMinorUnits: z.number().int().safe().positive(),
      postingAt: z.number().finite().positive(),
      supplierReference: nonEmpty.max(200),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  CreateCostCenterCommand: {
    1: z.object({
      costCenterId: nonEmpty,
      code: nonEmpty.max(50),
      name: nonEmpty.max(250),
      department: nonEmpty.max(250),
      facilityId: z.string().trim().min(1).optional(),
      managerUserId: z.string().trim().min(1).optional(),
    }).strict(),
  },
  CreateCostAllocationRuleCommand: {
    1: z.object({
      ruleId: nonEmpty,
      sourceCostCenterId: nonEmpty,
      expenseAccountCode: nonEmpty.max(20),
      allocationBasis: z.enum(['PERCENT','HEADCOUNT','AREA','ENCOUNTERS']),
      targets: z.array(z.object({
        costCenterId: nonEmpty,
        percentBasisPoints: z.number().int().min(1).max(10000),
      }).strict()).min(1).max(100),
      effectiveFrom: z.number().finite().positive(),
      effectiveTo: z.number().finite().positive().optional(),
    }).strict(),
  },
  RunCostAllocationCommand: {
    1: z.object({
      runId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
      ruleIds: z.array(nonEmpty).min(1).max(100),
    }).strict(),
  },
  CreateBudgetEnvelopeCommand: {
    1: z.object({
      budgetId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      costCenterId: nonEmpty,
      accountCode: nonEmpty.max(20),
      currency: z.string().trim().length(3),
      approvedMinorUnits: z.number().int().safe().positive(),
    }).strict(),
  },
  ApproveBudgetEnvelopeCommand: {
    1: z.object({
      budgetId: nonEmpty,
      decision: z.enum(['APPROVE','REJECT']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  CommitBudgetCommand: {
    1: z.object({
      commitmentId: nonEmpty,
      budgetId: nonEmpty,
      referenceType: z.enum(['PURCHASE_REQUISITION','PURCHASE_ORDER','CONTRACT','MANUAL']),
      referenceId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      committedAt: z.number().finite().positive(),
    }).strict(),
  },
  ReleaseBudgetCommitmentCommand: {
    1: z.object({
      commitmentId: nonEmpty,
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  ConsumeBudgetCommitmentCommand: {
    1: z.object({
      commitmentId: nonEmpty,
      journalId: nonEmpty,
    }).strict(),
  },
  CapitalizeFixedAssetCommand: {
    1: z.object({
      assetId: nonEmpty,
      assetTag: nonEmpty.max(100),
      serialNumber: z.string().trim().max(200).optional(),
      assetName: nonEmpty.max(250),
      assetCategory: z.enum(['MEDICAL_EQUIPMENT','IT_HARDWARE','FACILITY','VEHICLE','OTHER']),
      facilityId: nonEmpty,
      costCenterId: nonEmpty,
      acquisitionAt: z.number().finite().positive(),
      inServiceAt: z.number().finite().positive(),
      acquisitionCostMinorUnits: z.number().int().safe().positive(),
      salvageValueMinorUnits: z.number().int().safe().nonnegative(),
      usefulLifeMonths: z.number().int().min(1).max(1200),
      assetAccountCode: nonEmpty.max(20),
      accumulatedDepreciationAccountCode: nonEmpty.max(20),
      depreciationExpenseAccountCode: nonEmpty.max(20),
      currency: z.string().trim().length(3),
      sourceReferenceId: nonEmpty,
    }).strict(),
  },
  RunDepreciationCommand: {
    1: z.object({
      runId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
      assetIds: z.array(nonEmpty).min(1).max(200),
    }).strict(),
  },
  TransferFixedAssetCommand: {
    1: z.object({
      assetId: nonEmpty,
      facilityId: nonEmpty,
      costCenterId: nonEmpty,
      transferredAt: z.number().finite().positive(),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  DisposeFixedAssetCommand: {
    1: z.object({
      assetId: nonEmpty,
      disposedAt: z.number().finite().positive(),
      proceedsMinorUnits: z.number().int().safe().nonnegative(),
      treasuryAccountCode: z.string().trim().min(1).max(20).optional(),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  StartFinanceCloseCommand: {
    1: z.object({
      closeId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  FinalizeFinanceCloseCommand: {
    1: z.object({
      closeId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
      statementSnapshotId: nonEmpty,
    }).strict(),
  },
  LockFinancePeriodCommand: {
    1: z.object({
      closeId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  CreateTaxCodeCommand: {
    1: z.object({
      taxCodeId: nonEmpty,
      code: nonEmpty.max(50),
      description: nonEmpty.max(500),
      jurisdiction: nonEmpty.max(250),
      taxType: z.enum(['OUTPUT','INPUT','WITHHOLDING']),
      rateBasisPoints: z.number().int().min(0).max(10000),
      recoverablePercentBasisPoints: z.number().int().min(0).max(10000).optional(),
      payableAccountCode: nonEmpty.max(20),
      recoverableAccountCode: z.string().trim().min(1).max(20).optional(),
      expenseAccountCode: z.string().trim().min(1).max(20).optional(),
      effectiveFrom: z.number().finite().positive(),
      effectiveTo: z.number().finite().positive().optional(),
    }).strict(),
  },
  RecordSupplierWithholdingCommand: {
    1: z.object({
      taxLedgerItemId: nonEmpty,
      taxCodeId: nonEmpty,
      invoiceId: nonEmpty,
      taxableMinorUnits: z.number().int().safe().positive(),
      postingAt: z.number().finite().positive(),
    }).strict(),
  },
  RemitTaxLiabilityCommand: {
    1: z.object({
      remittanceId: nonEmpty,
      taxCodeId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      treasuryAccountCode: nonEmpty.max(20),
      currency: z.string().trim().length(3),
      postingAt: z.number().finite().positive(),
      reference: nonEmpty.max(200),
    }).strict(),
  },
  GenerateTaxSummaryCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      fiscalYear: z.number().int().min(2000).max(2200),
      throughPostingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  GenerateFinanceIntelligenceCommand: {
    1: z.object({
      snapshotId: nonEmpty,
      asOf: z.number().finite().positive(),
      fiscalYear: z.number().int().min(2000).max(2200),
      throughPostingPeriod: z.number().int().min(1).max(12),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  RecordCashReceiptCommand: {
    1: z.object({
      receiptId: nonEmpty,
      invoiceId: nonEmpty,
      encounterId: nonEmpty,
      patientId: nonEmpty,
      amountMinorUnits: z.number().int().safe().positive(),
      currency: z.string().trim().length(3).optional(),
      referenceNumber: nonEmpty,
      collectedAt: z.number().finite().positive(),
      cashierName: z.string().trim().max(200).optional(),
    }).strict(),
  },
  PostJournalCommand: {
    1: z.object({
      fiscalYear: z.number().int().min(2000).max(2200),
      postingPeriod: z.number().int().min(1).max(12),
      documentDate: z.number().finite().positive(),
      postingDate: z.number().finite().positive(),
      referenceDocumentId: z.string().trim().max(200).optional(),
      documentHeader: nonEmpty.max(500),
      currency: z.string().trim().length(3),
      sourceModule: z.literal('MANUAL').optional(),
      lines: z.array(z.object({
        glAccountId: nonEmpty.max(100),
        glAccountName: nonEmpty.max(250),
        costCenterId: z.string().trim().max(100).optional(),
        profitCenterId: z.string().trim().max(100).optional(),
        debitMinorUnits: z.number().int().safe().nonnegative(),
        creditMinorUnits: z.number().int().safe().nonnegative(),
        lineDescription: nonEmpty.max(500),
      }).strict()).min(2).max(500),
    }).strict(),
  },
  CreateEmployeeCommand: {
    1: z.object({
      facilityIds: z.array(nonEmpty.max(100)).min(1).max(50)
        .refine((values)=>new Set(values).size===values.length,'Duplicate facility assignments are not allowed.'),
      primaryFacilityId: nonEmpty.max(100),
      departmentIds: z.array(nonEmpty.max(100)).min(1).max(50)
        .refine((values)=>new Set(values).size===values.length,'Duplicate department assignments are not allowed.'),
      primaryDepartmentId: nonEmpty.max(100),
      primaryDepartmentName: nonEmpty.max(200),
      positionId: nonEmpty.max(100),
      positionTitle: nonEmpty.max(200),
      employmentType: z.enum([
        'FULL_TIME','PART_TIME','CONTRACT','TEMPORARY','CONSULTANT','LOCUM',
        'INTERN','VOLUNTEER','VISITING_CLINICIAN','AGENCY_WORKER'
      ]),
      hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      managerId: z.string().trim().min(1).max(100).optional(),
      managerName: z.string().trim().min(1).max(200).optional(),
      supervisorId: z.string().trim().min(1).max(100).optional(),
      specialty: z.string().trim().min(1).max(200).optional(),
      subSpecialties: z.array(nonEmpty.max(200)).max(30).optional(),
      personalInfo: z.object({
        legalFirstName: nonEmpty.max(100),
        legalLastName: nonEmpty.max(100),
        preferredName: z.string().trim().min(1).max(100).optional(),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nationalIdNumber: z.string().trim().min(1).max(100).optional(),
        gender: z.enum(['FEMALE','MALE','NON_BINARY','UNDISCLOSED']),
        contactEmail: z.string().trim().email().max(254),
        contactPhone: nonEmpty.max(50),
        emergencyContact: z.object({
          name: nonEmpty.max(200),
          relationship: nonEmpty.max(100),
          phone: nonEmpty.max(50),
        }).strict(),
        residentialAddress: z.object({
          street: nonEmpty.max(300),
          city: nonEmpty.max(150),
          state: nonEmpty.max(150),
          postalCode: nonEmpty.max(40),
          country: nonEmpty.max(150),
        }).strict(),
        photoUrl: z.string().url().max(2000).optional(),
      }).strict(),
    }).strict(),
  },
  UpdateEmployeeStatusCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      newStatus: z.enum([
        'APPLICANT','ONBOARDING','ACTIVE','ON_LEAVE','SUSPENDED',
        'NOTICE_PERIOD','TERMINATED','RETIRED','INACTIVE'
      ]),
      reason: nonEmpty.max(1000),
    }).strict(),
  },
  TransferEmployeeCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      toFacilityId: z.string().trim().min(1).max(100).optional(),
      toDepartmentId: nonEmpty.max(100),
      toDepartmentName: nonEmpty.max(200),
      toPositionId: nonEmpty.max(100),
      toPositionTitle: nonEmpty.max(200),
      reason: nonEmpty.max(1000),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).strict(),
  },
  AssignShiftCommand: {
    1: z.object({
      facilityId: nonEmpty,
      facilityName: nonEmpty.max(200),
      departmentId: nonEmpty,
      departmentName: nonEmpty.max(200),
      employeeId: nonEmpty,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      shiftId: nonEmpty,
      shiftName: nonEmpty.max(200),
      startTime: nonEmpty,
      endTime: nonEmpty,
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  CancelShiftCommand: {
    1: z.object({
      rosterId: nonEmpty,
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  ExecuteRosterSwapCommand: {
    1: z.object({
      shiftAId: nonEmpty,
      shiftBId: nonEmpty,
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  RecordClockInCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      source: z.enum([
        'BIOMETRIC_SCANNER','KIOSK_TERMINAL','MOBILE_GPS',
        'WEB_PORTAL','SUPERVISOR_OVERRIDE','HL7_ACCESS_CARD'
      ]),
      deviceIdentifier: z.string().trim().min(1).max(250).optional(),
      scheduledShiftId: z.string().trim().min(1).max(150).optional(),
    }).strict(),
  },
  RecordClockOutCommand: {
    1: z.object({
      attendanceId: nonEmpty.max(150),
    }).strict(),
  },
  CorrectAttendanceTimeCommand: {
    1: z.object({
      attendanceId: nonEmpty.max(150),
      newClockInTime: nonEmpty,
      newClockOutTime: z.string().trim().min(1).optional(),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  SubmitLeaveRequestCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      leaveType: z.enum([
        'ANNUAL','SICK','EMERGENCY','MATERNITY','PATERNITY',
        'STUDY_CME','COMPASSIONATE','UNPAID','OTHER'
      ]),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: nonEmpty.max(2000),
      coveringEmployeeId: z.string().trim().min(1).max(100).optional(),
    }).strict(),
  },
  ApproveLeaveRequestCommand: {
    1: z.object({
      leaveId: nonEmpty.max(150),
      approved: z.boolean(),
      rejectionReason: z.string().trim().min(1).max(2000).optional(),
    }).strict(),
  },
  SetCompensationCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      payBasis: z.enum(['SALARIED','HOURLY']),
      payFrequency: z.enum(['MONTHLY','SEMI_MONTHLY','BI_WEEKLY']),
      currency: z.string().trim().length(3),
      annualSalaryMinorUnits: z.number().int().safe().nonnegative(),
      hourlyRateMinorUnits: z.number().int().safe().nonnegative(),
      overtimeMultiplierBasisPoints: z.number().int().min(10000).max(50000),
      monthlyAllowanceMinorUnits: z.number().int().safe().nonnegative(),
      deductions: z.array(z.object({
        code: nonEmpty.max(80),
        name: nonEmpty.max(200),
        rateBasisPoints: z.number().int().min(0).max(10000),
        fixedMinorUnits: z.number().int().safe().nonnegative(),
        liabilityAccountCode: nonEmpty.max(40),
      }).strict()).max(50),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).strict(),
  },
  ReviewCompensationCommand: {
    1: z.object({
      compensationId: nonEmpty.max(180),
      decision: z.enum(['APPROVE','REJECT']),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  CreatePayrollPeriodCommand: {
    1: z.object({
      facilityId: nonEmpty.max(100),
      periodNumber: nonEmpty.max(100),
      periodName: nonEmpty.max(250),
      payFrequency: z.enum(['MONTHLY','SEMI_MONTHLY','BI_WEEKLY']),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      currency: z.string().trim().length(3),
    }).strict(),
  },
  EnrollPayrollEmployeeCommand: {
    1: z.object({periodId: nonEmpty.max(180),employeeId: nonEmpty.max(100)}).strict(),
  },
  CalculatePayrollEmployeeCommand: {
    1: z.object({periodId: nonEmpty.max(180),employeeId: nonEmpty.max(100)}).strict(),
  },
  FinalizePayrollPeriodCommand: {
    1: z.object({periodId: nonEmpty.max(180)}).strict(),
  },
  ApprovePayrollPeriodCommand: {
    1: z.object({
      periodId: nonEmpty.max(180),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  PostPayrollPeriodCommand: {
    1: z.object({
      periodId: nonEmpty.max(180),
    }).strict(),
  },
  SettlePayrollPeriodCommand: {
    1: z.object({
      periodId: nonEmpty.max(180),
      treasuryAccountId: nonEmpty.max(180),
      settlementReference: nonEmpty.max(250),
      settledAt: nonEmpty,
    }).strict(),
  },
  RemitPayrollLiabilityCommand: {
    1: z.object({
      liabilityId: nonEmpty.max(220),
      treasuryAccountId: nonEmpty.max(180),
      remittanceReference: nonEmpty.max(250),
      remittedAt: nonEmpty,
    }).strict(),
  },
  GeneratePayrollComplianceSnapshotCommand: {
    1: z.object({
      snapshotId: nonEmpty.max(180),
      asOf: nonEmpty,
      currency: z.string().trim().length(3),
    }).strict(),
  },
  GenerateHcmIntelligenceCommand: {
    1: z.object({
      snapshotId: nonEmpty.max(180),
      asOf: nonEmpty,
      lookbackDays: z.number().int().min(1).max(365),
      facilityId: z.string().trim().min(1).max(100).optional(),
    }).strict(),
  },
  SubmitCredentialCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      credentialType: z.enum([
        'MEDICAL_LICENSE','NURSING_BOARD','PHARMACY_LICENSE',
        'PROFESSIONAL_REGISTRATION','SPECIALTY_BOARD','BLS_ACLS',
        'DEA_REGISTRATION','HOSPITAL_CREDENTIAL','FELLOWSHIP_CERTIFICATE'
      ]),
      title: nonEmpty.max(250),
      issuingAuthority: nonEmpty.max(250),
      credentialNumber: nonEmpty.max(150),
      issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      documentReference: z.string().trim().min(1).max(1000).optional(),
      documentHash: z.string().trim().min(16).max(256).optional(),
      notes: z.string().trim().max(2000).optional(),
      isMandatoryForPractice: z.boolean(),
    }).strict(),
  },
  VerifyCredentialCommand: {
    1: z.object({
      credentialId: nonEmpty.max(150),
      status: z.enum(['VERIFIED','REJECTED']),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  GrantClinicalPrivilegeCommand: {
    1: z.object({
      employeeId: nonEmpty.max(100),
      privilegeType: z.enum([
        'CONSULT_OPD','PRESCRIBE_MEDICATION','PERFORM_GENERAL_SURGERY',
        'PERFORM_CARDIOTHORACIC_SURGERY','ADMINISTER_ANESTHESIA',
        'ORDER_LAB','ORDER_RADIOLOGY','ORDER_PROCEDURE',
        'ORDER_HIGH_COMPLEXITY_LAB','APPROVE_LAB_RESULTS','VERIFY_LAB_RESULT',
        'ACKNOWLEDGE_CRITICAL_RESULT','INTERPRET_IMAGING','INTERPRET_RADIOLOGY_CT_MRI','DISPENSE_MEDICATION',
        'SIGN_CLINICAL_NOTE','SIGN_DEATH_CERTIFICATE',
        'PERFORM_INVASIVE_PROCEDURES','SIGN_SOAP_CLINICAL_NOTE'
      ]),
      specialty: nonEmpty.max(200),
      facilityId: nonEmpty.max(100),
      facilityName: nonEmpty.max(200),
      departmentId: nonEmpty.max(100),
      departmentName: nonEmpty.max(200),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      effectiveUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      restrictionNotes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  ChangeClinicalPrivilegeStatusCommand: {
    1: z.object({
      privilegeId: nonEmpty.max(150),
      status: z.enum(['GRANTED','SUSPENDED','REVOKED']),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  RegisterResourceCommand: {
    1: z.object({
      resourceNumber: z.string().trim().min(1).max(100).optional(),
      resourceType: z.enum([
        'ROOM','BED','MEDICAL_DEVICE','LAB_EQUIPMENT','RADIOLOGY_EQUIPMENT',
        'SURGICAL_EQUIPMENT','IT_EQUIPMENT','VEHICLE','FURNITURE','OTHER'
      ]),
      name: nonEmpty.max(250),
      facilityId: nonEmpty.max(100),
      facilityName: z.string().trim().max(200).optional(),
      departmentId: nonEmpty.max(100),
      departmentName: z.string().trim().max(200).optional(),
      ownerDepartmentId: nonEmpty.max(100),
      ownerDepartmentName: z.string().trim().max(200).optional(),
      location: z.object({
        building: nonEmpty.max(200),
        floor: nonEmpty.max(100),
        roomNumber: z.string().trim().max(100).optional(),
        zone: z.string().trim().max(100).optional(),
      }).strict(),
      status: z.enum([
        'AVAILABLE','ALLOCATED','IN_USE','RESERVED','MAINTENANCE',
        'OUT_OF_SERVICE','LOST','RETIRED'
      ]),
      manufacturer: z.string().trim().max(200).optional(),
      model: z.string().trim().max(200).optional(),
      serialNumber: z.string().trim().max(200).optional(),
      assetTagNumber: z.string().trim().max(200).optional(),
      purchaseDate: z.string().trim().optional(),
      purchaseCost: z.number().finite().nonnegative().optional(),
      warrantyExpiry: z.string().trim().optional(),
      calibrationRequired: z.boolean().optional(),
      calibrationStatus: z.enum(['NOT_REQUIRED','VALID','EXPIRING_SOON','CALIBRATION_REQUIRED','FAILED']).optional(),
      currentCustodianId: z.string().trim().max(100).optional(),
      currentCustodianName: z.string().trim().max(200).optional(),
      operatingSpecifications: z.record(z.string(), z.union([z.string(),z.number()])).optional(),
      acquisitionDate: nonEmpty,
      lifecycleState: z.enum(['IN_SERVICE','STORAGE','UNDER_REPAIR','DECOMMISSIONED','DISPOSED']),
    }).strict(),
  },
  RegisterRoomCommand: {
    1: z.object({
      roomNumber: nonEmpty.max(100),
      facilityId: nonEmpty.max(100),
      facilityName: nonEmpty.max(200),
      building: nonEmpty.max(200),
      floor: nonEmpty.max(100),
      departmentId: nonEmpty.max(100),
      departmentName: nonEmpty.max(200),
      roomType: z.enum([
        'consultation','procedure','operating_room','isolation','icu',
        'inpatient_room','emergency_bay','recovery','maternity','pediatric',
        'meeting','storage','laboratory','imaging'
      ]),
      capacity: z.number().int().positive().max(10000),
      currentOccupancy: z.number().int().nonnegative().max(10000),
      status: z.enum([
        'AVAILABLE','ALLOCATED','IN_USE','RESERVED','MAINTENANCE',
        'OUT_OF_SERVICE','LOST','RETIRED'
      ]),
      equipmentIds: z.array(nonEmpty.max(150)).max(500).optional(),
      bedIds: z.array(nonEmpty.max(150)).max(500).optional(),
      features: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
      operatingHours: z.object({
        openTime: nonEmpty.max(10),
        closeTime: nonEmpty.max(10),
        is24x7: z.boolean(),
      }).strict().optional(),
    }).strict(),
  },
  RegisterBedCommand: {
    1: z.object({
      bedNumber: nonEmpty.max(100),
      facilityId: nonEmpty.max(100),
      departmentId: nonEmpty.max(100),
      roomId: nonEmpty.max(150),
      ward: z.enum([
        'ICU','General','Emergency','Maternity','Pediatrics','Surgery','Cardiology','Oncology'
      ]),
      bedType: z.enum([
        'STANDARD','ICU','HDU','ISOLATION','PEDIATRIC','MATERNITY','EMERGENCY','RECOVERY'
      ]),
      capabilities: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  UpdateBedStatusCommand: {
    1: z.object({
      bedId: nonEmpty.max(150),
      status: z.enum(['available','maintenance','cleaning']),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  ReserveResourceCommand: {
    1: z.object({
      resourceId: nonEmpty.max(150),
      resourceName: nonEmpty.max(250),
      resourceType: z.enum([
        'ROOM','BED','MEDICAL_DEVICE','LAB_EQUIPMENT','RADIOLOGY_EQUIPMENT',
        'SURGICAL_EQUIPMENT','IT_EQUIPMENT','VEHICLE','FURNITURE','OTHER'
      ]),
      facilityId: nonEmpty.max(100),
      departmentId: nonEmpty.max(100),
      startTime: nonEmpty,
      endTime: nonEmpty,
      purpose: z.enum([
        'OPD_CONSULTATION','SURGICAL_PROCEDURE','DIAGNOSTIC_IMAGING','LAB_BATCH',
        'PREVENTIVE_MAINTENANCE','STAFF_TRAINING','EMERGENCY_HOLD'
      ]),
      procedureCode: z.string().trim().max(100).optional(),
      clinicalEncounterId: z.string().trim().max(150).optional(),
      patientId: z.string().trim().max(150).optional(),
      patientName: z.string().trim().max(250).optional(),
      requesterActorId: z.string().trim().max(150).optional(),
      requesterName: nonEmpty.max(250),
      priority: z.enum(['ROUTINE','URGENT','STAT_EMERGENCY']),
      notes: z.string().trim().max(2000).optional(),
    }).strict(),
  },
  TransferResourceCommand: {
    1: z.object({
      resourceId: nonEmpty.max(150),
      toDepartmentId: nonEmpty.max(100),
      toDepartmentName: nonEmpty.max(200),
      toFacilityId: nonEmpty.max(100),
      toFacilityName: nonEmpty.max(200),
      toLocation: z.object({
        building: nonEmpty.max(200),
        floor: nonEmpty.max(100),
        roomNumber: nonEmpty.max(100),
      }).strict(),
      custodianName: z.string().trim().max(200).optional(),
      reason: nonEmpty.max(2000),
    }).strict(),
  },
  CreateMaintenanceWorkOrderCommand: {
    1: z.object({
      resourceId: nonEmpty.max(150),
      resourceName: nonEmpty.max(250),
      resourceType: z.enum([
        'ROOM','BED','MEDICAL_DEVICE','LAB_EQUIPMENT','RADIOLOGY_EQUIPMENT',
        'SURGICAL_EQUIPMENT','IT_EQUIPMENT','VEHICLE','FURNITURE','OTHER'
      ]).optional(),
      issueDescription: nonEmpty.max(4000),
      maintenanceType: z.enum(['PREVENTIVE','CORRECTIVE','EMERGENCY_REPAIR']),
      priority: z.enum(['LOW','MEDIUM','HIGH','CRITICAL_SURGE']),
      reportedByActorId: z.string().trim().max(150).optional(),
      reportedByName: nonEmpty.max(250),
      assignedTechnicianId: z.string().trim().max(150).optional(),
      assignedTechnicianName: z.string().trim().max(250).optional(),
      assignedVendorName: z.string().trim().max(250).optional(),
      partsUsed: z.array(z.object({
        partNumber: nonEmpty.max(150),
        partName: nonEmpty.max(250),
        quantity: z.number().finite().positive(),
        unitCost: z.number().finite().nonnegative(),
      }).strict()).max(200).optional(),
    }).strict(),
  },
  CompleteMaintenanceWorkOrderCommand: {
    1: z.object({
      workOrderId: nonEmpty.max(150),
      resolutionSummary: nonEmpty.max(4000),
      totalCost: z.number().finite().nonnegative(),
      downtimeHours: z.number().finite().nonnegative(),
    }).strict(),
  },
  RecordCalibrationCommand: {
    1: z.object({
      resourceId: nonEmpty.max(150),
      resourceName: nonEmpty.max(250),
      model: nonEmpty.max(200),
      serialNumber: nonEmpty.max(200),
      calibrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      certificateNumber: nonEmpty.max(200),
      technicianName: nonEmpty.max(250),
      technicianId: z.string().trim().max(150).optional(),
      accreditedAgency: z.string().trim().max(250).optional(),
      result: z.enum(['PASS','FAIL','CONDITIONAL_PASS']),
      measuredTolerances: z.record(z.string(), z.object({
        standard: z.number().finite(),
        measured: z.number().finite(),
        deviation: z.number().finite(),
        pass: z.boolean(),
      }).strict()).optional(),
      notes: z.string().trim().max(4000).optional(),
      documentReference: z.string().trim().max(1000).optional(),
    }).strict(),
  },
  RecordVitalsCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      heartRate: z.number().finite().min(20).max(250),
      bloodPressure: z.string().trim().regex(/^\d{2,3}\/\d{2,3}$/).max(7),
      temperature: z.number().finite().min(30).max(45),
      respiratoryRate: z.number().finite().min(4).max(80),
      oxygenSaturation: z.number().finite().min(50).max(100),
      spO2Scale: z.union([z.literal(1), z.literal(2)]).optional(),
      onSupplementalOxygen: z.boolean().optional(),
      consciousness: z.enum([
        'Alert','Voice','Pain','Unresponsive','NewConfusion','A','V','P','U','C'
      ]).optional(),
      gcsScore: z.number().int().min(3).max(15).optional(),
      measuredAt: z.number().finite().positive().optional(),
    }).strict(),
  },
  PrescribeMedicationCommand: {
    1: z.object({
      patientId: nonEmpty.max(150),
      encounterId: nonEmpty.max(150),
      drugCode: nonEmpty.max(100),
      dosage: nonEmpty.max(200),
      route: nonEmpty.max(100),
      frequency: nonEmpty.max(100),
      durationDays: z.number().int().positive().max(3650),
      quantityPrescribed: z.number().finite().positive().max(1_000_000).optional(),
      unitOfMeasure: z.string().trim().min(1).max(100).optional(),
      instructions: z.string().trim().max(4000).optional(),
      safetyAcknowledgementFindingIds: z.array(nonEmpty.max(200)).max(50).optional(),
      safetyOverrideReason: z.string().trim().min(10).max(4000).optional(),
    }).strict(),
  },
  ReconcileOpdBillingCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
    }).strict(),
  },
  AdvanceStageCommand: {
    1: z.object({
      encounterId: nonEmpty.max(150),
      currentStage: nonEmpty.max(100),
      targetStage: nonEmpty.max(100),
      evidenceId: z.string().trim().min(1).max(150).optional(),
      stageNotes: z.string().trim().max(4000).optional(),
      handoffSbar: z.object({
        situation: z.string().trim().min(1).max(2000),
        background: z.string().trim().min(1).max(4000),
        assessment: z.string().trim().min(1).max(4000),
        recommendation: z.string().trim().min(1).max(4000),
      }).strict().optional(),
    }).strict(),
  },
  DischargeInpatientEncounterCommand: {
    1: z.object({
      encounterId: nonEmpty,
      bedId: nonEmpty,
      disposition: nonEmpty,
      followUpInstructions: nonEmpty,
      notes: z.string().optional(),
      dischargeSummaryEvidenceId: z.string().trim().min(1).optional(),
    }).strict(),
  },
};

export interface CommandSchemaValidationResult {
  success: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code:
      | 'COMMAND_SCHEMA_NOT_REGISTERED'
      | 'COMMAND_SCHEMA_VERSION_UNSUPPORTED'
      | 'COMMAND_PAYLOAD_INVALID';
    message: string;
    details?: unknown;
  };
}

export function validateCommandPayload(
  command: BaseCommand
): CommandSchemaValidationResult {
  const versions = schemas[command.commandType];
  if (!versions) {
    return {
      success: false,
      error: {
        code: 'COMMAND_SCHEMA_NOT_REGISTERED',
        message: `No authoritative payload schema is registered for ${command.commandType}.`,
      },
    };
  }

  const schema = versions[command.schemaVersion];
  if (!schema) {
    return {
      success: false,
      error: {
        code: 'COMMAND_SCHEMA_VERSION_UNSUPPORTED',
        message: `Unsupported schemaVersion ${command.schemaVersion} for ${command.commandType}.`,
      },
    };
  }

  const parsed = schema.safeParse(command.payload);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: 'COMMAND_PAYLOAD_INVALID',
        message: `Payload validation failed for ${command.commandType}.`,
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
    };
  }

  return { success: true, payload: parsed.data };
}
