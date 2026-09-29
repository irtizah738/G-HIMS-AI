import crypto from 'node:crypto';
import type {
  ClinicalAllergy,
  ClinicalCondition,
  ClinicalDocument,
  ClinicalObservation,
  DiagnosticReport,
  MedicationOrder,
  PatientClinicalKnowledgeStatus,
} from '@/types/clinical-canonical';
import type {
  Patient360AllergySummary,
  Patient360ConditionSummary,
  Patient360DocumentSummary,
  Patient360EncounterSummary,
  Patient360MedicationSummary,
  Patient360ObservationSummary,
  Patient360Projection,
  Patient360ResultSummary,
  Patient360TimelineItem,
} from '@/types/patient360-projection';

export interface Patient360SourceEvent {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

export interface Patient360ProjectionSources {
  tenantId: string;
  patient: Record<string, unknown>;
  encounters: Array<Record<string, unknown>>;
  conditions: ClinicalCondition[];
  allergies: ClinicalAllergy[];
  medicationOrders: MedicationOrder[];
  observations: ClinicalObservation[];
  diagnosticReports: DiagnosticReport[];
  documents: ClinicalDocument[];
  events: Patient360SourceEvent[];
  knowledgeStatus?: PatientClinicalKnowledgeStatus;
}

export interface Patient360ProjectedResult {
  projection: Patient360Projection;
  timeline: Patient360TimelineItem[];
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }

  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalStringify(record[key]))
    .join(',') + '}';
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function asString(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function timestamp(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function firstCoding(concept: { codings?: Array<{ system?: string; code?: string; display?: string }>; text?: string }) {
  return concept.codings?.[0];
}

function encounterSummary(raw: Record<string, unknown>): Patient360EncounterSummary {
  return {
    encounterId: asString(raw.encounterId || raw.id),
    encounterType: asString(raw.encounterType || raw.type, 'UNKNOWN'),
    status: asString(raw.status, 'UNKNOWN'),
    department: asString(raw.department) || undefined,
    chiefComplaint: asString(raw.chiefComplaint) || undefined,
    startedAt: timestamp(raw.startedAt || raw.createdAt || raw.admitDate),
    completedAt: timestamp(raw.completedAt || raw.dischargeDate),
  };
}

function conditionSummary(item: ClinicalCondition): Patient360ConditionSummary {
  const coding = firstCoding(item.code);
  return {
    conditionId: item.conditionId,
    display: item.code.text || coding?.display || coding?.code || item.conditionId,
    code: coding?.code,
    system: coding?.system,
    category: item.category,
    clinicalStatus: item.clinicalStatus,
    verificationStatus: item.verificationStatus,
    onsetAt: item.onsetAt,
  };
}

function allergySummary(item: ClinicalAllergy): Patient360AllergySummary {
  const coding = firstCoding(item.substance);
  return {
    allergyId: item.allergyId,
    substance: item.substance.text || coding?.display || coding?.code || item.allergyId,
    code: coding?.code,
    system: coding?.system,
    category: item.category,
    criticality: item.criticality,
    verificationStatus: item.verificationStatus,
  };
}

function medicationSummary(item: MedicationOrder): Patient360MedicationSummary {
  const coding = firstCoding(item.medication);
  return {
    medicationOrderId: item.medicationOrderId,
    medication: item.medication.text || coding?.display || coding?.code || item.medicationOrderId,
    code: coding?.code,
    system: coding?.system,
    status: item.status,
    dosageText: item.dosageText,
    frequency: item.frequency,
    prescribedBy: item.prescribedBy,
    authoredAt: item.authoredAt,
  };
}

function observationSummary(item: ClinicalObservation): Patient360ObservationSummary {
  const coding = firstCoding(item.code);
  const interpretation =
    item.interpretation?.[0]?.text ||
    item.interpretation?.[0]?.codings?.[0]?.display;
  return {
    observationId: item.observationId,
    display: item.code.text || coding?.display || coding?.code || item.observationId,
    code: coding?.code,
    system: coding?.system,
    category: item.category,
    value: item.value,
    effectiveAt: item.effectiveAt,
    status: item.status,
    interpretation,
  };
}

function resultSummary(item: DiagnosticReport): Patient360ResultSummary {
  const coding = firstCoding(item.code);
  return {
    diagnosticReportId: item.diagnosticReportId,
    orderId: item.orderId,
    display: item.code.text || coding?.display || coding?.code || item.diagnosticReportId,
    category: item.category,
    status: item.status,
    issuedAt: item.issuedAt,
    conclusion: item.conclusion,
    observationIds: [...item.resultObservationIds],
  };
}

function documentSummary(item: ClinicalDocument): Patient360DocumentSummary {
  return {
    clinicalDocumentId: item.clinicalDocumentId,
    documentType: item.documentType,
    status: item.status,
    title: item.title,
    signedBy: item.signedBy,
    signedAt: item.signedAt,
  };
}

function eventSummary(event: Patient360SourceEvent): string {
  const payload = event.payload || {};
  switch (event.eventType) {
    case 'PATIENT_REGISTERED':
      return 'Patient registered';
    case 'ENCOUNTER_CREATED':
      return `Encounter started: ${asString(payload.encounterType, 'clinical encounter')}`;
    case 'VITALS_RECORDED':
      return 'Vital signs recorded';
    case 'CLINICAL_NOTE_SIGNED':
      return 'Clinical document signed';
    case 'INVESTIGATION_ORDERED':
      return `Diagnostic order placed: ${asString(payload.catalogCode, 'investigation')}`;
    case 'DIAGNOSTIC_RESULT_VERIFIED':
      return 'Diagnostic result verified';
    case 'DIAGNOSTIC_RESULT_RECORDED':
      return 'Diagnostic result recorded';
    case 'MEDICATION_PRESCRIBED':
      return `Medication prescribed: ${asString(payload.drugName, payload.drugCode as string || 'medication')}`;
    case 'MEDICATION_DISPENSED':
      return 'Medication dispensed';
    case 'MEDICATION_ADMINISTERED':
      return 'Medication administered';
    case 'CLINICAL_CONDITION_RECORDED':
      return 'Clinical condition recorded';
    case 'CLINICAL_ALLERGY_RECORDED':
      return 'Allergy or intolerance recorded';
    case 'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED':
      return `${asString(payload.domain, 'clinical')} knowledge status reviewed: ${asString(payload.status, 'updated')}`;
    case 'DISCHARGE_READINESS_REVIEW_RECORDED':
      return `Discharge readiness reviewed: ${asString(payload.outcome, 'acknowledged').replace(/_/g, ' ').toLowerCase()}`;
    case 'PATIENT_ADMITTED_TO_INPATIENT_CARE':
    case 'PATIENT_ADMITTED_TO_BED':
      return 'Patient admitted to inpatient care';
    case 'INPATIENT_ENCOUNTER_DISCHARGED':
    case 'PATIENT_DISCHARGED_FROM_BED':
      return 'Inpatient discharge completed';
    default:
      return event.eventType.replace(/_/g, ' ').toLowerCase();
  }
}

function sourceVersion(item: Record<string, unknown>): string {
  return [
    asString(item.id || item.encounterId || item.conditionId || item.allergyId ||
      item.medicationOrderId || item.observationId || item.diagnosticReportId ||
      item.clinicalDocumentId),
    asString(item.version || item._serverVersion || 0),
    asString(item.updatedAt || item.recordedAt || item.createdAt || 0),
  ].join(':');
}

export class Patient360Projector {
  public static project(
    sources: Patient360ProjectionSources,
    projectedAt = Date.now()
  ): Patient360ProjectedResult {
    const patientId = asString(sources.patient.id || sources.patient.patientId);
    if (!sources.tenantId || !patientId) {
      throw new Error('PATIENT360_SOURCE_INVALID: tenantId and patient identity are required.');
    }

    const samePatient = <T extends { patientId: string }>(items: T[]) =>
      items.filter((item) => item.patientId === patientId);

    const patientEncounterSources = sources.encounters
      .filter((item) => asString(item.patientId) === patientId);

    const encounters = patientEncounterSources
      .map(encounterSummary)
      .filter((item) => Boolean(item.encounterId))
      .sort((left, right) => {
        const l = typeof left.startedAt === 'number' ? left.startedAt : Date.parse(String(left.startedAt || 0));
        const r = typeof right.startedAt === 'number' ? right.startedAt : Date.parse(String(right.startedAt || 0));
        return (Number.isFinite(r) ? r : 0) - (Number.isFinite(l) ? l : 0);
      });

    const conditions = samePatient(sources.conditions);
    const allergies = samePatient(sources.allergies);
    const medicationOrders = samePatient(sources.medicationOrders);
    const observations = samePatient(sources.observations);
    const diagnosticReports = samePatient(sources.diagnosticReports);
    const documents = samePatient(sources.documents);

    const activeEncounterId = asString(sources.patient.activeEncounterId);
    const activeEncounter =
      encounters.find((item) => item.encounterId === activeEncounterId) ||
      encounters.find((item) => !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(item.status.toUpperCase()));

    const activeProblems = conditions
      .filter((item) =>
        item.clinicalStatus === 'ACTIVE' &&
        !['REFUTED', 'ENTERED_IN_ERROR'].includes(item.verificationStatus)
      )
      .sort((a, b) => Number(b.recordedAt || 0) - Number(a.recordedAt || 0))
      .slice(0, 50)
      .map(conditionSummary);

    const resolvedProblems = conditions
      .filter((item) => ['RESOLVED', 'INACTIVE', 'COMPLETED'].includes(item.clinicalStatus))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 30)
      .map(conditionSummary);

    const activeAllergies = allergies
      .filter((item) =>
        item.clinicalStatus === 'ACTIVE' &&
        !['REFUTED', 'ENTERED_IN_ERROR'].includes(item.verificationStatus)
      )
      .sort((a, b) => Number(b.recordedAt || 0) - Number(a.recordedAt || 0))
      .slice(0, 50)
      .map(allergySummary);

    const currentMedications = medicationOrders
      .filter((item) => ['ACTIVE', 'ON_HOLD'].includes(item.status))
      .sort((a, b) => b.authoredAt - a.authoredAt)
      .slice(0, 50)
      .map(medicationSummary);

    const latestVitalsByCode = new Map<string, ClinicalObservation>();
    observations
      .filter((item) => item.category === 'VITAL_SIGNS' && item.status !== 'ENTERED_IN_ERROR')
      .sort((a, b) => b.effectiveAt - a.effectiveAt)
      .forEach((item) => {
        const coding = firstCoding(item.code);
        const key = `${coding?.system || 'UNKNOWN'}:${coding?.code || item.observationId}`;
        if (!latestVitalsByCode.has(key)) latestVitalsByCode.set(key, item);
      });

    const latestVitals = Array.from(latestVitalsByCode.values())
      .slice(0, 20)
      .map(observationSummary);

    const recentResults = diagnosticReports
      .filter((item) => item.status !== 'ENTERED_IN_ERROR' && item.status !== 'CANCELLED')
      .sort((a, b) => Number(b.issuedAt || b.updatedAt) - Number(a.issuedAt || a.updatedAt))
      .slice(0, 30)
      .map(resultSummary);

    const recentDocuments = documents
      .filter((item) => item.status !== 'ENTERED_IN_ERROR')
      .sort((a, b) => b.signedAt - a.signedAt)
      .slice(0, 20)
      .map(documentSummary);

    const patientEvents = sources.events
      .filter((event) => {
        const payloadPatientId = asString(event.payload?.patientId);
        const patientAggregateId =
          asString(event.aggregateType).toUpperCase().includes('PATIENT')
            ? asString(event.aggregateId)
            : '';
        return payloadPatientId === patientId || patientAggregateId === patientId;
      })
      .sort((a, b) =>
        Number(b.recordedAt || b.occurredAt || 0) -
        Number(a.recordedAt || a.occurredAt || 0) ||
        b.eventId.localeCompare(a.eventId)
      );

    const latestEvent = patientEvents[0];
    const lastEventRecordedAt = latestEvent
      ? Number(latestEvent.recordedAt || latestEvent.occurredAt || 0)
      : undefined;
    const eventCheckpoint = latestEvent
      ? {
          eventId: latestEvent.eventId,
          recordedAt: Number(lastEventRecordedAt || 0),
        }
      : undefined;

    const timeline: Patient360TimelineItem[] = patientEvents.slice(0, 500).map((event) => ({
      timelineItemId: `p360tl_${patientId}_${event.eventId}`,
      tenantId: sources.tenantId,
      patientId,
      encounterId: asString(event.payload?.encounterId) || undefined,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: Number(event.occurredAt || event.recordedAt || 0),
      summary: eventSummary(event),
    }));

    const sourceFingerprint = hash({
      patient: sourceVersion(sources.patient),
      encounters: patientEncounterSources.map(sourceVersion).sort(),
      conditions: conditions.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      allergies: allergies.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      medicationOrders: medicationOrders.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      observations: observations.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      diagnosticReports: diagnosticReports.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      documents: documents.map((item) => sourceVersion(item as unknown as Record<string, unknown>)).sort(),
      knowledgeStatus: sources.knowledgeStatus || null,
      eventIds: patientEvents.map((event) => event.eventId).sort(),
    });

    const sourceCheckpoint = eventCheckpoint
      ? `${eventCheckpoint.recordedAt}:${eventCheckpoint.eventId}`
      : '0:NO_PATIENT_EVENT';

    const content = {
      tenantId: sources.tenantId,
      patientId,
      identity: {
        patientId,
        mrn: asString(sources.patient.mrn),
        fullName: asString(sources.patient.fullName, 'Patient'),
        dateOfBirth: asString(sources.patient.dateOfBirth) || undefined,
        gender: asString(sources.patient.gender) || undefined,
        bloodGroup: asString(sources.patient.bloodGroup) || undefined,
        status: asString(sources.patient.status) || undefined,
      },
      activeEncounter,
      recentEncounters: encounters.slice(0, 20),
      activeProblems,
      resolvedProblems,
      allergies: activeAllergies,
      currentMedications,
      latestVitals,
      recentResults,
      recentDocuments,
      dataQuality: {
        allergyKnowledge:
          allergies.length > 0
            ? 'KNOWN'
            : sources.knowledgeStatus?.allergyStatus || 'NOT_ASSESSED',
        problemListKnowledge:
          conditions.length > 0
            ? 'KNOWN'
            : sources.knowledgeStatus?.problemListStatus || 'NOT_ASSESSED',
        medicationKnowledge:
          medicationOrders.length > 0
            ? 'KNOWN'
            : sources.knowledgeStatus?.medicationStatus || 'NOT_ASSESSED',
        lastAllergyReviewAt: sources.knowledgeStatus?.lastAllergyReviewAt,
        lastProblemListReviewAt: sources.knowledgeStatus?.lastProblemListReviewAt,
        lastMedicationReconciliationAt:
          sources.knowledgeStatus?.lastMedicationReconciliationAt,
        hasUnverifiedAllergies: allergies.some((item) => item.verificationStatus !== 'CONFIRMED'),
        hasUnverifiedProblems: conditions.some((item) =>
          !['CONFIRMED', 'REFUTED'].includes(item.verificationStatus)
        ),
        hasPreliminaryResults: diagnosticReports.some((item) =>
          ['REGISTERED', 'PARTIAL', 'PRELIMINARY'].includes(item.status)
        ),
        missingCanonicalFacts: [
          ...((allergies.length === 0 &&
              (sources.knowledgeStatus?.allergyStatus || 'NOT_ASSESSED') === 'UNKNOWN')
            ? ['ALLERGY_STATUS_UNKNOWN']
            : []),
          ...((allergies.length === 0 &&
              (sources.knowledgeStatus?.allergyStatus || 'NOT_ASSESSED') === 'NOT_ASSESSED')
            ? ['ALLERGY_STATUS_NOT_ASSESSED']
            : []),
          ...((allergies.length === 0 &&
              (sources.knowledgeStatus?.allergyStatus || 'NOT_ASSESSED') === 'PATIENT_UNABLE_TO_REPORT')
            ? ['ALLERGY_STATUS_PATIENT_UNABLE_TO_REPORT']
            : []),
          ...((conditions.length === 0 &&
              (sources.knowledgeStatus?.problemListStatus || 'NOT_ASSESSED') === 'UNKNOWN')
            ? ['PROBLEM_LIST_UNKNOWN']
            : []),
          ...((conditions.length === 0 &&
              (sources.knowledgeStatus?.problemListStatus || 'NOT_ASSESSED') === 'NOT_ASSESSED')
            ? ['PROBLEM_LIST_NOT_ASSESSED']
            : []),
          ...((conditions.length === 0 &&
              (sources.knowledgeStatus?.problemListStatus || 'NOT_ASSESSED') === 'PATIENT_UNABLE_TO_REPORT')
            ? ['PROBLEM_LIST_PATIENT_UNABLE_TO_REPORT']
            : []),
          ...((medicationOrders.length === 0 &&
              (sources.knowledgeStatus?.medicationStatus || 'NOT_ASSESSED') === 'UNKNOWN')
            ? ['MEDICATION_HISTORY_UNKNOWN']
            : []),
          ...((medicationOrders.length === 0 &&
              (sources.knowledgeStatus?.medicationStatus || 'NOT_ASSESSED') === 'NOT_ASSESSED')
            ? ['MEDICATION_HISTORY_NOT_ASSESSED']
            : []),
          ...((medicationOrders.length === 0 &&
              (sources.knowledgeStatus?.medicationStatus || 'NOT_ASSESSED') === 'PATIENT_UNABLE_TO_REPORT')
            ? ['MEDICATION_HISTORY_PATIENT_UNABLE_TO_REPORT']
            : []),
        ],
      },
      counts: {
        encounters: encounters.length,
        conditions: conditions.length,
        allergies: allergies.length,
        medicationOrders: medicationOrders.length,
        observations: observations.length,
        diagnosticReports: diagnosticReports.length,
        documents: documents.length,
      },
      projectionVersion: 1,
      revision: patientEvents.length,
      eventCheckpoint,
      sourceFingerprint,
      sourceCheckpoint,
      lastEventId: latestEvent?.eventId,
      lastEventRecordedAt,
    };

    const contentHash = hash(content);

    return {
      projection: {
        ...content,
        contentHash,
        projectedAt,
      },
      timeline,
    };
  }
}
