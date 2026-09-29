import type {
  ClinicalAllergy,
  ClinicalCondition,
  ClinicalDocument,
  ClinicalObservation,
  ClinicalProvenance,
  DiagnosticOrder,
  MedicationAdministration,
  MedicationDispense,
  MedicationOrder,
  Quantity,
} from '@/types/clinical-canonical';
import { TerminologyService } from '@/lib/clinical/terminology/terminology-service';

interface ProvenanceInput {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  sourceEvidenceId: string;
  actorId: string;
  recordedAt: number;
  sourceType: ClinicalProvenance['sourceType'];
  aiDraftId?: string;
}

function provenance(input: ProvenanceInput): ClinicalProvenance {
  return {
    provenanceId: `prov_${input.sourceEvidenceId}`,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.sourceEvidenceId,
    sourceType: input.sourceType,
    recordedBy: input.actorId,
    recordedAt: input.recordedAt,
    effectiveAt: input.recordedAt,
    aiDraftId: input.aiDraftId,
  };
}

function concept(system: string, code: string, display: string) {
  const resolved = TerminologyService.lookup(system, code);
  return {
    codings: [
      resolved
        ? {
            system: resolved.system,
            code: resolved.code,
            display: resolved.display,
            version: resolved.version,
          }
        : { system, code, display },
    ],
    text: resolved?.display || display,
  };
}

function quantity(value: number, unit: string, code: string): Quantity {
  const resolved = TerminologyService.lookup('UCUM', code);
  return {
    value,
    unit: resolved?.display || unit,
    system: 'UCUM',
    code,
  };
}

interface VitalObservationInput {
  tenantId: string;
  patientId: string;
  encounterId: string;
  sourceEvidenceId: string;
  actorId: string;
  measuredAt: number;
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
}

