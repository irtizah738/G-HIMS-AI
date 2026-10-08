import type {
  Bed,
  BillingAuditMismatch,
  ClinicalNote,
  Encounter,
  LabOrder,
  Medication,
  OpdQueueToken,
  Patient,
  TelehealthSession,
  Vitals,
} from '@/lib/types/ghims';
import type { EdgeSnapshot } from '@/lib/offline/hydration';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeGender(value: unknown): 'Male' | 'Female' | 'Other' {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'male' || normalized === 'm') return 'Male';
  if (normalized === 'female' || normalized === 'f') return 'Female';
  return 'Other';
}

function calculateAge(dateOfBirth: string): number {
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const beforeBirthday =
    now.getMonth() < date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() < date.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

function encounterType(value: unknown): Encounter['type'] {
  const normalized = asString(value).toUpperCase();
  if (normalized.includes('INPATIENT') || normalized === 'IPD') return 'Inpatient';
  if (normalized.includes('EMERGENCY') || normalized === 'ED') return 'Emergency';
  return 'Outpatient';
}

function encounterStatus(value: unknown): Encounter['status'] {
  const normalized = asString(value).toUpperCase();
  if (normalized.includes('DISCHARG')) return 'discharged';
  if (normalized.includes('TRANSFER')) return 'transferred';
  return 'active';
}

function noteCategory(value: unknown): ClinicalNote['category'] {
  const normalized = asString(value).toUpperCase();
  if (normalized === 'NURSING') return 'Nursing';
  if (normalized === 'DISCHARGE') return 'Discharge';
  if (normalized === 'CONSULTATION') return 'Consultation';
  if (normalized === 'SOAP') return 'SOAP';
  return 'Progress';
}

function orderCategory(value: unknown): LabOrder['category'] {
  const normalized = asString(value).toUpperCase();
  if (normalized.includes('RADIO')) return 'Radiology';
  if (normalized.includes('MICRO')) return 'Microbiology';
  if (normalized.includes('PATH')) return 'Pathology';
  if (normalized.includes('HEMAT')) return 'Hematology';
  return 'Biochemistry';
}

function bloodGroup(value: unknown): Patient['bloodGroup'] {
  const candidate = asString(value).toUpperCase();
  const allowed: Patient['bloodGroup'][] = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
  return allowed.includes(candidate as Patient['bloodGroup'])
    ? candidate as Patient['bloodGroup']
    : 'O+';
}

export interface HospitalEdgeModels {
  patients: Patient[];
  beds: Bed[];
  opdQueue: OpdQueueToken[];
  mismatches: BillingAuditMismatch[];
  telehealthSessions: TelehealthSession[];
}

export function adaptEdgeSnapshot(snapshot: EdgeSnapshot): HospitalEdgeModels {
  const collections = snapshot.collections || {};
  const patientRows = collections.patients || [];
  const encounterRows = collections.encounters || [];
  const evidenceRows = collections.encounterEvidence || [];
  const orderRows = collections.orders || [];
  const prescriptionRows = collections.prescriptions || [];
  const chargeRows = collections.encounterCharges || [];

  const encountersByPatient = new Map<string, Encounter[]>();

  for (const rawEncounter of encounterRows) {
    const encounterId = asString((rawEncounter as any).id || (rawEncounter as any).encounterId);
    const patientId = asString((rawEncounter as any).patientId);
    if (!encounterId || !patientId) continue;

    const encounterEvidence = evidenceRows.filter(
      (item) => asString((item as any).encounterId) === encounterId
    );
    const encounterOrders = orderRows.filter(
      (item) => asString((item as any).encounterId) === encounterId
    );
    const encounterPrescriptions = prescriptionRows.filter(
      (item) => asString((item as any).encounterId) === encounterId
    );
    const encounterCharges = chargeRows.filter(
      (item) => asString((item as any).encounterId) === encounterId
    );

    const vitalsHistory: Vitals[] = encounterEvidence
      .filter((item) => asString((item as any).evidenceType).toUpperCase() === 'VITALS')
      .map((item) => ({
        heartRate: asNumber((item as any).heartRate),
        bloodPressure: asString((item as any).bloodPressure),
        temperature: asNumber((item as any).temperature),
        respiratoryRate: asNumber((item as any).respiratoryRate),
        oxygenSaturation: asNumber((item as any).oxygenSaturation),
        timestamp: new Date(asNumber((item as any).measuredAt || (item as any).createdAt, Date.now())).toISOString(),
      }));

    const clinicalNotes: ClinicalNote[] = encounterEvidence
      .filter((item) => asString((item as any).evidenceType).toUpperCase() === 'SIGNED_CLINICAL_NOTE')
      .map((item) => ({
        id: asString((item as any).id || (item as any).evidenceId),
        timestamp: new Date(asNumber((item as any).signedAt || (item as any).createdAt, Date.now())).toISOString(),
        author: asString((item as any).signedBy || (item as any).recordedBy, 'Authenticated Clinician'),
        role: asString((item as any).role, 'Clinician'),
        content: asString((item as any).content),
        category: noteCategory((item as any).category),
        aiStructuredData: ((item as any).acceptedStructuredData || undefined) as ClinicalNote['aiStructuredData'],
      }));

    const labOrders: LabOrder[] = encounterOrders.map((item) => ({
      id: asString((item as any).id || (item as any).orderId),
      testName: asString((item as any).orderName || (item as any).catalogCode, 'Diagnostic order'),
      category: orderCategory((item as any).orderType),
      status:
        asString((item as any).status).toUpperCase() === 'COMPLETED'
          ? 'completed'
          : asString((item as any).status).toUpperCase() === 'PROCESSING'
            ? 'in-progress'
            : 'ordered',
      orderedAt: new Date(asNumber((item as any).createdAt, Date.now())).toISOString(),
      sampleId: asString((item as any).sampleId || (item as any).id || (item as any).orderId),
      cost: asNumber((item as any).costMinorUnits) / 100,
    }));

    const medications: Medication[] = encounterPrescriptions.map((item) => ({
      id: asString((item as any).id || (item as any).prescriptionId),
      name: asString((item as any).drugName),
      dosage: asString((item as any).dosage),
      frequency: asString((item as any).frequency),
      route: asString((item as any).route),
      status: asString((item as any).status).toUpperCase() === 'DISCONTINUED' ? 'discontinued' : 'active',
      prescribedDate: new Date(asNumber((item as any).createdAt, Date.now())).toISOString(),
      prescribedBy: asString((item as any).prescribedBy, 'Authenticated Clinician'),
    }));

    const billingItems = encounterCharges.map((item) => ({
      id: asString((item as any).id || (item as any).chargeId),
      description: asString((item as any).description || (item as any).serviceName, 'Encounter charge'),
      code: asString((item as any).code || (item as any).billingCode),
      category: 'Procedure' as const,
      quantity: asNumber((item as any).quantity, 1),
      unitPrice: asNumber((item as any).unitAmountMinorUnits) / 100,
      totalPrice: asNumber((item as any).netAmountMinorUnits) / 100,
    }));

    const encounter: Encounter = {
      id: encounterId,
      type: encounterType((rawEncounter as any).encounterType || (rawEncounter as any).type),
      department: asString((rawEncounter as any).department, 'General'),
      admitDate: new Date(asNumber((rawEncounter as any).createdAt || (rawEncounter as any).startedAt, Date.now())).toISOString(),
      dischargeDate: (rawEncounter as any).dischargedAt
        ? new Date(asNumber((rawEncounter as any).dischargedAt)).toISOString()
        : undefined,
      chiefComplaint: asString((rawEncounter as any).chiefComplaint),
      attendingPhysician: asString((rawEncounter as any).assignedDoctor || (rawEncounter as any).attendingPhysician),
      status: encounterStatus((rawEncounter as any).status),
      vitalsHistory,
      clinicalNotes,
      medications,
      labOrders,
      billing: {
        items: billingItems,
        subtotal: billingItems.reduce((sum, item) => sum + item.totalPrice, 0),
        tax: 0,
        insuranceCoverage: 0,
        patientPayable: billingItems.reduce((sum, item) => sum + item.totalPrice, 0),
        paymentStatus: 'pending',
      },
    };

    const existing = encountersByPatient.get(patientId) || [];
    existing.push(encounter);
    encountersByPatient.set(patientId, existing);
  }

  const patients: Patient[] = patientRows
    .map((raw) => {
      const id = asString((raw as any).id || (raw as any).patientId);
      const dob = asString((raw as any).dateOfBirth);
      return {
        id,
        mrn: asString((raw as any).mrn),
        fullName: asString((raw as any).fullName),
        dateOfBirth: dob,
        age: asNumber((raw as any).age, calculateAge(dob)),
        gender: normalizeGender((raw as any).gender),
        bloodGroup: bloodGroup((raw as any).bloodGroup),
        contactNumber: asString((raw as any).contactPhone || (raw as any).contactNumber),
        email: asString((raw as any).email),
        address: asString((raw as any).address),
        emergencyContact: ((raw as any).emergencyContact || {
          name: '',
          relationship: '',
          phone: '',
        }) as Patient['emergencyContact'],
        allergies: Array.isArray((raw as any).allergies) ? (raw as any).allergies : [],
        chronicConditions: Array.isArray((raw as any).chronicConditions) ? (raw as any).chronicConditions : [],
        activeBedId: asString((raw as any).activeBedId) || undefined,
        activeEncounterId: asString((raw as any).activeEncounterId) || undefined,
        status: asString((raw as any).status, 'ACTIVE').toUpperCase() as Patient['status'],
        mergedIntoPatientId:
          asString((raw as any).mergedIntoPatientId) || undefined,
        encounters: encountersByPatient.get(id) || [],
        registeredAt: new Date(asNumber((raw as any).createdAt || (raw as any).registeredAt, Date.now())).toISOString(),
      };
    });

  const beds: Bed[] = (collections.beds || []).map((raw) => ({
    id: asString((raw as any).id || (raw as any).bedId),
    bedNumber: asString((raw as any).bedNumber),
    ward: (asString((raw as any).ward || (raw as any).wardName, 'General') as Bed['ward']),
    room: asString((raw as any).room || (raw as any).roomNumber),
    status: asString((raw as any).status, 'available').toLowerCase() as Bed['status'],
    patientId: asString((raw as any).patientId) || undefined,
    patientName: asString((raw as any).patientName) || undefined,
    admissionDate: asString((raw as any).admissionDate) || undefined,
    assignedNurse: asString((raw as any).assignedNurse) || undefined,
    assignedDoctor: asString((raw as any).assignedDoctor) || undefined,
    attendingDoctor: asString((raw as any).attendingDoctor) || undefined,
    notes: asString((raw as any).notes) || undefined,
  }));

  const opdQueue: OpdQueueToken[] = (collections.opd_queue || []).map((raw) => ({
    id: asString((raw as any).id || (raw as any).tokenId),
    encounterId: asString((raw as any).encounterId) || undefined,
    tokenNumber: asString((raw as any).tokenNumber),
    patientId: asString((raw as any).patientId),
    patientName: asString((raw as any).patientName),
    mrn: asString((raw as any).mrn),
    age: asNumber((raw as any).age),
    gender: normalizeGender((raw as any).gender),
    department: asString((raw as any).department),
    assignedDoctor: asString((raw as any).assignedDoctor),
    priority: asString((raw as any).priority, 'routine').toLowerCase() as OpdQueueToken['priority'],
    status: asString((raw as any).status, 'waiting').toLowerCase() as OpdQueueToken['status'],
    arrivalTime: asString((raw as any).arrivalTime || (raw as any).createdAt),
    chiefComplaint: asString((raw as any).chiefComplaint),
  }));

  const mismatches: BillingAuditMismatch[] = (collections.billingMismatches || []).map((raw) => ({
    id: asString((raw as any).id || (raw as any).findingId),
    patientId: asString((raw as any).patientId),
    patientName: asString((raw as any).patientName),
    encounterId: asString((raw as any).encounterId),
    noteId: asString((raw as any).noteId || (raw as any).sourceEvidenceId),
    date: asString((raw as any).date || (raw as any).createdAt),
    documentedItem: asString((raw as any).documentedItem || (raw as any).description),
    category: asString((raw as any).category, 'Procedure') as BillingAuditMismatch['category'],
    suggestedCptCode: asString((raw as any).suggestedCptCode || (raw as any).billingCode),
    estimatedRecoverableRevenue:
      asNumber((raw as any).estimatedRecoverableAmountMinorUnits || (raw as any).estimatedRecoverableRevenue) /
      ((raw as any).estimatedRecoverableAmountMinorUnits != null ? 100 : 1),
    status:
      asString((raw as any).status).toUpperCase() === 'RECONCILED'
        ? 'reconciled'
        : asString((raw as any).status).toUpperCase() === 'DISMISSED'
          ? 'dismissed'
          : 'pending_review',
    evidenceSnippet: asString((raw as any).evidenceSnippet || (raw as any).reason),
    confidenceScore: asNumber((raw as any).confidenceScore, 0),
  }));

  return {
    patients,
    beds,
    opdQueue,
    mismatches,
    telehealthSessions: (collections.telehealthSessions || []) as unknown as TelehealthSession[],
  };
}
