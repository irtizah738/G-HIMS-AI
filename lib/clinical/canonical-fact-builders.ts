import type {
  ClinicalDocument,
  ClinicalObservation,
  ClinicalProvenance,
  DiagnosticOrder,
  MedicationDispense,
  MedicationOrder,
  Quantity,
} from '@/types/clinical-canonical';

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

function quantity(value: number, unit: string, code: string): Quantity {
  return {
    value,
    unit,
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
      code: {
        codings: [{ system: 'LOINC', code: '8867-4', display: 'Heart rate' }],
        text: 'Heart rate',
      },
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.heartRate, 'beats/minute', '/min'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_rr`,
      code: {
        codings: [{ system: 'LOINC', code: '9279-1', display: 'Respiratory rate' }],
        text: 'Respiratory rate',
      },
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.respiratoryRate, 'breaths/minute', '/min'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_temp`,
      code: {
        codings: [{ system: 'LOINC', code: '8310-5', display: 'Body temperature' }],
        text: 'Body temperature',
      },
      value: {
        valueType: 'QUANTITY',
        quantity: quantity(input.temperature, '°C', 'Cel'),
      },
    },
    {
      ...base,
      observationId: `obs_${input.sourceEvidenceId}_spo2`,
      code: {
        codings: [{ system: 'LOINC', code: '2708-6', display: 'Oxygen saturation in arterial blood' }],
        text: 'Oxygen saturation',
      },
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
      code: {
        codings: [{ system: 'LOINC', code: '85354-9', display: 'Blood pressure panel' }],
        text: 'Blood pressure',
      },
      value: {
        valueType: 'COMPONENTS',
        components: [
          {
            code: {
              codings: [{ system: 'LOINC', code: '8480-6', display: 'Systolic blood pressure' }],
              text: 'Systolic blood pressure',
            },
            value: {
              valueType: 'QUANTITY',
              quantity: quantity(systolic, 'mmHg', 'mm[Hg]'),
            },
          },
          {
            code: {
              codings: [{ system: 'LOINC', code: '8462-4', display: 'Diastolic blood pressure' }],
              text: 'Diastolic blood pressure',
            },
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
    service: {
      codings: [
        {
          system: 'LOCAL',
          code: input.catalogCode,
          display: input.orderName,
        },
      ],
      text: input.orderName,
    },
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
    medication: {
      codings: [{ system: 'LOCAL', code: input.drugCode, display: input.drugName }],
      text: input.drugName,
    },
    status: 'ACTIVE',
    intent: 'ORDER',
    dosageText: input.dosage,
    route: {
      codings: [{ system: 'LOCAL', code: input.route.toUpperCase(), display: input.route }],
      text: input.route,
    },
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
    medication: {
      codings: [{ system: 'LOCAL', code: input.drugCode, display: input.drugName }],
      text: input.drugName,
    },
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