export function buildCanonicalVitalObservations(
  input: VitalObservationInput
): ClinicalObservation[] {
  const [rawSystolic, rawDiastolic] = String(input.bloodPressure || '').split('/');
  const systolic = Number(rawSystolic);
  const diastolic = Number(rawDiastolic);
  const recordedAt = Date.now();
  const baseProvenance = provenance({
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.sourceEvidenceId,
    actorId: input.actorId,
    recordedAt,
    sourceType: 'NURSE',
  });

  const base = {
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.sourceEvidenceId,
    provenance: baseProvenance,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    version: 1,
    category: 'VITAL_SIGNS' as const,
    effectiveAt: input.measuredAt,
    status: 'FINAL' as const,
    performerIds: [input.actorId],
  };

  const observations: ClinicalObservation[] = [
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_hr`,
      code: concept('LOINC', '8867-4', 'Heart rate'),
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.heartRate, 'beats/minute', '/min'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_rr`,
      code: concept('LOINC', '9279-1', 'Respiratory rate'),
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.respiratoryRate, 'breaths/minute', '/min'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_temp`,
      code: concept('LOINC', '8310-5', 'Body temperature'),
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.temperature, '°C', 'Cel'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_spo2`,
      code: concept('LOINC', '2708-6', 'Oxygen saturation'),
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.oxygenSaturation, '%', '%'),
      },
    },
  ];

  if (Number.isFinite(systolic) && Number.isFinite(diastolic)) {
    observations.push({
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_bp`,
      code: concept('LOINC', '85354-9', 'Blood pressure'),
      value: {
        valueType: 'COMPONENTS',
        components: [
          {
            code: concept('LOINC', '8480-6', 'Systolic blood pressure'),
            value: {
              valueType: 'QUANTITY',
              quantity: quantity(systolic, 'mmHg', 'mm[Hg]'),
            },
          },
          {
            code: concept('LOINC', '8462-4', 'Diastolic blood pressure'),
            value: {
              valueType: 'QUANTITY',
              quantity: quantity(diastolic, 'mmHg', 'mm[Hg]'),
            },
          },
        ],
      },
    });
  }

  return observations;
}

export function buildCanonicalClinicalDocument(input: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  sourceEvidenceId: string;
  actorId: string;
  category: ClinicalDocument['documentType'];
  content: string;
  signedAt: number;
  sourceDraftId?: string;
  structuredData?: Record<string, unknown>;
}): ClinicalDocument {
  return {
    clinicalDocumentId: `doc_${input.sourceEvidenceId}`,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.sourceEvidenceId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.sourceEvidenceId,
      actorId: input.actorId,
      recordedAt: input.signedAt,
      sourceType: input.category === 'NURSING' ? 'NURSE' : 'CLINICIAN',
      aiDraftId: input.sourceDraftId,
    }),
    createdAt: input.signedAt,
    updatedAt: input.signedAt,
    version: 1,
    documentType: input.category,
    status: 'FINAL',
    content: input.content,
    structuredData: input.structuredData,
    signedBy: input.actorId,
    signedAt: input.signedAt,
    sourceDraftId: input.sourceDraftId,
  };
}

export function buildCanonicalDiagnosticOrder(input: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  orderId: string;
  actorId: string;
  orderType: DiagnosticOrder['orderType'];
  catalogCode: string;
  orderName: string;
  priority: DiagnosticOrder['priority'];
  clinicalIndication: string;
  orderedAt: number;
}): DiagnosticOrder {
  return {
    diagnosticOrderId: input.orderId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.orderId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.orderId,
      actorId: input.actorId,
      recordedAt: input.orderedAt,
      sourceType: 'CLINICIAN',
    }),
    createdAt: input.orderedAt,
    updatedAt: input.orderedAt,
    version: 1,
    service: concept('LOCAL', input.catalogCode, input.orderName),
    orderType: input.orderType,
    priority: input.priority,
    status: 'PLACED',
    clinicalIndication: input.clinicalIndication,
    orderedBy: input.actorId,
    orderedAt: input.orderedAt,
  };
}

export function buildCanonicalMedicationOrder(input: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  prescriptionId: string;
  actorId: string;
  drugCode: string;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed?: number;
  unitOfMeasure?: string;
  instructions?: string;
  authoredAt: number;
}): MedicationOrder {
  return {
    medicationOrderId: input.prescriptionId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.prescriptionId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.prescriptionId,
      actorId: input.actorId,
      recordedAt: input.authoredAt,
      sourceType: 'CLINICIAN',
    }),
    createdAt: input.authoredAt,
    updatedAt: input.authoredAt,
    version: 1,
    medication: concept('LOCAL', input.drugCode, input.drugName),
    status: 'ACTIVE',
    intent: 'ORDER',
    dosageText: input.dosage,
    route: concept('LOCAL', input.route.toUpperCase(), input.route),
    frequency: input.frequency,
    durationDays: input.durationDays,
    quantity:
      input.quantityPrescribed !== undefined
        ? quantity(
            input.quantityPrescribed,
            input.unitOfMeasure || 'unit',
            input.unitOfMeasure || '1'
          )
        : undefined,
    instructions: input.instructions,
    prescribedBy: input.actorId,
    authoredAt: input.authoredAt,
  };
}

export function buildCanonicalMedicationDispense(input: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  prescriptionId: string;
  actorId: string;
  drugCode: string;
  drugName: string;
  quantityDispensed: number;
  unitOfMeasure?: string;
  batchNumber?: string;
  expiryDate?: string;
  dispensedAt: number;
}): MedicationDispense {
  const id = `disp_${input.prescriptionId}_${input.dispensedAt}`;
  return {
    medicationDispenseId: id,
    medicationOrderId: input.prescriptionId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: id,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: id,
      actorId: input.actorId,
      recordedAt: input.dispensedAt,
      sourceType: 'PHARMACIST',
    }),
    createdAt: input.dispensedAt,
    updatedAt: input.dispensedAt,
    version: 1,
    medication: concept('LOCAL', input.drugCode, input.drugName),
    status: 'COMPLETED',
    quantity: quantity(
      input.quantityDispensed,
      input.unitOfMeasure || 'unit',
      input.unitOfMeasure || '1'
    ),
    batchNumber: input.batchNumber,
    expiryDate: input.expiryDate,
    dispensedBy: input.actorId,
    dispensedAt: input.dispensedAt,
  };
}


export function buildCanonicalCondition(input: {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  conditionId: string;
  actorId: string;
  code: string;
  display: string;
  codingSystem?: string;
  category: ClinicalCondition['category'];
  clinicalStatus?: ClinicalCondition['clinicalStatus'];
  verificationStatus?: ClinicalCondition['verificationStatus'];
  onsetAt?: number;
  recordedAt: number;
}): ClinicalCondition {
  return {
    conditionId: input.conditionId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.conditionId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.conditionId,
      actorId: input.actorId,
      recordedAt: input.recordedAt,
      sourceType: 'CLINICIAN',
    }),
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt,
    version: 1,
    code: {
      codings: [{
        system: input.codingSystem || 'LOCAL',
        code: input.code,
        display: input.display,
      }],
      text: input.display,
    },
    category: input.category,
    clinicalStatus: input.clinicalStatus || 'ACTIVE',
    verificationStatus: input.verificationStatus || 'CONFIRMED',
    onsetAt: input.onsetAt,
    recordedAt: input.recordedAt,
    recordedBy: input.actorId,
    assertedBy: input.actorId,
  };
}

export function buildCanonicalAllergy(input: {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  allergyId: string;
  actorId: string;
  substanceCode: string;
  substanceDisplay: string;
  codingSystem?: string;
  type?: ClinicalAllergy['type'];
  category: ClinicalAllergy['category'];
  criticality?: ClinicalAllergy['criticality'];
  verificationStatus?: ClinicalAllergy['verificationStatus'];
  reactionText?: string;
  reactionSeverity?: 'MILD' | 'MODERATE' | 'SEVERE';
  recordedAt: number;
}): ClinicalAllergy {
  return {
    allergyId: input.allergyId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.allergyId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.allergyId,
      actorId: input.actorId,
      recordedAt: input.recordedAt,
      sourceType: 'CLINICIAN',
    }),
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt,
    version: 1,
    substance: {
      codings: [{
        system: input.codingSystem || 'LOCAL',
        code: input.substanceCode,
        display: input.substanceDisplay,
      }],
      text: input.substanceDisplay,
    },
    type: input.type || 'ALLERGY',
    category: input.category,
    clinicalStatus: 'ACTIVE',
    verificationStatus: input.verificationStatus || 'CONFIRMED',
    criticality: input.criticality || 'UNABLE_TO_ASSESS',
    reactions: input.reactionText
      ? [{
          manifestation: [{
            codings: [{
              system: 'LOCAL',
              code: 'REPORTED_REACTION',
              display: input.reactionText,
            }],
            text: input.reactionText,
          }],
          severity: input.reactionSeverity,
          description: input.reactionText,
        }]
      : [],
    recordedAt: input.recordedAt,
    recorderId: input.actorId,
    asserterId: input.actorId,
  };
}

export function buildCanonicalMedicationAdministration(input: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  administrationId: string;
  actorId: string;
  medicationOrderId?: string;
  medicationCode: string;
  medicationName: string;
  doseText: string;
  route: string;
  status: 'GIVEN' | 'HELD';
  administeredAt: number;
  notes?: string;
}): MedicationAdministration {
  return {
    medicationAdministrationId: input.administrationId,
    medicationOrderId: input.medicationOrderId,
    tenantId: input.tenantId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    sourceEvidenceId: input.administrationId,
    provenance: provenance({
      tenantId: input.tenantId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      sourceEvidenceId: input.administrationId,
      actorId: input.actorId,
      recordedAt: input.administeredAt,
      sourceType: 'NURSE',
    }),
    createdAt: input.administeredAt,
    updatedAt: input.administeredAt,
    version: 1,
    medication: {
      codings: [{
        system: 'LOCAL',
        code: input.medicationCode,
        display: input.medicationName,
      }],
      text: input.medicationName,
    },
    status: input.status === 'GIVEN' ? 'COMPLETED' : 'NOT_DONE',
    doseText: input.doseText,
    route: {
      codings: [{ system: 'LOCAL', code: input.route.toUpperCase(), display: input.route }],
      text: input.route,
    },
    administeredBy: input.actorId,
    administeredAt: input.administeredAt,
    notDoneReason: input.status === 'HELD' ? input.notes || 'Medication held' : undefined,
  };
}
